// Turns whatever was typed into calories, with no questions asked: the
// closest food (or foods) is picked behind the scenes.
import { caloriesFor, portionsFor, matchedWords, isRestaurantQuery, isRestaurantFood, correctTypos, macrosFor } from "./foods.js";
import { lookupMeal } from "./lookup.js";

// Calories for `units` of a plan (see modifiers.js), e.g. 1 Big Mac, meat only.
export function planCalories(plan, portion, units) {
  const adjustment = plan.adjustments.reduce((sum, a) => sum + a.calories, 0);
  return Math.max(0, caloriesFor(plan.food, portion.grams, units) + Math.round(adjustment * (units / plan.count)));
}

const amount = (n) => String(Number(n.toFixed(2))); // 2/3 -> "0.67"

export function planItem(plan, quantity) {
  const portion = plan.portion ?? portionsFor(plan.food)[0];
  const units = quantity * plan.count;
  const calories = planCalories(plan, portion, units);
  return {
    name: plan.name,
    portion: `${amount(units)} × ${portion.label}`,
    calories,
    food: plan.source,
    // Split by the food that's counted (the patties of a "meat only" Big Mac).
    macros: macrosFor(plan.food, calories),
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

// The usual serving, or for "small"/"large" the low or high end of them.
function servingFor(servings, size) {
  const sorted = [...servings].sort((a, b) => a - b);
  if (size === "small") return sorted[Math.floor(sorted.length * 0.15)];
  if (size === "large") return sorted[Math.ceil(sorted.length * 0.85) - 1];
  return median(sorted);
}

const FLAVORED_MILK = /\b(chocolate|strawberry|banana|vanilla|coffee|protein|shake|ice cream|cottage|sour cream)\b/i;

function consensusItem(group, text) {
  const [top] = group.results;
  // Exact picks stay exact: the app's own everyday foods, meals and lattes,
  // the user's saved numbers, and orders changed with "meat only" or a size.
  const curated = top.food[3] || top.food[5] === "mine";
  // A portion picked from what was typed ("4 pieces", "8 oz") still averages.
  const picked = (plan) => !plan.portion || plan.countable || plan.sized;
  const changed = top.adjustments.length || top.count !== 1 || !picked(top);
  if (curated || changed) return planItem(top, group.quantity);

  const words = matchedWords(text, top.food);
  const restaurant = isRestaurantQuery(text) && isRestaurantFood(top.food);
  const kids = /\bkids?'?\b/i.test(text);
  // Raw or meatless versions only when asked for: "chicken tenders" are cooked chicken.
  // Sugar-free, diet and light versions too: a "red bull" is the regular one.
  const unusual = /\b(raw|uncooked|unprepared|dry mix|meatless|chicken-free|meat-free|plant-based|vegan|sugar[- ]?free|sugarfree|zero|diet|light|lite|sf|quorn|gardein|morningstar|beyond|impossible|tofurky)\b/i;
  const askedUnusual = unusual.test(text);
  // "lactaid milk" is plain milk, not its chocolate or protein milk.
  const plainMilk = /\bmilk\b/i.test(text) && !FLAVORED_MILK.test(text);
  let similar = group.results.filter((plan) =>
    !plan.adjustments.length && plan.count === 1 && picked(plan) &&
    matchedWords(text, plan.food) === words &&
    (!restaurant || isRestaurantFood(plan.food)) &&
    (kids || !/\bkids?'?\b/i.test(plan.food[0])) &&
    (askedUnusual || !unusual.test(plan.food[0])) &&
    (!plainMilk || !FLAVORED_MILK.test(plan.food[0])));
  // Counting pieces: only foods that come in pieces can be counted.
  if (group.counted && similar.some((plan) => plan.countable)) similar = similar.filter((plan) => plan.countable);
  similar = similar.slice(0, MAX_SIMILAR);
  if (similar.length < 2) return planItem(top, group.quantity);

  const name = `${top.name} (typical of ${similar.length} similar)`;
  if (group.counted && top.countable) {
    // Pieces: the middle calories per piece ("4-piece": strips from several chains).
    const items = similar.map((plan) => planItem(plan, group.quantity));
    const calories = median(items.map((i) => i.calories));
    return { name, portion: items[0].portion, calories, food: top.source, macros: macrosFor(top.food, calories) };
  }
  // Otherwise servings differ (an 8 oz shake, a 16 oz can), so take the middle
  // calories per 100 g and the middle serving size. Only products like the top
  // one count: "barebells" milkshakes aren't averaged with Barebells bars.
  // Products within 2x of a reference density; the reference is the top match
  // or the middle of all of them, whichever has more company, so one
  // mislabeled top entry (a "Redbull" that's really sugar-free) can't decide.
  const near = (ref) => similar.filter((plan) => (ref ? plan.food[1] >= ref / 2 && plan.food[1] <= ref * 2 : plan.food[1] < 5));
  const byTop = near(top.food[1]);
  const byMiddle = near(median(similar.map((plan) => plan.food[1])));
  const like = byMiddle.length > byTop.length ? byMiddle : byTop;
  const density = median(like.map((plan) => plan.food[1]));
  // A size that was typed ("8 oz") wins; else the usual labeled serving.
  const servings = like.filter((plan) => plan.food[2].length).map((plan) => portionsFor(plan.food)[0].grams);
  // "small red bull": the smaller of the usual servings (an 8.4 oz can, not 12).
  // "1 cup cottage cheese" when the top product's label only says "1 serving
  // (113 g)": the cup size from the products whose labels give one ("0.5 cup
  // (113 g)" makes a cup 226 g).
  const perUnit = !top.portion && group.unit ? like.filter((plan) => plan.sized).map((plan) => plan.portion.grams) : [];
  const grams = top.portion ? top.portion.grams : perUnit.length ? median(perUnit) : servings.length ? servingFor(servings, group.size) : portionsFor(top.food)[0].grams;
  const units = group.quantity * top.count;
  const label = top.portion?.label ?? (perUnit.length ? `1 ${group.unit} (${Math.round(grams)} g)` : `1 serving (${Math.round(grams)} g)`);
  const shown = like.includes(top) ? top : like[0]; // named after a product that was averaged
  const calories = Math.round((density * grams * units) / 100);
  return { name: `${shown.name} (typical of ${like.length} similar)`, portion: `${amount(units)} × ${label}`, calories, food: shown.source, macros: macrosFor(shown.food, calories) };
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

  // Typos are fixed behind the scenes; the entry keeps the words as typed.
  const text = correctTypos(label);
  const { single, parts } = lookupMeal(text, 25);
  const items = parts
    ? parts.map((part) => consensusItem(part, part.text))
    : single.results.length ? [consensusItem(single, text)] : [];
  if (!items.length) return null;
  return { label, items, total: items.reduce((sum, i) => sum + i.calories, 0), exact: false };
}
