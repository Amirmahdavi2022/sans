// Hourly new-episode check. The free Workers plan allows 50 outbound requests per
// invocation, so each run works through a bounded slice and leaves the rest for
// the next hour: shows not checked recently go first, and a follower whose alert
// could not be sent keeps the old marker and is picked up next time.

import { tmdb } from './tmdb.js';
import { bot } from './telegram.js';

const BUDGET = 40;          // outbound fetches per run (TMDB + Telegram)
const RECHECK_MS = 6 * 3600 * 1000;
const FRESH_DAYS = 3;       // only announce episodes that aired in the last few days

const fa = (n) => Number(n).toLocaleString('fa-IR');

export function alertText(lang, show, s, e, epName) {
  if (lang === 'en') {
    return `🔔 New episode of <b>${show}</b> is out!\nSeason ${s}, episode ${e}${epName ? ` · ${epName}` : ''}`;
  }
  return `🔔 قسمت جدید <b>${show}</b> اومد!\nفصل ${fa(s)}، قسمت ${fa(e)}${epName ? ` · ${epName}` : ''}`;
}

export function isFresh(airDate, now = Date.now()) {
  if (!airDate) return false;
  const t = Date.parse(`${airDate}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return t <= now && now - t <= FRESH_DAYS * 86400 * 1000;
}

const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function runAlerts(env) {
  let budget = BUDGET;
  const now = Date.now();
  const due = await env.DB.prepare(
    `SELECT s.tv_id, s.name FROM shows s WHERE EXISTS (SELECT 1 FROM follows f WHERE f.tv_id = s.tv_id)
     AND s.checked_at < ?1 ORDER BY s.checked_at ASC LIMIT 12`,
  ).bind(now - RECHECK_MS).all();

  for (const show of due.results || []) {
    if (budget < 2) break;
    budget -= 1;
    let d;
    try {
      d = await tmdb(env, `/tv/${show.tv_id}`, { language: 'en-US' }, 1800);
    } catch (e) {
      console.log('alert fetch failed', show.tv_id, e.message);
      continue;
    }
    const last = d.last_episode_to_air;
    const key = last ? `S${last.season_number}E${last.episode_number}` : null;
    await env.DB.prepare('UPDATE shows SET last_ep = ?2, last_ep_date = ?3, checked_at = ?4, name = COALESCE(name, ?5) WHERE tv_id = ?1')
      .bind(show.tv_id, key, last ? last.air_date : null, now, d.name || null).run();
    if (!key || !isFresh(last.air_date, now)) continue;

    const limit = Math.max(0, budget);
    const pending = await env.DB.prepare(
      `SELECT f.user_id, u.lang FROM follows f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.tv_id = ?1 AND (f.notified IS NULL OR f.notified <> ?2) LIMIT ?3`,
    ).bind(show.tv_id, key, limit + 1).all();
    const rows = pending.results || [];
    let leftover = rows.length > limit;

    for (const p of rows.slice(0, limit)) {
      if (budget < 1) { leftover = true; break; }
      budget -= 1;
      const lang = p.lang === 'en' ? 'en' : 'fa';
      const res = await bot(env, 'sendMessage', {
        chat_id: p.user_id,
        text: alertText(lang, esc(show.name || d.name), last.season_number, last.episode_number, esc(last.name || '')),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: lang === 'en' ? '🎬 Open in Sans' : '🎬 دیدن تو سانس', web_app: { url: `${env.PUBLIC_URL}/#/t/tv/${show.tv_id}` } }]] },
      });
      // Delivered, or the user blocked the bot: either way, don't retry this episode.
      if (res.ok || res.error_code === 403) {
        await env.DB.prepare('UPDATE follows SET notified = ?3 WHERE user_id = ?1 AND tv_id = ?2').bind(p.user_id, show.tv_id, key).run();
      }
    }
    // If followers were left over, make the show due again right away.
    if (leftover) {
      await env.DB.prepare('UPDATE shows SET checked_at = 0 WHERE tv_id = ?1').bind(show.tv_id).run();
    }
  }
}
