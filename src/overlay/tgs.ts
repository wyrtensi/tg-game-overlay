import { Inflate } from "pako";

/**
 * Upper bound for an inflated TGS animation. Telegram caps a .tgs file at
 * 64 KiB gzipped and real Lottie JSON compresses roughly 5-20x, so 4 MiB
 * leaves wide headroom while a hostile 8 MB file of zeros (which would
 * inflate to ~8 GB and take the renderer down) is cut off after 4 MiB.
 */
export const MAX_TGS_JSON_BYTES = 4 * 1024 * 1024;

export class TgsTooLargeError extends Error {
  constructor() {
    super("TGS animation inflates past the size cap");
  }
}

/** Inflates gzipped Lottie JSON, aborting as soon as the output passes `maxBytes`. */
export function inflateTgs(bytes: Uint8Array, maxBytes = MAX_TGS_JSON_BYTES): unknown {
  const inflator = new Inflate();
  const chunks: Uint8Array[] = [];
  let total = 0;
  inflator.onData = (chunk) => {
    const data = chunk as Uint8Array;
    total += data.length;
    // pako calls onData from inside push() with no try/catch around it, so
    // throwing here stops the inflation before the next output chunk.
    if (total > maxBytes) throw new TgsTooLargeError();
    chunks.push(data);
  };
  inflator.push(bytes, true);
  if (inflator.err) throw new Error(inflator.msg || "TGS animation is not valid gzip");

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(joined));
}

/** tgs media is gzipped Lottie JSON packed into the data URL. */
export function inflateTgsDataUrl(dataUrl: string, maxBytes = MAX_TGS_JSON_BYTES): unknown {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return inflateTgs(bytes, maxBytes);
}
