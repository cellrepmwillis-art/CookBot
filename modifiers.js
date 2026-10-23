// Understands everyday ways of changing an order, like "big mac meat only",
// "whopper no cheese", "half a sandwich" or "burger protein style", and
// adjusts calories using USDA values for the parts involved.

// Words for each part, mapped to one name.
const PART_WORDS = {
  meat: ["meat", "beef", "patty", "patties", "burger", "burgers"],
  bun: ["bun", "buns", "bread", "roll"],
  cheese: ["cheese"],
  sauce: ["sauce", "mayo", "mayonnaise", "special"],
  ketchup: ["ketchup", "catsup"],
  bacon: ["bacon"],
  espresso: ["shot", "shots", "espresso"],
  veggies: ["lettuce", "tomato", "tomatoes", "onion", "onions", "pickle", "pickles", "mustard", "ice", "veggies", "vegetables"],
};
const PART_OF = Object.fromEntries(Object.entries(PART_WORDS).flatMap(([part, ws]) => ws.map((w) => [w, part])));

// USDA foods and amounts used for each part (grams per part).
const PATTY_FOOD = "Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled (Hamburger)";
const PARTS = {
  bun: { food: "Rolls, hamburger or hotdog, plain", grams: 44, label: "bun" },
  cheese: { food: "Cheese, pasteurized process, American, without added vitamin D", grams: 21, label: "slice of cheese" },
  sauce: { food: "Salad dressing, mayonnaise, regular", grams: 13.8, label: "tbsp of sauce" },
  ketchup: { food: "Catsup (Ketchup)", grams: 17, label: "tbsp of ketchup" },
  bacon: { food: "Pork, cured, bacon, cooked, baked", grams: 16.2, label: "2 slices of bacon" },
  espresso: { food: "Beverages, coffee, brewed, espresso, restaurant-prepared", grams: 30, label: "shot of espresso", fits: "coffee" },
};
// A regular fast-food patty is 1.6 oz raw, about 34 g cooked; a quarter-pound
// patty is about 77 g cooked (USDA: "1 patty, yield from 1/4 lb raw meat").
const REGULAR_PATTY = { label: "regular patty (1.6 oz raw)", plural: "regular patties (1.6 oz raw each)", grams: 34 };
const LARGE_PATTY = { label: "1/4 lb patty", plural: "1/4 lb patties", grams: 77 };

const BURGER = /burger|big mac|whopper|quarter pounder|patty|slider/i;
// Which foods each kind of part can be added to or removed from.
const FITS = {
  sandwich: /burger|big mac|whopper|quarter pounder|slider|sandwich|sub\b|hoagie|wrap|hot dog|frankfurter|biscuit|mcmuffin/i,
  coffee: /latte|coffee|americano|cappuccino|macchiato|mocha|espresso|cold brew|flat white/i,
};

const pattyCount = (name) => (/triple/i.test(name) ? 3 : /double|big mac/i.test(name) ? 2 : 1);
const pattySize = (name) => (/quarter pounder|whopper|large patty|1\/4 ?lb/i.test(name) ? LARGE_PATTY : REGULAR_PATTY);
const bunCount = (name) => (/big mac|double decker/i.test(name) ? 1.5 : 1); // three-piece bun

const REMOVE = /\b(?:no|without|w\/o|minus|hold(?: the)?)\s+(?:the\s+)?([a-z]+)/g;
const ONLY_BEFORE = /\b(?:only|just)\s+(?:the\s+)?([a-z]+)/g;
const ONLY_AFTER = /\b([a-z]+)\s+only\b/g;
const EXTRA = /\b(?:extra|add|plus|with extra)\s+(?:an?\s+|one\s+)?([a-z]+)(?:\s+shots?\b)?/g;
const NO_BUN = /\b(?:protein[- ]style|lettuce[- ]wrap(?:ped)?|bunless|no[- ]bun)\b/g;
const HALF = /\b(?:half(?: of)?(?: a| an| the)?|1\/2(?: a| an| of)?)\b/g;

// Splits a search into the food to look up, a quantity, and modifiers.
// fullText keeps the modifier words, for foods USDA already lists that way.
export function parseQuery(query) {
  let q = ` ${query.toLowerCase().replace(/[’']/g, "'")} `;
  let quantity = 1;
  const lead = q.match(/^\s*(\d+(?:\.\d+)?|\.\d+|an?|one|two|three|four)\s/);
  if (lead) {
    quantity = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 }[lead[1]] ?? Number(lead[1]);
    q = q.slice(lead[0].length - 1);
  }
  // "pizza 3": a small number at the end is a count too.
  const tail = !lead && q.match(/\s(\d{1,2})\s*$/);
  if (tail && Number(tail[1]) < 20) {
    quantity = Number(tail[1]);
    q = q.slice(0, tail.index) + " ";
  }
  if (HALF.test(q)) {
    quantity *= 0.5;
    q = q.replace(HALF, " ");
  }
  const fullText = q.replace(/\bw\/o\b|\bno\b/g, "without").replace(/\s+/g, " ").trim();

  const modifiers = [];
  const take = (regex, type, fixedPart) => {
    q = q.replace(regex, (match, word) => {
      const part = fixedPart ?? PART_OF[word];
      if (!part && type !== "remove") return match; // "big mac only" etc.: leave it in the search
      if (type === "only" && part !== "meat") return match; // "just espresso" is a food, not a change
      modifiers.push({ type, part: part ?? word, text: match.trim() });
      return " ";
    });
  };
  take(NO_BUN, "remove", "bun");
  take(ONLY_BEFORE, "only");
  take(ONLY_AFTER, "only");
  take(REMOVE, "remove");
  take(EXTRA, "extra");
  q = q.replace(/\b(?:only|just)\b/g, " ");

  return { text: q.replace(/\s+/g, " ").trim(), fullText, quantity, modifiers };
}

// What a set of modifiers does to one food. Returns
//   { name, source, food, portion, count, adjustments: [{label, calories}], notes: [] }
// where source is the food searched for and food the one counted (they differ
// for "meat only", which counts patties),
// count multiplies the quantity, portion (if set) is the portion to
// preselect, and adjustments are calories added (or removed) per item.
export function applyModifiers(food, modifiers, findFood) {
  const name = food[0];
  const plan = { name, source: food, food, portion: null, count: 1, adjustments: [], notes: [] };
  if (!modifiers.length) return plan;

  const partCalories = (part) => {
    const spec = PARTS[part];
    const partFood = spec && findFood(spec.food);
    return partFood ? Math.round((partFood[1] * spec.grams) / 100) : null;
  };
  const isBurger = BURGER.test(name);
  const labels = [];

  for (const mod of modifiers) {
    labels.push(mod.text);
    if (mod.part === "veggies") {
      plan.notes.push(`"${mod.text}": almost no calories, so no change`);
      continue;
    }
    if (mod.part === "meat" && isBurger) {
      const patty = findFood(PATTY_FOOD);
      const n = pattyCount(name);
      if (mod.type === "only") {
        plan.food = patty;
        plan.portion = pattySize(name);
        plan.count = n;
        plan.adjustments = [];
        const size = pattySize(name);
        plan.notes.push(`Counted as ${n} ${n > 1 ? size.plural : size.label} of beef`);
      } else {
        const each = Math.round((patty[1] * pattySize(name).grams) / 100);
        if (plan.portion && mod.type === "extra") plan.count += 1; // already counting patties
        else if (mod.type === "remove") plan.adjustments.push({ label: `no meat (${n} ${n > 1 ? "patties" : "patty"})`, calories: -each * n });
        else plan.adjustments.push({ label: "extra patty", calories: each });
      }
      continue;
    }
    const cal = partCalories(mod.part);
    if (cal == null || mod.type === "only" || !FITS[PARTS[mod.part].fits ?? "sandwich"].test(name)) {
      plan.notes.push(`Couldn't adjust for "${mod.text}". Change the calories if needed`);
      continue;
    }
    const count = mod.part === "bun" ? bunCount(name) : 1;
    const label = mod.part === "bun" && count > 1 ? "3-piece bun" : PARTS[mod.part].label;
    if (mod.type === "remove") plan.adjustments.push({ label: `no ${label}`, calories: -Math.round(cal * count) });
    else plan.adjustments.push({ label: `extra ${label}`, calories: cal });
  }

  plan.name = `${name}, ${labels.join(", ")}`;
  return plan;
}
