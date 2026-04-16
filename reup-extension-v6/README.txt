Reup Chrome Extension (MVP)

How to load it:
1. Open Chrome.
2. Go to chrome://extensions
3. Turn on Developer mode.
4. Click "Load unpacked".
5. Select the reup-extension folder.
6. Pin the extension.

What it does:
- Watches ChatGPT, Claude, and Codex web pages in Chrome.
- Looks for visible reset-time text.
- Saves detected reset times locally.
- Sends a Chrome/system notification when the reset time arrives.

Notes:
- Detection is heuristic and may need updates if the sites change their wording.
- This MVP is for Chrome web only, not desktop apps or CLI tools.


V4 adds test notification buttons in the popup so you can preview both the reset and early alert styles immediately.
