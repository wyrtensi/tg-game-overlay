// Entry point for the hidden `relay` window (see tauri.conf.json): the
// self-hosted, end-to-end encrypted alternative to the Telegram worker.
import { safeInvoke, safeListen } from "../telegram/tauri";
import { IndexedDbStickerStore } from "./sticker-store";
import { persistentSenderId, RelayWorker } from "./worker";

const statusEl = document.querySelector<HTMLDivElement>("#status");

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const worker = new RelayWorker({
  invoke: safeInvoke,
  listen: safeListen,
  store: new IndexedDbStickerStore(),
  senderId: persistentSenderId(storage()),
});

worker.start().then(
  () => {
    if (statusEl) statusEl.textContent = "воркер запущен";
  },
  (err) => {
    console.error("[relay] fatal startup error", err);
    if (statusEl) statusEl.textContent = `ошибка запуска: ${err instanceof Error ? err.message : String(err)}`;
  },
);
window.addEventListener("beforeunload", () => worker.stop(), { once: true });
