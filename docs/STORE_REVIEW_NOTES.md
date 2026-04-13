# Chrome Web Store Review Notes

Use these when submitting. Paste into the "Additional notes for reviewer" field.

---

## Why nativeMessaging permission is needed

This extension includes an optional local TTS (text-to-speech) server that runs on the user's own machine for offline voice synthesis. The `nativeMessaging` permission allows the extension popup to start and stop this local server without requiring the user to open a terminal.

**How it works:**
- The extension communicates with a Native Messaging host (`native_host.py`) registered on the user's machine
- The host simply starts or checks the status of a local Python TTS server on `localhost:8787`
- This is entirely opt-in — the user must manually run a setup script (`setup_native_host.sh`) to register the native host before this feature works
- The extension functions fully without this feature using cloud TTS (Edge TTS) or the browser's built-in SpeechSynthesis API

**No external processes are launched without user action.** The user explicitly clicks a "Start" button in the popup to launch their own local server. The native host only communicates with `localhost`.

## Why activeTab permission is needed

The extension runs a content script on x.com and twitter.com to read tweet content from the page DOM. It extracts tweet text, author names, and detects ads/promoted posts to skip them. No data is collected, stored, or sent anywhere other than to the user's chosen TTS service for audio generation.

## Network requests

The extension makes requests to:
1. `localhost:8787` — the user's own local TTS server (optional, user-started)
2. No other external requests are made by the extension itself

The local TTS server (separate from the extension) may contact:
- Microsoft Edge TTS service — to generate speech audio from tweet text (default engine)
- HuggingFace — only if the user chooses to download a local TTS model

## Privacy summary

- No user data is collected or transmitted
- No analytics or tracking
- No account creation or authentication
- All preferences stored locally via chrome.storage
- Fully open source: https://github.com/ariediafauzan/x-timeline-reader
