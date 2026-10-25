// A Duolingo-style streak: days in a row that ended at or under the goal, or
// only a little over it (see allowance).
// days: { "2026-10-23": { eaten, goal }, ... }, one summary per day that had
// anything logged. A day counts once it's over (at 3am); a day over the goal,
// or with nothing logged, ends the streak.
import { previousDay } from "./day.js";

// How far over the goal a day can go and still count, in calories. Small
// goals get more room: 15% of a 1,200 goal (180 cal), sliding down to 50 cal
// for a goal of 3,500 or more.
const LOW = { goal: 1200, over: 180 };
const HIGH = { goal: 3500, over: 50 };

export function allowance(goal) {
  if (goal <= LOW.goal) return goal * 0.15;
  if (goal >= HIGH.goal) return HIGH.over;
  const t = (goal - LOW.goal) / (HIGH.goal - LOW.goal);
  return LOW.over + t * (HIGH.over - LOW.over);
}

const madeIt = (day, close = true) => day && day.eaten > 0 && day.eaten <= day.goal + (close ? allowance(day.goal) : 0);

// current: finished days in a row, up to yesterday, that were on track.
export function streak(days, today) {
  let current = 0;
  for (let key = previousDay(today); madeIt(days[key]); key = previousDay(key)) current++;
  return { current };
}

// How a finished day went, for the morning recap: "under" (at or under the
// goal), "close" (over, but within the allowance), "over" or "empty".
export function recap(days, day) {
  const summary = days[day];
  if (!summary || !summary.eaten) return { result: "empty" };
  const result = madeIt(summary, false) ? "under" : madeIt(summary) ? "close" : "over";
  return { result, ...summary };
}
