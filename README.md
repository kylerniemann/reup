# Reup

Reup is a Chrome extension that watches for visible usage-reset messages on ChatGPT, Claude, and Codex, then lets you know when it is almost time to jump back in.

## What it does

- Detects visible reset-time text on supported AI web apps.
- Saves the latest reset time for each site locally in Chrome.
- Sends a configurable early reminder plus a reset-time alert.
- Lets you silence the system banner, the Reup chime, or both.

## Supported sites

- ChatGPT
- Claude
- Codex

## Install locally

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select `reup-extension-v6`.

## Privacy

Reup reads only the visible page text it needs to detect reset messages and stores its settings locally in your browser.

Privacy policy: [https://kylerniemann.github.io/reup/](https://kylerniemann.github.io/reup/)

## Project notes

- Detection is heuristic and may need updates if the supported sites change their wording.
- Reup is built for Chrome web pages, not desktop apps or CLI tools.
