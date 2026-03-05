#!/bin/bash
cd "$(dirname "$0")/backend"

echo ""
echo "============================================================"
echo "  FloorScan — Démarrage du backend"
echo "============================================================"
echo ""

echo "[1/3] Installation des dépendances..."
pip install -r requirements.txt -q

echo "[2/3] Démarrage du serveur..."
echo ""
echo "  Backend  : http://localhost:8000"
echo "  Frontend : ouvrez frontend/index.html dans votre navigateur"
echo ""
echo "  Appuyez sur Ctrl+C pour arrêter."
echo ""

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
