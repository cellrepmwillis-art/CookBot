import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommend, mealSlot, RECOMMENDED, _CHOICES } from "./recommend.js";
import { setFoods, addFoods } from "./foods.js";
import { resolve } from "./resolve.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 2, `${actual} vs ${expected}`);

test("meal slots by hour", () => {
  assert.deepEqual([7, 12, 16, 19, 23, 1].map(mealSlot), ["b", "l", "s", "d", "n", "n"]);
});

test("over or at the goal: no food", () => {
  assert.equal(recommend({ remaining: -200, hour: 19 }).query, null);
  assert.match(recommend({ remaining: 40, hour: 22 }).text, /herbal tea/);
});

test("fits the time of day and the calories left", () => {
  const dinner = recommend({ remaining: 600, hour: 19, eaten: { protein: 80, carbs: 150, fat: 50 }, proteinGoal: 150 });
  assert.ok(["chicken breast and rice", "steak and baked potato", "steak and vegetables", "steak", "salmon and vegetables", "chicken burrito bowl"].includes(dinner.query), dinner.text);
  const late = recommend({ remaining: 900, hour: 23, eaten: { protein: 100, carbs: 200, fat: 60 }, proteinGoal: 150 });
  assert.ok(["cottage cheese", "fairlife protein shake", "greek yogurt with blueberries", "egg white omelet"].includes(late.query), late.text);
  const breakfast = recommend({ remaining: 2000, hour: 8 });
  assert.match(breakfast.text, /^Try /);
});

test("leans to protein when behind, and to something not already eaten", () => {
  const r = recommend({ remaining: 400, hour: 16, eaten: { protein: 40, carbs: 150, fat: 40 }, proteinGoal: 150, labels: [] });
  assert.match(r.text, /110 g protein to go/);
  const again = recommend({ remaining: 400, hour: 16, eaten: { protein: 40, carbs: 150, fat: 40 }, proteinGoal: 150, labels: [r.query] });
  assert.notEqual(again.query, r.query);
});

test("every suggestion logs close to its listed calories when typed", () => {
  setFoods(JSON.parse(readFileSync(new URL("./foods.json", import.meta.url))));
  addFoods(JSON.parse(readFileSync(new URL("./branded.json", import.meta.url))));
  for (const [name, cal] of RECOMMENDED) {
    const total = resolve(name, [])?.total;
    assert.ok(total && Math.abs(total - cal) / cal <= 0.3, `${name}: listed ${cal}, logs ${total}`);
  }
});

test("plain steak, vegetables and salmon are what they say", () => {
  near(resolve("steak", []).total, 437);
  near(resolve("vegetables", []).total, 118);
  near(resolve("salmon", []).total, 350);
});

const day = { eaten: { protein: 60, carbs: 120, fat: 40 }, proteinGoal: 160 };

test("diets leave out what they don't allow, at every meal", () => {
  for (const diet of ["standard", "heart", "lowcarb", "keto", "diabetic", "paleo", "whole30"]) {
    for (const hour of [8, 12, 16, 19, 23]) {
      const r = recommend({ remaining: 1200, hour, ...day, diet });
      assert.ok(r.query, `${diet} at ${hour}: ${r.text}`);
    }
  }
  const keto = recommend({ remaining: 1200, hour: 12, ...day, diet: "keto" });
  assert.doesNotMatch(keto.query, /rice|sandwich|wrap|potato|bowl|vegetables/);
  const paleo = recommend({ remaining: 1200, hour: 8, ...day, diet: "paleo" });
  assert.doesNotMatch(paleo.query, /yogurt|toast|oatmeal|shake/);
  const heart = recommend({ remaining: 700, hour: 19, ...day, diet: "heart" });
  assert.doesNotMatch(heart.query, /steak|burger/);
});

test("the aim changes the size: gain eats more, cut eats leaner", () => {
  const cal = (aim) => _CHOICES.find(([n]) => n === recommend({ remaining: 1500, hour: 12, ...day, aim }).query)[1];
  assert.ok(cal("gain") >= cal("maintain") && cal("maintain") >= cal("cut"), `${cal("gain")} ${cal("maintain")} ${cal("cut")}`);
  const lateGain = recommend({ remaining: 800, hour: 22, ...day, aim: "gain" });
  const lateCut = recommend({ remaining: 800, hour: 22, ...day, aim: "cut" });
  assert.ok(_CHOICES.find(([n]) => n === lateGain.query)[1] >= _CHOICES.find(([n]) => n === lateCut.query)[1]);
});
