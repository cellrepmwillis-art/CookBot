// A Duolingo-style streak: days in a row that ended at or under the goal, or
// over it by no more than `leeway` percent.
// days: { "2026-10-23": { eaten, goal }, ... }, one summary per day that had
// anything logged. A day counts once it's over (at 3am); a day over the goal,
// or with nothing logged, ends the streak.
import { previousDay } from "./day.js";

const madeIt = (day, leeway = 0) => day && day.eaten > 0 && day.eaten <= day.goal * (1 + leeway / 100);

// current: finished days in a row, up to yesterday, that were on track.
export function streak(days, today, leeway = 0) {
  let current = 0;
  for (let key = previousDay(today); madeIt(days[key], leeway); key = previousDay(key)) current++;
  return { current };
}

// How a finished day went, for the morning recap: "under" (at or under the
// goal), "close" (over, but within the leeway), "over" or "empty".
export function recap(days, day, leeway = 0) {
  const summary = days[day];
  if (!summary || !summary.eaten) return { result: "empty" };
  const result = madeIt(summary) ? "under" : madeIt(summary, leeway) ? "close" : "over";
  return { result, ...summary };
}
