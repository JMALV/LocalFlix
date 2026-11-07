import fs from 'node:fs/promises';
import path from 'node:path';
import { hash } from './util.js';

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.webm', '.ts', '.m2ts', '.wmv', '.mpg', '.mpeg']);
const EXTRA_DIR = /^(featurettes?|extras?|bonus( features)?|behind the scenes|deleted scenes|interviews|shorts|trailers|specials?|other)$/i;
const SEASON_DIR = /^(season|temporada|series|s)[\s._-]*\d+$/i;
const SAMPLE = /(^|[\s._-])sample([\s._-]|$)/i;
const TAGS = /\b(2160p|1080p|720p|576p|480p|4k|uhd|blu-?ray|brrip|bdrip|bdremux|web-?dl|webrip|web|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|avc|10bit|8bit|hdr|hdr10|dv|dts|ac3|eac3|aac|ddp?5[\s.]1|remux|proper|repack|multi|dual|latino|castellano|subs?)\b/i;
const EP_RE = /^(.*?)[\s._\-[(]*[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})(?:[\s._-]*[Ee-](\d{1,3}))?(.*)$/;
const EP_RE2 = /^(.*?)[\s._-]+(\d{1,2})x(\d{2,3})(.*)$/;

function tidy(s) {
  return s
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "The.Matrix.1999.1080p.BluRay" -> { name: "The Matrix", year: 1999 } */
export function nameYear(raw) {
  let s = tidy(raw);
  let year = null;
  const paren = s.match(/\((19|20)\d{2}\)/);
  if (paren) {
    year = +paren[0].slice(1, 5);
    s = s.slice(0, paren.index);
  } else {
    const all = [...s.matchAll(/\b(19|20)\d{2}\b/g)].filter((m) => m.index > 0);
    if (all.length) {
      const last = all[all.length - 1];
      year = +last[0];
      s = s.slice(0, last.index);
    }
  }
  const t = s.match(TAGS);
  if (t && t.index > 0) s = s.slice(0, t.index);
  return { name: s.replace(/[\s\-–(]+$/, '').trim(), year };
}

function episodeTitle(rest) {
  let s = rest.replace(/^[\s._\-–]+/, '');
  if (!s.includes(' ')) s = s.replace(/[._]+/g, ' ');
  s = s.replace(/\s*[([].*$/, '');
  const t = s.match(TAGS);
  if (t) s = s.slice(0, t.index);
  return s.replace(/[\s\-–]+$/, '').trim();
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    console.warn(`[biblioteca] no se pudo leer ${dir}: ${e.message}`);
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (VIDEO_EXT.has(path.extname(e.name).toLowerCase()) && !SAMPLE.test(path.parse(e.name).name)) out.push(full);
  }
  return out;
}

export class Library {
  constructor(dirs) {
    this.dirs = dirs;
    this.items = new Map();
    this.shows = new Map();
    this.movies = [];
    this.scanning = null;
    this.scannedAt = 0;
  }

  scan() {
    if (!this.scanning) this.scanning = this._scan().finally(() => (this.scanning = null));
    return this.scanning;
  }

  async _scan() {
    const t0 = Date.now();
    const items = new Map();
    const shows = new Map();
    const movies = [];
    const extras = [];

    for (const root of this.dirs) {
      const files = await walk(root);
      for (const file of files) {
        let st;
        try {
          st = await fs.stat(file);
        } catch {
          continue;
        }
        const base = path.parse(file).name;
        const dirs = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean);
        const item = { id: hash(file), path: file, file: path.basename(file), size: st.size, mtime: Math.round(st.mtimeMs) };

        if (dirs.some((d) => EXTRA_DIR.test(d))) {
          extras.push({ ...item, type: 'extra', title: tidy(base), dir: path.dirname(file) });
          continue;
        }

        const m = base.match(EP_RE) || base.match(EP_RE2);
        if (m) {
          const isRe2 = !base.match(EP_RE);
          const season = +m[2];
          const episode = +m[3];
          const rest = isRe2 ? m[4] : m[5];
          let { name, year } = nameYear(m[1] || '');
          if (!name) {
            const d = [...dirs].reverse().find((x) => !SEASON_DIR.test(x) && !EP_RE.test(x));
            ({ name, year } = nameYear(d || 'Sin nombre'));
          }
          const showId = hash(`show:${name.toLowerCase()}`);
          let show = shows.get(showId);
          if (!show) {
            show = { id: showId, name, year, seasons: new Map(), extras: [], addedAt: 0, dirs: new Set() };
            shows.set(showId, show);
          }
          if (!show.year && year) show.year = year;
          show.addedAt = Math.max(show.addedAt, item.mtime);
          show.dirs.add(path.dirname(file));
          const ep = { ...item, type: 'episode', showId, season, episode, episodeEnd: m[4] && !isRe2 ? +m[4] : null, title: episodeTitle(rest || '') };
          if (!show.seasons.has(season)) show.seasons.set(season, []);
          show.seasons.get(season).push(ep);
          items.set(ep.id, ep);
          continue;
        }

        let { name, year } = nameYear(base);
        if (name.length < 2 && dirs.length) ({ name, year } = nameYear(dirs[dirs.length - 1]));
        const mv = { ...item, type: 'movie', title: name, year };
        movies.push(mv);
        items.set(mv.id, mv);
      }
    }

    // Asigna extras a la serie cuya carpeta comparte más ruta con el extra.
    for (const ex of extras) {
      let best = null;
      let bestLen = 0;
      for (const sh of shows.values()) {
        for (const d of sh.dirs) {
          let i = 0;
          const a = d.toLowerCase().split(path.sep);
          const b = ex.dir.toLowerCase().split(path.sep);
          while (i < a.length && i < b.length && a[i] === b[i]) i++;
          if (i > bestLen) {
            bestLen = i;
            best = sh;
          }
        }
      }
      if (best && bestLen > 1) {
        const it = { ...ex, showId: best.id };
        best.extras.push(it);
        items.set(it.id, it);
      } else {
        const { name, year } = nameYear(path.parse(ex.path).name);
        const mv = { ...ex, type: 'movie', title: name, year };
        movies.push(mv);
        items.set(mv.id, mv);
      }
    }

    for (const sh of shows.values()) {
      for (const eps of sh.seasons.values()) eps.sort((a, b) => a.episode - b.episode);
      sh.seasons = new Map([...sh.seasons.entries()].sort((a, b) => a[0] - b[0]));
      sh.extras.sort((a, b) => a.title.localeCompare(b.title));
      sh.order = [...sh.seasons.entries()].filter(([n]) => n > 0).flatMap(([, eps]) => eps);
      if (!sh.order.length) sh.order = [...sh.seasons.values()].flat();
      delete sh.dirs;
    }
    movies.sort((a, b) => a.title.localeCompare(b.title));

    this.items = items;
    this.shows = shows;
    this.movies = movies;
    this.scannedAt = Date.now();
    console.log(`[biblioteca] ${shows.size} series, ${movies.length} películas, ${items.size} archivos (${Date.now() - t0} ms)`);
  }

  next(item) {
    if (item.type !== 'episode') return null;
    const order = this.shows.get(item.showId)?.order || [];
    const i = order.findIndex((e) => e.id === item.id);
    return i >= 0 ? order[i + 1] || null : null;
  }

  prev(item) {
    if (item.type !== 'episode') return null;
    const order = this.shows.get(item.showId)?.order || [];
    const i = order.findIndex((e) => e.id === item.id);
    return i > 0 ? order[i - 1] : null;
  }
}
