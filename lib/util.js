import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Pequeño almacén JSON en disco con guardado diferido y escritura atómica. */
export class JsonStore {
  constructor(file, def = {}) {
    this.file = file;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = def;
    }
    this.timer = null;
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  }
  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

/** Limita cuántas tareas async corren a la vez. */
export function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/** Ejecuta un binario y junta stdout (Buffer) y stderr. */
export function run(bin, args, timeout = 120000) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => {
      err += d;
      if (err.length > 8000) err = err.slice(-8000);
    });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: Buffer.alloc(0), err: String(e) });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: Buffer.concat(out), err });
    });
  });
}
