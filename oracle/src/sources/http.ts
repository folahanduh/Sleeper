/** Fetch JSON with a timeout and a couple of retries on network / 5xx / 429 errors. */
export type Fetch = typeof fetch;

export class SourceError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
  }
}

export async function getJson(
  source: string,
  url: string,
  opts: { fetch?: Fetch; timeoutMs?: number; retries?: number } = {},
): Promise<unknown> {
  const f = opts.fetch ?? fetch;
  const retries = opts.retries ?? 2;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        headers: { "user-agent": "sleeper-oracle/0.2 (+https://github.com/)" },
      });
      if (res.status === 429 || res.status >= 500) {
        last = new SourceError(source, `HTTP ${res.status}`);
      } else if (!res.ok && res.status !== 400 && res.status !== 404) {
        // 400/404 carry API error bodies the caller interprets.
        throw new SourceError(source, `HTTP ${res.status}`);
      } else {
        return await res.json();
      }
    } catch (e) {
      if (e instanceof SourceError) throw e;
      last = e;
    }
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw last instanceof Error ? last : new SourceError(source, String(last));
}
