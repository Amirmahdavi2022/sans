// Sans (سانس) — Telegram movie & series guide. One Worker serves the Mini App, its
// API, the image proxy, the bot webhook and the hourly new-episode check.

import APP_HTML from './app.html';
import FONT_FA from './assets/vazir-arabic.woff2';
import FONT_LATIN from './assets/vazir-latin.woff2';
import * as T from './tmdb.js';
import { verifyInitData, bot, isMember, channelLink } from './telegram.js';
import { handleUpdate } from './bot.js';
import { runAlerts } from './alerts.js';

const JSONH = { 'content-type': 'application/json; charset=utf-8' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSONH, ...extra } });
const IMG_SIZES = new Set(['w92', 'w154', 'w185', 'w300', 'w342', 'w500', 'w780', 'w1280', 'original', 'h632']);
const MAX_FOLLOWS = 40;
const MAX_ITEMS = 500;

async function authUser(req, env) {
  if (env.DEV === '1') {
    const dev = req.headers.get('x-dev-user');
    if (dev) return { id: Number(dev) || 1, first_name: 'Dev', language_code: 'fa' };
  }
  return verifyInitData(req.headers.get('x-init-data'), env.BOT_TOKEN);
}

async function touchUser(env, u, lang) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username, lang, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET first_name = ?2, username = ?3, last_seen = ?5, lang = COALESCE(?4, users.lang)`,
  ).bind(u.id, u.first_name || '', u.username || '', lang || null, now).run();
}

async function api(req, env, ctx, url) {
  const path = url.pathname.slice(4); // strip "/api"
  const lang = T.langOf(url.searchParams.get('lang'));

  if (path === '/health') return json({ ok: true });

  const user = await authUser(req, env);
  if (!user) return json({ error: 'auth' }, 401);

  const member = env.DEV === '1' && req.headers.get('x-dev-user') ? true : await isMember(env, user.id, ctx);
  if (path === '/me') {
    ctx.waitUntil(touchUser(env, user, null).catch(() => {}));
    const row = await env.DB.prepare('SELECT lang FROM users WHERE id = ?1').bind(user.id).first();
    return json({
      id: user.id,
      name: user.first_name || '',
      lang: (row && row.lang) || null,
      member: member !== false,
      channel: env.CHANNEL || null,
      channelLink: channelLink(env),
      bot: env.BOT_USERNAME || null,
    });
  }
  if (member === false) return json({ error: 'join', channel: env.CHANNEL, channelLink: channelLink(env) }, 403);

  const cacheable = { 'cache-control': 'private, max-age=300' };

  if (req.method === 'GET') {
    if (path === '/home') return json(await T.home(env, lang), 200, cacheable);
    if (path === '/genres') return json(await T.genres(env, lang), 200, cacheable);
    if (path === '/classics') return json(await T.classicsRow(env, lang), 200, cacheable);
    const am = path.match(/^\/archive\/movie\/(\d{1,9})$/);
    if (am) return json(await T.archiveFor(env, Number(am[1]), url.searchParams.get('ia')), 200, cacheable);
    if (path === '/search') return json(await T.search(env, url.searchParams.get('q'), lang), 200, cacheable);
    if (path === '/discover') {
      const q = Object.fromEntries(url.searchParams);
      const res = await T.discover(env, {
        type: q.type, mood: q.mood, time: q.time, genre: q.genre,
        shuffle: q.shuffle === '1', page: Number(q.page) || 1,
      }, lang);
      return json(res, 200, q.shuffle === '1' ? { 'cache-control': 'no-store' } : cacheable);
    }
    let m = path.match(/^\/title\/(movie|tv)\/(\d{1,9})$/);
    if (m) {
      const t = await T.title(env, m[1], Number(m[2]), lang);
      const state = await env.DB.prepare(
        'SELECT kind FROM items WHERE user_id = ?1 AND type = ?2 AND tmdb_id = ?3',
      ).bind(user.id, m[1], Number(m[2])).all();
      const fol = m[1] === 'tv'
        ? await env.DB.prepare('SELECT 1 FROM follows WHERE user_id = ?1 AND tv_id = ?2').bind(user.id, Number(m[2])).first()
        : null;
      t.mine = { watch: false, seen: false, follow: !!fol };
      for (const r of state.results || []) t.mine[r.kind] = true;
      return json(t, 200, { 'cache-control': 'no-store' });
    }
    m = path.match(/^\/season\/(\d{1,9})\/(\d{1,3})$/);
    if (m) return json(await T.season(env, Number(m[1]), Number(m[2]), lang), 200, cacheable);
    if (path === '/list') {
      const items = await env.DB.prepare(
        'SELECT kind, type, tmdb_id AS id, title, poster, year, rating FROM items WHERE user_id = ?1 ORDER BY added_at DESC LIMIT 600',
      ).bind(user.id).all();
      const follows = await env.DB.prepare(
        `SELECT f.tv_id AS id, s.name AS title, s.poster AS poster FROM follows f LEFT JOIN shows s ON s.tv_id = f.tv_id
         WHERE f.user_id = ?1 ORDER BY f.added_at DESC`,
      ).bind(user.id).all();
      return json({ items: items.results || [], follows: (follows.results || []).map((r) => ({ ...r, type: 'tv' })) }, 200, { 'cache-control': 'no-store' });
    }
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

    if (path === '/lang') {
      const l = body.lang === 'en' ? 'en' : 'fa';
      await touchUser(env, user, l);
      return json({ ok: true, lang: l });
    }

    if (path === '/list') {
      const kind = body.kind === 'seen' ? 'seen' : 'watch';
      const type = body.type === 'tv' ? 'tv' : 'movie';
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad id' }, 400);
      if (body.on) {
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?1').bind(user.id).first();
        if (count && count.n >= MAX_ITEMS) return json({ error: 'limit' }, 400);
        const stmts = [env.DB.prepare(
          `INSERT OR REPLACE INTO items (user_id, kind, type, tmdb_id, title, poster, year, rating, added_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        ).bind(user.id, kind, type, id, String(body.title || '').slice(0, 200), body.poster ? String(body.poster).slice(0, 80) : null,
          Number(body.year) || null, Number(body.rating) || null, Date.now())];
        // Marking something as seen takes it off the want-to-watch list.
        if (kind === 'seen') stmts.push(env.DB.prepare('DELETE FROM items WHERE user_id = ?1 AND kind = ?2 AND type = ?3 AND tmdb_id = ?4').bind(user.id, 'watch', type, id));
        await env.DB.batch(stmts);
      } else {
        await env.DB.prepare('DELETE FROM items WHERE user_id = ?1 AND kind = ?2 AND type = ?3 AND tmdb_id = ?4').bind(user.id, kind, type, id).run();
      }
      return json({ ok: true });
    }

    if (path === '/follow') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad id' }, 400);
      if (!body.on) {
        await env.DB.prepare('DELETE FROM follows WHERE user_id = ?1 AND tv_id = ?2').bind(user.id, id).run();
        return json({ ok: true });
      }
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?1').bind(user.id).first();
      if (count && count.n >= MAX_FOLLOWS) return json({ error: 'limit', max: MAX_FOLLOWS }, 400);
      // Remember the episode that is already out, so following never triggers an
      // alert for something old.
      const d = await T.tmdb(env, `/tv/${id}`, { language: 'en-US' }, 3600);
      const last = d.last_episode_to_air;
      const key = last ? `S${last.season_number}E${last.episode_number}` : null;
      await touchUser(env, user, null);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO shows (tv_id, name, poster, last_ep, last_ep_date, checked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(tv_id) DO UPDATE SET name = ?2, poster = ?3`,
        ).bind(id, String(body.title || d.name || '').slice(0, 200), body.poster || d.poster_path || null, key, last ? last.air_date : null, Date.now()),
        env.DB.prepare(
          'INSERT OR REPLACE INTO follows (user_id, tv_id, added_at, notified) VALUES (?1, ?2, ?3, ?4)',
        ).bind(user.id, id, Date.now(), key),
      ]);
      return json({ ok: true });
    }
  }

  return json({ error: 'not found' }, 404);
}

async function image(url, env) {
  const m = url.pathname.match(/^\/img\/([a-z0-9]+)\/([A-Za-z0-9_-]+\.(jpg|png|svg))$/);
  if (!m || !IMG_SIZES.has(m[1])) return new Response('not found', { status: 404 });
  const r = await fetch(`${env.TMDB_IMG || 'https://image.tmdb.org/t/p'}/${m[1]}/${m[2]}`, { cf: { cacheTtl: 2592000, cacheEverything: true } });
  if (!r.ok) return new Response('not found', { status: 404 });
  return new Response(r.body, {
    headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=2592000, immutable' },
  });
}

async function telegramJs() {
  // Served from our own domain: inside Iran telegram.org itself is often blocked
  // for the Mini App's web view even when the Telegram app works through a proxy.
  const r = await fetch('https://telegram.org/js/telegram-web-app.js', { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) return new Response('/* telegram-web-app.js unavailable */', { headers: { 'content-type': 'text/javascript' } });
  return new Response(r.body, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
      }
      if (url.pathname.startsWith('/api/')) return await api(req, env, ctx, url);
      if (url.pathname.startsWith('/img/')) return await image(url, env);
      if (url.pathname === '/tg.js') return await telegramJs();
      if (url.pathname === '/font/fa.woff2' || url.pathname === '/font/latin.woff2') {
        return new Response(url.pathname === '/font/fa.woff2' ? FONT_FA : FONT_LATIN, {
          headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' },
        });
      }
      if (url.pathname === '/tg/webhook' && req.method === 'POST') {
        if (!env.WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
          return new Response('forbidden', { status: 403 });
        }
        const update = await req.json();
        ctx.waitUntil(handleUpdate(update, env, ctx).catch((e) => console.log('update failed', e && e.stack)));
        return new Response('ok');
      }
      if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.log('error', url.pathname, e && e.stack);
      const status = e && e.status && e.status >= 400 && e.status < 500 ? e.status : 502;
      return json({ error: 'upstream' }, status);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env));
  },
};
