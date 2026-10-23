// Daily goals from the profile in Settings: { sex, age, heightIn, weightLb, aim },
// where aim is "gain", "maintain" or "cut", like bodybuilders plan it.
export const AIMS = {
  gain: { label: "Gain", proteinPerLb: 1.0, calories: +300 }, // a lean bulk
  maintain: { label: "Maintain", proteinPerLb: 0.8, calories: 0 },
  cut: { label: "Cut", proteinPerLb: 1.0, calories: -500 }, // about 1 lb a week; protein stays high to keep muscle
};
// "muscle" is from before these three aims.
const aimOf = (profile) => AIMS[profile?.aim] ?? (profile?.aim === "muscle" ? AIMS.gain : AIMS.maintain);

// Protein in grams a day: the classic bodybuilding rule of about 1 g per
// pound of body weight (0.8 to maintain). Past a BMI of 30 it uses the
// weight at a BMI of 30 for the height, since the rule is meant for lean
// lifters. Null without a weight.
export function proteinTarget(profile) {
  const weightLb = Number(profile?.weightLb);
  if (!(weightLb > 0)) return null;
  const heightIn = Number(profile.heightIn);
  const baseLb = heightIn > 0 ? Math.min(weightLb, (30 * heightIn * heightIn) / 703) : weightLb;
  return Math.round((baseLb * aimOf(profile).proteinPerLb) / 5) * 5;
}

// Calories a day: maintenance from the Mifflin-St Jeor equation, for
// someone moderately active (training 3 to 5 days a week), plus or minus
// the aim's change, and never under the usual minimums (1,200 for women,
// 1,500 for men). Null without age, height and weight.
export const ACTIVITY = 1.55;

export function calorieSuggestion(profile) {
  const kg = Number(profile?.weightLb) * 0.4536;
  const cm = Number(profile?.heightIn) * 2.54;
  const age = Number(profile?.age);
  if (!(kg > 0 && cm > 0 && age > 0)) return null;
  const sexTerm = { male: 5, female: -161 }[profile.sex] ?? -78; // halfway when not given
  const maintenance = (10 * kg + 6.25 * cm - 5 * age + sexTerm) * ACTIVITY;
  const floor = profile.sex === "male" ? 1500 : 1200;
  const round = (n) => Math.round(n / 50) * 50;
  return { maintenance: round(maintenance), goal: Math.max(floor, round(maintenance + aimOf(profile).calories)) };
}
