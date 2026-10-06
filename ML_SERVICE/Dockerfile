# Container image for the TBInsight ML service, deployed to AWS Lambda
# (.github/workflows/deploy-ml-lambda.yml). Also runs as a plain container.
# Same Python as the pinned requirements.txt was verified with.
FROM python:3.12.10-slim

# Lambda Web Adapter: lets the unmodified FastAPI app serve Lambda Function URL
# requests. Ignored when the image runs outside Lambda.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

ENV ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    # Lambda has no /dev/shm, so ARIMA fits run serially
    ML_N_JOBS=1 \
    # Only /tmp is writable on Lambda
    HOME=/tmp \
    JOBLIB_TEMP_FOLDER=/tmp \
    AWS_LWA_READINESS_CHECK_PATH=/api/ml/health

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
