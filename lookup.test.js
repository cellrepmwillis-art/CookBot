import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setFoods, portionsFor, caloriesFor } from "./foods.js";
import { parseQuery } from "./modifiers.js";
import { lookup, lookupMeal } from "./lookup.js";

setFoods(JSON.parse(readFileSync(new URL("./foods.json", import.meta.url))));

// Calories for the top result, the way the app shows them.
function topCalories(query) {
  const { results, quantity } = lookup(query);
  const plan = results[0];
  const portion = plan.portion ?? portionsFor(plan.food)[0];
  const units = quantity * plan.count;
  const adjustment = plan.adjustments.reduce((sum, a) => sum + a.calories, 0) * quantity;
  return { name: plan.name, calories: Math.max(0, caloriesFor(plan.food, portion.grams, units) + adjustment), plan };
}

test("counts and halves set the quantity", () => {
  assert.equal(parseQuery("2 eggs").quantity, 2);
  assert.equal(parseQuery("1.5 cups rice").quantity, 1.5);
  assert.equal(parseQuery("half a big mac").quantity, 0.5);
  assert.equal(parseQuery("banana").quantity, 1);
});

test("'meat only' in any phrasing counts just the patties", () => {
  for (const query of ["big mac meat only", "big Mac only the meat", "Big mac just the meat", "big mac patties only"]) {
    const { name, calories, plan } = topCalories(query);
    assert.match(name, /BIG MAC/, query);
    assert.equal(plan.count, 2, query); // a Big Mac has two patties
    assert.ok(calories > 150 && calories < 220, `${query}: ${calories}`);
  }
});

test("USDA's own modified versions are used when they exist", () => {
  assert.equal(topCalories("big mac no sauce").name, "McDONALD'S, BIG MAC (without Big Mac Sauce)");
  assert.equal(topCalories("whopper no cheese").name, "BURGER KING, WHOPPER, no cheese");
  assert.equal(topCalories("butter no salt").name, "Butter, without salt");
});

test("removing and adding parts adjusts the calories", () => {
  const plain = topCalories("quarter pounder").calories;
  const noBun = topCalories("quarter pounder no bun");
  assert.ok(noBun.calories < plain);
  assert.equal(topCalories("quarter pounder protein style").calories, noBun.calories);
  assert.ok(topCalories("mcdonalds cheeseburger extra cheese").calories > topCalories("mcdonalds cheeseburger").calories);
});

test("parts that don't apply are flagged, not guessed", () => {
  const { plan } = topCalories("pizza no cheese");
  assert.deepEqual(plan.adjustments, []);
  assert.match(plan.notes[0], /Couldn't adjust/);
  assert.match(topCalories("big mac no pickles").plan.notes[0], /almost no calories/);
});

test("nicknames and unknown words still find the food", () => {
  assert.equal(topCalories("mickey d's fries").name, "McDONALD'S, french fries");
  const { results, unmatched } = lookup("yummy big mac");
  assert.match(results[0].name, /BIG MAC/);
  assert.deepEqual(unmatched, ["yummy"]);
});

test("several foods in one search are split into parts", () => {
  const { parts } = lookupMeal("chicken breast and white rice");
  assert.equal(parts.length, 2);
  assert.match(parts[0].results[0].name, /^Chicken.*breast/i);
  assert.match(parts[1].results[0].name, /^Rice, white/);
  assert.equal(lookupMeal("2 eggs, toast and coffee").parts.length, 3);
  assert.equal(lookupMeal("2 eggs, toast and coffee").parts[0].quantity, 2);
});

test("foods with 'and' or 'with' in their name stay whole", () => {
  assert.ok(lookupMeal("macaroni and cheese").single);
  assert.ok(lookupMeal("whopper with cheese").single);
});
