// Contraseña de LocalFlix: se guarda solo su hash (scrypt) en data/auth.json.
// Las sesiones son cookies firmadas con un secreto que cambia junto con la contraseña,
// así que cambiarla cierra la sesión en todos los dispositivos.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.js';

const FILE = path.join(DATA, 'auth.json');
const COOKIE = 'lf_session';
const SESSION_DAYS = 365;
export const MIN_LENGTH = 4;

let state = null; // { salt, hash, secret, changedAt }
try {
  state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!state?.hash || !state?.secret) state = null;
} catch {}

const scrypt = (pw, salt) => crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64).toString('hex');
const hmac = (data) => crypto.createHmac('sha256', state.secret).update(data).digest('base64url');
const sameStr = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const hasPassword = () => !!state;

export function setPassword(pw) {
  pw = String(pw ?? '');
  if (pw.length < MIN_LENGTH) throw new Error(`La contraseña tiene que tener al menos ${MIN_LENGTH} caracteres.`);
  const salt = crypto.randomBytes(16).toString('hex');
  state = { salt, hash: scrypt(pw, salt), secret: crypto.randomBytes(32).toString('hex'), changedAt: Date.now() };
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
  basicOk.clear();
}

export function checkPassword(pw) {
  if (!state) return false;
  return sameStr(scrypt(pw ?? '', state.salt), state.hash);
}

// ---------- sesión por cookie (navegador) ----------

export function newSessionCookie() {
  const ts = Date.now().toString(36);
  const token = `${ts}.${hmac(`s.${ts}`)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function cookieOk(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w.-]+)`));
  if (!m) return false;
  const [ts, sig] = m[1].split('.');
  if (!ts || !sig || !sameStr(sig, hmac(`s.${ts}`))) return false;
  return Date.now() - parseInt(ts, 36) < SESSION_DAYS * 86400e3;
}

// ---------- clave para reproductores externos (VLC, MX Player, listas M3U, iPhone) ----------
// Va en la URL como ?k=… porque esos reproductores no tienen la cookie del navegador.

export const streamKey = () => (state ? hmac('stream').slice(0, 24) : '');

function keyOk(url) {
  const k = url.searchParams.get('k');
  return !!k && sameStr(k, streamKey());
}

// ---------- usuario y contraseña HTTP (Kodi) ----------
// scrypt es lento a propósito: recordamos los encabezados ya verificados para no recalcular en cada pedido.
const basicOk = new Set();
function basicAuthOk(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  if (basicOk.has(h)) return true;
  const dec = Buffer.from(h.slice(6), 'base64').toString();
  const pw = dec.slice(dec.indexOf(':') + 1);
  if (!checkPassword(pw)) return false;
  if (basicOk.size > 50) basicOk.clear();
  basicOk.add(h);
  return true;
}

export function isAuthed(req, url) {
  if (!state) return false;
  return cookieOk(req) || keyOk(url) || basicAuthOk(req);
}

// ---------- freno a los intentos de adivinar la contraseña ----------
const fails = new Map(); // ip -> { n, until }

export function loginBlockedFor(ip) {
  const f = fails.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
export function loginFailed(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n++;
  // 5 intentos libres; después la espera crece: 30 s, 60 s, 120 s… hasta 15 min.
  if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60e3, 30e3 * 2 ** (f.n - 5));
  fails.set(ip, f);
}
export const loginOk = (ip) => fails.delete(ip);
