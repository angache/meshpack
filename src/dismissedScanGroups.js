import { invoke } from "@tauri-apps/api/core";

export async function listDismissedScanGroups() {
  return invoke("list_dismissed_scan_groups");
}

export async function dismissScanGroup({
  groupKey,
  stemKey,
  sessionDay,
  fileStem,
  filePaths,
  reason,
}) {
  return invoke("dismiss_scan_group", {
    groupKey,
    stemKey,
    sessionDay,
    fileStem,
    filePaths,
    reason,
  });
}

export async function restoreDismissedScanGroup(groupKey) {
  return invoke("restore_dismissed_scan_group", { groupKey });
}

/** group_key → kayıt */
export function buildDismissedGroupMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    map.set(row.group_key, row);
  }
  return map;
}

function sortedPaths(paths) {
  return [...paths].sort();
}

/** Aynı dosya seti gizlendiyse true; yeni dosya eklendiyse false */
export function isGroupDismissed(group, dismissedByKey) {
  const record = dismissedByKey.get(group.id);
  if (!record) return false;
  const current = sortedPaths(group.files.map((f) => f.path));
  const dismissed = sortedPaths(record.file_paths || []);
  if (current.length !== dismissed.length) return false;
  return current.every((p, i) => p === dismissed[i]);
}
