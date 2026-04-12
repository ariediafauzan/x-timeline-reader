# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
