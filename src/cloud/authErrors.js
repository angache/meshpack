/** Tauri WebKit'te Error'a özellik eklenemez — özel sınıf kullan */
export class CloudAuthError extends Error {
  constructor(message, { step, status, code, details, hint } = {}) {
    super(message || "Kimlik doğrulama hatası");
    this.name = "CloudAuthError";
    this.step = step;
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

export function fromSupabaseAuthError(error, step, fallback) {
  return new CloudAuthError(error?.msg || error?.message || error?.code || fallback, {
    step,
    status: error?.status,
    code: error?.code || error?.error_code,
  });
}

export function fromSupabaseRpcError(error, step, fallback) {
  return new CloudAuthError(error?.message || error?.code || fallback, {
    step,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });
}
