// Entry point for the hidden `telegram` window (see tauri.conf.json). Owns
// the only MTProto client in the app - see CONTRACT.md and client.ts.
import { TelegramWorker } from "./client";

const statusEl = document.querySelector<HTMLDivElement>("#status");

function setStatusLine(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

setStatusLine("запуск...");

const worker = new TelegramWorker();
worker.start().catch((err) => {
  console.error("[telegram] fatal startup error", err);
  setStatusLine(`ошибка запуска: ${err instanceof Error ? err.message : String(err)}`);
});

setStatusLine("воркер запущен");
