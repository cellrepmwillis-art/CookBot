import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { setFoods } from "./foods.js";
import { resolve } from "./resolve.js";

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const hasBranded = existsSync(new URL("./branded.json", import.meta.url));
setFoods(read("./foods.json").concat(hasBranded ? read("./branded.json") : []));
const total = (query) => resolve(query)?.total;
const names = (query) => resolve(query)?.items.map((i) => i.name);
// Equal up to rounding: 3 strips are rounded once, 1 strip times 3 three times.
const near = (a, b) => assert.ok(Math.abs(a - b) <= 2, `${a} vs ${b}`);

test("a long, casual order picks one drink with every detail applied", () => {
  const r = resolve("sheetz iced latte regular with an extra shot made with oat milk");
  assert.deepEqual(r.items.map((i) => i.name), ["Latte, iced, oat milk, extra shot"]);
  assert.match(r.items[0].portion, /Regular, 16 oz/);
  assert.ok(r.total > 120 && r.total < 160, `${r.total}`);
  assert.equal(r.exact, false);
});

test("lists become separate items; food names with 'and' stay whole", () => {
  assert.deepEqual(names("2 eggs, toast and coffee").length, 3);
  assert.match(names("2 eggs, toast and coffee")[0], /^Egg, whole/);
  assert.equal(names("eggs and toast").length, 1);
  assert.equal(names("chicken breast and rice").length, 2);
});

test("restaurants that aren't in the data are ignored, not matched to their sauces", () => {
  assert.match(names("wawa hoagie")[0], /submarine sandwich/);
  assert.match(names("chipotle burrito bowl")[0], /^Burrito bowl/);
  assert.match(names("starbucks latte")[0], /^Latte/);
});

test("everyday meals are recognized", () => {
  for (const [query, name] of [["bowl of cereal with milk", "Cereal with milk"], ["grilled cheese", "Grilled cheese, sandwich"], ["coffee with milk", "Coffee with milk"], ["turkey sandwich", "Turkey sandwich"]]) {
    assert.equal(names(query)[0], name, query);
  }
  assert.equal(names("eggs")[0], "Egg, whole, cooked, fried"); // one word of a meal isn't the meal
});

test("typed numbers are used as is", () => {
  assert.deepEqual(resolve("sheetz special 300"), { label: "sheetz special", items: [{ name: "sheetz special", portion: "", calories: 300 }], total: 300, exact: true });
  assert.equal(total("snack 250 cal"), 250);
  assert.equal(resolve("300").total, 300);
  assert.equal(resolve("pizza 3").exact, false); // a count, not 3 calories
  assert.ok(total("pizza 3") > 600);
});

test("saved foods win for the same words", () => {
  const mine = [["sheetz iced latte regular with an extra shot made with oat milk", 150, [["1 serving (as you entered it)", 100]], 1, "", "mine"]];
  const r = resolve("Sheetz iced latte regular with an extra shot made with oat milk", mine);
  assert.equal(r.total, 150);
  assert.equal(r.exact, true);
});

test("nothing at all matching returns null", () => {
  assert.equal(resolve("qzx"), null);
  assert.equal(resolve("   "), null);
});

test("restaurant orders count pieces and average similar restaurants", { skip: !hasBranded && "needs branded.json" }, () => {
  // Bojangles 4-piece Chicken Supremes: about 500 cal. Within 10%.
  for (const query of ["bojangles 4-piece supreme", "4 piece bojangles tenders"]) {
    const r = resolve(query);
    assert.ok(r.total >= 450 && r.total <= 550, `${query}: ${r.total}`);
    assert.match(r.items[0].name, /typical of \d+ similar/, query);
  }
  near(total("kfc 3 strips"), 3 * total("kfc 1 strip"));
});

test("counts are pieces; measurements pick a size; household measures pick a portion", () => {
  assert.ok(total("6 piece mcnuggets") < 400, "6 nuggets, not 6 servings");
  assert.equal(resolve("12 oz iced oat latte").items[0].portion.startsWith("1 × Small"), true);
  assert.match(resolve("16 oz coffee").items[0].portion, /16 fl oz/);
  near(total("2 tbsp peanut butter"), 2 * total("1 tbsp peanut butter"));
  assert.ok(total("2 tbsp peanut butter") > 170 && total("2 tbsp peanut butter") < 210); // label: 190
  near(total("2 cups rice"), 2 * total("1 cup rice"));
});

test("exact picks aren't averaged", () => {
  assert.equal(names("sheetz iced latte regular with an extra shot made with oat milk")[0], "Latte, iced, oat milk, extra shot");
  assert.equal(names("banana")[0], "Bananas, raw");
  assert.equal(names("big mac meat only")[0], "McDonald's Big Mac, meat only");
});

test("typos and number words in a restaurant order", { skip: !hasBranded && "needs branded.json" }, () => {
  // Typed on a phone: "four piece bpjangle supreme" once logged 5,269 cal (four supreme pizzas).
  for (const query of ["four piece bpjangle supreme", "four piece bojangle supremes", "four piece bojangles supreme"]) {
    const r = resolve(query);
    assert.ok(r.total >= 450 && r.total <= 550, `${query}: ${r.total}`);
    assert.equal(r.label, query); // the entry keeps the words as typed
  }
  near(total("a dozen wings"), 2 * total("6 wings"));
  assert.equal(total("two eggs"), total("2 eggs"));
});

test("misspelled food words are corrected; real words are left alone", () => {
  assert.equal(names("bananna")[0], "Bananas, raw");
  assert.match(names("chiken tendrs")[0], /chicken/i);
  assert.match(names("6 piece mcnuggets")[0], /McNUGGETS/); // not "corrected" to "nuggets"
  assert.equal(resolve("qzx"), null); // nothing close: still nothing
});

test("espresso by the shot, even with coffee capsules and canned drinks in the data", { skip: !hasBranded && "needs branded.json" }, () => {
  // "single espresso shot" once matched a 0-cal Nespresso "Single Origin" capsule.
  for (const [query, shots] of [["single espresso shot", 1], ["single shot espresso", 1], ["espresso", 1], ["double espresso", 2], ["double shot of espresso", 2], ["triple espresso", 3]]) {
    const r = resolve(query);
    assert.match(r.items[0].name, /espresso, restaurant-prepared$/, query);
    assert.ok(r.total >= 2 * shots && r.total <= 3 * shots, `${query}: ${r.total}`);
  }
});

test("counting uses the thing named: two chicken breasts aren't two deli slices", { skip: !hasBranded && "needs branded.json" }, () => {
  // "two rotisserie chicken breasts" once logged 28 cal: 2 slices of packaged deli chicken.
  for (const query of ["two rotisserie chicken breasts", "two food lion rotisserie chicken breasts"]) {
    const r = resolve(query);
    assert.equal(r.items[0].name, "Chicken, rotisserie, breast with skin", query);
    assert.ok(r.total > 550 && r.total < 750, `${query}: ${r.total}`); // two sides with skin
  }
  assert.equal(names("rotisserie chicken breast skinless")[0], "Chicken, rotisserie, breast, skinless (meat only)");
  assert.equal(names("rotisserie chicken breast no skin")[0], "Chicken, rotisserie, breast, skinless (meat only)");
  assert.ok(total("2 chicken breasts") > 450, "two store-bought breasts, not two small fryer halves");
  assert.equal(total("grilled chicken breast"), total("chicken breast"));
});

test("store names don't pull in store-brand products of a different food", { skip: !hasBranded && "needs branded.json" }, () => {
  assert.doesNotMatch(names("food lion rotisserie chicken breast")[0], /food lion/i); // not its canned chicken
  assert.match(names("food lion peanut butter")[0], /food lion/i); // but its own peanut butter, yes
});

test("plurals of known words aren't 'corrected'", { skip: !hasBranded && "needs branded.json" }, () => {
  assert.match(names("2 big macs")[0], /big mac/i);
});

test("energy drinks: regular, not sugar-free, at the size typed", { skip: !hasBranded && "needs branded.json" }, () => {
  // Labels: Red Bull 110 per 8.4 oz, 160 per 12 oz; Monster 210 per 16 oz. Within 10%.
  const within = (query, label) => {
    const t = total(query);
    assert.ok(Math.abs(t - label) <= label * 0.1, `${query}: ${t}, label ${label}`);
  };
  within("8oz redbull can", 105); // "8oz redbull can" once logged 12 cal (sugar-free versions)
  within("8.4 oz red bull", 110);
  within("12 oz red bull", 160);
  within("16 oz monster", 210);
  assert.ok(total("sugar free red bull") < 20);
  within("drpepper", 150);
});

test("fractions and size words: '2/3 small red bull can'", { skip: !hasBranded && "needs branded.json" }, () => {
  // Small Red Bull: 110 cal per 8.4 oz can; two thirds of it is about 73. Once logged 131.
  const r = resolve("2/3 small red bull can");
  assert.ok(r.total >= 66 && r.total <= 81, `${r.total}`);
  assert.match(r.items[0].portion, /^0\.67 ×/);
  assert.ok(total("small red bull") < total("large red bull"));
  near(total("1/2 cup rice"), total("1 cup rice") / 2);
  near(total("half a big mac"), total("big mac") / 2);
  assert.match(names("a quarter pounder")[0], /McDONALD'S, QUARTER POUNDER/); // not a quarter of something, not Quorn's
});

test("'X with Y': one food when it is one, else two; casual amounts", () => {
  // "one cup iceberg salad with olive oil drizzle" once logged 221 (a packaged tuna salad).
  const salad = resolve("one cup iceberg salad with olive oil drizzle");
  assert.equal(salad.items.length, 2);
  assert.ok(salad.total > 60 && salad.total < 130, `${salad.total}`); // ~10 lettuce + ~80 for 2 tsp oil
  assert.deepEqual(names("toast with butter").length, 2);
  assert.ok(total("coffee with a splash of milk") < 40);
  assert.equal(names("latte with oat milk")[0], "Latte, hot, oat milk");
  assert.equal(names("bagel with cream cheese").length, 1);
  assert.equal(names("salad with olive oil")[0], "Salad, garden");
  assert.ok(total("oatmeal with honey") < 450, "a spoonful of honey, not a cup");
  near(total("a drizzle of olive oil"), total("2 tsp olive oil"));
});

test("restaurant drinks: the drink, not a sauce from the same place; size words pick sizes", () => {
  // "one cup McDonald's sweet tea" once matched McDonald's Sweet 'N Sour Sauce.
  assert.equal(names("one cup McDonald's sweet tea")[0], "Sweet tea, iced");
  assert.ok(total("small mcdonalds sweet tea") < total("medium sweet tea"));
  assert.ok(total("medium sweet tea") < total("large mcdonalds sweet tea"));
  assert.equal(names("large mcdonalds sweet tea")[0], "Sweet tea, iced"); // not a product named "..., Large"
  assert.ok(total("iced tea") < 10);
  assert.ok(total("large fries") > total("medium fries"));
});

test("a measure with no number means one of it", { skip: !hasBranded && "needs branded.json" }, () => {
  // "tablespoon peter pan peanut butter" once logged the 2-tbsp label serving (206). Label: ~95 per tbsp.
  const r = resolve("tablespoon peter pan peanut butter");
  assert.ok(r.total >= 85 && r.total <= 110, `${r.total}`);
  near(total("2 tablespoons peter pan peanut butter"), 2 * r.total);
  assert.ok(total("a tablespoon of peanut butter") < 110);
  assert.match(names("can of coke")[0], /cola/);
  assert.match(resolve("cup of coffee").items[0].portion, /1 cup/);
});
