/** Run `fn` over `items` with at most `limit` in flight. Preserves input order in the result. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Postgres TEXT / JSONB reject NUL bytes that sometimes appear in scraped HTML. */
export const stripNul = (value) => (typeof value === 'string' ? value.replace(/\u0000/g, '') : value);
