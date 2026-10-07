"""
TBInsight ML Service — API Routes

Endpoints aligned with Plan 02 spec contracts:
  POST /thresholds — compute tertile/Jenks cut points
  POST /forecast   — ARIMA forecasting with backtest_mae
  POST /classify   — RF train + predict with proba
  GET  /health     — service health check

ARIMA forecasting (/forecast) and RF risk classification (/classify) are
independent endpoints by design — the orchestrator (BACKEND/tbinsight/
pipeline.js) calls them separately and neither's success or output is
required by the other. There used to be a combined POST /pipeline endpoint
that built its own RF feature vector directly from an ARIMA forecast
(coupling RF to ARIMA); it was never called by the Express backend and has
been removed rather than fixed, since a working combined endpoint would
reintroduce the exact ARIMA→RF dependency the architecture must not have.
"""

import hmac
import logging

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Header, Depends

from config import ARIMA_MIN_HISTORY_NONSEASONAL, ML_API_KEY, MODEL_VERSION, RF_MIN_TRAIN_ROWS
from models import (
    ClassifyRequest,
    ClassifyResponse,
    ClassifyOut,
    ClassifyProba,
    ForecastRequest,
    ForecastResponse,
    ForecastOut,
    PredictionPoint,
    HealthResponse,
    ThresholdRequest,
    ThresholdResponse,
    EvaluateRequest,
    EvaluateResponse,
    ArimaEvaluation,
    ArimaStep,
    RfEvaluation,
    RfStep,
)
from arima_forecast import parallel_map, forecast_all, compute_trend, detect_seasonality, backtest_mae, walk_forward_arima, _walk_forward_arima_job
from rf_classifier import (
    train_and_predict,
    classify_risk_simple,
    walk_forward_rf,
    FEATURES,
)
from thresholds import compute_thresholds

logger = logging.getLogger(__name__)
router = APIRouter()


def verify_api_key(x_api_key: str = Header(...)):
    """Verify ML API key from request header (constant-time comparison)."""
    if not hmac.compare_digest(x_api_key, ML_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing ML API key")


# ==================== GET /health ====================

@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        service="tb-insight-ml",
        version=MODEL_VERSION,
    )


# ==================== POST /thresholds ====================

# The model endpoints below are plain `def`, not `async def`: their work is CPU-bound
# (ARIMA / Random Forest fits), and FastAPI runs a plain `def` endpoint in a worker
# thread. As `async def` they ran on the event loop and blocked it, so /health stopped
# answering during a forecast and the backend reported the service as down.

@router.post("/thresholds", response_model=ThresholdResponse, dependencies=[Depends(verify_api_key)])
def compute_risk_thresholds(req: ThresholdRequest):
    """
    Compute risk band thresholds from incidence data.

    Accepts a list of incidence per 100k values and returns
    tertile or Jenks cut points for Low/Medium/High classification.
    """
    try:
        if not req.incidences:
            raise HTTPException(status_code=400, detail="No incidence data provided")

        result = compute_thresholds(req.incidences, method=req.method)
        return ThresholdResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Threshold computation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Threshold computation failed. See the ML service log for details.")


# ==================== POST /forecast ====================

@router.post("/forecast", response_model=ForecastResponse, dependencies=[Depends(verify_api_key)])
def run_forecast(req: ForecastRequest):
    """
    Run ARIMA forecasting on time series data.

    Returns per-barangay forecasts with backtest MAE.
    """
    try:
        series_data = [pt.model_dump() for pt in req.series]

        if not series_data:
            raise HTTPException(status_code=400, detail="No series data provided")

        horizon = req.forecast_horizon
        forecasts_raw = forecast_all(series_data, forecast_horizon=horizon)

        # Compute backtest MAE per barangay
        # Group counts by barangay
        df = pd.DataFrame(series_data)
        df["month"] = pd.to_datetime(df["month"])

        # Backtest MAE per barangay (temporal, no shuffle), fitted in parallel
        counts_by_name = {}
        for fc in forecasts_raw:
            name = fc["barangay_name"]
            barangay_df = df[df["barangay_name"] == name].sort_values("month")
            # Fill missing months with 0 so the backtest sees the same series as the forecast
            counts_by_name[name] = (
                barangay_df.set_index("month")["case_count"].resample("MS").sum().tolist()
            )
        names = list(counts_by_name)
        maes = dict(zip(names, parallel_map(
            backtest_mae, [(counts_by_name[n], 6, req.seasonal_m) for n in names]
        )))

        forecast_outs = []
        for fc in forecasts_raw:
            name = fc["barangay_name"]
            mae = maes[name]

            # Build prediction points — one per forecast month
            points = []
            for pt in fc.get("predictions", []):
                points.append(PredictionPoint(
                    month=pt["month"],
                    yhat=pt["yhat"],
                    yhat_lower=pt["yhat_lower"],
                    yhat_upper=pt["yhat_upper"],
                ))

            forecast_outs.append(ForecastOut(
                barangay_name=name,
                method=fc["method"],
                backtest_mae=mae,
                predictions=points,
            ))

        return ForecastResponse(
            forecasts=forecast_outs,
            model_version=MODEL_VERSION,
            barangays_forecasted=len(forecast_outs),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Forecast error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Forecast failed. See the ML service log for details.")


# ==================== POST /classify ====================

@router.post("/classify", response_model=ClassifyResponse, dependencies=[Depends(verify_api_key)])
def run_classify(req: ClassifyRequest):
    """
    Train RF on training data and predict risk classes.

    Training rows include features + observed incidence (label is derived).
    Prediction rows include features only.
    """
    try:
        if not req.predict:
            raise HTTPException(status_code=400, detail="No prediction rows provided")

        low_max = req.thresholds.low_max
        med_max = req.thresholds.med_max

        # Convert train rows to dict format
        train = [{"features": r.features, "incidence": r.incidence, "month": r.month} for r in req.train]

        # Convert predict rows to dict format
        predict = [{"barangay_name": r.barangay_name, "features": r.features} for r in req.predict]

        # Train the RF only with enough rows; otherwise classify by the incidence thresholds.
        # (classify_risk_simple reads a flat feature dict, so merge the name and features.)
        if len(train) >= RF_MIN_TRAIN_ROWS:
            method = "random_forest"
            preds = train_and_predict(train, predict, low_max, med_max)
        else:
            method = "rule_based"
            preds = classify_risk_simple(
                [{"barangay_name": p["barangay_name"], **p["features"]} for p in predict],
                {"low_max": low_max, "med_max": med_max},
            )

        # Convert to response models
        classifications = [
            ClassifyOut(
                barangay_name=p["barangay_name"],
                risk_class=p["risk_class"],
                proba=ClassifyProba(**p["proba"]),
            )
            for p in preds
        ]

        return ClassifyResponse(
            predictions=classifications,
            model_version=MODEL_VERSION,
            method=method,
            n_train=len(train),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Classification error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Classification failed. See the ML service log for details.")


# ==================== POST /evaluate ====================

@router.post("/evaluate", response_model=EvaluateResponse, dependencies=[Depends(verify_api_key)])
def evaluate_models(req: EvaluateRequest):
    """
    Walk-forward evaluation for both ARIMA and RF models.

    - ARIMA: trains on months 1..T, predicts T+1, slides forward from month 25
    - RF: trains on all barangay-months before T, predicts month T (Option C)

    Returns aggregated metrics (MAE/MAPE for ARIMA, accuracy/F1 for RF)
    plus per-step details.
    """
    try:
        if not req.series:
            raise HTTPException(status_code=400, detail="No series data provided")

        # ── ARIMA walk-forward per barangay ──
        df = pd.DataFrame([pt.model_dump() for pt in req.series])
        df["month"] = pd.to_datetime(df["month"])

        # Each barangay's walk-forward is fully independent (own counts, own
        # fits) — run them across worker processes the same way /forecast
        # already parallelizes forecast_barangay, instead of one at a time.
        # _walk_forward_arima_job catches its own exceptions so one
        # barangay's failure can't abort every other (already-good) result.
        jobs = []
        for name in df["barangay_name"].unique():
            barangay_df = df[df["barangay_name"] == name].sort_values("month")
            counts = barangay_df["case_count"].tolist()
            # Shorter series get a proportionally smaller warm-up so they can still be evaluated
            min_train = min(req.min_train, max(ARIMA_MIN_HISTORY_NONSEASONAL, len(counts) // 2))
            if len(counts) > min_train:
                jobs.append((name, counts, min_train))

        raw_results = parallel_map(_walk_forward_arima_job, jobs)
        arima_results = [r for r in raw_results if r.get("error") is None]
        failed_barangays = [
            {"barangay_name": r["barangay_name"], "error": r["error"]}
            for r in raw_results if r.get("error") is not None
        ]
        if failed_barangays:
            logger.warning(f"ARIMA walk-forward failed for {len(failed_barangays)} barangay(s): {failed_barangays}")

        # Aggregate ARIMA results: use the mean across barangays. Both the
        # mean and the method_counts sum below are order-independent, so
        # running the jobs in parallel (arbitrary completion order) cannot
        # change these numbers versus the previous serial loop.
        if arima_results:
            all_mae = [r["mae"] for r in arima_results if r["mae"] is not None]
            all_mape = [r["mape"] for r in arima_results if r["mape"] is not None]
            all_base_mae = [r["baseline_mae"] for r in arima_results if r.get("baseline_mae") is not None]
            all_base_mape = [r["baseline_mape"] for r in arima_results if r.get("baseline_mape") is not None]
            # Use the first (longest) barangay's steps for detailed output
            longest = max(arima_results, key=lambda r: r["n_steps"])
            # Steps per method across ALL barangays: shows how much of the
            # reported MAE/MAPE came from real ARIMA fits vs fallback models.
            method_counts: dict[str, int] = {}
            for r in arima_results:
                for m, c in (r.get("method_counts") or {}).items():
                    method_counts[m] = method_counts.get(m, 0) + c
            arima_eval = ArimaEvaluation(
                mae=round(float(np.mean(all_mae)), 4) if all_mae else None,
                mape=round(float(np.mean(all_mape)), 2) if all_mape else None,
                n_steps=longest["n_steps"],
                steps=[ArimaStep(**s) for s in longest["steps"]],
                example_barangay=longest["barangay_name"],
                method_counts=method_counts,
                failed_barangays=failed_barangays,
                baseline_mae=round(float(np.mean(all_base_mae)), 4) if all_base_mae else None,
                baseline_mape=round(float(np.mean(all_base_mape)), 2) if all_base_mape else None,
            )
        else:
            arima_eval = ArimaEvaluation(failed_barangays=failed_barangays)

        # ── RF walk-forward ──
        n_barangays = len(df["barangay_name"].unique())
        train = [{"features": r.features, "incidence": r.incidence, "month": r.month} for r in req.train]
        # min_train is in MONTHS; walk_forward_rf counts rows (one per barangay per month).
        # Cap the warm-up at half the available months so short histories can be evaluated.
        n_months = len(train) // max(n_barangays, 1)
        rf_min_train = min(req.min_train, max(2, n_months // 2)) * max(n_barangays, 1)
        rf_result = walk_forward_rf(
            train,
            min_train=rf_min_train,
            low_max=req.thresholds.low_max,
            med_max=req.thresholds.med_max,
            n_barangays=n_barangays,
        )

        rf_eval = RfEvaluation(
            accuracy=rf_result["accuracy"],
            f1_macro=rf_result["f1_macro"],
            precision=rf_result["precision"],
            recall=rf_result["recall"],
            confusion_matrix=rf_result["confusion_matrix"],
            n_steps=rf_result["n_steps"],
            steps=[RfStep(**s) for s in rf_result["steps"]],
            baseline_accuracy=rf_result.get("baseline_accuracy"),
            baseline_f1_macro=rf_result.get("baseline_f1_macro"),
        )

        return EvaluateResponse(
            arima=arima_eval,
            rf=rf_eval,
            model_version=MODEL_VERSION,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Evaluation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Evaluation failed. See the ML service log for details.")
