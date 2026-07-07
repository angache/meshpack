import { parseDentalPlan } from "./dentalChart.js";

/** Vaka gönderime hazır mı — kontrol listesi */
export function evaluateCaseReadiness({ scans, labNotes, toothShade, dentalPlanRaw }) {
  const scanCount = ["upper", "lower", "bite"].filter((t) => scans?.[t]?.path).length;
  const plan = parseDentalPlan(dentalPlanRaw);
  const plannedTeeth = Object.keys(plan.teeth || {}).length;
  const hasNotes = (labNotes || "").trim().length > 0;
  const hasShade = (toothShade || "").trim().length > 0;

  const checks = [
    { id: "scans", label: "En az bir ölçü dosyası bağlı", ok: scanCount >= 1 },
    {
      id: "planning",
      label: "Lab notu, diş rengi veya diş planı girilmiş",
      ok: hasNotes || hasShade || plannedTeeth > 0,
    },
  ];

  return {
    ready: checks.every((c) => c.ok),
    checks,
  };
}

export function formatReadinessAlert(checks) {
  const missing = checks.filter((c) => !c.ok).map((c) => `• ${c.label}`);
  return `Gönderime hazır olmak için eksikler:\n\n${missing.join("\n")}`;
}
