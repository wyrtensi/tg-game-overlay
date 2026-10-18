export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

/**
 * Telegram refuses .tgs stickers over 64 KiB, so anything larger claiming to
 * be one is not a real sticker (and may be a gzip bomb for the overlay).
 */
export const MAX_TGS_BYTES = 64 * 1024;
