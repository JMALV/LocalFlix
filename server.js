import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config, saveConfig, ROOT, DATA, FFMPEG, FFPROBE } from './lib/config.js';
import { Library } from './lib/library.js';
import * as media from './lib/media.js';
import * as tmdb from './lib/tmdb.js';
import { JsonStore } from './lib/util.js';

if (!FFMPEG || !FFPROBE) {
  console.error('No encontré ffmpeg/ffprobe. Instálalo con:  winget install Gyan.FFmpeg');
  process.exit(1);
}

const PUBLIC = path.join(ROOT, 'public');
const progress = new JsonStore(path.join(DATA, 'progress.json'), {});
const lib = new Library(config.mediaDirs);
const WATCHED = 0.92;

// ---------- helpers ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.vtt': 'text/vtt; charset=utf-8',
  '.mkv': 'video/x-matroska',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.mov': 'video/quicktime',
  '.srt': 'application/x-subrip',
};

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function notFound(res, msg = 'No encontrado') {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

function sendFile(req, res, file, { cache = 'no-cache' } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
    let start = 0;
    let end = st.size - 1;
    if (range) {
      if (range[1]) start = +range[1];
      if (range[2]) end = Math.min(+range[2], st.size - 1);
      if (!range[1] && range[2]) {
        start = Math.max(0, st.size - +range[2]);
        end = st.size - 1;
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
    }
    if (req.method === 'HEAD') return res.end();
    const s = fs.createReadStream(file, { start, end, highWaterMark: 1 << 20 });
    s.pipe(res);
    res.on('close', () => s.destroy());
  });
}

function readBody(req, limit = 1e5) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => {
      b += d;
      if (b.length > limit) reject(new Error('cuerpo demasiado grande'));
    });
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function lanIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// ---------- serialización ----------

function prog(id) {
  const p = progress.data[id];
  if (!p) return null;
  return { t: p.t, d: p.d, pct: p.d ? Math.min(1, p.t / p.d) : 0, watched: p.d ? p.t / p.d >= WATCHED : false, at: p.at };
}

function meta(entity) {
  if (entity.seasons) return tmdb.peek('tv', entity.name, entity.year);
  return tmdb.peek('movie', entity.title, entity.year);
}

function epMeta(ep) {
  const sh = lib.shows.get(ep.showId);
  const m = sh && meta(sh);
  return m ? tmdb.peekSeason(m.tmdbId, ep.season)?.episodes?.[ep.episode] : null;
}

function itemOut(it) {
  const info = media.cachedProbe(it);
  const o = {
    id: it.id,
    type: it.type,
    title: it.title,
    duration: info?.duration || 0,
    progress: prog(it.id),
    file: it.file,
  };
  if (it.type === 'episode') {
    const em = epMeta(it);
    Object.assign(o, { showId: it.showId, show: lib.shows.get(it.showId)?.name, season: it.season, episode: it.episode, episodeEnd: it.episodeEnd });
    if (!o.title && em?.name) o.title = em.name;
    if (em?.overview) o.overview = em.overview;
  }
  if (it.type === 'extra') o.showId = it.showId;
  if (it.type === 'movie') {
    const m = meta(it);
    Object.assign(o, { year: it.year, overview: m?.overview, rating: m?.rating, hasPoster: !!m?.poster });
  }
  return o;
}

function showOut(sh) {
  const m = meta(sh);
  const eps = sh.order.length;
  const watched = sh.order.filter((e) => prog(e.id)?.watched).length;
  return {
    kind: 'show',
    id: sh.id,
    name: m?.title && m.title.toLowerCase() !== sh.name.toLowerCase() ? m.title : sh.name,
    year: sh.year || (m?.year ? +m.year : null),
    seasons: [...sh.seasons.keys()].filter((n) => n > 0).length,
    episodes: eps,
    watched,
    overview: m?.overview || '',
    rating: m?.rating || null,
    hasPoster: !!m?.poster,
    addedAt: sh.addedAt,
  };
}

function movieCard(mv) {
  const o = itemOut(mv);
  return { kind: 'movie', id: mv.id, name: mv.title, year: mv.year, hasPoster: o.hasPoster, overview: o.overview, rating: o.rating, progress: o.progress, addedAt: mv.mtime };
}

/** Episodio con el que debería seguir una serie (en curso, o el siguiente al último visto). */
function resumeFor(sh) {
  let last = null;
  for (const e of sh.order) {
    const p = progress.data[e.id];
    if (p && (!last || p.at > last.p.at)) last = { e, p };
  }
  if (!last) return { item: sh.order[0], at: 0, started: false };
  const pr = prog(last.e.id);
  if (!pr.watched) return { item: last.e, at: last.p.at, started: true };
  const nx = lib.next(last.e);
  return nx ? { item: nx, at: last.p.at, started: true, isNext: true } : { item: sh.order[0], at: 0, started: false, finished: true };
}

function continueList() {
  const list = [];
  for (const sh of lib.shows.values()) {
    if (!sh.order.length) continue;
    const r = resumeFor(sh);
    if (r.started && !r.finished) list.push({ ...itemOut(r.item), at: r.at, isNext: !!r.isNext });
  }
  for (const mv of lib.movies) {
    const p = prog(mv.id);
    if (p && p.t > 30 && !p.watched) list.push({ ...itemOut(mv), at: p.at });
  }
  return list.sort((a, b) => b.at - a.at).slice(0, 20);
}

// ---------- rutas ----------

const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });

route('GET', /^\/api\/config$/, (req, res) =>
  json(res, {
    preferredSubLang: config.preferredSubLang,
    preferredAudioLang: config.preferredAudioLang,
    encoder: media.ENCODER,
    tmdb: tmdb.enabled(),
    needsSetup: !config.mediaDirs.length,
  }),
);

// ---------- carpetas de la biblioteca ----------

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// Las carpetas solo se cambian desde la PC donde corre LocalFlix (salvo "remoteSettings": true).
const canEdit = (req) => config.remoteSettings === true || isLocalClient(req);
const denyRemote = (res) => json(res, { ok: false, error: 'Las carpetas solo se pueden cambiar desde la PC donde corre LocalFlix.' }, 403);

route('GET', /^\/api\/settings$/, (req, res) =>
  json(res, {
    mediaDirs: config.mediaDirs.map((p) => ({ path: p, ok: isDir(p) })),
    items: lib.items.size,
    scanning: !!lib.scanning,
    canEdit: canEdit(req),
  }),
);

route('POST', /^\/api\/settings$/, async (req, res) => {
  if (!canEdit(req)) return denyRemote(res);
  let b;
  try {
    b = await readBody(req);
  } catch (e) {
    return json(res, { ok: false, error: e.message }, 400);
  }
  if (!Array.isArray(b.mediaDirs)) return json(res, { ok: false, error: 'Falta la lista de carpetas' }, 400);
  const dirs = [...new Set(b.mediaDirs.map((d) => String(d).trim()).filter(Boolean).map((d) => path.resolve(d)))];
  const bad = dirs.filter((d) => !isDir(d));
  if (bad.length) return json(res, { ok: false, error: `No existe la carpeta: ${bad.join(', ')}` }, 400);
  saveConfig({ mediaDirs: dirs });
  lib.dirs = dirs;
  if (lib.scanning) await lib.scanning.catch(() => {});
  console.log(`[config] carpetas: ${dirs.join(', ') || '(ninguna)'}`);
  await lib.scan();
  warmup();
  json(res, { ok: true, items: lib.items.size });
});

// Explorador para elegir carpetas desde la web: solo devuelve nombres de carpetas, nunca archivos.
route('GET', /^\/api\/fs$/, (req, res) => {
  if (!canEdit(req)) return denyRemote(res);
  const q =new URL(req.url, 'http://x').searchParams.get('path');
  if (!q) {
    const roots = [];
    if (process.platform === 'win32') {
      for (let c = 65; c <= 90; c++) {
        const d = String.fromCharCode(c) + ':\\';
        if (isDir(d)) roots.push({ name: d, path: d });
      }
    } else roots.push({ name: '/', path: '/' });
    const home = os.homedir();
    for (const n of ['Videos', 'Movies', 'Downloads', 'Descargas']) {
      const p = path.join(home, n);
      if (isDir(p)) roots.push({ name: p, path: p });
    }
    return json(res, { path: '', parent: null, dirs: roots });
  }
  const full = path.resolve(q);
  let entries;
  try {
    entries = fs.readdirSync(full, { withFileTypes: true });
  } catch {
    return json(res, { error: `No se puede abrir ${full}` }, 400);
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !/^[.$]/.test(e.name) && !/^(System Volume Information|Recovery|PerfLogs|Windows|Config\.Msi)$/i.test(e.name))
    .map((e) => ({ name: e.name, path: path.join(full, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(full);
  json(res, { path: full, parent: parent === full ? '' : parent, dirs });
});

route('GET', /^\/api\/home$/, (req, res) => {
  const shows = [...lib.shows.values()].map(showOut).sort((a, b) => a.name.localeCompare(b.name));
  const movies = lib.movies.map(movieCard);
  const recent = [...shows, ...movies].sort((a, b) => b.addedAt - a.addedAt).slice(0, 20);
  const cont = continueList();
  const pool = [...shows, ...movies];
  let hero = null;
  if (cont[0]) hero = cont[0].showId ? shows.find((s) => s.id === cont[0].showId) : movies.find((m) => m.id === cont[0].id);
  if (!hero && pool.length) hero = pool[Math.floor(Math.random() * pool.length)];
  if (hero?.kind === 'show') {
    const r = resumeFor(lib.shows.get(hero.id));
    const p = prog(r.item.id);
    const code = `T${r.item.season}:E${r.item.episode}`;
    hero = { ...hero, resumeId: r.item.id, resumeLabel: r.started ? `${p && !p.watched && p.t > 30 ? 'Continuar' : 'Reproducir'} ${code}` : 'Reproducir' };
  } else if (hero) {
    const p = hero.progress;
    hero = { ...hero, resumeId: hero.id, resumeLabel: p && !p.watched && p.t > 30 ? 'Continuar' : 'Reproducir' };
  }
  json(res, { hero, continue: cont, recent, shows, movies, scanning: !!lib.scanning });
});

route('GET', /^\/api\/show\/(\w+)$/, (req, res, m) => {
  const sh = lib.shows.get(m[1]);
  if (!sh) return notFound(res);
  const r = resumeFor(sh);
  json(res, {
    ...showOut(sh),
    resume: { ...itemOut(r.item), started: r.started, isNext: !!r.isNext },
    seasonList: [...sh.seasons.entries()].map(([n, eps]) => ({ n, episodes: eps.map(itemOut) })),
    extras: sh.extras.map(itemOut),
  });
});

route('GET', /^\/api\/movie\/(\w+)$/, (req, res, m) => {
  const it = lib.items.get(m[1]);
  if (!it || it.type !== 'movie') return notFound(res);
  json(res, { ...movieCard(it), ...itemOut(it) });
});

route('GET', /^\/api\/item\/(\w+)$/, async (req, res, m) => {
  const it = lib.items.get(m[1]);
  if (!it) return notFound(res);
  try {
    const info = await media.probe(it);
    const nx = lib.next(it);
    const pv = lib.prev(it);
    json(res, { ...itemOut(it), info, next: nx ? itemOut(nx) : null, prev: pv ? { id: pv.id } : null });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

route('GET', /^\/api\/search$/, (req, res, m, url) => {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q) return json(res, { shows: [], movies: [], episodes: [] });
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nq = norm(q);
  const shows = [...lib.shows.values()].filter((s) => norm(s.name).includes(nq) || norm(meta(s)?.title).includes(nq)).map(showOut);
  const movies = lib.movies.filter((mv) => norm(mv.title).includes(nq) || norm(meta(mv)?.title).includes(nq)).map(movieCard);
  const episodes = [...lib.items.values()]
    .filter((it) => it.type === 'episode' && norm(it.title || epMeta(it)?.name).includes(nq))
    .slice(0, 30)
    .map(itemOut);
  json(res, { shows, movies, episodes });
});

route('GET', /^\/api\/progress$/, (req, res) => json(res, continueList()));

route('POST', /^\/api\/progress$/, async (req, res) => {
  try {
    const b = await readBody(req);
    const it = lib.items.get(b.id);
    if (!it || !(b.t >= 0)) return json(res, { ok: false }, 400);
    if (b.reset) delete progress.data[b.id];
    else progress.data[b.id] = { t: +b.t, d: +b.d || 0, at: Date.now() };
    progress.save();
    json(res, { ok: true });
  } catch (e) {
    json(res, { ok: false, error: e.message }, 400);
  }
});

route('POST', /^\/api\/rescan$/, async (req, res) => {
  await lib.scan();
  warmup();
  json(res, { ok: true, items: lib.items.size });
});

function playOpts(it, info, q) {
  const qual = q.get('q');
  return {
    item: it,
    info,
    t: +q.get('t') || 0,
    audio: Math.max(0, +q.get('a') || 0),
    sub: q.has('s') && q.get('s') !== '' ? +q.get('s') : -1,
    mode: q.get('m') === 'copy' ? 'copy' : 'transcode',
    height: qual && /^\d+$/.test(qual) ? +qual : 1080,
    sid: (q.get('sid') || '').replace(/[^\w-]/g, '').slice(0, 64),
  };
}

// Reproducción: fMP4 fragmentado generado al vuelo por ffmpeg (Chrome, Android, PC).
route('GET', /^\/api\/play\/(\w+)$/, async (req, res, m, url) => {
  const it = lib.items.get(m[1]);
  if (!it) return notFound(res);
  let info;
  try {
    info = await media.probe(it);
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
  media.stream(req, res, playOpts(it, info, url.searchParams));
});

// Reproducción HLS para Safari / iPhone.
route('GET', /^\/api\/hls\/(\w+)\/index\.m3u8$/, async (req, res, m, url) => {
  const it = lib.items.get(m[1]);
  if (!it) return notFound(res);
  try {
    const info = await media.probe(it);
    const o = playOpts(it, info, url.searchParams);
    if (!o.sid) return json(res, { error: 'falta sid' }, 400);
    const key = `${it.id}|${o.t}|${o.audio}|${o.sub}|${o.mode}|${o.height}`;
    const txt = await media.hlsPlaylist(o.sid, key, o);
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
    res.end(txt);
  } catch (e) {
    console.warn('[hls]', e.message);
    json(res, { error: e.message }, e.busy ? 503 : 500);
  }
});

route('GET', /^\/api\/hlsseg\/([\w-]+)\/([\w-]+)\/([\w.]+)$/, (req, res, m) => {
  const f = media.hlsSegment(m[1], m[2], m[3]);
  if (!f) return notFound(res);
  sendFile(req, res, f, { cache: 'no-cache' });
});

// El reproductor lo consulta cuando falla, para distinguir "límite de reproducciones" de un error del video.
route('GET', /^\/api\/busy$/, (req, res, m, url) => {
  const sid = (url.searchParams.get('sid') || '').replace(/[^\w-]/g, '');
  json(res, { busy: media.tooBusy(sid), max: Math.max(1, +config.maxStreams || 4) });
});

// Archivo original con soporte de Range (VLC, Kodi, MX Player...).
route('GET', /^\/api\/file\/(\w+)(?:\/.*)?$/, (req, res, m) => {
  const it = lib.items.get(m[1]);
  if (!it) return notFound(res);
  sendFile(req, res, it.path);
});

route('GET', /^\/api\/subs\/(\w+)\/(\d+)\.vtt$/, async (req, res, m) => {
  const it = lib.items.get(m[1]);
  if (!it) return notFound(res);
  try {
    sendFile(req, res, await media.textSub(it, +m[2]));
  } catch (e) {
    notFound(res, e.message);
  }
});

// Imágenes: miniaturas generadas con ffmpeg, o pósters de TMDB si hay API key.
async function firstThumb(sh) {
  const ep = sh.order[0] || [...sh.seasons.values()].flat()[0];
  return ep ? media.thumb(ep) : null;
}

route('GET', /^\/api\/img\/(thumb|still|poster|backdrop)\/(\w+)$/, async (req, res, m) => {
  const [, kind, id] = m;
  const sh = lib.shows.get(id);
  const it = lib.items.get(id);
  const img = (f) => (f ? sendFile(req, res, f, { cache: 'public, max-age=86400' }) : notFound(res));
  try {
    if (kind === 'thumb') return img(it && (await media.thumb(it)));
    if (kind === 'still') {
      if (!it) return notFound(res);
      const em = it.type === 'episode' && epMeta(it);
      return img((em?.still && (await tmdb.image(em.still, 'w500'))) || (await media.thumb(it)));
    }
    const mt = sh ? meta(sh) : it ? meta(it) : null;
    const p = kind === 'poster' ? mt?.poster : mt?.backdrop;
    const size = kind === 'poster' ? 'w500' : 'w1280';
    const local = p && (await tmdb.image(p, size));
    if (local) return img(local);
    if (sh) return img(await firstThumb(sh));
    if (it) return img(await media.thumb(it));
    notFound(res);
  } catch {
    notFound(res);
  }
});

// Listas M3U para VLC u otros reproductores.
function m3u(req, res, entries, name) {
  const host = req.headers.host;
  let out = '#EXTM3U\n';
  for (const { it, label } of entries) {
    const d = Math.round(media.cachedProbe(it)?.duration || -1);
    out += `#EXTINF:${d},${label}\nhttp://${host}/api/file/${it.id}/${encodeURIComponent(it.file)}\n`;
  }
  res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8', 'Content-Disposition': `inline; filename="${name}.m3u"` });
  res.end(out);
}
const epLabel = (sh, e) => `${sh.name} - T${e.season}E${String(e.episode).padStart(2, '0')}${e.title ? ` - ${e.title}` : ''}`;

route('GET', /^\/api\/m3u\/show\/(\w+)\.m3u$/, (req, res, m) => {
  const sh = lib.shows.get(m[1]);
  if (!sh) return notFound(res);
  m3u(req, res, sh.order.map((e) => ({ it: e, label: epLabel(sh, e) })), 'serie');
});

route('GET', /^\/api\/m3u\/all\.m3u$/, (req, res) => {
  const entries = [];
  for (const sh of [...lib.shows.values()].sort((a, b) => a.name.localeCompare(b.name))) for (const e of sh.order) entries.push({ it: e, label: epLabel(sh, e) });
  for (const mv of lib.movies) entries.push({ it: mv, label: mv.year ? `${mv.title} (${mv.year})` : mv.title });
  m3u(req, res, entries, 'localflix');
});

// Listado de carpetas estilo Apache: Kodi lo puede agregar como fuente "HTTP".
const BROWSE_EXT = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|mpg|mpeg|srt|ass|ssa|sub|idx|jpg|jpeg|png|nfo)$/i;
route('GET', /^\/browse(\/.*)?$/, (req, res, m) => {
  const parts = (m[1] || '/')
    .split('/')
    .map((p) => decodeURIComponent(p))
    .filter(Boolean);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const listing = (title, links) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Index of ${esc(title)}</title></head><body><h1>Index of ${esc(title)}</h1><pre>\n${links.join('\n')}\n</pre></body></html>`);
  };
  if (!parts.length) {
    return listing('/', config.mediaDirs.map((d, i) => `<a href="${i}/">${esc(path.basename(d) || d)}/</a>`));
  }
  const root = config.mediaDirs[+parts[0]];
  if (!root || !/^\d+$/.test(parts[0])) return notFound(res);
  if (parts.slice(1).some((p) => p.startsWith('.') || p.startsWith('$'))) return notFound(res);
  const full = path.resolve(root, ...parts.slice(1));
  if (full !== root && !full.startsWith(root + path.sep)) return notFound(res);
  fs.stat(full, (err, st) => {
    if (err) return notFound(res);
    // Solo videos, subtítulos e imágenes: nunca otros archivos que haya en la carpeta.
    if (st.isFile()) return BROWSE_EXT.test(full) ? sendFile(req, res, full) : notFound(res);
    if (!req.url.split('?')[0].endsWith('/')) {
      res.writeHead(301, { Location: req.url.split('?')[0] + '/' });
      return res.end();
    }
    const entries = fs
      .readdirSync(full, { withFileTypes: true })
      .filter((e) => !/^[.$]/.test(e.name) && (e.isDirectory() || (e.isFile() && BROWSE_EXT.test(e.name))))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    listing(`/${parts.join('/')}/`, [
      '<a href="../">../</a>',
      ...entries.map((e) => {
        const n = e.name + (e.isDirectory() ? '/' : '');
        return `<a href="${encodeURIComponent(e.name)}${e.isDirectory() ? '/' : ''}">${esc(n)}</a>`;
      }),
    ]);
  });
});

// Archivos estáticos de la interfaz.
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.resolve(PUBLIC, `.${rel}`);
  if (!file.startsWith(PUBLIC + path.sep)) return notFound(res);
  sendFile(req, res, file);
}

// ---------- protección de pedidos ----------

const ownAddrs = () => new Set(['127.0.0.1', '::1', ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => i.address)]);
const bareAddr = (a = '') => a.replace(/^::ffff:/, '');

// El pedido viene de la propia PC (por localhost o por su IP de la red).
function isLocalClient(req) {
  return ownAddrs().has(bareAddr(req.socket.remoteAddress));
}

// Solo se aceptan pedidos dirigidos a nombres de esta PC: bloquea el "DNS rebinding", con el que una página web
// maliciosa apunta su propio dominio a tu IP para leer LocalFlix desde el navegador de la víctima.
function hostAllowed(hostHeader) {
  if (!hostHeader) return true; // clientes HTTP/1.0 muy viejos
  let h = hostHeader.toLowerCase();
  h = h.startsWith('[') ? h.slice(1, h.indexOf(']')) : h.replace(/:\d+$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === os.hostname().toLowerCase()) return true;
  if (config.allowedHosts.some((x) => String(x).toLowerCase() === h)) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return true; // una IP no se puede "rebindear"
  return false;
}

// Los pedidos que cambian algo tienen que venir de la propia interfaz: JSON y, si hay Origin, del mismo host.
// Así una página externa no puede enviar formularios o fetch "simples" a LocalFlix.
function writeAllowed(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Host no permitido. Si usas un nombre propio para esta PC, agrégalo en "allowedHosts" de config.json.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !writeAllowed(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Pedido rechazado.');
  }
  try {
    for (const r of routes) {
      if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
      const m = r.re.exec(url.pathname);
      if (m) return await r.fn(req, res, m, url);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    notFound(res);
  } catch (e) {
    console.error('[http]', req.url, e);
    if (!res.headersSent) json(res, { error: e.message }, 500);
    else res.destroy();
  }
});
server.keepAliveTimeout = 65000;
server.requestTimeout = 0; // los streams pueden durar horas

// Precalcula datos (ffprobe, miniaturas, TMDB) en segundo plano.
let warming = false;
async function warmup() {
  if (warming) return;
  warming = true;
  try {
    const all = [...lib.items.values()];
    for (const it of all) await media.probe(it).catch(() => {});
    if (tmdb.enabled()) {
      for (const sh of lib.shows.values()) {
        const m = await tmdb.lookup('tv', sh.name, sh.year);
        if (m) {
          for (const n of sh.seasons.keys()) await tmdb.season(m.tmdbId, n);
          await tmdb.image(m.poster, 'w500');
          await tmdb.image(m.backdrop, 'w1280');
        }
      }
      for (const mv of lib.movies) {
        const m = await tmdb.lookup('movie', mv.title, mv.year);
        if (m) await tmdb.image(m.poster, 'w500');
      }
    }
    for (const it of all) await media.thumb(it).catch(() => {});
    console.log('[warmup] listo');
  } finally {
    warming = false;
  }
}

async function main() {
  const enc = await media.detectEncoder();
  console.log(`[ffmpeg] ${FFMPEG}`);
  console.log(`[ffmpeg] codificador de video: ${enc}${enc === 'libx264' ? ' (sin GPU: la conversión usará CPU)' : ' (GPU)'}`);
  if (!config.mediaDirs.length) console.log("[config] Todavía no elegiste carpetas: abre LocalFlix en el navegador y elígelas.");
  await lib.scan();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`El puerto ${config.port} ya está en uso: LocalFlix probablemente ya está corriendo (usa "Detener LocalFlix.bat").`);
    else console.error('[http]', e);
    process.exit(1);
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log('\n  LocalFlix está corriendo. Abre en tu celular o TV:');
    console.log(`    http://localhost:${config.port}`);
    for (const ip of lanIPs()) console.log(`    http://${ip}:${config.port}`);
    console.log('');
    warmup();
  });
  if (config.rescanMinutes > 0) {
    setInterval(async () => {
      const before = lib.items.size;
      await lib.scan();
      if (lib.items.size !== before) warmup();
    }, config.rescanMinutes * 60000).unref();
  }
}

const shutdown = () => {
  media.stopAll();
  progress.flush();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
