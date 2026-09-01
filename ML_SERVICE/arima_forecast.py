"""
TBInsight ML Service — ARIMA Forecasting

Per-barangay time-series forecasting using pmdarima (auto_arima).
Fallback to seasonal-naive or exponential smoothing for sparse/short series.

Design spec:
  - ARIMA per barangay with seasonal=True, m=12 (monthly, annual seasonality)
  - Fallback for series < 24 months or > 50% zeros
  - Returns forecasted_count + confidence intervals
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd
from pmdarima import auto_arima

from config import (
    ARIMA_MIN_HISTORY,
    ARIMA_SEASONAL_PERIOD,
    ARIMA_SPARSE_THRESHOLD,
    MODEL_VERSION,
)

logger = logging.getLogger(__name__)


def _needs_fallback(series: pd.Series) -> bool:
    """Determine if a series should use fallback instead of ARIMA."""
    # Too short for ARIMA
    if len(series) < ARIMA_MIN_HISTORY:
        logger.info(f"Series too short ({len(series)} < {ARIMA_MIN_HISTORY}), using fallback")
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

        model = SimpleExpSmoothing(series.values.astype(float))
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


def _arima_forecast(series: pd.Series, forecast_horizon: int = 1) -> dict:
    """Run ARIMA forecast using pmdarima auto_arima."""
    try:
        model = auto_arima(
            series.values.astype(float),
            seasonal=True,
            m=ARIMA_SEASONAL_PERIOD,
            stepwise=True,
            suppress_warnings=True,
            error_action="ignore",
            max_order=8,
            trace=False,
        )

        forecast, conf_int = model.predict(
            n_periods=forecast_horizon,
            return_conf_int=True,
            alpha=0.05,  # 95% confidence interval
        )

        return {
            "forecasted_count": [max(0, float(v)) for v in forecast],
            "confidence_lower": [max(0, float(c[0])) for c in conf_int],
            "confidence_upper": [float(c[1]) for c in conf_int],
            "method": "arima",
        }
    except Exception as e:
        logger.warning(f"ARIMA failed, falling back to exponential_smoothing: {e}")
        return _exponential_smoothing_forecast(series, forecast_horizon)


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

    # Choose method based on series characteristics
    if _needs_fallback(series):
        result = _seasonal_naive_forecast(series, forecast_horizon)
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


def forecast_all(
    series_data: list[dict],
    forecast_horizon: int = 1,
) -> list[dict]:
    """
    Forecast all barangays from time series data.

    Args:
        series_data: List of dicts with barangay_name, month, case_count
        forecast_horizon: Number of months to forecast

    Returns:
        List of forecast results per barangay
    """
    # Convert to DataFrame
    df = pd.DataFrame(series_data)
    if df.empty:
        return []

    # Parse month column
    df["month"] = pd.to_datetime(df["month"])

    results = []
    grouped = df.groupby("barangay_name")

    for barangay_name, group in grouped:
        # Sort by month and set as index
        group_sorted = group.sort_values("month").set_index("month")
        ts = group_sorted["case_count"]

        # Resample to monthly frequency (fill missing months with 0)
        ts = ts.resample("MS").sum().fillna(0)

        result = forecast_barangay(barangay_name, ts, forecast_horizon)
        results.append(result)
        n_preds = len(result["predictions"])
        logger.info(
            f"Forecast for {barangay_name}: {n_preds} months "
            f"({result['method']})"
        )

    return results


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

    Args:
        counts: Monthly case counts
        horizon: Number of months to hold out for testing
        seasonal_m: Seasonal period (12 for monthly)

    Returns:
        MAE (float) if series is long enough, None otherwise
    """
    if len(counts) <= horizon + seasonal_m:
        return None

    train = counts[:-horizon]
    actual = np.asarray(counts[-horizon:], dtype=float)

    try:
        model = auto_arima(
            train,
            seasonal=True,
            m=seasonal_m,
            stepwise=True,
            suppress_warnings=True,
            error_action="ignore",
            max_order=8,
            trace=False,
        )
        forecast = model.predict(n_periods=horizon)
        forecast = np.asarray(forecast, dtype=float)
        return float(np.mean(np.abs(actual - forecast)))
    except Exception:
        # If ARIMA fails on train set, try seasonal naive
        if len(train) >= seasonal_m:
            season = np.asarray(train[-seasonal_m:], dtype=float)
            forecast = np.array([season[i % seasonal_m] for i in range(horizon)])
            return float(np.mean(np.abs(actual - forecast)))
        return None


def walk_forward_arima(
    counts: list[int],
    min_train: int = 24,
    seasonal_m: int = 12,
) -> dict:
    """
    Walk-forward evaluation for ARIMA forecasting.

    Trains on months 1..T, predicts month T+1, slides forward.
    Starting from min_train (default 24), produces one prediction per step.

    Args:
        counts: Monthly case counts (full historical series)
        min_train: Minimum months of training before testing starts (default 24)
        seasonal_m: Seasonal period (12 for monthly)

    Returns:
        {
            "steps": [{"train_size": int, "test_month": int, "actual": float, "predicted": float, "error": float}],
            "mae": float,
            "mape": float,
            "n_steps": int,
        }
    """
    if len(counts) <= min_train:
        return {
            "steps": [],
            "mae": None,
            "mape": None,
            "n_steps": 0,
        }

    steps = []
    errors = []
    pct_errors = []

    for i in range(min_train, len(counts)):
        train = counts[:i]
        actual = float(counts[i])

        try:
            model = auto_arima(
                train,
                seasonal=True,
                m=seasonal_m,
                stepwise=True,
                suppress_warnings=True,
                error_action="ignore",
                max_order=8,
                trace=False,
            )
            predicted = float(model.predict(n_periods=1)[0])
        except Exception:
            # Fallback: seasonal naive (repeat last year's value for this month)
            if len(train) >= seasonal_m:
                predicted = float(train[-seasonal_m])
            else:
                predicted = float(train[-1]) if train else 0.0

        error = abs(actual - predicted)
        errors.append(error)

        # MAPE: avoid division by zero
        if actual > 0:
            pct_errors.append(error / actual)

        steps.append({
            "train_size": len(train),
            "test_month": i + 1,
            "actual": actual,
            "predicted": round(predicted, 2),
            "error": round(error, 2),
        })

    mae = round(float(np.mean(errors)), 4) if errors else None
    mape = round(float(np.mean(pct_errors) * 100), 2) if pct_errors else None

    logger.info(
        f"ARIMA walk-forward: {len(steps)} steps, MAE={mae}, MAPE={mape}%"
    )

    return {
        "steps": steps,
        "mae": mae,
        "mape": mape,
        "n_steps": len(steps),
    }
