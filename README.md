# CookBot

A calorie counter that runs on your phone. Type what you ate or drank the way you'd say it, tap **Subtract**, and it's taken off your daily goal. There are no lists to pick from: the app chooses the closest food or foods behind the scenes. The count resets at 3:00am local time every day.

- **Type it any way:** "sheetz iced latte regular with an extra shot made with oat milk" logs one regular iced oat-milk latte plus a shot, about 137 cal. A small "≈ 137 cal" preview appears as you type.
- **Averaged when unsure:** when several foods match equally well, the app uses their middle value instead of trusting whichever ranked first. "4 piece bojangles tenders" averages chicken strips from Burger King, KFC, Popeyes, Chick-fil-A and others to about 490, close to Bojangles' ~500. The app's own everyday foods, meals and lattes, your saved numbers, and changed orders like "meat only" still use one exact pick.
- **Typos and number words:** a word that matches nothing is corrected to the closest well-known word, so "bpjangle" becomes Bojangles and "chiken tendrs" becomes chicken tenders. Words used in USDA's list are always trusted as spelled. "four piece", "two eggs" and "a dozen wings" are counts. The entry keeps the words as typed.
- **Counts and measures:** "4-piece", "4 tenders" and "kfc 3 strips" count single pieces, even when a product's serving is "3 tenders". "2 cups rice" and "2 tbsp peanut butter" use that measure, and "16 oz" or "6 inch" pick that size.
- **Restaurants:** naming a restaurant favors restaurant food over grocery products, and restaurants' own menu words are understood. For example, Bojangles "supremes" and Raising Cane's "fingers" are chicken tenders.
- **Lists:** "2 eggs, toast and coffee" logs each part. Names that contain "and", like "macaroni and cheese", stay whole.
- **Words it doesn't know are skipped:** restaurants whose menus aren't in the data, like Sheetz, Wawa, Chipotle or Starbucks, are ignored, so "wawa hoagie" logs a sub sandwich and "chipotle burrito bowl" a chicken burrito bowl.
- **Changes and sizes:** "meat only", "no bun", "extra cheese", "extra shot", "half a", counts ("2 eggs", "pizza 3") and sizes ("large iced latte", "medium fries").
- **Your own numbers:** "sheetz special 300", "snack 250 cal" or just "300" logs exactly that. Tap any entry to change its calories. The app remembers the words with your number, so typing them again uses it.
- **One question, only when needed:** if nothing at all matches, the app asks about how many calories.
- **What it knows:** about 8,200 USDA foods, 60,000 packaged products from Open Food Facts (fairlife, Core Power, Barebells, Premier Protein, Quest, Thrive Market and many more), lattes and coffee drinks, and about 30 everyday meals like a turkey sandwich, a burrito bowl or cereal with milk.
- **Barcode scanning:** tap **Scan a barcode** and the product is logged. About 86,000 barcodes are built in, so it works offline. Unknown products offer an optional free lookup on Open Food Facts, which sends only the barcode number.
- **Optional photo estimates:** with your own Anthropic API key, a photo is estimated and logged. This is the only feature that costs money, a few cents per photo.
- **Protein, carbs and fat:** a running total for the day under the calorie ring. Each food's calories are split by its own makeup from USDA or Open Food Facts, so it's a rough guide to the balance, not label-exact. Typed numbers and photo estimates count toward calories only. Changing an entry's calories scales its split.
- **Protein and calorie goals:** add your weight (and optionally height, age and sex) in Settings and pick an aim: **Gain**, **Maintain** or **Cut**. The protein total shows red until you reach the day's goal, then green. Protein follows the classic bodybuilding rule of about 1 g per pound of body weight to gain or cut (protein stays high on a cut to keep muscle) and 0.8 g per pound to maintain. Past a BMI of 30 it uses the weight at a BMI of 30 for your height. With age, height and weight, Settings also suggests a calorie goal: maintenance from the Mifflin–St Jeor equation for someone moderately active (training 3 to 5 days a week), plus 300 to gain (a lean bulk) or minus 500 to cut (about 1 lb a week), never under 1,200 (women) or 1,500 (men). Tap **Use this** to make it your goal; otherwise your own goal stays.
- **Recommend:** a line under the totals suggests what to eat next, picked from about 20 simple, high-protein foods. It looks at the time of day (breakfast, lunch, an afternoon snack, dinner or a light late-night snack), the calories left spread over the meals still to come, how far you are from your protein goal, whether carbs or fat are running high, and what you've already had today. At or over your goal it suggests water, coffee or tea. Tap it to put the food in the box, then Subtract if you eat it.
- **Streak:** like Duolingo, "🔥 5 days on track" counts the days in a row you finished at or under your goal. Each day is judged when it ends at 3am. Going over the goal, or a day with nothing logged, starts the streak again. The first time you open the app on a new day, a banner says how the last one went. A small summary of every day (calories and goal) is kept indefinitely for this.
- **Backup and restore:** in Settings, **Backup cooks** saves your goal, profile, streak history, log and remembered foods to a small JSON file, either to the phone's Downloads or through the share sheet to Google Drive or any other app you pick. **Restore cooks** opens a backup file (from the phone or Drive) and replaces this phone's data with it, after asking. The API key is never in the backup. The app itself uploads nothing.
- **No accounts and no syncing with other apps.** Your goal, food log and API key are stored only in your browser's local storage. The app keeps 30 days of entries.

## Food data

The food list comes from the USDA National Nutrient Database for Standard Reference, Release 28 (2015), which is public domain. `scripts/build_foods.py` converts USDA's ABBREV.txt and FOOD_DES.txt files into `foods.json`. It leaves out baby foods and school-lunch commodity items, ranks about 50 everyday foods first in search, and adds common portions USDA's abbreviated file leaves out, such as a medium banana or a shot of espresso. It also adds lattes, black iced coffee and about 30 everyday meals, which USDA doesn't list. These are calculated from USDA milk and coffee values. Oat milk uses 50 cal per 100 ml, the median of 106 oat milks in Open Food Facts. Fast-food items reflect the menus of the time, so newer menu items aren't included. For those, enter the calories from the restaurant's website yourself.

### Packaged products

`branded.json` is built from the [Open Food Facts](https://world.openfoodfacts.org) data export by `scripts/build_branded.py`. Open Food Facts data is available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/), so `branded.json` is too. The build keeps US products with a brand and calorie data. It drops entries whose calories don't match their protein, carbs and fat, and entries Open Food Facts itself flags. When a drink's per-serving number was entered as per-100 ml, it converts the value. It keeps one entry per product name, preferring the most-scanned copy. The data is entered by volunteers, so an occasional value can still be wrong. Every number stays editable in the app.

To rebuild it, stream the export through a filter that writes the columns listed at the top of the script, then run:

```sh
python3 scripts/build_branded.py us.tsv > branded.json
```

## Optional photo estimates

Photo estimates come from Claude's vision model. When you tap **Estimate calories**, the app resizes the photo and sends it straight from your phone to the Anthropic API, using your own API key. There's no CookBot server.

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
| `streak.js` | The streak and the morning recap |
| `recommend.js` | The "Recommend" suggestion |
| `profile.js` | The daily protein goal and calorie suggestion |
| `foods.js`, `foods.json` | Offline food search and the USDA food list |
| `resolve.js` | Turns typed text into logged calories, picking the closest foods |
| `modifiers.js`, `lookup.js` | Understanding "meat only", "no bun", "extra shot", counts, sizes, lists and nicknames |
| `scripts/build_foods.py` | Rebuilds `foods.json` from the USDA SR28 files |
| `branded.json`, `scripts/build_branded.py` | Packaged products from Open Food Facts, and the script that builds them |
| `barcode.js` | Barcode scanning, barcode matching and the optional online lookup |
| `estimate.js` | The optional photo estimate (Claude API call) |
| `sw.js`, `manifest.webmanifest` | Offline caching and home-screen install |
| `vendor/anthropic-sdk-0.131.0.js` | The Anthropic TypeScript SDK, bundled into one file |
| `vendor/zxing-0.23.0.js` | The ZXing barcode reader (Apache License 2.0), bundled into one file |

Tests for the day boundary, streak, food search, modifiers, typed orders, branded products and barcodes: `node --test`
