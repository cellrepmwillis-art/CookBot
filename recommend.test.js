import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommend, mealSlot, RECOMMENDED } from "./recommend.js";
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
  assert.ok(["chicken breast and rice", "steak and baked potato", "salmon and vegetables", "chicken burrito bowl"].includes(dinner.query), dinner.text);
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
