"""
TBInsight ML Service — API Routes

Endpoints aligned with Plan 02 spec contracts:
  POST /thresholds — compute tertile/Jenks cut points
  POST /forecast   — ARIMA forecasting with backtest_mae
  POST /classify   — RF train + predict with proba
  POST /pipeline   — combined forecast + classify
  GET  /health     — service health check
"""

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
    PipelineRequest,
    PipelineResponse,
    PipelineForecast,
    PipelineClassification,
    ThresholdRequest,
    ThresholdResponse,
    EvaluateRequest,
    EvaluateResponse,
    ArimaEvaluation,
    ArimaStep,
    RfEvaluation,
    RfStep,
)
from arima_forecast import parallel_map, forecast_all, compute_trend, detect_seasonality, backtest_mae, walk_forward_arima
from rf_classifier import (
    train_and_predict,
    classify_risk_simple,
    compute_incidence,
    walk_forward_rf,
    FEATURES,
)
from thresholds import compute_thresholds

logger = logging.getLogger(__name__)
router = APIRouter()


def verify_api_key(x_api_key: str = Header(...)):
    """Verify ML API key from request header."""
    if x_api_key != ML_API_KEY:
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

@router.post("/thresholds", response_model=ThresholdResponse, dependencies=[Depends(verify_api_key)])
async def compute_risk_thresholds(req: ThresholdRequest):
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
        raise HTTPException(status_code=500, detail=f"Threshold computation failed: {str(e)}")


# ==================== POST /forecast ====================

@router.post("/forecast", response_model=ForecastResponse, dependencies=[Depends(verify_api_key)])
async def run_forecast(req: ForecastRequest):
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
        raise HTTPException(status_code=500, detail=f"Forecast failed: {str(e)}")


# ==================== POST /classify ====================

@router.post("/classify", response_model=ClassifyResponse, dependencies=[Depends(verify_api_key)])
async def run_classify(req: ClassifyRequest):
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
        train = [{"features": r.features, "incidence": r.incidence} for r in req.train]

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
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")


# ==================== POST /pipeline ====================

@router.post("/pipeline", response_model=PipelineResponse, dependencies=[Depends(verify_api_key)])
async def run_pipeline(req: PipelineRequest):
    """
    Full pipeline: ARIMA forecast → classification.
    Processes one barangay at a time.

    If `train` data is provided, uses RF classification.
    Otherwise, falls back to rule-based threshold classification.
    """
    try:
        if not req.series:
            raise HTTPException(status_code=400, detail="No series data provided")

        series_data = [pt.model_dump() for pt in req.series]

        # Validate all records belong to the same barangay
        barangay_names = {pt.barangay_name for pt in req.series}
        if len(barangay_names) > 1:
            raise HTTPException(
                status_code=400,
                detail=f"Pipeline endpoint requires single-barangay input. Got {len(barangay_names)} barangays: {', '.join(sorted(barangay_names))}"
            )
        barangay_name = series_data[0]["barangay_name"]

        # Step 1: ARIMA forecasting
        forecasts = forecast_all(series_data, forecast_horizon=1)
        if not forecasts:
            raise HTTPException(status_code=400, detail="No forecasts generated")

        forecast = forecasts[0]

        # Step 2: Build features for classification
        pop = req.population.get(barangay_name, 1000)

        df = pd.DataFrame(series_data)
        df["month"] = pd.to_datetime(df["month"])
        df = df.sort_values("month").set_index("month")
        ts = df["case_count"].resample("MS").sum().fillna(0)

        recent_trend = compute_trend(ts)
        seasonality_flag = 1 if detect_seasonality(ts) else 0

        forecasted = forecast["predictions"][0]["yhat"] if forecast["predictions"] else 0
        pop_density = compute_incidence(forecasted, pop)
        hist_bias = req.historical_bias.get(barangay_name, 0.0)
        neighbor_risk = req.neighbor_risk.get(barangay_name, 0.0)

        # Build features matching the 8-feature RF schema
        # Express pipeline sends lag_1m/2m/3m in predict rows,
        # but we compute them here as fallback from the time series
        lag_1m, lag_2m, lag_3m = 0.0, 0.0, 0.0
        if len(ts) >= 3:
            lag_1m = float(ts.iloc[-1])
            lag_2m = float(ts.iloc[-2])
            lag_3m = float(ts.iloc[-3])
        elif len(ts) >= 1:
            lag_1m = float(ts.iloc[-1])

        feature = {
            "barangay_name": barangay_name,
            "forecasted_incidence": pop_density,
            "recent_trend": recent_trend,
            "seasonality_flag": seasonality_flag,
            "lag_1m": lag_1m,
            "lag_2m": lag_2m,
            "lag_3m": lag_3m,
            "neighbor_risk": neighbor_risk,
            "historical_bias": hist_bias,
        }

        # Step 3: Classification
        # Use thresholds from request, or PLACEHOLDER defaults
        if req.thresholds:
            low_max = req.thresholds.low_max
            med_max = req.thresholds.med_max
        else:
            from config import TERTILE_THRESHOLDS
            low_max = TERTILE_THRESHOLDS["tertile_low_max"]
            med_max = TERTILE_THRESHOLDS["tertile_high_min"]

        thresholds_dict = {"low_max": low_max, "med_max": med_max}

        if req.train:
            # RF classification with training data
            train = [{"features": r.features, "incidence": r.incidence} for r in req.train]
            predict = [{"barangay_name": barangay_name, "features": feature}]
            preds = train_and_predict(train, predict, low_max, med_max)
            risk_class = preds[0] if preds else classify_risk_simple([feature], thresholds_dict)[0]
        else:
            # Rule-based fallback (no training data)
            risk_class = classify_risk_simple([feature], thresholds_dict)[0]

        first_pred = forecast["predictions"][0] if forecast["predictions"] else {"yhat": 0, "yhat_lower": 0, "yhat_upper": 0}
        return PipelineResponse(
            forecast=PipelineForecast(
                barangay_name=forecast["barangay_name"],
                period=forecast["period"],
                forecasted_count=first_pred["yhat"],
                confidence_lower=first_pred["yhat_lower"],
                confidence_upper=first_pred["yhat_upper"],
                method=forecast["method"],
            ),
            classification=PipelineClassification(
                barangay_name=risk_class["barangay_name"],
                risk_class=risk_class["risk_class"],
                incidence_per_100k=pop_density,
            ),
            model_version=MODEL_VERSION,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")


# ==================== POST /evaluate ====================

@router.post("/evaluate", response_model=EvaluateResponse, dependencies=[Depends(verify_api_key)])
async def evaluate_models(req: EvaluateRequest):
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

        # Use the longest barangay series for ARIMA walk-forward
        # (or we could average across barangays — using longest for now)
        arima_results = []
        for name in df["barangay_name"].unique():
            barangay_df = df[df["barangay_name"] == name].sort_values("month")
            counts = barangay_df["case_count"].tolist()
            # Shorter series get a proportionally smaller warm-up so they can still be evaluated
            min_train = min(req.min_train, max(ARIMA_MIN_HISTORY_NONSEASONAL, len(counts) // 2))
            if len(counts) > min_train:
                result = walk_forward_arima(counts, min_train=min_train)
                arima_results.append(result)

        # Aggregate ARIMA results: use the mean across barangays
        if arima_results:
            all_mae = [r["mae"] for r in arima_results if r["mae"] is not None]
            all_mape = [r["mape"] for r in arima_results if r["mape"] is not None]
            # Use the first (longest) barangay's steps for detailed output
            longest = max(arima_results, key=lambda r: r["n_steps"])
            arima_eval = ArimaEvaluation(
                mae=round(float(np.mean(all_mae)), 4) if all_mae else None,
                mape=round(float(np.mean(all_mape)), 2) if all_mape else None,
                n_steps=longest["n_steps"],
                steps=[ArimaStep(**s) for s in longest["steps"]],
            )
        else:
            arima_eval = ArimaEvaluation()

        # ── RF walk-forward ──
        n_barangays = len(df["barangay_name"].unique())
        train = [{"features": r.features, "incidence": r.incidence} for r in req.train]
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
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")
