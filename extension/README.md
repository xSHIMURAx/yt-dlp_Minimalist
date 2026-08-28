# YT-DLP Minimalist — Browser Extension

Extension for Chrome/Edge and other Chromium-based browsers (Manifest V3)
that sends the current tab's URL to the **YT-DLP Minimalist** desktop app so
it can be downloaded with yt-dlp, without having to copy and paste the link
by hand.

## How it works

- The extension makes a local HTTP request to `http://127.0.0.1:14370/add-url`.
- **YT-DLP Minimalist** must be open on your computer to receive that request
  (it runs a local server on that port while the app is open).
- Nothing is sent or stored outside your computer: all traffic goes to
  `127.0.0.1` (your own machine).

## Installation (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions` on Edge).
3. Turn on **"Developer mode"** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the `extension/` folder from this
   repository.
5. Open **YT-DLP Minimalist** on your computer.
6. With any video open in the browser, click the extension icon (or use the
   button that appears on the page) to send it to the app.

## Structure

- `manifest.json` — extension configuration (Manifest V3).
- `background.js` — service worker that sends the URL to the app
  (`127.0.0.1:14370`).
- `popup.html` / `popup.js` — window that opens when clicking the icon.
- `content-overlay.js` / `content-overlay.css` — button/overlay injected
  into the page to send the video without opening the popup.
- `options.html` / `options.js` — extension options page.
- `url-utils.js` — utilities to detect/normalize the video URL.
- `icons/` — extension icons.

## Publishing to the Chrome Web Store (optional)

This folder is already set up to be uploaded as-is to the Chrome Web Store,
if you ever want to publish it there (Developer → New item → upload a
`.zip` with this folder's contents).
