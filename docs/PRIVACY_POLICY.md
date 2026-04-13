# Privacy Policy — X Timeline Reader

**Last updated:** April 13, 2026

## Overview

X Timeline Reader is a browser extension that reads your X (Twitter) timeline aloud. Your privacy matters. This extension is designed to work without collecting, storing, or transmitting your personal data.

## What data we collect

**None.** We do not collect, store, or transmit any personal data, browsing history, analytics, or usage statistics.

## How the extension works

- The extension reads tweet content directly from the x.com page you are viewing in your browser.
- Tweet text is sent to a text-to-speech (TTS) service to generate audio. Depending on your configuration:
  - **Edge TTS (default):** Tweet text is sent to Microsoft's Edge TTS service to generate speech audio. No account information, user identity, or browsing data is sent — only the tweet text. This is the same service used by Microsoft Edge's built-in Read Aloud feature.
  - **Local TTS server (optional):** If you run the optional local TTS server, tweet text is processed entirely on your own machine. Nothing is sent to any external service.
  - **Browser TTS (fallback):** Uses your browser's built-in SpeechSynthesis API. All processing happens locally.
- Your selected categories, custom keywords, and preferences are stored locally on your device using Chrome's `storage` API. This data never leaves your browser.

## Permissions used

| Permission | Why it's needed |
|------------|----------------|
| `activeTab` | To read tweet content from the x.com page you're viewing |
| `storage` | To save your preferences (selected categories, voice, speed) locally |
| `nativeMessaging` | To optionally start/stop the local TTS server from the extension popup |

## Third-party services

- **Microsoft Edge TTS:** When using the default Edge TTS engine, tweet text is sent to Microsoft's speech synthesis service. See [Microsoft's Privacy Statement](https://privacy.microsoft.com/en-us/privacystatement) for their data handling practices.
- **HuggingFace (optional):** If you choose to download local TTS models, model files are downloaded from HuggingFace. See [HuggingFace's Privacy Policy](https://huggingface.co/privacy).

## Data retention

We retain no data. All preferences are stored locally in your browser and can be cleared by removing the extension.

## Children's privacy

This extension is not directed at children under 13 and does not knowingly collect data from children.

## Changes to this policy

If this policy is updated, the changes will be posted here with an updated date.

## Contact

For questions about this privacy policy, open an issue at:
https://github.com/ariediafauzan/x-timeline-reader/issues

## Open source

This extension is fully open source. You can review all code at:
https://github.com/ariediafauzan/x-timeline-reader
