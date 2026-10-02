// Local stand-in for TMDB, image.tmdb.org and the Telegram Bot API, so the Worker
// can be exercised end to end with `wrangler dev` without reaching the internet.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8799);
export const calls = [];

const palette = [['#3b1d0e', '#ffb547'], ['#0e2a3b', '#59c3ff'], ['#2a0e3b', '#c77dff'], ['#0e3b22', '#5ed39a'], ['#3b0e14', '#ff6b5e'], ['#26262b', '#e6e1d8'], ['#1f2a10', '#c9e35b'], ['#10213b', '#ff8fb1']];
const titles = [
  ['Dune: Part Two', 'تلماسه: قسمت دوم', 'movie', 2024, 8.1], ['Shogun', 'شوگان', 'tv', 2024, 8.6], ['Oppenheimer', 'اوپنهایمر', 'movie', 2023, 8.1],
  ['The Bear', 'خرس', 'tv', 2022, 8.2], ['Inside Out 2', 'درون و بیرون ۲', 'movie', 2024, 7.6], ['Severance', 'جدایی', 'tv', 2022, 8.4],
  ['Interstellar', 'میان‌ستاره‌ای', 'movie', 2014, 8.4], ['Arcane', 'آرکین', 'tv', 2021, 8.7], ['Parasite', 'انگل', 'movie', 2019, 8.5],
  ['Dark', 'تاریکی', 'tv', 2017, 8.4], ['Spirited Away', 'شهر اشباح', 'movie', 2001, 8.5], ['The Last of Us', 'آخرین بازمانده از ما', 'tv', 2023, 8.6],
];
const item = (i, forceType) => {
  const [en, fa, type0, y, r] = titles[i % titles.length];
  const type = forceType || type0;
  const id = 1000 + i;
  const base = { id, vote_average: r, vote_count: 2000 + i * 37, poster_path: `/p_${i % titles.length}.svg`, backdrop_path: `/b_${i % titles.length}.svg`, overview: 'یک داستان نمونه برای تست ظاهر برنامه. این متن فقط برای پر کردن جای خلاصه است و از داده‌ی واقعی نیامده.', genre_ids: [18] };
  return type === 'tv'
    ? { ...base, media_type: 'tv', name: fa, original_name: en, first_air_date: `${y}-01-10` }
    : { ...base, media_type: 'movie', title: fa, original_title: en, release_date: `${y}-03-01` };
};
const list = (n, off = 0, type) => ({ page: 1, total_pages: 3, results: Array.from({ length: n }, (_, k) => item(k + off, type)) });

function svg(kind, idx) {
  const [a, b] = palette[idx % palette.length];
  const [en] = titles[idx % titles.length];
  const w = kind === 'p' ? 500 : 1280, h = kind === 'p' ? 750 : 720;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b}" stop-opacity=".95"/><stop offset=".55" stop-color="${a}"/><stop offset="1" stop-color="#050505"/></linearGradient><radialGradient id="r" cx=".7" cy=".25" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/><circle cx="${w * 0.72}" cy="${h * 0.3}" r="${w * 0.18}" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="10"/><text x="${w / 2}" y="${h * 0.72}" font-family="Georgia,serif" font-size="${kind === 'p' ? 46 : 60}" fill="#fff" fill-opacity=".9" text-anchor="middle">${en.replace('&', '&amp;')}</text></svg>`;
}

function detail(type, id) {
  const i = id - 1000;
  const x = item(i, type);
  const common = {
    ...x, genres: [{ id: 18, name: 'Drama' }, { id: 878, name: 'Science Fiction' }, { id: 12, name: 'Adventure' }],
    tagline: 'هر سانس یه داستانه',
    videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123', official: true }] },
    credits: { cast: Array.from({ length: 8 }, (_, k) => ({ name: ['Timothée Chalamet', 'Zendaya', 'Rebecca Ferguson', 'Javier Bardem', 'Austin Butler', 'Florence Pugh', 'Dave Bautista', 'Josh Brolin'][k], character: 'Role ' + (k + 1), profile_path: null })), crew: [{ job: 'Director', name: 'Denis Villeneuve' }] },
    recommendations: list(8, i + 1, type), similar: list(4, i + 3, type),
    status: 'Returning Series', imdb_id: 'tt0000000',
    'watch/providers': { results: i % 2 === 0 ? {
      US: { link: 'x', ads: [{ provider_id: 73, provider_name: 'Tubi TV', logo_path: '/p_3.svg', display_priority: 5 }, { provider_id: 538, provider_name: 'Plex', logo_path: '/p_4.svg', display_priority: 9 }],
        free: [{ provider_id: 2303, provider_name: 'Paramount Plus Premium', logo_path: '/p_5.svg' }, { provider_id: 638, provider_name: 'Public Domain Movies', logo_path: '/p_6.svg' }],
        flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/p_7.svg' }, { provider_id: 1825, provider_name: 'HBO Max Amazon Channel', logo_path: '/p_2.svg' }] },
      CA: { ads: [{ provider_id: 73, provider_name: 'Tubi TV', logo_path: '/p_3.svg', display_priority: 5 }] },
    } : { US: { flatrate: [{ provider_id: 1899, provider_name: 'HBO Max', logo_path: '/p_1.svg' }] } } },
  };
  if (type === 'tv') {
    return { ...common, episode_run_time: [52], created_by: [{ name: 'Rachel Kondo' }], seasons: [{ season_number: 1, name: 'Season 1', episode_count: 10, air_date: '2024-02-27', poster_path: null }, { season_number: 2, name: 'Season 2', episode_count: 8, air_date: '2026-03-01', poster_path: null }], last_air_date: '2026-09-30', next_episode_to_air: { season_number: 2, episode_number: 6, air_date: '2026-10-09' }, last_episode_to_air: { season_number: 2, episode_number: 5, air_date: process.env.FRESH_DATE || '2026-10-01', name: 'The Return' } };
  }
  return { ...common, runtime: 166 };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (obj, status = 200, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
    const p = u.pathname;
    if (p.startsWith('/img/')) {
      const m = p.match(/\/(p|b)_(\d+)\.svg$/);
      return m ? send(svg(m[1], Number(m[2])), 200, 'image/svg+xml') : send('nope', 404, 'text/plain');
    }
    const tgm = p.match(/^\/bot[^/]+\/(\w+)$/);
    if (tgm) {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
      calls.push({ method: tgm[1], body: j });
      process.stdout.write(`TG ${tgm[1]} ${JSON.stringify(j)}\n`);
      if (tgm[1] === 'getChatMember') return send({ ok: true, result: { status: j.user_id === 999 ? 'left' : 'member' } });
      return send({ ok: true, result: {} });
    }
    // Internet Archive
    if (p === '/archive/advancedsearch.php') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      process.stdout.write(`IA search ${q}\n`);
      const cc = 'http://creativecommons.org/licenses/by/4.0/';
      if (q.includes('collection:(feature_films)')) return send({ response: { docs: [
        { identifier: 'interstellar_cc', title: 'Interstellar (2014)', year: '2014', licenseurl: cc },
        { identifier: 'old_trailer', title: 'Some Old Trailer', year: '1921' },
        { identifier: 'nowhere_film', title: 'Nowhere Film', year: '1925' },
      ] } });
      if (q.includes('interstellar')) return send({ response: { docs: [
        { identifier: 'interstellar_trailer', title: 'Interstellar Trailer', year: '2014', licenseurl: cc, collection: ['feature_films'] },
        { identifier: 'interstellar_rip', title: 'Interstellar 2014 1080p BluRay x264 YIFY', year: '2014', licenseurl: cc, collection: ['opensource_movies'] },
        { identifier: 'interstellar_upload', title: 'Interstellar', year: '2014', licenseurl: cc, collection: ['opensource_movies'] },
        { identifier: 'interstellar_cc', title: 'Interstellar', year: '2014', licenseurl: cc, collection: ['feature_films'] },
      ] } });
      if (q.includes('dune')) return send({ response: { docs: [{ identifier: 'dune_full', title: 'Dune: Part Two', year: '2024' }] } });
      return send({ response: { docs: [] } });
    }
    const iam = p.match(/^\/archive\/metadata\/(.+)$/);
    if (iam) {
      const id = decodeURIComponent(iam[1]);
      if (id === 'interstellar_cc') return send({ metadata: { mediatype: 'movies', title: 'Interstellar', licenseurl: 'http://creativecommons.org/licenses/by/4.0/', collection: ['feature_films', 'moviesandfilms'] }, files: [{ name: 'interstellar.mp4', format: 'h.264' }] });
      if (id === 'interstellar_upload') return send({ metadata: { mediatype: 'movies', title: 'Interstellar', licenseurl: 'http://creativecommons.org/licenses/by/4.0/', collection: 'opensource_movies' }, files: [{ name: 'interstellar.mp4' }] });
      if (id === 'dune_full') return send({ metadata: { mediatype: 'movies', title: 'Dune: Part Two' }, files: [{ name: 'dune.mp4' }] });
      return send({});
    }
    if (!u.searchParams.get('api_key')) return send({ status_message: 'no key' }, 401);
    process.stdout.write(`TMDB ${p}${u.search.replace(/api_key=[^&]+/, 'api_key=*')}\n`);
    const q = p.replace(/^\/3/, '');
    if (q === '/trending/all/day') return send(list(12));
    if (q === '/movie/popular') return send(list(10, 2, 'movie'));
    if (q === '/movie/top_rated') return send(list(10, 6, 'movie'));
    if (q === '/movie/now_playing') return send(list(10, 4, 'movie'));
    if (q === '/tv/on_the_air') return send(list(10, 1, 'tv'));
    if (q === '/tv/top_rated') return send(list(10, 3, 'tv'));
    if (q === '/search/movie') return send(u.searchParams.get('query') === 'Interstellar' && u.searchParams.get('primary_release_year') === '2014' ? { results: [{ ...item(6, 'movie'), vote_count: 900, vote_average: 8.4 }] } : { results: [] });
    if (q === '/search/multi') return send(u.searchParams.get('query') === 'zzz' ? { results: [] } : list(7, 5));
    let m = q.match(/^\/discover\/(movie|tv)$/);
    if (m) return send(list(10, Number(u.searchParams.get('page') || 1) * 3, m[1]));
    m = q.match(/^\/genre\/(movie|tv)\/list$/);
    // like real TMDB: fa-IR genre names come back null; 99999 is an id with no Persian mapping
    if (m) {
      const en = [[28, 'Action'], [35, 'Comedy'], [18, 'Drama'], [27, 'Horror'], [878, 'Science Fiction'], [16, 'Animation'], [99999, 'Brand New']];
      const fa = (u.searchParams.get('language') || '').startsWith('fa');
      return send({ genres: en.map(([id, name]) => ({ id, name: fa ? null : name })) });
    }
    m = q.match(/^\/tv\/(\d+)\/season\/(\d+)$/);
    if (m) return send({ season_number: Number(m[2]), episodes: Array.from({ length: 6 }, (_, k) => ({ episode_number: k + 1, name: `قسمت ${k + 1}`, air_date: '2026-03-0' + (k + 1), runtime: 54, vote_average: 8.2, still_path: null, overview: '' })) });
    m = q.match(/^\/(movie|tv)\/(\d+)$/);
    if (m) {
      const d = detail(m[1], Number(m[2]));
      if (u.searchParams.get('language') === 'fa-IR' && Number(m[2]) % 2 === 0) d.overview = ''; // exercise the English fallback
      return send(d);
    }
    send({ status_message: 'not mocked ' + q }, 404);
  });
});
server.listen(PORT, () => process.stdout.write(`mock on ${PORT}\n`));
