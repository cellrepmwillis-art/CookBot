// Turns whatever was typed into calories, with no questions asked: the
// closest food (or foods) is picked behind the scenes.
import { caloriesFor, portionsFor, matchedWords, isRestaurantQuery, isRestaurantFood } from "./foods.js";
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

// Several foods often match equally well ("bojangles 4-piece supreme" matches
// chicken strips from Burger King, KFC, Popeyes, Chick-fil-A...), and any one
// of them can be off. The middle of their calories is a steadier guess than
// whichever ranked first, and a median isn't thrown off by one odd entry.
const MAX_SIMILAR = 9;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function consensusItem(group, text) {
  const [top] = group.results;
  // Exact picks stay exact: the app's own everyday foods, meals and lattes,
  // the user's saved numbers, and orders changed with "meat only" or a size.
  const curated = top.food[3] || top.food[5] === "mine";
  const changed = top.adjustments.length || top.count !== 1 || (top.portion && !top.countable);
  if (curated || changed) return planItem(top, group.quantity);

  const words = matchedWords(text, top.food);
  const restaurant = isRestaurantQuery(text) && isRestaurantFood(top.food);
  const kids = /\bkids?'?\b/i.test(text);
  // Raw or meatless versions only when asked for: "chicken tenders" are cooked chicken.
  const unusual = /\b(raw|uncooked|unprepared|dry mix|meatless|chicken-free|meat-free|plant-based|vegan)\b/i;
  const askedUnusual = unusual.test(text);
  let similar = group.results.filter((plan) =>
    !plan.adjustments.length && plan.count === 1 && !(plan.portion && !plan.countable) &&
    matchedWords(text, plan.food) === words &&
    (!restaurant || isRestaurantFood(plan.food)) &&
    (kids || !/\bkids?'?\b/i.test(plan.food[0])) &&
    (askedUnusual || !unusual.test(plan.food[0])));
  // Counting pieces: only foods that come in pieces can be counted.
  if (group.counted && similar.some((plan) => plan.countable)) similar = similar.filter((plan) => plan.countable);
  similar = similar.slice(0, MAX_SIMILAR);
  if (similar.length < 2) return planItem(top, group.quantity);

  const items = similar.map((plan) => planItem(plan, group.quantity));
  const calories = median(items.map((i) => i.calories));
  return { name: `${top.name} (typical of ${items.length} similar)`, portion: items[0].portion, calories, food: top.source };
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

  const { single, parts } = lookupMeal(label, 25);
  const items = parts
    ? parts.map((part) => consensusItem(part, part.text))
    : single.results.length ? [consensusItem(single, label)] : [];
  if (!items.length) return null;
  return { label, items, total: items.reduce((sum, i) => sum + i.calories, 0), exact: false };
}
