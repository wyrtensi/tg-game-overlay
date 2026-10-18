export interface TelegramCredentials {
  apiId: number;
  apiHash: string;
}

/** Replaces the credentials used by clients created after this update. */
export function applyCredentialUpdate(
  _current: TelegramCredentials,
  update: TelegramCredentials,
): TelegramCredentials {
  return { apiId: update.apiId, apiHash: update.apiHash };
}
