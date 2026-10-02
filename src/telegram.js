// Telegram: Mini App initData verification, Bot API calls and the channel check.

const enc = new TextEncoder();

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export async function verifyInitData(initData, botToken, maxAgeSec = 7 * 86400, now = Date.now()) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const sig = hex(await hmac(secret, check));
  if (sig.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { return null; }
  if (!user || !user.id) return null;
  return user;
}

export async function bot(env, method, body) {
  const r = await fetch(`${env.TG_API || 'https://api.telegram.org'}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let j = null;
  try { j = await r.json(); } catch { /* ignore */ }
  return j || { ok: false, description: `HTTP ${r.status}` };
}

const MEMBER = new Set(['creator', 'administrator', 'member']);

// Returns true / false, or null when Telegram could not answer (bot not admin,
// channel unset). null is treated as "let them in" so a misconfiguration never
// locks every user out.
export async function isMember(env, userId, ctx) {
  if (!env.CHANNEL) return true;
  const cacheKey = new Request(`https://member.cache/${encodeURIComponent(env.CHANNEL)}/${userId}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return (await hit.text()) === '1';
  const res = await bot(env, 'getChatMember', { chat_id: env.CHANNEL, user_id: userId });
  if (!res.ok) return null;
  const m = res.result || {};
  const ok = MEMBER.has(m.status) || (m.status === 'restricted' && m.is_member === true);
  // Members are remembered for 30 minutes; non-members are re-checked every time
  // so the "I joined" button works immediately.
  if (ok) {
    const put = cache.put(cacheKey, new Response('1', { headers: { 'cache-control': 'max-age=1800' } }));
    if (ctx) ctx.waitUntil(put); else await put;
  }
  return ok;
}

export function channelLink(env) {
  const c = String(env.CHANNEL || '');
  return c.startsWith('@') ? `https://t.me/${c.slice(1)}` : (env.CHANNEL_LINK || '');
}
