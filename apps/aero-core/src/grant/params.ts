// The params a request asks Aero Core to execute: the query string for GET, the JSON body otherwise. They are hashed
// as read and must equal the grant's params_hash, so anything ambiguous (a repeated query key) or unreadable (bad JSON,
// an oversized body) becomes `undefined`, which matches no grant (E_PARAMS_MISMATCH). Halyn's params are tiny.

export const MAX_BODY_BYTES = 4096;

export async function readParams(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const params: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
      if (Object.hasOwn(params, key)) return undefined;
      params[key] = value;
    }
    return params;
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return undefined;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
