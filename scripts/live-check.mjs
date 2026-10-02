// Live checks after a deploy, run on the GitHub runner (which can reach TMDB and
// Telegram). Signs a real initData with the bot token, so /api calls go through
// the same verification the Mini App uses. Prints a short report.
import crypto from 'node:crypto';

const BASE = process.env.PUBLIC_URL;
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL = process.env.CHANNEL;
const out = [];
let failed = 0;
const line = (ok, name, extra = '') => { out.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!ok) failed++; };

function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

async function retry(fn, tries = 18, wait = 10000) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, wait));
  }
  return null;
}

const me = await tg('getMe');
line(me.ok, 'bot token works', me.ok ? '@' + me.result.username : me.description);

// A brand new custom domain can take a minute or two to get its certificate.
const health = await retry(async () => { const r = await fetch(`${BASE}/api/health`); return r.ok ? r : null; });
line(!!health, 'domain answers', BASE);

const page = await fetch(`${BASE}/`).then((r) => r.text()).catch(() => '');
line(page.includes('dir="rtl"'), 'mini app page');

const tgjs = await fetch(`${BASE}/tg.js`).then((r) => r.text()).catch(() => '');
line(tgjs.includes('WebApp'), 'telegram-web-app.js proxied');

// The bot itself is a member of the channel only if it was added there; an
// admin bot can read the member list, anything else gets an error.
const ownId = me.ok ? me.result.id : 0;
const cm = await tg('getChatMember', { chat_id: CHANNEL, user_id: ownId });
line(cm.ok && cm.result && cm.result.status === 'administrator', 'bot is admin in ' + CHANNEL, cm.ok ? cm.result.status : cm.description);

// Use the channel owner's id (an admin) as the test user if the bot can see it.
let testUser = { id: ownId, first_name: 'probe' };
const admins = await tg('getChatAdministrators', { chat_id: CHANNEL });
if (admins.ok) {
  const human = admins.result.find((a) => !a.user.is_bot);
  if (human) testUser = { id: human.user.id, first_name: 'probe' };
}
const H = { 'x-init-data': initData(testUser) };

const meApi = await fetch(`${BASE}/api/me`, { headers: H }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
line(meApi.member === true, '/api/me as a channel admin', JSON.stringify({ member: meApi.member, bot: meApi.bot }));

const home = await fetch(`${BASE}/api/home?lang=fa`, { headers: H }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const ok = home.rows && home.rows.every((r) => r.items.length > 0);
line(!!ok, 'home from real TMDB (fa)', ok ? `hero ${home.hero.length}, first: ${home.rows[0].items[0].title}` : JSON.stringify(home).slice(0, 200));

if (ok) {
  const first = home.rows[0].items[0];
  const d = await fetch(`${BASE}/api/title/${first.type}/${first.id}?lang=fa`, { headers: H }).then((r) => r.json());
  line(!!d.title, 'title detail', `${d.title} · overview ${d.overviewLang} · trailer ${d.trailer ? 'yes' : 'no'} · cast ${d.cast && d.cast.length}`);
  const im = await fetch(`${BASE}/img/w342${first.poster}`);
  line(im.ok && (im.headers.get('content-type') || '').startsWith('image/'), 'poster through image proxy', im.headers.get('content-type'));
  const en = await fetch(`${BASE}/api/home?lang=en`, { headers: H }).then((r) => r.json());
  line(en.rows && en.rows[0].items.length > 0, 'home in English', en.rows ? en.rows[0].items[0].title : '');
}
const s = await fetch(`${BASE}/api/search?q=${encodeURIComponent('اینترستلار')}&lang=fa`, { headers: H }).then((r) => r.json());
line(s.items && s.items.length > 0, 'persian search', s.items && s.items[0] ? `${s.items[0].title} (${s.items[0].year})` : '');
const s2 = await fetch(`${BASE}/api/search?q=breaking%20bad&lang=fa`, { headers: H }).then((r) => r.json());
line(s2.items && s2.items.length > 0, 'english search', s2.items && s2.items[0] ? `${s2.items[0].title}` : '');
const disc = await fetch(`${BASE}/api/discover?type=movie&mood=mind&time=&shuffle=1&lang=fa`, { headers: H }).then((r) => r.json());
line(disc.items && disc.items.length > 0, 'tonight picks', `${disc.items ? disc.items.length : 0} items`);

const wh = await tg('getWebhookInfo');
line(wh.ok && wh.result.url === `${BASE}/tg/webhook`, 'webhook set', wh.ok ? `${wh.result.url} pending=${wh.result.pending_update_count}${wh.result.last_error_message ? ' last_error=' + wh.result.last_error_message : ''}` : wh.description);

console.log(out.join('\n'));
console.log(failed ? `\n${failed} check(s) failed` : '\nall live checks passed');
process.exit(0);
