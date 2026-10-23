import { searchFoods, closestFoods, findFood } from "./foods.js";
import { parseQuery, applyModifiers } from "./modifiers.js";

// Turns what someone typed into food choices, each with a plan saying how
// modifiers like "meat only" or "no cheese" change it.
//   { results: [plan], quantity, unmatched: [words nothing matched] }
export function lookup(query, limit = 25) {
  const { text, fullText, quantity, modifiers } = parseQuery(query);
  const plain = (foods) => foods.map((food) => applyModifiers(food, [], findFood));

  // USDA sometimes lists the modified version itself ("WHOPPER, no cheese").
  if (modifiers.length) {
    const exact = searchFoods(fullText, limit, { strict: true });
    if (exact.length) return { results: plain(exact), quantity, unmatched: [] };
  }

  let foods = text ? searchFoods(text, limit) : [];
  let unmatched = [];
  if (text && !foods.length) ({ foods, unmatched } = closestFoods(text, limit));
  // "Meat only" turns several burgers into the same patties; list each once.
  const seen = new Set();
  const results = foods.map((food) => applyModifiers(food, modifiers, findFood)).filter((plan) => {
    const key = plan.food === findFood(plan.name) ? plan.name : `${plan.food[0]}|${plan.count}|${plan.adjustments.map((a) => a.calories)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { results, quantity, unmatched };
}

// Several foods at once: "chicken breast and rice", "coffee with milk, bagel".
// Used only when the whole phrase isn't one food ("mac and cheese" is).
//   { single } or { parts: [{ text, ...lookup(text) }] }
export function lookupMeal(query, limit = 25) {
  const single = lookup(query, limit);
  if (single.results.length && !single.unmatched.length) return { single };
  const texts = query.split(/\s*(?:,|\+|&|\band\b|\bwith\b|\bplus\b)\s*/i).map((t) => t.trim()).filter(Boolean);
  if (texts.length < 2) return { single };
  const parts = texts.map((text) => ({ text, ...lookup(text, limit) }));
  if (parts.some((p) => !p.results.length)) return { single };
  return { parts };
}
