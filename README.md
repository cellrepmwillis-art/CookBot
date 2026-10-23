# CookBot

A calorie counter that runs on your phone. Type what you ate or drank, pick how much, and it subtracts the calories from your daily goal. The count resets at 3:00am local time every day.

- **Free food search:** a built-in list of 8,200 foods and drinks from USDA's nutrient database, including fast-food chains like McDonald's, Burger King, Wendy's and Pizza Hut. Typing "2 eggs" or "can of coke" finds the food and fills in the count. Then choose a portion, like "1 medium" or "1 can", and the calories update. This works offline and costs nothing.
- **Recent foods** show up when you tap the search box, for quick re-adding.
- **Manual entries** for when you already know the number.
- **Optional photo estimates:** if you add your own Anthropic API key, you can photograph a meal and get an itemized estimate. This is the only feature that costs money, a few cents per photo.
- **Daily goal** that you set. The ring shows calories left, and turns red when you go over.
- **3am reset:** anything you log before 3am counts toward the previous day, so a late-night snack stays with the day it belongs to.
- **No accounts and no syncing with other apps.** Your goal, food log and API key are stored only in your browser's local storage. The app keeps 30 days of entries.

## Food data

The food list comes from the USDA National Nutrient Database for Standard Reference, Release 28 (2015), which is public domain. `scripts/build_foods.py` converts USDA's ABBREV.txt and FOOD_DES.txt files into `foods.json`. It leaves out baby foods and school-lunch commodity items, ranks about 50 everyday foods first in search, and adds common portions USDA's abbreviated file leaves out, such as a medium banana. Fast-food items reflect the menus of the time, so newer menu items aren't included. For those, enter the calories from the restaurant's website yourself.

## Optional photo estimates

Photo estimates come from Claude's vision model. When you tap **Estimate calories**, the app resizes the photo and sends it straight from your phone to the Anthropic API, using your own API key. This is the only network request the app makes. Nothing else leaves your device, and there's no CookBot server.

To use it, get an API key from [console.anthropic.com](https://console.anthropic.com) and enter it in Settings (⚙︎). Each estimate typically costs 2 to 4 cents in API usage. Without a key, the photo option is turned off and the rest of the app works as normal.

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
| `foods.js`, `foods.json` | Offline food search and the USDA food list |
| `scripts/build_foods.py` | Rebuilds `foods.json` from the USDA SR28 files |
| `estimate.js` | The optional photo estimate (Claude API call) |
| `sw.js`, `manifest.webmanifest` | Offline caching and home-screen install |
| `vendor/anthropic-sdk-0.131.0.js` | The Anthropic TypeScript SDK, bundled into one file |

Tests for the day boundary and food search: `node --test`
