// A daily protein target from the profile in Settings. Recommendations go by
// body weight: 0.8 g per kg is the standard minimum (RDA); 1.2 g/kg is common
// advice for active people or anyone eating under their calories, to keep
// muscle; 1.6 g/kg for building muscle.
export const AIMS = {
  general: { label: "General health", perKg: 0.8 },
  active: { label: "Active or losing weight", perKg: 1.2 },
  muscle: { label: "Building muscle", perKg: 1.6 },
};

// profile: { sex, age, heightIn, weightLb, aim }. Returns grams a day, or null
// without a weight.
export function proteinTarget(profile) {
  const weightKg = Number(profile?.weightLb) * 0.4536;
  if (!(weightKg > 0)) return null;
  // Needs don't keep rising with every pound: past a BMI of 30, use the
  // weight at a BMI of 30 for this height.
  const heightM = Number(profile.heightIn) * 0.0254;
  const baseKg = heightM > 0 ? Math.min(weightKg, 30 * heightM * heightM) : weightKg;
  let perKg = (AIMS[profile.aim] ?? AIMS.active).perKg;
  if (Number(profile.age) >= 65) perKg = Math.max(perKg, 1.0); // usual advice for older adults
  return Math.round((baseKg * perKg) / 5) * 5;
}
