import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG, FFPROBE, DATA, config } from './config.js';
import { JsonStore, limiter, run } from './util.js';

const probeStore = new JsonStore(path.join(DATA, 'probe.json'), {});
const THUMBS = path.join(DATA, 'thumbs');
const SUBS = path.join(DATA, 'subs');
fs.mkdirSync(THUMBS, { recursive: true });
fs.mkdirSync(SUBS, { recursive: true });

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const IMAGE_SUBS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub']);

// ---------- ffprobe ----------

const probeLimit = limiter(2);
const probePending = new Map();

export function cachedProbe(item) {
  const c = probeStore.data[item.id];
  return c && c.size === item.size && c.mtime === item.mtime ? c.info : null;
}

function simplify(j) {
  const streams = j.streams || [];
  const videos = streams.filter((s) => s.codec_type === 'video');
  const vi = Math.max(0, videos.findIndex((s) => !s.disposition?.attached_pic));
  const v = videos[vi];
  const lang = (s) => (s.tags?.language || '').toLowerCase();
  return {
    duration: +j.format?.duration || 0,
    video: v
      ? { vi, codec: v.codec_name, profile: v.profile || '', pix: v.pix_fmt || '', w: v.width, h: v.height, bitDepth: /1[02]/.test(v.pix_fmt || '') ? 10 : 8 }
      : null,
    audio: streams
      .filter((s) => s.codec_type === 'audio')
      .map((s, i) => ({ i, codec: s.codec_name, channels: s.channels || 2, lang: lang(s), title: s.tags?.title || '', def: !!s.disposition?.default })),
    subs: streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s, i) => ({
        i,
        codec: s.codec_name,
        lang: lang(s),
        title: s.tags?.title || '',
        forced: !!s.disposition?.forced,
        def: !!s.disposition?.default,
        text: TEXT_SUBS.has(s.codec_name),
        image: IMAGE_SUBS.has(s.codec_name),
      })),
  };
}

export function probe(item) {
  const c = cachedProbe(item);
  if (c) return Promise.resolve(c);
  if (probePending.has(item.id)) return probePending.get(item.id);
  const p = probeLimit(async () => {
    const r = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', item.path], 60000);
    if (r.code !== 0) throw new Error(`ffprobe: ${r.err.trim() || r.code}`);
    const info = simplify(JSON.parse(r.out.toString('utf8')));
    probeStore.data[item.id] = { size: item.size, mtime: item.mtime, info };
    probeStore.save();
    return info;
  }).finally(() => probePending.delete(item.id));
  probePending.set(item.id, p);
  return p;
}

// ---------- miniaturas ----------

const thumbLimit = limiter(2);
const thumbPending = new Map();

export function thumbPath(item) {
  const p = path.join(THUMBS, `${item.id}.jpg`);
  return fs.existsSync(p) ? p : null;
}

export function thumb(item) {
  const out = path.join(THUMBS, `${item.id}.jpg`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (thumbPending.has(item.id)) return thumbPending.get(item.id);
  const p = thumbLimit(async () => {
    const info = await probe(item).catch(() => null);
    const d = info?.duration || 0;
    const at = d ? Math.min(Math.max(d * 0.2, 2), 600) : 60;
    const tmp = `${out}.tmp.jpg`;
    const args = (t) => ['-v', 'error', '-ss', String(t), '-i', item.path, '-map', `0:v:${info?.video?.vi ?? 0}`, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', '-y', tmp];
    let r = await run(FFMPEG, args(at), 60000);
    if (r.code !== 0 || !fs.existsSync(tmp)) r = await run(FFMPEG, args(0), 60000);
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(`miniatura: ${r.err.trim()}`);
    fs.renameSync(tmp, out);
    return out;
  }).finally(() => thumbPending.delete(item.id));
  thumbPending.set(item.id, p);
  return p;
}

// ---------- subtítulos de texto -> WebVTT ----------

const subPending = new Map();

export function textSub(item, n) {
  const out = path.join(SUBS, `${item.id}_${n}.vtt`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const key = `${item.id}_${n}`;
  if (subPending.has(key)) return subPending.get(key);
  const p = (async () => {
    const r = await run(FFMPEG, ['-v', 'error', '-i', item.path, '-map', `0:s:${n}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'], 300000);
    if (r.code !== 0) throw new Error(`subtítulos: ${r.err.trim()}`);
    fs.writeFileSync(out, r.out);
    return out;
  })().finally(() => subPending.delete(key));
  subPending.set(key, p);
  return p;
}

// ---------- codificador ----------

export let ENCODER = 'libx264';

export async function detectEncoder() {
  if (config.encoder && config.encoder !== 'auto') return (ENCODER = config.encoder);
  for (const enc of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
    const r = await run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.5', '-c:v', enc, '-f', 'null', '-'], 20000);
    if (r.code === 0) return (ENCODER = enc);
  }
  return (ENCODER = 'libx264');
}

function encoderArgs(h) {
  const [br, max] = h > 1100 ? [16, 24] : h >= 1000 ? [8, 12] : h >= 700 ? [4, 6] : [2, 3];
  const B = (n) => `${n}M`;
  switch (ENCODER) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '23', '-b:v', B(br), '-maxrate', B(max), '-bufsize', B(max * 2), '-profile:v', 'high', '-g', '48', '-bf', '2'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'faster', '-b:v', B(br), '-maxrate', B(max), '-bufsize', B(max * 2), '-g', '48'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'vbr_peak', '-b:v', B(br), '-maxrate', B(max), '-g', '48'];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-maxrate', B(max), '-bufsize', B(max * 2), '-profile:v', 'high', '-g', '48'];
  }
}

/**
 * Arma los argumentos de ffmpeg.
 *  mode "copy":      video sin tocar (el cliente soporta el códec), solo audio -> AAC estéreo.
 *  mode "transcode": video -> H.264 8-bit por GPU, opcionalmente con subtítulos PGS incrustados.
 */
export function buildArgs({ item, info, t, audio, sub, mode, height, hlsDir, burnFile }) {
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  const vi = info.video?.vi ?? 0;
  const subInfo = sub >= 0 ? info.subs[sub] : null;
  const ss = String(Math.max(0, t || 0).toFixed(3));
  // HLS se escribe a disco: limitamos la lectura a 2x tiempo real (tras 30 s de arranque rápido)
  // para no convertir el episodio entero si nadie lo está viendo.
  const rate = hlsDir ? ['-readrate', '2', '-readrate_initial_burst', '30'] : [];

  if (mode === 'copy') {
    a.push(...rate, '-ss', ss, '-i', item.path, '-map', `0:v:${vi}`, '-map', `0:a:${audio}?`, '-c:v', 'copy');
    if (info.video?.codec === 'hevc') a.push('-tag:v', 'hvc1');
    a.push('-avoid_negative_ts', 'make_zero');
  } else {
    if (ENCODER === 'h264_nvenc' && config.hwDecode) a.push('-hwaccel', 'cuda');
    a.push(...rate, '-ss', ss, '-i', item.path);
    const srcH = info.video?.h || 1080;
    const h = height && height < srcH ? height : 0;
    const fmt = ENCODER === 'libx264' ? 'yuv420p' : 'nv12';
    let chain = subInfo?.image ? `[0:v:${vi}][0:s:${sub}]overlay=x=(W-w)/2:y=H-h:eof_action=pass` : `[0:v:${vi}]null`;
    // Subtítulos de texto incrustados (al transmitir a la TV, que no recibe los subtítulos de la página).
    // Con -ss el video arranca en 0: corremos los tiempos al original para que coincidan con el archivo .vtt.
    if (burnFile && subInfo?.text) {
      const f = burnFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      chain = `[0:v:${vi}]setpts=PTS+${ss}/TB,subtitles=filename='${f}',setpts=PTS-STARTPTS`;
    }
    if (h) chain += `,scale=-2:${h}`;
    chain += `,format=${fmt}[v]`;
    a.push('-filter_complex', chain, '-map', '[v]', '-map', `0:a:${audio}?`, ...encoderArgs(h || srcH));
  }

  a.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-max_muxing_queue_size', '4096', '-map_metadata', '-1', '-map_chapters', '-1');
  if (hlsDir) {
    if (mode !== 'copy') a.push('-force_key_frames', 'expr:gte(t,n_forced*4)');
    a.push(
      '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'event',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', path.join(hlsDir, 'init.mp4'),
      '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_filename', path.join(hlsDir, 'seg%05d.m4s'),
      path.join(hlsDir, 'index.m3u8'),
    );
  } else {
    a.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', 'pipe:1');
  }
  return a;
}

// ---------- HLS (Safari / iPhone) ----------
// iOS no reproduce MP4 progresivo generado al vuelo: necesita una lista HLS con segmentos.

const HLS_ROOT = path.join(DATA, 'hls');
fs.rmSync(HLS_ROOT, { recursive: true, force: true });
fs.mkdirSync(HLS_ROOT, { recursive: true });
const hls = new Map(); // sid -> { key, dir, proc, lastHit, exited, err }
let hlsSeq = 0;

function killHls(sid) {
  const s = hls.get(sid);
  if (!s) return;
  hls.delete(sid);
  if (s.proc.exitCode === null) s.proc.kill('SIGKILL');
  setTimeout(() => fs.rm(s.dir, { recursive: true, force: true }, () => {}), 1500);
}

function startHls(sid, key, opts) {
  if (tooBusy(sid)) throw busyError();
  killHls(sid);
  const old = sessions.get(sid);
  if (old) old.kill('SIGKILL');
  const dir = path.join(HLS_ROOT, `${sid}-${++hlsSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn(FFMPEG, buildArgs({ ...opts, hlsDir: dir }), { windowsHide: true });
  track(proc, sid);
  const s = { key, dir, proc, lastHit: Date.now(), exited: false, err: '' };
  console.log(`[hls] inicio ${opts.mode}${opts.sub >= 0 ? '+subs' : ''} t=${Math.round(opts.t)} ${opts.item.file}`);
  proc.stderr.on('data', (d) => (s.err = (s.err + d).slice(-4000)));
  proc.on('error', (e) => {
    s.exited = true;
    s.err = String(e);
  });
  proc.on('close', (code, signal) => {
    s.exited = true;
    if (code && !signal && s.err.trim()) console.warn(`[hls] ffmpeg terminó (${code}): ${s.err.trim().split('\n').slice(-3).join(' | ')}`);
  });
  hls.set(sid, s);
  return s;
}

// Cierra sesiones HLS que nadie pide hace 2 minutos (pestaña cerrada, pausa larga...).
setInterval(() => {
  for (const [sid, s] of hls) if (Date.now() - s.lastHit > 120000) killHls(sid);
}, 15000).unref();

const segCount = (txt) => (txt.match(/^#EXTINF/gm) || []).length;

/** Devuelve la lista m3u8 de la sesión (arrancándola si cambió algo), reescrita con rutas absolutas. */
export async function hlsPlaylist(sid, key, opts) {
  let s = hls.get(sid);
  if (!s || s.key !== key) s = startHls(sid, key, opts);
  s.lastHit = Date.now();
  const file = path.join(s.dir, 'index.m3u8');
  const t0 = Date.now();
  let txt = '';
  while (Date.now() - t0 < 25000) {
    try {
      txt = fs.readFileSync(file, 'utf8');
    } catch {
      txt = '';
    }
    if (txt && (segCount(txt) >= 2 || txt.includes('#EXT-X-ENDLIST'))) break;
    if (s.exited && !txt) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!txt) throw new Error(s.err.trim() || 'ffmpeg no generó la lista HLS');
  const base = `/api/hlsseg/${encodeURIComponent(sid)}/${path.basename(s.dir)}/`;
  return txt
    .replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES')
    .replace(/URI="([^"]+)"/g, (m, u) => `URI="${base}${u.split(/[\\/]/).pop()}"`)
    .replace(/^(seg\d+\.m4s)$/gm, `${base}$1`);
}

export function hlsSegment(sid, dirName, name) {
  const s = hls.get(sid);
  if (!s || path.basename(s.dir) !== dirName || !/^(init\.mp4|seg\d+\.m4s)$/.test(name)) return null;
  s.lastHit = Date.now();
  const f = path.join(s.dir, name);
  return fs.existsSync(f) ? f : null;
}

// ---------- streaming ----------

const sessions = new Map(); // sid -> proceso ffmpeg activo

// Límite de reproducciones simultáneas, para que nadie en la red pueda saturar la PC abriendo streams.
const live = new Map(); // proceso ffmpeg -> sid
function track(p, sid) {
  live.set(p, sid || '');
  p.on('close', () => live.delete(p));
  p.on('error', () => live.delete(p));
}
// El reproductor que pide de nuevo (adelantar, cambiar pista) reemplaza su propio proceso: no cuenta.
export function tooBusy(sid) {
  let n = 0;
  for (const [p, s] of live) if (p.exitCode === null && !p.killed && (!sid || s !== sid)) n++;
  return n >= Math.max(1, +config.maxStreams || 4);
}
function busyError() {
  const e = new Error(`Hay ${config.maxStreams || 4} reproducciones en curso: cierra alguna e intenta de nuevo.`);
  e.busy = true;
  return e;
}

export function activeStreams() {
  return live.size;
}

export function stream(req, res, opts) {
  const { sid } = opts;
  if (tooBusy(sid)) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '30' });
    return res.end(JSON.stringify({ error: busyError().message }));
  }
  const old = sid && sessions.get(sid);
  if (old) old.kill('SIGKILL');
  if (sid) killHls(sid);

  const args = buildArgs(opts);
  const p = spawn(FFMPEG, args, { windowsHide: true });
  track(p, sid);
  if (sid) sessions.set(sid, p);
  const label = `${opts.mode}${opts.sub >= 0 ? '+subs' : ''} t=${Math.round(opts.t)} ${opts.item.file}`;
  console.log(`[stream] inicio ${label}`);

  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Stream-Mode': opts.mode });
  p.stdout.pipe(res);

  let err = '';
  p.stderr.on('data', (d) => {
    err += d;
    if (err.length > 4000) err = err.slice(-4000);
  });
  const kill = () => {
    if (p.exitCode === null) p.kill('SIGKILL');
  };
  res.on('close', kill);
  p.on('error', (e) => {
    console.error('[stream] no se pudo iniciar ffmpeg:', e.message);
    res.destroy();
  });
  p.on('close', (code, signal) => {
    if (sessions.get(sid) === p) sessions.delete(sid);
    if (code && !signal && err.trim()) console.warn(`[stream] ffmpeg terminó (${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`);
    else console.log(`[stream] fin ${label}`);
    if (!res.writableEnded) res.end();
  });
}

export function stopAll() {
  for (const p of sessions.values()) p.kill('SIGKILL');
  for (const sid of [...hls.keys()]) killHls(sid);
}
