// A Duolingo-style streak: days in a row that ended at or under the goal.
// days: { "2026-10-23": { eaten, goal }, ... }, one summary per day that had
// anything logged. A day counts once it's over (at 3am); a day over the goal,
// or with nothing logged, ends the streak.
import { previousDay } from "./day.js";

const madeIt = (day) => day && day.eaten > 0 && day.eaten <= day.goal;

// current: finished days in a row up to yesterday; balance: calories under
// goal across them; best: the longest streak ever, counting the current one.
export function streak(days, today) {
  let current = 0;
  let balance = 0;
  for (let key = previousDay(today); madeIt(days[key]); key = previousDay(key)) {
    current++;
    balance += days[key].goal - days[key].eaten;
  }

  let best = current;
  let run = 0;
  let last = null;
  for (const key of Object.keys(days).filter((k) => k < today).sort()) {
    run = madeIt(days[key]) ? (last && previousDay(key) === last ? run : 0) + 1 : 0;
    last = madeIt(days[key]) ? key : null;
    best = Math.max(best, run);
  }
  return { current, balance, best };
}

// How a finished day went, for the morning recap.
export function recap(days, day) {
  const summary = days[day];
  if (!summary || !summary.eaten) return { result: "empty" };
  return { result: madeIt(summary) ? "under" : "over", ...summary };
}
