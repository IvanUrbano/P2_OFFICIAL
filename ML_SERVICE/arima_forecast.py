"""
TBInsight ML Service — ARIMA Forecasting

Per-barangay time-series forecasting using pmdarima (auto_arima).
Seasonal ARIMA needs two full annual cycles (24 months). With 10-23 months a
non-seasonal ARIMA is fitted instead (seasonality cannot be learned from under
two cycles). Below 10 months or for sparse series, exponential smoothing is used.

Design spec:
  - ARIMA per barangay with seasonal=True, m=12 (monthly, annual seasonality)
  - Seasonal ARIMA for >= 24 months, non-seasonal for 10-23, fallback below 10 or > 50% zeros
  - All barangays share one monthly calendar so forecasts target the same month
  - Returns forecasted_count + confidence intervals
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from pmdarima import auto_arima

from config import (
    ARIMA_COMBINE_CITY,
    ARIMA_LEADING_TRIM_SHARE,
    ARIMA_LOG_TRANSFORM,
    ARIMA_SHARE_WINDOW,
    ARIMA_MIN_HISTORY,
    ARIMA_MIN_HISTORY_NONSEASONAL,
    FALLBACK_METHOD,
    ML_N_JOBS,
    ARIMA_SEASONAL_PERIOD,
    ARIMA_SPARSE_THRESHOLD,
    MODEL_VERSION,
)

logger = logging.getLogger(__name__)


def parallel_map(fn, arg_tuples: list[tuple]) -> list:
    """
    Apply fn(*args) to each tuple, across worker processes when there is enough work.
    ARIMA fits are independent per barangay and dominate the request time.
    """
    if ML_N_JOBS <= 1 or len(arg_tuples) < 3:
        return [fn(*args) for args in arg_tuples]
    return Parallel(n_jobs=ML_N_JOBS)(delayed(fn)(*args) for args in arg_tuples)


def _needs_fallback(series: pd.Series) -> bool:
    """Determine if a series should use fallback instead of ARIMA."""
    # Too short for any ARIMA
    if len(series) < ARIMA_MIN_HISTORY_NONSEASONAL:
        logger.info(f"Series too short ({len(series)} < {ARIMA_MIN_HISTORY_NONSEASONAL}), using fallback")
        return True

    # Too sparse (many zeros)
    zero_ratio = (series == 0).sum() / len(series)
    if zero_ratio > ARIMA_SPARSE_THRESHOLD:
        logger.info(f"Series too sparse ({zero_ratio:.1%} zeros), using fallback")
        return True

    return False


def _seasonal_naive_forecast(series: pd.Series, forecast_horizon: int = 1) -> dict:
    """
    Seasonal-naive fallback: repeat last season's values.
    For monthly data with annual seasonality: value[t] = value[t-12]
    """
    n = len(series)
    if n < ARIMA_SEASONAL_PERIOD:
        # Not even one full season — use last value
        last_value = float(series.iloc[-1])
        return {
            "forecasted_count": [max(0, last_value)] * forecast_horizon,
            "confidence_lower": [max(0, last_value * 0.7)] * forecast_horizon,
            "confidence_upper": [last_value * 1.3] * forecast_horizon,
            "method": "seasonal_naive",
        }

    # Use value from same month last year
    last_season_value = float(series.iloc[-ARIMA_SEASONAL_PERIOD])
    return {
        "forecasted_count": [max(0, last_season_value)] * forecast_horizon,
        "confidence_lower": [max(0, last_season_value * 0.7)] * forecast_horizon,
        "confidence_upper": [last_season_value * 1.3] * forecast_horizon,
        "method": "seasonal_naive",
    }


def _exponential_smoothing_forecast(series: pd.Series, forecast_horizon: int = 1) -> dict:
    """
    Exponential smoothing fallback for sparse/short series.
    Uses SimpleExpSmoothing with optimized alpha.
    """
    try:
        from statsmodels.tsa.holtwinters import SimpleExpSmoothing

        # statsmodels >= 0.15: initialization_method=None is rejected when optimizing —
        # pass 'estimated' explicitly so ES actually runs instead of falling back.
        model = SimpleExpSmoothing(
            series.values.astype(float), initialization_method="estimated"
        )
        fit = model.fit(optimized=True, use_brute=False)
        forecast = fit.forecast(forecast_horizon)

        # Approximate confidence interval from residual std
        residuals = fit.resid
        std = float(np.std(residuals))
        return {
            "forecasted_count": [max(0, float(v)) for v in forecast],
            "confidence_lower": [max(0, float(v) - 1.96 * std) for v in forecast],
            "confidence_upper": [float(v) + 1.96 * std for v in forecast],
            "method": "exponential_smoothing",
        }
    except Exception as e:
        logger.warning(f"Exponential smoothing failed, falling back to seasonal_naive: {e}")
        return _seasonal_naive_forecast(series, forecast_horizon)


def _fit_arima(values):
    """
    Fit auto_arima. Seasonal only when there are two full annual cycles;
    otherwise a small non-seasonal model (orders capped to avoid overfitting
    short series).
    """
    values = np.asarray(values, dtype=float)
    if len(values) >= ARIMA_MIN_HISTORY:
        return auto_arima(
            values,
            seasonal=True,
            m=ARIMA_SEASONAL_PERIOD,
            stepwise=True,
            suppress_warnings=True,
            error_action="ignore",
            max_order=8,
            trace=False,
        )
    return auto_arima(
        values,
        seasonal=False,
        stepwise=True,
        suppress_warnings=True,
        error_action="ignore",
        max_p=2,
        max_q=2,
        max_order=4,
        trace=False,
    )


def _fit_predict(values, horizon: int):
    """
    Fit ARIMA and forecast `horizon` months: (mean, lower, upper) arrays, 95% CI.

    With ARIMA_LOG_TRANSFORM the model is fitted on log(1 + cases). Converting
    the log forecast straight back gives the median, which sits below the mean
    for skewed counts, so the usual lognormal correction exp(sigma^2 / 2) is
    applied to the point forecast (sigma read off the log-scale interval).
    The interval bounds are quantiles and convert back directly.
    """
    values = np.clip(np.asarray(values, dtype=float), 0, None)
    if not ARIMA_LOG_TRANSFORM:
        model = _fit_arima(values)
        mean, ci = model.predict(n_periods=horizon, return_conf_int=True, alpha=0.05)
        ci = np.asarray(ci)
        return np.asarray(mean, dtype=float), ci[:, 0], ci[:, 1]

    model = _fit_arima(np.log1p(values))
    mu, ci = model.predict(n_periods=horizon, return_conf_int=True, alpha=0.05)
    mu, ci = np.asarray(mu, dtype=float), np.asarray(ci, dtype=float)
    sigma = (ci[:, 1] - ci[:, 0]) / (2 * 1.96)
    return np.expm1(mu + sigma ** 2 / 2), np.expm1(ci[:, 0]), np.expm1(ci[:, 1])


def city_shares(counts_by_name: dict, end: int) -> dict:
    """Each barangay's share of city cases over the ARIMA_SHARE_WINDOW months before `end`."""
    window = {n: float(np.sum(c[max(0, end - ARIMA_SHARE_WINDOW):end])) for n, c in counts_by_name.items()}
    total = sum(window.values())
    return {name: (v / total if total > 0 else 1 / len(window)) for name, v in window.items()}


def city_forecast(counts_by_name: dict, horizon: int) -> dict:
    """
    City-first forecast: ARIMA on the city-wide monthly total, split across
    barangays by their recent share of cases. Returns {name: (mean, lower, upper)}.
    """
    city = np.sum([np.asarray(c, dtype=float) for c in counts_by_name.values()], axis=0)
    mean, lower, upper = _fit_predict(city, horizon)
    shares = city_shares(counts_by_name, len(city))
    return {name: (mean * sh, lower * sh, upper * sh) for name, sh in shares.items()}


def _fallback_forecast(series: pd.Series, forecast_horizon: int = 1) -> dict:
    """Fallback for series too short or too sparse for ARIMA (see FALLBACK_METHOD)."""
    if FALLBACK_METHOD == "seasonal_naive":
        return _seasonal_naive_forecast(series, forecast_horizon)
    return _exponential_smoothing_forecast(series, forecast_horizon)


def _arima_forecast(series: pd.Series, forecast_horizon: int = 1) -> dict:
    """Run ARIMA forecast using pmdarima auto_arima.

    A 10-23 month series still successfully fits a NON-seasonal ARIMA model
    here (see _fit_arima) — that is a real, methodologically-unchanged fit,
    but per the approved reporting rule it must still surface as "Baseline
    Forecast" everywhere downstream, never "ARIMA", since seasonality can't
    be learned from under two annual cycles. `method` is tagged
    "arima_nonseasonal" in that case so callers can tell the two apart
    without re-deriving the observation count; "arima" is reserved for the
    24+-month seasonal fit.
    """
    try:
        forecast, lower, upper = _fit_predict(series.values, forecast_horizon)

        method = "arima" if len(series) >= ARIMA_MIN_HISTORY else "arima_nonseasonal"
        return {
            "forecasted_count": [max(0, float(v)) for v in forecast],
            "confidence_lower": [max(0, float(v)) for v in lower],
            "confidence_upper": [float(v) for v in upper],
            "method": method,
        }
    except Exception as e:
        logger.warning(f"ARIMA failed, using fallback: {e}")
        return _fallback_forecast(series, forecast_horizon)


def forecast_barangay(
    barangay_name: str,
    series: pd.Series,
    forecast_horizon: int = 1,
) -> dict:
    """
    Forecast a single barangay's TB cases.

    Args:
        barangay_name: Name of the barangay
        series: Monthly case counts (index = month, values = case_count)
        forecast_horizon: Number of months to forecast

    Returns:
        Dict with per-month predictions list
    """
    if series.empty:
        return {
            "barangay_name": barangay_name,
            "period": "",
            "predictions": [],
            "method": "zero_fallback",
        }

    # Below ARIMA_MIN_HISTORY_NONSEASONAL months, there isn't enough history
    # for any forecast method to be meaningful — report this honestly instead
    # of running a fallback and presenting it as a real prediction. One
    # prediction point per horizon month is still emitted (yhat=null) so
    # callers can tell "assessed, insufficient data" apart from "not
    # assessed at all".
    if len(series) < ARIMA_MIN_HISTORY_NONSEASONAL:
        last_month_start = pd.Timestamp(series.index[-1]).to_period('M').to_timestamp()
        predictions = []
        for i in range(forecast_horizon):
            month_date = last_month_start + pd.DateOffset(months=i + 1)
            predictions.append({
                "month": month_date.strftime("%Y-%m-%d"),
                "yhat": None,
                "yhat_lower": None,
                "yhat_upper": None,
            })
        last_period = last_month_start + pd.DateOffset(months=forecast_horizon)
        return {
            "barangay_name": barangay_name,
            "period": last_period.strftime("%Y-%m-%d"),
            "predictions": predictions,
            "method": "insufficient_data",
        }

    # Choose method based on series characteristics
    if _needs_fallback(series):
        result = _fallback_forecast(series, forecast_horizon)
    else:
        result = _arima_forecast(series, forecast_horizon)

    # Build per-month predictions — always use 1st of month for consistency
    last_month = series.index[-1]
    last_month_start = pd.Timestamp(last_month).to_period('M').to_timestamp()
    predictions = []
    for i in range(forecast_horizon):
        month_date = last_month_start + pd.DateOffset(months=i + 1)
        month_str = month_date.strftime("%Y-%m-%d")
        predictions.append({
            "month": month_str,
            "yhat": result["forecasted_count"][i] if i < len(result["forecasted_count"]) else 0,
            "yhat_lower": result["confidence_lower"][i] if i < len(result["confidence_lower"]) else 0,
            "yhat_upper": result["confidence_upper"][i] if i < len(result["confidence_upper"]) else 0,
        })

    # Last period (for backward compat)
    last_period = last_month_start + pd.DateOffset(months=forecast_horizon)

    return {
        "barangay_name": barangay_name,
        "period": last_period.strftime("%Y-%m-%d"),
        "predictions": predictions,
        "method": result["method"],
    }


def _trim_leading_months(wide: pd.DataFrame) -> pd.DataFrame:
    """
    Drop leading months holding only stray records.

    Imports can carry a handful of old cases (e.g. one case two years before the
    real data starts). Left in, they stretch every series with near-empty months,
    which trips the sparsity check and distorts the ARIMA fit. Leading months
    whose city-wide total is under ARIMA_LEADING_TRIM_SHARE of the median month
    are dropped.
    """
    totals = wide.sum(axis=1)
    positive = totals[totals > 0]
    if positive.empty:
        return wide
    real = totals[totals >= ARIMA_LEADING_TRIM_SHARE * float(positive.median())]
    return wide.loc[real.index[0]:]


def forecast_all(
    series_data: list[dict],
    forecast_horizon: int = 1,
) -> list[dict]:
    """
    Forecast all barangays from time series data.

    Args:
        series_data: List of dicts with barangay_name, month, case_count
        forecast_horizon: Number of months to forecast

    All barangays are placed on ONE shared monthly calendar (missing months
    count as 0), so every forecast targets the month after the latest month in
    the data. Without this, a barangay whose last case was months ago would
    forecast that older month instead of the pipeline period.

    Returns:
        List of forecast results per barangay
    """
    df = pd.DataFrame(series_data)
    if df.empty:
        return []

    df["month"] = pd.to_datetime(df["month"]).dt.to_period("M").dt.to_timestamp()
    wide = df.pivot_table(
        index="month", columns="barangay_name", values="case_count",
        aggfunc="sum", fill_value=0,
    ).sort_index()
    wide = wide.reindex(pd.date_range(wide.index[0], wide.index[-1], freq="MS"), fill_value=0)
    wide = _trim_leading_months(wide)

    jobs = [(name, wide[name].astype(float), forecast_horizon) for name in wide.columns]
    results = parallel_map(forecast_barangay, jobs)

    if ARIMA_COMBINE_CITY and len(wide) >= ARIMA_MIN_HISTORY_NONSEASONAL:
        try:
            city = city_forecast({n: wide[n].values for n in wide.columns}, forecast_horizon)
            for name, result in zip(wide.columns, results):
                _combine_with_city(result, city[name])
        except Exception as e:
            logger.warning(f"City-first forecast failed, keeping per-barangay forecasts: {e}")
    for barangay_name, result in zip(wide.columns, results):
        n_preds = len(result["predictions"])
        logger.info(
            f"Forecast for {barangay_name}: {n_preds} months "
            f"({result['method']})"
        )

    return results


def _combine_with_city(result: dict, city: tuple) -> None:
    """Average a barangay's own forecast with its city-first share, in place."""
    mean, lower, upper = city
    for i, p in enumerate(result["predictions"]):
        if p["yhat"] is None or i >= len(mean):
            continue
        p["yhat"] = max(0.0, (p["yhat"] + float(mean[i])) / 2)
        p["yhat_lower"] = max(0.0, (p["yhat_lower"] + float(lower[i])) / 2)
        p["yhat_upper"] = (p["yhat_upper"] + float(upper[i])) / 2


def compute_trend(series: pd.Series, window: int = 12) -> float:
    """
    Compute recent trend (slope) from last N months.

    Returns:
        Slope per month (positive = increasing trend)
    """
    if len(series) < 2:
        return 0.0

    recent = series.tail(min(window, len(series))).values.astype(float)
    x = np.arange(len(recent))

    if len(x) < 2:
        return 0.0

    # Simple linear regression slope
    slope = np.polyfit(x, recent, 1)[0]
    return float(slope)


def detect_seasonality(series: pd.Series, period: int = 12) -> bool:
    """
    Detect if a series has seasonal pattern.
    Simple check: if autocorrelation at lag = period is > 0.3
    """
    if len(series) < period * 2:
        return False

    try:
        autocorr = series.autocorr(lag=period)
        return bool(autocorr > 0.3)
    except Exception:
        return False


def backtest_mae(
    counts: list[int],
    horizon: int = 6,
    seasonal_m: int = 12,
) -> Optional[float]:
    """
    Time-based backtest: fit on months 1..T-h, predict T+1..T+h, compare.

    NEVER shuffles months — temporal ordering only.

    The holdout shrinks for short series so at least
    ARIMA_MIN_HISTORY_NONSEASONAL months remain for fitting.

    Args:
        counts: Monthly case counts
        horizon: Maximum number of months to hold out for testing
        seasonal_m: Seasonal period (12 for monthly)

    Returns:
        MAE (float) if series is long enough, None otherwise
    """
    horizon = min(horizon, len(counts) - ARIMA_MIN_HISTORY_NONSEASONAL)
    if horizon < 1:
        return None

    train = counts[:-horizon]
    actual = np.asarray(counts[-horizon:], dtype=float)

    try:
        forecast, _, _ = _fit_predict(train, horizon)
        return float(np.mean(np.abs(actual - forecast)))
    except Exception:
        # If ARIMA fails on the train set, score the fallback method instead
        fallback = _fallback_forecast(pd.Series(train, dtype=float), horizon)
        return float(np.mean(np.abs(actual - np.asarray(fallback["forecasted_count"]))))


def _one_step(train) -> tuple[float, str]:
    """
    One-month-ahead forecast for a walk-forward step: (prediction, method).
    The method is recorded so steps that fell back (ARIMA fit failure ->
    seasonal_naive / exponential_smoothing) are transparent instead of
    silently reported as ARIMA metrics.
    """
    try:
        return max(0.0, float(_fit_predict(train, 1)[0][0])), "arima"
    except Exception:
        fallback = _fallback_forecast(pd.Series(train, dtype=float), 1)
        return float(fallback["forecasted_count"][0]), str(fallback.get("method") or "seasonal_naive")


def walk_forward_arima(
    counts: list[int],
    min_train: int = 24,
    seasonal_m: int = 12,
    city_preds: Optional[list[float]] = None,
    shares: Optional[list[float]] = None,
) -> dict:
    """
    Walk-forward evaluation for ARIMA forecasting.

    Trains on months 1..T, predicts month T+1, slides forward.
    Starting from min_train (default 24), produces one prediction per step.

    Args:
        counts: Monthly case counts (full historical series)
        min_train: Minimum months of training before testing starts (default 24)
        seasonal_m: Seasonal period (12 for monthly)
        city_preds / shares: per step, the city-first forecast for the test month
            and this barangay's share of it (see walk_forward_all). When given,
            each prediction is the average of the barangay's own ARIMA and its
            city share, the same combination forecast_all produces.

    Returns:
        {
            "steps": [{"train_size": int, "test_month": int, "actual": float,
                       "predicted": float, "error": float, "method": str}],
            "mae": float,
            "mape": float,             # kept for older readers; WAPE is the headline
            "rmse": float,
            "wape": float,             # sum |error| / sum actual, in %
            "skill": float,            # 1 - mae / baseline_mae (> 0 beats the baseline)
            "n_steps": int,
            "method_counts": {"arima": int, "<fallback_method>": int, ...},
            "baseline_mae": float,   # same steps, forecast = mean of the last 12 months
            "baseline_mape": float,
        }
    """
    if len(counts) <= min_train:
        return {
            "steps": [],
            "mae": None,
            "mape": None,
            "rmse": None,
            "wape": None,
            "skill": None,
            "n_steps": 0,
            "method_counts": {},
            "baseline_mae": None,
            "baseline_mape": None,
        }

    steps = []
    errors = []
    pct_errors = []
    base_errors = []
    base_pct_errors = []

    for i in range(min_train, len(counts)):
        train = counts[:i]
        actual = float(counts[i])

        # Record which model produced each step so evaluations that fall back
        # (ARIMA fit failure -> seasonal_naive / exponential_smoothing) are
        # transparent instead of silently reported as ARIMA metrics.
        predicted, method = _one_step(train)
        if city_preds is not None:
            k = i - min_train
            predicted = max(0.0, (predicted + city_preds[k] * shares[k]) / 2)

        error = abs(actual - predicted)
        errors.append(error)

        # Reference forecast on the same step: plain average of the last
        # 12 months. ARIMA is only worth its complexity where it beats this.
        baseline = float(np.mean(train[-seasonal_m:]))
        base_error = abs(actual - baseline)
        base_errors.append(base_error)

        # MAPE: avoid division by zero
        if actual > 0:
            pct_errors.append(error / actual)
            base_pct_errors.append(base_error / actual)

        steps.append({
            "train_size": len(train),
            "test_month": i + 1,
            "actual": actual,
            "predicted": round(predicted, 2),
            "error": round(error, 2),
            "baseline": round(baseline, 2),
            "method": method,
        })

    mae = round(float(np.mean(errors)), 4) if errors else None
    mape = round(float(np.mean(pct_errors) * 100), 2) if pct_errors else None
    baseline_mae = round(float(np.mean(base_errors)), 4) if base_errors else None
    baseline_mape = round(float(np.mean(base_pct_errors) * 100), 2) if base_pct_errors else None
    rmse = round(float(np.sqrt(np.mean(np.square(errors)))), 4) if errors else None
    total_actual = float(sum(s["actual"] for s in steps))
    wape = round(float(np.sum(errors)) / total_actual * 100, 2) if total_actual > 0 else None
    skill = round(1 - mae / baseline_mae, 4) if mae is not None and baseline_mae else None

    method_counts: dict[str, int] = {}
    for s in steps:
        method_counts[s["method"]] = method_counts.get(s["method"], 0) + 1

    logger.info(
        f"ARIMA walk-forward: {len(steps)} steps, MAE={mae}, MAPE={mape}%, methods={method_counts}"
    )

    return {
        "steps": steps,
        "mae": mae,
        "mape": mape,
        "rmse": rmse,
        "wape": wape,
        "skill": skill,
        "n_steps": len(steps),
        "method_counts": method_counts,
        "baseline_mae": baseline_mae,
        "baseline_mape": baseline_mape,
    }


def _walk_forward_arima_job(
    barangay_name: str,
    counts: list[int],
    min_train: int,
    city_preds: Optional[list[float]] = None,
    shares: Optional[list[float]] = None,
) -> dict:
    """
    Wraps walk_forward_arima for use with parallel_map — same unmodified
    evaluation logic, just run per-barangay across worker processes.

    Every barangay's walk-forward is fully independent (own counts, own
    fits), so this is the same shape of "independent per-item work" that
    forecast_barangay/parallel_map already parallelizes for /forecast.

    Catching the exception HERE (inside the job) rather than letting it
    propagate is what isolates one barangay's failure from the rest: joblib's
    Parallel aborts the whole batch on the first uncaught exception from any
    worker, so a truly failed job must return a normal (error-tagged) result
    instead of raising, or every other barangay's already-good result would
    be lost too.
    """
    try:
        result = walk_forward_arima(counts, min_train=min_train, city_preds=city_preds, shares=shares)
        result["barangay_name"] = barangay_name
        result["error"] = None
        return result
    except Exception as e:
        logger.warning(f"Walk-forward ARIMA failed for {barangay_name}: {e}")
        return {
            "barangay_name": barangay_name,
            "error": str(e),
            "steps": [],
            "mae": None,
            "mape": None,
            "n_steps": 0,
            "method_counts": {},
        }


def walk_forward_all(counts_by_name: dict, min_train: int) -> dict:
    """
    Walk-forward evaluation of the forecast exactly as forecast_all produces it.

    All series must share one calendar (forecast_all's dense, zero-filled frame).
    With ARIMA_COMBINE_CITY the city-wide total gets its own walk-forward first
    (one fit per test month), and each barangay's step is then scored on the
    average of its own ARIMA and its share of that city forecast, the share
    taken from the months before the test month only.

    Returns {barangay_name: _walk_forward_arima_job result}.
    """
    names = list(counts_by_name)
    n = len(counts_by_name[names[0]]) if names else 0
    city_preds, shares = None, {}
    if ARIMA_COMBINE_CITY and n > min_train:
        city = np.sum([np.asarray(counts_by_name[b], dtype=float) for b in names], axis=0)
        city_preds = [_one_step(city[:i])[0] for i in range(min_train, n)]
        share_by_step = [city_shares(counts_by_name, i) for i in range(min_train, n)]
        shares = {b: [s[b] for s in share_by_step] for b in names}

    jobs = [(b, list(counts_by_name[b]), min_train, city_preds, shares.get(b)) for b in names]
    return dict(zip(names, parallel_map(_walk_forward_arima_job, jobs)))
