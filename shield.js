// ============================================================================
//  SUBWAY RUN — SHIELD v2  (anti-cheat + anti-cópia do navegador)
//
//  Carregado ANTES de tudo (index.html + primeiro import do app.js).
//   1) RELÓGIO BLINDADO: performance.now / requestAnimationFrame travados em relógio nativo.
//   2) DETECÇÃO IMEDIATA (a cada 0,4 s + eventos, sem recarregar): assinaturas de cheat,
//      DevTools aberto, atalhos de inspeção (F12, Ctrl+U/S/Shift+I/J/C…), funções nativas trocadas,
//      app.js reescrito.
//   3) BANIMENTO NA HORA: tela "DISPOSITIVO BANIDO" + jogo congelado, sem precisar recarregar.
//      Ban gravado no aparelho (3 lugares), na CONTA (bans/) e na IMPRESSÃO DIGITAL do aparelho
//      (deviceBans/) — por isso trocar de conta, limpar dados ou usar VPN não adianta.
//   4) TRAVA DE DOMÍNIO: o jogo só roda nos sites oficiais (anti-clone).
//   5) CHAVE DO DONO: o dono testa sem ser banido (veja SEGURANCA-LEIA-ME.md).
// ============================================================================

const W = window, D = document;

// ===== CONFIGURAÇÃO (edite aqui) =====
const OFFICIAL_URL = 'https://sub-run.edgeone.dev';
const ALLOWED_HOSTS = ['sub-run.edgeone.dev', 'sub-run-v2-0.edgeone.dev', 'localhost'];   // <- ponha TODOS os seus sites
const OWNER_HASH = '2de3bcc08f8c83f69e1407e4562c3a883435547699c2b7ce7826b969a3e9a72c';          // sha256 da chave do dono ('' desliga)
const SHORTCUT_STRIKES = 2;                   // tentativas de F12/Ctrl+U… antes do ban (1 = ban na primeira)
const LIMIT = 3;                              // pontuação de suspeita que bloqueia a corrida
// =====================================

const SELF_ORIGIN = location.origin;
const ALLOWED_SCRIPT_HOSTS = [
  'https://www.gstatic.com', 'https://apis.google.com', 'https://www.google.com',
  'https://accounts.google.com', 'https://www.youtube.com', 'https://s.ytimg.com'
];
const S = { owner: false, strong: 0, clockStrong: 0, locked: false, banId: '', score: 0, codes: Object.create(null), blocked: false,
  listeners: [], lockListeners: [], pending: null, watched: null, strikes: 0, boot: Date.now() };

const NATIVE_NOW = () => new Event('t').timeStamp;       // relógio que nenhum script de página altera
const enc = new TextEncoder();
async function sha256hex(t) { const b = await crypto.subtle.digest('SHA-256', enc.encode(t)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }

// ---------------------------------------------------------------- tela cheia (ban / site não oficial)
function drawScreen(id, html) {
  const build = () => {
    try {
      for (const el of Array.from(D.body ? D.body.children : [])) if (el.id !== id) el.remove();
      if (D.getElementById(id)) return;
      const o = D.createElement('div'); o.id = id;
      o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b0b10;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:system-ui,sans-serif;padding:24px;';
      o.innerHTML = html;
      (D.body || D.documentElement).appendChild(o);
    } catch (_) {}
  };
  const go = () => { build(); try { new MutationObserver(build).observe(D.documentElement, { childList: true, subtree: true }); } catch (_) {} setInterval(build, 500); };
  if (D.body) go(); else D.addEventListener('DOMContentLoaded', go);
}
const banHtml = id => '<div style="font-size:64px">🚫</div><h1 style="margin:12px 0 6px;font-size:28px;color:#ff4d5e">DISPOSITIVO BANIDO</h1>'
  + '<p style="max-width:420px;opacity:.85;line-height:1.5">Detectamos modificações ou tentativa de inspeção não permitidas neste dispositivo.<br>O acesso ao jogo foi encerrado.</p>'
  + '<p style="opacity:.5;font-size:12px;margin-top:18px">Código: ' + String(id).slice(0, 14) + '<br>Se foi engano, fale com o criador informando este código.</p>';

// ---------------------------------------------------------------- CHAVE DO DONO
try {
  const m = location.hash.match(/dono=([A-Za-z0-9]{16,64})/);
  if (m) { localStorage.setItem('sr_own', m[1]); history.replaceState(null, '', location.pathname + location.search); }
  const k = localStorage.getItem('sr_own');
  if (k && OWNER_HASH && (await sha256hex(k)) === OWNER_HASH) S.owner = true;
} catch (_) {}

// ---------------------------------------------------------------- TRAVA DE DOMÍNIO (anti-clone)
if (!S.owner && !ALLOWED_HOSTS.includes(location.hostname)) {
  drawScreen('sr-host-screen', '<div style="font-size:60px">⚠️</div><h1 style="margin:12px 0 6px;font-size:26px;color:#ffb020">SITE NÃO OFICIAL</h1>'
    + '<p style="max-width:420px;opacity:.85;line-height:1.5">Este jogo só funciona no site oficial. Cuidado com cópias e golpes.</p>'
    + '<a href="' + OFFICIAL_URL + '" style="margin-top:16px;color:#7dbdff;font-size:18px">' + OFFICIAL_URL.replace('https://', '') + '</a>');
  await new Promise(() => {});
}

// ---------------------------------------------------------------- BAN NO APARELHO (3 lugares)
const LOCK_KEY = 'sr_dev_ban';
function persistLock(id) {
  try { localStorage.setItem(LOCK_KEY, id); } catch (_) {}
  try { D.cookie = LOCK_KEY + '=' + id + ';max-age=31536000;path=/;SameSite=Lax'; } catch (_) {}
  try { const r = indexedDB.open('sr_sec', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => { try { r.result.transaction('k', 'readwrite').objectStore('k').put(id, LOCK_KEY); } catch (_) {} }; } catch (_) {}
}
function readLockSync() {
  try { const v = localStorage.getItem(LOCK_KEY); if (v) return v; } catch (_) {}
  try { const m = D.cookie.match(new RegExp(LOCK_KEY + '=([^;]+)')); if (m) return m[1]; } catch (_) {}
  return '';
}
function readLockIDB() {
  return new Promise(res => {
    try {
      const r = indexedDB.open('sr_sec', 1); r.onupgradeneeded = () => r.result.createObjectStore('k');
      r.onsuccess = () => { try { const q = r.result.transaction('k').objectStore('k').get(LOCK_KEY); q.onsuccess = () => res(q.result || ''); q.onerror = () => res(''); } catch (_) { res(''); } };
      r.onerror = () => res('');
      setTimeout(() => res(''), 1500);
    } catch (_) { res(''); }
  });
}

// ---------------------------------------------------------------- flag / bloqueio / ban
const CLOCK_CODES = ['perf-own', 'perf-hook', 'raf-hook', 'date-hook', 'clock-drift', 'clock-lock-fail', 'clock-replaced', 'raf-replaced'];
function flag(code, weight = 1, detail = '') {
  if (S.owner || S.codes[code]) return;
  S.codes[code] = { w: weight, d: String(detail).slice(0, 80), at: Date.now() };
  S.score += weight;
  if (weight >= 3) S.strong++;
  // dois ou mais sinais de relógio adulterado = speed-hack (extensões legítimas raramente fazem os dois)
  if (!S.clockStrong && CLOCK_CODES.filter(c => S.codes[c]).length >= 2) { S.clockStrong = 1; S.strong++; }
  S.pending = S.pending || { codes: [], ua: String(navigator.userAgent || '').slice(0, 120), at: Date.now() };
  S.pending.codes.push(code + (detail ? ':' + String(detail).slice(0, 40) : ''));
  if (!S.blocked && S.score >= LIMIT) {
    S.blocked = true;
    for (const fn of S.listeners) { try { fn(Object.keys(S.codes)); } catch (_) {} }
  }
  if (!S.locked && S.strong >= 1 && S.score >= LIMIT) lockout();
}

function lockout(fixedId) {
  if (S.locked || S.owner) return; S.locked = true;
  const id = fixedId || ('B' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase());
  S.banId = id; persistLock(id);
  try { W.stop(); } catch (_) {}
  try { D.querySelectorAll('audio,video').forEach(m => { try { m.pause(); m.muted = true; } catch (_) {} }); } catch (_) {}
  drawScreen('sr-ban-screen', banHtml(id));
  for (const fn of S.lockListeners) { try { fn(Object.keys(S.codes)); } catch (_) {} }
}

// ban já existente neste aparelho: trava na hora e o jogo nem começa
if (!S.owner) {
  let prior = readLockSync() || await readLockIDB();
  if (prior) {
    S.locked = true; S.blocked = true; S.score = 99; S.banId = prior; S.codes.device_ban = { w: 9, d: prior, at: Date.now() };
    S.pending = { codes: ['device_ban:' + prior], ua: String(navigator.userAgent || '').slice(0, 120), at: Date.now() };
    persistLock(prior);
    drawScreen('sr-ban-screen', banHtml(prior));
    await new Promise(() => {});
  }
}

// ---------------------------------------------------------------- impressão digital do aparelho (resiste a VPN/troca de conta)
let fpP = null;
function fingerprint() {
  return fpP || (fpP = (async () => {
    try {
      const p = [navigator.platform, navigator.hardwareConcurrency, navigator.deviceMemory, navigator.maxTouchPoints,
        Math.max(screen.width, screen.height) + 'x' + Math.min(screen.width, screen.height) + 'x' + screen.colorDepth, W.devicePixelRatio];
      try { const c = D.createElement('canvas'); c.width = 220; c.height = 40; const g = c.getContext('2d'); g.textBaseline = 'top'; g.font = '16px Arial'; g.fillStyle = '#f60'; g.fillRect(10, 5, 90, 25); g.fillStyle = '#069'; g.fillText('SubwayRun♥Rio 1.0', 4, 8); p.push(c.toDataURL().slice(-80)); } catch (_) {}
      try { const gl = D.createElement('canvas').getContext('webgl'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); if (e) p.push(gl.getParameter(e.UNMASKED_RENDERER_WEBGL), gl.getParameter(e.UNMASKED_VENDOR_WEBGL)); } catch (_) {}
      return (await sha256hex(p.join('|'))).slice(0, 32);
    } catch (_) { return ''; }
  })());
}
fingerprint();

// ---------------------------------------------------------------- 1) relógio blindado
let FTS = Function.prototype.toString;
try {
  const fr = D.createElement('iframe');
  fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
  fr.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-9999px';
  (D.documentElement || D.head || D).appendChild(fr);
  if (fr.contentWindow && fr.contentWindow.Function) FTS = fr.contentWindow.Function.prototype.toString;
} catch (_) {}
const isNative = fn => { try { return typeof fn === 'function' && /\{\s*\[native code\]\s*\}\s*$/.test(FTS.call(fn)); } catch (_) { return false; } };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function lock(obj, key, value) { try { Object.defineProperty(obj, key, { value, writable: false, configurable: false, enumerable: true }); return true; } catch (_) { return false; } }

function armClock() {
  try {
    if (hasOwn(W.performance, 'now')) flag('perf-own', 2, 'performance.now');
    if (!isNative(W.performance.now)) flag('perf-hook', 2, 'performance.now');
    if (!isNative(W.requestAnimationFrame)) flag('raf-hook', 2, 'rAF');
    if (!isNative(W.Date.now)) flag('date-hook', 2, 'Date.now');
  } catch (_) {}
  const rawRAF = W.requestAnimationFrame;
  const safeNow = function now() { return NATIVE_NOW(); };
  const safeRAF = function requestAnimationFrame(cb) { if (S.locked) return 0; return rawRAF.call(W, () => { if (!S.locked) cb(NATIVE_NOW()); }); };
  const a = lock(W.performance, 'now', safeNow), b = lock(W, 'requestAnimationFrame', safeRAF);
  if (!a || !b) flag('clock-lock-fail', 2);
  S.safeNow = safeNow; S.safeRAF = safeRAF;
}

// ---------------------------------------------------------------- 2) assinaturas
const BAD_GLOBAL = /^(__MOD|__mod|modmenu|mod_?menu|__cheat|cheat|hack|GM_|GM$|unsafeWindow|Tampermonkey|violentmonkey|greasemonkey|__tm|__vm)/i;
const BAD_ID = /(^|[-_])(mod|cheat|hack|trainer|speedhack)([-_]|$)|^sr-mod/i;
const BAD_TEXT = /__MOD__|unsafeWindow|GM_info|==UserScript==|speedMul|noclip(Off)?\b/;

function scanGlobals() { try { for (const k of Object.getOwnPropertyNames(W)) if (BAD_GLOBAL.test(k)) { flag('global', 3, k); return; } } catch (_) {} }
function checkScriptNode(s) {
  try {
    const src = s.src || '';
    if (!src) { if (BAD_TEXT.test(s.textContent || '')) flag('inline-cheat', 3); return; }
    if (/^(blob|data):/i.test(src)) { flag('blob-script', 3, src.slice(0, 12)); return; }
    let origin = ''; try { origin = new URL(src, location.href).origin; } catch (_) {}
    if (origin !== SELF_ORIGIN && !ALLOWED_SCRIPT_HOSTS.includes(origin)) flag('foreign-script', 2, origin);
    if (s.type === 'javascript/blocked') flag('blocked-script', 3, 'swap');
  } catch (_) {}
}
function checkElement(el) {
  try {
    if (!el || el.nodeType !== 1 || el.id === 'sr-ban-screen' || el.id === 'sr-host-screen') return;
    if (el.tagName === 'SCRIPT') { checkScriptNode(el); return; }
    if (el.id && BAD_ID.test(el.id)) { flag('menu-id', 3, el.id); return; }
    const st = el.style; if (st && st.position === 'fixed' && parseInt(st.zIndex, 10) >= 2147483000) flag('overlay', 1, 'z-max');
  } catch (_) {}
}
function scanDom() {
  try {
    D.querySelectorAll('script').forEach(checkScriptNode);
    if (D.body) for (const el of D.body.children) checkElement(el);
    D.querySelectorAll('[id^="sr-mod"],[id*="cheat"],[id*="mod-menu"]').forEach(el => flag('menu-id', 3, el.id));
  } catch (_) {}
}
function observeDom() {
  try {
    new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) { checkElement(n); if (n.nodeType === 1 && n.querySelectorAll) n.querySelectorAll('script').forEach(checkScriptNode); } })
      .observe(D.documentElement, { childList: true, subtree: true });
  } catch (_) {}
}
function scanNatives() {
  try {
    if (!isNative(W.setTimeout)) flag('timeout-hook', 1);
    if (!isNative(W.setInterval)) flag('interval-hook', 1);
    if (!isNative(W.fetch)) flag('fetch-hook', 1);
    if (!isNative(W.Date.now)) flag('date-hook', 2, 'Date.now');
    if (!isNative(W.Event)) flag('event-hook', 2);
    if (W.performance.now !== S.safeNow) flag('clock-replaced', 3);
    if (W.requestAnimationFrame !== S.safeRAF) flag('raf-replaced', 3);
    if (Function.prototype.toString !== FTS && !isNative(Function.prototype.toString)) flag('tostring-hook', 2);
  } catch (_) {}
}
let drift = { ev: NATIVE_NOW(), dt: Date.now(), strikes: 0 };
function scanDrift() {
  const ev = NATIVE_NOW(), dt = Date.now(), dEv = ev - drift.ev, dDt = dt - drift.dt;
  if (dDt < 1500) return; drift.ev = ev; drift.dt = dt;
  if (dEv < 0) return;
  const r = dEv / dDt;
  if (r < 0.7 || r > 1.4) { if (++drift.strikes >= 3) flag('clock-drift', 2, r.toFixed(2)); } else drift.strikes = 0;
}
D.addEventListener('visibilitychange', () => { drift.ev = NATIVE_NOW(); drift.dt = Date.now(); drift.strikes = 0; });

// ---------------------------------------------------------------- DevTools / inspeção (desktop)
const DESKTOP = !('ontouchstart' in W) && !((navigator.maxTouchPoints || 0) > 0);
function dbgProbe() { const t = NATIVE_NOW(); debugger; return NATIVE_NOW() - t; }   // com DevTools aberto, o "debugger" PAUSA
let lastDev = 0, gapN = 0;
function scanDevtools() {
  if (!DESKTOP || S.owner) return;
  const n = Date.now(); if (n - lastDev < 1000) return; lastDev = n;
  try {
    const gap = (W.outerWidth - W.innerWidth > 200) || (W.outerHeight - W.innerHeight > 260);
    if (gap) { if (++gapN >= 3) flag('devtools-size', 1); } else gapN = 0;
    if (dbgProbe() > 120) flag('devtools-open', 3);
  } catch (_) {}
}

// atalhos de inspeção / salvar página: bloqueia e conta tentativas
function toast(msg) {
  try { const t = D.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483646;background:#b71c1c;color:#fff;padding:10px 16px;border-radius:10px;font:700 14px system-ui;box-shadow:0 6px 20px #0008';
    (D.body || D.documentElement).appendChild(t); setTimeout(() => t.remove(), 3500); } catch (_) {}
}
W.addEventListener('keydown', e => {
  if (S.owner) return;
  const k = String(e.key || '').toLowerCase(), c = e.ctrlKey || e.metaKey, s = e.shiftKey;
  const bad = e.key === 'F12' || (c && s && ['i', 'j', 'c', 'k', 'e'].includes(k)) || (c && !s && ['u', 's'].includes(k)) || (e.metaKey && e.altKey && ['i', 'j', 'u', 'c'].includes(k));
  if (!bad) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (++S.strikes >= SHORTCUT_STRIKES) flag('shortcut', 3, k); else toast('Ação bloqueada. Tentar de novo resulta em banimento.');
}, true);
W.addEventListener('contextmenu', e => { if (!S.owner && !(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) e.preventDefault(); }, true);

// ---------------------------------------------------------------- 3) tripwires do código do jogo
function watch(fns) { S.watched = Object.assign(S.watched || {}, fns); scanWatched(); }
function scanWatched() {
  const w = S.watched; if (!w) return;
  for (const k of Object.keys(w)) {
    let src = '';
    try { src = FTS.call(w[k]); } catch (_) { flag('watch-err', 2, k); continue; }
    if (BAD_TEXT.test(src) || /window\s*\.\s*__[A-Za-z]/.test(src)) flag('patched-fn', 3, k);
    if (/\{\s*\[native code\]\s*\}\s*$/.test(src)) flag('fn-native-swap', 2, k);
  }
}
function checkModuleUrl(url) { try { if (!String(url).startsWith(SELF_ORIGIN + '/')) flag('foreign-module', 3, String(url).slice(0, 14)); } catch (_) { flag('foreign-module', 3); } }
function tick(info) {
  try {
    if (!info) return;
    if (info.speed > 4200) flag('speed-over', 3, Math.round(info.speed));
    if (info.coinMul > 1.01 && info.coinMulMax !== undefined && info.coinMul > info.coinMulMax) flag('coinmul', 3, info.coinMul);
    if (info.speedMax > 6000) flag('speedmax', 3, Math.round(info.speedMax));
  } catch (_) {}
}

// ---------------------------------------------------------------- start
function runScans() { scanGlobals(); scanDom(); scanNatives(); scanDrift(); scanWatched(); scanDevtools(); }
armClock();
scanGlobals(); scanDom(); observeDom();
checkModuleUrl(import.meta.url);
D.addEventListener('DOMContentLoaded', () => { scanDom(); scanGlobals(); });
W.addEventListener('load', () => setTimeout(runScans, 200));
W.addEventListener('resize', () => { lastDev = 0; scanDevtools(); });
setInterval(runScans, 400);
setTimeout(() => { if (!S.watched) flag('no-watch', 2); }, 9000);

// ---------------------------------------------------------------- API pública
export const SR = {
  get blocked() { return S.blocked; },
  get locked() { return S.locked; },
  get owner() { return S.owner; },
  get banId() { return S.banId; },
  get score() { return S.score; },
  codes() { return Object.keys(S.codes); },
  flag, watch, tick, checkModuleUrl, fingerprint,
  now: NATIVE_NOW,
  /** usado quando o SERVIDOR diz que este aparelho/conta já está banido */
  forceLock(reason) { if (S.owner) return; S.codes[reason || 'server-ban'] = { w: 9, d: '', at: Date.now() }; S.score = 99; S.strong++; S.blocked = true; lockout(); },
  onBlock(fn) { if (typeof fn === 'function') { S.listeners.push(fn); if (S.blocked) { try { fn(Object.keys(S.codes)); } catch (_) {} } } },
  onLock(fn) { if (typeof fn === 'function') { S.lockListeners.push(fn); if (S.locked) { try { fn(Object.keys(S.codes)); } catch (_) {} } } },
  takeReport() { const p = S.pending; S.pending = null; return p; },
  peekReport() { return S.pending; }
};
try { Object.defineProperty(W, '__SR_SHIELD_ON', { value: true, writable: false, configurable: false, enumerable: false }); } catch (_) {}
