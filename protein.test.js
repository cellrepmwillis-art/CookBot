import { test } from "node:test";
import assert from "node:assert/strict";
import { proteinTarget } from "./protein.js";

test("grams a day by weight and aim", () => {
  // 180 lb = 81.6 kg
  assert.equal(proteinTarget({ weightLb: 180, heightIn: 70, aim: "general" }), 65); // 0.8 g/kg
  assert.equal(proteinTarget({ weightLb: 180, heightIn: 70, aim: "active" }), 100); // 1.2 g/kg
  assert.equal(proteinTarget({ weightLb: 180, heightIn: 70, aim: "muscle" }), 130); // 1.6 g/kg
  assert.equal(proteinTarget({ weightLb: 180, heightIn: 70 }), 100); // active by default
});

test("higher body weights use the weight at a BMI of 30", () => {
  // 5'6" (66 in): BMI 30 is about 186 lb, so 260 lb counts as 186.
  assert.equal(proteinTarget({ weightLb: 260, heightIn: 66, aim: "active" }), proteinTarget({ weightLb: 186, heightIn: 66, aim: "active" }));
  assert.ok(proteinTarget({ weightLb: 260 }) > proteinTarget({ weightLb: 260, heightIn: 66 })); // no height: no cap
});

test("65 and older get at least 1.0 g/kg; no weight, no target", () => {
  assert.equal(proteinTarget({ weightLb: 180, heightIn: 70, age: 70, aim: "general" }), 80);
  assert.equal(proteinTarget({ weightLb: 180, heightIn: 70, age: 70, aim: "muscle" }), 130);
  assert.equal(proteinTarget({ heightIn: 70 }), null);
  assert.equal(proteinTarget(null), null);
});
