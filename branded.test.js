import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { setFoods, searchFoods, portionsFor, caloriesFor } from "./foods.js";

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const hasBranded = existsSync(new URL("./branded.json", import.meta.url));
if (hasBranded) setFoods(read("./foods.json").concat(read("./branded.json")));
const names = (query, n = 10) => searchFoods(query, n).map((f) => f[0]);

test("brand searches find the brand's products", { skip: !hasBranded && "branded.json not built yet" }, () => {
  for (const brand of ["fairlife", "barebells", "core power", "premier protein", "quest", "siete", "thrive market"]) {
    const found = names(brand);
    assert.ok(found.length > 0, `${brand}: nothing found`);
    assert.ok(found.every((n) => n.toLowerCase().replace(/!/g, "i").includes(brand.split(" ")[0])), `${brand}: ${found}`);
  }
});

test("common misspellings find the brand", { skip: !hasBranded && "branded.json not built yet" }, () => {
  assert.match(names("barbell")[0], /barebells/i);
  assert.match(names("fair life milk")[0], /fairlife/i);
});

test("generic searches still put everyday foods first", { skip: !hasBranded && "branded.json not built yet" }, () => {
  assert.equal(names("banana")[0], "Bananas, raw");
  assert.match(names("milk")[0], /^Milk, whole/);
});

test("branded serving calories are believable", { skip: !hasBranded && "branded.json not built yet" }, () => {
  // Core Power 26 g protein shake: 170 cal per 14 fl oz bottle on the label.
  const shake = searchFoods("core power chocolate", 5).find((f) => f[2].length && /414/.test(f[2][0][1]));
  if (shake) {
    const [serving] = portionsFor(shake);
    const cal = caloriesFor(shake, serving.grams, 1);
    assert.ok(cal > 140 && cal < 240, `${shake[0]}: ${cal}`);
  }
});
