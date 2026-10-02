// End-to-end checks against `wrangler dev` + test/mock.mjs.
// Run: node test/e2e.mjs  (BASE defaults to http://127.0.0.1:8787)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const BOT_TOKEN = '123456:TESTTOKEN';
let pass = 0;
const ok = (name) => { pass++; console.log('ok', name); };

function initData(user, ageSec = 0, tamper = false) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - ageSec), query_id: 'AAA', user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  let hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (tamper) hash = hash.replace(/^./, hash[0] === 'a' ? 'b' : 'a');
  p.set('hash', hash);
  return p.toString();
}
const U = { id: 4242, first_name: 'Amir', language_code: 'fa' };
const H = (u = U, extra = {}) => ({ 'x-init-data': initData(u), ...extra });
const get = async (path, headers = H()) => { const r = await fetch(BASE + path, { headers }); return { status: r.status, body: await r.json().catch(() => null), r }; };
const post = async (path, body, headers = H()) => { const r = await fetch(BASE + path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

// --- page & static ---
let r = await fetch(BASE + '/');
assert.equal(r.status, 200); const html = await r.text();
assert.match(html, /<html lang="fa" dir="rtl">/); assert.match(html, /src="\/tg\.js"/); ok('app page served');
r = await fetch(BASE + '/font/fa.woff2'); assert.equal(r.headers.get('content-type'), 'font/woff2'); const buf = new Uint8Array(await r.arrayBuffer()); assert.equal(String.fromCharCode(...buf.slice(0, 4)), 'wOF2'); ok('persian font served as real woff2');
r = await fetch(BASE + '/img/w342/p_1.svg'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /svg/); ok('image proxy');
r = await fetch(BASE + '/img/w9999/p_1.svg'); assert.equal(r.status, 404); ok('image proxy rejects unknown size');
r = await fetch(BASE + '/img/w342/..%2Fx.jpg'); assert.equal(r.status, 404); ok('image proxy rejects odd paths');

// --- auth ---
assert.equal((await get('/api/home?lang=fa', {})).status, 401); ok('no initData → 401');
assert.equal((await get('/api/home?lang=fa', { 'x-init-data': initData(U, 0, true) })).status, 401); ok('tampered initData → 401');
assert.equal((await get('/api/home?lang=fa', { 'x-init-data': initData(U, 8 * 86400) })).status, 401); ok('stale initData → 401');
r = await get('/api/me'); assert.equal(r.status, 200); assert.equal(r.body.member, true); assert.equal(r.body.bot, 'SansGuideBot'); ok('/me with valid initData');

// --- channel gate ---
const outsider = { id: 999, first_name: 'X' };
r = await get('/api/me', H(outsider)); assert.equal(r.body.member, false); assert.equal(r.body.channelLink, 'https://t.me/parsv2r'); ok('non-member flagged on /me');
r = await get('/api/home?lang=fa', H(outsider)); assert.equal(r.status, 403); assert.equal(r.body.error, 'join'); ok('non-member blocked from content');

// --- content ---
r = await get('/api/home?lang=fa'); assert.equal(r.status, 200);
assert.ok(r.body.hero.length > 0 && r.body.hero.every((c) => c.backdrop)); assert.equal(r.body.rows.length, 6);
assert.ok(r.body.rows.find((x) => x.key === 'onair').items.every((c) => c.type === 'tv')); ok('home rows');
r = await get('/api/title/movie/1000?lang=fa'); assert.equal(r.status, 200);
assert.equal(r.body.overviewLang, 'en'); assert.ok(r.body.overview.length > 0); ok('persian overview missing → english fallback');
assert.equal(r.body.trailer, 'abc123'); assert.deepEqual(r.body.directors, ['Denis Villeneuve']); assert.equal(r.body.runtime, 166); ok('movie detail fields');
r = await get('/api/title/tv/1001?lang=fa'); assert.equal(r.body.seasons.length, 2); assert.equal(r.body.nextEpisode.episode, 6); assert.equal(r.body.overviewLang, 'fa'); ok('tv detail fields');
assert.equal((await get('/api/title/person/1?lang=fa')).status, 404); ok('unknown type rejected');
r = await get('/api/season/1001/2?lang=fa'); assert.equal(r.body.episodes.length, 6); ok('season episodes');
r = await get('/api/search?q=dune&lang=fa'); assert.ok(r.body.items.length > 0); ok('search');
r = await get('/api/search?q=zzz&lang=fa'); assert.equal(r.body.items.length, 0); ok('search empty');
r = await get('/api/discover?type=movie&mood=laugh&time=short&shuffle=1&lang=fa'); assert.ok(r.body.items.length > 0); assert.equal(r.r.headers.get('cache-control'), 'no-store'); ok('tonight discover');
r = await get('/api/genres?lang=en'); assert.ok(r.body.movie.length && r.body.tv.length); ok('genres');

// --- lists ---
assert.equal((await post('/api/list', { kind: 'watch', on: true, type: 'movie', id: 1000, title: 'Dune', poster: '/p_0.svg', year: 2024, rating: 8.1 })).status, 200);
r = await get('/api/title/movie/1000?lang=fa'); assert.equal(r.body.mine.watch, true); ok('add to watchlist');
await post('/api/list', { kind: 'seen', on: true, type: 'movie', id: 1000, title: 'Dune' });
r = await get('/api/title/movie/1000?lang=fa'); assert.equal(r.body.mine.seen, true); assert.equal(r.body.mine.watch, false); ok('seen removes it from watchlist');
r = await get('/api/list'); assert.ok(r.body.items.some((x) => x.kind === 'seen' && x.id === 1000)); ok('list endpoint');
assert.equal((await post('/api/list', { kind: 'watch', on: true, type: 'movie', id: -3 })).status, 400); ok('bad id rejected');
await post('/api/list', { kind: 'seen', on: false, type: 'movie', id: 1000 });
r = await get('/api/list'); assert.ok(!r.body.items.some((x) => x.id === 1000)); ok('remove');

// --- follow + alerts ---
assert.equal((await post('/api/follow', { id: 1001, on: true, title: 'شوگان', poster: '/p_1.svg' })).status, 200);
r = await get('/api/title/tv/1001?lang=fa'); assert.equal(r.body.mine.follow, true); ok('follow series');
r = await get('/api/list'); assert.equal(r.body.follows[0].id, 1001); ok('follow appears in list');
assert.equal((await post('/api/lang', { lang: 'en' })).body.lang, 'en'); ok('language saved');

// --- webhook ---
r = await fetch(BASE + '/tg/webhook', { method: 'POST', body: '{}' }); assert.equal(r.status, 403); ok('webhook needs secret');
r = await fetch(BASE + '/tg/webhook', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 's3cret' }, body: JSON.stringify({ message: { message_id: 1, from: { id: 4242, first_name: 'Amir' }, chat: { id: 4242, type: 'private' }, text: '/start tv_1001' } }) });
assert.equal(r.status, 200); ok('webhook accepts /start');

console.log(`\n${pass} checks passed`);
