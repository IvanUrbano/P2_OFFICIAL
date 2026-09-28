"""Load ML_API_KEY from ML_SERVICE/.env before any test imports config.py.

config.py raises RuntimeError if ML_API_KEY is missing from the environment;
tests import config transitively (arima_forecast, routes), so the env must be
loaded at conftest-import time — before pytest collects test modules.
"""
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
