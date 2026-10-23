// Offline food search over foods.json (USDA SR28, built by scripts/build_foods.py)
// and branded.json (packaged products from Open Food Facts, built by
// scripts/build_branded.py).
// Each food is [name, kcal per 100 g, [[portion, grams], ...], common (0, 1 or 2)],
// branded foods add a fifth item: their barcodes, space-separated, without
// leading zeros, and foods the user entered themselves add a sixth: "mine".

// Everyday words that USDA names differently.
const SYNONYMS = {
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
  "pb&j": "peanut butter",
  ketchup: "catsup",
  oatmeal: "oats",
  steak: "beef",
};

// Sizes, counts and filler words are chosen with the portion picker, and USDA
// names rarely contain them, so they're dropped when the full search finds
// nothing ("large fries"), but kept when they're part of a name ("big mac").
const IGNORED = new Set([
  "a", "an", "the", "of", "and", "some", "my",
  "small", "medium", "large", "big", "regular", "extra",
  "cup", "cups", "glass", "can", "bottle", "mug", "bowl", "plate", "slice", "slices", "piece", "pieces",
  "half", "one", "two", "three", "single", "shot", "shots", "with", "plus",
]);

let foods = null;
let index = null;

const words = (text) => text.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim().split(" ").filter(Boolean);
// "no" and "without" mean the same thing in USDA names ("WHOPPER, no cheese").
const normalizedWords = (text) => words(text).map((w) => (w === "no" ? "without" : w));
let byName = null;
let byBarcode = null;

export function setFoods(list) {
  foods = [];
  index = [];
  byName = new Map();
  byBarcode = new Map();
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
    index.push({ words: normalizedWords(food[0]), firstSegment: normalizedWords(food[0].split(",")[0]) });
    byName.set(food[0], food);
    for (const code of (food[4] || "").split(" ")) if (code) byBarcode.set(code, food);
  }
}

export const findFood = (name) => byName?.get(name);

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
  let q = query.toLowerCase().trim();
  for (const [from, to] of Object.entries(SYNONYMS)) {
    if (from.includes(" ") && q.includes(from)) q = q.replace(from, to);
  }
  let tokens = words(q).filter((w) => !/^\d+$/.test(w));
  if (dropIgnored) tokens = tokens.filter((w) => !IGNORED.has(w));
  return tokens.flatMap((w) => normalizedWords(SYNONYMS[w] ?? w));
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
  let results = rank(expand(query, false));
  if (!results.length && !strict) results = rank(expand(query, true));
  return results.slice(0, limit).map(([, i]) => foods[i]);
}

// When no food matches every word: the foods matching the most words, and the
// words nothing matched (slang, typos, brand nicknames).
export function closestFoods(query, limit = 25) {
  if (!foods) return { foods: [], unmatched: [] };
  const tokens = expand(query, false);
  const results = rank(tokens, true);
  if (!results.length) return { foods: [], unmatched: tokens };
  const best = results[0][2];
  const top = results.filter((r) => r[2] === best).slice(0, limit);
  const matched = new Set(top.flatMap(([, i]) => tokens.filter((t) => tokenScore(index[i].words, t))));
  const unmatched = tokens.filter((t) => !matched.has(t) && !IGNORED.has(t));
  return { foods: top.map(([, i]) => foods[i]), unmatched };
}

function rank(tokens, partial = false) {
  if (!tokens.length) return [];
  const results = [];
  for (let i = 0; i < foods.length; i++) {
    const { words: nameWords, firstSegment } = index[i];
    let score = 0;
    let hits = 0;
    let matched = 0; // like hits, weighted
    for (const token of tokens) {
      const s = tokenScore(nameWords, token);
      if (!s && !partial) break;
      if (s) {
        hits++;
        // "large" counts less than "fries", and "nespresso" less than "espresso".
        matched += (IGNORED.has(token) ? 0.5 : 1) * (s === 1 ? 0.5 : 1);
      }
      score += s * 10 + (s && tokenScore(firstSegment, token) ? 15 : 0);
    }
    if (partial ? !hits : hits < tokens.length) continue;
    if (wordMatches(nameWords[0], tokens[0]) >= 2) score += 10;
    if (foods[i][2].length) score += 5;
    if (foods[i][3]) score += 60 * foods[i][3]; // everyday foods first; 2 = first choice
    score -= nameWords.length; // prefer short, generic names
    results.push([score, i, matched]);
  }
  return results.sort((a, b) => b[2] - a[2] || b[0] - a[0]);
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
