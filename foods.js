// Offline food search over foods.json (USDA SR28, built by scripts/build_foods.py)
// and branded.json (packaged products from Open Food Facts, built by
// scripts/build_branded.py).
// Each food is [name, kcal per 100 g, [[portion, grams], ...], common],
// where common is 0, 1 (everyday), 2 (first choice) or 3 (a meal, see build_foods.py),
// branded foods add a fifth item: their barcodes, space-separated, without
// leading zeros; foods the user entered themselves add a sixth: "mine"; and
// a seventh, when known, is [protein, carbs, fat] in grams per 100 g.

// Everyday words that USDA names differently.
const SYNONYMS = {
  halfnhalf: "half and half",
  twogood: "two good",
  "mc rib": "mcrib",
  coke: "cola",
  pepsi: "cola",
  soda: "carbonated",
  pop: "carbonated",
  fries: "french frie", // matches both "french fries" and "french fried"
  oj: "orange juice",
  hotdog: "frankfurter",
  "hot dog": "frankfurter",
  donut: "doughnuts",
  doughnut: "doughnuts",
  mcdonalds: "mcdonald",
  "mcdonald's": "mcdonald",
  "mickey d's": "mcdonald",
  "mickey ds": "mcdonald",
  mcds: "mcdonald",
  "mcd's": "mcdonald",
  maccas: "mcdonald",
  bk: "burger king",
  "espresso shots": "espresso",
  "espresso shot": "espresso",
  "shots of espresso": "espresso",
  "shot of espresso": "espresso",
  barbell: "barebells",
  barbells: "barebells",
  "bare bells": "barebells",
  "fair life": "fairlife",
  wendys: "wendy",
  pb: "peanut butter",
  "pb&j": "peanut butter jelly sandwich",
  hoagie: "submarine",
  hoagies: "submarine",
  sub: "submarine",
  subs: "submarine",
  hero: "submarine",
  grinder: "submarine",
  ketchup: "catsup",
  oatmeal: "oats",
  steak: "beef",
  skinless: "meat only",
  drpepper: "dr pepper",
  "iced tea": "tea", // unsweetened; "sweet tea" is the sweet one
  "dr. pepper": "dr pepper",
  // Cooked at home, these are all about the same as roasted chicken breast.
  "grilled chicken breast": "chicken breast",
  "baked chicken breast": "chicken breast",
  "pan seared chicken breast": "chicken breast",
};

// Sizes, counts and filler words are chosen with the portion picker, and USDA
// names rarely contain them, so they're dropped when the full search finds
// nothing ("large fries"), but kept when they're part of a name ("big mac").
const IGNORED = new Set([
  "a", "an", "the", "of", "and", "some", "my",
  "small", "medium", "large", "big", "regular", "extra",
  "cup", "cups", "glass", "can", "bottle", "mug", "bowl", "plate", "slice", "slices", "piece", "pieces",
  "half", "one", "two", "three", "single", "shot", "shots", "with", "plus", "made", "w",
  "oz", "ounce", "ounces", "inch", "inches", "fl", "ml", "g", "grams", "lb", "lbs",
]);

// Grocery stores: their names are on store-brand products, but "food lion
// rotisserie chicken" means rotisserie chicken, not Food Lion's canned
// chicken. They count for little when matching.
const STORE_WORDS = new Set(["food", "lion", "walmart", "kroger", "publix", "aldi", "kirkland", "costco", "wegmans", "safeway", "meijer", "heb", "albertsons", "harris", "teeter", "giant", "hannaford", "winco", "sprouts", "lidl"]);

// Restaurants whose menus aren't in the data. Their names only match sauces,
// snacks and bottled drinks sold under the brand, so they're left out of every search:
// "sheetz iced latte" looks up an iced latte.
const UNLISTED_RESTAURANTS = [
  "sheetz", "wawa", "chipotle", "panera", "five guys", "in-n-out", "in n out", "jersey mike's", "jersey mikes",
  "jimmy john's", "jimmy johns", "sweetgreen", "qdoba", "moe's", "panda express", "dairy queen", "culver's",
  "culvers", "raising cane's", "raising canes", "shake shack", "whataburger", "jack in the box", "chili's",
  "cava", "7-eleven", "7 eleven", "quiktrip", "royal farms", "casey's", "caseys", "buc-ee's", "bucees",
  "dutch bros", "tim hortons", "peet's", "arby's", "arbys", "sonic", "zaxby's", "zaxbys", "cookout", "cook out",
  "bojangles", "bojangles'", "bojangle's", "bojangle", "bo jangles", "slim chickens", "huey magoo's", "guthrie's",
  // Their store products (capsules, bottles) aren't what's ordered in the café.
  "starbucks", "dunkin donuts", "dunkin'", "dunkin",
];
const UNLISTED = new RegExp(`(^|\\s)(${UNLISTED_RESTAURANTS.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=\\s|$)`, "gi");

// What some restaurants call their food, applied before their name is dropped:
// a Bojangles "4-piece supreme" is four chicken tenders.
const RESTAURANT_TERMS = [
  [/\bbo ?jangle'?s?'?(?=\s|$)/, { "supremes": "chicken tenders", "supreme": "chicken tenders", "bo-berry": "blueberry" }],
  [/\braising cane'?s\b|\bcanes\b/, { "fingers": "chicken tenders", "finger": "chicken tenders" }],
  [/\bzaxby'?s\b/, { "fingerz": "chicken tenders", "fingers": "chicken tenders" }],
  [/\bslim chickens\b|\bhuey magoo'?s\b|\bguthrie'?s\b/, { "tenders": "chicken tenders" }],
];

// Words that mean the same food: "strips", "tenders" and "fingers" are all
// chicken tenders, so restaurant entries named either way are found.
const ALTERNATIVES = [["tender", "tenders", "strip", "strips", "finger", "fingers", "tenderloins"], ["nonfat", "skim"]];
const ALTERNATIVE_OF = new Map(ALTERNATIVES.flatMap((group) => group.map((w) => [w, group.join("|")])));

// Restaurant food in the data: USDA's fast-food and restaurant entries and
// the chains it lists. Ranked first when the user names a restaurant.
const RESTAURANT_FOOD = /^(fast foods|restaurant,|applebee's|burger king|chick-fil-a|cracker barrel|denny's|kfc|mcdonald's|popeyes|wendy's|taco bell|subway|pizza hut|domino's|papa john's|little caesars|t\.g\.i\. friday's|olive garden|carrabba's|on the border)/i;
const NAMED_RESTAURANT = /\b(fast food|restaurant|drive[- ]?thru|take ?out|mcdonald|burger king|wendy|kfc|popeyes|chick-fil-a|taco bell|subway|pizza hut|domino|papa john|little caesar|applebee|denny|cracker barrel|friday|olive garden)/i;

// Whether a search names a restaurant, listed in the data or not.
export function isRestaurantQuery(query) {
  const q = ` ${query.toLowerCase()} `;
  UNLISTED.lastIndex = 0;
  return UNLISTED.test(q) || NAMED_RESTAURANT.test(q);
}
export const isRestaurantFood = (food) => RESTAURANT_FOOD.test(food[0]);

const MEAT_SUBSTITUTE = /\b(quorn|gardein|morningstar|beyond|impossible|tofurky|meatless|meat-free|chicken-free|plant-based|vegan)\b/i;

let foods = null;
let index = null;

// "Fat free", "nonfat" and "skim" are the same milk ("nonfat" stands for all three).
// Accents dropped: "Açaí" is "acai", "Crème" is "creme".
const words = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]s\b/g, "").replace(/\b(?:fat[\s-]+free|non[\s-]+fat)\b/g, "nonfat").replace(/[^a-z0-9%]+/g, " ").trim().split(" ").filter(Boolean);
// "no" and "without" mean the same thing in USDA names ("WHOPPER, no cheese").
const normalizedWords = (text) => words(text).map((w) => (w === "no" ? "without" : w));
let byName = null;
let byBarcode = null;
let vocabulary = null; // word -> how many food names use it, for typo correction
let plainWords = null; // words in USDA's and the app's own names (not brands)

export function setFoods(list) {
  foods = [];
  index = [];
  byName = new Map();
  byBarcode = new Map();
  vocabulary = new Map(KNOWN_WORDS.map((w) => [w, 1000]));
  plainWords = new Set(KNOWN_WORDS);
  addFoods(list);
}

// Adds foods to the search, e.g. ones the user looked up online.
export function addFoods(list) {
  for (const food of list) {
    if (byName.has(food[0])) {
      // The user's own foods update when re-entered with a new number.
      if (food[5] === "mine") byName.get(food[0]).splice(0, Infinity, ...food);
      continue;
    }
    foods.push(food);
    // USDA's names (no barcodes) are edited, so their words are trusted spellings.
    const weight = typeof food[4] !== "string" ? TRUSTED_COUNT : 1;
    for (const w of words(food[0])) if (w.length >= 3 && !/\d/.test(w)) vocabulary.set(w, (vocabulary.get(w) ?? 0) + weight);
    if (typeof food[4] !== "string" && food[5] !== "mine") for (const w of words(food[0])) plainWords.add(w);
    const firstSegment = normalizedWords(food[0].split(",")[0]);
    index.push({ words: normalizedWords(food[0]), firstSegment, required: firstSegment.filter((w) => !IGNORED.has(w) && w !== "without") });
    byName.set(food[0], food);
    for (const code of (food[4] || "").split(" ")) if (code) byBarcode.set(code, food);
  }
}

export const findFood = (name) => byName?.get(name);

// Protein, carbs and fat for some calories of a food, in grams, or null.
export function macrosFor(food, calories) {
  const macros = food[6];
  if (!macros || !food[1]) return null;
  const grams = (calories / food[1]) * 100;
  return { protein: (macros[0] * grams) / 100, carbs: (macros[1] * grams) / 100, fat: (macros[2] * grams) / 100 };
}

// ---- Typo correction ----

// Words the app understands besides food names: restaurants and their menu
// words, synonyms, and the words of modifiers like "only" or "without".
const KNOWN_WORDS = [
  ...UNLISTED_RESTAURANTS.flatMap((r) => words(r)),
  ...RESTAURANT_TERMS.flatMap(([, terms]) => Object.keys(terms).flatMap(words)),
  ...Object.keys(SYNONYMS).flatMap(words),
  ...IGNORED,
  "only", "just", "without", "hold", "minus", "add", "meat", "bun", "sauce", "protein", "style", "bunless",
  "dozen", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty",
  "piece", "pieces", "pc", "pcs", "count", "kids", "kid", "iced", "hot", "cal", "cals", "calories", "kcal",
  // Measures and amounts ("tablespoon" isn't "table spoon").
  "tablespoon", "tablespoons", "teaspoon", "teaspoons", "tbsp", "tsp", "cups", "bowls", "glasses", "scoop", "scoops",
  "serving", "servings", "drizzle", "splash", "dollop", "sprinkle", "spoonful", "squirt", "pat", "handful", "handfuls", "fun", "mini", "minis", "king",
  "third", "thirds", "quarter", "quarters", "skinless",
].filter((w) => w.length >= 2);

// Edit distance with adjacent swaps ("tendres"), giving up past `max`.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

const corrections = new Map();

// A word used by fewer food names than this may itself be a typo in the
// volunteer data ("chiken", "choclate"), so it isn't trusted as a spelling.
const TRUSTED_COUNT = 3;

// The closest known word to a misspelled one ("bpjangle" -> "bojangle"), or
// the word itself if it's known or nothing is close. One letter off is
// allowed for words of 4 to 6 letters, two for longer words.
function correctWord(word) {
  const own = vocabulary.get(word) ?? 0;
  if (word.length < 4 || /\d/.test(word) || own >= TRUSTED_COUNT) return word;
  // Plurals of known words are known: "macs", "breasts".
  const singular = word.replace(/(es|s)$/, "");
  if (singular !== word && (vocabulary.get(singular) ?? 0) >= TRUSTED_COUNT) return word;
  if (corrections.has(word)) return corrections.get(word);
  const max = word.length >= 7 ? 2 : 1;
  let best = word;
  let bestDistance = max + 1;
  let bestCount = 0;
  for (const [known, count] of vocabulary) {
    // Only well-used words, and much more used than the typed one.
    if (count < TRUSTED_COUNT || count < 5 * Math.max(own, 1) || Math.abs(known.length - word.length) > max) continue;
    const d = distance(word, known, max);
    if (d > max) continue;
    if (d < bestDistance || (d === bestDistance && count > bestCount)) [best, bestDistance, bestCount] = [known, d, count];
  }
  corrections.set(word, best);
  return best;
}

// "redbull" -> "red bull", "drpepper" -> "dr pepper": two known words run together.
function splitWord(word) {
  let best = null;
  let bestCount = 0;
  for (let i = 2; i <= word.length - 3; i++) {
    const [a, b] = [word.slice(0, i), word.slice(i)];
    const count = Math.min(vocabulary.get(a) ?? 0, vocabulary.get(b) ?? 0);
    if (count >= TRUSTED_COUNT && count > bestCount) [best, bestCount] = [`${a} ${b}`, count];
  }
  return best;
}

// The search with misspelled words corrected and run-together words split.
// Punctuation and numbers are kept.
export function correctTypos(query) {
  if (!vocabulary) return query;
  // A zero for the "o" in ounces: "7 0z", "120z" (12 oz).
  query = query.replace(/(\d)\s*0(z|unces?)\b/gi, "$1 o$2");
  // One word, so "and" doesn't split it and "half" doesn't halve something.
  query = query.replace(/\bhalf\s*(?:and|&|n|'n'?)\s*half\b/gi, "halfnhalf");
  // "lunchable", "luncable", "lunch able": Lunchables, and a store brand's
  // copy ("great value turkey lunchable") is the same thing.
  if (/\blunc?h?[\s-]?abl[es]*\b/i.test(query)) {
    query = query.replace(/\blunc?h?[\s-]?abl[es]*\b/gi, "lunchables")
      // Just "lunchable": the classic turkey one.
      .replace(/^(\W*(?:\d+|an?|one|two)?\s*)lunchables\W*$/i, "$1turkey lunchables")
      .replace(/\b(?:oscar mayer|great value|kroger|food lion|member'?s mark|kirkland|aldi|lunchmate|good (?:&|and) gather|market pantry|equate|hy-?vee|publix|h-?e-?b)\b/gi, " ");
  }
  // Candy sizes: "fun size" and "snack size" are the small ones, "king size" the large.
  query = query.replace(/\b(?:fun|snack)[\s-]?size[ds]?\b/gi, "small").replace(/\bking[\s-]?size[ds]?\b/gi, "large");
  // Plain "tenders", "strips" or "fingers" are chicken ("4 tenders", "kfc 3 strips").
  if (/\b(tenders?|strips?|fingers?)\b/i.test(query) && !/\b(chicken|beef|steak|sirloin|pork|turkey|fish|bacon|fruit|cheese|pepper|tofu|veggie)\b/i.test(query)) {
    query = query.replace(/\b(tenders?|strips?|fingers?)\b/i, "chicken $1");
  }
  // The yogurt brand, not two of something.
  query = query.replace(/\btwo\s+good\b/gi, "twogood");
  // "2 percent milk", "two percent", "1 %": the milkfat, not a count.
  query = query.replace(/\b(1|2|one|two)\s*(?:%|percent|per cent|pct)(?![a-z])/gi, (_, n) => `${{ one: 1, two: 2 }[n.toLowerCase()] ?? n}%`);
  // "milk with calcium", "OJ with added vitamin D": what's added to it, not a
  // second food.
  query = query.replace(/\b(?:with|w\/|plus|and)\s+(?:added\s+|extra\s+)?(?:calcium|vitamins?(?:\s+[a-e]\d?)?(?:\s*(?:&|and)\s*[a-e]\d?)?|d3|iron|fiber|fibre|omega[- ]?3s?|probiotics?|dha|electrolytes|lactase)\b/gi, " ");
  return query.replace(/[a-z]+/gi, (w) => {
    const word = w.toLowerCase();
    // "siggis", "wendys": a brand's possessive typed without the apostrophe.
    const brand = word.slice(0, -1);
    if (/s$/.test(word) && !vocabulary.has(word) && !plainWords.has(brand) && (vocabulary.get(brand) ?? 0) >= 2) return brand;
    // Not a plural of a known word: "butterfingers" isn't "butter fingers".
    const singular = word.replace(/e?s$/, "");
    if (word.length >= 6 && (vocabulary.get(word) ?? 0) < TRUSTED_COUNT && (vocabulary.get(singular) ?? 0) < TRUSTED_COUNT) {
      const split = splitWord(word);
      if (split) return split;
    }
    const fixed = correctWord(word);
    return fixed === word ? w : fixed;
  });
}

// Whether a search names a brand: a word only packaged products use
// ("siggi", "chobani"), so "siggi mixed berries and acai" is one product.
export function namesBrand(query) {
  return words(query).some((w) => w.length >= 3 && !plainWords?.has(w) && !plainWords?.has(w.replace(/'?s$/, "")) && (vocabulary.get(w) ?? 0) >= 2);
}

// keys: from barcodeKeys() in barcode.js.
export const findByBarcode = (keys) => keys.map((k) => byBarcode?.get(k)).find(Boolean);

export async function loadFoods() {
  if (!foods) {
    const load = (url) => fetch(url).then((r) => (r.ok ? r.json() : []));
    const [generic, branded] = await Promise.all([load("foods.json"), load("branded.json").catch(() => [])]);
    setFoods(generic.concat(branded));
  }
  return foods;
}

function expand(query, dropIgnored) {
  let q = ` ${query.toLowerCase().trim()} `;
  for (const [restaurant, terms] of RESTAURANT_TERMS) {
    if (!restaurant.test(q)) continue;
    for (const [from, to] of Object.entries(terms)) q = q.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  q = q.replace(UNLISTED, " ").trim();
  for (const [from, to] of Object.entries(SYNONYMS)) {
    if (/[^a-z0-9]/.test(from) && q.includes(from)) q = q.replace(from, to); // phrases like "hot dog", "pb&j"
  }
  let tokens = words(q).filter((w) => !/^\d+$/.test(w));
  if (dropIgnored) tokens = tokens.filter((w) => !IGNORED.has(w));
  return tokens.flatMap((w) => normalizedWords(SYNONYMS[w] ?? w)).map((w) => ALTERNATIVE_OF.get(w) ?? w);
}

// A query word matches a name word exactly or as a plural (best), at its start
// ("coffee" -> "coffeecake"), or at the end of a compound word ("burger" ->
// "cheeseburger"), but never in the middle ("cola" does not match "chocolate").
function wordMatches(nameWord, token) {
  if (nameWord === token || nameWord === token + "s" || nameWord === token + "es") return 3;
  if (nameWord.startsWith(token)) return 2;
  if (token.length >= 4 && (nameWord.endsWith(token) || nameWord.endsWith(token + "s"))) return 1;
  return 0;
}

function tokenScore(nameWords, token) {
  if (token.includes("|")) return Math.max(...token.split("|").map((t) => tokenScore(nameWords, t)));
  // Also try the singular, so "eggs" finds "Egg, whole, ...".
  const singular = token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : null;
  let best = 0;
  for (const w of nameWords) {
    best = Math.max(best, wordMatches(w, token), singular ? wordMatches(w, singular) : 0);
  }
  return best;
}

// strict: every word must match, including size words like "extra".
export function searchFoods(query, limit = 25, { strict = false } = {}) {
  if (!foods) return [];
  const restaurant = isRestaurantQuery(query);
  let results = rank(expand(query, false), false, restaurant);
  if (!results.length && !strict) results = rank(expand(query, true), false, restaurant);
  return results.slice(0, limit).map(([, i]) => foods[i]);
}

// When no food matches every word: the foods matching the most words, and the
// words nothing matched (slang, typos, brand nicknames).
export function closestFoods(query, limit = 25) {
  if (!foods) return { foods: [], unmatched: [] };
  const tokens = expand(query, false);
  const results = rank(tokens, true, isRestaurantQuery(query));
  if (!results.length) return { foods: [], unmatched: tokens };
  const best = results[0][2];
  const top = results.filter((r) => r[2] === best).slice(0, limit);
  const matched = new Set(top.flatMap(([, i]) => tokens.filter((t) => tokenScore(index[i].words, t))));
  const unmatched = tokens.filter((t) => !matched.has(t) && !IGNORED.has(t));
  return { foods: top.map(([, i]) => foods[i]), unmatched };
}

function rank(tokens, partial = false, restaurant = false) {
  if (!tokens.length) return [];
  const results = [];
  const lastFoodWord = tokens.findLastIndex((t) => !IGNORED.has(t) && !STORE_WORDS.has(t));
  for (let i = 0; i < foods.length; i++) {
    const { words: nameWords, firstSegment } = index[i];
    let score = 0;
    let hits = 0;
    let foodHits = 0; // matches on words other than filler like "bowl" or "large"
    let matched = 0; // like hits, weighted
    for (const [t, token] of tokens.entries()) {
      const s = tokenScore(nameWords, token);
      if (!s && !partial) break;
      if (s) {
        hits++;
        if (!IGNORED.has(token)) foodHits++;
        // "large" counts less than "fries", "nespresso" less than "espresso",
        // and the last word (usually the food: "wawa hoagie") more than the rest.
        matched += (IGNORED.has(token) ? 0.5 : STORE_WORDS.has(token) ? 0.25 : 1) * (s === 1 ? 0.5 : 1) * (t === lastFoodWord ? 1.5 : 1);
      }
      score += s * 10 + (s && tokenScore(firstSegment, token) ? 15 : 0);
    }
    if (partial ? !foodHits : hits < tokens.length) continue;
    if (wordMatches(nameWords[0], tokens[0]) >= 2) score += 10;
    if (foods[i][2].length) score += 5;
    const common = foods[i][3];
    if (common === 3) {
      // A meal ranks first only when its name was typed ("burrito bowl"), not
      // whenever one word matches ("eggs" shouldn't mean "eggs and toast").
      const named = index[i].required.every((w) => tokens.some((t) => tokenScore([w], t) >= 2));
      score += named ? 60 : -20;
    } else if (common) {
      score += 60 * common; // everyday foods first; 2 = first choice
    }
    score -= nameWords.length; // prefer short, generic names
    // USDA's own entries break ties with packaged products ("quarter pounder":
    // McDonald's, not Quorn's meatless one). Meat substitutes only when named.
    if (typeof foods[i][4] !== "string") score += 8;
    if (MEAT_SUBSTITUTE.test(foods[i][0]) && !tokens.some((t) => MEAT_SUBSTITUTE.test(t))) score -= 30;
    // "bojangles tenders": restaurant tenders, not frozen ones from the store.
    // Only for the food itself: "mcdonalds sweet tea" isn't their sweet 'n sour sauce.
    if (restaurant && RESTAURANT_FOOD.test(foods[i][0]) && (lastFoodWord < 0 || tokenScore(nameWords, tokens[lastFoodWord]))) matched += 0.75;
    results.push([score, i, matched]);
  }
  return results.sort((a, b) => b[2] - a[2] || b[0] - a[0]);
}

// Whether a food is the thing the search names first: "salad" is the food in
// "Salad, garden" but not in "Oil, olive, salad or cooking".
export function namesFood(query, food) {
  const first = normalizedWords(food[0].split(",")[0]);
  return expand(query, true).some((t) => tokenScore(first, t) >= 2);
}

// How many words of a food's name weren't typed: "tuna salad with quinoa &
// olive oil" has 4 for "salad with olive oil", "BURGER KING, WHOPPER, with
// cheese" 2 for "whopper with cheese".
export function extraWords(query, food) {
  const tokens = expand(query, false);
  return normalizedWords(food[0]).filter((w) => w.length >= 3 && !IGNORED.has(w) && w !== "without" && !tokens.some((t) => tokenScore([w], t))).length;
}

// The words of a search a food's name matches: foods with the same ones are
// equally good matches, which resolve.js averages.
export function matchedWords(query, food) {
  const nameWords = normalizedWords(food[0]);
  return expand(query, true).filter((t) => tokenScore(nameWords, t)).join(" ");
}

// Portion choices for a food: its USDA household measures plus weight units.
export function portionsFor(food) {
  const [, , portions] = food;
  const own = portions.map(([label, grams]) => ({ label: label.replace(/\s+/g, " ").replace(/^\./, "0."), grams }));
  if (food[5] === "mine") return own; // weights would be meaningless for "1 serving as you entered it"
  return [
    ...own,
    { label: "1 oz", grams: 28.35 },
    { label: "100 g", grams: 100 },
    { label: "1 g", grams: 1 },
  ];
}

export function caloriesFor(food, grams, quantity) {
  return Math.round((food[1] * grams * quantity) / 100);
}
