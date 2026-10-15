/**
 * Persistence & platform bridge.
 * In Tauri the library lives in a JSON file in the app data dir (atomic writes,
 * backup copy, handled in Rust). In a plain browser it falls back to localStorage.
 */
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const LS_KEY = "bobine.library.v1";

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadRaw(): Promise<string | null> {
  if (isTauri()) return invoke<string | null>("load_library");
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export async function saveRaw(data: string): Promise<void> {
  if (isTauri()) {
    await invoke("save_library", { data });
    return;
  }
  localStorage.setItem(LS_KEY, data);
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export interface Saver {
  /** Schedules a save of the latest value (debounced, coalesced). */
  schedule(data: string): void;
  /** Writes any pending value now and waits for completion. */
  flush(): Promise<void>;
}

/**
 * Debounced writer that never runs two writes concurrently and always
 * ends up persisting the most recent value, even if a write fails.
 */
export function createSaver(
  write: (data: string) => Promise<void>,
  delay = 200,
  onError: (err: unknown) => void = () => {},
): Saver {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const run = async (): Promise<void> => {
    while (pending !== null) {
      const data = pending;
      pending = null;
      try {
        await write(data);
      } catch (err) {
        onError(err);
        // Keep the value for the next attempt unless something newer arrived.
        if (pending === null) pending = data;
        break;
      }
    }
  };

  const kick = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!running) {
      running = run().finally(() => {
        running = null;
      });
    }
    return running;
  };

  return {
    schedule(data) {
      pending = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void kick(), delay);
    },
    async flush() {
      if (running) await running;
      if (pending !== null) await kick();
    },
  };
}

/** Saves a backup file. Returns false if the user cancelled. */
export async function exportFile(data: string): Promise<boolean> {
  if (isTauri()) return (await invoke<string | null>("export_library", { data })) !== null;
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bobine-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

/** Native file picker (Tauri only). Returns the file content, or null if cancelled. */
export const importFileNative = (): Promise<string | null> => invoke<string | null>("import_library");
