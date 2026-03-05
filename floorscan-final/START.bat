@echo off
cd /d "%~dp0backend"
pip install -r requirements.txt
pip install uvicorn[standard] fastapi
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause