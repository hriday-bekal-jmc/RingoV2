// Google Chat incoming webhook dispatcher.
// Validates webhook URL prefix — only https://chat.googleapis.com/ accepted.
// Never throws — all errors are caught and logged.

const GCHAT_PREFIX = 'https://chat.googleapis.com/';

/**
 * Post a plain-text card message to a Google Chat space via incoming webhook.
 * Fire-and-forget safe: never throws. Errors are caught + logged.
 */
export async function sendGChat(
  webhookUrl: string,
  text:       string,
): Promise<void> {
  if (!webhookUrl.startsWith(GCHAT_PREFIX)) {
    console.warn('[gchat] rejected non-GChat webhook URL');
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal:  AbortSignal.timeout(8_000), // 8 s hard limit
    });
    if (!res.ok) {
      console.error(`[gchat] webhook returned ${res.status}`);
    }
  } catch (err) {
    console.error('[gchat] dispatch failed:', err);
  }
}

/** Validate a user-submitted webhook URL.
 *  Checks parsed hostname — not just string prefix — to prevent @-credential SSRF bypass.
 *  e.g. https://chat.googleapis.com@evil.com/ passes startsWith but hostname is evil.com.
 */
export function isValidGChatWebhook(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' &&
           u.hostname  === 'chat.googleapis.com' &&
           u.pathname.startsWith('/v1/spaces/');
  } catch {
    return false;
  }
}
