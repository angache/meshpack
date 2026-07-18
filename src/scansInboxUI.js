import { openScanImportWizard } from "./scanImportWizard.js";
import { mountHubBackIcons, syncHeaderNavButtons } from "./navChrome.js";

const $ = (id) => document.getElementById(id);

let getFileBrowser = null;
let hubOpen = false;
let highlightGroupId = null;
let pendingEventsBound = false;

function setHeaderBadge(count) {
  const badge = $("header-scans-badge");
  const btn = $("btn-header-scans");
  if (!badge || !btn) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
}

export function updateScansBadge(count) {
  setHeaderBadge(Math.max(0, Number(count) || 0));
}

export function refreshScansInboxBadge() {
  const fb = getFileBrowser?.();
  const count = fb?.getPendingGroups?.()?.length ?? 0;
  updateScansBadge(count);
}

function setHubVisible(visible) {
  hubOpen = visible;
  $("scans-inbox-view")?.classList.toggle("hidden", !visible);
  if (visible) {
    const planning = $("planning-view");
    if (planning && !planning.classList.contains("hidden")) {
      planning.dataset.wasOpen = "1";
    }
    $("messages-hub-view")?.classList.add("hidden");
    $("main-layout")?.classList.add("hidden");
    $("planning-view")?.classList.add("hidden");
    return;
  }

  const planning = $("planning-view");
  const wasPlanningOpen = planning?.dataset?.wasOpen === "1";
  if (wasPlanningOpen) {
    planning.classList.remove("hidden");
    $("main-layout")?.classList.add("hidden");
    delete planning.dataset.wasOpen;
  } else {
    $("main-layout")?.classList.remove("hidden");
  }
  syncHeaderNavButtons();
}

function bindPendingGroupEvents(fb) {
  if (pendingEventsBound) return;
  const host = $("scans-inbox-groups");
  const filters = $("scans-inbox-filters");
  if (!host || !filters) return;

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group-filter]");
    if (!btn) return;
    fb.groupFilter = btn.dataset.groupFilter;
    fb._renderGroupFilters();
    fb.render();
  });

  host.addEventListener("click", async (e) => {
    const wizardBtn = e.target.closest("[data-action='open-scan-wizard']");
    if (wizardBtn) {
      openScanImportWizard({ startManual: true });
      return;
    }

    const createBtn = e.target.closest("[data-action='create-link']");
    if (createBtn) {
      const group = fb._findGroup(createBtn.dataset.groupId);
      if (group) await fb._createAndLinkGroup(group);
      return;
    }

    const linkBtn = e.target.closest("[data-action='link-selected']");
    if (linkBtn) {
      const group = fb._findGroup(linkBtn.dataset.groupId);
      if (group) await fb._linkGroup(group, fb.selectedPatient);
      return;
    }

    const suggestBtn = e.target.closest("[data-action='link-suggested']");
    if (suggestBtn) {
      const group = fb._findGroup(suggestBtn.dataset.groupId);
      const patient = fb.patients.find((p) => p.id === suggestBtn.dataset.patientId);
      if (group && patient) await fb._linkGroup(group, patient);
      return;
    }

    const rejectBtn = e.target.closest("[data-action='reject-suggested']");
    if (rejectBtn) {
      const group = fb._findGroup(rejectBtn.dataset.groupId);
      const patientId = rejectBtn.dataset.patientId;
      if (group && patientId) {
        const { rejectStemSuggestion } = await import("./patientStemRejections.js");
        await rejectStemSuggestion(group.fileStem, patientId);
        await fb.refresh();
      }
      return;
    }

    const toggleBtn = e.target.closest("[data-action='toggle-expand']");
    if (toggleBtn) {
      const id = toggleBtn.dataset.groupId;
      if (fb.expandedGroupIds.has(id)) fb.expandedGroupIds.delete(id);
      else fb.expandedGroupIds.add(id);
      fb.render();
      return;
    }

    const dismissBtn = e.target.closest("[data-action='dismiss-group']");
    if (dismissBtn) {
      const group = fb._findGroup(dismissBtn.dataset.groupId);
      if (group) await fb._dismissGroup(group);
      return;
    }

    const restoreBtn = e.target.closest("[data-action='restore-group']");
    if (restoreBtn) {
      await fb._restoreDismissedGroup(restoreBtn.dataset.groupKey);
      return;
    }
  });

  pendingEventsBound = true;
}

function attachPendingHost(fb) {
  fb.attachPendingGroupsHost({
    groupsEl: $("scans-inbox-groups"),
    metaEl: $("scans-inbox-meta"),
    filtersEl: $("scans-inbox-filters"),
  });
  bindPendingGroupEvents(fb);
}

export function openScansInbox({ highlightPath = null } = {}) {
  const fb = getFileBrowser?.();
  if (!fb) return;

  attachPendingHost(fb);

  if (highlightPath) {
    fb.highlightGroupForPath(highlightPath);
    const group = fb.findGroupForPath(highlightPath);
    highlightGroupId = group?.id || null;
  }

  setHubVisible(true);
  fb.render();
  mountHubBackIcons();
}

export function closeScansInbox() {
  highlightGroupId = null;
  setHubVisible(false);
}

export function onAfterFileBrowserRender() {
  const fb = getFileBrowser?.();
  const count = fb?.getPendingGroups?.()?.length ?? 0;
  refreshScansInboxBadge();

  const hubCount = $("scans-inbox-count");
  if (hubCount) {
    hubCount.textContent = String(count);
    hubCount.classList.toggle("hidden", count === 0);
  }

  if (!hubOpen || !highlightGroupId) return;
  const el = document.getElementById(`pending-group-${highlightGroupId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("measure-group-highlight");
    window.setTimeout(() => el.classList.remove("measure-group-highlight"), 2400);
  }
  highlightGroupId = null;
}

export function isScansInboxOpen() {
  return hubOpen;
}

export function initScansInbox({ getFileBrowser: getFb } = {}) {
  getFileBrowser = getFb;
  const fb = getFileBrowser?.();
  if (fb) attachPendingHost(fb);

  $("btn-scans-inbox-back")?.addEventListener("click", closeScansInbox);
  $("btn-scans-add-wizard")?.addEventListener("click", () => {
    openScanImportWizard({ startManual: true });
  });

  refreshScansInboxBadge();
}
