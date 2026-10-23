import { searchFoods, closestFoods, findFood, portionsFor } from "./foods.js";
import { parseQuery, applyModifiers } from "./modifiers.js";

// Turns what someone typed into food choices, each with a plan saying how
// modifiers like "meat only" or "no cheese" change it.
//   { results: [plan], quantity, unmatched: [words nothing matched] }
// "large iced latte", "medium fries": preselect that size when the food has it.
const SIZE = /\b(small|medium|regular|large)\b/i;
const SIZE_LABELS = { small: ["small"], medium: ["medium", "regular"], regular: ["regular", "medium"], large: ["large"] };

// "16 oz latte", "6 inch sub": the portion with that measure in its label.
const MEASURE = /(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*-?\s*(oz|ounces?|inch(?:es)?|in)\b/i;

function withSize(plan, size, measure, unit) {
  if (plan.portion) return plan;
  const labels = portionsFor(plan.food);
  const portion =
    (unit && perUnit(labels, unit)) ||
    (measure && labels.find((p) => new RegExp(`(?<![\\d.])${measure[1].replace(".", "\\.")}\\s*-?\\s*(?:fl\\.?\\s*)?${measure[2].slice(0, 2)}`, "i").test(p.label))) ||
    (measure && /^o/i.test(measure[2]) && ounces(labels, Number(measure[1]))) ||
    (size && labels.find((p) => SIZE_LABELS[size].some((w) => new RegExp(`\\b${w}\\b`, "i").test(p.label))));
  return portion ? { ...plan, portion, sized: true } : plan;
}

// "8 oz" when no label says so: fluid ounces for drinks, weight otherwise.
function ounces(labels, n) {
  const drink = labels.some((p) => /\bml\b|fl\.? ?oz/i.test(p.label));
  return { label: `${n} ${drink ? "fl oz" : "oz"}`, grams: n * (drink ? 29.57 : 28.35) };
}

// One of a household measure: "2 tbsp (32 g)" gives a 1 tbsp portion of 16 g.
function perUnit(labels, unit) {
  // "2 tbsp (32 g)" first, then a count anywhere: "1 serving, 5 pieces".
  for (const anchor of ["^", ""]) {
    for (const p of labels) {
      const m = p.label.match(new RegExp(`${anchor}(\\d*\\.?\\d+)\\s*${unit}`, "i"));
      if (m && Number(m[1]) > 0) return Number(m[1]) === 1 ? p : { label: `1 ${unit}`, grams: p.grams / Number(m[1]) };
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

export function lookup(query, limit = 25) {
  const parsed = lookupSized(query, limit);
  const size = query.match(SIZE)?.[1].toLowerCase();
  const results = parsed.results.map((plan) => withSize(plan, size, query.match(MEASURE), parsed.unit)).map((plan) => (parsed.counted ? withCount(plan, parsed.countNoun) : plan));
  return { ...parsed, results };
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

  let how = "exact";
  let foods = text ? searchFoods(text, limit, { strict: true }) : [];
  if (text && !foods.length) {
    how = "loose";
    foods = searchFoods(text, limit);
  }
  let unmatched = [];
  if (text && !foods.length) {
    how = "closest";
    ({ foods, unmatched } = closestFoods(text, limit));
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

const SEPARATOR = /\s*(?:,|\+|&|\band\b|\bplus\b)\s*/i;

// Several foods at once: "chicken breast and rice", "2 eggs, toast and coffee".
// "with" isn't a separator: "latte with oat milk" is one drink.
// Used only when the whole phrase isn't one food ("mac and cheese" is).
//   { single } or { parts: [{ text, ...lookup(text) }] }
export function lookupMeal(query, limit = 25) {
  const single = lookup(query, limit);
  const listed = SEPARATOR.test(query);
  // A list stays whole only when it's a food's actual name ("macaroni and cheese").
  if (single.results.length && (listed ? single.how === "exact" : !single.unmatched.length)) return { single };
  const texts = query.split(SEPARATOR).map((t) => t.trim()).filter(Boolean);
  if (texts.length < 2) return { single };
  const parts = texts.map((text) => ({ text, ...lookup(text, limit) }));
  if (parts.some((p) => !p.results.length)) return { single };
  return { parts };
}
