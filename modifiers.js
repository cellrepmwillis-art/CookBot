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
// "a quarter" needs "of" so "a quarter pounder" stays a burger.
const OF_A = String.raw`(?:\s+of)?(?:\s+(?:a|an|the))?\b`;
const FRACTIONS = [
  [new RegExp(String.raw`\b(\d+)\s*\/\s*(\d+)` + OF_A, "g"), (_, a, b) => (Number(b) ? Number(a) / Number(b) : 1)],
  [new RegExp(String.raw`\b(?:a|one)\s+third` + OF_A, "g"), 1 / 3],
  [new RegExp(String.raw`\btwo\s+thirds` + OF_A, "g"), 2 / 3],
  [new RegExp(String.raw`\bthree\s+quarters` + OF_A, "g"), 3 / 4],
  [new RegExp(String.raw`\b(?:a|one)\s+quarter\s+of(?:\s+(?:a|an|the))?\b`, "g"), 1 / 4],
];
// Not "half and half" (the cream).
const HALF = /\b(?<!half (?:and|&|n) )(?:half(?! (?:and|&|n) half\b)(?: of)?(?: a| an| the)?|1\/2(?: a| an| of)?)\b/g;

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20 };

// Words after a number that make it a measurement, not a count ("16 oz").
const UNITS = String.raw`(?:inch|inches|in|oz|ounce|ounces|g|grams?|lbs?|pounds?|ml|fl|percent|calories?|cals?|kcal)\b`;

const HOUSEHOLD = "cups?|tbsps?|tablespoons?|tsps?|teaspoons?|bowls?|slices?|pieces?|glass(?:es)?|cans?|bottles?|scoops?|servings?|strips?|links?|patties|patty";

// About how much a casual amount is.
const CASUAL_AMOUNTS = { drizzle: [2, "tsp"], splash: [2, "tbsp"], dollop: [2, "tbsp"], sprinkle: [1, "tsp"], spoonful: [1, "tbsp"], squirt: [1, "tbsp"], pat: [1, "pat"] };
const CASUAL = /\b(?:a\s+)?(drizzle|splash|dollop|sprinkle|spoonful|squirt|pat)(?:d|s)?(?:\s+of)?\b/;

// Splits a search into the food to look up, a quantity, and modifiers.
// fullText keeps the modifier words, for foods USDA already lists that way.
export function parseQuery(query) {
  let q = ` ${query.toLowerCase().replace(/[’']/g, "'")} `;
  // "2/3 of a red bull", "a third of", "three quarters of": a fraction of one.
  let fraction = 1;
  for (const [pattern, value] of FRACTIONS) {
    q = q.replace(pattern, (...m) => {
      fraction *= typeof value === "function" ? value(...m) : value;
      return " ";
    });
  }
  // "four piece", "a dozen wings": number words as digits.
  q = q.replace(/\bhalf (?:a )?dozen\b/g, "6").replace(/\b(?:a )?dozen\b/g, "12")
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b(?=\\s*-?\\s*[a-z])`, "g"), (w) => NUMBER_WORDS[w]);
  // "no skin", "without the skin": skinless.
  q = q.replace(/\b(?:no|without|w\/o|minus)\s+(?:the\s+)?skin\b|\bskin\s+off\b/g, " skinless ");
  let quantity = 1;
  // the quantity is a count of pieces ("4-piece", "4 tenders") or of a measure
  // ("1/2 cup"); "2/3 of a red bull" is just part of one.
  let counted = fraction !== 1 && new RegExp(`^\\s*(?:${HOUSEHOLD})\\b`).test(q);
  // "single espresso shot", "double shot of espresso", "1 shot espresso",
  // "espresso 2 shots": a number of shots.
  const shots = q.match(/\b(single|double|triple|quad|one|two|three|four|\d{1,2})\s+(?:shots?\s+(?:of\s+)?)?espresso(?:\s+shots?)?\b/) ||
    q.match(/\bespresso\s+(\d{1,2})\s+shots?\b/);
  if (shots) {
    quantity = { single: 1, one: 1, double: 2, two: 2, triple: 3, three: 3, quad: 4, four: 4 }[shots[1]] ?? Number(shots[1]);
    counted = true;
    q = q.slice(0, shots.index) + " espresso " + q.slice(shots.index + shots[0].length);
  }
  const pieces = !shots && q.match(/\b(\d{1,3})\s*-?\s*(?:piece|pieces|pc|pcs|ct|count)\b/);
  if (pieces) {
    quantity = Number(pieces[1]);
    counted = true;
    q = q.slice(0, pieces.index) + " " + q.slice(pieces.index + pieces[0].length);
  }
  const lead = !shots && !pieces && q.match(new RegExp(`^\\s*(\\d+(?:\\.\\d+)?|\\.\\d+|an?|one|two|three|four)\\s(?!${UNITS})`));
  if (lead) {
    quantity = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 }[lead[1]] ?? Number(lead[1]);
    counted = !/^an?$/.test(lead[1]);
    q = q.slice(lead[0].length - 1);
  }
  // "kfc 3 strips": a number before a food is a count, unless it's a
  // measurement ("6 inch sub", "16 oz latte").
  const middle = !shots && !pieces && !lead && q.match(new RegExp(`\\s(\\d{1,2})\\s+(?!${UNITS})(?=[a-z])`));
  if (middle) {
    quantity = Number(middle[1]);
    counted = true;
    q = q.slice(0, middle.index) + " " + q.slice(middle.index + middle[0].length);
  }
  // "pizza 3": a small number at the end is a count too.
  const tail = !shots && !pieces && !lead && !middle && q.match(/\s(\d{1,2})\s*$/);
  if (tail && Number(tail[1]) < 20) {
    quantity = Number(tail[1]);
    counted = true;
    q = q.slice(0, tail.index) + " ";
  }
  if (HALF.test(q)) {
    quantity *= 0.5;
    q = q.replace(HALF, " ");
  }
  // "16 oz", "6 inch" pick a portion (see lookup.js), so they aren't searched for.
  q = q.replace(new RegExp(String.raw`\b\d+(?:\.\d+)?\s*-?\s*${UNITS}`, "g"), " ");
  // "2 cups rice", "3 slices pizza", and with no number "tablespoon of peanut
  // butter" or "a cup of coffee" (one of the measure): it picks the portion.
  let unit = null;
  const measure = q.match(new RegExp(`^\\s*(${HOUSEHOLD})\\b`));
  if (measure) {
    counted = true;
    unit = measure[1].replace(/(es|s)$/, "").replace(/^tablespoon$/, "tbsp").replace(/^teaspoon$/, "tsp");
    q = q.slice(measure.index + measure[0].length);
    q = q.replace(/^\s*of\b/, " ");
  }
  // "a drizzle of olive oil", "a splash of milk": everyday amounts.
  const casual = !unit && q.match(CASUAL);
  if (casual) {
    const [n, casualUnit] = CASUAL_AMOUNTS[casual[1]];
    quantity *= n;
    unit = casualUnit;
    counted = true;
    q = q.slice(0, casual.index) + " " + q.slice(casual.index + casual[0].length);
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

  quantity *= fraction;
  const text = q.replace(/\s+/g, " ").trim();
  // What's being counted: "piece" for "4-piece", else the last word ("breasts").
  const countNoun = pieces ? "piece" : counted ? (text.split(" ").filter((w) => !/^(only|just|extra|large|small|medium|regular)$/.test(w)).pop() ?? "").replace(/(es|s)$/, "") : null;
  return { text, fullText, quantity, counted, countNoun, unit, modifiers };
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
