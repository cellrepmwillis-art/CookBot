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
