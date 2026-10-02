// TMDB access. Everything goes through the Worker so users in Iran never talk to
// themoviedb.org or image.tmdb.org directly (both are often unreachable there).

const API = 'https://api.themoviedb.org/3';

export const LANGS = { fa: 'fa-IR', en: 'en-US' };

export function langOf(v) {
  return v === 'en' ? 'en' : 'fa';
}

export async function tmdb(env, path, params = {}, ttl = 3600) {
  const u = new URL((env.TMDB_API || API) + path);
  u.searchParams.set('api_key', env.TMDB_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  const r = await fetch(u.toString(), { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) {
    const err = new Error(`tmdb ${r.status} ${path}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

const year = (d) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const round1 = (n) => (typeof n === 'number' && n > 0 ? Math.round(n * 10) / 10 : null);

// One small, stable shape for every list item the app shows.
export function card(x, forceType) {
  const type = forceType || x.media_type || (x.first_air_date !== undefined || x.name !== undefined ? 'tv' : 'movie');
  if (type !== 'movie' && type !== 'tv') return null;
  return {
    id: x.id,
    type,
    title: x.title || x.name || '',
    original: x.original_title || x.original_name || '',
    year: year(x.release_date || x.first_air_date),
    rating: round1(x.vote_average),
    votes: x.vote_count || 0,
    poster: x.poster_path || null,
    backdrop: x.backdrop_path || null,
    overview: x.overview || '',
    genres: x.genre_ids || [],
  };
}

export function cards(list, forceType) {
  return (list || []).map((x) => card(x, forceType)).filter((c) => c && (c.poster || c.backdrop));
}

export async function home(env, lang) {
  const language = LANGS[lang];
  const [trending, popular, top, now, onAir, topTv, free] = await Promise.all([
    tmdb(env, '/trending/all/day', { language }, 1800),
    tmdb(env, '/movie/popular', { language, region: 'US' }, 3600),
    tmdb(env, '/movie/top_rated', { language }, 21600),
    tmdb(env, '/movie/now_playing', { language, region: 'US' }, 3600),
    tmdb(env, '/tv/on_the_air', { language }, 3600),
    tmdb(env, '/tv/top_rated', { language }, 21600),
    tmdb(env, '/discover/movie', {
      language, watch_region: 'US', with_watch_monetization_types: 'ads',
      sort_by: 'popularity.desc', 'vote_count.gte': 300, 'vote_average.gte': 6.3,
    }, 21600),
  ]);
  return {
    hero: cards(trending.results).filter((c) => c.backdrop).slice(0, 6),
    rows: [
      { key: 'trending', items: cards(trending.results) },
      { key: 'free', items: cards(free.results, 'movie') },
      { key: 'now', items: cards(now.results, 'movie') },
      { key: 'onair', items: cards(onAir.results, 'tv') },
      { key: 'popular', items: cards(popular.results, 'movie') },
      { key: 'top', items: cards(top.results, 'movie') },
      { key: 'toptv', items: cards(topTv.results, 'tv') },
    ],
  };
}

function pickVideo(videos) {
  const list = (videos && videos.results) || [];
  const yt = list.filter((v) => v.site === 'YouTube');
  const score = (v) => (v.type === 'Trailer' ? 2 : v.type === 'Teaser' ? 1 : 0) + (v.official ? 0.5 : 0);
  yt.sort((a, b) => score(b) - score(a));
  return yt[0] ? yt[0].key : null;
}

export async function title(env, type, id, lang) {
  if (type !== 'movie' && type !== 'tv') throw Object.assign(new Error('bad type'), { status: 400 });
  const language = LANGS[lang];
  const append = 'credits,videos,similar,recommendations,watch/providers';
  const d = await tmdb(env, `/${type}/${id}`, {
    language,
    append_to_response: append,
    include_video_language: lang === 'fa' ? 'fa,en,null' : 'en,null',
  }, 21600);

  // Persian overviews are often missing on TMDB; fall back to English rather than
  // show an empty block.
  let overview = d.overview || '';
  let tagline = d.tagline || '';
  let videoKey = pickVideo(d.videos);
  let overviewLang = lang;
  if (lang === 'fa' && (!overview || !videoKey)) {
    const en = await tmdb(env, `/${type}/${id}`, { language: 'en-US', append_to_response: 'videos' }, 21600);
    if (!overview && en.overview) { overview = en.overview; overviewLang = 'en'; }
    if (!videoKey) videoKey = pickVideo(en.videos);
  }

  const crew = (d.credits && d.credits.crew) || [];
  const directors = type === 'movie'
    ? crew.filter((c) => c.job === 'Director').map((c) => c.name)
    : (d.created_by || []).map((c) => c.name);

  const more = cards((d.recommendations && d.recommendations.results) || [], type);
  const similar = more.length >= 6 ? more : more.concat(cards((d.similar && d.similar.results) || [], type));
  const seen = new Set();

  return {
    id: d.id,
    type,
    title: d.title || d.name || '',
    original: d.original_title || d.original_name || '',
    tagline,
    overview,
    overviewLang,
    year: year(d.release_date || d.first_air_date),
    endYear: type === 'tv' && d.status === 'Ended' ? year(d.last_air_date) : null,
    runtime: type === 'movie' ? d.runtime || null : (d.episode_run_time && d.episode_run_time[0]) || null,
    rating: round1(d.vote_average),
    votes: d.vote_count || 0,
    genres: (d.genres || []).map((g) => g.name),
    poster: d.poster_path || null,
    backdrop: d.backdrop_path || null,
    status: d.status || null,
    imdb: d.imdb_id || null,
    trailer: videoKey,
    directors,
    cast: ((d.credits && d.credits.cast) || []).slice(0, 14).map((c) => ({
      name: c.name, role: c.character || '', photo: c.profile_path || null,
    })),
    seasons: type === 'tv'
      ? (d.seasons || []).filter((s) => s.season_number > 0).map((s) => ({
        n: s.season_number, name: s.name, episodes: s.episode_count, year: year(s.air_date), poster: s.poster_path || null,
      }))
      : [],
    nextEpisode: type === 'tv' && d.next_episode_to_air ? {
      season: d.next_episode_to_air.season_number,
      episode: d.next_episode_to_air.episode_number,
      date: d.next_episode_to_air.air_date,
    } : null,
    similar: similar.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))).slice(0, 18),
    watch: watchFrom(d['watch/providers'] && d['watch/providers'].results, d.original_title || d.original_name || d.title || d.name || ''),
  };
}


// ---- where to watch (data from JustWatch via TMDB) ----
// "ads" means genuinely free with ads. TMDB's "free" bucket also holds some paid
// services by mistake (Paramount+, Prime in some countries, measured 2026-10-02),
// so from "free" only services checked to be really free are kept.
const FREE_OK = new Set([191, 212, 638, 2285, 2409, 2239, 537, 2665]);
const NOT_FREE = new Set([2303, 1853, 2616, 531, 2304, 119, 9, 486]);
export const WATCH_REGIONS = ['US', 'CA', 'GB', 'AU', 'DE', 'NL', 'FR', 'TR'];
const JW_PATH = { US: 'us', CA: 'ca', GB: 'uk', AU: 'au', DE: 'de', NL: 'nl', FR: 'fr', TR: 'tr' };
const PLEX = new Set([538, 2077]);

export function justwatchUrl(region, query) {
  return `https://www.justwatch.com/${JW_PATH[region] || 'us'}/search?q=${encodeURIComponent(query)}`;
}

export function watchFrom(results, query) {
  const res = results || {};
  const free = new Map();
  for (const region of WATCH_REGIONS) {
    const r = res[region];
    if (!r) continue;
    const add = (p) => {
      if (NOT_FREE.has(p.provider_id)) return;
      const e = free.get(p.provider_id) || { id: p.provider_id, name: p.provider_name, logo: p.logo_path || null, regions: [], order: p.display_priority || 99 };
      if (!e.regions.includes(region)) e.regions.push(region);
      free.set(p.provider_id, e);
    };
    (r.ads || []).forEach(add);
    (r.free || []).filter((p) => FREE_OK.has(p.provider_id)).forEach(add);
  }
  const list = [...free.values()]
    .sort((a, b) => b.regions.length - a.regions.length || a.order - b.order)
    .slice(0, 8)
    .map((e) => ({
      id: e.id, name: e.name, logo: e.logo, regions: e.regions,
      // Plex search was checked to land on the title; for everything else the
      // JustWatch page lists the direct "watch" button of each service.
      url: PLEX.has(e.id) ? `https://watch.plex.tv/search?q=${encodeURIComponent(query)}` : justwatchUrl(e.regions[0], query),
    }));
  let subs = [];
  let subsRegion = null;
  for (const region of WATCH_REGIONS) {
    const f = (res[region] && res[region].flatrate) || [];
    if (f.length) {
      subsRegion = region;
      const seen = new Set();
      subs = f.filter((p) => !/Amazon Channel|Apple TV channel|Roku Premium Channel/i.test(p.provider_name))
        .filter((p) => (seen.has(p.provider_name.split(' ')[0]) ? false : seen.add(p.provider_name.split(' ')[0])))
        .slice(0, 5).map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path || null }));
      break;
    }
  }
  return { free: list, subs, subsRegion, more: justwatchUrl(subsRegion || (list[0] && list[0].regions[0]) || 'US', query) };
}

export async function season(env, id, n, lang) {
  const d = await tmdb(env, `/tv/${id}/season/${n}`, { language: LANGS[lang] }, 21600);
  return {
    n: d.season_number,
    episodes: (d.episodes || []).map((e) => ({
      n: e.episode_number, name: e.name, date: e.air_date, runtime: e.runtime || null,
      rating: round1(e.vote_average), still: e.still_path || null, overview: e.overview || '',
    })),
  };
}

export async function search(env, q, lang) {
  const query = String(q || '').trim().slice(0, 80);
  if (!query) return { items: [] };
  const d = await tmdb(env, '/search/multi', { language: LANGS[lang], query, include_adult: 'false' }, 3600);
  const items = cards(d.results).sort((a, b) => b.votes - a.votes);
  return { items };
}

// "What should I watch tonight?" — three answers become one TMDB discover query.
export const MOODS = {
  laugh: { movie: '35', tv: '35' },
  thrill: { movie: '28|53', tv: '10759|80' },
  love: { movie: '10749', tv: '18' },
  mind: { movie: '878|9648', tv: '10765|9648' },
  feel: { movie: '18', tv: '18' },
  fear: { movie: '27', tv: '9648|10765' },
  family: { movie: '16|10751', tv: '16|10751' },
};

export function discoverParams({ type, mood, time, genre }, lang) {
  const t = type === 'tv' ? 'tv' : 'movie';
  const p = {
    language: LANGS[lang],
    sort_by: 'popularity.desc',
    include_adult: 'false',
    'vote_average.gte': 6.6,
    'vote_count.gte': t === 'tv' ? 150 : 400,
  };
  const g = genre ? String(genre).replace(/[^0-9|,]/g, '') : MOODS[mood] && MOODS[mood][t];
  if (g) p.with_genres = g;
  if (time === 'short') p['with_runtime.lte'] = t === 'tv' ? 30 : 100;
  if (time === 'long') p['with_runtime.gte'] = t === 'tv' ? 45 : 120;
  return { type: t, params: p };
}

export async function discover(env, opts, lang) {
  const { type, params } = discoverParams(opts, lang);
  const first = await tmdb(env, `/discover/${type}`, { ...params, page: 1 }, 21600);
  const pages = Math.min(first.total_pages || 1, 12);
  let results = first.results || [];
  if (opts.shuffle && pages > 1) {
    const page = 2 + Math.floor(Math.random() * (pages - 1));
    const extra = await tmdb(env, `/discover/${type}`, { ...params, page }, 21600);
    results = results.concat(extra.results || []);
  } else if (opts.page && opts.page > 1) {
    const more = await tmdb(env, `/discover/${type}`, { ...params, page: Math.min(opts.page, 50) }, 21600);
    results = more.results || [];
  }
  let items = cards(results, type).filter((c) => c.poster);
  if (opts.shuffle) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
  return { items };
}

export async function genres(env, lang) {
  const language = LANGS[lang];
  const [m, t] = await Promise.all([
    tmdb(env, '/genre/movie/list', { language }, 86400),
    tmdb(env, '/genre/tv/list', { language }, 86400),
  ]);
  return { movie: m.genres || [], tv: t.genres || [] };
}
