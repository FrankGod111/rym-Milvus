export interface RuntimeSettings {
  apiBaseUrl?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  difyBaseUrl?: string;
  difyApiKey?: string;
  difyDatasetId?: string;
  difyAppApiKey?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
}

const STORAGE_KEY = 'contract_ai_runtime_settings_v1';

export function loadRuntimeSettings(): RuntimeSettings {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RuntimeSettings) : {};
  } catch {
    return {};
  }
}

export function saveRuntimeSettings(values: RuntimeSettings) {
  if (typeof window === 'undefined') return;
  try {
    const cleaned: RuntimeSettings = {};
    (Object.keys(values) as Array<keyof RuntimeSettings>).forEach((key) => {
      const value = values[key];
      if (typeof value === 'string') {
        cleaned[key] = value;
      }
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // ignore quota / privacy errors
  }
}

export function clearRuntimeSettings() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
