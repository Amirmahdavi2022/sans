// Probe on a GitHub runner: (1) what fa-IR genre lists look like, (2) every
// free/ad-supported provider TMDB lists across a wide set of regions.
const KEY = process.env.TMDB_KEY;
const api = async (p, q = {}) => {
  const u = new URL('https://api.themoviedb.org/3' + p);
  u.searchParams.set('api_key', KEY);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return (await fetch(u)).json();
};

console.log('== genres fa-IR ==');
for (const t of ['movie', 'tv']) {
  const d = await api(`/genre/${t}/list`, { language: 'fa-IR' });
  console.log(t, JSON.stringify(d.genres));
}
const det = await api('/movie/157336', { language: 'fa-IR' });
console.log('detail genres fa', JSON.stringify(det.genres));

const regions = ['US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'IT', 'ES', 'PT', 'SE', 'NO', 'DK', 'FI', 'TR', 'IN', 'BR', 'MX', 'AR', 'JP', 'KR', 'ZA', 'SG', 'PH', 'AE'];
for (const type of ['movie', 'tv']) {
  const seen = new Map();
  for (const region of regions) {
    const d = await api(`/discover/${type}`, { watch_region: region, with_watch_monetization_types: 'free|ads', sort_by: 'popularity.desc' });
    for (const x of (d.results || []).slice(0, 10)) {
      const w = await api(`/${type}/${x.id}/watch/providers`);
      const rr = (w.results || {})[region] || {};
      for (const k of ['free', 'ads']) for (const p of rr[k] || []) {
        const e = seen.get(p.provider_id) || { name: p.provider_name, kinds: new Set(), regions: new Set(), n: 0 };
        e.kinds.add(k); e.regions.add(region); e.n++;
        seen.set(p.provider_id, e);
      }
    }
  }
  console.log(`\n== ${type}: free/ads providers ==`);
  [...seen.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([id, e]) => console.log(`${id}\t${e.name}\t${[...e.kinds]}\t${[...e.regions].join(',')}\tseen ${e.n}`));
}
