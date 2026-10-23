// The tracking "day" runs from 3:00am to 2:59am local time, so a late-night
// snack still counts toward the day it belongs to.
export const RESET_HOUR = 3;

const pad = (n) => String(n).padStart(2, "0");

// Key for the tracking day that contains `date`, e.g. "2026-10-23".
export function dayKey(date = new Date()) {
  const shifted = new Date(date.getTime());
  shifted.setHours(shifted.getHours() - RESET_HOUR);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

// The next moment the counter resets (the next local 3:00am after `date`).
export function nextReset(date = new Date()) {
  const next = new Date(date.getTime());
  next.setHours(RESET_HOUR, 0, 0, 0);
  if (next <= date) next.setDate(next.getDate() + 1);
  return next;
}
