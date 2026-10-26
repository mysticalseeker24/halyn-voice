// node --env-file=.env tools/day0-probe/read-log.mjs [count]
// Reads the probe's KV log through Cloudflare's API (works even where *.workers.dev is blocked). The probe only
// stores masked facts (last 4 digits, ids, timings), so the output is safe to share.
const NAMESPACE = 'e975471ab2274a31b698fd6dbf05414c';
const count = Number(process.argv[2] ?? 20);
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!account || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing (.env)');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${NAMESPACE}`;
const headers = { Authorization: `Bearer ${token}` };

const keys = [];
let cursor = '';
do {
  const res = await fetch(`${base}/keys?prefix=log:&limit=1000${cursor ? `&cursor=${cursor}` : ''}`, {
    headers,
  });
  const body = await res.json();
  if (!body.success) throw new Error(`KV list failed: ${JSON.stringify(body.errors)}`);
  keys.push(...body.result.map((k) => k.name));
  cursor = body.result_info?.cursor ?? '';
} while (cursor);

for (const name of keys.sort().slice(-count)) {
  const res = await fetch(`${base}/values/${encodeURIComponent(name)}`, { headers });
  console.log(await res.text());
}
if (keys.length === 0) console.log('(no entries yet)');
