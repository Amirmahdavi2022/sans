// Free, legal, region-free copies of films on the Internet Archive.
//
// Unlike the ad-supported services (Tubi, Pluto…), these play anywhere with no
// VPN to a particular country. Only copies that are clearly legal are shown:
//   - the film was published long enough ago to be public domain in the US
//     (95 years after publication, so in 2026 everything up to 1930), or
//   - the item sits in the Archive's curated Feature Films collection AND is
//     marked public domain / Creative Commons there.
// A licence on an ordinary user upload is NOT trusted: the live check on
// 2026-10-03 found a YIFY rip of Interstellar marked with an open licence.
// Lending-only items, rips, trailers and clips are dropped.

const IA = 'https://archive.org';
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'not', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is']);
const JUNK = /\b(trailers?|teasers?|clips?|scenes?|excerpts?|previews?|promos?|tv spot|radio|review|making of|behind the scenes|reissue|ipod|commentary|soundtrack|music video|featurette|interview|reaction|blooper|yify|yts|rarbg|x26[45]|bluray|blu ray|webrip|web dl|brrip|bdrip|hdrip|dvdrip|hdtv|hevc)\b/;
const CURATED = new Set(['feature_films']);
const LICENSE_OK = /publicdomain|creativecommons\.org\/(licenses|publicdomain)/i;
const VIDEO = /\.(mp4|m4v|ogv|webm|mpe?g|avi|mkv)$/i;

// Last year whose films are public domain in the US this year.
export const pdYear = (now = new Date()) => now.getUTCFullYear() - 96;

export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

const base = (env) => env.ARCHIVE_API || IA;

async function get(env, path, ttl) {
  try {
    const r = await fetch(base(env) + path, { cf: { cacheTtl: ttl, cacheEverything: true }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function search(env, q, rows, ttl) {
  const p = new URLSearchParams({ q, rows: String(rows), output: 'json' });
  for (const f of ['identifier', 'title', 'year', 'downloads', 'licenseurl', 'external-identifier', 'collection']) p.append('fl[]', f);
  p.append('sort[]', 'downloads desc');
  const d = await get(env, `/advancedsearch.php?${p}`, ttl);
  return (d && d.response && d.response.docs) || [];
}

// Does an Archive title belong to this film? Exact, or the film's title followed
// by extra words such as a subtitle or "(1926)".
function sameFilm(iaTitle, names) {
  const t = norm(iaTitle);
  if (!t || JUNK.test(t)) return false;
  return names.some((n) => n && (t === n || t.startsWith(n + ' ')));
}

const curated = (collection) => [].concat(collection || []).some((c) => CURATED.has(String(c)));
const legal = (filmYear, license, collection) => !!(filmYear && filmYear <= pdYear())
  || (LICENSE_OK.test(String(license || '')) && curated(collection));

// Confirms an item really is a watchable, legal, freely streamable copy.
export async function checkItem(env, id, filmYear) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return null;
  const d = await get(env, `/metadata/${encodeURIComponent(id)}`, 86400);
  if (!d || !d.metadata || d.is_dark) return null;
  const m = d.metadata;
  if (m.mediatype !== 'movies') return null;
  if (m['access-restricted-item'] === 'true' || m['access-restricted-item'] === true) return null;
  if (JUNK.test(norm(m.title))) return null;
  if (!legal(filmYear, m.licenseurl, m.collection)) return null;
  const vids = (d.files || []).filter((f) => VIDEO.test(f.name || '') && !JUNK.test(norm(f.name)));
  if (!vids.length) return null;
  return { id, title: String(m.title || ''), url: `https://archive.org/details/${id}`, pd: !!(filmYear && filmYear <= pdYear()) };
}

// Best legal copy of a film, or null.
export async function findFilm(env, { title, original, year, imdb }) {
  if (!year) return null;
  const names = [...new Set([norm(title), norm(original)].filter(Boolean))];
  const titleQs = names.map((n) => words(n)).filter((w) => w.length).map((w) => `title:(${w.join(' AND ')})`);
  if (imdb && /^tt\d+$/.test(imdb)) titleQs.push(`external-identifier:"urn:imdb:${imdb}"`);
  if (!titleQs.length) return null;
  const q = `mediatype:(movies) AND (${titleQs.join(' OR ')}) AND year:[${year - 1} TO ${year + 1}]`;
  const docs = await search(env, q, 12, 86400);
  const imdbUrn = imdb ? `urn:imdb:${imdb}` : null;
  const picks = docs.filter((d) => {
    const ext = [].concat(d['external-identifier'] || []);
    if (imdbUrn && ext.includes(imdbUrn)) return !JUNK.test(norm(d.title));
    return sameFilm(d.title, names);
  }).filter((d) => legal(year, d.licenseurl, d.collection))
    // the curated collection first; inside each group the Archive's download order stays
    .sort((a, b) => Number(curated(b.collection)) - Number(curated(a.collection)));
  for (const d of picks.slice(0, 3)) {
    const ok = await checkItem(env, d.identifier, year);
    if (ok) return ok;
  }
  return null;
}

// Popular legal classics on the Archive, for the home row. Titles only; the
// caller matches them to TMDB for posters.
export async function classics(env, rows = 40) {
  const y = pdYear();
  const q = `collection:(feature_films) AND mediatype:(movies) AND (licenseurl:*publicdomain* OR year:[1890 TO ${y}])`;
  const docs = await search(env, q, rows, 86400);
  const seen = new Set();
  return docs
    .filter((d) => d.title && !JUNK.test(norm(d.title)))
    .map((d) => {
      const yr = Number(String(d.year || '').slice(0, 4)) || null;
      // "The General (complete & clearer) (1926)" → "The General"
      const clean = String(d.title).replace(/\s*[([].*$/, '').replace(/:\s.*$/, '').replace(/\s+[-–|]\s+.*$/, '').trim();
      return { id: d.identifier, title: clean, year: yr, license: d.licenseurl || '' };
    })
    .filter((d) => d.title.length > 1 && d.year && (seen.has(norm(d.title)) ? false : seen.add(norm(d.title))));
}
