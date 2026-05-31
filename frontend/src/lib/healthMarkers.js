/**
 * Shared health marker configuration used on the Pet Profile and Health Timeline pages.
 * Each key matches the field name stored in pet_health_markers.markers.
 */
export const MARKER_CONFIG = {
  // Vitals
  weight_lbs:             { label: "Weight (lbs)",      group: "Vitals",        color: "#D26D53" },
  weight_kg:              { label: "Weight (kg)",        group: "Vitals",        color: "#D26D53" },
  height_in:              { label: "Height (in)",        group: "Vitals",        color: "#B5936A" },
  height_cm:              { label: "Height (cm)",        group: "Vitals",        color: "#B5936A" },
  temperature_f:          { label: "Temp (°F)",          group: "Vitals",        color: "#E6AE2E" },
  heart_rate_bpm:         { label: "Heart rate",         group: "Vitals",        color: "#556045" },
  respiratory_rate:       { label: "Resp. rate",         group: "Vitals",        color: "#7B6DAB" },
  spo2:                   { label: "SpO2 (%)",           group: "Vitals",        color: "#3D4A2C" },
  systolic_bp:            { label: "Systolic BP",        group: "Vitals",        color: "#A23F1F" },
  body_condition_score:   { label: "Body Condition",     group: "Vitals",        color: "#9D8559" },
  muscle_condition_score: { label: "Muscle Score",       group: "Vitals",        color: "#8C2D14" },
  pain_score:             { label: "Pain Score",         group: "Vitals",        color: "#C49B7A" },
  // Kidney
  bun:                    { label: "BUN",                group: "Kidney",        color: "#2D2C28" },
  creatinine:             { label: "Creatinine",         group: "Kidney",        color: "#8C2D14" },
  sdma:                   { label: "SDMA",               group: "Kidney",        color: "#A23F1F" },
  // Liver
  alt:                    { label: "ALT",                group: "Liver",         color: "#556045" },
  ast:                    { label: "AST",                group: "Liver",         color: "#3D4A2C" },
  alp:                    { label: "ALP",                group: "Liver",         color: "#65635C" },
  ggt:                    { label: "GGT",                group: "Liver",         color: "#9D8559" },
  tbili:                  { label: "Total Bilirubin",    group: "Liver",         color: "#A23F1F" },
  // Metabolic
  glucose:                { label: "Glucose",            group: "Metabolic",     color: "#E6AE2E" },
  total_protein:          { label: "Total Protein",      group: "Metabolic",     color: "#C49B7A" },
  albumin:                { label: "Albumin",            group: "Metabolic",     color: "#B5936A" },
  calcium:                { label: "Calcium",            group: "Metabolic",     color: "#D26D53" },
  phosphorus:             { label: "Phosphorus",         group: "Metabolic",     color: "#A23F1F" },
  lipase:                 { label: "Lipase",             group: "Metabolic",     color: "#556045" },
  triglycerides:          { label: "Triglycerides",      group: "Metabolic",     color: "#8C2D14" },
  // Electrolytes
  sodium:                 { label: "Sodium",             group: "Electrolytes",  color: "#7B6DAB" },
  potassium:              { label: "Potassium",          group: "Electrolytes",  color: "#556045" },
  chloride:               { label: "Chloride",           group: "Electrolytes",  color: "#65635C" },
  bicarbonate:            { label: "Bicarbonate",        group: "Electrolytes",  color: "#9D8559" },
  // CBC
  wbc:                    { label: "WBC",                group: "CBC",           color: "#2D2C28" },
  rbc:                    { label: "RBC",                group: "CBC",           color: "#8C2D14" },
  hematocrit:             { label: "Hematocrit",         group: "CBC",           color: "#D26D53" },
  hemoglobin:             { label: "Hemoglobin",         group: "CBC",           color: "#E6AE2E" },
  platelets:              { label: "Platelets",          group: "CBC",           color: "#556045" },
  neutrophils:            { label: "Neutrophils",        group: "CBC",           color: "#C49B7A" },
  lymphocytes:            { label: "Lymphocytes",        group: "CBC",           color: "#7B6DAB" },
  monocytes:              { label: "Monocytes",          group: "CBC",           color: "#9D8559" },
  eosinophils:            { label: "Eosinophils",        group: "CBC",           color: "#B5936A" },
  // Other
  t4:                     { label: "T4 (Thyroid)",       group: "Other",         color: "#7B6DAB" },
  cholesterol:            { label: "Cholesterol",        group: "Other",         color: "#9D8559" },
  urine_specific_gravity: { label: "Urine SG",           group: "Other",         color: "#C49B7A" },
  cortisol:               { label: "Cortisol",           group: "Other",         color: "#65635C" },
  insulin:                { label: "Insulin",            group: "Other",         color: "#A23F1F" },
};

/** Returns all marker keys that have at least one non-null value in a markers array. */
export function availableMarkerKeys(markers = []) {
  const keys = new Set();
  markers.forEach(entry =>
    Object.keys(entry.markers || {}).forEach(k => {
      if (MARKER_CONFIG[k]) keys.add(k);
    })
  );
  return [...keys];
}

/** Default selected keys: weight_lbs → weight_kg → height → first two available. */
export function defaultSelectedKeys(available = []) {
  if (available.includes("weight_lbs")) return ["weight_lbs"];
  if (available.includes("weight_kg"))  return ["weight_kg"];
  if (available.includes("height_in"))  return ["height_in"];
  if (available.includes("height_cm"))  return ["height_cm"];
  return available.slice(0, 2);
}

/** Transform raw marker entries into a recharts-ready array, sorted by date. */
export function toChartData(markers = []) {
  return [...markers]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(entry => ({
      date: new Date(entry.date).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "2-digit",
      }),
      rawDate: entry.date,
      ...(entry.markers || {}),
    }));
}
