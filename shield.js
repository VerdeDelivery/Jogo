// ============================================================================
//  SUBWAY RUN — SHIELD v1  (camada anti-cheat do navegador)
//
//  Carregado ANTES de tudo (index.html + primeiro import do app.js).
//  O que faz:
//   1) RELÓGIO BLINDADO: troca performance.now / requestAnimationFrame por versões
//      baseadas em um relógio que scripts de página não conseguem alterar
//      (Event.timeStamp) e TRAVA as duas (não-graváveis, não-configuráveis).
//      => derruba o "Speed 1000x" do Tampermonkey e qualquer hack de velocidade colado no console.
//   2) DETECÇÃO: assinaturas de cheats (__MOD__, GM_*, menus flutuantes, <script blob:>,
//      scripts de origem estranha, funções nativas trocadas, relógio fora de ritmo).
//   3) TRIPWIRES: vigia o código das funções-chave do jogo (stumble/draw/step/...) e
//      detecta quando alguém reescreveu o app.js em memória (o método do script).
//   4) BLOQUEIO: quando a pontuação de suspeita passa do limite, a corrida NÃO vale para o
//      ranking e um relatório vai para a coleção "flags" (você vê no Firebase / painel).
//
//  IMPORTANTE: nenhuma proteção do navegador é 100% — o usuário controla o navegador.
//  A proteção "de verdade" fica no servidor (firestore.rules: tempo do ranking limitado
//  pelo relógio do SERVIDOR). Este arquivo aumenta MUITO o custo de burlar e gera provas.
// ============================================================================

const W = window, D = document;
const LIMIT = 3;                      // pontuação de suspeita que bloqueia a corrida
const SELF_ORIGIN = location.origin;
const ALLOWED_SCRIPT_HOSTS = [
  'https://www.gstatic.com', 'https://apis.google.com', 'https://www.google.com',
  'https://accounts.google.com', 'https://www.youtube.com', 'https://s.ytimg.com'
];

const S = { score: 0, codes: Object.create(null), blocked: false, listeners: [], pending: null, lastWatch: 0, watched: null, boot: Date.now() };

// ---------------------------------------------------------------- relógio nativo
// Event.timeStamp vem direto do navegador (mesma escala do performance.now) e não passa por
// nenhuma função JavaScript que um userscript possa ter substituído.
const NATIVE_NOW = () => new Event('t').timeStamp;

// ---------------------------------------------------------------- toString "puro"
let FTS = Function.prototype.toString;
let pristineRealm = null;
try {
  const fr = D.createElement('iframe');
  fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
  fr.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-9999px';
  (D.documentElement || D.head || D).appendChild(fr);
  pristineRealm = fr.contentWindow;
  if (pristineRealm && pristineRealm.Function) FTS = pristineRealm.Function.prototype.toString;
} catch (_) { /* sem iframe: segue com o toString local */ }

const isNative = fn => { try { return typeof fn === 'function' && /\{\s*\[native code\]\s*\}\s*$/.test(FTS.call(fn)); } catch (_) { return false; } };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------- flag / bloqueio
function flag(code, weight = 1, detail = '') {
  if (S.codes[code]) return;                 // cada sinal conta uma vez
  S.codes[code] = { w: weight, d: String(detail).slice(0, 80), at: Date.now() };
  S.score += weight;
  S.pending = S.pending || { codes: [], ua: String(navigator.userAgent || '').slice(0, 120), at: Date.now() };
  S.pending.codes.push(code + (detail ? ':' + String(detail).slice(0, 40) : ''));
  if (!S.blocked && S.score >= LIMIT) {
    S.blocked = true;
    for (const fn of S.listeners) { try { fn(Object.keys(S.codes)); } catch (_) {} }
  }
}

// ---------------------------------------------------------------- 1) relógio blindado
function lock(obj, key, value) {
  try { Object.defineProperty(obj, key, { value, writable: false, configurable: false, enumerable: true }); return true; }
  catch (_) { return false; }
}

function armClock() {
  // detecta o estrago ANTES de consertar
  try {
    if (hasOwn(W.performance, 'now')) flag('perf-own', 2, 'performance.now');
    if (!isNative(W.performance.now)) flag('perf-hook', 2, 'performance.now');
    if (!isNative(W.requestAnimationFrame)) flag('raf-hook', 2, 'rAF');
    if (!isNative(W.Date.now)) flag('date-hook', 2, 'Date.now');
  } catch (_) {}

  // relógio novo (não adulterável) + rAF que entrega SEMPRE o relógio novo
  const rawRAF = W.requestAnimationFrame;
  const safeNow = function now() { return NATIVE_NOW(); };
  const safeRAF = function requestAnimationFrame(cb) { return rawRAF.call(W, () => cb(NATIVE_NOW())); };
  const a = lock(W.performance, 'now', safeNow);
  const b = lock(W, 'requestAnimationFrame', safeRAF);
  if (!a || !b) flag('clock-lock-fail', 2);
  S.safeNow = safeNow; S.safeRAF = safeRAF;
}

// ---------------------------------------------------------------- 2) detecção de assinaturas
const BAD_GLOBAL = /^(__MOD|__mod|modmenu|mod_?menu|__cheat|cheat|hack|GM_|GM$|unsafeWindow|Tampermonkey|violentmonkey|greasemonkey|__tm|__vm)/i;
const BAD_ID = /(^|[-_])(mod|cheat|hack|trainer|speedhack)([-_]|$)|^sr-mod/i;
const BAD_TEXT = /__MOD__|unsafeWindow|GM_info|==UserScript==|speedMul|noclip(Off)?\b/;

function scanGlobals() {
  try {
    for (const k of Object.getOwnPropertyNames(W)) {
      if (BAD_GLOBAL.test(k)) { flag('global', 3, k); return; }
    }
  } catch (_) {}
}

function checkScriptNode(s) {
  try {
    const src = s.src || '';
    if (!src) {
      const t = s.textContent || '';
      if (BAD_TEXT.test(t)) flag('inline-cheat', 3);
      return;
    }
    if (/^(blob|data):/i.test(src)) { flag('blob-script', 3, src.slice(0, 12)); return; }
    let origin = ''; try { origin = new URL(src, location.href).origin; } catch (_) {}
    if (origin !== SELF_ORIGIN && !ALLOWED_SCRIPT_HOSTS.includes(origin)) flag('foreign-script', 2, origin);
    if (s.type === 'javascript/blocked') flag('blocked-script', 3, 'swap');
  } catch (_) {}
}

function checkElement(el) {
  try {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'SCRIPT') { checkScriptNode(el); return; }
    if (el.id && BAD_ID.test(el.id)) { flag('menu-id', 3, el.id); return; }
    const st = el.style;
    if (st && st.position === 'fixed' && parseInt(st.zIndex, 10) >= 2147483000) flag('overlay', 3, 'z-max');
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
    const mo = new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) {
        checkElement(n);
        if (n.nodeType === 1 && n.querySelectorAll) n.querySelectorAll('script').forEach(checkScriptNode);
      }
    });
    mo.observe(D.documentElement, { childList: true, subtree: true });
  } catch (_) {}
}

// funções nativas que cheats costumam trocar
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

// relógio nativo x relógio do sistema: se andarem fora de compasso, alguém mexeu em tempo
let drift = { ev: NATIVE_NOW(), dt: Date.now(), strikes: 0 };
function scanDrift() {
  const ev = NATIVE_NOW(), dt = Date.now();
  const dEv = ev - drift.ev, dDt = dt - drift.dt;
  drift.ev = ev; drift.dt = dt;
  if (dDt < 1500 || dEv < 0) return;                       // janela curta demais
  const ratio = dEv / dDt;
  if (ratio < 0.7 || ratio > 1.4) {
    if (++drift.strikes >= 3) flag('clock-drift', 2, ratio.toFixed(2));
  } else drift.strikes = 0;
}
D.addEventListener('visibilitychange', () => { drift.ev = NATIVE_NOW(); drift.dt = Date.now(); drift.strikes = 0; });

// ---------------------------------------------------------------- 3) tripwires do código do jogo
// O script do cheat REESCREVE o texto do app.js (regex em stumble / draw ...).
// Depois da reescrita, String(função) passa a conter o código injetado.
function watch(fns) {
  S.watched = Object.assign(S.watched || {}, fns);
  S.lastWatch = Date.now();
  scanWatched();
}
function scanWatched() {
  const w = S.watched; if (!w) return;
  for (const k of Object.keys(w)) {
    let src = '';
    try { src = FTS.call(w[k]); } catch (_) { flag('watch-err', 2, k); continue; }
    if (BAD_TEXT.test(src) || /window\s*\.\s*__[A-Za-z]/.test(src)) flag('patched-fn', 3, k);
    if (/\{\s*\[native code\]\s*\}\s*$/.test(src)) flag('fn-native-swap', 2, k);
  }
}

// o módulo do jogo precisa estar rodando da nossa origem (cheat injeta via blob:)
function originOk(url) {
  try { return String(url).startsWith(SELF_ORIGIN + '/'); } catch (_) { return false; }
}
function checkModuleUrl(url) { if (!originOk(url)) flag('foreign-module', 3, String(url).slice(0, 14)); }

// ---------------------------------------------------------------- 4) leituras de estado do jogo (por frame)
// speed/coin: limites muito acima do normal só existem com cheat.
function tick(info) {
  try {
    if (!info) return;
    if (info.speed > 4200) flag('speed-over', 3, Math.round(info.speed));
    if (info.coinMul > 1.01 && info.coinMulMax !== undefined && info.coinMul > info.coinMulMax) flag('coinmul', 3, info.coinMul);
    if (info.speedMax > 6000) flag('speedmax', 3, Math.round(info.speedMax));
  } catch (_) {}
}

// ---------------------------------------------------------------- start
function runScans() { scanGlobals(); scanDom(); scanNatives(); scanDrift(); scanWatched(); }

armClock();
scanGlobals(); scanDom(); observeDom();
checkModuleUrl(import.meta.url);
D.addEventListener('DOMContentLoaded', () => { scanDom(); scanGlobals(); });
W.addEventListener('load', () => setTimeout(runScans, 400));
setInterval(runScans, 2000);

// se o app.js nunca registrar os tripwires, é sinal de que removeram a chamada
setTimeout(() => { if (!S.watched) flag('no-watch', 2); }, 9000);

// ---------------------------------------------------------------- API pública
export const SR = {
  /** true quando a corrida/ranking deve ser bloqueado */
  get blocked() { return S.blocked; },
  get score() { return S.score; },
  codes() { return Object.keys(S.codes); },
  flag, watch, tick, checkModuleUrl,
  now: NATIVE_NOW,
  onBlock(fn) { if (typeof fn === 'function') { S.listeners.push(fn); if (S.blocked) { try { fn(Object.keys(S.codes)); } catch (_) {} } } },
  /** entrega (e zera) o relatório pendente — o firebase-dual grava em flags/{uid} */
  takeReport() { const p = S.pending; S.pending = null; return p; },
  peekReport() { return S.pending; }
};
// versão "janela" só para o firebase-dual quando carregado por <script>; sem expor funções de bypass
try { Object.defineProperty(W, '__SR_SHIELD_ON', { value: true, writable: false, configurable: false, enumerable: false }); } catch (_) {}
