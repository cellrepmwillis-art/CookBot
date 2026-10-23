import { searchFoods, closestFoods, findFood, portionsFor } from "./foods.js";
import { parseQuery, applyModifiers } from "./modifiers.js";

// Turns what someone typed into food choices, each with a plan saying how
// modifiers like "meat only" or "no cheese" change it.
//   { results: [plan], quantity, unmatched: [words nothing matched] }
// "large iced latte", "medium fries": preselect that size when the food has it.
const SIZE = /\b(small|medium|regular|large)\b/i;
const SIZE_LABELS = { small: ["small"], medium: ["medium", "regular"], regular: ["regular", "medium"], large: ["large"] };

function withSize(plan, size) {
  if (!size || plan.portion) return plan;
  const portion = portionsFor(plan.food).find((p) => SIZE_LABELS[size].some((w) => new RegExp(`\\b${w}\\b`, "i").test(p.label)));
  return portion ? { ...plan, portion } : plan;
}

export function lookup(query, limit = 25) {
  const parsed = lookupSized(query, limit);
  const size = query.match(SIZE)?.[1].toLowerCase();
  return { ...parsed, results: parsed.results.map((plan) => withSize(plan, size)) };
}

// how: "exact" (every word matched a food name), "loose" (after dropping
// filler words like "large") or "closest" (some words matched nothing).
function lookupSized(query, limit) {
  const { text, fullText, quantity, modifiers } = parseQuery(query);
  const plain = (foods) => foods.map((food) => applyModifiers(food, [], findFood));

  // USDA sometimes lists the modified version itself ("WHOPPER, no cheese").
  if (modifiers.length) {
    const exact = searchFoods(fullText, limit, { strict: true });
    if (exact.length) return { results: plain(exact), quantity, unmatched: [], how: "exact" };
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
  return { results, quantity, unmatched: [...new Set(unmatched)], how };
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
