/** @type {Record<string, string>} */
export const LOCAL_USER_ROLE_LABELS = {
  doctor: "Doktor",
  assistant: "Asistan",
  admin: "Doktor",
  staff: "Asistan",
};

export function localUserRoleLabel(role) {
  return LOCAL_USER_ROLE_LABELS[role] || role;
}

export function canManageLocalUsers(role) {
  return role === "doctor" || role === "admin";
}
