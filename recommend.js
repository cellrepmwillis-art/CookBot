// A short "what to eat next" suggestion from the calories left, the time of
// day, how the day's protein, carbs and fat are going, the aim (gain,
// maintain or cut) and the diet chosen in Settings. Offline: a fixed list of
// simple, high-protein choices, written so typing the name logs it.

// [name, calories, protein, carbs, fat, when, kinds]
// when: b breakfast, l lunch, d dinner, s snack, n late night.
// kinds: g grain, d dairy, l legume (peanuts too), p packaged or processed,
// r red meat, s sugary or quick carbs, o oily fish.
const CHOICES = [
  ["greek yogurt with blueberries", 185, 18, 27, 1, "bsn", "d"],
  ["2 eggs and toast", 400, 20, 30, 22, "b", "g"],
  ["2 hard boiled eggs", 155, 13, 1, 11, "bsn", ""],
  ["3 eggs", 270, 19, 2, 21, "b", ""],
  ["egg white omelet", 125, 22, 3, 2, "bn", ""],
  ["oatmeal with a scoop of protein powder", 380, 32, 45, 8, "b", "gdp"],
  ["fairlife protein shake", 150, 30, 4, 3, "bsn", "dp"],
  ["cottage cheese", 110, 13, 5, 4, "sn", "d"],
  ["beef jerky", 80, 13, 3, 1, "s", "pr"],
  ["string cheese", 80, 7, 1, 6, "sn", "d"],
  ["barebells protein bar", 210, 20, 18, 8, "s", "pd"],
  ["apple", 95, 0, 25, 0, "s", ""],
  ["banana", 105, 1, 27, 0, "bs", "s"],
  ["almonds", 164, 6, 6, 14, "sn", ""],
  ["peanut butter toast", 190, 7, 16, 11, "bs", "glp"],
  ["turkey sandwich", 311, 25, 35, 8, "l", "gp"],
  ["tuna salad wrap", 310, 20, 30, 12, "l", "gp"],
  ["grilled chicken salad", 312, 35, 10, 15, "ld", "d"],
  ["grilled chicken breast", 281, 53, 0, 6, "ld", ""],
  ["cheeseburger no bun", 305, 25, 2, 22, "ld", "dr"],
  ["chicken breast and vegetables", 400, 56, 24, 7, "ld", ""],
  ["chicken breast and sweet potato", 416, 55, 31, 6, "ld", ""],
  ["chicken breast and rice", 485, 48, 45, 8, "ld", "g"],
  ["shrimp and rice", 311, 20, 45, 2, "ld", "g"],
  ["chicken burrito bowl", 630, 40, 65, 20, "ld", "gl"],
  ["salmon", 350, 37, 0, 21, "d", "o"],
  ["salmon and vegetables", 470, 40, 24, 22, "d", "o"],
  ["steak", 437, 45, 0, 27, "d", "r"],
  ["steak and vegetables", 555, 49, 24, 28, "ld", "r"],
  ["steak and baked potato", 575, 47, 32, 27, "d", "r"],
  ["chicken breast, rice and vegetables", 604, 52, 69, 9, "ld", "g"],
  ["salmon, rice and vegetables", 673, 42, 69, 23, "d", "go"],
  ["steak, baked potato and vegetables", 690, 50, 56, 28, "d", "r"],
];

// Diets: what each leaves out, as kinds and a carb limit per food (grams).
export const DIETS = {
  standard: { label: "Standard American" },
  heart: { label: "Heart healthy", without: "rp", prefer: "o" },
  lowcarb: { label: "Low carb", maxCarbs: 20 },
  keto: { label: "Keto", maxCarbs: 8 },
  diabetic: { label: "Diabetic (low sugar)", without: "s", maxCarbs: 35 },
  paleo: { label: "Paleo", without: "gdlp" },
  whole30: { label: "Whole30", without: "gdlps" },
};

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
// Cutting leaves a little room and favors protein per calorie; gaining
// eats more of what's left and allows a bigger late-night snack.
const AIM_STYLE = {
  cut: { budget: 0.85, lateMax: 200, leanBonus: 1, fill: 1 },
  maintain: { budget: 1, lateMax: 250, leanBonus: 0, fill: 1 },
  gain: { budget: 1.2, lateMax: 450, leanBonus: 0, fill: 2 }, // filling the budget matters more
};

// remaining: calories left. eaten: { protein, carbs, fat } so far (grams).
// proteinGoal: grams or null. labels: what's been logged today.
// aim: "gain" | "maintain" | "cut". diet: a key of DIETS. close: over the goal
// but still within the streak's allowance.
// Returns { text, query } where query is what to type to log it (or null).
export function recommend({ remaining, hour, eaten = { protein: 0, carbs: 0, fat: 0 }, proteinGoal = null, labels = [], aim, diet, close = false }) {
  const slot = mealSlot(hour);
  const late = slot === "n";
  const style = AIM_STYLE[aim] ?? (aim === "muscle" ? AIM_STYLE.gain : AIM_STYLE.maintain);
  const rules = DIETS[diet] ?? DIETS.standard;
  if (remaining < 80) {
    const drink = late || hour >= 14 ? "water or herbal tea" : "water, black coffee or tea";
    const where = remaining >= 0 ? "About at your goal" : close ? "A little over, still on track" : "Over for today";
    return { text: `${where}. If you're hungry, ${drink}.`, query: null };
  }

  const proteinLeft = proteinGoal ? proteinGoal - eaten.protein : 0;
  const total = eaten.protein * 4 + eaten.carbs * 4 + eaten.fat * 9;
  const carbHeavy = total > 300 && (eaten.carbs * 4) / total > 0.55;
  const fatHeavy = total > 300 && (eaten.fat * 9) / total > 0.4;
  const budget = late ? Math.min(remaining, style.lateMax) : (remaining / MEALS_LEFT[slot]) * style.budget;
  const had = labels.join(" ").toLowerCase();

  const fits = ([, cal, , carbs, , when, kinds]) =>
    when.includes(slot) && cal <= Math.max(budget * 1.25, 100) && cal <= remaining &&
    !(rules.without && [...kinds].some((k) => rules.without.includes(k))) &&
    !(rules.maxCarbs != null && carbs > rules.maxCarbs);
  const scored = CHOICES.filter(fits)
    .map(([name, cal, protein, carbs, fat, , kinds]) => {
      let score = (-style.fill * Math.abs(cal - budget)) / budget; // fits the budget
      if (proteinLeft > 0) score += Math.min(protein, proteinLeft) / 40; // closes the protein gap
      score += (style.leanBonus * protein * 4) / cal; // lean protein on a cut
      if (carbHeavy) score -= (carbs * 4) / cal;
      if (fatHeavy) score -= (fat * 9) / cal;
      if (rules.prefer && [...kinds].some((k) => rules.prefer.includes(k))) score += 0.5;
      if (name.split(" ").some((w) => w.length > 4 && had.includes(w))) score -= 1; // something different
      return { name, cal, protein, score };
    })
    .sort((a, b) => b.score - a.score);
  const pick = scored[0];
  if (!pick) return { text: `${remaining.toLocaleString()} cal left. Something light that fits your diet.`, query: null };

  const why = proteinLeft > 0
    ? `${Math.round(proteinLeft)} g protein to go`
    : carbHeavy ? "carbs are running high" : fatHeavy ? "fat is running high"
    : aim === "gain" ? `${remaining.toLocaleString()} cal left to eat for your gain` : `${remaining.toLocaleString()} cal left`;
  return { text: `Try ${pick.name} (~${pick.cal} cal, ${pick.protein} g protein): ${why}.`, query: pick.name };
}

export const RECOMMENDED = CHOICES.map(([name, cal]) => [name, cal]);
export { CHOICES as _CHOICES };
