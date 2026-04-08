FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (tesseract for OCR + libGL for OpenCV)
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-fra \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python opencv-python-headless \
    && pip install --no-cache-dir opencv-python-headless==4.10.0.84

COPY main.py .
COPY pipeline.py .
COPY pipeline_diagonal.py .
COPY pipeline_v4.py .

CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
