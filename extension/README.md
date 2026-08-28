# YT-DLP Minimalist — Browser Extension

<p align="center">
  <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white">
  <img alt="Chromium" src="https://img.shields.io/badge/Chromium--based-Chrome%20%7C%20Edge%20%7C%20Brave%20%7C%20Opera%20%7C%20Vivaldi-success">
  <img alt="Local only" src="https://img.shields.io/badge/traffic-127.0.0.1%20only-blue">
</p>

A companion extension for Chrome, Edge, and other Chromium-based browsers that sends the
current tab's URL to the **[YT-DLP Minimalist](../)** desktop app, so it can be queued for
download with `yt-dlp` — no copy-pasting the link by hand.

<p align="center">
  <img src="../screenshots/extension-01.png" alt="Extension popup" width="400">
  <img src="../screenshots/extension-02.png" alt="Extension in use" width="400">
</p>

## How it works

- The extension makes a local HTTP request to `http://127.0.0.1:14370/add-url`.
- **YT-DLP Minimalist** must be open on your computer to receive that request — it runs a
  small local server on that port while the app is open.
- Nothing is sent or stored outside your computer: all traffic stays on `127.0.0.1` (your own
  machine). No analytics, no external servers.

## Installation (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions` on Edge).
3. Turn on **"Developer mode"** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the `extension/` folder from this repository.
5. Open **YT-DLP Minimalist** on your computer.
6. With any video open in the browser, click the extension icon (or use the button that
   appears on the page) to send it to the app.

## Requirements

- A Chromium-based browser: Chrome, Edge, Brave, Opera, or Vivaldi.
- **YT-DLP Minimalist** running on the same machine while you use the extension.

> **Firefox / Safari:** not officially supported yet. The extension uses the `chrome.*` APIs,
> which Firefox partially supports as an alias — it may work with minor tweaks, but this hasn't
> been tested. Safari would require converting the extension with Xcode's Safari Web Extension
> Converter.

## Troubleshooting

| Problem | Fix |
|---|---|
| Clicking the icon does nothing / "connection refused" | Make sure **YT-DLP Minimalist** is open — the extension can't reach it otherwise. |
| The overlay button doesn't appear on the page | Reload the page after installing the extension; some sites load content late. |
| Nothing happens after "Load unpacked" | Confirm you selected the `extension/` folder itself, not the repository root. |
| The port seems busy / app isn't receiving requests | Check that no other app is using port `14370`, then restart YT-DLP Minimalist. |

## Structure

- `manifest.json` — extension configuration (Manifest V3).
- `background.js` — service worker that sends the URL to the app (`127.0.0.1:14370`).
- `popup.html` / `popup.js` — window that opens when clicking the icon.
- `content-overlay.js` / `content-overlay.css` — button/overlay injected into the page to send
  the video without opening the popup.
- `options.html` / `options.js` — extension options page.
- `url-utils.js` — utilities to detect/normalize the video URL.
- `icons/` — extension icons.

## Publishing to the Chrome Web Store (optional)

This folder is already set up to be uploaded as-is to the Chrome Web Store, if you ever want to
publish it there (Developer Dashboard → New item → upload a `.zip` with this folder's
contents).

---

<p align="center">
  <sub>Part of <a href="../">YT-DLP Minimalist</a></sub>
</p>
