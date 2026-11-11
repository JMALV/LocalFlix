// LocalFlix — interfaz web (sin dependencias)

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const api = async (p, opt) => {
  const r = await fetch(`/api/${p}`, opt);
  if (r.status === 401 && !p.startsWith('login')) {
    showAuthScreen();
    throw new Error('Necesitas iniciar sesión.');
  }
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
};
const postJSON = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const errText = (e, def) => {
  try {
    return JSON.parse(e.message).error || def;
  } catch {
    return e.message || def;
  }
};
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`lf.${k}`);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`lf.${k}`, JSON.stringify(v));
    } catch {}
  },
};

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>',
};

let CFG = { preferredSubLang: 'spa', preferredAudioLang: '' };
let AUTH = { hasPassword: true, authed: false, local: false, streamKey: '', minLength: 4 };
const withKey = (u) => (AUTH.streamKey ? `${u}${u.includes('?') ? '&' : '?'}k=${AUTH.streamKey}` : u);

const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const fmtDur = (s) => {
  const m = Math.round((s || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const epCode = (e) => `T${e.season}:E${e.episode}${e.episodeEnd ? `-${e.episodeEnd}` : ''}`;
const isTouch = () => matchMedia('(pointer: coarse)').matches;
// Safari (iPhone/iPad/Mac) no reproduce MP4 progresivo generado al vuelo: usa HLS.
const UA = navigator.userAgent;
const USE_HLS =
  /iPad|iPhone|iPod/.test(UA) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
  (/Safari\//.test(UA) && !/Chrome|Chromium|CriOS|Edg|Android|Firefox/.test(UA)) ||
  new URLSearchParams(location.search).has('hls');

function toast(msg, ms = 2500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ====================== VISTAS ======================

const app = $('#app');
const header = $('#top');
window.addEventListener('scroll', () => header.classList.toggle('solid', scrollY > 30), { passive: true });

const bar = (pct) => (pct > 0.005 ? `<div class="bar"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></div>` : '');

function posterCard(x) {
  const href = x.kind === 'show' ? `#/show/${x.id}` : `#/movie/${x.id}`;
  const sub = x.kind === 'show' ? `${x.seasons} temporada${x.seasons === 1 ? '' : 's'}` : x.year || '';
  const p = x.progress;
  return `<a class="card poster ${x.hasPoster ? '' : 'noart'}" href="${href}" aria-label="${esc(x.name)}">
    <img loading="lazy" src="/api/img/poster/${x.id}" alt="" onerror="this.style.visibility='hidden'">
    <div class="cap">${x.hasPoster ? '' : `${esc(x.name)}<small>${esc(sub)}</small>`}</div>
    ${p && !p.watched ? bar(p.pct) : ''}
  </a>`;
}

function wideCard(e) {
  const label = e.type === 'episode' ? `${e.show} · ${epCode(e)}` : e.title;
  const sub = e.type === 'episode' ? e.title || '' : e.year || '';
  return `<a class="card wide" href="#/play/${e.id}">
    <img loading="lazy" src="/api/img/still/${e.id}" alt="" onerror="this.style.visibility='hidden'">
    ${e.isNext ? '<span class="badge-next">Siguiente</span>' : ''}
    <div class="cap">${esc(label)}<small>${esc(sub)}</small></div>
    ${bar(e.progress?.pct || 0)}
  </a>`;
}

function row(title, cards) {
  if (!cards.length) return '';
  return `<section class="row"><h2>${esc(title)}</h2>
    <button class="arrow l" data-dir="-1" aria-label="Anterior">‹</button>
    <div class="scroller">${cards.join('')}</div>
    <button class="arrow r" data-dir="1" aria-label="Siguiente">›</button></section>`;
}

app.addEventListener('click', (e) => {
  const a = e.target.closest('.arrow');
  if (a) {
    const sc = a.parentElement.querySelector('.scroller');
    sc.scrollBy({ left: +a.dataset.dir * sc.clientWidth * 0.85, behavior: 'smooth' });
  }
});

function heroBlock(x, { playHref, playLabel, extra = '', title } = {}) {
  const meta = [];
  if (x.year) meta.push(x.year);
  if (x.seasons) meta.push(`${x.seasons} temporada${x.seasons === 1 ? '' : 's'}`);
  if (x.duration && !x.seasons) meta.push(fmtDur(x.duration));
  if (x.rating) meta.push(`<span class="star">★</span> ${x.rating.toFixed(1)}`);
  return `<section class="hero">
    <img class="bg" src="/api/img/backdrop/${x.id}" alt="" onerror="this.remove()">
    <div class="info">
      ${title ?? `<h1>${esc(x.name)}</h1>`}
      <div class="meta">${meta.join(' · ')}</div>
      ${x.overview ? `<p>${esc(x.overview)}</p>` : ''}
      <div class="actions">
        ${playHref ? `<a class="btn primary" href="${playHref}">${ICON.play}${esc(playLabel || 'Reproducir')}</a>` : ''}
        ${extra}
      </div>
    </div>
  </section>`;
}

async function renderHome() {
  const d = await api('home');
  if (!d.shows.length && !d.movies.length) {
    const s = await api('settings');
    if (!s.mediaDirs.length) return location.replace('#/folders');
    app.innerHTML = `<div class="page empty">${
      d.scanning ? 'Escaneando tu biblioteca…' : 'No encontré videos en tus carpetas. <a class="btn small" href="#/folders">Cambiar carpetas</a>'
    }</div>`;
    return;
  }
  const h = d.hero;
  let heroHtml = '';
  if (h) {
    const href = h.kind === 'show' ? `#/show/${h.id}` : `#/movie/${h.id}`;
    heroHtml = heroBlock(h, {
      playHref: h.resumeId ? `#/play/${h.resumeId}` : href,
      playLabel: h.resumeLabel || 'Reproducir',
      extra: `<a class="btn" href="${href}">Más información</a>`,
    });
  }
  app.innerHTML =
    heroHtml +
    row('Continuar viendo', d.continue.map(wideCard)) +
    row('Agregado recientemente', d.recent.map(posterCard)) +
    row('Series', d.shows.map(posterCard)) +
    row('Películas', d.movies.map(posterCard));
}

async function renderGrid(kind) {
  const d = await api('home');
  const list = kind === 'series' ? d.shows : d.movies;
  app.innerHTML = `<div class="page"><h1>${kind === 'series' ? 'Series' : 'Películas'}</h1>
    ${list.length ? `<div class="grid">${list.map(posterCard).join('')}</div>` : '<div class="empty">Nada por aquí todavía.</div>'}</div>`;
}

function epRow(e) {
  const p = e.progress;
  return `<a class="ep" href="#/play/${e.id}">
    <div class="th"><img loading="lazy" src="/api/img/still/${e.id}" alt="" onerror="this.style.visibility='hidden'">
      <div class="play">${ICON.play}</div>${p ? bar(p.watched ? 1 : p.pct) : ''}</div>
    <div class="body">
      <div class="t">${e.type === 'episode' ? `${e.episode}. ` : ''}${esc(e.title || `Episodio ${e.episode}`)}<span>${e.duration ? fmtDur(e.duration) : ''}</span></div>
      ${e.overview ? `<p>${esc(e.overview)}</p>` : ''}
      ${p?.watched ? '<div class="seen">✓ Visto</div>' : ''}
    </div></a>`;
}

let showState = null;

async function renderShow(id) {
  const s = await api(`show/${id}`);
  const r = s.resume;
  const inProgress = r.progress && !r.progress.watched && r.progress.t > 30;
  const label = r.started ? `${inProgress ? 'Continuar' : 'Reproducir'} ${epCode(r)}` : 'Reproducir';
  const extra =
    (r.started ? `<a class="btn" href="#/play/${s.seasonList.find((x) => x.n > 0)?.episodes[0]?.id || r.id}?t=0">${ICON.restart}Desde el inicio</a>` : '') +
    `<a class="btn" href="${withKey(`/api/m3u/show/${s.id}.m3u`)}" title="Lista para VLC / Kodi">${ICON.list}Lista M3U</a>`;
  const seasonSel = LS.get(`season.${id}`, null);
  const cur = s.seasonList.find((x) => x.n === seasonSel) ? seasonSel : r.season ?? s.seasonList[0]?.n;
  showState = { s, season: cur };
  app.innerHTML = `<div class="detail">${heroBlock(s, { playHref: `#/play/${r.id}`, playLabel: label, extra })}
    <div class="seasons">${s.seasonList.map((x) => `<button data-season="${x.n}" class="${x.n === cur ? 'on' : ''}">${x.n === 0 ? 'Especiales' : `Temporada ${x.n}`}</button>`).join('')}</div>
    <div class="episodes" id="eps"></div>
    ${s.extras.length ? `<h2 class="section-title">Extras</h2><div class="episodes">${s.extras.map(epRow).join('')}</div>` : ''}
  </div>`;
  renderEpisodes();
  app.querySelector('.seasons').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-season]');
    if (!b) return;
    showState.season = +b.dataset.season;
    LS.set(`season.${id}`, showState.season);
    app.querySelectorAll('.seasons button').forEach((x) => x.classList.toggle('on', x === b));
    renderEpisodes();
  });
}

function renderEpisodes() {
  const se = showState.s.seasonList.find((x) => x.n === showState.season);
  $('#eps').innerHTML = se ? se.episodes.map(epRow).join('') : '';
}

async function renderMovie(id) {
  const m = await api(`movie/${id}`);
  const p = m.progress;
  const resume = p && !p.watched && p.t > 30;
  app.innerHTML = `<div class="detail">${heroBlock(m, {
    playHref: `#/play/${m.id}`,
    playLabel: resume ? `Continuar (${fmtTime(p.t)})` : 'Reproducir',
    extra: resume ? `<a class="btn" href="#/play/${m.id}?t=0">${ICON.restart}Desde el inicio</a>` : '',
  })}</div>`;
}

async function renderSearch(q) {
  const input = $('#searchInput');
  if (document.activeElement !== input) input.value = q;
  if (!q) {
    app.innerHTML = '<div class="page empty">Escribe para buscar series, películas o episodios.</div>';
    return;
  }
  const d = await api(`search?q=${encodeURIComponent(q)}`);
  const cards = [...d.shows, ...d.movies].map(posterCard).join('');
  app.innerHTML = `<div class="page"><h1>Resultados para “${esc(q)}”</h1>
    ${cards ? `<div class="grid">${cards}</div>` : ''}
    ${d.episodes.length ? `<h2 class="section-title">Episodios</h2><div class="episodes">${d.episodes.map((e) => epRow({ ...e, title: `${e.show} ${epCode(e)} · ${e.title}`, type: 'x' })).join('')}</div>` : ''}
    ${!cards && !d.episodes.length ? '<div class="empty">Sin resultados.</div>' : ''}</div>`;
}

let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = e.target.value.trim();
    const target = `#/search/${encodeURIComponent(q)}`;
    if (location.hash.startsWith('#/search/')) location.replace(target);
    else location.hash = target;
  }, 300);
});
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#searchInput').blur();
});

// ====================== ROUTER ======================

const scrollMem = {};
let lastHash = null;
let renderToken = 0;

async function router() {
  if (document.body.classList.contains('locked')) return;
  const hash = location.hash || '#/';
  if (lastHash && !lastHash.startsWith('#/play')) scrollMem[lastHash] = scrollY;
  const prev = lastHash;
  lastHash = hash;
  const [p, qs] = hash.slice(1).split('?');
  const parts = p.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');

  if (parts[0] === 'play') return openPlayer(parts[1], params, prev);
  closePlayer();
  document.querySelectorAll('header [data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (parts[0] || '')));

  const token = ++renderToken;
  try {
    if (!parts[0]) await renderHome();
    else if (parts[0] === 'series' || parts[0] === 'movies') await renderGrid(parts[0]);
    else if (parts[0] === 'show') await renderShow(parts[1]);
    else if (parts[0] === 'movie') await renderMovie(parts[1]);
    else if (parts[0] === 'search') await renderSearch(decodeURIComponent(parts[1] || ''));
    else if (parts[0] === 'folders') await renderFolders();
    else await renderHome();
  } catch (e) {
    if (token === renderToken) app.innerHTML = `<div class="page empty">Error: ${esc(e.message)}</div>`;
  }
  if (token === renderToken) scrollTo(0, scrollMem[hash] || 0);
}
window.addEventListener('hashchange', router);

// ---------- carpetas de la biblioteca ----------

const FOLDER_ICON = '<svg viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"/></svg>';

// Contraseña (cambiarla solo desde la PC) y enlaces para reproductores externos.
function accountHtml() {
  const host = `${location.hostname === 'localhost' ? AUTH.lanIP || 'IP-DE-ESTA-PC' : location.hostname}:${location.port || 80}`;
  const m3u = `http://${host}/api/m3u/all.m3u?k=${AUTH.streamKey}`;
  return `
    <h2 class="sec">Contraseña</h2>
    ${
      AUTH.local
        ? `<p class="lead">Se pide en el celular, la tablet y la TV. Al cambiarla, se cierra la sesión en todos esos dispositivos.</p>
      <form id="chgForm" class="auth-form inline">
        <input type="password" id="np1" placeholder="Contraseña nueva" autocomplete="new-password" required minlength="${AUTH.minLength}">
        <input type="password" id="np2" placeholder="Repite la contraseña" autocomplete="new-password" required>
        <button class="btn primary">Cambiar contraseña</button>
      </form>`
        : `<p class="lead">La contraseña solo se puede cambiar desde la PC donde corre LocalFlix.</p>
      <button class="btn" id="logoutBtn">Cerrar sesión en este dispositivo</button>`
    }
    <div class="fs-msg" id="accMsg"></div>
    <h2 class="sec">VLC y Kodi</h2>
    <p class="lead"><b>VLC:</b> Explorar → Stream → <code class="sel">${esc(m3u)}</code></p>
    <p class="lead"><b>Kodi:</b> fuente "Servidor web (HTTP)", ruta <code>browse/</code>, con cualquier usuario y la contraseña de LocalFlix.</p>`;
}

function bindAccount() {
  const msg = (t, err = true) => {
    $('#accMsg').textContent = t;
    $('#accMsg').classList.toggle('err', err);
  };
  const chg = $('#chgForm');
  if (chg) {
    chg.onsubmit = async (e) => {
      e.preventDefault();
      if ($('#np1').value !== $('#np2').value) return msg('Las contraseñas no coinciden.');
      try {
        const r = await postJSON('password', { password: $('#np1').value });
        AUTH.streamKey = r.streamKey;
        chg.reset();
        msg('Contraseña cambiada. Los demás dispositivos tienen que volver a entrar.', false);
        $('.sel') && ($('.sel').textContent = $('.sel').textContent.replace(/k=[\w-]*/, `k=${r.streamKey}`));
      } catch (err) {
        msg(errText(err, 'No se pudo cambiar.'));
      }
    };
  }
  const out = $('#logoutBtn');
  if (out) {
    out.onclick = async () => {
      await postJSON('logout', {}).catch(() => {});
      boot();
    };
  }
}

async function renderFolders() {
  const s = await api('settings');
  const F = { dirs: s.mediaDirs.map((d) => d.path), bad: new Set(s.mediaDirs.filter((d) => !d.ok).map((d) => d.path)), browse: null, saved: s.mediaDirs.map((d) => d.path).join('\n') };
  const first = !F.dirs.length;
  const lead = !s.canEdit
    ? `Por seguridad, las carpetas solo se cambian desde la PC donde corre LocalFlix: ábrelo ahí en <b>http://localhost:${location.port || 80}</b>.`
    : first
      ? 'Elige la carpeta donde guardas tus series y películas. Puedes agregar varias y cambiarlas cuando quieras desde el ícono de carpeta, arriba a la derecha.'
      : 'LocalFlix busca videos en estas carpetas y en todas sus subcarpetas.';
  app.innerHTML = `<div class="page folders">
    <h1>${first ? 'Bienvenido a LocalFlix' : 'Carpetas de la biblioteca'}</h1>
    <p class="lead">${lead}</p>
    <ul class="dirlist" id="dirList"></ul>
    <div class="actions" style="margin:14px 0 0" ${s.canEdit ? '' : 'hidden'}>
      <button class="btn" id="addDir">+ Agregar carpeta</button>
      <button class="btn primary" id="saveDirs">Guardar</button>
    </div>
    <div id="fsMsg" class="fs-msg"></div>
    <div class="fsb" id="fsb" hidden>
      <div class="fsb-top">
        <button class="btn small" id="fsUp">↑ Subir</button>
        <form id="fsGo" class="fsb-path"><input id="fsPath" placeholder="Escribe una ruta, por ejemplo D:\\Series" autocomplete="off" spellcheck="false"></form>
      </div>
      <ul class="fsb-list" id="fsList"></ul>
      <div class="actions"><button class="btn primary" id="fsPick">Usar esta carpeta</button><button class="btn" id="fsCancel">Cancelar</button></div>
    </div>
    ${accountHtml()}
  </div>`;
  bindAccount();

  const list = $('#dirList');
  const msg = (t, err) => {
    $('#fsMsg').textContent = t;
    $('#fsMsg').classList.toggle('err', !!err);
  };
  const drawDirs = () => {
    list.innerHTML = F.dirs.length
      ? F.dirs.map((d, i) => `<li class="${F.bad.has(d) ? 'bad' : ''}">${FOLDER_ICON}<span>${esc(d)}${F.bad.has(d) ? ' <small>(no se encuentra)</small>' : ''}</span>${s.canEdit ? `<button class="btn small" data-rm="${i}" aria-label="Quitar">Quitar</button>` : ''}</li>`).join('')
      : '<li class="none">Todavía no hay carpetas.</li>';
    $('#saveDirs').disabled = !F.dirs.length && !F.saved;
  };
  const browse = async (p) => {
    try {
      const r = await api(`fs${p ? `?path=${encodeURIComponent(p)}` : ''}`);
      F.browse = r;
      $('#fsPath').value = r.path;
      $('#fsUp').disabled = r.parent === null;
      $('#fsPick').disabled = !r.path;
      $('#fsList').innerHTML = r.dirs.length
        ? r.dirs.map((d) => `<li><button data-p="${esc(d.path)}">${FOLDER_ICON}${esc(d.name)}</button></li>`).join('')
        : '<li class="none">No hay subcarpetas.</li>';
      $('#fsList').scrollTop = 0;
      msg('');
    } catch (e) {
      let t = 'No se pudo abrir esa carpeta.';
      try {
        t = JSON.parse(e.message).error || t;
      } catch {}
      msg(t, true);
    }
  };
  drawDirs();

  list.onclick = (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    F.dirs.splice(+b.dataset.rm, 1);
    drawDirs();
  };
  $('#addDir').onclick = () => {
    $('#fsb').hidden = false;
    browse(F.browse?.path || '');
    $('#fsb').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $('#fsCancel').onclick = () => ($('#fsb').hidden = true);
  $('#fsUp').onclick = () => F.browse && browse(F.browse.parent);
  $('#fsList').onclick = (e) => {
    const b = e.target.closest('[data-p]');
    if (b) browse(b.dataset.p);
  };
  $('#fsGo').onsubmit = (e) => {
    e.preventDefault();
    browse($('#fsPath').value.trim());
  };
  $('#fsPick').onclick = () => {
    const p = F.browse?.path;
    if (!p) return;
    if (!F.dirs.includes(p)) F.dirs.push(p);
    F.bad.delete(p);
    $('#fsb').hidden = true;
    drawDirs();
    msg('Agregada. Toca "Guardar" para buscar los videos.');
  };
  $('#saveDirs').onclick = async () => {
    const btn = $('#saveDirs');
    btn.disabled = true;
    msg('Buscando videos…');
    try {
      const r = await api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaDirs: F.dirs }) });
      F.saved = F.dirs.join('\n');
      F.bad.clear();
      drawDirs();
      msg(`Listo: ${r.items} video${r.items === 1 ? '' : 's'} encontrado${r.items === 1 ? '' : 's'}.`);
      if (first && r.items) setTimeout(() => (location.hash = '#/'), 900);
    } catch (e) {
      let t = 'No se pudo guardar.';
      try {
        t = JSON.parse(e.message).error || t;
      } catch {}
      msg(t, true);
      btn.disabled = false;
    }
  };
}

// ====================== REPRODUCTOR ======================

const player = $('#player');
const video = $('#video');
const ui = $('#plui');
const panel = $('#plPanel');
const subtext = $('#subtext');

const P = {
  item: null,
  info: null,
  offset: 0,
  audio: 0,
  sub: -1,
  quality: LS.get('quality', '1080'),
  forceTx: LS.get('forceTx', false),
  mode: 'copy',
  copyFailed: false,
  sid: Math.random().toString(36).slice(2, 10),
  retries: 0,
  pendingSeek: null,
  seekTimer: null,
  pausedAt: 0,
  pauseTimer: null,
  unloaded: false,
  cues: null,
  lastSave: 0,
  lastSavedT: 0,
  nextTimer: null,
  stuck: 0,
  lastCT: -1,
  dragT: null,
  openToken: 0,
  fromApp: false,
};

const cur = () => (P.unloaded ? P.offset : P.offset + (video.currentTime || 0));
const dur = () => P.info?.duration || 0;
const clampT = (t) => Math.max(0, Math.min(t, Math.max(0, dur() - 2)));

const LANGS = {
  spa: 'Español', es: 'Español', eng: 'Inglés', en: 'Inglés', fre: 'Francés', fra: 'Francés', fr: 'Francés', ger: 'Alemán', deu: 'Alemán', de: 'Alemán',
  ita: 'Italiano', it: 'Italiano', por: 'Portugués', pt: 'Portugués', dut: 'Neerlandés', nld: 'Neerlandés', dan: 'Danés', fin: 'Finés', nor: 'Noruego',
  nob: 'Noruego', swe: 'Sueco', jpn: 'Japonés', ja: 'Japonés', kor: 'Coreano', chi: 'Chino', zho: 'Chino', rus: 'Ruso', pol: 'Polaco', tur: 'Turco',
  ara: 'Árabe', heb: 'Hebreo', hin: 'Hindi', cze: 'Checo', ces: 'Checo', hun: 'Húngaro', gre: 'Griego', ell: 'Griego', rum: 'Rumano', ron: 'Rumano',
  ukr: 'Ucraniano', cat: 'Catalán', glg: 'Gallego', baq: 'Euskera', eus: 'Euskera', und: 'Desconocido',
};
const L3 = { es: 'spa', en: 'eng', fr: 'fre', de: 'ger', it: 'ita', pt: 'por', ja: 'jpn' };
const normLang = (l) => L3[l] || (l === 'fra' ? 'fre' : l === 'deu' ? 'ger' : l);
const chLabel = (c) => ({ 1: 'Mono', 2: 'Estéreo', 6: '5.1', 7: '6.1', 8: '7.1' })[c] || `${c} canales`;

function trackLabels(list, kind) {
  const counts = {};
  list.forEach((t) => (counts[t.lang] = (counts[t.lang] || 0) + 1));
  const seen = {};
  return list.map((t) => {
    seen[t.lang] = (seen[t.lang] || 0) + 1;
    let label = LANGS[t.lang] || (t.lang ? t.lang.toUpperCase() : `Pista ${t.i + 1}`);
    if (counts[t.lang] > 1) label += ` ${seen[t.lang]}`;
    const extra = [];
    if (t.title) extra.push(t.title);
    if (kind === 'a') {
      const ch = chLabel(t.channels);
      if (!t.title.toLowerCase().includes(ch.toLowerCase())) extra.push(ch);
      extra.push((t.codec || '').toUpperCase());
    }
    if (kind === 's' && t.image) extra.push('imagen');
    if (t.forced) extra.push('forzados');
    return { label, extra: [...new Set(extra.filter(Boolean))].join(' · ') };
  });
}

function canCopy(v) {
  if (!v) return false;
  const test = (c) => {
    const t = `video/mp4; codecs="${c}"`;
    try {
      if (window.MediaSource?.isTypeSupported?.(t)) return true;
    } catch {}
    return video.canPlayType(t) === 'probably';
  };
  const lvl = v.h > 1100 ? 'L153' : 'L123';
  if (v.codec === 'h264') return v.bitDepth === 8 && test('avc1.640029');
  if (v.codec === 'hevc') return v.bitDepth === 10 ? test(`hvc1.2.4.${lvl}.B0`) : test(`hvc1.1.6.${lvl}.B0`);
  if (v.codec === 'av1') return test(`av01.0.08M.${v.bitDepth === 10 ? '10' : '08'}`);
  return false;
}

function decideMode() {
  if (P.forceTx || P.copyFailed || P.sub >= 0) return 'transcode';
  return canCopy(P.info.video) ? 'copy' : 'transcode';
}

function chooseTracks() {
  const key = P.item.showId || P.item.id;
  const pref = LS.get(`tracks.${key}`, null);
  const { audio, subs } = P.info;
  let a = -1;
  if (pref && audio[pref.a]?.lang === pref.al) a = pref.a;
  if (a < 0 && pref?.al) a = audio.findIndex((x) => x.lang === pref.al);
  if (a < 0 && CFG.preferredAudioLang) a = audio.findIndex((x) => normLang(x.lang) === normLang(CFG.preferredAudioLang));
  if (a < 0) a = audio.findIndex((x) => x.def);
  P.audio = Math.max(0, a);

  const usable = (x) => x && (x.text || x.image);
  let s = null;
  if (pref) {
    if (pref.s < 0) s = -1;
    else if (usable(subs[pref.s]) && subs[pref.s].lang === pref.sl) s = pref.s;
    else s = subs.findIndex((x) => usable(x) && x.lang === pref.sl && !x.forced);
  }
  if (s === null) {
    const want = normLang(CFG.preferredSubLang || '');
    const al = normLang(audio[P.audio]?.lang || '');
    s = want && al !== want ? subs.findIndex((x) => usable(x) && normLang(x.lang) === want && !x.forced) : -1;
  }
  P.sub = s;
}

function saveTracks() {
  const { audio, subs } = P.info;
  LS.set(`tracks.${P.item.showId || P.item.id}`, { a: P.audio, al: audio[P.audio]?.lang || '', s: P.sub, sl: P.sub >= 0 ? subs[P.sub].lang : '' });
}

function spinner(on) {
  $('#spinner').hidden = !on;
}

function showError(msg) {
  const box = $('#plError');
  if (!msg) return (box.hidden = true);
  box.hidden = false;
  box.innerHTML = `<p>${esc(msg)}</p><div class="nu-actions" style="justify-content:center">
    <button class="btn primary" id="errRetry">Reintentar</button>
    <button class="btn" id="errTx">Modo compatible</button>
    <button class="btn" id="errBack">Volver</button></div>`;
  $('#errRetry').onclick = () => {
    box.hidden = true;
    P.retries = 0;
    startStream(cur());
  };
  $('#errTx').onclick = () => {
    box.hidden = true;
    P.retries = 0;
    P.copyFailed = true;
    startStream(cur());
  };
  $('#errBack').onclick = goBack;
}

function startStream(t, { autoplay = true } = {}) {
  if (!P.item) return;
  clearTimeout(P.seekTimer);
  P.pendingSeek = null;
  t = clampT(t);
  P.mode = decideMode();
  P.offset = t;
  P.unloaded = false;
  P.stuck = 0;
  P.lastCT = -1;
  const q = new URLSearchParams({ t: t.toFixed(2), a: P.audio, m: P.mode, q: P.quality, sid: P.sid });
  if (P.sub >= 0) q.set('s', P.sub);
  // Al transmitir, la TV no ve los subtítulos que dibuja la página: van incrustados en el video.
  P.burned = (casting() || P.castWanted) && !!P.info.subs[P.sub]?.text;
  if (P.burned) q.set('burn', '1');
  // La URL lleva la clave: en iPhone el reproductor nativo pide la lista HLS por su cuenta, y al transmitir
  // la TV abre este mismo enlace sin la sesión del navegador.
  video.src = withKey(USE_HLS ? `/api/hls/${P.item.id}/index.m3u8?${q}` : `/api/play/${P.item.id}?${q}`);
  spinner(true);
  showError(null);
  if (autoplay) video.play().catch(() => spinner(false));
  $('#plMode').textContent = P.mode === 'copy' ? 'Original' : `Convertido ${P.quality}p${P.sub >= 0 && P.info.subs[P.sub]?.image ? ' + subs' : ''}`;
  updateUI();
}

function unloadStream() {
  if (P.unloaded || !P.item) return;
  P.offset = cur();
  P.unloaded = true;
  video.removeAttribute('src');
  video.load();
}

function updateUI() {
  const d = dur();
  const c = P.dragT ?? P.pendingSeek ?? cur();
  const pct = d ? Math.min(100, (c / d) * 100) : 0;
  $('#seekFill').style.width = `${pct}%`;
  $('#seekKnob').style.left = `${pct}%`;
  $('#plTime').textContent = `${fmtTime(c)} / ${fmtTime(d)}`;
  const paused = video.paused || P.unloaded;
  $('#plPlay').innerHTML = paused ? ICON.play : ICON.pause;
  $('#plBig').hidden = !paused || !$('#spinner').hidden;
  renderCue();
}

let hideTimer;
function showControls() {
  ui.classList.remove('hide');
  clearTimeout(hideTimer);
  if (!video.paused && panel.hidden) hideTimer = setTimeout(() => ui.classList.add('hide'), 3500);
}
function hideControls() {
  if (video.paused || !panel.hidden) return;
  clearTimeout(hideTimer);
  ui.classList.add('hide');
}

function togglePlay() {
  if (!P.item) return;
  if (P.unloaded || (video.paused && P.pausedAt && Date.now() - P.pausedAt > 3 * 60e3)) return startStream(cur());
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

function seekTo(t) {
  startStream(t);
  showControls();
}

function seekBy(delta) {
  if (!P.item) return;
  P.pendingSeek = clampT((P.pendingSeek ?? cur()) + delta);
  updateUI();
  showControls();
  clearTimeout(P.seekTimer);
  P.seekTimer = setTimeout(() => startStream(P.pendingSeek), 650);
}

function saveProgress(force = false, tOverride) {
  if (!P.item || !P.info) return;
  const t = tOverride ?? P.pendingSeek ?? cur();
  if (!force && Math.abs(t - P.lastSavedT) < 5) return;
  if (t < 10 && !P.item.progress) return;
  P.lastSave = Date.now();
  P.lastSavedT = t;
  const body = JSON.stringify({ id: P.item.id, t, d: dur() });
  if (force && navigator.sendBeacon) navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }));
  else fetch('/api/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

// ---- subtítulos de texto (dibujados por la página) ----
function parseVTT(txt) {
  const toS = (x) => {
    const p = x.trim().replace(',', '.').split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const cues = [];
  for (const block of txt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .trim();
    if (text) cues.push({ s: toS(a), e: toS(b.trim().split(/\s/)[0]), text });
  }
  return cues.sort((x, y) => x.s - y.s);
}

async function loadCues() {
  P.cues = null;
  subtext.textContent = '';
  const s = P.sub;
  const id = P.item.id;
  if (s < 0 || !P.info.subs[s]?.text) return;
  toast('Cargando subtítulos…');
  try {
    const r = await fetch(`/api/subs/${id}/${s}.vtt`);
    if (!r.ok) throw new Error();
    const cues = parseVTT(await r.text());
    if (P.item?.id === id && P.sub === s) P.cues = cues;
  } catch {
    toast('No se pudieron cargar los subtítulos');
  }
}

function renderCue() {
  if (!P.cues) return;
  if (P.burned) return (subtext.textContent = '');
  const t = cur();
  let lo = 0;
  let hi = P.cues.length - 1;
  let found = '';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = P.cues[mid];
    if (t < c.s) hi = mid - 1;
    else if (t > c.e) lo = mid + 1;
    else {
      found = c.text;
      break;
    }
  }
  if (subtext.textContent !== found) subtext.textContent = found;
}
(function cueLoop() {
  if (P.cues && !video.paused) renderCue();
  requestAnimationFrame(cueLoop);
})();

// ---- panel de audio / subtítulos / calidad ----
function renderPanel() {
  const { audio, subs } = P.info;
  const al = trackLabels(audio, 'a');
  const sl = trackLabels(subs, 's');
  const opt = (attr, val, on, label, extra = '') => `<button class="opt ${on ? 'on' : ''}" data-${attr}="${val}">${esc(label)}${extra ? `<small>${esc(extra)}</small>` : ''}</button>`;
  const fileUrl = withKey(`${location.origin}/api/file/${P.item.id}/${encodeURIComponent(P.item.file)}`);
  const android = /Android/i.test(navigator.userAgent);
  const intent = `intent://${withKey(`${location.host}/api/file/${P.item.id}/${encodeURIComponent(P.item.file)}`)}#Intent;scheme=http;type=video/*;S.title=${encodeURIComponent($('#plTitle').textContent)};end`;
  const curSub = subs[P.sub];
  panel.innerHTML = `
    <h4>Audio</h4>${audio.map((a, i) => opt('a', i, i === P.audio, al[i].label, al[i].extra)).join('') || '<div class="note">Sin audio</div>'}
    <h4>Subtítulos</h4>${opt('s', -1, P.sub < 0, 'Desactivados')}
    ${subs.map((s, i) => ((s.text || s.image) ? opt('s', i, i === P.sub, sl[i].label, sl[i].extra) : '')).join('')}
    ${curSub?.image ? '<div class="note">Los subtítulos de imagen (PGS) se incrustan en el video usando la GPU.</div>' : ''}
    <h4>Calidad</h4>
    ${[['1080', '1080p · 8 Mbps'], ['720', '720p · 4 Mbps'], ['480', '480p · 2 Mbps']].map(([q, l]) => opt('q', q, P.quality === q, l)).join('')}
    ${P.mode === 'copy' ? '<div class="note">Ahora se reproduce el archivo original sin convertir; la calidad se aplica solo al convertir.</div>' : ''}
    <h4>Compatibilidad</h4>
    ${opt('tx', 1, P.forceTx, 'Forzar conversión', 'si el video se ve negro o va a saltos')}
    <h4>Abrir en otra app</h4>
    ${android ? `<a class="opt" href="${esc(intent)}" data-ext>Abrir en VLC / MX Player…</a>` : `<a class="opt" href="${esc(fileUrl)}" data-ext target="_blank">Abrir archivo original</a>`}
    <button class="opt" data-copy="${esc(fileUrl)}">Copiar enlace directo</button>`;
}

function openPanel() {
  renderPanel();
  panel.hidden = false;
  showControls();
  panel.querySelector('.opt.on, .opt')?.focus();
}
function closePanel() {
  panel.hidden = true;
  showControls();
}

panel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a],[data-s],[data-q],[data-tx],[data-copy],[data-ext]');
  if (!b) return;
  const at = cur();
  if (b.dataset.ext !== undefined) {
    video.pause();
    return;
  }
  if (b.dataset.copy) {
    navigator.clipboard?.writeText(b.dataset.copy).then(
      () => toast('Enlace copiado'),
      () => prompt('Copia este enlace:', b.dataset.copy),
    );
    return;
  }
  if (b.dataset.a !== undefined) {
    if (+b.dataset.a === P.audio) return;
    P.audio = +b.dataset.a;
    saveTracks();
  } else if (b.dataset.s !== undefined) {
    if (+b.dataset.s === P.sub) return;
    P.sub = +b.dataset.s;
    saveTracks();
    loadCues();
  } else if (b.dataset.q !== undefined) {
    if (b.dataset.q === P.quality) return;
    P.quality = b.dataset.q;
    LS.set('quality', P.quality);
    if (P.mode === 'copy') return renderPanel();
  } else if (b.dataset.tx !== undefined) {
    P.forceTx = !P.forceTx;
    LS.set('forceTx', P.forceTx);
  }
  startStream(at);
  renderPanel();
});

// ---- siguiente episodio ----
function showNextUp() {
  const n = P.item?.next;
  if (!n) return goBack();
  $('#nuTitle').textContent = `${epCode(n)} · ${n.title || ''}`;
  $('#nextUp').hidden = false;
  let c = 8;
  $('#nuCount').textContent = c;
  clearInterval(P.nextTimer);
  P.nextTimer = setInterval(() => {
    c--;
    $('#nuCount').textContent = c;
    if (c <= 0) playNext();
  }, 1000);
  $('#nuPlay').focus();
}
function hideNextUp() {
  clearInterval(P.nextTimer);
  $('#nextUp').hidden = true;
}
function playNext() {
  hideNextUp();
  if (P.item?.next) location.replace(`#/play/${P.item.next.id}`);
}
$('#nuPlay').onclick = playNext;
$('#nuCancel').onclick = () => {
  hideNextUp();
  showControls();
};

// ---- abrir / cerrar ----
function goBack() {
  if (P.fromApp) history.back();
  else location.replace(P.item?.showId ? `#/show/${P.item.showId}` : '#/');
}

// Pantalla completa en celular = horizontal fijo.
//  Android: Fullscreen API + screen.orientation.lock.
//  iPhone: Safari no permite ninguna de las dos, así que giramos el reproductor 90° con CSS (clase .land).
const canRealFs = () => !!player.requestFullscreen;
const isRotated = () => player.classList.contains('land') && matchMedia('(orientation: portrait)').matches;

function enterFs() {
  if (!canRealFs()) {
    if (isTouch()) player.classList.add('land');
    return;
  }
  player
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => isTouch() && screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}
function exitFs() {
  player.classList.remove('land');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function tryFullscreen() {
  if (isTouch() && !document.fullscreenElement && !player.classList.contains('land')) enterFs();
}
function toggleFs() {
  if (document.fullscreenElement || player.classList.contains('land')) exitFs();
  else enterFs();
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) screen.orientation?.unlock?.();
});

async function openPlayer(id, params, prevHash) {
  const token = ++P.openToken;
  if (P.item && P.item.id !== id) {
    saveProgress(true);
    hideNextUp();
  }
  if (!player.hidden && P.item?.id === id) return;
  P.fromApp = P.fromApp || !!prevHash;
  document.body.classList.add('playing');
  player.hidden = false;
  panel.hidden = true;
  showError(null);
  hideNextUp();
  video.pause();
  video.removeAttribute('src');
  video.load();
  subtext.textContent = '';
  spinner(true);
  tryFullscreen();
  let d;
  try {
    d = await api(`item/${id}`);
    if (d.error) throw new Error(d.error);
  } catch (e) {
    if (token === P.openToken) {
      spinner(false);
      showError(`No se pudo abrir: ${e.message}`);
    }
    return;
  }
  if (token !== P.openToken) return;
  Object.assign(P, { item: d, info: d.info, copyFailed: false, retries: 0, cues: null, lastSavedT: 0, pausedAt: 0 });
  $('#plTitle').textContent = d.type === 'episode' ? d.show : d.title;
  $('#plSub').textContent = d.type === 'episode' ? `${epCode(d)} · ${d.title || ''}` : d.year || '';
  $('#plNext').hidden = !d.next;
  chooseTracks();
  loadCues();
  setMediaSession(d);
  const p = d.progress;
  const start = params.has('t') ? +params.get('t') || 0 : p && !p.watched && p.t > 15 ? p.t - 3 : 0;
  startStream(start);
  showControls();
}

function closePlayer() {
  if (player.hidden) return;
  P.openToken++;
  saveProgress(true);
  hideNextUp();
  clearTimeout(P.pauseTimer);
  clearTimeout(P.seekTimer);
  panel.hidden = true;
  video.pause();
  video.removeAttribute('src');
  video.load();
  P.item = null;
  P.info = null;
  P.cues = null;
  P.fromApp = false;
  subtext.textContent = '';
  player.hidden = true;
  document.body.classList.remove('playing');
  exitFs();
}

function setMediaSession(d) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: d.type === 'episode' ? `${epCode(d)} · ${d.title || ''}` : d.title,
      artist: d.type === 'episode' ? d.show : 'LocalFlix',
      artwork: [{ src: `/api/img/still/${d.id}`, sizes: '640x360', type: 'image/jpeg' }],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => togglePlay());
    ms.setActionHandler('pause', () => video.pause());
    ms.setActionHandler('seekbackward', () => seekBy(-10));
    ms.setActionHandler('seekforward', () => seekBy(10));
    ms.setActionHandler('seekto', (e) => seekTo(e.seekTime));
    ms.setActionHandler('nexttrack', d.next ? playNext : null);
  } catch {}
}

// ---- eventos del video ----
video.addEventListener('playing', () => {
  spinner(false);
  P.retries = 0;
  updateUI();
  showControls();
});
video.addEventListener('waiting', () => spinner(true));
video.addEventListener('timeupdate', updateUI);
video.addEventListener('play', () => {
  clearTimeout(P.pauseTimer);
  updateUI();
});
video.addEventListener('pause', () => {
  if (!P.item) return;
  P.pausedAt = Date.now();
  saveProgress(true);
  updateUI();
  showControls();
  clearTimeout(P.pauseTimer);
  // Tras 10 min en pausa cerramos el stream (libera ffmpeg); al reanudar se reabre en el mismo punto.
  P.pauseTimer = setTimeout(() => video.paused && !casting() && unloadStream(), 10 * 60e3);
});
video.addEventListener('error', async () => {
  if (!P.item || !video.getAttribute('src')) return;
  const at = cur();
  console.warn('[player] error', video.error?.code, video.error?.message, P.mode);
  const busy = await api(`busy?sid=${encodeURIComponent(P.sid || '')}`).catch(() => null);
  if (busy?.busy) {
    spinner(false);
    return showError(`Ya hay ${busy.max} reproducciones en curso en otros dispositivos. Cierra alguna e intenta de nuevo.`);
  }
  if (P.mode === 'copy' && !P.copyFailed) {
    P.copyFailed = true;
    toast('Cambiando a modo compatible…');
    return startStream(at);
  }
  if (P.retries++ < 3) return setTimeout(() => P.item && startStream(at), 700 * P.retries);
  spinner(false);
  showError('No se pudo reproducir este video.');
});
video.addEventListener('ended', () => {
  if (!P.item) return;
  const at = cur();
  if (dur() && at < dur() - 20 && P.retries++ < 3) return startStream(at); // corte prematuro: reanudar
  saveProgress(true, dur());
  showNextUp();
});

// ---- transmitir a la TV (Chromecast / Google TV) ----
// Usa la API Remote Playback del navegador: Chrome le pasa a la TV el enlace del video (con la clave)
// y la TV lo pide directo al servidor. El celular o la PC quedan como control remoto.
const casting = () => video.remote?.state === 'connected';
const castBtn = $('#plCast');

function castPrompt() {
  if (!video.remote) return toast('Este navegador no puede transmitir. Usa Chrome.');
  // La TV pide el enlace desde su comienzo: lo reabrimos en el segundo actual para que siga desde acá.
  if (!casting()) {
    P.castWanted = true;
    startStream(cur(), { autoplay: !video.paused });
  }
  video.remote.prompt().catch((e) => {
    if (e.name === 'NotFoundError') toast('No encontré ninguna TV en la red. Revisa que esté prendida y en el mismo Wi-Fi.', 4000);
    else if (e.name === 'NotSupportedError') toast('Este video no se puede transmitir desde este navegador.', 4000);
    else if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('No se pudo transmitir.');
    // No se conectó: volvemos a los subtítulos de la página.
    if (P.castWanted && !casting()) {
      P.castWanted = false;
      if (P.burned) startStream(cur(), { autoplay: !video.paused });
    }
  });
}

function castState() {
  const st = video.remote?.state || 'disconnected';
  castBtn.classList.toggle('on', st === 'connected');
  castBtn.setAttribute('aria-label', st === 'connected' ? 'Dejar de transmitir' : 'Transmitir a la TV');
  $('#castNote').hidden = st === 'disconnected';
  $('#castName').textContent = st === 'connecting' ? 'Conectando con la TV…' : 'Transmitiendo a la TV';
  player.classList.toggle('casting', st !== 'disconnected');
}

if (video.remote && !USE_HLS) {
  castBtn.hidden = false;
  video.remote.watchAvailability((ok) => (castBtn.hidden = !ok)).catch(() => {});
  video.remote.addEventListener('connecting', castState);
  video.remote.addEventListener('connect', () => {
    castState();
    toast('Transmitiendo a la TV');
  });
  video.remote.addEventListener('disconnect', () => {
    P.castWanted = false;
    castState();
    if (P.burned && P.item) startStream(cur(), { autoplay: false });
    if (P.item) toast('Se dejó de transmitir');
  });
}

// Vigilante: si el video se congela, reabre el stream en el mismo punto.
setInterval(() => {
  if (!P.item || P.unloaded || video.paused || P.pendingSeek != null || !video.getAttribute('src')) return;
  if (casting()) {
    if (Date.now() - P.lastSave > 10000) saveProgress();
    return;
  }
  const ct = video.currentTime;
  if (ct === P.lastCT) {
    if (++P.stuck >= 15) {
      console.warn('[player] congelado, reabriendo stream');
      P.stuck = 0;
      startStream(cur());
      return;
    }
  } else {
    P.stuck = 0;
    P.lastCT = ct;
  }
  if (P.mode === 'copy' && !P.copyFailed && ct > 2.5) {
    const q = video.getVideoPlaybackQuality?.();
    if (video.videoWidth === 0 || (q && q.totalVideoFrames === 0)) {
      console.warn('[player] el códec no decodifica imagen, usando conversión');
      P.copyFailed = true;
      toast('Cambiando a modo compatible…');
      return startStream(cur());
    }
  }
  if (Date.now() - P.lastSave > 10000) saveProgress();
  try {
    if (dur()) navigator.mediaSession?.setPositionState?.({ duration: dur(), position: Math.min(cur(), dur()), playbackRate: 1 });
  } catch {}
}, 1000);

window.addEventListener('pagehide', () => saveProgress(true));
document.addEventListener('visibilitychange', () => document.hidden && saveProgress(true));

// ---- controles ----
$('#plBack').onclick = goBack;
$('#plPlay').onclick = togglePlay;
$('#plBig').onclick = () => {
  togglePlay();
  tryFullscreen();
};
$('#plRew').onclick = () => seekBy(-10);
$('#plFwd').onclick = () => seekBy(10);
$('#plNext').onclick = playNext;
$('#plFs').onclick = toggleFs;
$('#plCast').onclick = castPrompt;
$('#plSettings').onclick = () => (panel.hidden ? openPanel() : closePanel());

ui.addEventListener('click', (e) => {
  if (e.target !== ui) return;
  if (!panel.hidden) return closePanel();
  if (isTouch()) {
    if (ui.classList.contains('hide')) showControls();
    else hideControls();
  } else {
    togglePlay();
    showControls();
  }
});
ui.addEventListener('dblclick', (e) => e.target === ui && !isTouch() && toggleFs());
player.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && showControls());
player.addEventListener('touchstart', (e) => e.target !== ui && showControls(), { passive: true });

const seekEl = $('#seek');
const tip = $('#seekTip');
const posToTime = (e) => {
  const r = seekEl.getBoundingClientRect();
  // Con el reproductor girado 90°, la barra queda vertical en la pantalla.
  const f = isRotated() ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  return Math.max(0, Math.min(1, f)) * dur();
};
let dragging = false;
seekEl.addEventListener('pointerdown', (e) => {
  dragging = true;
  seekEl.setPointerCapture(e.pointerId);
  seekEl.classList.add('drag');
  P.dragT = posToTime(e);
  updateUI();
  showControls();
});
seekEl.addEventListener('pointermove', (e) => {
  const t = posToTime(e);
  tip.hidden = false;
  tip.style.left = `${(t / (dur() || 1)) * 100}%`;
  tip.textContent = fmtTime(t);
  if (dragging) {
    P.dragT = t;
    updateUI();
    showControls();
  }
});
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  seekEl.classList.remove('drag');
  tip.hidden = true;
  const t = P.dragT;
  P.dragT = null;
  if (t != null) seekTo(t);
};
seekEl.addEventListener('pointerup', endDrag);
seekEl.addEventListener('pointercancel', endDrag);
seekEl.addEventListener('pointerleave', () => !dragging && (tip.hidden = true));

// Teclado y control remoto (TV): flechas = adelantar/atrasar, Enter = pausa, atrás = salir.
document.addEventListener('keydown', (e) => {
  if (player.hidden) return;
  const k = e.key;
  const ae = document.activeElement;
  const inControls = ae && ae !== document.body && ae.closest?.('.pl-row, .pl-panel, .next-up, .pl-top, .pl-error');
  const wasHidden = ui.classList.contains('hide');
  showControls();
  if (k === ' ' || k === 'k' || k === 'MediaPlayPause') {
    e.preventDefault();
    togglePlay();
  } else if (k === 'MediaPlay') togglePlay();
  else if (k === 'MediaPause') video.pause();
  else if (k === 'Enter' && !inControls) {
    e.preventDefault();
    if (!wasHidden || video.paused) togglePlay();
  } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && !inControls) {
    e.preventDefault();
    seekBy(k === 'ArrowLeft' ? -10 : 10);
  } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && ae.closest('.pl-row')) {
    e.preventDefault();
    const btns = [...ae.closest('.pl-row').querySelectorAll('button:not([hidden])')];
    const i = btns.indexOf(ae);
    btns[Math.max(0, Math.min(btns.length - 1, i + (k === 'ArrowLeft' ? -1 : 1)))]?.focus();
  } else if (k === 'ArrowUp' || k === 'ArrowDown') {
    if (ae.closest?.('.pl-panel')) {
      e.preventDefault();
      const opts = [...panel.querySelectorAll('.opt')];
      opts[Math.max(0, Math.min(opts.length - 1, opts.indexOf(ae) + (k === 'ArrowUp' ? -1 : 1)))]?.focus();
    } else if (!inControls && k === 'ArrowDown') {
      e.preventDefault();
      $('#plPlay').focus();
    } else if (inControls && k === 'ArrowUp') {
      e.preventDefault();
      ae.blur();
    }
  } else if (k === 'f') toggleFs();
  else if (k === 'MediaFastForward') seekBy(30);
  else if (k === 'MediaRewind') seekBy(-30);
  else if (k === 'MediaTrackNext') playNext();
  else if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') {
    e.preventDefault();
    if (!panel.hidden) closePanel();
    else goBack();
  }
});

// ---------- contraseña ----------

let authShown = false;
function authPage(title, lead, form = '') {
  closePlayer();
  document.body.classList.add('locked');
  app.innerHTML = `<div class="page auth"><div class="auth-box">
    <div class="logo big">Local<b>Flix</b></div>
    <h1>${title}</h1>
    <p class="lead">${lead}</p>${form}
    <div class="fs-msg" id="authMsg"></div>
  </div></div>`;
}
const authMsg = (t, err = true) => {
  const m = $('#authMsg');
  if (!m) return;
  m.textContent = t;
  m.classList.toggle('err', err);
};

function showAuthScreen() {
  if (authShown) return;
  authShown = true;
  if (!AUTH.hasPassword && !AUTH.local) {
    return authPage('LocalFlix todavía no está configurado', `Abre LocalFlix en la PC donde está instalado (<b>http://localhost:${location.port || 80}</b>) y crea la contraseña. Después vuelve a esta página.`);
  }
  if (!AUTH.hasPassword) {
    authPage(
      'Crea una contraseña',
      'La vas a usar para entrar desde el celular, la tablet o la TV. En esta PC no hace falta escribirla. Solo se puede cambiar desde aquí.',
      `<form id="pwForm" class="auth-form">
        <input type="password" id="pw1" placeholder="Contraseña" autocomplete="new-password" required minlength="${AUTH.minLength}">
        <input type="password" id="pw2" placeholder="Repite la contraseña" autocomplete="new-password" required>
        <button class="btn primary">Guardar contraseña</button>
      </form>`,
    );
    $('#pw1').focus();
    $('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      if ($('#pw1').value !== $('#pw2').value) return authMsg('Las contraseñas no coinciden.');
      try {
        await postJSON('password', { password: $('#pw1').value });
        await boot();
      } catch (err) {
        authMsg(errText(err, 'No se pudo guardar.'));
      }
    };
    return;
  }
  authPage(
    'Iniciar sesión',
    'Escribe la contraseña de LocalFlix.',
    `<form id="loginForm" class="auth-form">
      <input type="password" id="pw" placeholder="Contraseña" autocomplete="current-password" required>
      <button class="btn primary">Entrar</button>
    </form>`,
  );
  $('#pw').focus();
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await postJSON('login', { password: $('#pw').value });
      await boot();
    } catch (err) {
      authMsg(errText(err, 'No se pudo entrar.'));
      $('#pw').select();
    } finally {
      btn.disabled = false;
    }
  };
}

async function boot() {
  try {
    AUTH = await api('auth');
  } catch {}
  if (!AUTH.hasPassword || !AUTH.authed) {
    authShown = false;
    return showAuthScreen();
  }
  authShown = false;
  document.body.classList.remove('locked');
  api('config').then((c) => (CFG = c)).catch(() => {});
  router();
}

boot();
