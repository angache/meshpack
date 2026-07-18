import { displayCaseStatus, hasPlanningContent } from "./casePlanning.js";

/** Hasta için öne çıkan vaka — önce açık (gönderilmemiş), yoksa en son */
export function getFocusSession(sessions) {
  if (!sessions?.length) return null;
  const open = sessions.find((s) => s.status && s.status !== "sent");
  return open || sessions[0];
}

/** Hasta listesi / detay özeti */
export function summarizePatientCases(sessions) {
  if (!sessions?.length) {
    return {
      focus: null,
      displayStatus: null,
      caseNumber: null,
      needsAction: false,
      actionHint: null,
      sentCount: 0,
      openCount: 0,
      lastActivity: 0,
    };
  }

  const focus = getFocusSession(sessions);
  const caseRow = focus?.case || (focus?.status ? { status: focus.status } : null);
  const displayStatus = caseRow ? displayCaseStatus(caseRow) : null;

  const needsPlan =
    focus?.case &&
    focus.status !== "sent" &&
    focus.status !== "ready_to_send" &&
    !hasPlanningContent(focus.case);

  const readyToSend = sessions.some((s) => s.status === "ready_to_send");

  let actionHint = null;
  if (readyToSend) actionHint = "Göndermeye hazır";
  else if (needsPlan) actionHint = "Plan bekliyor";

  return {
    focus,
    displayStatus,
    caseNumber: focus?.caseNumber || null,
    needsAction: !!(needsPlan || readyToSend),
    actionHint,
    sentCount: sessions.filter((s) => s.status === "sent").length,
    openCount: sessions.filter((s) => s.status !== "sent").length,
    lastActivity: sessions[0]?.modifiedAt || 0,
  };
}

export function comparePatientsBySurname(a, b) {
  const s = (a.surname || "").localeCompare(b.surname || "", "tr", { sensitivity: "base" });
  if (s !== 0) return s;
  return (a.first_name || "").localeCompare(b.first_name || "", "tr", { sensitivity: "base" });
}

export function comparePatientsByActivity(a, b, sessionsByPatient) {
  const aTime = sessionsByPatient.get(a.id)?.[0]?.modifiedAt || a.updated_at || 0;
  const bTime = sessionsByPatient.get(b.id)?.[0]?.modifiedAt || b.updated_at || 0;
  return bTime - aTime;
}
