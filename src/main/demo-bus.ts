/**
 * A minimal typed pub/sub used only when there is no Tauri host: it stands in
 * for the real event bus so the Telegram login/dialogs simulation can still
 * "emit" tg:status / tg:dialogs and have the settings window react to them.
 */
type Listener<T> = (payload: T) => void;

export class DemoBus {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  on<T>(event: string, listener: Listener<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => set!.delete(listener as Listener<unknown>);
  }

  emit<T>(event: string, payload: T): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

export const demoBus = new DemoBus();
