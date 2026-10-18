export const ROOM_ID_RE = /^[0-9a-f]{64}$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Strict-enough base64 check (standard alphabet, padded, non-empty). */
export function isBase64(s) {
  return typeof s === 'string' && s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}

/** Decoded byte length of a base64 string that already passed isBase64. */
export function base64DecodedLength(s) {
  let pad = 0;
  if (s.endsWith('==')) pad = 2;
  else if (s.endsWith('=')) pad = 1;
  return (s.length / 4) * 3 - pad;
}
