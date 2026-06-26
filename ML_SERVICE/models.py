"""
TBInsight ML Service — Pydantic Models

Request/response schemas aligned with Plan 02 spec contracts.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


# ==================== /thresholds ====================

class ThresholdRequest(BaseModel):
    """Request body for threshold computation."""
    incidences: list[float] = Field(
        ..., description="Incidence per 100k values across all barangays"
    )
    method: Literal["tertile", "jenks"] = Field(
        default="tertile",
        description="Threshold computation method"
    )


class ThresholdResponse(BaseModel):
    """Response from threshold computation endpoint."""
    method: str
    low_max: float
    med_max: float


# ==================== /forecast ====================

class SeriesPoint(BaseModel):
    """Single data point for ARIMA input."""
    barangay_name: str = Field(..., description="Barangay name")
    month: str = Field(..., description="Month in YYYY-MM-DD format")
    case_count: int = Field(..., ge=0, description="Number of TB cases")


class ForecastRequest(BaseModel):
    """Request body for ARIMA forecasting."""
    seasonal_m: int = Field(default=12, description="Seasonal period (12 for monthly)")
    series: list[SeriesPoint] = Field(
        ..., description="Monthly case counts per barangay"
    )


class PredictionPoint(BaseModel):
    """Single forecast point."""
    month: str
    yhat: float
    yhat_lower: float
    yhat_upper: float


class ForecastOut(BaseModel):
    """Forecast result for one barangay."""
    barangay_name: str
    method: str
    backtest_mae: Optional[float] = Field(
        default=None,
        description="Backtest MAE (null if series too short)"
    )
    predictions: list[PredictionPoint]


class ForecastResponse(BaseModel):
    """Response from forecasting endpoint."""
    forecasts: list[ForecastOut]
    model_version: str
    barangays_forecasted: int


# ==================== /classify ====================

class Thresholds(BaseModel):
    """Frozen threshold cut points."""
    low_max: float
    med_max: float


class TrainRow(BaseModel):
    """Training row for RF: features + observed incidence for label generation."""
    features: dict = Field(
        ..., description="Feature vector: forecasted_incidence, recent_trend, "
        "seasonality_flag, population_density, neighbor_risk, historical_bias"
    )
    incidence: float = Field(
        ..., description="Observed incidence per 100k (used to derive label)"
    )


class PredictRow(BaseModel):
    """Prediction row: features only (no label)."""
    barangay_name: str
    features: dict


class ClassifyRequest(BaseModel):
    """Request body for RF classification."""
    thresholds: Thresholds
    train: list[TrainRow] = Field(
        ..., description="Training rows with labels derived from incidence"
    )
    predict: list[PredictRow] = Field(
        ..., description="Prediction rows (unlabeled)"
    )


class ClassifyProba(BaseModel):
    """Probability distribution over risk classes."""
    Low: float = Field(default=0.0, ge=0, le=1)
    Medium: float = Field(default=0.0, ge=0, le=1)
    High: float = Field(default=0.0, ge=0, le=1)


class ClassifyOut(BaseModel):
    """Classification result for one barangay."""
    barangay_name: str
    risk_class: str = Field(..., description="Low, Medium, or High")
    proba: ClassifyProba


class ClassifyResponse(BaseModel):
    """Response from classification endpoint."""
    predictions: list[ClassifyOut]
    model_version: str


# ==================== /pipeline ====================

class PipelineSeriesPoint(BaseModel):
    """Data point for pipeline input."""
    barangay_name: str
    month: str
    case_count: int = Field(..., ge=0)


class PipelineRequest(BaseModel):
    """Request body for full pipeline (forecast + classify).

    Express passes all pre-computed data; Python never reads the DB.
    """
    series: list[PipelineSeriesPoint] = Field(
        ..., description="Historical monthly case counts"
    )
    population: dict[str, int] = Field(
        ..., description="Population per barangay"
    )
    population_density: dict[str, float] = Field(
        default_factory=dict,
        description="Population density per barangay"
    )
    neighbor_risk: dict[str, float] = Field(
        default_factory=dict,
        description="Pre-computed neighbor risk scores per barangay (0-1)"
    )
    historical_bias: dict[str, float] = Field(
        default_factory=dict,
        description="Past ARIMA forecast errors per barangay (Approach B)"
    )


class PipelineForecast(BaseModel):
    """Forecast result in pipeline response."""
    barangay_name: str
    period: str
    forecasted_count: float = Field(..., ge=0)
    confidence_lower: float = Field(..., ge=0)
    confidence_upper: float = Field(..., ge=0)
    method: str


class PipelineClassification(BaseModel):
    """Classification result in pipeline response."""
    barangay_name: str
    risk_class: str
    incidence_per_100k: float = Field(..., ge=0)


class PipelineResponse(BaseModel):
    """Response from full pipeline endpoint."""
    forecast: PipelineForecast
    classification: PipelineClassification
    model_version: str


# ==================== /health ====================

class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "ok"
    service: str = "tb-insight-ml"
    version: str
    models: dict[str, str] = Field(
        default_factory=lambda: {
            "arima": "pmdarima auto_arima",
            "rf": "scikit-learn RandomForestClassifier",
        }
    )
