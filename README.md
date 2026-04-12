# X Timeline Reader

A Chrome extension that reads your X (Twitter) timeline aloud so you can listen in the background while working.

https://github.com/user-attachments/assets/demo.mp4

## Features

- **Podcast-style reading** — natural intros, transitions, and personality between tweets
- **Topic filtering** — only read tweets matching your keywords (e.g. `AI, startup, tech`)
- **Smart skipping** — automatically skips ads, promoted posts, paid partnerships, and video tweets
- **Scroll & highlight** — scrolls through your timeline tweet-by-tweet with visual highlight
- **Multiple TTS engines** — Edge TTS (cloud, default), Qwen3 TTS, VoxCPM2, or any HuggingFace model
- **Model marketplace** — browse trending HuggingFace TTS models and install with one click
- **Speed control** — 0.5x to 2.0x playback speed
- **Toggle options** — choose whether to read quoted retweets and long-form tweets
- **Auto "Show more"** — clicks expand buttons so it reads full tweet threads
- **Resource-friendly** — auto-unloads models after 5 min idle, server shuts down after 10 min
- **Download manager** — see cached models, their disk usage, and delete to free space

## Architecture

```
Chrome Extension (content.js + popup)
        |
        | HTTP (localhost:8787)
        |
  TTS Server (Python/Flask)
        |
        |-- Edge TTS (cloud, default — best quality/speed)
        |-- Qwen3 TTS 0.6B / 1.7B (local, MPS)
        |-- VoxCPM2 0.5B (local, MPS, realistic)
        |-- Any HuggingFace TTS model (auto-download)
        |-- Browser SpeechSynthesis (fallback)
```

## Quick Start

### 1. Clone & set up the server

```bash
git clone https://github.com/YOUR_USERNAME/x-timeline-reader.git
cd x-timeline-reader

# Create Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Start the TTS server

```bash
./start_server.sh
```

The server runs on `http://localhost:8787` and auto-shuts down after 10 minutes of inactivity.

### 3. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the project folder

### 4. Use it

1. Go to [x.com](https://x.com/home)
2. Click the extension icon
3. (Optional) Enter topic filters
4. Hit **Play**

## TTS Engines

| Engine | Type | RAM | Quality | Speed | Notes |
|--------|------|-----|---------|-------|-------|
| **Edge TTS** | Cloud | 0 | Great | Fast | Default. Free, needs internet |
| Qwen3 0.6B | Local | ~2.5 GB | Good | Medium | Alibaba open-source |
| Qwen3 1.7B | Local | ~7 GB | Great | Slow | Best open-source quality |
| VoxCPM2 | Local | ~2 GB | Great | Slow | Very realistic, pre-buffers tweets |
| HuggingFace | Local | Varies | Varies | Varies | One-click install from trending list |
| Browser | Local | 0 | Basic | Fast | Fallback when server is offline |

Switch engines from the **Models** tab in the popup. The extension shows RAM recommendations and warns if a model is too large for your system.

## Optional Setup

### Auto-start server (macOS)

Install the Launch Agent so the server starts on login:

```bash
cp com.xreader.tts.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.xreader.tts.plist
```

The server auto-shuts down after 10 min idle and only restarts on crash (not on clean shutdown).

### Auto-start from Chrome (Native Messaging)

Let the extension auto-start the server when you open X:

```bash
./setup_native_host.sh
```

Follow the prompts to enter your Chrome extension ID (from `chrome://extensions`).

### Install local TTS engines

```bash
source venv/bin/activate

# Qwen3 TTS (Alibaba)
pip install qwen-tts

# VoxCPM2 (OpenBMB) — very realistic voice
pip install voxcpm
```

## Project Structure

```
manifest.json          # Chrome extension manifest (v3)
content.js             # Content script — tweet extraction, TTS playback, scrolling
popup.html             # Extension popup UI (dark X theme)
popup.js               # Popup controller — playback, models, downloads
tts_server.py          # Multi-engine Flask TTS server
start_server.sh        # Server launch script
native_host.py         # Native Messaging host for auto-start
setup_native_host.sh   # Native host installer
requirements.txt       # Python dependencies
icons/                 # Extension icons
```

## How It Works

1. **Content script** (`content.js`) runs on x.com, extracts tweets from the DOM, filters out ads/videos, and manages the reading queue
2. **Popup** (`popup.html/js`) controls playback, filters, voice selection, and model management
3. **TTS server** (`tts_server.py`) receives text via HTTP, synthesizes speech using the active engine, and returns audio
4. The content script plays the audio, scrolls to the next tweet, and repeats

### Smart features

- **Race condition prevention** — mutex lock prevents reading two tweets simultaneously
- **Pre-buffering** — for slow local models, the next 3 tweets are generated in the background while the current one plays
- **Auto resource management** — models unload from RAM after 5 min idle; server shuts down after 10 min
- **Audio cache** — recently generated audio is cached; repeated text returns instantly

## Requirements

- **Chrome** (or any Chromium-based browser)
- **Python 3.10+** (3.12 recommended for widest compatibility)
- **macOS with Apple Silicon** recommended for local models (MPS GPU acceleration)
- **Internet** for Edge TTS (default engine) and HuggingFace model downloads

## Contributing

PRs welcome! Some ideas:

- [ ] Firefox extension support
- [ ] Windows/Linux server auto-start
- [ ] More built-in TTS engines (Kokoro, Parler, Bark)
- [ ] Voice cloning with VoxCPM2
- [ ] Bookmark/save interesting tweets while listening
- [ ] Read Twitter Spaces transcripts
- [ ] Multi-language support

## License

MIT
