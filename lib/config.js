import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

const CONFIG_FILE = path.join(ROOT, 'config.json');

const defaults = {
  port: 8484,
  mediaDirs: [],
  tmdbApiKey: '',
  language: 'es-MX',
  preferredAudioLang: '',
  preferredSubLang: 'spa',
  encoder: 'auto', // auto | h264_nvenc | h264_qsv | h264_amf | libx264
  hwDecode: true,
  rescanMinutes: 30,
  maxStreams: 4, // reproducciones simultáneas con ffmpeg
  allowedHosts: [], // nombres extra con los que se accede (por ejemplo un DNS propio)
  remoteSettings: false, // true = permitir cambiar carpetas desde otros dispositivos
  ffmpeg: '',
  ffprobe: '',
};

let user = {};
try {
  user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.error('config.json no es válido:', e.message);
    process.exit(1);
  }
}

export const config = { ...defaults, ...user };
config.mediaDirs = (config.mediaDirs || []).map((d) => path.resolve(d));

// Guarda cambios en config.json conservando las claves que el usuario escribió a mano.
export function saveConfig(patch) {
  Object.assign(user, patch);
  Object.assign(config, patch);
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(user, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_FILE);
}

function findBin(name, configured) {
  if (configured && fs.existsSync(configured)) return configured;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const la = process.env.LOCALAPPDATA;
  if (la) {
    const link = path.join(la, 'Microsoft', 'WinGet', 'Links', exe);
    if (fs.existsSync(link)) return link;
    const pk = path.join(la, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(pk)) {
        if (!/ffmpeg/i.test(d)) continue;
        for (const sub of fs.readdirSync(path.join(pk, d))) {
          const p = path.join(pk, d, sub, 'bin', exe);
          if (fs.existsSync(p)) return p;
        }
      }
    } catch {}
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export const FFMPEG = findBin('ffmpeg', config.ffmpeg);
export const FFPROBE = findBin('ffprobe', config.ffprobe);
