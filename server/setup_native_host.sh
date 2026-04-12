#!/bin/bash
# Install the Native Messaging host so Chrome can auto-start the TTS server.
# Works on macOS, Linux, and WSL. No extension ID needed — it's fixed in manifest.json.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.xreader.tts"
NATIVE_HOST="$SCRIPT_DIR/native_host.py"

# Fixed extension ID (deterministic via "key" in manifest.json)
EXT_ID="jbhpehdkpliofbccdiekkohkfdkhahbc"

echo "======================================"
echo "  X Reader TTS — Native Host Setup"
echo "======================================"
echo ""

# Make native_host.py executable
chmod +x "$NATIVE_HOST"

# Detect OS and set Chrome native messaging directory
OS="$(uname -s)"
case "$OS" in
    Darwin)
        CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
        ;;
    Linux)
        CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
        # Also support Chromium
        if [ ! -d "$HOME/.config/google-chrome" ] && [ -d "$HOME/.config/chromium" ]; then
            CHROME_DIR="$HOME/.config/chromium/NativeMessagingHosts"
        fi
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "On Windows, use setup_native_host.bat instead (or run manually)."
        echo "See README for instructions."
        exit 1
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

mkdir -p "$CHROME_DIR"

# Write the native messaging host manifest
cat > "$CHROME_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "X Reader TTS Server Launcher",
  "path": "$NATIVE_HOST",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo "Installed native messaging host:"
echo "  $CHROME_DIR/$HOST_NAME.json"
echo ""
echo "You can now start/stop the TTS server directly from the"
echo "extension popup — no terminal needed."
echo ""
