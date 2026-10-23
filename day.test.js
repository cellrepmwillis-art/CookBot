import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey, nextReset } from "./day.js";

test("before 3am counts toward the previous day", () => {
  assert.equal(dayKey(new Date(2026, 9, 23, 2, 59)), "2026-10-22");
});

test("at and after 3am counts toward the current day", () => {
  assert.equal(dayKey(new Date(2026, 9, 23, 3, 0)), "2026-10-23");
  assert.equal(dayKey(new Date(2026, 9, 23, 23, 59)), "2026-10-23");
});

test("rolls over month and year boundaries", () => {
  assert.equal(dayKey(new Date(2027, 0, 1, 1, 0)), "2026-12-31");
});

test("next reset is today at 3am before 3am, otherwise tomorrow", () => {
  assert.deepEqual(nextReset(new Date(2026, 9, 23, 1, 0)), new Date(2026, 9, 23, 3, 0));
  assert.deepEqual(nextReset(new Date(2026, 9, 23, 3, 0)), new Date(2026, 9, 24, 3, 0));
  assert.deepEqual(nextReset(new Date(2026, 9, 23, 18, 0)), new Date(2026, 9, 24, 3, 0));
});
