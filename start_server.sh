#!/bin/bash
# Start the X Timeline Reader TTS server
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Kill any existing instance on port 8787
lsof -ti:8787 2>/dev/null | xargs kill -9 2>/dev/null

# Activate venv and start
source venv/bin/activate
exec python tts_server.py
