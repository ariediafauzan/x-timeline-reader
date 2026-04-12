#!/bin/bash
# Install the Native Messaging host so Chrome can auto-start the TTS server

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.xreader.tts"
NATIVE_HOST="$SCRIPT_DIR/native_host.py"

# Get the Chrome extension ID
echo "======================================"
echo "  X Reader TTS — Native Host Setup"
echo "======================================"
echo ""
echo "This lets Chrome auto-start the TTS server when you open the extension."
echo ""
echo "1. Open chrome://extensions in Chrome"
echo "2. Find 'X Timeline Reader' and copy its ID"
echo "   (looks like: abcdefghijklmnopabcdefghijklmnop)"
echo ""
read -p "Paste your extension ID: " EXT_ID

if [ -z "$EXT_ID" ]; then
    echo "Error: No extension ID provided."
    exit 1
fi

# Chrome native messaging hosts directory
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
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

echo ""
echo "Done! Native messaging host installed at:"
echo "  $CHROME_DIR/$HOST_NAME.json"
echo ""
echo "Now reload the extension in chrome://extensions and it will"
echo "auto-start the server whenever you open X."
echo ""
