import { caseStatusMeta } from "./cases.js";
import { iconHtml } from "./icons.js";

const FLOW = [
  { id: "linked", label: "Bağlandı" },
  { id: "planning", label: "Hazırlanıyor" },
  { id: "ready_to_send", label: "Göndermeye hazır" },
  { id: "sent", label: "Lab'a gitti" },
];

function stepIndex(status) {
  const idx = FLOW.findIndex((s) => s.id === status);
  return idx >= 0 ? idx : 0;
}

/** Vaka durum akışı — yatay adım şeridi HTML */
export function renderCaseStatusSteps(status) {
  const current = stepIndex(status);
  const meta = caseStatusMeta(status);

  const steps = FLOW.map((step, i) => {
    let cls = "case-step";
    if (i < current) cls += " case-step-done";
    else if (i === current) cls += " case-step-active";
    return `<span class="${cls}">${step.label}</span>`;
  }).join(`<span class="case-step-sep" aria-hidden="true">${iconHtml("arrow-right", { size: 12, className: "mp-icon mp-icon-xs case-step-sep-icon" })}</span>`);

  return `<div class="case-status-steps" title="Durum: ${meta.label}">${steps}</div>`;
}
