import { test } from "node:test";
import assert from "node:assert/strict";
import { streak, recap, allowance } from "./streak.js";
import { previousDay } from "./day.js";

const day = (eaten, goal = 1800) => ({ eaten, goal });

test("previous day crosses months and years", () => {
  assert.equal(previousDay("2026-03-01"), "2026-02-28");
  assert.equal(previousDay("2027-01-01"), "2026-12-31");
});

test("counts finished days in a row at or under the goal", () => {
  const days = { "2026-10-20": day(1700), "2026-10-21": day(1800), "2026-10-22": day(1500), "2026-10-23": day(2500) };
  // Today (the 23rd) is still going, so it doesn't count yet, even though it's over.
  assert.deepEqual(streak(days, "2026-10-23"), { current: 3 });
});

test("going over, or logging nothing, ends the streak", () => {
  const over = { "2026-10-20": day(1500), "2026-10-21": day(2100), "2026-10-22": day(1600) };
  assert.equal(streak(over, "2026-10-23").current, 1);
  const skipped = { "2026-10-20": day(1500), "2026-10-22": day(1600) }; // nothing logged on the 21st
  assert.equal(streak(skipped, "2026-10-23").current, 1);
  assert.equal(streak({}, "2026-10-23").current, 0);
});

test("each day is judged against that day's goal", () => {
  const days = { "2026-10-21": day(1900, 2000), "2026-10-22": day(2100, 1800) };
  assert.equal(streak(days, "2026-10-23").current, 0);
  assert.equal(streak(days, "2026-10-22").current, 1);
});

test("the morning recap says how yesterday went", () => {
  const days = { "2026-10-22": day(1640) };
  assert.deepEqual(recap(days, "2026-10-22"), { result: "under", eaten: 1640, goal: 1800 });
  assert.equal(recap({ "2026-10-22": day(2100) }, "2026-10-22").result, "over");
  assert.equal(recap({}, "2026-10-22").result, "empty");
});

test("a day a little over still counts: more room for small goals", () => {
  assert.equal(allowance(1200), 180); // 15%
  assert.equal(allowance(1000), 150);
  assert.equal(allowance(3500), 50);
  assert.equal(allowance(5000), 50);
  assert.ok(allowance(2000) < 180 && allowance(2000) > 50);
  const days = { "2026-10-21": day(1370, 1200), "2026-10-22": day(1100, 1200) }; // 170 over a 1,200 goal
  assert.equal(streak(days, "2026-10-23").current, 2);
  assert.equal(recap(days, "2026-10-21").result, "close");
  assert.equal(recap(days, "2026-10-22").result, "under");
  const big = { "2026-10-22": day(3570, 3500) }; // 70 over a 3,500 goal
  assert.equal(streak(big, "2026-10-23").current, 0);
  assert.equal(recap(big, "2026-10-22").result, "over");
});
