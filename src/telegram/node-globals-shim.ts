// GramJS assumes a Node-like environment (ambient `Buffer`/`process`/`global`,
// same as Webpack's ProvidePlugin would inject). Vite does not do this
// automatically, and vite.config.ts is off-limits for this worker, so the
// shim is applied here in plain JS instead of via a bundler alias/plugin.
// Import this module FIRST, before anything from the "telegram" package.
import { Buffer } from "buffer";
import process from "process";

type GlobalWithNodeShims = typeof globalThis & {
  Buffer?: typeof Buffer;
  process?: typeof process;
  global?: typeof globalThis;
};

const g = globalThis as GlobalWithNodeShims;

if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = process;
if (!g.global) g.global = globalThis;
