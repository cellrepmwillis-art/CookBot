// Offline food search over foods.json (USDA SR28, built by scripts/build_foods.py).
// Each food is [name, kcal per 100 g, [[portion, grams], ...], common (0 or 1)].

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
  "half", "one", "two", "three",
]);

let foods = null;
let index = null;

const words = (text) => text.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim().split(" ").filter(Boolean);

export function setFoods(list) {
  foods = list;
  index = list.map(([name]) => {
    const lower = name.toLowerCase();
    return { words: words(name), firstSegment: words(lower.split(",")[0]) };
  });
}

export async function loadFoods() {
  if (!foods) setFoods(await (await fetch("foods.json")).json());
  return foods;
}

function expand(query, dropIgnored) {
  let q = query.toLowerCase().trim();
  for (const [from, to] of Object.entries(SYNONYMS)) {
    if (from.includes(" ") && q.includes(from)) q = q.replace(from, to);
  }
  let tokens = words(q).filter((w) => !/^\d+$/.test(w));
  if (dropIgnored) tokens = tokens.filter((w) => !IGNORED.has(w));
  return tokens.flatMap((w) => words(SYNONYMS[w] ?? w));
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

export function searchFoods(query, limit = 25) {
  if (!foods) return [];
  const results = rank(expand(query, false));
  return (results.length ? results : rank(expand(query, true))).slice(0, limit).map(([, i]) => foods[i]);
}

function rank(tokens) {
  if (!tokens.length) return [];
  const results = [];
  for (let i = 0; i < foods.length; i++) {
    const { words: nameWords, firstSegment } = index[i];
    let score = 0;
    let ok = true;
    for (const token of tokens) {
      const s = tokenScore(nameWords, token);
      if (!s) { ok = false; break; }
      score += s * 10 + (tokenScore(firstSegment, token) ? 15 : 0);
    }
    if (!ok) continue;
    if (wordMatches(nameWords[0], tokens[0]) >= 2) score += 10;
    if (foods[i][2].length) score += 5;
    if (foods[i][3]) score += 25;
    score -= nameWords.length; // prefer short, generic names
    results.push([score, i]);
  }
  return results.sort((a, b) => b[0] - a[0]);
}

// A count at the start of the search, e.g. 2 for "2 eggs" or 1.5 for "1.5 cups rice".
export function quantityFrom(query) {
  const match = query.trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s/);
  return match ? Number(match[1]) : 1;
}

// Portion choices for a food: its USDA household measures plus weight units.
export function portionsFor(food) {
  const [, , portions] = food;
  return [
    ...portions.map(([label, grams]) => ({ label: label.replace(/\s+/g, " ").replace(/^\./, "0."), grams })),
    { label: "1 oz", grams: 28.35 },
    { label: "100 g", grams: 100 },
    { label: "1 g", grams: 1 },
  ];
}

export function caloriesFor(food, grams, quantity) {
  return Math.round((food[1] * grams * quantity) / 100);
}
