// A short "what to eat next" suggestion from the calories left, the time of
// day and how the day's protein, carbs and fat are going. Offline: a fixed
// list of simple, high-protein choices, written so typing the name logs it.

// [name, calories, protein, carbs, fat, when]: b breakfast, l lunch, d
// dinner, s snack, n late night.
const CHOICES = [
  ["greek yogurt with blueberries", 185, 18, 27, 1, "bsn"],
  ["2 eggs and toast", 400, 20, 30, 22, "b"],
  ["egg white omelet", 120, 22, 3, 2, "bn"],
  ["oatmeal with a scoop of protein powder", 380, 32, 45, 8, "b"],
  ["fairlife protein shake", 150, 30, 4, 3, "bsn"],
  ["cottage cheese", 110, 13, 5, 4, "sn"],
  ["beef jerky", 80, 13, 3, 1, "s"],
  ["string cheese", 80, 7, 1, 6, "sn"],
  ["barebells protein bar", 200, 20, 18, 8, "s"],
  ["apple", 95, 0, 25, 0, "s"],
  ["banana", 105, 1, 27, 0, "bs"],
  ["peanut butter toast", 190, 7, 16, 11, "bs"],
  ["turkey sandwich", 350, 25, 35, 10, "l"],
  ["grilled chicken salad", 300, 35, 10, 12, "ld"],
  ["chicken breast and rice", 485, 48, 45, 8, "ld"],
  ["tuna salad wrap", 310, 20, 30, 12, "l"],
  ["salmon and vegetables", 470, 40, 23, 22, "d"],
  ["steak and baked potato", 575, 47, 32, 26, "d"],
  ["chicken burrito bowl", 600, 40, 60, 18, "ld"],
  ["shrimp and rice", 400, 30, 50, 4, "ld"],
];

// The meal slot for an hour (the tracking day runs 3am to 3am).
export function mealSlot(hour) {
  if (hour >= 3 && hour < 11) return "b";
  if (hour >= 11 && hour < 15) return "l";
  if (hour >= 15 && hour < 17) return "s";
  if (hour >= 17 && hour < 21) return "d";
  return "n";
}

// Main meals still to come today, counting this one.
const MEALS_LEFT = { b: 3, l: 2, s: 1.5, d: 1, n: 1 };
// The most a late-night snack should be.
const LATE_NIGHT_MAX = 250;

// remaining: calories left. eaten: { protein, carbs, fat } so far (grams).
// proteinGoal: grams or null. labels: what's been logged today.
// Returns { text, query } where query is what to type to log it (or null).
export function recommend({ remaining, hour, eaten = { protein: 0, carbs: 0, fat: 0 }, proteinGoal = null, labels = [] }) {
  const slot = mealSlot(hour);
  const late = slot === "n";
  if (remaining < 80) {
    const drink = late || hour >= 14 ? "water or herbal tea" : "water, black coffee or tea";
    return { text: remaining < 0 ? `Over for today. If you're hungry, ${drink}.` : `About at your goal. If you're hungry, ${drink}.`, query: null };
  }

  const proteinLeft = proteinGoal ? proteinGoal - eaten.protein : 0;
  const total = eaten.protein * 4 + eaten.carbs * 4 + eaten.fat * 9;
  const carbHeavy = total > 300 && (eaten.carbs * 4) / total > 0.55;
  const fatHeavy = total > 300 && (eaten.fat * 9) / total > 0.4;
  const budget = late ? Math.min(remaining, LATE_NIGHT_MAX) : remaining / MEALS_LEFT[slot];
  const had = labels.join(" ").toLowerCase();

  const scored = CHOICES.filter(([name, cal, , , , when]) => when.includes(slot) && cal <= Math.max(budget * 1.25, 100) && cal <= remaining)
    .map(([name, cal, protein, carbs, fat]) => {
      let score = -Math.abs(cal - budget) / budget; // fits the budget
      if (proteinLeft > 0) score += Math.min(protein, proteinLeft) / 40; // closes the protein gap
      if (carbHeavy) score -= (carbs * 4) / cal;
      if (fatHeavy) score -= (fat * 9) / cal;
      if (name.split(" ").some((w) => w.length > 4 && had.includes(w))) score -= 1; // something different
      return { name, cal, protein, score };
    })
    .sort((a, b) => b.score - a.score);
  const pick = scored[0];
  if (!pick) return { text: `${remaining} cal left. Something light, like fruit or a protein shake.`, query: null };

  const why = proteinLeft > 0
    ? `${Math.round(proteinLeft)} g protein to go`
    : carbHeavy ? "carbs are running high" : fatHeavy ? "fat is running high" : `${remaining.toLocaleString()} cal left`;
  return { text: `Try ${pick.name} (~${pick.cal} cal, ${pick.protein} g protein): ${why}.`, query: pick.name };
}

export const RECOMMENDED = CHOICES.map(([name, cal]) => [name, cal]);
