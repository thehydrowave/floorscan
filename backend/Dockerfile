FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python opencv-python-headless \
    && pip install --no-cache-dir opencv-python-headless==4.10.0.84

COPY main.py .
COPY pipeline.py .

CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
