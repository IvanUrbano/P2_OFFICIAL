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
    forecast_horizon: int = Field(
        default=1, ge=1, le=24,
        description="Number of months to forecast ahead (1-24)"
    )
    series: list[SeriesPoint] = Field(
        ..., description="Monthly case counts per barangay"
    )


class PredictionPoint(BaseModel):
    """Single forecast point. yhat/yhat_lower/yhat_upper are null when the
    series has insufficient history (< ARIMA_MIN_HISTORY_NONSEASONAL months)
    — the month is still reported so callers know a period was assessed."""
    month: str
    yhat: Optional[float] = None
    yhat_lower: Optional[float] = None
    yhat_upper: Optional[float] = None


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
        ..., description="Feature vector: rolling_12m_incidence, recent_trend, "
        "seasonality_flag, lag_1m, lag_2m, lag_3m, neighbor_risk, historical_bias"
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
    method: str = Field(
        default="random_forest",
        description="'random_forest' if the RF was trained, 'rule_based' if there were too few training rows"
    )
    n_train: int = Field(default=0, description="Training rows received")


# ==================== /pipeline ====================

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


# ==================== /evaluate ====================

class EvaluateRequest(BaseModel):
    """Request body for walk-forward evaluation."""
    series: list[SeriesPoint] = Field(
        ..., description="Historical monthly case counts per barangay"
    )
    train: list[TrainRow] = Field(
        ..., description="Training rows for RF walk-forward evaluation"
    )
    thresholds: Thresholds = Field(
        ..., description="Threshold cut points for label derivation"
    )
    min_train: int = Field(
        default=24,
        description="Minimum months of training before testing starts (default 24)"
    )


class ArimaStep(BaseModel):
    """Single ARIMA walk-forward step result."""
    train_size: int
    test_month: int
    actual: float
    predicted: float
    error: float
    # 'arima' when the real model fit produced this step; the fallback method
    # name ('seasonal_naive' / 'exponential_smoothing') otherwise.
    method: str = "arima"


class ArimaEvaluation(BaseModel):
    """ARIMA walk-forward evaluation result."""
    mae: Optional[float] = None
    mape: Optional[float] = None
    n_steps: int = 0
    steps: list[ArimaStep] = []
    # Steps per method across ALL barangays evaluated, e.g.
    # {"arima": 520, "seasonal_naive": 50} — lets callers report how much of
    # the MAE/MAPE comes from real ARIMA fits vs fallback models.
    method_counts: dict[str, int] = {}
    # Barangays whose walk-forward raised an exception (excluded from
    # mae/mape/method_counts above, not silently dropped).
    failed_barangays: list[dict] = []


class RfStep(BaseModel):
    """Single RF walk-forward step result."""
    train_size: int
    test_month: int
    actual: list[str]
    predicted: list[str]
    correct: int
    total: int


class RfEvaluation(BaseModel):
    """RF walk-forward evaluation result."""
    accuracy: Optional[float] = None
    f1_macro: Optional[float] = None
    precision: Optional[dict[str, float]] = None
    recall: Optional[dict[str, float]] = None
    confusion_matrix: Optional[dict[str, dict[str, int]]] = None
    n_steps: int = 0
    steps: list[RfStep] = []


class EvaluateResponse(BaseModel):
    """Response from walk-forward evaluation endpoint."""
    arima: ArimaEvaluation
    rf: RfEvaluation
    model_version: str
