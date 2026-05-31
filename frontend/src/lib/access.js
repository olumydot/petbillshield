export function hasPaidPlan(userPlan) {
  if (!userPlan) return false;

  return [
    "pet_cost_vault",
    "premium",
    "pro",
    "family",
  ].includes(userPlan?.slug);
}

export function canAccessFeature(userPlan, feature) {
  if (!userPlan) return false;

  const slug = userPlan.slug;

  const featureMap = {
    pet_vault: ["pet_cost_vault", "premium", "pro"],
    timeline: ["pet_cost_vault", "premium", "pro"],
    reminders: ["premium", "pro"],
    claims: ["premium", "pro"],
    scripts: ["premium", "pro"],
  };

  return featureMap[feature]?.includes(slug);
}