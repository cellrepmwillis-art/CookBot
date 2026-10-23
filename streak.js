// A Duolingo-style streak: days in a row that ended at or under the goal.
// days: { "2026-10-23": { eaten, goal }, ... }, one summary per day that had
// anything logged. A day counts once it's over (at 3am); a day over the goal,
// or with nothing logged, ends the streak.
import { previousDay } from "./day.js";

const madeIt = (day) => day && day.eaten > 0 && day.eaten <= day.goal;

// current: finished days in a row, up to yesterday, that were on track.
export function streak(days, today) {
  let current = 0;
  for (let key = previousDay(today); madeIt(days[key]); key = previousDay(key)) current++;
  return { current };
}

// How a finished day went, for the morning recap.
export function recap(days, day) {
  const summary = days[day];
  if (!summary || !summary.eaten) return { result: "empty" };
  return { result: madeIt(summary) ? "under" : "over", ...summary };
}
