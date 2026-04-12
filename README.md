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

### Minimum (Cloud TTS only — Edge TTS)

Works on any machine. No GPU needed.

| Component | Requirement |
|-----------|-------------|
| Browser | Chrome, Brave, Edge, or any Chromium-based browser |
| Python | 3.10+ (3.12 recommended) |
| RAM | 512 MB free (server uses ~60 MB idle) |
| GPU | None |
| Internet | Required (Edge TTS streams from Microsoft servers) |
| OS | macOS, Linux, Windows |

### Recommended (Local TTS models)

For running TTS models locally on your machine.

| Component | Requirement |
|-----------|-------------|
| RAM | 8 GB minimum, **16 GB+ recommended** |
| GPU | Apple Silicon (M1/M2/M3/M4) for MPS acceleration, or NVIDIA GPU with CUDA 12+ |
| Disk | 3-10 GB per model (cached in `~/.cache/huggingface/hub/`) |
| OS | macOS (Apple Silicon) or Linux (NVIDIA GPU) |

### Per-model hardware

| Model | RAM needed | GPU | Disk | Generation speed |
|-------|-----------|-----|------|-----------------|
| Edge TTS (cloud) | ~60 MB | None | 0 | Instant (~1s) |
| Qwen3 TTS 0.6B | ~2.5 GB | MPS / CUDA | ~5 GB | ~5-10s per tweet |
| Qwen3 TTS 1.7B | ~7 GB | MPS / CUDA | ~9 GB | ~15-30s per tweet |
| VoxCPM2 0.5B | ~2 GB | MPS / CUDA | ~4 GB | ~20-30s per tweet |
| HuggingFace models | Varies | MPS / CUDA | Varies | Varies |
| Browser fallback | 0 | None | 0 | Instant |

> **Note:** Local models are loaded on-demand and auto-unload after 5 minutes of inactivity. The server itself shuts down after 10 minutes idle. Your machine is not impacted when you're not using the extension.

### Edge TTS — works on basically anything

Edge TTS is the default engine and uses Microsoft's neural voices via the cloud. It runs on:

- Any CPU (Intel, AMD, Apple Silicon, even Raspberry Pi)
- Any OS (macOS, Windows, Linux)
- As low as **512 MB RAM** — the server itself uses ~60 MB
- No GPU, no model downloads, no disk space
- Just needs an **internet connection**

The voice quality is excellent (natural-sounding neural voices with 11 voice options). For most users, there's no reason to switch to a local model unless you need **offline/private** TTS or want to experiment with different voices.

### What if I don't have a GPU?

No problem. Edge TTS works great without one. Local models are entirely optional for users who want offline/private TTS or want to experiment with open-source voices.

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
