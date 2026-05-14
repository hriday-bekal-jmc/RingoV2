export interface CursorPayload {
  created_at: string;
  id: string;
}

export function encodeCursor(row: { created_at?: unknown; id?: unknown } | null | undefined): string | null {
  if (!row?.created_at || !row?.id) return null;
  const createdAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : String(row.created_at);
  return Buffer
    .from(JSON.stringify({ created_at: createdAt, id: String(row.id) }), 'utf8')
    .toString('base64url');
}

export function decodeCursor(value: unknown): CursorPayload | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (!parsed.created_at || !parsed.id) return null;
    return { created_at: String(parsed.created_at), id: String(parsed.id) };
  } catch {
    return null;
  }
}

export function parsePageLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
  const n = Number(value ?? defaultLimit);
  if (!Number.isFinite(n)) return defaultLimit;
  return Math.min(Math.max(Math.trunc(n), 1), maxLimit);
}
