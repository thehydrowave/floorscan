@echo off
chcp 65001 >nul
title FloorScan — Démarrage

echo.
echo ============================================================
echo   FloorScan — Démarrage du backend
echo ============================================================
echo.

cd /d "%~dp0backend"

echo [1/3] Vérification de Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERREUR : Python non trouvé. Installez Python 3.9+ depuis python.org
    pause & exit /b 1
)

echo [2/3] Installation des dépendances...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo ERREUR lors de l'installation des dépendances.
    pause & exit /b 1
)

echo [3/3] Démarrage du serveur...
echo.
echo  Backend  : http://localhost:8000
echo  Frontend : ouvrez frontend\index.html dans votre navigateur
echo.
echo  Appuyez sur Ctrl+C pour arrêter.
echo.

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
