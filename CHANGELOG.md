# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0] - 2026-04-13

### Added
- Category-based topic filter — 10 preset categories (Tech, AI/ML, Crypto, Business, Politics, Science, Sports, Gaming, Entertainment, Design) with clickable chips
- Custom keywords input alongside category chips
- Keyboard shortcuts — Cmd+Shift+P play/pause, Cmd+Shift+S skip (Ctrl on Windows/Linux)
- Background service worker for handling keyboard shortcuts
- Queue preview — "Up Next" section showing the next 3 tweets
- Read stats counter — tracks tweets read per session
- Shortcut hints in the stats bar

### Changed
- URLs in tweets now read as "link shared" instead of the full URL
- Show more detection improved with fallback span selector
- Tweet extraction is now async — expands truncated tweets before reading
- Filter intro message simplified for category-based filtering
- Category selections persist via chrome.storage.local

## [1.1.0] - 2026-04-12

### Added
- Pocket TTS engine — lightweight CPU-only TTS from Kyutai Labs (100M params, ~6x realtime)
- Server Start/Stop button in popup via Chrome Native Messaging
- Fixed extension ID via manifest.json key field (deterministic across installs)
- Cross-platform native host setup (macOS, Linux, Chromium)
- Acknowledgments section in README

### Changed
- Engines reordered fastest-first (Edge TTS, Pocket TTS, then local models)
- Show more button selector fixed to match X.com's actual DOM
- setup_native_host.sh no longer prompts for extension ID

## [1.0.0] - 2026-04-11

### Added
- Chrome extension with dark X-themed popup UI
- Podcast-style reading with randomized intros and transitions
- Topic filtering (comma-separated keywords)
- Smart skipping: ads, promoted posts, paid partnerships, video tweets
- Tweet-by-tweet scrolling with visual highlight
- Auto "Show more" button clicking for full threads
- Toggle for quoted retweets and long-form tweets
- Speed control (0.5x - 2.0x)
- Multi-engine TTS server (Flask, port 8787)
  - Edge TTS (cloud, default) — 11 Microsoft neural voices
  - Qwen3 TTS 0.6B / 1.7B (local, MPS)
  - VoxCPM2 0.5B (local, MPS)
  - Any HuggingFace TTS model via one-click install
  - Browser SpeechSynthesis fallback
- Model marketplace with trending HuggingFace models
- Download progress with percentage bar
- Downloaded model manager with delete to free disk space
- RAM recommendations and per-model hardware badges
- Pre-buffering system for slow local models
- Audio LRU cache (20 entries)
- Auto model unload after 5 min idle
- Auto server shutdown after 10 min idle
- macOS Launch Agent for auto-start on login
- Chrome Native Messaging host for auto-start from extension
- Race condition prevention (speaking mutex)
