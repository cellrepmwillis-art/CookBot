import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setFoods, searchFoods, quantityFrom, portionsFor, caloriesFor } from "./foods.js";

setFoods(JSON.parse(readFileSync(new URL("./foods.json", import.meta.url))));
const top = (query) => searchFoods(query, 1)[0]?.[0];

test("everyday searches put the everyday food first", () => {
  assert.equal(top("banana"), "Bananas, raw");
  assert.equal(top("coffee"), "Beverages, coffee, brewed, prepared with tap water");
  assert.equal(top("coke"), "Beverages, carbonated, cola, regular (soft drink, pop, soda)");
  assert.equal(top("big mac"), "McDONALD'S, BIG MAC");
  assert.match(top("eggs"), /^Egg, whole, cooked/);
});

test("words match whole words or word starts, not the middle of a word", () => {
  assert.ok(searchFoods("cola", 50).every(([name]) => !/chocolate/i.test(name) || /\bcola\b/i.test(name)));
});

test("size words and counts are ignored when they'd block a match", () => {
  assert.match(top("large fries"), /french fri/i);
  assert.match(top("2 eggs"), /^Egg, whole/);
});

test("unknown foods return nothing", () => {
  assert.deepEqual(searchFoods("qwxyz"), []);
});

test("a leading count becomes the quantity", () => {
  assert.equal(quantityFrom("2 eggs"), 2);
  assert.equal(quantityFrom("1.5 cups rice"), 1.5);
  assert.equal(quantityFrom("banana"), 1);
});

test("calories scale with portion and quantity", () => {
  const banana = searchFoods("banana", 1)[0];
  const medium = portionsFor(banana).find((p) => p.label.startsWith("1 medium"));
  assert.equal(caloriesFor(banana, medium.grams, 1), 105); // USDA: 1 medium banana = 105 kcal
  assert.equal(caloriesFor(banana, medium.grams, 2), 210);
});
