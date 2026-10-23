# CookBot

A calorie counter that runs on your phone. Take a photo of what you're eating or drinking, and it estimates the calories and subtracts them from your daily goal. The count resets at 3:00am local time every day.

- **Photo estimates:** every food and drink in the photo is listed with an assumed portion and calorie count. You can edit any number, add or remove items, or add a short note before estimating, like "large" or "oat milk".
- **Manual entries** for when you already know the number.
- **Daily goal** that you set. The ring shows calories left, and turns red when you go over.
- **3am reset:** anything you log before 3am counts toward the previous day, so a late-night snack stays with the day it belongs to.
- **No accounts and no syncing with other apps.** Your goal, food log and API key are stored only in your browser's local storage. The app keeps 30 days of entries.

## How the estimates work

Estimates come from Claude's vision model. When you tap **Estimate calories**, the app resizes the photo and sends it straight from your phone to the Anthropic API, using your own API key. This is the only network request the app makes. Nothing else leaves your device, and there's no CookBot server.

You need an API key from [console.anthropic.com](https://console.anthropic.com). Enter it in Settings (⚙︎) along with your daily goal. Each estimate typically costs 2 to 4 cents in API usage.

## Running it

It's a static site with no build step, so any static host works: GitHub Pages, Netlify, Cloudflare Pages, or your own server. For example, to turn on GitHub Pages, go to the repo's **Settings → Pages** and deploy from this branch.

Open the URL on your phone and choose **Add to Home Screen** to install it like an app. Phones only allow camera access and installing on `https://` pages or `localhost`.

To run it locally:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | The single screen and settings dialog |
| `app.js` | Logging, totals, photo resizing, local storage |
| `day.js` | The 3am day boundary |
| `estimate.js` | The Claude API call and its response schema |
| `sw.js`, `manifest.webmanifest` | Offline caching and home-screen install |
| `vendor/anthropic-sdk-0.131.0.js` | The Anthropic TypeScript SDK, bundled into one file |

Tests for the day boundary: `node --test`
