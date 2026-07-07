import { invoke } from "@tauri-apps/api/core";

/** Oturum anında okunabilsin — kasa gecikse bile */
const memoryCache = new Map();

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Supabase oturum — bellek + localStorage + şifreli kasa (üçlü yazım) */
export const secureCloudStorage = {
  async getItem(key) {
    if (memoryCache.has(key)) return memoryCache.get(key);

    const fromLs = lsGet(key);
    if (fromLs != null) {
      memoryCache.set(key, fromLs);
      return fromLs;
    }

    try {
      const value = await invoke("secure_storage_get", { key });
      if (value != null) {
        memoryCache.set(key, value);
        return value;
      }
    } catch (err) {
      console.warn("[secureStorage] vault read failed:", err);
    }
    return null;
  },

  async setItem(key, value) {
    memoryCache.set(key, value);
    lsSet(key, value);
    try {
      await invoke("secure_storage_set", { key, value });
    } catch (err) {
      console.warn("[secureStorage] vault write failed:", err);
    }
  },

  async removeItem(key) {
    memoryCache.delete(key);
    lsRemove(key);
    try {
      await invoke("secure_storage_remove", { key });
    } catch {
      /* ignore */
    }
  },
};

/** Eski localStorage oturumlarını şifreli kasaya taşır (localStorage silinmez) */
export async function migrateLegacyCloudSessions() {
  if (typeof localStorage === "undefined") return;

  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("sb-")) keys.push(key);
  }

  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) {
      memoryCache.set(key, value);
      try {
        await invoke("secure_storage_set", { key, value });
      } catch {
        /* localStorage yedek olarak kalsın */
      }
    }
  }
}

export async function clearSecureCloudSessions() {
  memoryCache.clear();
  try {
    await invoke("secure_storage_clear_cloud");
  } catch {
    /* ignore */
  }
  if (typeof localStorage !== "undefined") {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("sb-")) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  }
}
