import { test } from "node:test";
import assert from "node:assert/strict";
import { proteinTarget, calorieSuggestion } from "./profile.js";

const me = { sex: "male", age: 35, heightIn: 70, weightLb: 180 };

test("protein: about 1 g per pound to gain or cut, 0.8 to maintain", () => {
  assert.equal(proteinTarget({ ...me, aim: "gain" }), 180);
  assert.equal(proteinTarget({ ...me, aim: "cut" }), 180);
  assert.equal(proteinTarget({ ...me, aim: "maintain" }), 145);
  assert.equal(proteinTarget({ ...me }), 145); // maintain by default
});

test("protein: past a BMI of 30, the weight at a BMI of 30 for the height", () => {
  // 5'6" (66 in): BMI 30 is about 186 lb.
  assert.equal(proteinTarget({ weightLb: 260, heightIn: 66, aim: "cut" }), 185);
  assert.equal(proteinTarget({ weightLb: 260, aim: "cut" }), 260); // no height, no cap
  assert.equal(proteinTarget({ heightIn: 70 }), null);
});

test("calories: Mifflin-St Jeor maintenance, moderately active, adjusted by aim", () => {
  // 180 lb, 5'10", 35, male: BMR = 10*81.65 + 6.25*177.8 - 5*35 + 5 = 1757; x1.55 = 2723.
  const maintain = calorieSuggestion({ ...me, aim: "maintain" });
  assert.equal(maintain.maintenance, 2700);
  assert.equal(maintain.goal, 2700);
  assert.equal(calorieSuggestion({ ...me, aim: "cut" }).goal, 2200);
  assert.equal(calorieSuggestion({ ...me, aim: "gain" }).goal, 3000);
  assert.ok(calorieSuggestion({ ...me, sex: "female" }).maintenance < maintain.maintenance);
});

test("calories: never under the usual minimum; needs age, height and weight", () => {
  const small = { sex: "female", age: 60, heightIn: 59, weightLb: 100, aim: "cut" };
  assert.equal(calorieSuggestion(small).goal, 1200);
  assert.equal(calorieSuggestion({ ...me, age: null }), null);
});
