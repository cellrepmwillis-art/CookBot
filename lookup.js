import { searchFoods, closestFoods, findFood, portionsFor, extraWords, namesFood, namesBrand } from "./foods.js";
import { parseQuery, applyModifiers } from "./modifiers.js";

// Turns what someone typed into food choices, each with a plan saying how
// modifiers like "meat only" or "no cheese" change it.
//   { results: [plan], quantity, unmatched: [words nothing matched] }
// "large iced latte", "medium fries": preselect that size when the food has it.
const SIZE = /\b(small|medium|regular|large)\b/i;
const SIZE_LABELS = { small: ["small"], medium: ["medium", "regular"], regular: ["regular", "medium"], large: ["large"] };

// "16 oz latte", "6 inch sub": the portion with that measure in its label.
const MEASURE = /(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*-?\s*(oz|ounces?|inch(?:es)?|in)\b/i;

// Candy bars: "fun size" (and a "small" one) is about 18 g; "king size" is
// about 1.75 times the regular bar.
const CANDY = /\b(candy|chocolate bar|snickers|butterfinger|twix|reese'?s|kit ?kat|milky way|3 musketeers|baby ruth|payday|hershey'?s|almond joy|mounds|crunch|whatchamacallit|heath|100 grand|skor|zero bar|m&m'?s?)\b/i;
const FUN_SIZE_GRAMS = 18;

function candySize(food, size, labels) {
  if (!CANDY.test(food[0]) || food[1] < 350 || !labels.length) return null;
  if (size === "small") return { label: `1 fun size (about ${FUN_SIZE_GRAMS} g)`, grams: FUN_SIZE_GRAMS };
  if (size === "large") return { label: "1 king size", grams: labels[0].grams * 1.75 };
  return null;
}

function withSize(plan, size, measure, unit, deep = false) {
  if (plan.portion) return plan;
  const labels = portionsFor(plan.food);
  const candy = !unit && !measure && size && candySize(plan.food, size, labels);
  if (candy) return { ...plan, portion: candy, sized: true, countable: true }; // one bar is a piece
  const portion =
    (unit && perUnit(labels, unit)) ||
    (unit === "handful" && handful(plan.food)) ||
    (unit === "slice" && pizzaSlice(labels, deep)) ||
    (measure && labels.find((p) => new RegExp(`(?<![\\d.])${measure[1].replace(".", "\\.")}\\s*-?\\s*(?:fl\\.?\\s*)?${measure[2].slice(0, 2)}`, "i").test(p.label))) ||
    (measure && /^o/i.test(measure[2]) && ounces(labels, Number(measure[1]))) ||
    (size && labels.find((p) => SIZE_LABELS[size].some((w) => new RegExp(`\\b${w}\\b`, "i").test(p.label))));
  return portion ? { ...plan, portion, sized: true } : plan;
}

// "A handful of almonds": about an ounce of nuts, chips, pretzels or candy;
// more by weight of something watery like grapes (fewer calories), and far
// less of something airy like popcorn.
function handful(food) {
  // Popcorn and puffs are mostly air: a handful is about a cup.
  const airy = /popcorn|puffs?\b|cheetos|rice cakes?/i.test(food[0]);
  const grams = airy ? 10 : food[1] >= 300 ? 28 : food[1] >= 150 ? 40 : 75;
  return { label: `1 handful (about ${grams} g)`, grams };
}

// "4 slices bbq chicken pizza" when the label only gives the whole pizza
// ("1 pizza (369 g)", "0.333 pizza (139 g)"): about a sixth of it, between
// a thin 90 g slice and a thick 150 g one (220 g for deep dish, whose
// whole pizza already weighs more).
function pizzaSlice(labels, deep) {
  for (const p of labels) {
    const m = p.label.match(/^(\d*\.?\d+)\s*pizzas?\b/i);
    if (!m || !(Number(m[1]) > 0)) continue;
    const whole = p.grams / Number(m[1]);
    if (whole < 300) return null; // a personal or mini pizza isn't sliced
    // A deep dish slice of a pizza only listed in a thin version: about 40% more.
    const grams = Math.min(deep ? 220 : 150, Math.max(90, whole / 6)) * (deep && whole < 600 ? 1.4 : 1);
    return { label: `1 slice (about ${Math.round(grams)} g)`, grams };
  }
  return null;
}

// "8 oz" when no label says so: fluid ounces for drinks, weight otherwise.
function ounces(labels, n) {
  const drink = labels.some((p) => /\bml\b|fl\.? ?oz/i.test(p.label));
  return { label: `${n} ${drink ? "fl oz" : "oz"}`, grams: n * (drink ? 29.57 : 28.35) };
}

// One of a household measure: "2 tbsp (32 g)" gives a 1 tbsp portion of 16 g.
// Spoons and cups convert ("2 tsp" of oil listed per tablespoon).
const TEASPOONS = { tsp: 1, teaspoon: 1, tbsp: 3, tablespoon: 3, cup: 48 };
const VOLUME_LABEL = /^(\d*\.?\d+)\s*(tsp|teaspoons?|tbsp|tablespoons?|cups?)\b/i;

function perUnit(labels, unit) {
  // "2 tbsp (32 g)" first, then a count anywhere: "1 serving, 5 pieces".
  for (const anchor of ["^", ""]) {
    for (const p of labels) {
      const m = p.label.match(new RegExp(`${anchor}(\\d*\\.?\\d+)\\s*${unit}`, "i"));
      if (m && Number(m[1]) > 0) return Number(m[1]) === 1 ? p : { label: `1 ${unit}`, grams: p.grams / Number(m[1]) };
    }
  }
  if (TEASPOONS[unit]) {
    for (const p of labels) {
      const m = p.label.match(VOLUME_LABEL);
      if (!m || !(Number(m[1]) > 0)) continue;
      const labelUnit = m[2].toLowerCase().replace(/s$/, "");
      const grams = (p.grams / Number(m[1]) / TEASPOONS[labelUnit]) * TEASPOONS[unit];
      return { label: `1 ${unit}`, grams };
    }
  }
  return labels.find((p) => new RegExp(`\\b${unit}`, "i").test(p.label));
}

// "4 tenders", "4-piece": count single pieces, not servings. A food whose
// serving is "3 tenders (84 g)" gets a one-tender portion of 28 g.
const COUNTABLE = "piece|strip|tender|nugget|wing|slice|cookie|cracker|egg|waffle|pancake|bar|link|patty|patties|taco|roll|meatball|shrimp|biscuit|muffin|donut|doughnut|finger|fillet|filet|pretzel|sandwich|burger|item|bagel|tortilla|hash brown|dumpling|egg roll|pizza";
const PIECES = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:[a-z]+\\s+)?(${COUNTABLE})(?:e?s)?\\b`, "i");

const MAX_PIECE_GRAMS = 450;

// Words that name the same kind of piece ("4 tenders" counts strips).
const SAME_PIECE = [["tender", "strip", "finger", "tenderloin"], ["piece", "pc", "count", "ct"]];
const samePiece = (a, b) => a === b || SAME_PIECE.some((g) => g.includes(a) && g.includes(b));

// countNoun: what the user counted ("breast" in "two chicken breasts"). A
// portion counts only if it's that kind of piece, so two chicken breasts
// aren't two deli slices. "4-piece" (countNoun "piece") counts any piece.
function withCount(plan, countNoun) {
  if (plan.portion || plan.count !== 1) return plan; // already a specific portion ("meat only", "large")
  const labels = portionsFor(plan.food);
  if (countNoun && countNoun !== "piece") {
    const named = labels.find((p) => new RegExp(`\\b${countNoun}(?:e?s)?\\b`, "i").test(p.label));
    if (named) {
      const n = Number(named.label.match(/^(\d*\.?\d+)/)?.[1] ?? 1);
      return { ...plan, portion: n === 1 ? named : { label: `1 ${countNoun}`, grams: named.grams / n }, countable: true };
    }
  }
  const found = labels
    .map((p) => ({ p, m: p.label.match(PIECES) }))
    .filter(({ m }) => !countNoun || countNoun === "piece" || !COUNTABLE.split("|").includes(countNoun) || samePiece(countNoun, m?.[2].toLowerCase()))
    // Over a pound isn't a piece: "1 pizza (1400 g)" is a whole pizza.
    .filter(({ p, m }) => m && Number(m[1]) > 0 && p.grams / Number(m[1]) <= MAX_PIECE_GRAMS)
    .sort((a, b) => Number(a.m[1] !== "1") - Number(b.m[1] !== "1"))[0];
  if (!found) return plan;
  const n = Number(found.m[1]);
  const portion = n === 1 ? found.p : { label: `1 ${found.m[2].toLowerCase()} (${Math.round(found.p.grams / n)} g)`, grams: found.p.grams / n };
  return { ...plan, portion, countable: true };
}

const DEEP = /\b(deep[\s-]?dish|pan|thick[\s-]?crust|detroit|chicago)\b/i;

export function lookup(query, limit = 25) {
  const parsed = lookupSized(query, limit);
  const size = query.match(SIZE)?.[1].toLowerCase();
  const results = parsed.results.map((plan) => withSize(plan, size, query.match(MEASURE), parsed.unit, DEEP.test(query))).map((plan) => (parsed.counted && !parsed.unit ? withCount(plan, parsed.countNoun) : plan));
  return { ...parsed, results, size };
}

// how: "exact" (every word matched a food name), "loose" (after dropping
// filler words like "large") or "closest" (some words matched nothing).
function lookupSized(query, limit) {
  const { text, fullText, quantity, counted, countNoun, unit, modifiers } = parseQuery(query);
  const plain = (foods) => foods.map((food) => applyModifiers(food, [], findFood));

  // USDA sometimes lists the modified version itself ("WHOPPER, no cheese").
  if (modifiers.length) {
    const exact = searchFoods(fullText, limit, { strict: true });
    if (exact.length) return { results: plain(exact), quantity, counted, countNoun, unit, unmatched: [], how: "exact" };
  }

  // Size words pick a size (see withSize), so they aren't searched for:
  // "large sweet tea" shouldn't find products named "..., Large".
  const searched = text.replace(new RegExp(SIZE.source, "gi"), " ").replace(/\s+/g, " ").trim() || text;
  let how = "exact";
  let foods = searched ? searchFoods(searched, limit, { strict: true }) : [];
  if (searched && !foods.length) {
    how = "loose";
    foods = searchFoods(searched, limit);
  }
  let unmatched = [];
  if (searched && !foods.length) {
    how = "closest";
    ({ foods, unmatched } = closestFoods(searched, limit));
  }
  // "Meat only" turns several burgers into the same patties; list each once.
  const seen = new Set();
  const results = foods.map((food) => applyModifiers(food, modifiers, findFood)).filter((plan) => {
    const key = plan.food === findFood(plan.name) ? plan.name : `${plan.food[0]}|${plan.count}|${plan.adjustments.map((a) => a.calories)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { results, quantity, counted, countNoun, unit, unmatched: [...new Set(unmatched)], how };
}

// "&" only with spaces around it: "m&ms" and "a&w" are one word.
const SEPARATOR = /\s*(?:,|\+|\s&\s|\band\b|\bplus\b)\s*/i;

// "X with Y": one food when that's what it is ("whopper with cheese", "bagel
// with cream cheese", "latte with oat milk"), else X and Y ("salad with olive
// oil", "toast with butter", "coffee with a splash of milk").
function lookupWith(query, single, limit) {
  const top = single.results[0];
  const casual = CASUAL_WORDS.test(query); // the amount belongs to Y: split
  const whole = top && !casual && single.how !== "closest" && (isCurated(top.food) || extraWords(query, top.food) <= 2);
  if (whole) return { single };
  if (!casual) {
    const merged = lookup(query.replace(/\bwith\b/gi, " "), limit);
    const main = query.split(/\s+with\s+/i)[0]; // "latte" in "latte with oat milk"
    const food = merged.results[0]?.food;
    if (food && merged.how !== "closest" && isCurated(food) && namesFood(main, food)) return { single: merged };
  }
  const texts = query.split(SEPARATOR).flatMap((t) => t.split(/\s+with\s+/i)).map((t) => t.trim()).filter(Boolean);
  if (texts.length < 2) return null;
  const parts = texts.map((text) => ({ text, ...lookup(text, limit) }));
  return parts.every((p) => p.results.length && p.how !== "closest") ? { parts } : null;
}

// Several foods at once: "chicken breast and rice", "2 eggs, toast and coffee".
// "with" isn't a separator: "latte with oat milk" is one drink.
// Used only when the whole phrase isn't one food ("mac and cheese" is).
//   { single } or { parts: [{ text, ...lookup(text) }] }
const CASUAL_WORDS = /\b(drizzle|splash|dollop|sprinkle|spoonful|squirt|pat)\b/i;
const isCurated = (food) => Boolean(food[3]) || food[5] === "mine";

export function lookupMeal(query, limit = 25) {
  const single = lookup(query, limit);
  if (/\bwith\b/i.test(query)) {
    const withMeal = lookupWith(query, single, limit);
    if (withMeal) return withMeal;
  }
  const listed = SEPARATOR.test(query);
  // A list stays whole only when it's a food's actual name ("macaroni and cheese").
  // "steak and vegetables" isn't a vegetable beef soup: a listed name with
  // several words that weren't typed is a different food.
  const listedWhole = single.how === "exact" && single.results.length > 0 && (isCurated(single.results[0].food) || extraWords(query, single.results[0].food) <= 2);
  if (single.results.length && (listed ? listedWhole : !single.unmatched.length)) return { single };
  // A brand's flavor with "and" in it: "siggi mixed berries and acai".
  if (listed && namesBrand(query)) {
    const merged = lookup(query.replace(/\s*(?:\band\b|\s&\s|\+)\s*/gi, " "), limit);
    if (merged.how === "exact" && merged.results.length && typeof merged.results[0].food[4] === "string") return { single: merged };
  }
  let texts = query.split(SEPARATOR).map((t) => t.trim()).filter(Boolean);
  // "salad with olive oil", "toast with butter": when the whole phrase isn't a
  // food, "with" adds one. ("latte with oat milk" matches whole, so it stays.)
  const withSplit = single.how === "closest" || !single.results.length;
  if (withSplit) texts = texts.flatMap((t) => t.split(/\s+with\s+/i)).map((t) => t.trim()).filter(Boolean);
  if (texts.length < 2) return { single };
  const parts = texts.map((text) => ({ text, ...lookup(text, limit) }));
  if (parts.some((p) => !p.results.length || (withSplit && p.how === "closest"))) return { single };
  return { parts };
}
