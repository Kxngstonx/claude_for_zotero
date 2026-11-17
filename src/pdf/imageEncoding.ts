// Pure helpers for sending annotation images to the model. No Zotero globals.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 (with padding) of raw bytes. */
export function base64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      B64[(n >> 6) & 63] +
      B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}

/**
 * The API accepts images up to 5 MB (base64 grows bytes by 4/3). Larger
 * images are re-encoded smaller before sending.
 */
export const MAX_IMAGE_BYTES = 3_500_000;

/** Long side to scale down to when re-encoding (the API's recommended size). */
export const TARGET_LONG_SIDE = 1568;

export function scaledSize(
  width: number,
  height: number,
  longSide = TARGET_LONG_SIDE,
): { width: number; height: number } {
  const s = Math.min(1, longSide / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * s)),
    height: Math.max(1, Math.round(height * s)),
  };
}
