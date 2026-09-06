"""
TBInsight ML Service — FastAPI Application

System 2: Python ML service for ARIMA forecasting + RF classification.
Receives data from Express (System 1) via HTTP, returns predictions.
"""

import logging
import os
import sys

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from routes import router, verify_api_key
from config import MODEL_VERSION

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="TBInsight ML Service",
    description="ARIMA forecasting + Random Forest classification for TB hotspot prediction",
    version=MODEL_VERSION,
)

# CORS configuration — allow Express origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5000",   # Express dev
        "http://localhost:3000",   # Frontend dev
        "https://p2-official.vercel.app",  # Production frontend
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(router, prefix="/api/ml")


@app.get("/", dependencies=[Depends(verify_api_key)])
async def root():
    """Root endpoint with service info."""
    return {
        "service": "TBInsight ML Service",
        "version": MODEL_VERSION,
        "endpoints": {
            "health": "GET /api/ml/health",
            "thresholds": "POST /api/ml/thresholds",
            "forecast": "POST /api/ml/forecast",
            "classify": "POST /api/ml/classify",
            "pipeline": "POST /api/ml/pipeline",
        },
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8001))
    logger.info(f"Starting TBInsight ML Service on port {port}")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=os.environ.get("ENV") != "production",
    )
