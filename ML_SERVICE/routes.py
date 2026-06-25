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
from fastapi import APIRouter, HTTPException

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
)
from arima_forecast import forecast_all, compute_trend, detect_seasonality, backtest_mae
from rf_classifier import (
    train_and_predict,
    classify_risk_simple,
    compute_incidence,
    FEATURES,
)
from thresholds import compute_thresholds
from config import MODEL_VERSION

logger = logging.getLogger(__name__)
router = APIRouter()


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

@router.post("/thresholds", response_model=ThresholdResponse)
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

@router.post("/forecast", response_model=ForecastResponse)
async def run_forecast(req: ForecastRequest):
    """
    Run ARIMA forecasting on time series data.

    Returns per-barangay forecasts with backtest MAE.
    """
    try:
        series_data = [pt.model_dump() for pt in req.series]

        if not series_data:
            raise HTTPException(status_code=400, detail="No series data provided")

        forecasts_raw = forecast_all(series_data, forecast_horizon=1)

        # Compute backtest MAE per barangay
        # Group counts by barangay
        df = pd.DataFrame(series_data)
        df["month"] = pd.to_datetime(df["month"])

        forecast_outs = []
        for fc in forecasts_raw:
            name = fc["barangay_name"]
            barangay_df = df[df["barangay_name"] == name].sort_values("month")
            counts = barangay_df["case_count"].tolist()

            # Compute backtest MAE (temporal, no shuffle)
            mae = backtest_mae(counts, horizon=6, seasonal_m=req.seasonal_m)

            # Build prediction points
            period = fc["period"]
            points = [PredictionPoint(
                month=period,
                yhat=fc["forecasted_count"],
                yhat_lower=fc["confidence_lower"],
                yhat_upper=fc["confidence_upper"],
            )]

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

@router.post("/classify", response_model=ClassifyResponse)
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

        # Train RF and predict
        if train:
            preds = train_and_predict(train, predict, low_max, med_max)
        else:
            # No training data — fall back to rule-based classification
            preds = classify_risk_simple(predict, {"low_max": low_max, "med_max": med_max})

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
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Classification error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")


# ==================== POST /pipeline ====================

@router.post("/pipeline", response_model=PipelineResponse)
async def run_pipeline(req: PipelineRequest):
    """
    Full pipeline: ARIMA forecast → RF classification.
    Processes one barangay at a time.
    """
    try:
        if not req.series:
            raise HTTPException(status_code=400, detail="No series data provided")

        series_data = [pt.model_dump() for pt in req.series]
        barangay_name = series_data[0]["barangay_name"]

        # Step 1: ARIMA forecasting
        forecasts = forecast_all(series_data, forecast_horizon=1)
        if not forecasts:
            raise HTTPException(status_code=400, detail="No forecasts generated")

        forecast = forecasts[0]

        # Step 2: Build features for RF
        pop = req.population.get(barangay_name, 1000)

        df = pd.DataFrame(series_data)
        df["month"] = pd.to_datetime(df["month"])
        df = df.sort_values("month").set_index("month")
        ts = df["case_count"].resample("MS").sum().fillna(0)

        recent_trend = compute_trend(ts)
        seasonality_flag = 1 if detect_seasonality(ts) else 0

        forecasted = forecast["forecasted_count"]
        pop_density = compute_incidence(forecasted, pop)
        hist_bias = req.historical_bias.get(barangay_name, 0.0)
        neighbor_risk = req.neighbor_risk.get(barangay_name, 0.0)

        # Use forecasted_incidence (incidence per 100k) for the feature
        feature = {
            "barangay_name": barangay_name,
            "forecasted_incidence": pop_density,
            "recent_trend": recent_trend,
            "seasonality_flag": seasonality_flag,
            "population_density": pop_density,
            "neighbor_risk": neighbor_risk,
            "historical_bias": hist_bias,
        }

        # Step 3: RF classification (rule-based in pipeline mode — no training data)
        # Pipeline doesn't carry training data; use rule-based fallback
        from config import TERTILE_THRESHOLDS
        risk_class = classify_risk_simple(
            [feature],
            {"low_max": TERTILE_THRESHOLDS["tertile_low_max"],
             "med_max": TERTILE_THRESHOLDS["tertile_high_min"]}
        )[0]

        return PipelineResponse(
            forecast=PipelineForecast(
                barangay_name=forecast["barangay_name"],
                period=forecast["period"],
                forecasted_count=forecast["forecasted_count"],
                confidence_lower=forecast["confidence_lower"],
                confidence_upper=forecast["confidence_upper"],
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
