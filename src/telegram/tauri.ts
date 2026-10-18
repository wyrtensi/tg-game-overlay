import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Guards Tauri IPC so the page also works when smoke-tested in a plain
 * browser tab (no `window.__TAURI_INTERNALS__`, no backend on the other end).
 * Mirrors src/main/tauri.ts; duplicated here because src/main/** is off-limits
 * for this worker.
 */
export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauri()) {
    throw new Error(`Tauri недоступен (${command})`);
  }
  return invoke<T>(command, args);
}

export async function safeListen<T>(eventName: string, handler: (payload: T) => void): Promise<() => void> {
  if (!hasTauri()) {
    return () => {};
  }
  return listen<T>(eventName, (event) => handler(event.payload));
}
