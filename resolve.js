// Turns whatever was typed into calories, with no questions asked: the
// closest food (or foods) is picked behind the scenes.
import { caloriesFor, portionsFor } from "./foods.js";
import { lookupMeal } from "./lookup.js";

// Calories for `units` of a plan (see modifiers.js), e.g. 1 Big Mac, meat only.
export function planCalories(plan, portion, units) {
  const adjustment = plan.adjustments.reduce((sum, a) => sum + a.calories, 0);
  return Math.max(0, caloriesFor(plan.food, portion.grams, units) + Math.round(adjustment * (units / plan.count)));
}

export function planItem(plan, quantity) {
  const portion = plan.portion ?? portionsFor(plan.food)[0];
  const units = quantity * plan.count;
  return {
    name: plan.name,
    portion: `${units} × ${portion.label}`,
    calories: planCalories(plan, portion, units),
    food: plan.source,
  };
}

// "sheetz special 300", "snack 250 cal", or just "300". A small number at
// the end ("pizza 3") is a count, not calories.
const EXPLICIT = /^(.*?)\s*\b(\d{1,4})\s*(k?cals?|calories)?$/i;

const key = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

// Returns { label, items: [{ name, portion, calories, food? }], total, exact }
// or null when nothing at all matches. exact: the number came from the user,
// either typed in or saved earlier under the same words.
export function resolve(query, myFoods = []) {
  const label = query.trim().replace(/\s+/g, " ");
  if (!label) return null;

  const explicit = label.match(EXPLICIT);
  if (explicit && (explicit[3] || !explicit[1] || Number(explicit[2]) >= 20)) {
    const name = explicit[1] || "Calories";
    const total = Number(explicit[2]);
    return { label: name, items: [{ name, portion: "", calories: total }], total, exact: true };
  }

  const mine = myFoods.find((f) => key(f[0]) === key(label));
  if (mine) return { label, items: [{ name: mine[0], portion: "", calories: mine[1] }], total: mine[1], exact: true };

  const { single, parts } = lookupMeal(label, 5);
  const items = parts
    ? parts.map((part) => planItem(part.results[0], part.quantity))
    : single.results.length ? [planItem(single.results[0], single.quantity)] : [];
  if (!items.length) return null;
  return { label, items, total: items.reduce((sum, i) => sum + i.calories, 0), exact: false };
}
