#!/bin/bash
# Start the X Timeline Reader TTS server
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SCRIPT_DIR"

# Kill any existing instance on port 8787
lsof -ti:8787 2>/dev/null | xargs kill -9 2>/dev/null

# Activate venv (lives in project root)
if [ -f "$PROJECT_DIR/venv/bin/activate" ]; then
    source "$PROJECT_DIR/venv/bin/activate"
elif [ -f "$SCRIPT_DIR/venv/bin/activate" ]; then
    source "$SCRIPT_DIR/venv/bin/activate"
else
    echo "Error: Python venv not found. Run: python3 -m venv venv && pip install -r server/requirements.txt"
    exit 1
fi

exec python tts_server.py
