// Metadatos opcionales desde TMDB (pósters, sinopsis, nombres de episodios).
// Solo se usa si config.json tiene "tmdbApiKey". Todo queda en caché en data/.
import fs from 'node:fs';
import path from 'node:path';
import { config, DATA } from './config.js';
import { JsonStore, hash } from './util.js';

const store = new JsonStore(path.join(DATA, 'tmdb.json'), {});
const IMG = path.join(DATA, 'img');
fs.mkdirSync(IMG, { recursive: true });
const RETRY = 7 * 864e5;

export const enabled = () => !!(config.tmdbApiKey || '').trim();

async function api(p, params = {}) {
  const u = new URL(`https://api.themoviedb.org/3${p}`);
  u.searchParams.set('language', config.language);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  const headers = { accept: 'application/json' };
  const key = config.tmdbApiKey.trim();
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  else u.searchParams.set('api_key', key);
  const r = await fetch(u, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`TMDB ${r.status} en ${p}`);
  return r.json();
}

function fresh(c) {
  return c && (c.found || Date.now() - c.at < RETRY);
}

export function peek(kind, name, year) {
  const c = store.data[`${kind}|${name.toLowerCase()}|${year || ''}`];
  return c?.found ? c : null;
}

export function peekSeason(tmdbId, n) {
  const c = store.data[`season|${tmdbId}|${n}`];
  return c?.found ? c : null;
}

export async function lookup(kind, name, year) {
  if (!enabled()) return null;
  const k = `${kind}|${name.toLowerCase()}|${year || ''}`;
  if (fresh(store.data[k])) return peek(kind, name, year);
  try {
    const ep = kind === 'tv' ? '/search/tv' : '/search/movie';
    const yp = kind === 'tv' ? 'first_air_date_year' : 'primary_release_year';
    let j = await api(ep, { query: name, [yp]: year });
    if (!j.results?.length && year) j = await api(ep, { query: name });
    const r = j.results?.[0];
    store.data[k] = r
      ? {
          found: true,
          at: Date.now(),
          tmdbId: r.id,
          title: r.name || r.title,
          overview: r.overview,
          poster: r.poster_path,
          backdrop: r.backdrop_path,
          rating: r.vote_average,
          year: (r.first_air_date || r.release_date || '').slice(0, 4),
        }
      : { found: false, at: Date.now() };
    store.save();
  } catch (e) {
    console.warn('[tmdb]', e.message);
  }
  return peek(kind, name, year);
}

export async function season(tmdbId, n) {
  if (!enabled()) return null;
  const k = `season|${tmdbId}|${n}`;
  if (fresh(store.data[k])) return peekSeason(tmdbId, n);
  try {
    const j = await api(`/tv/${tmdbId}/season/${n}`);
    const episodes = {};
    for (const e of j.episodes || []) episodes[e.episode_number] = { name: e.name, overview: e.overview, still: e.still_path };
    store.data[k] = { found: true, at: Date.now(), episodes };
  } catch (e) {
    store.data[k] = { found: false, at: Date.now() };
    console.warn('[tmdb]', e.message);
  }
  store.save();
  return peekSeason(tmdbId, n);
}

/** Descarga (una vez) una imagen de TMDB y devuelve la ruta local. */
export async function image(p, size) {
  if (!p) return null;
  const file = path.join(IMG, `${hash(size + p)}.jpg`);
  if (fs.existsSync(file)) return file;
  try {
    const r = await fetch(`https://image.tmdb.org/t/p/${size}${p}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}
