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
