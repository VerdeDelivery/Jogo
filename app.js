import { LocalDB } from './database.js';
import { fbApi } from './firebase-dual.js';
import { periodNow, fmtDateTime } from './common.js';
import { joinFsRoom } from './multiplayer.js';
await LocalDB.open();
await LocalDB.hydrate(['subwayrun_rio_v4','rio_live_rank2','rio_global_rank2','sr_music_cfg','sr_music_mine']);
// Conteúdo publicado no painel (live/meta e live/verified). O jogo já lê estes caches; se a rede demorar, segue com o último salvo.
let VER = {}; try { VER = JSON.parse(localStorage.getItem('rio_live_ver') || '{}') || {}; } catch (_) { VER = {}; }
let NEWS = {}; try { NEWS = JSON.parse(localStorage.getItem('rio_live_news') || '{}') || {}; } catch (_) { NEWS = {}; }
try {
  const lv = await Promise.race([fbApi('/api/live', 'GET'), new Promise(r => setTimeout(() => r(null), 3500))]);
  if (lv && lv.data && lv.data.meta) {
    const m = lv.data.meta, put = (k, v) => { if (typeof v === 'string') try { localStorage.setItem(k, v); } catch (_) {} };
    put('rio_live_skins', m.skinsJson); put('rio_live_skrules', m.skRulesJson); put('rio_live_av', m.avJson); put('rio_live_bn', m.bnJson);
    const ph = m.creatorPhoto;
    if (typeof ph === 'string' && /^(data:image\/(jpeg|png|webp);base64,|https:\/\/)/.test(ph)) { try { localStorage.setItem('sr_creator_photo', ph); } catch (_) {} const bi = document.getElementById('bootImg'); if (bi && bi.isConnected && bi.getAttribute('src') !== ph) bi.src = ph; }
    else if (ph === '') { try { localStorage.removeItem('sr_creator_photo'); } catch (_) {} }
    try { localStorage.setItem('rio_live_status', JSON.stringify(lv.data.status || {})); localStorage.setItem('rio_live_don', JSON.stringify(lv.data.don || { enabled:false })); } catch (_) {}
    VER = lv.data.verified || {}; try { localStorage.setItem('rio_live_ver', JSON.stringify(VER)); } catch (_) {}
    { const ex = lv.data.extra || {}; put('sr_music_admin', ex.music); put('rio_live_lives', ex.lives); put('rio_live_partners', ex.partners); NEWS = ex.news || {}; try { localStorage.setItem('rio_live_news', JSON.stringify(NEWS)); } catch (_) {} }
  }
} catch (_) {}
// Banco exclusivo de skins (skin-4f7da). Consulta uma vez por 10 minutos e usa cache local.
async function loadExternalSkinBank() {
  const KEY='rio_external_skins', AT='rio_external_skins_at', TTL=10*60*1000;
  try {
    const at=Number(localStorage.getItem(AT)||0), cached=JSON.parse(localStorage.getItem(KEY)||'[]');
    if (Array.isArray(cached) && Date.now()-at>=0 && Date.now()-at<TTL) return;
  } catch (_) {}
  try {
    const [App, Store] = await Promise.all([import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')]);
    const cfg={apiKey:'AIzaSyCgFYmJlHaxPfpvnrOxVI0YjvwJMsWLBaE',authDomain:'skin-4f7da.firebaseapp.com',projectId:'skin-4f7da',storageBucket:'skin-4f7da.firebasestorage.app',messagingSenderId:'147966450703',appId:'1:147966450703:web:cb4083b37acf5a45c0577a'};
    const app=App.initializeApp(cfg,'sr-skin-bank-game');
    const db=Store.getFirestore(app);
    // Um único documento de catálogo evita uma leitura por skin para cada jogador.
    const snap=await Store.getDoc(Store.doc(db,'catalog','skins'));
    const catalog=snap.exists() ? (snap.data()||{}) : {};
    const list=[];
    for(const d of (Array.isArray(catalog.items)?catalog.items:[]).slice(0,60)) {
      if(!d || d.status!=='published' || typeof d.id!=='string') continue;
      let skin=d.skinJson||d.skin||{};
      if(typeof skin==='string'){try{skin=JSON.parse(skin)}catch(_){skin={}}}
      if(!skin||typeof skin!=='object')continue;
      const textures={};
      for(const k of ['shirt','pants','accessory','backpack']) {
        const u=d.textures&&d.textures[k];
        if(typeof u==='string' && /^https:\/\/[^\s\"'()<>]+$/i.test(u)) textures[k]=u;
      }
      list.push({...skin,id:'bank_'+d.id,price:Math.max(0,Math.min(100000,Math.round(Number(d.price??skin.price)||0))),textures});
    }
    localStorage.setItem(KEY,JSON.stringify(list)); localStorage.setItem(AT,String(Date.now()));
  } catch(e) { console.warn('Banco de skins indisponível; usando cache/local:',e); }
}
await Promise.race([loadExternalSkinBank(), new Promise(resolve=>setTimeout(resolve,3000))]);
// Selo de verificado: 'dev' (criador) ou 'streamer' (parceiro)
const vBadge = t => t === 'dev' ? '<span class="vb dev" title="Desenvolvedor (criador do jogo)">✔</span>' : t === 'streamer' ? '<span class="vb st" title="Streamer parceiro">✔</span>' : '';


/* Tela de carregamento: o carregador fica no index.html (inicia na hora, antes de qualquer rede). */


/* =====================================================================
   SUBWAY RUN — corrida infinita em 3 pistas (HTML + JS puro)
   Personalizável: KeyTweak (teclas) e Timer (modo, valor, tamanho, cor).
   Seções: 1 Config · 2 Telas · 3 Jogo · 4 Desenho · 5 Controles
   ===================================================================== */
const $ = s => document.querySelector(s);
const STORE = 'subwayrun_rio_v4';
const CLOUD = { timer:null };
const MATCH = { socket:null, id:"", users:[], rooms:[], room:null, active:false, started:false, eliminated:false, podium:[], frames:[], frameAt:0, startedAt:0, phase:"", invitation:null, message:"", countdownTimer:null };
let REPLAY_DATA = null, replayRAF = 0, replayPlaying = true;
async function platformUser() {
  if (getToken()) return { id:'session' };
  try {
    const user = await window.websim?.getUser();
    return user && user.id && user.id !== '1' && user.username !== 'anonymous' ? user : null;
  } catch (_) { return null; }
}
const TOKEN_KEY = 'sr_token';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) {} };
// Chamada à API de contas. "down" = servidor indisponível/não configurado → o jogo usa a conta local deste aparelho.
async function api(path, method, body) {
  const r = await fbApi(path, method, body);
  if (r.status === 401 && getToken() && !['/api/auth/login','/api/poll/vote'].includes(path)) { setToken(''); if (typeof ACC !== 'undefined' && ACC && ACC.online) { ACC.online = false; ACC.needLogin = true; saveAcc(); } }
  if (r.data && r.data.token) setToken(r.data.token);
  return r;
}
async function cloudHeartbeat() {
  if (!(typeof ACC !== 'undefined' && ACC && ACC.online)) return;
  await api('/api/game/heartbeat', 'POST', {});
}
function startCloudPresence() {
  if (CLOUD.timer) return;
  cloudHeartbeat(); CLOUD.timer = setInterval(cloudHeartbeat, 25000);
}
async function saveCloudRun(data) {
  if (!(typeof ACC !== 'undefined' && ACC && ACC.online)) return;
  await api('/api/game/score', 'POST', data);
}

/* ---------- 1. CONFIGURAÇÃO (salva no localStorage) ---------- */
// Ações do KeyTweak: id → [rótulo, tecla padrão (KeyboardEvent.code)]
const ROLL_T = .66; // duração do carrinho (s)
const ACT = { left:['Mover à esquerda','KeyA'], right:['Mover à direita','KeyD'], jump:['Pular','KeyW'], roll:['Carrinho no chão','KeyS'], pause:['Pausar','KeyP'], coin:['Zerar timer (recomeça do 0)','KeyC'] };
const NAMES = { ArrowLeft:'←', ArrowRight:'→', ArrowUp:'↑', ArrowDown:'↓', Space:'␣' };
const kName = (c, k) => NAMES[c] || (k && k.length === 1 ? k.toUpperCase() : c.replace(/^(Key|Digit)/, ''));
const DEF = () => ({
  keys: Object.fromEntries(Object.entries(ACT).map(([i, [, c]]) => [i, { c, l: kName(c) }])),
  timer: { show: true, mode: 'up', value: 0, size: 48, color: '#ffd21f', img: '', pad: 8 }, // up = crescente, down = regressivo
  coinColor: '#ffd21f', coinImg: '', coinImageName: 'Moeda personalizada', backpackImg: '', backpackImageName: 'Mochila personalizada', wristImg: '', wristImageName: 'Pulseira personalizada', skyImg: '',
  best: 0, char: 0, map: 0, graphics: 'padrao', nocoin: true, // nocoin: pegar moeda para o timer
  pos: { timer: 'tc', coins: 'tr', score: 'tl', keys: 'bl', tela: 'tv', fps: 'br' }, fps: { show: true, size: 22, color: '#7dff9b', img: '', pad: 6 }, free: {}, scale: {}, tv: { on: true, vids: [], vol: 60 }, bpSize: 1.7, trail: 'auto', wallet: 0, owned: [0, 1, 2, 5], ownedIds: [], charId: '', rank: [], ranks: {}, nick: 'Você', sound: true, music: true, inf: false, keysz: 40, keyop: 1, camFollow: true // posições na tela (free = lugar arrastado)
});
let CFG = DEF();
try { const r = JSON.parse(localStorage.getItem(STORE) || 'null'); if (r) { Object.assign(CFG.keys, r.keys || {}); Object.assign(CFG.timer, r.timer || {}); CFG.best = +r.best || 0; CFG.char = +r.char || 0; CFG.map = +r.map || 0; if (r.pos) Object.assign(CFG.pos, r.pos); if (typeof r.nocoin === 'boolean') CFG.nocoin = r.nocoin; if (['suave','padrao','ultra','ultramax'].includes(r.graphics)) CFG.graphics = r.graphics; if (typeof r.coinColor === 'string' && /^#[0-9a-f]{6}$/i.test(r.coinColor)) CFG.coinColor = r.coinColor; if (typeof r.skyImg === 'string' && r.skyImg.startsWith('data:image/')) CFG.skyImg = r.skyImg; if (typeof r.coinImg === 'string' && r.coinImg.startsWith('data:image/')) CFG.coinImg = r.coinImg; if (typeof r.backpackImg === 'string' && r.backpackImg.startsWith('data:image/')) CFG.backpackImg = r.backpackImg; if (typeof r.wristImg === 'string' && r.wristImg.startsWith('data:image/')) CFG.wristImg = r.wristImg; if (typeof r.wristImageName === 'string') CFG.wristImageName = r.wristImageName.slice(0,40); if (typeof r.coinImageName === 'string') CFG.coinImageName = r.coinImageName.slice(0,40); if (typeof r.backpackImageName === 'string') CFG.backpackImageName = r.backpackImageName.slice(0,40); if (r.free) Object.assign(CFG.free, r.free); if (r.trail) CFG.trail = r.trail; if (typeof r.sound === 'boolean') CFG.sound = r.sound; CFG.wallet = +r.wallet || 0; if (Array.isArray(r.owned)) CFG.owned = r.owned.filter(Number.isInteger); if (Array.isArray(r.ownedIds)) CFG.ownedIds = r.ownedIds.filter(x => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)).slice(0, 200); if (typeof r.charId === 'string' && /^[\w-]{1,40}$/.test(r.charId)) CFG.charId = r.charId; if (Array.isArray(r.rank)) CFG.rank = r.rank.filter(x => x && typeof x.s === 'number').slice(0, 10); if (typeof r.nick === 'string' && r.nick) CFG.nick = r.nick.slice(0, 12); } } catch (e) {}
// migra teclas antigas (setas) para WASD; as setas continuam funcionando sempre
if ([['left', 'ArrowLeft'], ['right', 'ArrowRight'], ['jump', 'ArrowUp'], ['roll', 'ArrowDown']].every(([k, c]) => CFG.keys[k].c === c)) { const d = DEF().keys; for (const k of ['left', 'right', 'jump', 'roll']) CFG.keys[k] = d[k]; }
try { const r2 = JSON.parse(localStorage.getItem(STORE) || 'null') || {}; for (const k of ['keysz', 'keyop', 'inf', 'music']) if (k in r2) CFG[k] = r2[k]; } catch (e) {}
try { const r3 = JSON.parse(localStorage.getItem(STORE) || 'null') || {};
  if (r3.scale && typeof r3.scale === 'object') for (const k in r3.scale) { const n = +r3.scale[k]; if (n >= .3 && n <= 4) CFG.scale[k] = n; }
  if (r3.tv && typeof r3.tv === 'object') { if (typeof r3.tv.on === 'boolean') CFG.tv.on = r3.tv.on; const v = +r3.tv.vol; if (r3.tv.vol !== undefined && v >= 0 && v <= 100) CFG.tv.vol = Math.round(v); if (Array.isArray(r3.tv.vids)) CFG.tv.vids = r3.tv.vids.filter(x => x && ((typeof x.v === 'string' && /^[\w-]{11}$/.test(x.v)) || (typeof x.l === 'string' && /^[\w-]{10,50}$/.test(x.l)))).slice(0, 20); }
  if (r3.ranks && typeof r3.ranks === 'object') CFG.ranks = r3.ranks;
  const b = +r3.bpSize; if (b >= .5 && b <= 3.5) CFG.bpSize = b; } catch (e) {}
try { const r4 = JSON.parse(localStorage.getItem(STORE) || 'null') || {}, F = r4.fps; // FPS na tela
  if (F && typeof F === 'object') { if (typeof F.show === 'boolean') CFG.fps.show = F.show; const sz = +F.size; if (sz >= 10 && sz <= 90) CFG.fps.size = Math.round(sz); if (typeof F.color === 'string' && /^#[0-9a-f]{6}$/i.test(F.color)) CFG.fps.color = F.color; if (typeof F.img === 'string' && /^(data:image\/|https?:\/\/)/i.test(F.img)) CFG.fps.img = F.img; const pd = +F.pad; if (pd >= 0 && pd <= 30) CFG.fps.pad = Math.round(pd); } } catch (e) {}
try { const r5 = JSON.parse(localStorage.getItem(STORE) || 'null') || {}; if (typeof r5.camFollow === 'boolean') CFG.camFollow = r5.camFollow; if (+r5.stretch >= .6 && +r5.stretch <= 1.6) CFG.stretch = +r5.stretch; if (typeof r5.autoFS === 'boolean') CFG.autoFS = r5.autoFS; } catch (e) {}
try { if (!localStorage.getItem('vox_v1')) { CFG.map = 0; localStorage.setItem('vox_v1', '1'); } } catch (e) {}
// (a validação da skin escolhida agora é feita depois que o catálogo CHARS está completo)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(CFG)); } catch (e) {} LocalDB.put('settings', { key:'game', value:CFG, updatedAt:Date.now() }); hudPlace(); };
let skyImage = null, coinImage = null, backpackImage = null, wristImage = null;
function loadSkyImage(data) { skyImage = null; if (!data) return; const im = new Image(); im.onload = () => { skyImage = im; }; im.src = data; }
if (CFG.skyImg) loadSkyImage(CFG.skyImg);
function loadNamedImage(data, kind) { const im = data ? new Image() : null; if (im) { im.onload = () => { if (kind === 'coin') { const im2 = new Image(); im2.onload = () => { coinImage = im2; }; im2.src = circleCrop(im, 256).toDataURL('image/png'); } else if (kind === 'backpack') backpackImage = im; else wristImage = im; }; im.onerror = () => { if (kind === 'coin') coinImage = null; else if (kind === 'backpack') backpackImage = null; else wristImage = null; }; im.src = data; } else if (kind === 'coin') coinImage = null; else if (kind === 'backpack') backpackImage = null; else wristImage = null; }
if (CFG.coinImg) loadNamedImage(CFG.coinImg, 'coin'); if (CFG.backpackImg) loadNamedImage(CFG.backpackImg, 'backpack'); if (CFG.wristImg) loadNamedImage(CFG.wristImg, 'wrist');
function importSmallImage(file, kind, done) { if (!file || !file.type.startsWith('image/')) { done(false, 'Escolha um arquivo de imagem válido.'); return; } if (file.size > 5*1024*1024) { done(false, 'A imagem precisa ter até 5 MB.'); return; } const rd = new FileReader(); rd.onload = () => { const im = new Image(); im.onload = () => { const max = kind === 'coin' ? 256 : kind === 'wrist' ? 256 : 360, scale = Math.min(1, max/Math.max(im.width,im.height)), c2=document.createElement('canvas'); c2.width=Math.max(1,Math.round(im.width*scale)); c2.height=Math.max(1,Math.round(im.height*scale)); c2.getContext('2d').drawImage(im,0,0,c2.width,c2.height); const data=(kind==='coin'?circleCrop(im,256):c2).toDataURL('image/png'); if(kind==='coin'){CFG.coinImg=data;loadNamedImage(data,'coin');}else if(kind==='backpack'){CFG.backpackImg=data;loadNamedImage(data,'backpack');}else{CFG.wristImg=data;loadNamedImage(data,'wrist');} try { save(); done(true, 'Imagem aplicada e salva!'); } catch(e) { done(false, 'Imagem aplicada, mas o navegador não conseguiu salvar. Tente uma imagem menor.'); } }; im.onerror=()=>done(false,'Não foi possível abrir essa imagem.'); im.src=rd.result; }; rd.onerror=()=>done(false,'Falha ao ler o arquivo.'); rd.readAsDataURL(file); }

// Recorta a imagem em círculo perfeito (centralizada, cobrindo toda a moeda) com fundo transparente
function circleCrop(im, size) {
  const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height, m = Math.min(W, H), c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.closePath(); g.clip();
  g.drawImage(im, (W - m) / 2, (H - m) / 2, m, m, 0, 0, size, size); return c;
}
/* ---------- 2. TELAS (menu, pausa, fim, configurações) ---------- */
let st = 'title', prev = 'title', listening = null, backTo = 'title';
const card = $('#card'), ov = $('#ov');


/* ---------- UPDATE 10: ANIMAÇÕES DE MENU (cada personagem tem a sua dancinha) ----------
   Todo personagem, inclusive skins novas, ganha uma dança automática escolhida pelo nome.
   Para fixar uma: ch.dance = 'wave' | 'disco' | 'floss' | 'hop' | 'robot' | 'flex'. Rosto: ver drawChar. */
const DANCES = ['wave', 'disco', 'floss', 'hop', 'robot', 'flex'], EMOTES = ['smile', 'open', 'wink', 'tongue', 'wow', 'happy'];
const hashStr = s => { let h = 7; for (const c of String(s || 'x')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function danceOpts(ch, t) { // t em segundos -> opções para drawChar (personagem de frente)
  const h = hashStr(ch.n), id = ch.dance || DANCES[h % DANCES.length], S = Math.sin, PI = Math.PI;
  const o = { yaw: PI + .08, run: 0, emote: EMOTES[(Math.floor(t / 2.4) + h) % EMOTES.length], blink: (t % 3.1) < .12, look: S(t * .8) * .8, hop: 0 };
  if (id === 'wave') { o.yaw = PI + S(t * 1.3) * .22; o.ar = [-2.9 + S(t * 10) * .4, S(t * 1.6) * .12]; o.lg = [S(t * 2) * .1, -S(t * 2) * .1]; o.bobAdd = Math.abs(S(t * 2.6)) * 1.5; o.lean = S(t * 1.3) * .06; }
  else if (id === 'disco') { const a = S(t * 3.2); o.yaw = PI + S(t * 1.6) * .45; o.ar = [-1.35 - 1.35 * a, -1.35 + 1.35 * a]; o.lg = [S(t * 6.4) * .35, -S(t * 6.4) * .35]; o.bobAdd = Math.abs(S(t * 6.4)) * 3; o.lean = a * .12; }
  else if (id === 'floss') { const a = S(t * 8) * 1.5; o.yaw = PI + .1 + S(t * 4) * .32; o.ar = [a, a]; o.lg = [S(t * 4) * .25, -S(t * 4) * .25]; o.bobAdd = Math.abs(S(t * 4)) * 2; o.lean = S(t * 4) * .1; }
  else if (id === 'hop') { const a = Math.abs(S(t * 5)); o.yaw = PI + S(t * 1.1) * .2; o.ar = [-2.8 + S(t * 10) * .25, -2.8 - S(t * 10) * .25]; o.hop = a * 11; o.lg = a > .15 ? [-.5, .5] : [0, 0]; o.emote = o.emote === 'smile' ? 'open' : o.emote; }
  else if (id === 'robot') { const q = Math.floor(t * 3.6) % 4, e = x => x; o.yaw = PI + [0, .35, 0, -.35][q]; o.ar = q % 2 ? [-1.57, .1] : [.1, -1.57]; o.lg = q % 2 ? [.3, -.3] : [-.3, .3]; o.bobAdd = (t * 3.6 % 1) < .2 ? 2 : 0; o.look = 0; }
  else { o.yaw = PI + S(t * 2) * .12; o.ar = [-2.15 + S(t * 14) * .12, -2.15 - S(t * 14) * .12]; o.lg = [0, 0]; o.lean = -.12; o.bobAdd = Math.abs(S(t * 7)) * 2; if (o.emote === 'smile') o.emote = 'tongue'; } // flex
  return o;
}
function charAnimLoop(cvp, getCh, o2 = {}) { // desenha um personagem dançando num canvas; devolve a função de parar
  const dpr = Math.min(2, devicePixelRatio || 1), r = cvp.getBoundingClientRect(), w = Math.max(40, Math.round(r.width || cvp.width)), h = Math.max(40, Math.round(r.height || cvp.height));
  cvp.width = Math.round(w * dpr); cvp.height = Math.round(h * dpr);
  const pc = cvp.getContext('2d'), t0 = performance.now(); let raf = 0, dead = false;
  const frame = now => {
    if (dead || !cvp.isConnected) return;
    const ch = getCh(), t = (now - t0) / 1000, o = danceOpts(ch, t), u = h * dpr * (o2.fill || .78) / 135, hop = (o.hop || 0) * u;
    pc.clearRect(0, 0, cvp.width, cvp.height);
    pc.fillStyle = 'rgba(0,0,0,.26)'; pc.beginPath(); pc.ellipse(cvp.width * .5, cvp.height * (o2.base || .95), cvp.width * (.2 - (o.hop || 0) * .004), cvp.height * .026, 0, 0, 7); pc.fill();
    try { drawChar(pc, cvp.width * .5, cvp.height * (o2.base || .95) - hop - Math.abs(Math.sin(t * 2.1)) * 2 * dpr, u, ch, o); } catch (e) {}
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

/* ---------- UPDATE 10: MENU PRINCIPAL ESTILO SUBWAY SURFERS ---------- */
let homeStopFn = null;
function homeStop() { if (homeStopFn) { homeStopFn(); homeStopFn = null; } }
function homeStart() {
  const cvp = card.querySelector('#pv'); if (cvp) homeStopFn = charAnimLoop(cvp, () => CHARS[CFG.char], { fill: .84, base: .95 });
  const hf = card.querySelector('#hpFace'); if (hf) { const d = Math.min(2, devicePixelRatio || 1); hf.width = hf.height = Math.round(52 * d); try { drawChar(hf.getContext('2d'), 26 * d, 196 * d, 1.7 * d, CHARS[CFG.char], { yaw: 0, run: 0, emote: 'smile' }); } catch (e) {} }
}
const mapTitle = M => M.n.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').trim();
function homeHTML(name) {
  const M = MAPS[CFG.map], ch = CHARS[CFG.char], L = (typeof myRank === 'function' ? myRank() : []) || [], bestNc = L.length ? L[0].t : 0;
  const prof = ACC
    ? `<div class="hProfile" id="bAcc" role="button" tabindex="0" style="${bnStyle(ACC.banner)}">${avatarHTML(ACC, 52)}<div class="hpTxt"><small>${esc(ACC.name)}${vBadge(VER[ACC.uid])}</small><span>Recorde</span><b>${CFG.best}</b></div></div>`
    : `<div class="hProfile" id="bAcc0" role="button" tabindex="0"><canvas id="hpFace" class="av hGuest"></canvas><div class="hpTxt"><small>Entrar / criar conta</small><span>Recorde</span><b>${CFG.best}</b></div></div>`;
  const ovr = name === 'over' ? `<div class="hOver"><b>${esc(over.title)}</b><span>Pontos <b>${over.score}</b> · Moedas <b>${coins}</b> · Tempo <b>${fmtT(timerVal())}</b></span>${lastNc >= 1 ? `<span>⏱️ Maior tempo sem moeda: <b>${fmtT(lastNc)}</b>${lastNcNew ? ' · 🏆 novo recorde!' : ''}</span>` : ''}</div>` : '';
  return `<div class="home${name === 'over' ? ' over' : ''}">
  <button class="hPlay" id="bPlay" type="button" aria-label="Correr"></button>
  <div class="hTop">
    <div class="hPill"><i class="coinIc"></i><b>${CFG.inf ? '∞' : CFG.wallet}</b></div>
    <div class="hPill sm"><b>${esc(ch.n)}</b></div>
    <span class="hGap"></span>
    <button class="hRound" id="bFs" type="button" aria-label="Tela cheia">⛶</button>
    <button class="hRound" id="bCfg" type="button" aria-label="Ajustes">⚙</button>
  </div>
  ${ACC && !ACC.online ? '<div class="hWarn" id="bRelog" role="button" tabindex="0">🔐 Conta offline — toque para entrar</div>' : ''}
  <div id="liveNotice" class="hNotice">${noticeHTML()}</div>
  <div class="hLeft">
    ${prof}
    <button class="hCard" id="bRank" type="button"><i class="hcIc">🏆</i><span class="hcTx"><small>Sem moeda</small><b>${bestNc ? fmtT(bestNc) : '--:--'}</b></span></button>
    
  </div>
  <div class="hRight">
    <button class="hTile" id="bLive" type="button"><i>📺</i><span>LIVES</span></button>
    <button class="hTile" id="bPart" type="button"><i>🤝</i><span>PARCEIROS</span></button>
    <button class="hTile" id="bDonate" type="button"><i>💛</i><span>AJUDAR</span></button>
    <button class="hTile" id="bMus" type="button"><i>🎵</i><span>MÚSICA</span></button>
    <button class="hTile" id="bPoll" type="button"><i>📊</i><span>ENQUETE</span></button>
  </div>
  ${ovr}
  <div class="hMap"><div class="hMapName" style="font-size:min(${Math.round(Math.max(24, Math.min(54, 640 / mapTitle(M).length)))}px,11.5vw)">${esc(mapTitle(M))}</div>
    <div class="mapPick"><button class="hArrow" type="button" data-p="map" data-d="-1" aria-label="Mapa anterior">‹</button><span>Mapa ${CFG.map + 1}/${MAPS.length}</span><button class="hArrow" type="button" data-p="map" data-d="1" aria-label="Próximo mapa">›</button></div></div>
  <canvas id="pv" aria-label="Seu personagem"></canvas>
  <div class="hTap">Toque para jogar</div>
  <nav class="hNav">
    <button class="hNavBtn" id="bRank2" type="button"><i>🏆</i><span>RECORDES</span></button>
    <button class="hNavBtn" id="bMe" type="button"><i>🙂</i><span>EU</span></button>
    <button class="hNavBtn" id="bShop" type="button"><i>🛒</i><span>LOJA</span></button>
    <button class="hNavBtn ${ACC && ACC.online ? '' : 'lock'}" id="bMulti" type="button"><i>🌎</i><span>ONLINE</span></button>
  </nav>
</div>`;
}

function screen(name) {
  st = name === 'settings' ? 'settings' : name; ov.dataset.screen = name; ov.classList.remove('off');
  document.body.classList.toggle('home', name === 'title' || name === 'over'); homeStop(); if (name === 'title' || name === 'over') objs = [];
  if (name === 'title' || name === 'over') card.innerHTML = homeHTML(name);
  if (name === 'pause') card.innerHTML = `<h1>PAUSADO</h1><button class="btn" id="bPlay">CONTINUAR</button><button class="btn g" id="bMus" type="button">🎵 MÚSICAS</button><button class="btn g" id="bNew">Reiniciar</button><button class="btn g" id="bShop">SKINS E LOJA</button><button class="btn b" id="bCfg">CONFIGURAÇÕES</button>`;
  if (name === 'settings') drawSettings();
  if (name === 'shop') { shopSel = null; drawShop(); }
  if (name === 'rank') drawRank();
  if (name === 'multiplayer') { drawMultiplayer(); ensureMultiplayerSocket(); }
  if (name === 'podium') drawPodium();
  if (name === 'replay') drawReplay();
  if (name === 'eliminated') { st='eliminated'; card.innerHTML = '<h1>VOCÊ SAIU</h1><p>A corrida continua. Aguarde o resultado do pódio!</p><button class="btn g" id="mpWaitLeave">SAIR DA PARTIDA</button>'; $('#mpWaitLeave').onclick = () => { roomSend({type:'leave'}); MATCH.room=null; MATCH.active=false; MATCH.started=false; MATCH.phase=''; updateMatchHud(); screen('title'); }; }
  if (name === 'poll') drawPoll(); if (name === 'lives') drawLives(); if (name === 'partners') drawPartners(); if (name === 'music') drawMusic();
  if (name === 'account') drawAccount();
  if (name === 'login') drawLogin();
  const q = id => card.querySelector(id);
  if (name === 'title' || name === 'over') applyNewBadges();
  if (q('#bFs')) q('#bFs').onclick = () => (isFS() ? outFS() : goFS());
  if (q('#bShop')) q('#bShop').onclick = () => { backTo = name; screen('shop'); }; if (q('#bRank')) q('#bRank').onclick = () => { backTo = name; screen('rank'); }; if (q('#bRank2')) q('#bRank2').onclick = () => { backTo = name; screen('rank'); }; if (q('#bMulti')) q('#bMulti').onclick = () => { backTo = name; screen('multiplayer'); }; if (q('#bLive')) q('#bLive').onclick = () => { backTo = name; screen('lives'); }; if (q('#bPart')) q('#bPart').onclick = () => { backTo = name; screen('partners'); }; if (q('#bDonate')) q('#bDonate').onclick = () => { backTo = name; screen('donate'); showDonations(); }; if (q('#bMus')) q('#bMus').onclick = () => { backTo = name; screen('music'); }; if (q('#bPoll')) q('#bPoll').onclick = () => { backTo = name; screen('poll'); };
  if (q('#bMe')) q('#bMe').onclick = () => { accEdit = !!ACC; accDraft = null; screen(ACC ? 'account' : (Object.keys(ACCTS).length ? 'login' : 'account')); };
  if (q('#bLoginT')) q('#bLoginT').onclick = () => { accDraft = null; accEdit = false; screen(Object.keys(ACCTS).length ? 'login' : 'account'); };
  if (q('#bAcc0')) q('#bAcc0').onclick = () => { accEdit = false; accDraft = null; screen(Object.keys(ACCTS).length ? 'login' : 'account'); };
  if (q('#bRelog')) q('#bRelog').onclick = () => { loginName = ACC ? ACC.name : ''; accDraft = null; accEdit = false; screen('login'); };
  if (q('#bAcc')) { q('#bAcc').onclick = () => { accEdit = true; accDraft = null; screen('account'); }; q('#bAcc').onkeydown = e => { if (e.key === 'Enter') q('#bAcc').click(); }; }
  // seletor de mapa (tela inicial)
  card.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { const k = b.dataset.p, L = k === 'char' ? CHARS : MAPS; CFG[k] = (CFG[k] + +b.dataset.d + L.length) % L.length; save(); screen('title'); });
  if (name === 'title' || name === 'over') homeStart();
  if (q('#bPlay')) q('#bPlay').onclick = () => prev === 'pause' || name === 'pause' ? resume() : startGame();
  if (q('#bNew')) q('#bNew').onclick = startGame;
  if (q('#bCfg')) q('#bCfg').onclick = () => { prev = name; screen('settings'); };
  if (name === 'title' || name === 'over') q('#bPlay').onclick = startGame;
  $('#pauseBtn').style.visibility = 'hidden';
}

function roomSend(m){if(MATCH.socket)MATCH.socket.send(m)}
function roomAvatar(p,px){if(p&&p.avatarUrl)return '<img class="av" src="'+esc(p.avatarUrl)+'" width="'+px+'" height="'+px+'" alt="" loading="lazy">';return avatarHTML({avatar:avParse(p&&p.avatar)},px)}
async function ensureMultiplayerSocket(){if(MATCH.socket||MATCH.connecting)return;if(!(ACC&&ACC.online)){MATCH.message=ACC?'Sua conta não está conectada. Toque no seu nome no menu e entre de novo para jogar online.':'Entre numa conta para usar o multijogador.';renderLobbyData();return}MATCH.connecting=true;try{const s=await joinFsRoom();MATCH.socket=s;const profile=async()=>{let u=null;try{u=await window.websim?.getUser()}catch(_){}roomSend({type:'profile',name:ACC&&ACC.name||CFG.nick||'Visitante',avatar:String(ACC&&ACC.avatar!=null?ACC.avatar:0),character:CFG.char,customAccount:!!ACC,platformAvatar:!ACC&&!!u&&u.username!=='anonymous'})};s.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}if(m.type==='welcome'){MATCH.id=m.id;MATCH.users=m.users||[];MATCH.rooms=m.rooms||[];profile();renderLobbyData()}if(m.type==='lobby'){MATCH.users=m.users||[];MATCH.rooms=m.rooms||[];const me=MATCH.users.find(x=>x.id===MATCH.id);if(me&&!me.roomId&&MATCH.room){MATCH.room=null;MATCH.active=false;MATCH.phase='';updateMatchHud()}renderLobbyData()}if(m.type==='created'||m.type==='joined'){MATCH.message='';renderLobbyData()}if(m.type==='match'){MATCH.room=m.room;MATCH.phase=m.room.phase;updateMatchHud();renderLobbyData()}if(m.type==='countdown'){MATCH.phase='countdown';startCountdown(m.startAt);updateMatchHud();renderLobbyData()}if(m.type==='go'){MATCH.phase='running';updateMatchHud();if(!MATCH.started&&!MATCH.countdownTimer&&!MATCH.goPending)startCountdown(m.startedAt)}if(m.type==='progress'){const p=MATCH.room&&MATCH.room.players.find(x=>x.id===m.id);if(p){p.distance=m.distance;if(Number.isFinite(m.lane))p.lane=m.lane;updateMatchHud()}}if(m.type==='eliminated'){const p=MATCH.room&&MATCH.room.players.find(x=>x.id===m.id);if(p)p.status='out';if(m.id===MATCH.id)MATCH.eliminated=true;updateMatchHud();renderLobbyData()}if(m.type==='podium'){MATCH.podium=m.podium||[];recordMatchResult(m);MATCH.phase='finished';MATCH.active=false;st='podium';stopMusic();$('#pauseBtn').style.visibility='hidden';clearInterval(MATCH.countdownTimer);MATCH.countdownTimer=null;const c=document.getElementById('matchCountdown');if(c)c.remove();updateMatchHud();screen('podium')}if(m.type==='invite'){MATCH.invitation=m;renderLobbyData()}if(m.type==='closed'){clearInterval(MATCH.countdownTimer);MATCH.countdownTimer=null;{const c=document.getElementById('matchCountdown');if(c)c.remove()}MATCH.room=null;MATCH.active=false;MATCH.phase='';MATCH.message=m.message;updateMatchHud();renderLobbyData()}if(m.type==='error'){MATCH.message=m.message||'Não foi possível concluir.';renderLobbyData()}};s.onreconnect=()=>{MATCH.room=null;MATCH.phase='';MATCH.active=false;profile();renderLobbyData()};s.onclose=e=>{MATCH.socket=null;MATCH.message=e.reason||'Conexão multiplayer encerrada.';MATCH.room=null;MATCH.active=false;updateMatchHud();renderLobbyData()}}catch(er){MATCH.message=(er&&er.message)||'Não foi possível conectar ao multijogador.'}finally{MATCH.connecting=false;renderLobbyData()}}
function drawMultiplayer(){card.innerHTML='<h1>MULTIJOGADOR</h1><p>Corra sem pegar moedas. A última pessoa viva vence.</p><div class="msg" id="mpMessage"></div><div id="mpInvite"></div><section id="mpCurrent"></section><section class="mp-ranks"><h2>SEU HISTÓRICO DE SALAS</h2><div id="mpPersonal"></div><h2>RANKING DE VITÓRIAS</h2><div id="mpLeaderboard" class="mp-list"><p class="mp-empty">Carregando…</p></div></section><label>Pesquisar jogador ou sala<input id="mpSearch" type="text" maxlength="32" placeholder="Nome ou código da sala"></label><div class="mp-columns"><section><h2>JOGADORES ONLINE</h2><div id="mpUsers" class="mp-list"></div></section><section><h2>SALAS ABERTAS</h2><div id="mpRooms" class="mp-list"></div></section></div><div class="mp-create"><h2>Criar sala</h2><div class="row2"><label>Nome<input id="mpTitle" type="text" maxlength="32" placeholder="Sala NOCOIN"></label><label>Senha opcional<input id="mpCreatePassword" type="password" maxlength="24" placeholder="Sala privada"></label></div><button class="btn" id="mpCreate">CRIAR SALA</button></div><div class="mp-join"><h2>Entrar por código</h2><div class="row2"><label>Código<input id="mpCode" type="text" maxlength="8" placeholder="ABC123"></label><label>Senha<input id="mpPassword" type="password" maxlength="24" placeholder="Se a sala pedir"></label></div><button class="btn g" id="mpJoin">ENTRAR NA SALA</button></div><button class="btn g" id="mpBack">VOLTAR</button>';$('#mpBack').onclick=()=>screen(backTo);$('#mpCreate').onclick=()=>roomSend({type:'create',title:$('#mpTitle').value.trim(),password:$('#mpCreatePassword').value});$('#mpJoin').onclick=()=>roomSend({type:'join',code:$('#mpCode').value.trim(),password:$('#mpPassword').value});$('#mpSearch').oninput=renderLobbyData;ensureMultiplayerSocket();renderLobbyData();renderMatchStats();loadMatchLeaderboard()}
function renderLobbyData(){if(st!=='multiplayer')return;const q=(card.querySelector('#mpSearch')&&card.querySelector('#mpSearch').value||'').trim().toLowerCase(),msg=card.querySelector('#mpMessage');if(msg){msg.textContent=MATCH.message||(MATCH.connecting?'Conectando à sala…':'');msg.classList.toggle('err',!!MATCH.message)}const inv=card.querySelector('#mpInvite');if(inv)inv.innerHTML=MATCH.invitation?'<div class="mp-invite">'+roomAvatar(MATCH.invitation,30)+'<span><b>'+esc(MATCH.invitation.name)+'</b> convidou você para '+esc(MATCH.invitation.title)+' · '+esc(MATCH.invitation.code)+(MATCH.invitation.locked?' · peça a senha ao anfitrião':'')+'</span><button class="btn s" id="mpAccept">ENTRAR</button></div>':'';if(card.querySelector('#mpAccept'))card.querySelector('#mpAccept').onclick=()=>{const x=MATCH.invitation;$('#mpCode').value=x.code;if(!x.locked)roomSend({type:'join',code:x.code,password:''});else $('#mpPassword').focus();MATCH.invitation=null};const cur=card.querySelector('#mpCurrent');if(cur&&MATCH.room){const r=MATCH.room,owner=r.owner===MATCH.id,ps=r.players||[];cur.innerHTML='<div class="mp-room-card"><div class="mp-room-heading"><div><small>SALA '+esc(r.code)+'</small><b>'+esc(r.title)+'</b></div><button class="btn s" id="mpCopy">COPIAR CÓDIGO</button></div><div class="mp-roster">'+ps.map(p=>'<div class="mp-member '+(p.status==='out'?'out':'')+'">'+roomAvatar(p,34)+'<span><b>'+esc(p.name)+'</b><small>'+({alive:'NA CORRIDA',out:'ELIMINADO',ready:'PRONTO',finished:'FINALIZOU'}[p.status]||'NA SALA')+(p.distance?' · '+Math.floor(p.distance)+' m':'')+'</small></span>'+(p.status==='out'?'<i>×</i>':'')+'</div>').join('')+'</div>'+(owner&&r.phase==='lobby'?'<button class="btn" id="mpStart">COMEÇAR PARTIDA</button>':'')+(r.phase==='countdown'?'<p>Prepare-se. A corrida começa em instantes…</p>':'')+(r.phase==='running'?'<p>Quem pegar moeda está fora da partida.</p>':'')+'<button class="btn g" id="mpLeave">SAIR DA SALA</button></div>';if($('#mpCopy'))$('#mpCopy').onclick=async()=>{try{await navigator.clipboard.writeText(r.code);MATCH.message='Código copiado.'}catch(_){MATCH.message='Compartilhe o código '+r.code}renderLobbyData()};if($('#mpStart'))$('#mpStart').onclick=()=>roomSend({type:'start'});if($('#mpLeave'))$('#mpLeave').onclick=()=>{roomSend({type:'leave'});MATCH.room=null;MATCH.active=false;MATCH.phase='';MATCH.message='';updateMatchHud();renderLobbyData()}}else if(cur)cur.innerHTML='';const users=card.querySelector('#mpUsers'),rooms=card.querySelector('#mpRooms');if(users){const list=MATCH.users.filter(p=>p.id!==MATCH.id&&p.name.toLowerCase().includes(q));users.innerHTML=list.length?list.map(p=>'<div class="mp-person">'+roomAvatar(p,30)+'<span>'+esc(p.name)+'<small>'+(p.roomId?'em uma sala':'disponível')+'</small></span>'+(MATCH.room&&p.roomId!==MATCH.room.code?'<button class="btn s" data-invite="'+esc(p.id)+'">CONVIDAR</button>':'')+'</div>').join(''):'<p class="mp-empty">Ninguém encontrado.</p>';users.querySelectorAll('[data-invite]').forEach(b=>b.onclick=()=>roomSend({type:'invite',id:b.dataset.invite}))}if(rooms){const list=MATCH.rooms.filter(r=>r.phase==='lobby'&&(r.title.toLowerCase().includes(q)||r.code.toLowerCase().includes(q)||r.owner.toLowerCase().includes(q)));rooms.innerHTML=list.length?list.map(r=>'<button class="mp-room-row" data-room="'+esc(r.code)+'"><span><b>'+esc(r.title)+'</b><small>'+esc(r.owner)+' · '+r.players+'/'+r.max+' · '+(r.locked?'🔒 senha':'aberta')+'</small></span><kbd>'+esc(r.code)+'</kbd></button>').join(''):'<p class="mp-empty">Nenhuma sala aberta.</p>';rooms.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>{$('#mpCode').value=b.dataset.room;$('#mpPassword').focus()})}}
function renderMatchStats(){const box=card.querySelector('#mpPersonal');if(!box)return;let stat={matches:0,wins:0,best:0};try{stat=JSON.parse(localStorage.getItem('sr_mp_stats_v1')||'{}')[ACC&&ACC.uid||'device']||stat}catch(_){}box.innerHTML='<div class="mp-personal"><span>Partidas <b>'+stat.matches+'</b></span><span>Vitórias <b>'+stat.wins+'</b></span><span>Melhor distância <b>'+Math.floor(stat.best||0)+' m</b></span></div>'}
function recordMatchResult(message){const me=(MATCH.podium||[]).find(p=>p.id===MATCH.id);if(!me||MATCH.lastRecordedCode===message.room)return;MATCH.lastRecordedCode=message.room;const key=ACC&&ACC.uid||'device';let all={};try{all=JSON.parse(localStorage.getItem('sr_mp_stats_v1')||'{}')||{}}catch(_){}const stat=all[key]||{matches:0,wins:0,best:0};stat.matches++;if(me.rank===1)stat.wins++;stat.best=Math.max(stat.best,Number(me.distance)||0);all[key]=stat;try{localStorage.setItem('sr_mp_stats_v1',JSON.stringify(all))}catch(_){}void LocalDB.put('settings',{key:'mp-stats:'+key,value:stat,updatedAt:Date.now()});void api('/api/game/match-result','POST',{code:message.room,placement:me.rank,distance:me.distance})}
async function loadMatchLeaderboard(){const box=card.querySelector('#mpLeaderboard');if(!box)return;const r=await api('/api/game/match-leaderboard','GET');if(!card.querySelector('#mpLeaderboard'))return;const rows=Array.isArray(r.data)?r.data:[];box.innerHTML=rows.length?rows.map((p,i)=>'<div class="mp-person"><b>'+ (i+1)+'º</b>'+avatarHTML({avatar:avParse(p.avatar||0)},28)+'<span>'+esc(p.username)+'<small>'+p.wins+' vitórias · '+p.podiums+' pódios</small></span><kbd>'+Math.floor(p.best_distance||0)+' m</kbd></div>').join(''):'<p class="mp-empty">As vitórias das salas aparecerão aqui.</p>'}
function startCountdown(startAt){clearInterval(MATCH.countdownTimer);let el=document.getElementById('matchCountdown');if(!el){el=document.createElement('div');el.id='matchCountdown';document.body.appendChild(el)}let beat=-1,launched=false;const tick=()=>{const left=Math.max(0,startAt-Date.now()),n=Math.ceil(left/1000);if(left>0){el.textContent=String(n);el.className='match-countdown';if(n!==beat){beat=n;sfx(1250,.16,'sine',.12,2100)}}else{el.textContent='GO!';el.className='match-countdown go';if(!launched){launched=true;MATCH.goPending=true;sfx(740,.42,'sine',.16,1750);setTimeout(startMatchLocal,380);setTimeout(()=>{const c=document.getElementById('matchCountdown');if(c)c.remove()},900);clearInterval(MATCH.countdownTimer);MATCH.countdownTimer=null}}};tick();MATCH.countdownTimer=setInterval(tick,80)}
function startMatchLocal(){MATCH.goPending=false;setTimeout(()=>{const c=document.getElementById('matchCountdown');if(c)c.remove()},600);if(MATCH.started||!MATCH.room||MATCH.phase==='finished')return;MATCH.started=true;MATCH.active=true;MATCH.eliminated=false;MATCH.frames=[];MATCH.frameAt=0;MATCH.startedAt=performance.now();startGame(true)}
function updateMatchHud(){let h=document.getElementById('matchHud');if(!h){h=document.createElement('div');h.id='matchHud';document.body.appendChild(h)}const ps=MATCH.room&&MATCH.room.players||[];if(!MATCH.room||!ps.length||MATCH.phase==='lobby'||MATCH.phase==='finished'){h.innerHTML='';h.classList.remove('visible');return}h.innerHTML=ps.map(p=>'<div class="mh-player '+(p.status==='out'||p.status==='finished'?'out':'')+'" title="'+esc(p.name)+'">'+roomAvatar(p,34)+'<span>'+esc(p.name)+'</span>'+(p.status==='out'||p.status==='finished'?'<b>×</b>':'')+'</div>').join('');h.classList.add('visible')}
function drawPodium(){const ps=MATCH.podium.slice(0,3);card.innerHTML='<h1>CAMPEÕES!</h1><p>Sala '+esc(MATCH.room&&MATCH.room.code||'NOCOIN')+' · cada metro contou.</p><div class="crowd">'+Array.from({length:11},(_,i)=>'<canvas width="42" height="55" data-crowd="'+i+'"></canvas>').join('')+'</div><div class="podium-stage">'+ps.map((p,i)=>'<div class="podium-slot place-'+(i+1)+'"><div class="podium-figure"><canvas width="120" height="145" data-place="'+i+'"></canvas></div><b>'+ (i+1)+'º</b><span>'+esc(p.name)+'</span><small>'+Math.floor(p.distance||0)+' m</small><div class="podium-step">'+(i+1)+'</div></div>').join('')+'</div><button class="btn" id="podiumHome">VOLTAR AO JOGO</button>';card.querySelectorAll('[data-place]').forEach((c,i)=>drawChar(c.getContext('2d'),60,139,.76,CHARS[Number(ps[i]&&ps[i].character)||0]||CHARS[0],{run:0,yaw:0}));card.querySelectorAll('[data-crowd]').forEach((c,i)=>drawChar(c.getContext('2d'),21,54,.31,CHARS[(CFG.char+i*7)%CHARS.length],{run:0}));$('#podiumHome').onclick=()=>{roomSend({type:'leave'});MATCH.room=null;MATCH.active=false;MATCH.started=false;MATCH.phase='';MATCH.podium=[];MATCH.eliminated=false;updateMatchHud();screen('title')}}
// Loja de skins: grátis ou paga com as moedas que você junta nas corridas
let setTab = 0, shopSel = null;
function decorate() { // troca o botão VOLTAR por um ✕ fixo no topo do painel
  if (card.querySelector(':scope>.xbtn')) return;
  const bk = card.querySelector('[id^="bBack"]') || [...card.querySelectorAll('button')].find(b => /^\s*voltar\s*$/i.test(b.textContent)); if (!bk) return;
  bk.style.display = 'none'; const x = document.createElement('button'); x.type = 'button'; x.className = 'xbtn'; x.textContent = '✕'; x.setAttribute('aria-label', 'Fechar'); x.onclick = () => bk.click(); card.prepend(x);
}
new MutationObserver(decorate).observe(card, { childList: true });
function tabify() { // divide a tela de configurações em abas
  const kids = [...card.children], gs = [], map = { KeyTweak: '🎮 Teclas', Timer: '⏱ Timer', 'Câmera': '🖥 Tela', FPS: '🖥 Tela' }; let cur = null;
  for (const k of kids.slice(1)) {
    if (k.tagName === 'H2') { const n = map[k.textContent] || '🎨 Visual'; cur = gs.find(v => v.n === n); if (!cur) { cur = { n, els: [] }; gs.push(cur); } cur.els.push(k); }
    else if (cur && k.id !== 'bBack') cur.els.push(k);
  }
  if (setTab >= gs.length) setTab = 0;
  const bar = document.createElement('div'); bar.className = 'stb';
  const panes = gs.map((v, i) => { const p = document.createElement('div'); p.className = 'pane' + (i === setTab ? '' : ' hide'); v.els.forEach(e => p.append(e)); return p; });
  gs.forEach((v, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = v.n; b.className = i === setTab ? 'on' : ''; b.onclick = () => { setTab = i; [...bar.children].forEach((c, j) => c.classList.toggle('on', j === i)); panes.forEach((p, j) => p.classList.toggle('hide', j !== i)); }; bar.append(b); });
  kids[0].after(bar); bar.after(...panes);
}
function drawShop() {
  const P = c => LC.freeAll ? 0 : Math.round((c.price || 0) * LC.priceMul);
  if (shopSel === null || !CHARS[shopSel] || !skShow(shopSel)) shopSel = CFG.char;
  const own = i => CFG.owned.includes(i) || !P(CHARS[i]) || !!(CHARS[i].id && CFG.ownedIds.includes(CHARS[i].id)), sc = CHARS[shopSel], so = own(shopSel), cur = CFG.char === shopSel;
  let h = `<h1>SKINS</h1><p style="text-align:left">🪙 Suas moedas: <b>${CFG.inf ? '∞' : CFG.wallet}</b></p><div class="shPv"><canvas id="shBig" width="120" height="150"></canvas><div class="shInfo"><b>${esc(sc.n)}${sc.agile ? ' ⚡' : ''}</b><small>${cur ? 'Em uso' : so ? 'Sua' : '🪙 ' + P(sc)}</small><button class="btn${cur ? ' g' : ''}" id="shAct" type="button">${cur ? '✔ EM USO' : so ? 'USAR' : 'COMPRAR'}</button></div></div><div id="shopMsg" class="msg"></div><div class="shGrid">`;
  CHARS.forEach((c, i) => { if (!skShow(i)) return; h += `<button type="button" class="shIt${i === shopSel ? ' on' : ''}${own(i) ? ' own' : ''}${CFG.char === i ? ' cur' : ''}" data-i="${i}"><canvas width="60" height="76" data-i="${i}"></canvas>${esc(c.n)}<br><small>${own(i) ? 'Sua' : '🪙 ' + P(c)}</small></button>`; });
  card.innerHTML = h + '</div><button class="btn" id="bBack2">VOLTAR</button>';
  charAnimLoop($('#shBig'), () => sc, { fill: .9, base: .96 });
  card.querySelectorAll('.shIt canvas').forEach(k => drawChar(k.getContext('2d'), 30, 72, .58, CHARS[+k.dataset.i], { yaw: 0, run: 0 }));
  card.querySelectorAll('.shIt').forEach(b => b.onclick = () => { shopSel = +b.dataset.i; drawShop(); });
  $('#shAct').onclick = () => {
    const i = shopSel, c = CHARS[i]; if (!skShow(i)) return setMsg('#shopMsg', 'Esta skin não está disponível.', 0);
    if (!own(i)) { if (!CFG.inf && P(c) && CFG.wallet < P(c)) return setMsg('#shopMsg', 'Faltam ' + (P(c) - CFG.wallet) + ' moedas.', 0); if (!CFG.inf) CFG.wallet -= P(c) || 0; if (c.id) CFG.ownedIds.push(c.id); else CFG.owned.push(i); }
    CFG.char = i; CFG.charId = c.id || ''; save(); drawShop();
  };
  $('#bBack2').onclick = () => screen(backTo);
}
/* ---------- PERFIL E RANKING LOCAL ---------- */
const AVATARS = [['😎', '#ff7a1a', '#ff526f'], ['🐶', '#ffd21f', '#ff9a3c'], ['🐱', '#9b7bff', '#55a7ff'], ['🦊', '#ff7a1a', '#c8421c'], ['🐼', '#aab6d6', '#3b4676'], ['🦁', '#ffcf4a', '#d98a1a'], ['🐸', '#5de08a', '#1c9a55'], ['🤖', '#55e1ff', '#2f7bff'], ['👽', '#9dff6b', '#2fa84f'], ['🔥', '#ffb84a', '#ff3d5a'], ['💎', '#7be7ff', '#9b7bff'], ['👑', '#ffe36a', '#ff9a3c'],
  ['🐯', '#ffb347', '#e8562a'], ['🐵', '#c98a5b', '#6b3f26'], ['🐧', '#8fd3ff', '#2a4f9c'], ['🦄', '#ff9de0', '#8f6bff'], ['🐲', '#6be59a', '#157a5a'], ['🦅', '#d9b07a', '#5b3c20'], ['🐺', '#b9c3d6', '#4a5470'], ['🦈', '#6fc4ff', '#23508f'], ['🐙', '#ff8fb1', '#b0307a'], ['🦋', '#7be7ff', '#d36bff'], ['⚡', '#fff06a', '#ff8a1f'], ['🌟', '#ffe36a', '#ff6b9a'], ['🚀', '#a9b8ff', '#3a3fd1'], ['🎮', '#6fe0c6', '#2c4fd6'], ['🏆', '#ffe36a', '#c98a1a'], ['💀', '#c9cfe0', '#2b2f4a'], ['👻', '#f1f4ff', '#8f9cff'], ['🎧', '#ff6bd6', '#5a3cff'], ['🧢', '#ff5d5d', '#8f1f3a'], ['🛹', '#ffb84a', '#d1402a'], ['🍕', '#ffd06a', '#e0592a'], ['🍔', '#ffc76a', '#b3501f'], ['🌴', '#7cf0a0', '#0e8a6a'], ['🌈', '#ff9aa8', '#6bb8ff'], ['🏖️', '#ffe08a', '#3fb5e8'], ['⚽', '#e8ffe0', '#2f9e5a'], ['🐻', '#c08a5a', '#5b3a22'], ['🦖', '#8be86b', '#2f8a3a'], ['😈', '#ff5d7a', '#6b1f8f'], ['🥷', '#4a4f6a', '#14172e'], ['🧠', '#ff9ec4', '#c13a7a'], ['🎯', '#ff6b6b', '#ffe36a'], ['🍀', '#8dff9d', '#1f9a4a'], ['❄️', '#d6f3ff', '#5aa8ff'], ['☀️', '#fff17a', '#ff9a2a'], ['🌙', '#cfd5ff', '#3a3f8f'], ['💜', '#d9a8ff', '#6a2fd1'], ['🎸', '#ff8a5c', '#9a1f4a'], ['🏍️', '#ffb04a', '#2a2f4a'], ['🐍', '#9dff7a', '#2f7a3a']];
let ACC = null; try { ACC = JSON.parse(localStorage.getItem('rio_acct') || 'null'); if (ACC && typeof ACC.name !== 'string') ACC = null; } catch (e) {}
// Registro de todas as contas deste aparelho (para entrar de novo depois de sair)
let ACCTS = {}; try { ACCTS = JSON.parse(localStorage.getItem('rio_accts') || '{}') || {}; } catch (e) { ACCTS = {}; }
const acctKey = n => String(n).trim().toLowerCase();
const saveAcc = () => { try {
  if (ACC) {
    for (const k in ACCTS) if (ACCTS[k].uid === ACC.uid && k !== acctKey(ACC.name)) delete ACCTS[k];
    ACCTS[acctKey(ACC.name)] = { ...ACC };
    localStorage.setItem('rio_acct', JSON.stringify(ACC));
  } else localStorage.removeItem('rio_acct');
  localStorage.setItem('rio_accts', JSON.stringify(ACCTS)); LocalDB.put('settings', { key:'active-profile', value:ACC, updatedAt:Date.now() }); Object.values(ACCTS).forEach(p => p && p.uid && LocalDB.put('profiles', { ...p, updatedAt:Date.now() }));
} catch (e) {} };
if (ACC && !ACCTS[acctKey(ACC.name)]) saveAcc(); // conta antiga entra no registro
// senha: guardada só como hash (SHA-256 com sal); se o navegador não tiver crypto.subtle usa um hash simples de reserva
async function hashPw(pw, salt) {
  const txt = salt + ':' + pw;
  try { if (window.crypto && crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return 's:' + Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); } } catch (e) {}
  let h1 = 0x811c9dc5, h2 = 5381; for (let i = 0; i < txt.length; i++) { const c = txt.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) ^ c) >>> 0; }
  return 'f:' + h1.toString(16) + h2.toString(16);
}
const newSalt = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
async function checkPw(rec, pw) {
  if (!rec || !rec.h) return false;
  const h = await hashPw(pw, rec.salt || '');
  if (h.slice(0, 1) !== rec.h.slice(0, 1)) return false; // método diferente do usado ao criar
  return h === rec.h;
}
// Conta online: o app guarda só os dados públicos; a senha fica apenas no servidor
function useOnline(res, old) {
  const a = res.data.account, known = old || ACCTS[acctKey(a.name)];
  if (old && old.uid !== a.uid && CFG.ranks[old.uid]) { CFG.ranks[a.uid] = CFG.ranks[old.uid]; delete CFG.ranks[old.uid]; }
  else if (!old && !ACC && Array.isArray(CFG.rank) && CFG.rank.length) { CFG.ranks[a.uid] = CFG.rank.map(r => ({ t:r.t, s:r.s, d:0 })); CFG.rank = []; } // ranking antigo vira o da 1ª conta
  setToken(res.data.token);
  ACC = { uid:a.uid, name:a.name, avatar:avParse(a.avatar), banner:a.banner || '', photo:a.photo || '', provider:a.provider || 'online', online:true, best:(known && known.best) || 0, bs:(known && known.bs) || 0 };
  saveAcc(); save(); patchGR(); resetMultiplayer(); startCloudPresence();
}

// Reinicia a conexão do multijogador (ao entrar/sair de uma conta)
function resetMultiplayer() {
  try { if (MATCH.socket && MATCH.socket.close) MATCH.socket.close(); } catch (_) {}
  MATCH.socket = null; MATCH.connecting = false; MATCH.room = null; MATCH.active = false; MATCH.phase = ''; MATCH.message = '';
  if (ACC && ACC.online) ensureMultiplayerSocket();
}
// Confere no Firebase quem está logado de verdade neste aparelho e deixa o jogo igual (resolve "conta logada mas diz que não está")
async function reconcileSession() {
  let r; try { r = await fbApi('/api/auth/session', 'GET'); } catch (_) { return; }
  if (!r || r.down || !r.data) return;
  const u = r.data.user;
  if (u && !u.anonymous && u.exists) {
    const old = ACC; // o Firebase manda: se há uma conta real logada, ela vence qualquer conta antiga guardada no aparelho
    {
      if (old && old.uid !== u.uid && CFG.ranks[old.uid]) { CFG.ranks[u.uid] = CFG.ranks[old.uid]; delete CFG.ranks[old.uid]; }
      setToken('fb');
      ACC = { uid:u.uid, name:u.name, avatar:avParse(u.avatar), banner:u.banner || '', photo:u.photo || '', provider:u.provider || 'online', online:true, best:(old && old.best) || 0, bs:(old && old.bs) || 0 };
      saveAcc(); save(); patchGR();
    }
  } else if (u && !u.anonymous && !u.exists && !ACC) { // entrou com o Google mas ainda não escolheu nome/avatar
    accEdit = false; accDraft = { uid:u.uid, provider:'google', photo:u.photo || '', name:u.name || '', avatar:u.photo ? 'g' : 0 }; screen('account'); return;
  } else if (ACC && ACC.online) { // a sessão online acabou: pede para entrar de novo
    ACC.online = false; ACC.needLogin = true; setToken(''); saveAcc();
  }
}
// Entrar / criar conta com o Google (mesma lógica do jogo antigo, agora no banco principal)
async function googleFlow(msgSel) {
  setMsg(msgSel, 'Abrindo o Google…', 1);
  const r = await api('/api/auth/google', 'POST', {});
  if (r.down) return setMsg(msgSel, 'Sem conexão com o servidor. Tente de novo.', 0);
  if (r.data && r.data.redirecting) return;
  if (!r.data || !r.data.ok) return setMsg(msgSel, (r.data && r.data.error) || 'Não foi possível entrar com o Google.', 0);
  const a = r.data.account;
  if (r.data.needsProfile) { accEdit = false; accDraft = { uid:a.uid, provider:'google', photo:a.photo || '', name:a.name || '', avatar:a.photo ? 'g' : 0 }; screen('account'); return; }
  useOnline(r, null); loginName = ''; accDraft = null; accEdit = false; screen('title');
}
let accDraft = null, accEdit = false, rankTab = 'me', lastNc = 0, lastNcNew = false;
const myRank = () => ACC ? (CFG.ranks[ACC.uid] || (CFG.ranks[ACC.uid] = [])) : (Array.isArray(CFG.rank) ? CFG.rank : (CFG.rank = []));
/* Avatares criados no painel admin (cache gravado pelo carregador: localStorage "rio_live_av") */
const lsj = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
const LC = { notice:'', maint:false, maintMsg:'', speed0:800, speedMax:1800, gain:.02, priceMul:1, freeAll:false, rankOff:false, minWallet:0, coinMul:1 }
// Avisos e manutenção publicados no painel (live/status). Guardados pelo carregador em localStorage e atualizados a cada 60 s.
function applyStatus(x) { x = x || {}; LC.notice = x.noticeOn ? String(x.notice || '') : ''; LC.noticeImg = x.noticeOn ? String(x.noticeImg || '') : ''; LC.maint = !!x.maint; LC.maintMsg = String(x.maintMsg || ''); }
function noticeHTML() {
  let h = '';
  if (LC.maint) h += `<div class="notice" style="background:#5a1e2b;border:2px solid #ff5468;color:#fff">🛠️ <b>${esc(LC.maintMsg || 'Jogo em manutenção. Volte já!')}</b></div>`;
  if (LC.notice || LC.noticeImg) h += `<div class="notice">${LC.notice ? '📢 <span style="white-space:pre-wrap">' + esc(LC.notice) + '</span>' : ''}${/^(https?:\/\/|data:image\/)/i.test(LC.noticeImg || '') ? `<img src="${esc(LC.noticeImg)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="display:block;max-width:100%;max-height:160px;margin:8px auto 0;border-radius:12px">` : ''}</div>`;
  return h;
}
applyStatus(lsj('rio_live_status', {}));
setInterval(async () => { try { const r = await fbApi('/api/status', 'GET'); if (!r || r.down || !r.data) return; localStorage.setItem('rio_live_status', JSON.stringify(r.data)); applyStatus(r.data); const el = document.getElementById('liveNotice'); if (el) el.innerHTML = noticeHTML(); } catch (_) {} }, 60000);
for (const k of ['speed0', 'speedMax', 'gain', 'priceMul', 'minWallet', 'coinMul']) { LC[k] = +LC[k]; if (!isFinite(LC[k])) LC[k] = { speed0: 800, speedMax: 1800, gain: .02, priceMul: 1, minWallet: 0, coinMul: 1 }[k]; }
LC.speed0 = Math.min(3000, Math.max(200, LC.speed0)); LC.speedMax = Math.min(4000, Math.max(LC.speed0, LC.speedMax));
if (LC.minWallet > (CFG.wallet || 0)) CFG.wallet = LC.minWallet;
// Mantém as configurações remotas atualizadas sem exigir que cada jogador recarregue a página.
let CUSTOM_BN = lsj('rio_live_bn', []);
// quem pode usar: lista vazia = todo mundo; senão só os uids liberados pelo painel
const canUse = (it, uid) => !it.p || !it.p.length || it.p.some(x => x.u === (uid || (ACC && ACC.uid)));
const avLocked = v => { const c = CUSTOM_AV.find(c => avKey(c) === v); return !!c && !canUse(c); };
const bnFind = id => CUSTOM_BN.find(b => b.id === id);
const bnOk = (id, uid) => { const b = bnFind(id); return b && canUse(b, uid) ? id : ''; };
function bnStyle(id) {
  const b = id && bnFind(id); if (!b) return '';
  const img = /^https?:\/\/[^\s"'()]+$/i.test(b.u || '') ? `url('${b.u}') center/cover no-repeat,` : '';
  return `background:linear-gradient(90deg,rgba(16,19,48,.1),rgba(16,19,48,.55)),${img}${okCol(b.c1)};color:#fff;text-shadow:1px 1px 0 #000,-1px -1px 0 #000;border-color:#14172e`;
}
let CUSTOM_AV = []; try { CUSTOM_AV = JSON.parse(localStorage.getItem('rio_live_av') || '[]') || []; } catch (e) { CUSTOM_AV = []; }
const avKey = c => 'c_' + c.id, avParse = v => /^\d+$/.test(String(v)) ? +v : v;
const okCol = c => /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#3b4696';
function avatarHTML(a, px) {
  if (a && a.avatar === 'g' && a.photo) return `<img class="av" src="${esc(a.photo)}" referrerpolicy="no-referrer" style="width:${px}px;height:${px}px" alt="">`;
  const cv = a && typeof a.avatar === 'string' && a.avatar.startsWith('c_') ? CUSTOM_AV.find(c => avKey(c) === a.avatar) : null;
  if (cv) {
    const bg = cv.c2 ? `linear-gradient(145deg,${okCol(cv.c1)},${okCol(cv.c2)})` : okCol(cv.c1);
    if (cv.t === 'img' && /^https?:\/\//i.test(cv.u || '')) return `<img class="av" src="${esc(cv.u)}" referrerpolicy="no-referrer" onerror="this.style.opacity=.25" style="width:${px}px;height:${px}px;background:${bg}" alt="">`;
    return `<span class="av" style="width:${px}px;height:${px}px;font-size:${Math.round(px * .55)}px;background:${bg}">${esc(cv.e || '🙂')}</span>`;
  }
  const v = AVATARS[a && +a.avatar] || AVATARS[0];
  return `<span class="av" style="width:${px}px;height:${px}px;font-size:${Math.round(px * .55)}px;background:linear-gradient(145deg,${v[1]},${v[2]})">${v[0]}</span>`;
}
// envia o recorde (maior tempo sem moeda) para o rank global; só escreve quando há recorde novo ou perfil mudou
async function acctSync(t, sc) {
  if (!ACC) return;
  if (t > (ACC.best || 0)) { ACC.best = t; ACC.bs = sc; saveAcc(); }
}
function patchGR() {
  try { const c = JSON.parse(localStorage.getItem(GR_KEY) || 'null'); if (!c || !ACC) return; const x = c.list.find(r => r.uid === ACC.uid);
    if (x) { x.name = ACC.name; x.avatar = String(ACC.avatar); x.banner = ACC.banner || ''; x.photo = ACC.avatar === 'g' ? ACC.photo : ''; localStorage.setItem(GR_KEY, JSON.stringify(c)); } } catch (e) {}
}
function drawAccount() {
  const d = accDraft || (accDraft = ACC ? { ...ACC } : { name: '', avatar: 0, provider: 'local' }), viaGoogle = d.provider === 'google' && d.uid && !accEdit;
  const online = !!(ACC && ACC.online && accEdit && d.uid === ACC.uid), needPw = d.provider !== 'google', hasPw = online || !!(ACC && ACC.h && d.uid === ACC.uid); // conta manual sempre tem senha
  const ids = (d.photo ? ['g'] : []).concat(CUSTOM_AV.map(avKey), AVATARS.map((_, i) => i));
  card.innerHTML = `<h1>${accEdit ? 'EDITAR PERFIL' : viaGoogle ? 'PERSONALIZE SEU PERFIL' : 'CRIE SUA CONTA'}</h1>`
    + (!accEdit && !viaGoogle ? `<p>Crie sua conta para salvar seu perfil e disputar o ranking global.</p><button class="btn b" id="aGoogle" type="button">ENTRAR COM O GOOGLE</button><p style="text-align:center;font-size:12px;margin:12px 0 0">— ou crie manualmente —</p>` : '')
    + `<div style="text-align:center;margin-top:10px">${avatarHTML(d, 68)}</div><div class="bnCard" style="${bnStyle(d.banner)}">${avatarHTML(d, 44)}<span id="bnPvN">${esc(d.name || 'Seu nome')}</span></div>`
    + `<label>Nome de usuário<input type="text" id="aName" maxlength="14" autocomplete="username" autocapitalize="off" spellcheck="false" ${online && d.provider !== 'google' ? 'readonly' : ''} value="${esc(d.name)}" placeholder="3 a 14 caracteres"></label>${online && d.provider === 'google' ? '<p class="gnote" style="text-align:left;margin:-4px 0 6px">Conta Google: você pode escolher o nome que aparece no jogo e nos rankings.</p>' : ''}`
    + (needPw ? `${online ? '<label>Senha atual (só para trocar a senha)<input type="password" id="aPwCur" autocomplete="current-password" maxlength="72"></label>' : ''}<label>${hasPw ? 'Nova senha (deixe vazio para manter a atual)' : 'Senha'}<input type="password" id="aPw" autocomplete="new-password" maxlength="72" placeholder="mínimo 6 caracteres"></label><label>Repita a senha<input type="password" id="aPw2" autocomplete="new-password" maxlength="40" placeholder="repita a senha"></label>` : '')
    + `<h2>Escolha seu avatar</h2><div class="avgrid">${ids.map(i => `<button type="button" class="avb ${String(d.avatar) === String(i) ? 'on' : ''}${avLocked(i) ? ' lock' : ''}" data-av="${i}" aria-label="Avatar ${i === 'g' ? 'Google' : String(i).startsWith('c_') ? 'especial' : +i + 1}">${avatarHTML({ avatar: i, photo: d.photo }, 44)}</button>`).join('')}</div>`
    + (CUSTOM_BN.length ? `<h2>Banner do nome</h2><div class="bngrid"><button type="button" class="bnb ${d.banner ? '' : 'on'}" data-bn="" style="background:#101330">Nenhum</button>${CUSTOM_BN.map(b => `<button type="button" class="bnb ${d.banner === b.id ? 'on' : ''}${canUse(b, d.uid) ? '' : ' lock'}" data-bn="${esc(b.id)}" style="${bnStyle(b.id)}">${esc(b.n || 'Banner')}</button>`).join('')}</div>` : '')
    + `<div class="msg" id="aMsg"></div><button class="btn" id="aSave" type="button">${accEdit ? 'SALVAR' : 'CRIAR CONTA'}</button>`
    + (accEdit ? `<button class="btn g" id="aCancel" type="button">CANCELAR</button><button class="btn g" id="aOut" type="button">SAIR DA CONTA</button>` : (Object.keys(ACCTS).length ? `<button class="lnk" id="aToLogin" type="button">Já tenho conta · ENTRAR</button>` : '') + `<button class="btn g" id="aBack" type="button">VOLTAR</button>`);
  if ($('#aBack')) $('#aBack').onclick = () => { accDraft = null; screen('title'); };
  if ($('#aToLogin')) $('#aToLogin').onclick = () => { accDraft = null; screen('login'); };
  card.querySelectorAll('#aName,#aPw,#aPw2').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('#aSave').click(); });
  if ($('#aGoogle')) $('#aGoogle').onclick = () => googleFlow('#aMsg');
  $('#aName').oninput = () => { $('#bnPvN').textContent = $('#aName').value || 'Seu nome'; };
  card.querySelectorAll('[data-bn]').forEach(b => b.onclick = () => { const id = b.dataset.bn, it = bnFind(id); if (it && !canUse(it, d.uid)) return setMsg('#aMsg', '🔒 Banner exclusivo: só para quem foi liberado.', 0); d.name = $('#aName').value; d.banner = id; drawAccount(); });
  card.querySelectorAll('[data-av]').forEach(b => b.onclick = () => { d.name = $('#aName').value; const v = avParse(b.dataset.av); if (avLocked(v)) return setMsg('#aMsg', '🔒 Avatar exclusivo: só para quem foi liberado.', 0); d.avatar = v; drawAccount(); });
  $('#aSave').onclick = async () => {
    const name = $('#aName').value.trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N}_ .-]{3,14}$/u.test(name)) return setMsg('#aMsg', 'Nome de usuário: de 3 a 14 caracteres (letras, números, espaço, _ . -).', 0);
    const clash = ACCTS[acctKey(name)]; if (clash && clash.uid !== d.uid && !(ACC && clash.uid === ACC.uid)) return setMsg('#aMsg', 'Esse nome de usuário já existe neste aparelho. Escolha outro ou toque em “Já tenho conta”.', 0);
    let pw = '', pw2 = ''; if (needPw) { pw = $('#aPw').value; pw2 = $('#aPw2').value; const must = !hasPw;
      if (must && !pw) return setMsg('#aMsg', 'Crie uma senha para a sua conta.', 0);
      if (pw || must) { if (pw.length < 6) return setMsg('#aMsg', 'A senha precisa ter pelo menos 6 caracteres.', 0); if (pw !== pw2) return setMsg('#aMsg', 'As duas senhas não são iguais.', 0); } }
    if (online) { // editar conta online: o servidor é a fonte da verdade
      const body = { avatar:String(d.avatar), banner:bnOk(d.banner, d.uid), photo:String(d.avatar) === 'g' ? (d.photo || ACC.photo || '') : '' };
      if (d.provider === 'google') body.name = name;
      if (pw) { body.currentPassword = $('#aPwCur').value; body.newPassword = pw; }
      const r = await api('/api/auth/profile', 'PUT', body);
      if (r.down) return setMsg('#aMsg', 'Sem conexão com o servidor. Tente de novo.', 0);
      if (!r.data.ok) return setMsg('#aMsg', r.data.error || 'Não foi possível salvar.', 0);
      ACC = { ...ACC, name:r.data.account.name || ACC.name, avatar:avParse(r.data.account.avatar), banner:r.data.account.banner || '', photo:r.data.account.photo || ACC.photo || '' }; saveAcc(); patchGR(); accDraft = null; accEdit = false; screen('title'); return;
    }
    if (d.provider === 'google' && d.uid && !online) { // perfil novo de quem entrou com o Google
      const r = await api('/api/auth/google-profile', 'PUT', { name, avatar:String(d.avatar), banner:bnOk(d.banner, d.uid), photo:String(d.avatar) === 'g' ? (d.photo || '') : '' });
      if (r.down) return setMsg('#aMsg', 'Sem conexão com o servidor. Tente de novo.', 0);
      if (!r.data || !r.data.ok) return setMsg('#aMsg', (r.data && r.data.error) || 'Não foi possível salvar o perfil.', 0);
      useOnline(r, null); accDraft = null; accEdit = false; screen('title'); return;
    }
    if (!d.uid && d.provider !== 'google') { // conta nova: tenta criar no servidor; sem servidor, vira conta local
      const r = await api('/api/auth/register', 'POST', { username:name, password:pw, avatar:String(d.avatar), banner:bnOk(d.banner, ''), photo:String(d.avatar) === 'g' ? (d.photo || '') : '' });
      if (!r.down) {
        if (!r.data.ok) return setMsg('#aMsg', r.data.error || 'Não foi possível criar a conta.', 0);
        useOnline(r, null); accDraft = null; accEdit = false; acctSync(); screen('title'); return;
      }
    }
    let uid = d.uid; if (!uid) { uid = 'L' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); const first = !ACC;
      if (first && CFG.rank.length) { CFG.ranks[uid] = CFG.rank.map(r => ({ t: r.t, s: r.s, d: 0 })); CFG.rank = []; } } // ranking antigo vira o pessoal da 1ª conta
    const same = ACC && ACC.uid === uid;
    let salt = same ? ACC.salt : undefined, h = same ? ACC.h : undefined;
    if (needPw && pw) { salt = newSalt(); h = await hashPw(pw, salt); }
    ACC = { uid, name, avatar: d.avatar, banner: bnOk(d.banner, uid), photo: d.photo || '', provider: d.provider || 'local', best: (same ? ACC.best : 0) || 0, bs: (same ? ACC.bs : 0) || 0 };
    if (h) { ACC.salt = salt; ACC.h = h; }
    saveAcc(); save(); patchGR(); accDraft = null; accEdit = false; acctSync(); screen('title');
  };
  if ($('#aCancel')) $('#aCancel').onclick = () => { accDraft = null; accEdit = false; screen('title'); };
  if ($('#aOut')) $('#aOut').onclick = async () => {
    if (ACC && ACC.online) { await api('/api/auth/logout', 'POST'); setToken(''); }
    else if (ACC && !ACC.h && ACC.provider !== 'google') return setMsg('#aMsg', 'Defina uma senha e toque em SALVAR antes de sair, para conseguir entrar de novo.', 0);
    ACC = null; saveAcc(); resetMultiplayer(); accDraft = null; accEdit = false; screen(Object.keys(ACCTS).length ? 'login' : 'account');
  };
}
// Entrar de novo numa conta já criada (usuário + senha)
let loginName = '';
function drawLogin() {
  card.innerHTML = `<h1>ENTRAR</h1><p>Entre na sua conta com usuário e senha.</p>`
    + `<label>Nome de usuário<input type="text" id="lName" maxlength="14" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(loginName)}"></label>`
    + `<label>Senha<input type="password" id="lPw" autocomplete="current-password" maxlength="40"></label>`
    + `<div class="msg" id="lMsg"></div><button class="btn" id="lGo" type="button">ENTRAR</button><button class="btn b" id="lGoogle" type="button">ENTRAR COM O GOOGLE</button><button class="btn g" id="lNew" type="button">CRIAR NOVA CONTA</button><button class="btn g" id="lBack" type="button">VOLTAR</button>`;
  const go = async () => {
    const name = $('#lName').value.trim().replace(/\s+/g, ' '); loginName = name; const pw = $('#lPw').value;
    if (!name || !pw) return setMsg('#lMsg', 'Digite o usuário e a senha.', 0);
    const r = await api('/api/auth/login', 'POST', { username:name, password:pw });
    if (!r.down && r.data.ok) { useOnline(r, ACCTS[acctKey(name)]); loginName = ''; accDraft = null; accEdit = false; screen('title'); return; }
    if (!r.down && r.status !== 401) return setMsg('#lMsg', r.data.error || 'Não foi possível entrar.', 0); // bloqueada, banida etc.
    // senha não confere no servidor (ou servidor fora do ar): tenta uma conta local antiga deste aparelho
    const rec = ACCTS[acctKey(name)];
    if (!rec || !rec.h) return setMsg('#lMsg', r.down ? 'Sem conexão com o servidor. Tente de novo.' : 'Usuário ou senha incorretos.', 0);
    if (!(await checkPw(rec, pw))) return setMsg('#lMsg', 'Usuário ou senha incorretos.', 0);
    try { await api('/api/auth/logout', 'POST'); } catch (_) {} setToken('');
    ACC = { ...rec }; saveAcc(); patchGR(); loginName = ''; accDraft = null; accEdit = false; acctSync();
    if (!r.down) { // conta antiga: migra para o servidor se o nome estiver livre
      const m = await api('/api/auth/register', 'POST', { username:rec.name, password:pw, avatar:String(rec.avatar), banner:rec.banner || '', photo:String(rec.avatar) === 'g' ? (rec.photo || '') : '', legacyUid:rec.uid || '', best:rec.best || 0, bs:rec.bs || 0 });
      if (m.data && m.data.ok) useOnline(m, rec);
    }
    screen('title');
  };
  $('#lGoogle').onclick = () => googleFlow('#lMsg');
  $('#lGo').onclick = go; $('#lNew').onclick = () => { accDraft = null; accEdit = false; screen('account'); };
  $('#lBack').onclick = () => screen('title');
  card.querySelectorAll('#lName,#lPw').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') go(); });
  setTimeout(() => { const el = $(loginName ? '#lPw' : '#lName'); el && el.focus(); }, 0);
}
// Ranking global semanal (top 50 + posição de quem está fora do top)
const GR_KEY = 'rio_global_rank2';
async function loadGlobal() {
  try {
    const lb = await api('/api/leaderboard', 'GET');
    if (lb.down) return { ts:Date.now(), list:[], error:'Sem conexão com o servidor. Tente de novo em instantes.' };
    const d = lb.data || {};
    if (!Array.isArray(d.rows)) return { ts:Date.now(), list:[], error:'Resposta inesperada do ranking.' };
    if (d.errors && d.errors.length && !d.rows.length) return { ts:Date.now(), list:[], error:'Não foi possível ler o ranking (' + d.errors.join(' · ') + '). Se for permission-denied, publique as regras do Firestore (veja o LEIA-ME).' };
    return { ts:Date.now(), list:d.rows, mine:d.mine || null, period:d.period || periodNow(), legacy:!!d.legacy };
  } catch (_) { return { ts:Date.now(), list:[], error:'Não foi possível carregar o ranking.' }; }
}
async function renderGlobal() {
  const r = await loadGlobal(), box = $('#gBox'); if (!box || rankTab !== 'global') return;
  const hh = new Date(r.ts).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const next = fmtDateTime((r.period || periodNow()).next);
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + 'º';
  const face = x => avatarHTML({ avatar:avParse(x.avatar), photo:x.photo }, 30);
  const nm = x => esc(x.username || x.name || 'Jogador') + vBadge(x.verified) + clientBadges(x);
  const row = (x, i, mine) => '<div class="krow' + (mine ? ' me' : '') + '" style="' + bnStyle(x.banner) + '"><b>' + (mine ? x.pos + 'º' : medal(i)) + '</b>' + face(x) + '<span>' + nm(x) + '</span><kbd>' + fmtT(+x.best_no_coin || +x.t || 0) + '</kbd>'  + '</div>';
  let h = '<div class="rankNote">🔄 O ranking é <b>zerado toda quinta-feira</b>, em um horário aleatório, e recomeça do zero.<br>Próximo reset: <b>' + esc(next) + '</b></div>';
  if (r.error) h += '<div class="msg err">' + esc(r.error) + '</div>';
  else {
    h += r.list.length ? r.list.map((x, i) => row(x, i, false)).join('') : '<p>Ninguém no ranking desta semana ainda. Corra sem pegar moedas para aparecer por aqui!</p>';
    const inTop = ACC && r.list.some(x => x.user_id === ACC.uid);
    if (r.mine && !inTop) h += '<div class="rankGap">• • •</div><div class="rankMeTitle">SUA POSIÇÃO</div>' + row({ ...r.mine, username:r.mine.name, best_no_coin:r.mine.t }, 0, true);
    else if (ACC && ACC.online && !inTop && !r.legacy) h += '<div class="rankGap">• • •</div><p class="gnote">Você ainda não tem tempo nesta semana. Faça uma corrida sem pegar moedas!</p>';
    else if (!ACC || !ACC.online) h += '<p class="gnote">Entre numa conta online para aparecer no ranking.</p>';
    if (r.legacy) h += '<p class="gnote">Mostrando os recordes gerais (o ranking semanal será ativado quando as regras do banco forem atualizadas).</p>';
  }
  box.innerHTML = h + '<p class="gnote">Atualizado às ' + hh + '</p>';
}
async function openReplay(userId){try{const r=await api('/api/replay?user_id='+encodeURIComponent(userId),'GET'),data=r.data;if(r.down||r.status!==200)throw new Error((data&&data.error)||'Replay indisponível.');MATCH.replayError='';REPLAY_DATA=data;REPLAY_DATA.playAt=0;replayPlaying=true;backTo='rank';screen('replay')}catch(e){MATCH.replayError=e.message||'Replay não disponível para este jogador.';drawRank()}}
function drawReplay(){const frames=REPLAY_DATA&&REPLAY_DATA.frames||[];if(!frames.length){card.innerHTML='<h1>REPLAY</h1><p>Este jogador ainda não tem replay disponível.</p><button class="btn" id="replayBack">VOLTAR</button>';$('#replayBack').onclick=()=>screen('rank');return}const duration=frames[frames.length-1].t||1;card.innerHTML='<h1>REPLAY</h1><p>'+esc(REPLAY_DATA.username)+' · corrida recordista</p><canvas id="replayCanvas" width="640" height="340"></canvas><input id="replaySeek" type="range" min="0" max="'+duration+'" value="0"><div class="replay-controls"><button class="btn s" id="replayToggle">PAUSAR</button><span id="replayClock"></span></div><button class="btn g" id="replayBack">VOLTAR AO RANKING</button>';const seek=$('#replaySeek');seek.oninput=()=>{REPLAY_DATA.playAt=Number(seek.value);replayPlaying=false;$('#replayToggle').textContent='REPRODUZIR';drawReplayFrame()};$('#replayToggle').onclick=()=>{if((REPLAY_DATA.playAt||0)>=(REPLAY_DATA.frames[REPLAY_DATA.frames.length-1].t||0))REPLAY_DATA.playAt=0;replayPlaying=!replayPlaying;REPLAY_DATA.lastTick=performance.now();$('#replayToggle').textContent=replayPlaying?'PAUSAR':'REPRODUZIR';if(replayPlaying)drawReplayFrame()};$('#replayBack').onclick=()=>{cancelAnimationFrame(replayRAF);screen('rank')};REPLAY_DATA.lastTick=performance.now();drawReplayFrame()}
function drawReplayFrame(){if(st!=='replay'||!REPLAY_DATA)return;const cv=$('#replayCanvas');if(!cv)return;const fs=REPLAY_DATA.frames,g=cv.getContext('2d'),duration=fs[fs.length-1].t||1;if(replayPlaying){const now=performance.now();REPLAY_DATA.playAt=Math.min(duration,(REPLAY_DATA.playAt||0)+now-(REPLAY_DATA.lastTick||now));REPLAY_DATA.lastTick=now}const t=REPLAY_DATA.playAt||0;let i=0;while(i<fs.length-1&&fs[i+1].t<t)i++;const a=fs[i],b=fs[Math.min(i+1,fs.length-1)],mix=b.t===a.t?0:(t-a.t)/(b.t-a.t),lane=a.l+(b.l-a.l)*mix,jump=a.y+(b.y-a.y)*mix,w=cv.width,h=cv.height;g.clearRect(0,0,w,h);const sky=g.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#142958');sky.addColorStop(.6,'#72b9ed');sky.addColorStop(1,'#26344d');g.fillStyle=sky;g.fillRect(0,0,w,h);g.fillStyle='#1a2b48';for(let x=0;x<w;x+=56){const bh=32+(x*17%96);g.fillRect(x,132-bh,38,bh)}g.fillStyle='#424957';g.beginPath();g.moveTo(w*.31,117);g.lineTo(w*.69,117);g.lineTo(w*.96,h);g.lineTo(w*.04,h);g.closePath();g.fill();g.strokeStyle='#ffe36a';g.lineWidth=4;for(const x of [.39,.5,.61]){g.beginPath();g.moveTo(w*x,125);g.lineTo(w*(.5+(x-.5)*2),h);g.stroke()}g.strokeStyle='#d6ddeb';g.lineWidth=2;for(let y=148;y<h;y+=30){g.beginPath();g.moveTo(w*.12,y);g.lineTo(w*.88,y);g.stroke()}for(const o of a.o||[]){if(o.z< -80)continue;const s=1/(1+Math.max(-80,o.z)/850),x=w*.5+o.l*110*s,y=132+(h-150)*s,size=50*s;if(o.t==='coin'){g.fillStyle='#ffe36a';g.beginPath();g.arc(x,y-size*.4,Math.max(4,size*.22),0,Math.PI*2);g.fill();g.strokeStyle='#9b6723';g.lineWidth=2;g.stroke()}else{g.fillStyle=o.t==='steam'?'#60413a':o.t==='train'?'#526078':o.t==='bar'?'#db5367':'#e0ae3e';g.fillRect(x-size/2,y-size*.55,size,size*.52);g.strokeStyle='#17213a';g.lineWidth=Math.max(1,3*s);g.strokeRect(x-size/2,y-size*.55,size,size*.52)}}const char=CHARS[Number(a.c)||0]||CHARS[CFG.char];drawChar(g,w*.5+lane*75,h-68-jump*.2,1,char,{run:t/100});$('#replaySeek').value=Math.floor(t);$('#replayClock').textContent=fmtT(Math.floor(t/1000))+' · '+Math.floor(a.d)+' m';if(t>=duration){replayPlaying=false;$('#replayToggle').textContent='REPETIR'}if(replayPlaying)replayRAF=requestAnimationFrame(drawReplayFrame)}
const okLink = u => /^https:\/\/[^\s"'<>]{1,600}$/.test(u || '');
const okPhoto = u => /^data:image\/(jpeg|png|webp|gif);base64,/.test(u || '') || okLink(u);
const lsList = k => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const clientBadges = x => { const d = String(x && (x.device || x.platform) || '').toLowerCase(); const dev = d === 'mobile' || d === 'phone' ? '📱' : d === 'pc' || d === 'desktop' ? '🖥️' : ''; const flag = typeof (x && (x.countryFlag || x.flag)) === 'string' ? (x.countryFlag || x.flag) : ''; return dev || flag ? `<span class="sr-client-badges" title="Dispositivo e país informados pelo perfil">${dev} ${esc(flag)}</span>` : ''; };
const personRow = (x, tag, color) => `<a class="pRow" ${okLink(x.l) ? `href="${esc(x.l)}" target="_blank" rel="noopener noreferrer"` : ''}><span class="pAv" style="border-color:${color}">${okPhoto(x.p) ? `<img src="${esc(x.p)}" alt="" referrerpolicy="no-referrer">` : esc((x.n || '?')[0].toUpperCase())}</span><span class="pTx"><b>${esc(x.n || '')} ${clientBadges(x)}</b><small>${esc(x.pl || x.user || '')}</small></span><i style="color:${color}">${tag}</i></a>`;
function drawLives() {
  const L = lsList('rio_live_lives').filter(x => x && x.on && x.n);
  card.innerHTML = '<h1>AO VIVO</h1>' + (L.length ? '<p>Toque para assistir:</p><div class="pList">' + L.map(x => personRow(x, '🔴 AO VIVO', '#ff3b57')).join('') + '</div>' : '<p>Nenhuma live ao vivo no momento. Volte mais tarde!</p>') + '<button class="btn" id="bBackL" type="button">VOLTAR</button>';
  $('#bBackL').onclick = () => screen(backTo);
}
function drawPartners() {
  const L = lsList('rio_live_partners').filter(x => x && x.on !== false && x.n);
  card.innerHTML = '<h1>PARCEIROS</h1>' + (L.length ? '<p>Streamers parceiros do Subway Run:</p><div class="pList">' + L.map(x => personRow(x, '🤝 PARCEIRO', '#55a7ff')).join('') + '</div>' : '<p>Streamers parceiros do Subway Run. Em breve você vai poder acompanhar todos por aqui!</p>') + '<button class="btn" id="bBackP" type="button">VOLTAR</button>';
  $('#bBackP').onclick = () => screen(backTo);
}
/* Selo vermelho "NOVO" nos botões do menu: some depois que o jogador abre a opção ou 24 h depois da publicação */
const NEW_KEYS = { bShop: 'skins', bLive: 'lives', bPart: 'partners', bDonate: 'donate', bMus: 'music', bPoll: 'poll' };
const newSeen = () => { try { return JSON.parse(localStorage.getItem('sr_new_seen') || '{}') || {}; } catch (_) { return {}; } };
function applyNewBadges() {
  const seen = newSeen(), now = Date.now();
  for (const [id, key] of Object.entries(NEW_KEYS)) {
    const b = card.querySelector('#' + id); if (!b) continue;
    const old = b.querySelector('.newDot'); if (old) old.remove();
    const t = +NEWS[key] || 0;
    if (t && now - t < 86400000 && (seen[key] || 0) < t) {
      const i = document.createElement('i'); i.className = 'newDot'; i.textContent = 'NOVO'; b.appendChild(i);
      b.addEventListener('click', () => { const s2 = newSeen(); s2[key] = Math.max(s2[key] || 0, t); try { localStorage.setItem('sr_new_seen', JSON.stringify(s2)); } catch (_) {} }, { once: true });
    }
  }
}
setInterval(async () => { try { const r = await fbApi('/api/news', 'GET'); if (r && r.data && !r.down) { NEWS = r.data; try { localStorage.setItem('rio_live_news', JSON.stringify(NEWS)); } catch (_) {} if (st === 'title' || st === 'over') applyNewBadges(); } } catch (_) {} }, 60000);
/* Enquete publicada no painel: votar e ver a opção mais votada com porcentagens */
let pollTimer = 0;
async function drawPoll() {
  clearTimeout(pollTimer);
  const back = '<button class="btn g" id="bBackPoll" type="button">VOLTAR</button>', bind = () => { const b = $('#bBackPoll'); if (b) b.onclick = () => { clearTimeout(pollTimer); screen(backTo); }; };
  card.innerHTML = '<h1>ENQUETE</h1><p>Carregando…</p>' + back; bind();
  const paint = async () => {
    if (st !== 'poll') return;
    const r = await api('/api/poll', 'GET'), d = r.data || {}; if (st !== 'poll') return;
    const p = d.poll;
    if (!p) { card.innerHTML = '<h1>ENQUETE</h1><p>Nenhuma enquete no momento.</p>' + back; bind(); return; }
    const left = (+p.endsAt || 0) - Date.now(), over = left <= 0, counts = d.counts || [], total = d.total || 0, mine = d.mine;
    const logged = !!ACC, canVote = !over && mine == null && logged;
    const max = Math.max(0, ...counts), lead = total > 0 ? counts.indexOf(max) : -1;
    const mins = Math.ceil(left / 60000), when = over ? '🔒 Enquete encerrada' : '⏳ Termina em ' + (mins >= 1440 ? Math.ceil(mins / 1440) + ' dia(s)' : mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min');
    card.innerHTML = `<h1>ENQUETE</h1><p><b>${esc(p.question || '')}</b></p><p class="pMeta">${when} · ${total} voto(s)</p><div class="pOpts">${(p.options || []).map((o, i) => { const pc = total ? Math.round((counts[i] || 0) * 100 / total) : 0; return `<button type="button" class="pOpt${i === lead ? ' lead' : ''}${mine === i ? ' mine' : ''}" data-v="${i}" ${canVote ? '' : 'disabled'}><i style="width:${pc}%"></i><span>${i === lead ? '🏆 ' : ''}${esc(o)}${mine === i ? ' ✔' : ''}</span><b>${pc}%</b></button>`; }).join('')}</div>` +
      (lead >= 0 ? `<p class="pMeta">${over ? 'Vencedora' : 'Mais votada agora'}: <b>${esc(p.options[lead])}</b> (${Math.round(max * 100 / total)}%)</p>` : '') +
      (!over && mine != null ? '<p class="pMeta">Obrigado! Seu voto foi registrado.</p>' : '') + (!over && mine == null && !logged ? '<p class="pMeta">Entre numa conta para votar.</p><button class="btn b" id="pollLogin" type="button">ENTRAR / CRIAR CONTA</button>' : '') + '<div class="msg" id="pollMsg"></div>' + back; bind();
    if ($('#pollLogin')) $('#pollLogin').onclick = () => { clearTimeout(pollTimer); backTo = 'title'; screen(Object.keys(ACCTS).length ? 'login' : 'account'); };
    card.querySelectorAll('[data-v]').forEach(b => b.onclick = async () => { card.querySelectorAll('[data-v]').forEach(x => x.disabled = true); const rr = await api('/api/poll/vote', 'POST', { id: p.id, opt: +b.dataset.v }); if (rr.status !== 200) { const m = $('#pollMsg'); if (m) { m.textContent = (rr.data && rr.data.error) || 'Não foi possível votar.'; m.className = 'msg err'; } } paint(); });
    pollTimer = setTimeout(paint, 15000);
  };
  paint();
}

// Ranking GERAL (recorde de todos os tempos): mostra todas as contas com tempo, mesmo as que estão offline
async function renderGeral() {
  const box = $('#gBox'); if (!box || rankTab !== 'geral') return;
  let d = {}; try { const lb = await api('/api/leaderboard/all', 'GET'); if (lb.down) { box.innerHTML = '<div class="msg err">Sem conexão com o servidor. Tente de novo em instantes.</div>'; return; } d = lb.data || {}; } catch (_) { d = { errors:['falha'] }; }
  if (!box.isConnected || rankTab !== 'geral') return;
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + 'º';
  const face = x => avatarHTML({ avatar:avParse(x.avatar), photo:x.photo }, 30);
  const nm = x => esc(x.username || x.name || 'Jogador') + vBadge(x.verified) + clientBadges(x);
  const row = (x, i, mine) => '<div class="krow' + (mine ? ' me' : '') + '" style="' + bnStyle(x.banner) + '"><b>' + (mine ? x.pos + 'º' : medal(i)) + '</b>' + face(x) + '<span>' + nm(x) + '</span><kbd>' + fmtT(+x.best_no_coin || +x.t || 0) + '</kbd></div>';
  const rows = Array.isArray(d.rows) ? d.rows : [];
  let h = '<div class="rankNote">🏆 Melhor tempo <b>de todos os tempos</b> (sem pegar moedas). Todas as contas aparecem aqui, estando online ou não. Não zera.</div>';
  if (d.errors && d.errors.length && !rows.length) h += '<div class="msg err">Não foi possível ler o ranking (' + esc(d.errors.join(' · ')) + '). Se for permission-denied, publique as regras do Firestore (veja o LEIA-ME).</div>';
  else {
    h += rows.length ? rows.map((x, i) => row(x, i, false)).join('') : '<p>Ninguém no ranking geral ainda.</p>';
    const inTop = ACC && rows.some(x => x.user_id === ACC.uid);
    if (d.mine && !inTop) h += '<div class="rankGap">• • •</div><div class="rankMeTitle">SUA POSIÇÃO</div>' + row({ ...d.mine, username:d.mine.name, best_no_coin:d.mine.t }, 0, true);
    else if (!ACC || !ACC.online) h += '<p class="gnote">Entre numa conta online para ver a sua posição.</p>';
  }
  box.innerHTML = h + '<p class="gnote">Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) + '</p>';
}
// Recorde da conta guardado na nuvem (aparece no PESSOAL, em qualquer aparelho)
async function renderCloudRec() {
  const el = $('#cloudRec'); if (!el) return;
  let rec = null; try { const r = await api('/api/me/record', 'GET'); rec = r.data && r.data.rec; } catch (_) {}
  const el2 = $('#cloudRec'); if (!el2 || rankTab !== 'me') return;
  el2.innerHTML = rec && (rec.t > 0 || rec.s > 0)
    ? '☁️ <b>Recorde da sua conta:</b> ' + fmtT(rec.t) + (rec.s ? ' · ' + rec.s + ' pts' : '') + (rec.posAll ? '<br>Posição no GERAL: <b>' + rec.posAll + 'º</b>' : '') + (rec.posWeek ? ' · SEMANAL: <b>' + rec.posWeek + 'º</b>' : '')
    : '☁️ Sua conta ainda não tem tempo salvo. Corra sem pegar moedas!';
}
function drawRank() {
  let h = `<h1>RANKING NOCOIN</h1><p>Maior tempo seguido sem pegar moedas.</p><div class="tabs"><button type="button" data-rt="me" class="${rankTab === 'me' ? 'on' : ''}">PESSOAL</button><button type="button" data-rt="global" class="${rankTab === 'global' ? 'on' : ''}">SEMANAL</button><button type="button" data-rt="geral" class="${rankTab === 'geral' ? 'on' : ''}">GERAL</button></div>`;
  if (rankTab === 'global' && MATCH.replayError) h += '<div class="msg err">'+esc(MATCH.replayError)+'</div>';
  if (rankTab === 'me') {
    const L = myRank();
    h += (ACC && ACC.online ? '<div id="cloudRec" class="rankNote">☁️ Carregando seu recorde da conta…</div>' : '') + (ACC ? `<div class="krow on" style="${bnStyle(ACC.banner)}">${avatarHTML(ACC, 32)}<span><b>${esc(ACC.name)}</b></span></div>` : '') + (L.length ? L.map((r, i) => `<div class="krow"><b>${i + 1}º</b><span>${r.s} pts</span><kbd>${fmtT(r.t)}</kbd></div>`).join('') : '<p>Nenhuma corrida ainda. Corra sem pegar moedas!</p>') + '<button class="btn g" id="rClr" type="button">Limpar rank</button>';
  } else h += '<div id="gBox"><p>Carregando…</p></div>';
  card.innerHTML = h + '<button class="btn" id="bBack2" type="button">VOLTAR</button>';
  card.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { rankTab = b.dataset.rt; drawRank(); });
  if ($('#rClr')) $('#rClr').onclick = () => { if (confirm('Limpar seu rank pessoal? O rank global não é afetado.')) { if (ACC) CFG.ranks[ACC.uid] = []; else CFG.rank = []; save(); drawRank(); } };
  $('#bBack2').onclick = () => screen(backTo);
  if (rankTab === 'global') renderGlobal();
  if (rankTab === 'geral') renderGeral();
  if (rankTab === 'me') renderCloudRec();
}
const POS = [['tl', 'Topo esquerda'], ['tc', 'Topo centro'], ['tr', 'Topo direita'], ['bl', 'Baixo esquerda'], ['bc', 'Baixo centro'], ['br', 'Baixo direita'], ['free', 'Livre (arrastado)']];
function posSel(k, lab) { return `<label>${lab}<select data-pos="${k}">${POS.concat(k === 'keys' ? [['off', 'Ocultar']] : []).map(([v, n]) => `<option value="${v}" ${CFG.pos[k] === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`; }
function drawSettings() {
  const T = CFG.timer, F = CFG.fps;
  let h = `<h1>CONFIGURAÇÕES</h1><h2>KeyTweak</h2><p style="text-align:left;margin:0 0 6px">Toque em Alterar e aperte a nova tecla (Esc cancela). O padrão é WASD.</p>`;
  for (const id in ACT) h += `<div class="krow ${listening === id ? 'on' : ''}"><span>${ACT[id][0]}</span><kbd>${listening === id ? 'Aperte…' : CFG.keys[id].l}</kbd><button class="btn g s" data-k="${id}">Alterar</button></div>`;
  h += `<div class="msg" id="kMsg"></div><button class="btn g s" id="kRes" style="margin-top:4px">Restaurar teclas padrão</button>
  <h2>Timer</h2>
  <label style="display:flex;gap:8px;align-items:center;color:#14172e"><input type="checkbox" id="tShow" ${T.show ? 'checked' : ''}> Mostrar timer</label>
  <div class="row2"><label>Modo<select id="tMode"><option value="up">Crescente</option><option value="down">Regressivo</option></select></label>
  <label>Valor inicial (s)<input type="number" id="tVal" min="0" max="359999" step="1" value="${T.value}"></label></div>
  <label>Tamanho: <span id="tSz">${T.size}</span>px<input type="range" id="tSize" min="20" max="120" value="${T.size}"></label>
  <label>Cor<input type="color" id="tCol" value="${T.color}"></label>
  <label>Foto no fundo do timer (link da imagem)<input type="text" id="tImgUrl" placeholder="https://..." value="${T.img && !T.img.startsWith('data:') ? esc(T.img) : ''}"></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn g s" id="tImgGo">Usar link</button><label class="btn g s" style="margin:0;cursor:pointer;color:#14172e">Escolher foto<input type="file" accept="image/*" id="tFile" style="display:none"></label><button class="btn g s" id="tImgDel">Remover foto</button></div>
  <label>Tamanho do quadro da foto: <span id="tPadV">${T.pad}</span>px<input type="range" id="tPad" min="2" max="30" value="${T.pad}"></label>
  <label style="display:flex;gap:8px;align-items:center;color:#14172e"><input type="checkbox" id="nocoin" ${CFG.nocoin ? 'checked' : ''}> Modo Nocoin: pegar moeda para o timer</label>
  <label style="display:flex;gap:8px;align-items:center;color:#14172e"><input type="checkbox" id="snd" ${CFG.sound ? 'checked' : ''}> Som</label>
  <label style="display:flex;gap:8px;align-items:center;color:#14172e"><input type="checkbox" id="mus" ${CFG.music ? 'checked' : ''}> Música (original, sem direitos autorais)</label>
  <h2>Câmera</h2>
  <label style="display:flex;gap:8px;align-items:center;color:#14172e"><input type="checkbox" id="camF" ${CFG.camFollow !== false ? 'checked' : ''}> Câmera acompanha o personagem nos lados</label>
  <label>Esticar tela (largura): <span id="stV">${Math.round((CFG.stretch || 1) * 100)}</span>%<input type="range" id="stSz" min="60" max="160" value="${Math.round((CFG.stretch || 1) * 100)}"></label>
  <label style="display:flex;gap:8px;align-items:center;color:#14172e"><input type="checkbox" id="autoFS" ${CFG.autoFS ? 'checked' : ''}> Abrir o jogo em tela cheia ao jogar</label>
  <button class="btn g" id="bFs" type="button">⛶ TELA CHEIA AGORA</button>
  <h2>Gráficos e desempenho</h2>
  <label>Qualidade gráfica<select id="graphicsPreset"><option value="suave" ${CFG.graphics==='suave'?'selected':''}>Suave — prioriza FPS</option><option value="padrao" ${CFG.graphics==='padrao'?'selected':''}>Padrão — equilibrado</option><option value="ultra" ${CFG.graphics==='ultra'?'selected':''}>Ultra — mais efeitos</option><option value="ultramax" ${CFG.graphics==='ultramax'?'selected':''}>Ultra Max — máximo visual</option></select></label>
  <p style="font-size:12px;text-align:left">Ultra Max pode reduzir o FPS em celulares mais fracos. A escolha é salva neste aparelho.</p>
  <h2>FPS</h2>
  <label style="display:flex;gap:8px;align-items:center;color:#14172e"><input type="checkbox" id="fShow" ${F.show ? 'checked' : ''}> Mostrar FPS na tela</label>
  <label>Tamanho: <span id="fSz">${F.size}</span>px<input type="range" id="fSize" min="12" max="80" value="${F.size}"></label>
  <label>Cor<input type="color" id="fCol" value="${F.color}"></label>
  <label>Foto no fundo do FPS (link da imagem)<input type="text" id="fImgUrl" placeholder="https://..." value="${F.img && !F.img.startsWith('data:') ? esc(F.img) : ''}"></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn g s" id="fImgGo" type="button">Usar link</button><label class="btn g s" style="margin:0;cursor:pointer;color:#14172e">Escolher foto<input type="file" accept="image/*" id="fFile" style="display:none"></label><button class="btn g s" id="fImgDel" type="button">Remover foto</button></div>
  <label>Tamanho do quadro da foto: <span id="fPadV">${F.pad}</span>px<input type="range" id="fPad" min="2" max="30" value="${F.pad}"></label>
  <div class="msg" id="fMsg"></div>
  <h2>Posição na tela</h2>${posSel('fps', 'FPS')}${posSel('timer', 'Timer')}${posSel('coins', 'Contador de moedas')}${posSel('score', 'Pontos')}${posSel('keys', 'Teclas WASD (também funcionam por toque)')}
  <label>Tamanho das teclas: <span id="kbV">${CFG.keysz}</span>px<input type="range" id="kbSz" min="28" max="64" value="${CFG.keysz}"></label>
  <label>Transparência das teclas<input type="range" id="kbOp" min="20" max="100" value="${Math.round(CFG.keyop * 100)}"></label>
  <h2>Personalização visual</h2>
  <label>Cor das moedas<input type="color" id="coinColor" value="${CFG.coinColor}"></label>
  <p style="text-align:left;margin:2px 0 8px">Escolha a cor das moedas que aparecem durante a corrida.</p>
  <h3 style="margin:10px 0 6px">Imagem personalizada da moeda</h3>
  <label>Nome da imagem da moeda<input type="text" id="coinImageName" maxlength="40" value="${esc(CFG.coinImageName)}" placeholder="Ex.: Moeda dourada"></label>
  <label>Escolher imagem para a moeda<input type="file" id="coinFile" accept="image/*"></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><button class="btn g s" id="coinRemove" type="button">Remover imagem da moeda</button><span style="font-size:12px;align-self:center">${CFG.coinImg ? 'Imagem da moeda aplicada' : 'Usando moeda padrão'}</span></div>
  <h3 style="margin:10px 0 6px">Mochila nas costas do personagem</h3>
  <label>Nome da imagem da mochila<input type="text" id="backpackImageName" maxlength="40" value="${esc(CFG.backpackImageName)}" placeholder="Ex.: Mochila neon"></label>
  <label>Escolher imagem para a mochila<input type="file" id="backpackFile" accept="image/*"></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><button class="btn g s" id="backpackRemove" type="button">Remover imagem da mochila</button><span style="font-size:12px;align-self:center">${CFG.backpackImg ? 'Imagem da mochila aplicada' : 'Usando mochila padrão'}</span></div>
  <label>Tamanho da imagem da mochila: <span id="bpV">${CFG.bpSize.toFixed(1)}</span>×<input type="range" id="bpSz" min="50" max="300" value="${Math.round(CFG.bpSize * 100)}"></label>
  <h3 style="margin:14px 0 6px">Imagem na frente da pulseira</h3>
  <label>Nome da imagem da pulseira<input type="text" id="wristImageName" maxlength="40" value="${esc(CFG.wristImageName || 'Pulseira personalizada')}" placeholder="Ex.: Pulseira neon"></label>
  <label>Escolher imagem para a frente da pulseira<input type="file" id="wristFile" accept="image/*"></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><button class="btn g s" id="wristRemove" type="button">Remover imagem da pulseira</button><span style="font-size:12px;align-self:center">${CFG.wristImg ? 'Imagem da pulseira aplicada' : 'Sem imagem personalizada'}</span></div>
  <p style="text-align:left;margin:2px 0 8px">As imagens são guardadas neste navegador. Use imagens leves de até 5 MB.</p>
  <label>Imagem personalizada no céu<input type="file" id="skyFile" accept="image/*"></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><button class="btn g s" id="skyRemove">Remover imagem do céu</button><span style="font-size:12px;align-self:center">${CFG.skyImg ? 'Imagem aplicada' : 'Usando céu do mapa'}</span></div>
  <p style="text-align:left;margin:2px 0 8px">A imagem é guardada neste navegador. Use uma imagem leve para não ocupar muito armazenamento.</p>
  <label>Mapa<select id="mapSel" value="${CFG.map}">${MAPS.map((m, i) => `<option value="${i}" ${+CFG.map===i?'selected':''}>${m.n}</option>`).join('')}</select></label>
  <label>Rastros<select id="trailSel"><option value="auto">Cor do personagem</option><option value="rainbow">Arco-íris</option><option value="fire">Fogo</option><option value="neon">Neon</option><option value="ice">Gelo</option><option value="gold">Ouro</option><option value="toxic">Tóxico</option><option value="off">Desligado</option></select></label>
  <h2>Telão voador (YouTube)</h2>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="tvOn" ${CFG.tv.on ? 'checked' : ''}> Mostrar telão</label>
  <label>Link do vídeo do YouTube<input type="text" id="tvUrl" inputmode="url" placeholder="https://youtu.be/..."></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"><button class="btn b s" id="tvAdd" type="button">Adicionar vídeo</button><button class="btn g s" id="tvClear" type="button">Limpar lista</button></div>
  ${CFG.tv.vids.length ? CFG.tv.vids.map((x, i) => `<div class="krow"><span>${i + 1}. ${x.v ? 'Vídeo ' + esc(x.v) : 'Playlist ' + esc(x.l.slice(0, 12)) + '…'}</span><button class="btn g s" data-tvdel="${i}" type="button">Remover</button></div>`).join('') : '<p style="text-align:left;margin:2px 0 6px">Nenhum vídeo ainda. Cole um link acima. Vários vídeos tocam em sequência e repetem.</p>'}
  <label>Volume do telão: <span id="tvVolV">${CFG.tv.vol}</span>%<input type="range" id="tvVol" min="0" max="100" value="${CFG.tv.vol}"></label>
  <div class="msg" id="tvMsg"></div>
  <button class="btn b" id="bMove">ARRASTAR NA TELA</button><p style="text-align:left;margin:4px 0">Arraste o timer, o FPS, as moedas, os pontos, as teclas, o botão de pausa e o telão. Use a bolinha amarela no canto de cada item para mudar o tamanho.</p>
  <div class="msg" id="tMsg"></div>
  <button class="btn ${CFG.inf ? '' : 'g'}" id="bInf">MOEDAS INFINITAS: ${CFG.inf ? 'LIGADO' : 'DESLIGADO'}</button><p style="text-align:left;margin:4px 0">Ligado: suas moedas ficam infinitas para comprar skins. Desligado: volta para as moedas que você tinha.</p>
  <button class="btn" id="bBack">VOLTAR</button>`;
  card.innerHTML = h; $('#tMode').value = T.mode; tabify();
  card.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { listening = listening === b.dataset.k ? null : b.dataset.k; drawSettings(); });
  $('#kRes').onclick = () => { CFG.keys = DEF().keys; listening = null; save(); drawSettings(); setMsg('#kMsg', 'Teclas restauradas.', 1); };
  $('#tShow').onchange = e => { T.show = e.target.checked; save(); hud(); };
  $('#tMode').onchange = e => { T.mode = e.target.value; save(); hud(); };
  $('#tVal').onchange = e => { const n = Number(e.target.value); if (e.target.value === '' || !Number.isInteger(n) || n < 0 || n > 359999) return setMsg('#tMsg', 'Digite um número inteiro de 0 a 359999.', 0); T.value = n; save(); setMsg('#tMsg', 'Valor salvo.', 1); hud(); };
  $('#tSize').oninput = e => { T.size = +e.target.value; $('#tSz').textContent = T.size; save(); hud(); };
  $('#tCol').oninput = e => { T.color = e.target.value; save(); hud(); };
  $('#nocoin').onchange = e => { CFG.nocoin = e.target.checked; save(); };
  if ($('#graphicsPreset')) $('#graphicsPreset').onchange = e => { CFG.graphics=e.target.value; save(); resize(); };
  $('#trailSel').value = CFG.trail; $('#trailSel').onchange = e => { CFG.trail = e.target.value; save(); };
  $('#coinColor').oninput = e => { CFG.coinColor = e.target.value; save(); };
  $('#coinImageName').onchange = e => { CFG.coinImageName = e.target.value.trim().slice(0,40) || 'Moeda personalizada'; save(); };
  $('#backpackImageName').onchange = e => { CFG.backpackImageName = e.target.value.trim().slice(0,40) || 'Mochila personalizada'; save(); };
  $('#coinFile').onchange = e => { const f=e.target.files && e.target.files[0]; if(f) importSmallImage(f,'coin',(ok,msg)=>setMsg('#tMsg',msg,ok)); };
  $('#backpackFile').onchange = e => { const f=e.target.files && e.target.files[0]; if(f) importSmallImage(f,'backpack',(ok,msg)=>setMsg('#tMsg',msg,ok)); };
  $('#coinRemove').onclick = () => { CFG.coinImg=''; loadNamedImage('', 'coin'); save(); drawSettings(); };
  $('#backpackRemove').onclick = () => { CFG.backpackImg=''; loadNamedImage('', 'backpack'); save(); drawSettings(); };
  $('#wristImageName').onchange = e => { CFG.wristImageName = e.target.value.trim().slice(0,40) || 'Pulseira personalizada'; save(); };
  $('#wristFile').onchange = e => { const f=e.target.files && e.target.files[0]; if(f) importSmallImage(f,'wrist',(ok,msg)=>setMsg('#tMsg',msg,ok)); };
  $('#wristRemove').onclick = () => { CFG.wristImg=''; loadNamedImage('', 'wrist'); save(); drawSettings(); };
  $('#skyFile').onchange = e => { const f = e.target.files && e.target.files[0]; if (!f) return; if (!f.type.startsWith('image/')) return setMsg('#tMsg', 'Escolha um arquivo de imagem.', 0); if (f.size > 5 * 1024 * 1024) return setMsg('#tMsg', 'A imagem precisa ter até 5 MB.', 0); const rd = new FileReader(); rd.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1200 / Math.max(im.width, im.height)), c2 = document.createElement('canvas'); c2.width = Math.max(1, Math.round(im.width * k)); c2.height = Math.max(1, Math.round(im.height * k)); c2.getContext('2d').drawImage(im, 0, 0, c2.width, c2.height); CFG.skyImg = c2.toDataURL('image/jpeg', .78); loadSkyImage(CFG.skyImg); try { save(); setMsg('#tMsg', 'Imagem aplicada ao céu!', 1); } catch (_) { setMsg('#tMsg', 'Imagem aplicada, mas não foi possível salvar as configurações.', 0); } }; im.onerror = () => setMsg('#tMsg', 'Não foi possível abrir essa imagem.', 0); im.src = rd.result; }; rd.readAsDataURL(f); };
  $('#skyRemove').onclick = () => { CFG.skyImg = ''; loadSkyImage(''); save(); drawSettings(); setMsg('#tMsg', 'Imagem do céu removida.', 1); };
  $('#bMove').onclick = startEdit;
  $('#bpSz').oninput = e => { CFG.bpSize = e.target.value / 100; $('#bpV').textContent = CFG.bpSize.toFixed(1); save(); };
  $('#tvOn').onchange = e => { CFG.tv.on = e.target.checked; save(); };
  $('#tvAdd').onclick = () => {
    const p = ytParse($('#tvUrl').value); if (!p) return setMsg('#tvMsg', 'Link inválido. Cole um link de vídeo do YouTube (youtube.com ou youtu.be).', 0);
    if (p.l) CFG.tv.vids = [p]; else { if (CFG.tv.vids.some(x => x.v === p.v)) return setMsg('#tvMsg', 'Esse vídeo já está na lista.', 0); if (CFG.tv.vids.length >= 20) return setMsg('#tvMsg', 'Máximo de 20 vídeos.', 0); CFG.tv.vids = CFG.tv.vids.filter(x => x.v).concat([p]); }
    save(); drawSettings(); setMsg('#tvMsg', p.l ? 'Playlist adicionada (ela substitui a lista).' : 'Vídeo adicionado!', 1);
  };
  $('#tvClear').onclick = () => { CFG.tv.vids = []; save(); drawSettings(); };
  card.querySelectorAll('[data-tvdel]').forEach(b => b.onclick = () => { CFG.tv.vids.splice(+b.dataset.tvdel, 1); save(); drawSettings(); });
  $('#tvVol').oninput = e => { CFG.tv.vol = +e.target.value; $('#tvVolV').textContent = CFG.tv.vol; save(); tvVol(); };
  $('#mapSel').value = CFG.map; $('#mapSel').onchange = e => { CFG.map = +e.target.value; save(); };
  $('#mus').onchange = e => { CFG.music = e.target.checked; save(); if (!CFG.music) stopMusic(); };
  $('#kbSz').oninput = e => { CFG.keysz = +e.target.value; $('#kbV').textContent = CFG.keysz; save(); };
  $('#kbOp').oninput = e => { CFG.keyop = e.target.value / 100; save(); };
  $('#bInf').onclick = () => { CFG.inf = !CFG.inf; save(); drawSettings(); };
  $('#tImgGo').onclick = () => {
    const u = $('#tImgUrl').value.trim(); if (!/^https?:\/\/\S+$/i.test(u)) return setMsg('#tMsg', 'Cole um link que comece com http:// ou https://', 0);
    setMsg('#tMsg', 'Carregando…', 1); const im = new Image();
    im.onload = () => { T.img = u; save(); setMsg('#tMsg', 'Foto aplicada.', 1); };
    im.onerror = () => setMsg('#tMsg', 'Não foi possível carregar o link. Salve a imagem no aparelho e use "Escolher foto".', 0); im.src = u;
  };
  $('#tFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { const im = new Image();
      im.onload = () => { const k = Math.min(1, 200 / Math.max(im.width, im.height)), c2 = document.createElement('canvas'); c2.width = Math.round(im.width * k); c2.height = Math.round(im.height * k); c2.getContext('2d').drawImage(im, 0, 0, c2.width, c2.height); T.img = c2.toDataURL('image/jpeg', .8); save(); setMsg('#tMsg', 'Foto aplicada.', 1); };
      im.onerror = () => setMsg('#tMsg', 'Esse arquivo não é uma imagem válida.', 0); im.src = rd.result; };
    rd.readAsDataURL(f);
  };
  $('#tImgDel').onclick = () => { T.img = ''; $('#tImgUrl').value = ''; save(); setMsg('#tMsg', 'Foto removida.', 1); };
  $('#tPad').oninput = e => { T.pad = +e.target.value; $('#tPadV').textContent = T.pad; save(); };
  $('#autoFS').onchange = e => { CFG.autoFS = e.target.checked; save(); };
  $('#stSz').oninput = e => { CFG.stretch = e.target.value / 100; $('#stV').textContent = e.target.value; save(); };
  $('#camF').onchange = e => { CFG.camFollow = e.target.checked; save(); };
  $('#fShow').onchange = e => { F.show = e.target.checked; save(); };
  $('#fSize').oninput = e => { F.size = +e.target.value; $('#fSz').textContent = F.size; save(); };
  $('#fCol').oninput = e => { F.color = e.target.value; save(); };
  $('#fPad').oninput = e => { F.pad = +e.target.value; $('#fPadV').textContent = F.pad; save(); };
  $('#fImgGo').onclick = () => {
    const u = $('#fImgUrl').value.trim(); if (!/^https?:\/\/\S+$/i.test(u)) return setMsg('#fMsg', 'Cole um link que comece com http:// ou https://', 0);
    setMsg('#fMsg', 'Carregando…', 1); const im = new Image();
    im.onload = () => { F.img = u; save(); setMsg('#fMsg', 'Foto aplicada.', 1); };
    im.onerror = () => setMsg('#fMsg', 'Não foi possível carregar o link. Salve a imagem no aparelho e use "Escolher foto".', 0); im.src = u;
  };
  $('#fFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { const im = new Image();
      im.onload = () => { const k = Math.min(1, 200 / Math.max(im.width, im.height)), c2 = document.createElement('canvas'); c2.width = Math.round(im.width * k); c2.height = Math.round(im.height * k); c2.getContext('2d').drawImage(im, 0, 0, c2.width, c2.height); F.img = c2.toDataURL('image/jpeg', .8); save(); setMsg('#fMsg', 'Foto aplicada.', 1); };
      im.onerror = () => setMsg('#fMsg', 'Esse arquivo não é uma imagem válida.', 0); im.src = rd.result; };
    rd.readAsDataURL(f);
  };
  $('#fImgDel').onclick = () => { F.img = ''; $('#fImgUrl').value = ''; save(); setMsg('#fMsg', 'Foto removida.', 1); };
  $('#snd').onchange = e => { CFG.sound = e.target.checked; save(); };
  card.querySelectorAll('[data-pos]').forEach(s => s.onchange = () => { CFG.pos[s.dataset.pos] = s.value; save(); });
  $('#bBack').onclick = () => { listening = null; screen(prev); };
}
function setMsg(s, t, ok) { const e = $(s); e.textContent = t; e.className = 'msg ' + (ok ? 'ok' : 'err'); }

/* ---------- 3. JOGO ---------- */
const RAMP_LEN = 440; // comprimento da rampa que sobe até o teto do trem
const CAMZ = 1.2; // UPDATE 9: zoom da câmera (1 = antigo; maior = mais perto do personagem, como no Subway Surfers)
const Z0 = 330, ZMAX = 5200, TH = 150, COLORS = ['#e8453c', '#27b4a3', '#2f7bff', '#ff7a1a'];
// Personagens: hood = blusa, pants = calça, cap = boné/cabelo/mochila, acc = acessório (cap, beanie, phones, spikes)
const CHARS = [
  { n: 'Jake', hood: '#2f7bff', pants: '#1f3d99', cap: '#ffd21f', skin: '#e8a979', acc: 'cap' },
  { n: 'Tricky', hood: '#e8453c', pants: '#3a2a2a', cap: '#ffd21f', skin: '#c98a5b', acc: 'beanie' },
  { n: 'Fresh', hood: '#a855f7', pants: '#3b1f6b', cap: '#ff5c8a', skin: '#8d5a3b', acc: 'phones' },
  { price: 120, n: 'Yutani', hood: '#27b4a3', pants: '#146b62', cap: '#ff7a1a', skin: '#f0c39a', acc: 'cap' },
  { price: 200, n: 'Spike', hood: '#ff7a1a', pants: '#5a2f10', cap: '#2ee59d', skin: '#e8a979', acc: 'spikes' }
];
// Sete skins DRIP originais: streetwear internacional e referências de cores de países, sem marcas registradas.
CHARS.push(
  { price: 350, n: 'Mandrake BR', hood: '#111827', sleeve: '#f2c94c', pants: '#171923', cap: '#18864b', skin: '#9b6041', acc: 'cap', shoe: '#f2c94c', baggy: true, chain: '#f2c94c', flag: 'br', capDir: 'back', detail: '#f2c94c' },
  { price: 400, n: 'Paris Drip', hood: '#172554', sleeve: '#f7f7fb', pants: '#172554', cap: '#e23b4b', skin: '#d59b75', acc: 'beanie', shoe: '#f7f7fb', baggy: true, chain: '#d8dce8', flag: 'fr', capDir: 'front', detail: '#e23b4b' },
  { price: 450, n: 'NYC Oversize', hood: '#20242e', sleeve: '#b8c1d1', pants: '#242832', cap: '#e8edf6', skin: '#8d5a3b', acc: 'cap', shoe: '#e8edf6', baggy: true, chain: '#c9a84c', capDir: 'back', detail: '#55a7ff' },
  { price: 500, n: 'London Street', hood: '#263238', sleeve: '#e34b58', pants: '#111827', cap: '#111827', skin: '#e8b28c', acc: 'beanie', shoe: '#e34b58', baggy: true, chain: '#c9a84c', flag: 'uk', capDir: 'front', detail: '#e34b58' },
  { price: 550, n: 'Tokyo Cyber', hood: '#101827', sleeve: '#ff4fc8', pants: '#202a44', cap: '#4ff0ff', skin: '#e8b28c', acc: 'phones', shoe: '#4ff0ff', baggy: true, chain: '#ff4fc8', capDir: 'back', detail: '#4ff0ff' },
  { price: 600, n: 'Trap Star', hood: '#171717', sleeve: '#d6b56d', pants: '#090909', cap: '#d6b56d', skin: '#8d5a3b', acc: 'visor', shoe: '#f2f2f2', baggy: true, chain: '#d6b56d', capDir: 'front', detail: '#d6b56d' },
  { price: 650, n: 'Ice Drip', hood: '#e8f7ff', sleeve: '#8edcff', pants: '#b8e8f8', cap: '#ffffff', skin: '#c98a5b', acc: 'beanie', shoe: '#ffffff', baggy: true, chain: '#9be8ff', capDir: 'back', detail: '#9be8ff' }
);

// Skins novas (price = custo em moedas; sem price = grátis)
CHARS.push(
  { n: 'Luna', hood: '#ff5c8a', pants: '#7a2f55', cap: '#ffffff', skin: '#e8a979', acc: 'cap' },
  { price: 250, n: 'Neon', hood: '#14172e', pants: '#4ff0ff', cap: '#ff3dcb', skin: '#e8a979', acc: 'visor' },
  { price: 300, n: 'Gelo', hood: '#9fe3ff', pants: '#4a8fc7', cap: '#ffffff', skin: '#f0c39a', acc: 'beanie' },
  { price: 400, n: 'Lava', hood: '#ff3d2e', pants: '#2a0f0f', cap: '#ffd21f', skin: '#c98a5b', acc: 'spikes' },
  { price: 600, n: 'Ouro', hood: '#ffd21f', pants: '#b8860b', cap: '#ffffff', skin: '#e8a979', acc: 'crown' },
  { price: 800, n: 'Galáxia', hood: '#3b1f8f', pants: '#14172e', cap: '#ff5cf0', skin: '#8d5a3b', acc: 'phones' }
);

// Skins temáticas (Natal, Halloween, ninja, praieiro e outras)
CHARS.push(
  { price: 300, n: 'Papai Noel', hood: '#d92b2b', pants: '#d92b2b', cap: '#ffffff', skin: '#f0c39a', acc: 'santa', belt: '#14172e' },
  { price: 300, n: 'Abóbora', hood: '#3b2a5a', pants: '#14172e', cap: '#7ee04a', skin: '#ff8a1f', acc: 'pumpkin', nohair: true },
  { price: 450, n: 'Bruxa', hood: '#5b2d8a', pants: '#2a1245', cap: '#14172e', skin: '#7ed67e', acc: 'witch' },
  { price: 350, n: 'Ninja', hood: '#23262f', pants: '#23262f', cap: '#e8453c', skin: '#14172e', hand: '#e8a979', acc: 'ninja', nohair: true, shoe: '#14172e' },
  { n: 'Praieiro', hood: '#ff5c8a', sleeve: '#e8a979', pants: '#2fa8ff', cap: '#e8c06a', skin: '#e8a979', acc: 'beach', shorts: true, shoe: '#ffd21f' },
  { price: 700, n: 'Astronauta', hood: '#f1f4ff', pants: '#f1f4ff', cap: '#cfd8ee', skin: '#cfd8ee', acc: 'helmet', nohair: true, shoe: '#8a93b0' },
  { price: 500, n: 'Robô', hood: '#8d98ad', pants: '#5d6880', cap: '#ff3d4e', skin: '#aab4c4', acc: 'robot', nohair: true, shoe: '#3a4256' },
  { price: 400, n: 'Pirata', hood: '#7a2f2f', pants: '#14172e', cap: '#14172e', skin: '#c98a5b', acc: 'pirate' }
);
// Skin extra inspirada na estética de memes/brainrot e streetwear viral recente.
CHARS.push({ price: 750, n: 'Tung Tung Drip', hood: '#8a4f2b', sleeve: '#d6a06a', pants: '#34251f', cap: '#f3c78b', skin: '#b87545', acc: 'visor', shoe: '#ffe36a', baggy: true, chain: '#ffe36a', capDir: 'back', detail: '#ff5c8a' });
// Skin exclusiva do Top 1: Migs19 (polo de crochê branca, óculos escuros, copo na mão, nome DONA nas costas)
CHARS.push({ price: 1000, n: 'Migs19', polo: true, nopack: true, hood: '#fffaf0', sleeve: '#fffaf0', pants: '#2a3a5c', cap: '#d2303a', skin: '#d99d76', acc: 'dona', shoe: '#ffffff', baggy: true, detail: '#d2303a', hairCol: '#3b2f29', backText: 'DONA', mesh: true });
// Skin Ney Gaúcho: camisa azul clara do Santos, boné preto virado, bermuda preta, barba, boneca na mão e ARROGANTE nas costas
CHARS.push({ price: 800, n: 'Ney Gaúcho', neto: true, nopack: true, hood: '#35aee6', sleeve: '#35aee6', pants: '#16181d', cap: '#16181d', skin: '#d9a07a', acc: 'cap', capDir: 'back', shorts: true, shoe: '#ffffff', detail: '#ffffff', hairCol: '#1a1512', backText: 'ARROGANTE', backCol: '#ffffff', backY: 68 });

// Mais skins (colecao "Cidade Viva"): fantasias, profissoes, esportes e estilos
CHARS.push(
  { n: 'Skatista', hood: '#2f7bff', sleeve: '#f7f7fb', pants: '#1f2937', cap: '#ffd21f', skin: '#e8a979', acc: 'cap', capDir: 'back', baggy: true, shoe: '#ffffff', chain: '#ffd21f', detail: '#ffd21f' },
  { price: 150, n: 'Mecânico', hood: '#2b5fa8', pants: '#2b5fa8', cap: '#e8453c', skin: '#c98a5b', acc: 'cap', shoe: '#3a2a2a', belt: '#ffd21f', detail: '#ffd21f' },
  { price: 150, n: 'Bombeiro', hood: '#d92b2b', sleeve: '#ffd21f', pants: '#2a2a33', cap: '#ffd21f', skin: '#e8b28c', acc: 'helmet', nohair: true, shoe: '#14172e', belt: '#ffd21f', detail: '#ffd21f' },
  { price: 200, n: 'Policial', hood: '#1f3d99', pants: '#14172e', cap: '#14172e', skin: '#e8b28c', acc: 'cap', capDir: 'front', shoe: '#14172e', belt: '#ffd21f', detail: '#ffd21f' },
  { price: 200, n: 'Chef', hood: '#f7f7fb', pants: '#2a2a33', cap: '#ffffff', skin: '#d59b75', acc: 'beanie', shoe: '#14172e', belt: '#d92b2b' },
  { price: 250, n: 'DJ Neon', hood: '#14172e', sleeve: '#a855f7', pants: '#1a1040', cap: '#4ff0ff', skin: '#c98a5b', acc: 'phones', shoe: '#ff3dcb', chain: '#4ff0ff', detail: '#ff3dcb', baggy: true },
  { price: 300, n: 'Rockstar', hood: '#14111a', sleeve: '#e8453c', pants: '#2a2a33', cap: '#ffd21f', skin: '#e8a979', acc: 'spikes', shoe: '#e8453c', chain: '#d8dce8', detail: '#ffd21f', hairCol: '#ff3dcb' },
  { price: 300, n: 'Punk Rosa', hood: '#2a2a33', sleeve: '#ff5c8a', pants: '#3b1f3b', cap: '#ff5c8a', skin: '#f0c39a', acc: 'spikes', shoe: '#14172e', chain: '#d8dce8', detail: '#ff5c8a', hairCol: '#ff5c8a' },
  { price: 350, n: 'Hacker', hood: '#0b1a0f', sleeve: '#1fe06a', pants: '#0b1a0f', cap: '#1fe06a', skin: '#d59b75', acc: 'visor', shoe: '#1fe06a', detail: '#1fe06a', backText: 'HACK' },
  { price: 400, n: 'Matrix', hood: '#07110a', pants: '#07110a', cap: '#2bff7a', skin: '#c98a5b', acc: 'visor', shoe: '#07110a', detail: '#2bff7a', chain: '#2bff7a', backText: '0101' },
  { price: 350, n: 'Cowboy', hood: '#8a4f2b', sleeve: '#f1e6c8', pants: '#2b4a7a', cap: '#6b4423', skin: '#d59b75', acc: 'cap', capDir: 'front', shoe: '#4a2d18', belt: '#ffd21f', detail: '#ffd21f' },
  { price: 450, n: 'Viking', hood: '#6b4423', sleeve: '#c9a35a', pants: '#3a2a2a', cap: '#a8b0c0', skin: '#e8b28c', acc: 'helmet', nohair: true, shoe: '#4a2d18', belt: '#c9a35a', hairCol: '#c2742f' },
  { price: 500, n: 'Faraó', hood: '#f7f7fb', sleeve: '#ffd21f', pants: '#f1e6c8', cap: '#ffd21f', skin: '#c98a5b', acc: 'crown', shoe: '#c9a35a', chain: '#ffd21f', detail: '#2f7bff' },
  { price: 450, n: 'Samurai', hood: '#7a1f2b', sleeve: '#14172e', pants: '#14172e', cap: '#c9a227', skin: '#e8b28c', acc: 'crown', shoe: '#14172e', belt: '#c9a227', detail: '#c9a227' },
  { price: 500, n: 'Mago', hood: '#2f3fbf', sleeve: '#ffd21f', pants: '#1a1f5e', cap: '#3b4fe0', skin: '#f0c39a', acc: 'witch', shoe: '#ffd21f', belt: '#ffd21f', detail: '#ffd21f' },
  { price: 400, n: 'Vampiro', hood: '#14111a', sleeve: '#a3112a', pants: '#14111a', cap: '#a3112a', skin: '#e9e4ee', acc: 'cap', capDir: 'back', shoe: '#14111a', chain: '#a3112a', detail: '#a3112a', hairCol: '#14111a' },
  { price: 350, n: 'Zumbi', hood: '#5a6b3a', pants: '#3a3a2a', cap: '#7a8a4a', skin: '#8fbf6a', acc: 'beanie', shoe: '#2a2a1a', detail: '#a3112a' },
  { price: 400, n: 'Esqueleto', hood: '#14172e', sleeve: '#f1f4ff', pants: '#14172e', cap: '#f1f4ff', skin: '#f1f4ff', acc: 'cap', nohair: true, shoe: '#f1f4ff', detail: '#f1f4ff' },
  { price: 450, n: 'Fantasma', hood: '#f1f6ff', pants: '#dfe9ff', cap: '#bcd0ff', skin: '#f7fbff', acc: 'beanie', nohair: true, shoe: '#bcd0ff', detail: '#7aa2ff' },
  { price: 450, n: 'Alienígena', hood: '#3a2f6b', sleeve: '#7cff6b', pants: '#1a1440', cap: '#7cff6b', skin: '#7cff6b', acc: 'spikes', nohair: true, shoe: '#7cff6b', detail: '#4ff0ff' },
  { price: 500, n: 'Unicórnio', hood: '#ffd6f2', sleeve: '#b9f0ff', pants: '#d9c2ff', cap: '#ffe36a', skin: '#f0c39a', acc: 'crown', shoe: '#ff9ad5', chain: '#ffe36a', detail: '#ff9ad5', hairCol: '#ff9ad5' },
  { price: 550, n: 'Dragão', hood: '#1f7a3f', sleeve: '#ffb23d', pants: '#14472a', cap: '#ff6a2d', skin: '#7ed67e', acc: 'spikes', shoe: '#ff6a2d', detail: '#ffb23d', hairCol: '#ff6a2d' },
  { price: 300, n: 'Sorvete', hood: '#ff9ad5', sleeve: '#b9f0ff', pants: '#fff1c2', cap: '#ff5c8a', skin: '#f0c39a', acc: 'beanie', shoe: '#8fe3d0', detail: '#8fe3d0' },
  { price: 300, n: 'Abacaxi', hood: '#ffd21f', sleeve: '#ffe36a', pants: '#2fa84a', cap: '#2fa84a', skin: '#e8a979', acc: 'spikes', shoe: '#2fa84a', detail: '#2fa84a', hairCol: '#2fa84a' },
  { price: 500, n: 'Cyberpunk', hood: '#1a0b3d', sleeve: '#ff3dcb', pants: '#0f2a4a', cap: '#4ff0ff', skin: '#c98a5b', acc: 'visor', shoe: '#ff3dcb', chain: '#4ff0ff', detail: '#4ff0ff', baggy: true, backText: '2077' },
  { price: 600, n: 'Leão Dourado', hood: '#c9922b', sleeve: '#ffe27a', pants: '#7a4a14', cap: '#ffd21f', skin: '#e8b28c', acc: 'crown', shoe: '#7a4a14', chain: '#ffd21f', detail: '#ffe27a', hairCol: '#c2742f' },
  { price: 350, n: 'Capoeirista', hood: '#f7f7fb', sleeve: '#f7f7fb', pants: '#f7f7fb', cap: '#2fa84a', skin: '#8d5a3b', acc: 'cap', capDir: 'back', shoe: '#f7f7fb', belt: '#ffd21f', detail: '#2fa84a', flag: 'br' },
  { price: 400, n: 'Sambista', hood: '#ffffff', sleeve: '#2fa84a', pants: '#ffd21f', cap: '#2f7bff', skin: '#8d5a3b', acc: 'beach', shoe: '#2f7bff', detail: '#ffd21f', baggy: true },
  { price: 450, n: 'Carnaval', hood: '#ff3dcb', sleeve: '#ffd21f', pants: '#4ff0ff', cap: '#ff5c1a', skin: '#c98a5b', acc: 'crown', shoe: '#ffd21f', chain: '#ffd21f', detail: '#2ee59d' },
  { price: 450, n: 'Craque Brasil', hood: '#ffd21f', sleeve: '#2fa84a', pants: '#2f4ba8', cap: '#2fa84a', skin: '#8d5a3b', acc: 'cap', capDir: 'back', shorts: true, shoe: '#f7f7fb', detail: '#2fa84a', flag: 'br', backText: 'GOL' },
  { price: 450, n: 'Craque Celeste', hood: '#8fd3ff', sleeve: '#f7f7fb', pants: '#14172e', cap: '#f7f7fb', skin: '#e8b28c', acc: 'cap', capDir: 'back', shorts: true, shoe: '#14172e', detail: '#f7f7fb', backText: 'GOL' },
  { price: 300, n: 'Detetive', hood: '#8a6a4a', pants: '#3a2a2a', cap: '#6b4423', skin: '#e8b28c', acc: 'cap', capDir: 'front', shoe: '#3a2a2a', belt: '#14172e' },
  { price: 400, n: 'Mergulhador', hood: '#ffb23d', sleeve: '#14172e', pants: '#14172e', cap: '#4ff0ff', skin: '#c98a5b', acc: 'helmet', nohair: true, shoe: '#ffb23d', detail: '#4ff0ff' },
  { price: 500, n: 'Gladiador', hood: '#a3112a', sleeve: '#c9922b', pants: '#6b4423', cap: '#c9922b', skin: '#c98a5b', acc: 'helmet', nohair: true, shorts: true, shoe: '#6b4423', belt: '#c9922b', detail: '#c9922b' },
  { price: 400, n: 'Gamer RGB', hood: '#14172e', sleeve: '#a855f7', pants: '#0f2a4a', cap: '#2bff7a', skin: '#e8a979', acc: 'phones', baggy: true, shoe: '#4ff0ff', chain: '#ff3dcb', detail: '#2bff7a', backText: 'GG' },
  { price: 700, n: 'Arco-íris', hood: '#ff5c8a', sleeve: '#ffd21f', pants: '#2f7bff', cap: '#2bff7a', skin: '#e8a979', acc: 'crown', shoe: '#a855f7', chain: '#ffd21f', detail: '#4ff0ff', baggy: true },
  { price: 800, n: 'Rei do Gelo', hood: '#bfe9ff', sleeve: '#ffffff', pants: '#5a8fc7', cap: '#e8f7ff', skin: '#f0c39a', acc: 'crown', shoe: '#ffffff', chain: '#9be8ff', detail: '#9be8ff', baggy: true },
  { price: 900, n: 'Lenda Negra', hood: '#0b0b10', sleeve: '#c9a227', pants: '#0b0b10', cap: '#c9a227', skin: '#8d5a3b', acc: 'crown', shoe: '#c9a227', chain: '#ffd21f', detail: '#ffd21f', baggy: true, backText: 'LENDA' }
);
for (const c of CHARS.slice(-38)) if (!c.id) c.id = 'x_' + c.n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Regras do painel por skin: chave "b<número>" (skins do jogo) ou o id (skins do painel) -> { on:false } = fora da loja; { p:[{u,n}] } = só esses usuários veem.
let SKRULES = {}; try { SKRULES = JSON.parse(localStorage.getItem('rio_live_skrules') || '{}') || {}; } catch (e) { SKRULES = {}; }
const skKey = (c, i) => c.id || 'b' + i;
const skShow = i => { const c = CHARS[i]; if (!c) return false; const r = SKRULES[skKey(c, i)]; if (!r || typeof r !== 'object') return true; if (r.on === false) return false; if (Array.isArray(r.p) && r.p.length) { if (CFG.char === i) return true; try { return canUse(r); } catch (e) { return false; } } return true; };
// Skins extras publicadas pelo painel admin. Ficam sempre no FIM do catálogo, para não mudar o número (índice) das skins que os jogadores já compraram.
// O carregador do fim do arquivo guarda a lista no localStorage ANTES de iniciar o jogo; aqui ela é lida de forma síncrona (sem corrida com a tela inicial).
// Só aceita dados de aparência (JSON validado). Nunca executa código remoto.
(function loadCustomSkins() {
  const hex = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : null;
  let arr = []; try { arr = JSON.parse(localStorage.getItem('rio_live_skins') || '[]'); } catch (e) {}
  let bank = []; try { bank = JSON.parse(localStorage.getItem('rio_external_skins') || '[]'); } catch (_) {}
  if (!Array.isArray(arr)) arr = []; if (!Array.isArray(bank)) bank = [];
  arr = [...arr, ...bank];
  const seen = new Set();
  for (const s of arr.slice(0, 60)) {
    if (!s || typeof s.n !== 'string') continue;
    const hood = hex(s.hood), pants = hex(s.pants), cap = hex(s.cap), skin = hex(s.skin);
    if (!hood || !pants || !cap || !skin) continue;
    const n = s.n.trim().slice(0, 30) || 'Skin';
    const id = typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : 'n_' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    if (seen.has(id)) continue; seen.add(id);
    const ch = { id, n, hood, pants, cap, skin, acc: ['cap', 'beanie', 'phones', 'spikes', 'visor', 'crown'].includes(s.acc) ? s.acc : 'cap', shoe: hex(s.shoe) || '#ffffff', detail: hex(s.detail) || cap, price: Math.max(0, Math.min(100000, Math.round(Number(s.price) || 0))), custom: true };
    if (s.textures && typeof s.textures === 'object') {
      const tx={};
      for (const k of ['shirt','pants','accessory','backpack']) if (typeof s.textures[k] === 'string' && /^https:\/\/[^\s\"'()<>]+$/i.test(s.textures[k])) tx[k]=s.textures[k];
      if (Object.keys(tx).length) ch.textures=tx;
    }
    for (const k of ['sleeve', 'chain', 'hairCol', 'belt', 'hand', 'backCol']) { const v = hex(s[k]); if (v) ch[k] = v; }
    for (const k of ['baggy', 'shorts', 'nohair']) if (s[k] === true) ch[k] = true;
    if (s.capDir === 'back' || s.capDir === 'front') ch.capDir = s.capDir;
    if (['br', 'fr', 'uk'].includes(s.flag)) ch.flag = s.flag;
    if (typeof s.backText === 'string') { const t = s.backText.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 12); if (t) { ch.backText = t; ch.nopack = true; } }
    for (const k of ['holdL', 'holdR']) if (['fanta', 'plate'].includes(s[k])) ch[k] = s[k];
    if (hex(s.bag)) { ch.bag = s.bag; ch.nopack = true; }
    if (Number(s.agile) > 1) ch.agile = Math.min(1.5, Math.round(Number(s.agile) * 100) / 100);
    CHARS.push(ch);
  }
  // restaura a skin escolhida (skins do painel são lembradas pelo id, não pelo número)
  if (CFG.charId) { const k = CHARS.findIndex(c => c.id === CFG.charId); if (k >= 0) CFG.char = k; else { CFG.char = 0; CFG.charId = ''; } }
  const cc = CHARS[CFG.char];
  if (!cc || !(CFG.owned.includes(CFG.char) || !cc.price || (cc.id && CFG.ownedIds.includes(cc.id)))) { CFG.char = 0; CFG.charId = ''; } // skin não comprada volta para a padrão
  { const r0 = SKRULES[skKey(CHARS[CFG.char] || {}, CFG.char)]; if (r0 && r0.on === false) { CFG.char = 0; CFG.charId = ''; } } // skin desligada no painel
})();
const GUARD = { hood: '#2a4ea8', pants: '#1c2f6b', cap: '#14172e', skin: '#e0a070', acc: 'cap' };
// Mapas: cores do céu, astro, chão, leito, trilho e prédios
const MAPS = [
  { n: 'Subway Floresta 🌳', sky: ['#4fc3ff', '#8fdcff', '#d4f3ff'], orb: '#fff6b8', gnd: '#a8e05f', bed: '#4d5568', rail: '#cfd6e6', bld: [], deco: 'voxtree', vox: true },
  { n: 'Pôr do sol', sky: ['#ff6a3d', '#ffa24d', '#ffd27a'], orb: '#fff1b0', gnd: '#4a2f52', bed: '#6b4468', rail: '#ffd21f', bld: ['#8a3d6b', '#c24e5a', '#5c3d8a', '#a8433c'] },
  { n: 'Noite', sky: ['#0b1033', '#2a2468', '#6a3a8f'], orb: '#e8ecff', gnd: '#14183a', bed: '#232a6b', rail: '#4ff0ff', bld: ['#2b3a9c', '#7a2fb8', '#0f6a8f', '#9c2f6a'] },
  { n: 'Neve', sky: ['#7fb8e8', '#c9e6f8', '#f0f8ff'], orb: '#ffffff', gnd: '#9fb6cc', bed: '#c4d6e6', rail: '#2f7bff', bld: ['#6f8fb8', '#8fa8c8', '#5a78a8', '#a9bcd6'] }
];

MAPS.push({
  n: 'Rio de Janeiro 🇧🇷',
  sky: ['#36a7ff', '#b8e6ff', '#ffd19a'],
  orb: '#fff0b0', gnd: '#e8c98d', bed: '#505b70', rail: '#f4f4f4',
  bld: ['#f08b72', '#f6c66a', '#80c7cf', '#b29bdf'],
  deco: 'city', rio: true, win: '#fff1ad'
});

// Mais mapas (deco = cenário lateral: city, cactus, palm, pine, rock)
MAPS[2].nocl = true; MAPS[2].win = '#ffe27a'; MAPS[3].deco = 'pine'; MAPS[3].snow = true;
MAPS.push(
  { n: 'Deserto', sky: ['#f7a94a', '#ffd89a', '#fff0c8'], orb: '#fff6c8', gnd: '#c99a5b', bed: '#8a6a4a', rail: '#ffe27a', bld: [], deco: 'cactus' },
  { n: 'Praia', sky: ['#27a8ff', '#8fe0ff', '#e6fbff'], orb: '#fff3b0', gnd: '#e8d6a0', bed: '#b8a070', rail: '#ff7a1a', bld: [], deco: 'palm' },
  { n: 'Floresta', sky: ['#5bb8e8', '#b9e8c8', '#eaffd9'], orb: '#fffbd0', gnd: '#2f6b3f', bed: '#5a4a3a', rail: '#ffd21f', bld: [], deco: 'pine' },
  { n: 'Vulcão', sky: ['#2a0f1f', '#7a1f1f', '#ff6a2d'], orb: '#ffb23d', gnd: '#2a1620', bed: '#4a2a30', rail: '#ff7a1a', bld: [], deco: 'rock', nocl: true },
  { n: 'Tóquio', sky: ['#1a0b3d', '#5a1f8f', '#ff5cb8'], orb: '#ffe9ff', gnd: '#1a1040', bed: '#2f1f6b', rail: '#ff3dcb', bld: ['#ff3dcb', '#4ff0ff', '#7a5cff', '#ffd21f'], win: '#ffffff', stars: true, nocl: true },
  { n: 'Lua', sky: ['#000011', '#0a0a2e', '#2a2a5a'], orb: '#2f7bff', earth: true, gnd: '#8d92a0', bed: '#6b7080', rail: '#cfd6e8', bld: [], deco: 'crater', stars: true, nocl: true, moon: true }
);
MAPS.push(
  { n:'São Paulo 🇧🇷', sky:['#526a83','#b3c5d6','#ffd6ac'], orb:'#fff0c2', gnd:'#717c76', bed:'#39434d', rail:'#ffe27a', bld:['#6d7e91','#a9a79b','#5c6b78','#ba8874'], deco:'city', deco2:'house', rain:true },
  { n:'Cidade Neon', sky:['#070921','#18134c','#56266d'], orb:'#ff4fc8', gnd:'#17172f', bed:'#292747', rail:'#4ff0ff', bld:['#ff3dcb','#4ff0ff','#7a5cff','#ffd21f'], deco:'city', deco2:'city', stars:true, nocl:true, cyber:true }
);
MAPS[0].deco2 = 'house'; MAPS[4].deco2 = 'palm'; MAPS[1].veh = 'bus'; MAPS[2].veh = 'ghost'; MAPS[3].veh = 'sled'; MAPS[6].veh = 'buggy'; MAPS[7].veh = 'logtruck'; MAPS[8].veh = 'minecart'; MAPS[9].veh = 'bullet'; MAPS[11].veh = 'metro'; MAPS[4].veh = 'bonde'; MAPS[5].veh = 'wagon'; MAPS[10].veh = 'ufo'; MAPS[12].veh = 'ufo'; MAPS[1].deco2 = 'house'; MAPS[2].deco2 = 'pine'; MAPS[6].deco2 = 'palm'; MAPS[7].deco2 = 'voxtree';
// ===== UPDATE ORIGINAL: 7 biomas desenhados do zero, com identidade visual e veículo próprios =====
MAPS.push(
  { n:'Minecraft: Overworld Pixel ⛏️', sky:['#78c9ff','#b8e5ff','#e7f7ff'], orb:'#fff4b5', gnd:'#65a843', bed:'#70513a', rail:'#b9b9b9', bld:[], deco:'pixelMine', deco2:'pixelMine', vox:true, pixelWorld:true, minecraft:true, veh:'minecart', steam:true },
  { n:'Halloween: Mansão do Susto 🎃', sky:['#100d27','#39204f','#8e3651'], orb:'#ffad45', gnd:'#292038', bed:'#3a2c43', rail:'#ff7b37', bld:[], deco:'haunt', deco2:'grave', stars:true, halloween:true, nocl:true, veh:'ghost', steam:true },
  { n:'Arquipélago Celeste ☁️', sky:['#4a9fff','#a7d8ff','#f7fbff'], orb:'#fff1ac', gnd:'#6bc6a4', bed:'#497d86', rail:'#fff1c6', bld:[], deco:'skyisle', deco2:'crystal', skyisle:true, clouds:true, veh:'bullet', steam:true },
  { n:'Reino das Engrenagens ⚙️', sky:['#382f4d','#796b79','#e3ad79'], orb:'#ffe2a0', gnd:'#8a765f', bed:'#4e4b55', rail:'#f5bf4f', bld:[], deco:'gear', deco2:'gear', industrial:true, rain:false, veh:'logtruck', steam:true },
  { n:'Abismo Bioluminescente 🌊', sky:['#041d38','#07556b','#20a9a1'], orb:'#a8fff0', gnd:'#0d4d52', bed:'#173b51', rail:'#70fff0', bld:[], deco:'abyss', deco2:'coral', underwater:true, stars:true, nocl:true, veh:'ufo', steam:true },
  { n:'Vale dos Colossos 🦕', sky:['#8ed9ee','#c7efce','#fff1bf'], orb:'#fff3a8', gnd:'#73994a', bed:'#625443', rail:'#d6e0a0', bld:[], deco:'dino', deco2:'fern', fossils:true, veh:'wagon', steam:true },
  { n:'Neon Samurai: Distrito Zero 🏮', sky:['#090b25','#28245e','#a52c76'], orb:'#ffb4d7', gnd:'#17152d', bed:'#302544', rail:'#ff4fd8', bld:['#4d347e','#1e6682','#8d285c'], deco:'samurai', deco2:'lantern', cyber:true, stars:true, nocl:true, veh:'metro', steam:true }
);

// Mapas criados por jogadores foram removidos: só existem os mapas originais.
try { ['sr_ai_maps_v1'].forEach(k => localStorage.removeItem(k)); Object.keys(localStorage).filter(k => /^sr_ai_studio_/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (_) {}
if (!(CFG.map >= 0 && CFG.map < MAPS.length)) CFG.map = 0;
// Na Lua a gravidade é menor: pulos mais longos e flutuantes
const AG = () => { const c = CHARS[CFG.char]; return c && c.agile > 1 ? Math.min(1.5, c.agile) : 1; }; // skins ágeis (campo agile do painel)
const GRAV = () => 2900 / (1 + (AG() - 1) * .6), JV = () => 850 / Math.sqrt(1 + (AG() - 1) * .6); // UPDATE 10: pulo de ~125 (passa barreiras, não sobe em trem sem rampa) // Lua: mesma gravidade e pulo dos outros mapas

let dist, coins, objs, nextWz, pl, guard, board = { t: 0, cd: 0 }, trail = [], slideDust = [], speed, over = { title: '', score: 0 }, last = performance.now(), tAccum = 0, tFrozen = false, msgT = 0, msgTxt = '', tLast = 0, dieT = 0, dieTitle = '', cam = 0, camH = 0, camB = 0;
const rnd = (a, b) => a + Math.random() * (b - a);

let ncCur = 0, ncBest = 0; // tempo (ms) sem pegar moeda: atual e melhor sequência da corrida
let layI = 0, layPend = [];
/* ---------- UPDATE 9: a dificuldade para de subir aos 45 segundos ----------
   Velocidade, espaçamento e quantidade de obstáculos crescem com a distância (dist) até chegar
   no ponto onde se completam 45 s de jogo; depois disso ficam congelados nesse nível. */
const DIFF_SECS = 45;
var diffCapDist;
function calcDiffCap() { let t = 0, d = 0; while (t < DIFF_SECS) { const sp = Math.min(LC.speedMax, LC.speed0 + d * LC.gain); d += sp * .01; t += .01; } diffCapDist = d; }
const dd = () => Math.min(dist, diffCapDist || 51000);
function reset() { cam = 0; camH = 0; camB = 0; calcDiffCap(); layI = 0; layPend = []; ncCur = ncBest = 0; dist = 0; coins = 0; objs = []; nextWz = 1500; speed = LC.speed0; tAccum = 0; tFrozen = false; msgT = 0; pl = { lane: 0, px: 0, jy: 0, vy: 0, roll: 0, prev: 0, inv: 0, stun: 0, floor: 0, buf: 0, coy: 0 }; guard = { t: 0, age: 0 }; board = { t: 0, cd: 0 }; trail = []; slideDust = []; mtArm = null; mtNextAt = 6500; }
function isFS() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function goFS() { const e = document.documentElement, f = e.requestFullscreen || e.webkitRequestFullscreen; if (f && !isFS()) try { const r = f.call(e); if (r && r.catch) r.catch(() => {}); } catch (x) {} }
function outFS() { const f = document.exitFullscreen || document.webkitExitFullscreen; if (f && isFS()) try { f.call(document); } catch (x) {} }
function showMapCutscene(onDone) {
  const stories = [
    {title:'O PACOTE PERDIDO', text:'Steve encontrou uma mochila misteriosa esquecida no trem. Quando tentou devolvê-la, o fiscal achou que ele estava roubando e saiu atrás dele!', scene:'station'},
    {title:'O DRONE DESGOVERNADO', text:'Um drone de entregas perdeu o controle e espalhou moedas pelos trilhos. Steve corre para recuperar o pacote antes que o trem seguinte chegue!', scene:'neon'},
    {title:'A FUGA DO FESTIVAL', text:'Durante o festival, uma máquina de confete travou e começou a disparar nos trilhos. Steve precisa escapar do caos e encontrar a saída da estação!', scene:'festival'},
    {title:'O TREM FANTASMA', text:'Uma luz misteriosa acendeu no trem abandonado. Steve entrou para investigar — mas o trem começou a se mover sozinho!', scene:'ghost'},
    {title:'A CORRIDA DO TESOURO', text:'Um mapa antigo aponta para um baú escondido no fim da linha. O guarda quer fechar a estação, então Steve parte numa corrida contra o tempo!', scene:'treasure'}
  ];
  const idx = Math.abs(Number(CFG.map) || 0) % stories.length, story = stories[idx];
  const el = document.createElement('div');
  el.className = 'sr-cutscene ' + story.scene;
  el.innerHTML = `<div class="sr-cinema"><div class="sr-scene-art"><div class="sr-moon"></div><div class="sr-train"><span>🚆</span></div><div class="sr-runner">🏃</div><div class="sr-chaser">🧍‍♂️</div><div class="sr-sparks">✦　✧　✦</div></div><div class="sr-story-copy"><div class="sr-eyebrow">SUBWAY RUN • HISTÓRIA DO MAPA ${idx+1}</div><h1>${story.title}</h1><p>${story.text}</p><div class="sr-story-actions"><button class="btn g" data-skip>⏭ PULAR</button><button class="btn b" data-go>🚦 COMEÇAR CORRIDA</button></div></div></div>`;
  document.body.appendChild(el);
  let done = false;
  const finish = () => { if (done) return; done = true; el.classList.add('sr-out'); setTimeout(()=>{el.remove(); onDone();}, 280); };
  el.querySelector('[data-skip]').onclick = finish;
  el.querySelector('[data-go]').onclick = finish;
  const auto = setTimeout(finish, 8500);
}
function startGame(isMatch = false) {
  if (!isMatch && !window.__srCutsceneDone) {
    window.__srCutsceneDone = true;
    showMapCutscene(() => { window.__srCutsceneDone = true; startGame(false); window.__srCutsceneDone = false; });
    return;
  }
  if (LC.maint) { alert(LC.maintMsg || 'Jogo em manutenção. Volte já!'); return; } if (!isMatch) { MATCH.active=false; MATCH.started=false; } if (CFG.autoFS) goFS(); window.focus(); reset(); if(isMatch){const self=MATCH.room&&MATCH.room.players.find(p=>p.id===MATCH.id);if(self&&Number.isFinite(self.lane)){pl.lane=self.lane;pl.px=self.lane;}} MATCH.frames=[]; MATCH.frameAt=0; MATCH.startedAt=performance.now(); if (isMatch) MATCH.progressAt=0; msgTxt = 'Use as teclas ou deslize na tela'; msgT = 4; st = 'play'; prev = 'play'; ov.classList.add('off'); $('#pauseBtn').style.visibility = 'visible'; tLast = performance.now(); last = tLast; hud(); startMusic(); }
function pauseGame() { if (st !== 'play') return; if (MATCH.active) { msgTxt='PARTIDA MULTIJOGADOR: NÃO É POSSÍVEL PAUSAR'; msgT=2; return; } st = 'pause'; prev = 'pause'; stopMusic(); screen('pause'); }
function resume() { if (LC.maint) { alert(LC.maintMsg || 'Jogo em manutenção. Volte já!'); screen('title'); return; } st = 'play'; prev = 'play'; ov.classList.add('off'); $('#pauseBtn').style.visibility = 'visible'; tLast = last = performance.now(); startMusic(); }
function crash(title) {
  if (st !== 'play') return;
  if (!(MATCH.active && !MATCH.eliminated) && board.t > 0 && title !== 'TEMPO ESGOTADO') { board.t = 0; pl.inv = 2.6; msgTxt = '🛹 A PRANCHA QUEBROU!'; msgT = 2; return; } // a prancha absorve uma batida
  stopMusic(); sfx(110, .5, 'sawtooth', .12, 40); st = 'dying'; dieT = 0; dieTitle = title; pl.roll = 0; slideDust = []; $('#pauseBtn').style.visibility = 'hidden'; if (/PEGO/.test(title)) { guard.t = Math.max(guard.t, 3); guard.age = 0; } pl.vy = 0; const sc = score(), noCoinSeconds = Math.floor(Math.max(ncBest, ncCur) / 1000); if (sc > CFG.best) CFG.best = sc; if (!CFG.inf) CFG.wallet += Math.round(coins * LC.coinMul); MATCH.frames.push({t:Math.round(performance.now()-MATCH.startedAt),d:Math.round(dist),l:Math.round(pl.lane),y:Math.round(pl.jy),c:CFG.char,o:objs.filter(o=>o.wz-dist<1700&&o.wz-dist>-100).slice(0,5).map(o=>({t:o.t,l:o.l,z:Math.round(o.wz-dist)}))}); if (MATCH.active && !MATCH.eliminated) { MATCH.eliminated=true; roomSend({type:'eliminate',reason:title,distance:Math.floor(dist)}); }
  void saveCloudRun({ score:sc, noCoinSeconds, distance:Math.floor(dist), coins, replay:MATCH.frames.slice(-360) }); addRank(sc); save(); over = { title, score: sc }; /* a tela de fim aparece depois da animação de queda */ }
const score = () => Math.floor(dist / 50) + coins * 10;
// Tropeço: 1ª batida chama o guarda; 2ª batida enquanto ele está na sua cola = pego
// Sons simples (WebAudio), sem arquivos externos; pode desligar nos ajustes
let actx = null;
function sfx(f, d, type, v, f2) {
  if (!CFG.sound) return;
  if (d >= .25) { try { navigator.vibrate && navigator.vibrate(d > .4 ? 180 : 70); } catch (e) {} } // vibra em tropeço e batida
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), gn = actx.createGain(), t = actx.currentTime;
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    gn.gain.setValueAtTime(v || .08, t); gn.gain.exponentialRampToValueAtTime(.001, t + d); o.connect(gn); gn.connect(actx.destination); o.start(t); o.stop(t + d);
  } catch (e) {}
}
// Música original (composta aqui, sem direitos autorais): loop curto em estilo 8-bits. Dá para desligar nas configurações.
const MUS = { on: false, step: 0, next: 0, timer: null, gain: null };
const MN = m => 440 * Math.pow(2, (m - 69) / 12);
const MEL = [76,0,79,81,0,79,76,0, 74,0,77,79,0,77,74,0, 72,0,76,79,0,76,72,0, 74,76,79,76,74,72,71,0]; // notas MIDI (0 = pausa)
const BASS = [45, 41, 48, 43];
function musicStep() {
  const t = MUS.next, i = MUS.step % 32, d = .17;
  const play = (f, dur, type, vol) => { const o = actx.createOscillator(), gn = actx.createGain(); o.type = type; o.frequency.value = f; gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(gn); gn.connect(MUS.gain); o.start(t); o.stop(t + dur + .02); };
  if (MEL[i]) play(MN(MEL[i]), d * 1.6, 'square', .05);
  if (i % 2 === 0) play(MN(BASS[Math.floor(i / 8) % 4] + (i % 4 === 2 ? 12 : 0)), d * 1.8, 'triangle', .09);
  if (i % 4 === 0) play(1800, .03, 'square', .015);
  MUS.next += d; MUS.step++;
}
function chipStart() {
  if (!CFG.music || MUS.on) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    MUS.gain = actx.createGain(); MUS.gain.gain.value = .5; MUS.gain.connect(actx.destination);
    MUS.on = true; MUS.next = actx.currentTime + .05; MUS.step = 0;
    MUS.timer = setInterval(() => { while (MUS.next < actx.currentTime + .3) musicStep(); }, 80);
  } catch (e) { MUS.on = false; }
}
function chipStop() { MUS.on = false; clearInterval(MUS.timer); try { MUS.gain && MUS.gain.disconnect(); } catch (e) {} }

/* ---------- 🎵 MÚSICAS: arquivos do jogador, músicas do painel admin e Spotify ---------- */
const MPK = 'sr_music_cfg';
const MP = { mode: 'chip', pick: null, spot: null, vol: .7, admin: [], mine: [], audio: null, cur: null, url: '', fails: 0, msg: '' };
try { const r = JSON.parse(localStorage.getItem(MPK) || 'null') || {}; if (['chip', 'track', 'spotify'].includes(r.mode)) MP.mode = r.mode; MP.pick = r.pick || null; MP.spot = r.spot || null; if (r.vol >= 0 && r.vol <= 1) MP.vol = r.vol; } catch (e) {}
try { MP.mine = JSON.parse(localStorage.getItem('sr_music_mine') || '[]') || []; } catch (e) { MP.mine = []; }
const mpSave = () => { const data={ mode:MP.mode, pick:MP.pick, spot:MP.spot, vol:MP.vol }; try { localStorage.setItem(MPK, JSON.stringify(data)); } catch (e) {} LocalDB.put('settings', { key:'music', value:data, updatedAt:Date.now() }); };
const mpSaveMine = () => { try { localStorage.setItem('sr_music_mine', JSON.stringify(MP.mine)); } catch (e) {} LocalDB.put('settings', { key:'music-files', value:MP.mine, updatedAt:Date.now() }); };
const mpMsg = (t, ok) => { MP.msg = t; if (st === 'music' && document.querySelector('#mMsg')) setMsg('#mMsg', t, ok); };
// arquivos do jogador ficam guardados no aparelho (IndexedDB), nada é enviado para a internet
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('sr_music', 1); r.onupgradeneeded = () => r.result.createObjectStore('f', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbDo = (mode, fn) => idb().then(d => new Promise((res, rej) => { const q = fn(d.transaction('f', mode).objectStore('f')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
const idbPut = o => idbDo('readwrite', s => s.put(o)), idbGet = id => idbDo('readonly', s => s.get(id)), idbDel = id => idbDo('readwrite', s => s.delete(id));
async function mpFetchAdmin() {
  try { MP.admin = JSON.parse(localStorage.getItem('sr_music_admin') || '[]') || []; } catch (e) { MP.admin = []; }
  if (st === 'music') drawMusic();
}
const mpAdminList = () => MP.admin.filter(x => x.on !== false && /^https?:\/\//i.test(x.u || '')).map(x => ({ s: 'admin', id: String(x.id), n: x.n || 'Música', u: x.u }));
const mpMineList = () => MP.mine.map(x => ({ s: 'mine', id: x.id, n: x.n }));
const mpQ = () => (MP.pick && MP.pick.s === 'mine') ? mpMineList() : mpAdminList();
function mpAudio() {
  if (MP.audio) return MP.audio;
  const a = new Audio(); a.preload = 'auto'; a.volume = MP.vol;
  a.onended = () => { MP.fails = 0; mpNext(1); };
  a.onplaying = () => { MP.fails = 0; };
  a.onerror = () => { const n = mpQ().length; mpMsg('Não consegui tocar "' + (MP.cur ? MP.cur.n : 'a música') + '" (formato não suportado ou link fora do ar).', 0); if (++MP.fails < n) mpNext(1); };
  return MP.audio = a;
}
async function mpLoad() {
  const q = mpQ(), t = (MP.pick && q.find(x => x.id === MP.pick.id)) || q[0]; if (!t) return false;
  const a = mpAudio(); MP.cur = t; if (MP.url) { try { URL.revokeObjectURL(MP.url); } catch (e) {} MP.url = ''; }
  if (t.s === 'mine') { const o = await idbGet(t.id); if (!o || !o.blob) { mpMsg('Arquivo não encontrado no aparelho.', 0); return false; } MP.url = URL.createObjectURL(o.blob); a.src = MP.url; } else a.src = t.u;
  return true;
}
function mpPlay() { const a = mpAudio(); if (!MP.cur || !a.src) { mpLoad().then(ok => ok && mpPlay()); return; } a.volume = MP.vol; const p = a.play(); if (p && p.catch) p.catch(() => {}); }
function mpPause() { if (MP.audio) MP.audio.pause(); }
function mpNext(d) {
  const q = mpQ(); if (!q.length) return; let i = q.findIndex(x => MP.cur && x.id === MP.cur.id); i = (i + d + q.length) % q.length;
  MP.pick = { s: q[i].s, id: q[i].id }; mpSave(); mpLoad().then(ok => { if (ok) mpPlay(); if (st === 'music') drawMusic(); });
}
async function mpChoose(s, id) {
  if (!CFG.music) { CFG.music = true; save(); }
  chipStop(); spotHide(); MP.mode = 'track'; MP.pick = { s, id }; MP.fails = 0; mpSave();
  if (await mpLoad()) mpPlay(); drawMusic();
}
function mpChip() { mpPause(); spotHide(); MP.mode = 'chip'; mpSave(); drawMusic(); }
// Spotify: usa o player oficial incorporado (o jogador aperta ▶ nele uma vez)
function spotParse(u) {
  u = String(u || '').trim(); let m = u.match(/^spotify:(playlist|album|track|episode|show|artist):([A-Za-z0-9]{10,30})$/); if (m) return { t: m[1], id: m[2] };
  try { const url = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u); if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null; m = url.pathname.match(/\/(playlist|album|track|episode|show|artist)\/([A-Za-z0-9]{10,30})/); if (m) return { t: m[1], id: m[2] }; } catch (e) {}
  return null;
}
(function () { const s = document.createElement('style'); s.textContent = '#spotBox{position:fixed;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(340px,94vw);z-index:60;display:none;border-radius:14px;background:#14172e;border:2px solid #1db954;box-shadow:0 4px 14px #0008}#spotBox.on{display:block}#spotBox .sh{display:flex;align-items:center;gap:8px;padding:4px 10px;color:#1db954;font:900 13px system-ui,sans-serif;cursor:pointer}#spotBox .sh span{flex:1}#spotBox .sb{max-height:0;overflow:hidden;transition:max-height .2s}#spotBox.open .sb{max-height:360px}#spotBox iframe{display:block;width:100%;border:0;border-radius:0 0 12px 12px}'; document.head.appendChild(s); })();
function spotShow(open) {
  if (!MP.spot) return; let b = document.getElementById('spotBox');
  if (!b) { b = document.createElement('div'); b.id = 'spotBox'; b.innerHTML = '<div class="sh" id="spotHd"><span>🎧 Spotify</span><b id="spotAr">▾</b></div><div class="sb"></div>'; document.body.appendChild(b); b.querySelector('#spotHd').onclick = () => { b.classList.toggle('open'); b.querySelector('#spotAr').textContent = b.classList.contains('open') ? '▾' : '▴'; }; }
  const src = `https://open.spotify.com/embed/${MP.spot.t}/${MP.spot.id}?utm_source=generator&theme=0`, sb = b.querySelector('.sb');
  if (!sb.firstChild || sb.firstChild.dataset.src !== src) { sb.innerHTML = `<iframe data-src="${src}" src="${src}" height="${/track|episode/.test(MP.spot.t) ? 80 : 152}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Spotify"></iframe>`; }
  b.classList.add('on'); b.classList.toggle('open', !!open); b.querySelector('#spotAr').textContent = open ? '▾' : '▴';
}
function spotHide() { const b = document.getElementById('spotBox'); if (b) { b.classList.remove('on', 'open'); const sb = b.querySelector('.sb'); if (sb) sb.innerHTML = ''; } }
// ligações com o resto do jogo: a música original continua sendo o padrão
function startMusic() {
  if (!CFG.music) return;
  if (MP.mode === 'track' && mpQ().length) { mpPlay(); return; }
  if (MP.mode === 'spotify' && MP.spot) { spotShow(false); return; }
  chipStart();
}
function stopMusic() { chipStop(); mpPause(); }
function drawMusic() {
  const A = mpAdminList(), M = mpMineList(), cur = MP.mode === 'track' && MP.pick ? MP.pick : null, playing = MP.audio && !MP.audio.paused;
  const row = (t, own) => `<div class="krow ${cur && cur.s === t.s && cur.id === t.id ? 'on' : ''}"><span>${cur && cur.s === t.s && cur.id === t.id ? (playing ? '🔊 ' : '⏸ ') : ''}${esc(t.n)}</span><button class="btn g s" type="button" data-mp="${t.s}|${esc(t.id)}" aria-label="Tocar">▶</button>${own ? `<button class="btn g s" type="button" data-md="${esc(t.id)}" aria-label="Remover">✕</button>` : ''}</div>`;
  card.innerHTML = `<h1>🎵 MÚSICAS</h1><p style="text-align:left">Escolha a música que toca durante a corrida.</p>
  <div class="krow ${MP.mode === 'chip' ? 'on' : ''}"><span>🎹 Música original do jogo</span><button class="btn g s" type="button" id="mChip">${MP.mode === 'chip' ? 'Ativa' : 'Usar'}</button></div>
  <h2>Músicas do jogo</h2>${A.length ? A.map(t => row(t, 0)).join('') : '<p style="text-align:left;margin:2px 0 6px">Nenhuma música cadastrada ainda.</p>'}
  <h2>Minhas músicas</h2>${M.length ? M.map(t => row(t, 1)).join('') : '<p style="text-align:left;margin:2px 0 6px">Toque em “Adicionar” e escolha MP3 (ou outro áudio) do seu aparelho. Os arquivos ficam só no seu navegador.</p>'}
  <label class="btn b" style="margin:6px 0;cursor:pointer;display:block;text-align:center">＋ ADICIONAR ÁUDIO DO APARELHO<input type="file" id="mFile" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac" multiple style="display:none"></label>
  <h2>Spotify</h2><label>Link da playlist ou da música<input type="text" id="mSpot" inputmode="url" placeholder="https://open.spotify.com/playlist/..." value="${MP.spot ? `https://open.spotify.com/${MP.spot.t}/${MP.spot.id}` : ''}"></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"><button class="btn b s" type="button" id="mSpotGo">Usar Spotify</button>${MP.mode === 'spotify' ? '<button class="btn g s" type="button" id="mSpotOff">Tirar Spotify</button>' : ''}</div>
  <p style="text-align:left;margin:2px 0 6px;font-size:12px">Cole o link completo (“Compartilhar → Copiar link”). Um player do Spotify aparece embaixo da tela: aperte ▶ nele uma vez. Músicas inteiras exigem estar logado no Spotify neste navegador.</p>
  ${MP.mode === 'track' ? `<div class="krow"><button class="btn g s" type="button" id="mPrev">⏮</button><button class="btn g s" type="button" id="mTog">${playing ? '⏸ Pausar' : '▶ Tocar'}</button><button class="btn g s" type="button" id="mNext">⏭</button></div>` : ''}
  <label>Volume: <span id="mVolV">${Math.round(MP.vol * 100)}</span>%<input type="range" id="mVol" min="0" max="100" value="${Math.round(MP.vol * 100)}"></label>
  <div class="msg" id="mMsg"></div><button class="btn" id="bBackM" type="button">VOLTAR</button>`;
  if (MP.msg) setMsg('#mMsg', MP.msg, 0);
  const q = s => card.querySelector(s);
  q('#mChip').onclick = mpChip;
  card.querySelectorAll('[data-mp]').forEach(b => b.onclick = () => { const [s, id] = b.dataset.mp.split('|'); if (cur && cur.s === s && cur.id === id && playing) { mpPause(); drawMusic(); } else mpChoose(s, id); });
  card.querySelectorAll('[data-md]').forEach(b => b.onclick = async () => {
    const id = b.dataset.md; if (!confirm('Remover esta música do aparelho?')) return;
    if (MP.cur && MP.cur.id === id) { mpPause(); MP.cur = null; if (MP.audio) MP.audio.removeAttribute('src'); }
    try { await idbDel(id); } catch (e) {} MP.mine = MP.mine.filter(x => x.id !== id); mpSaveMine(); if (MP.pick && MP.pick.id === id) { MP.pick = null; if (MP.mode === 'track') MP.mode = 'chip'; mpSave(); } drawMusic();
  });
  q('#mFile').onchange = async e => {
    const fs = [...(e.target.files || [])], ok = []; let bad = 0;
    for (const f of fs) {
      if (!(/^audio\//.test(f.type) || /\.(mp3|m4a|wav|ogg|aac|flac|opus|weba)$/i.test(f.name))) { bad++; continue; }
      if (f.size > 60 * 1024 * 1024) { bad++; continue; } if (MP.mine.length + ok.length >= 40) { bad++; continue; }
      const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
      try { await idbPut({ id, name: f.name, blob: f }); ok.push({ id, n: f.name.replace(/\.[^.]+$/, '').slice(0, 60), s: f.size }); } catch (er) { bad++; }
    }
    MP.mine = MP.mine.concat(ok); mpSaveMine();
    MP.msg = ok.length ? (bad ? ok.length + ' adicionada(s); ' + bad + ' ignorada(s) (não é áudio, passa de 60 MB ou limite de 40).' : ok.length + ' música(s) adicionada(s)!') : 'Nenhum arquivo válido. Use áudio de até 60 MB (máx. 40 músicas).';
    if (ok.length) { await mpChoose('mine', ok[0].id); setMsg('#mMsg', MP.msg, 1); MP.msg = ''; } else drawMusic();
  };
  q('#mSpotGo').onclick = () => {
    const p = spotParse(q('#mSpot').value); if (!p) return setMsg('#mMsg', 'Link inválido. Cole o link completo da playlist ou da música (open.spotify.com/...). Links curtos spotify.link não funcionam.', 0);
    if (!CFG.music) { CFG.music = true; save(); } mpPause(); chipStop(); MP.spot = p; MP.mode = 'spotify'; mpSave(); spotShow(true); drawMusic(); setMsg('#mMsg', 'Spotify ligado! Aperte ▶ no player verde embaixo.', 1);
  };
  if (q('#mSpotOff')) q('#mSpotOff').onclick = () => { spotHide(); MP.mode = 'chip'; mpSave(); drawMusic(); };
  if (q('#mPrev')) q('#mPrev').onclick = () => mpNext(-1); if (q('#mNext')) q('#mNext').onclick = () => mpNext(1);
  if (q('#mTog')) q('#mTog').onclick = () => { if (MP.audio && !MP.audio.paused) mpPause(); else mpPlay(); setTimeout(drawMusic, 120); };
  q('#mVol').oninput = e => { MP.vol = e.target.value / 100; q('#mVolV').textContent = e.target.value; if (MP.audio) MP.audio.volume = MP.vol; mpSave(); };
  q('#bBackM').onclick = () => screen(backTo);
}
mpFetchAdmin();
function addRank(sc) {
  const t = Math.floor(Math.max(ncBest, ncCur) / 1000);
  lastNc = t; lastNcNew = false;
  // O modo NOCOIN só registra tentativas de pelo menos 1 segundo sem moedas.
  if (t < 1) return;
  const L = myRank();
  lastNcNew = !L.length || t > L[0].t;
  L.push({ t, s: Math.max(0, Math.floor(Number(sc) || 0)), d: Date.now() });
  L.sort((a, b) => b.t - a.t || b.s - a.s || a.d - b.d);
  if (ACC) {
    CFG.ranks[ACC.uid] = L.slice(0, 10);
    LocalDB.addRun({ uid:ACC.uid, name:ACC.name, score:sc, noCoinSeconds:t, createdAt:Date.now() });
    void acctSync(t, sc);
  } else {
    CFG.rank = L.slice(0, 10);
  }
}
function stumble() { sfx(160, .25, 'sawtooth', .1, 70); if (board.t > 0) return crash('PRANCHA'); if (guard.t > 0) return crash('PEGO PELO GUARDA!'); guard.t = 9; guard.age = 0; pl.inv = 1.1; pl.stun = .45; }

function timerVal() { const s = Math.floor(tAccum / 1000), T = CFG.timer; return T.mode === 'down' ? Math.max(0, T.value - s) : T.value + s; }
function fmtT(v) { const p = n => String(n).padStart(2, '0'), h = Math.floor(v / 3600), m = Math.floor(v % 3600 / 60); return h > 0 ? `${p(h)}:${p(m)}:${p(v % 60)}` : `${p(m)}:${p(v % 60)}`; }
function hud() {
  const T = CFG.timer, t = $('#timer');
  t.style.display = T.show ? '' : 'none'; t.style.fontSize = T.size + 'px'; t.style.color = tFrozen ? '#ff5468' : T.color;
  const im = T.img ? `url("${T.img.replace(/"/g, '%22')}")` : ''; // foto de fundo pequena
  t.style.backgroundImage = im ? `linear-gradient(rgba(20,23,46,.35),rgba(20,23,46,.35)), ${im}` : ''; t.style.padding = im ? T.pad + 'px ' + T.pad * 2 + 'px' : ''; t.style.borderRadius = im ? '12px' : ''; t.style.border = im ? '3px solid #14172e' : '';
  t.textContent = fmtT(st === 'title' ? T.value : timerVal()) + (tFrozen ? ' ⏸' : '');
  const F = CFG.fps, fe = $('#fps'); // contador de FPS: cor, tamanho e foto de fundo configuráveis
  if (fe) { fe.style.display = F.show && CFG.pos.fps !== 'off' ? '' : 'none'; fe.style.fontSize = F.size + 'px'; fe.style.color = F.color;
    const fi = F.img ? `url("${F.img.replace(/"/g, '%22')}")` : ''; fe.style.backgroundImage = fi ? `linear-gradient(rgba(20,23,46,.35),rgba(20,23,46,.35)), ${fi}` : '';
    fe.style.backgroundSize = 'cover'; fe.style.backgroundPosition = 'center'; fe.style.padding = fi ? F.pad + 'px ' + F.pad * 2 + 'px' : ''; fe.style.borderRadius = fi ? '10px' : ''; fe.style.border = fi ? '3px solid #14172e' : ''; }
  $('#score').textContent = score ? (dist === undefined ? 0 : score()) : 0; $('#coins').textContent = '🪙 ' + (coins || 0);
}

// Maria Fumaça: em certos mapas, um trem vem de frente numa das pistas. Só sai quando a pista está livre.
let mtArm = null, mtNextAt = 6500;
const steamOn = () => { const M = MAPS[CFG.map]; if (M.veh) return true; return M.steam !== undefined ? !!M.steam : !(M.moon || M.cyber); }; // M.steam:true/false força por mapa
function spawn() {
  while (nextWz < dist + ZMAX) {
    if (!mtArm && steamOn() && dist > mtNextAt) mtArm = { l: [-1, 0, 1][Math.floor(Math.random() * 3)] };
    let free = [-1, 0, 1][Math.floor(Math.random() * 3)]; const gap = Math.max(300, 640 - dd() / 90); let maxLen = 0;
    if (mtArm && free === mtArm.l) free = mtArm.l === 0 ? (Math.random() < .5 ? -1 : 1) : 0;
    const rp = Math.random();
    if (nextWz > 4000 && rp < .3) { // linha de moedas nas 3 pistas: três moedas por trilho, com espaço suficiente para reagir
      for (const l of [-1, 0, 1]) { if (mtArm && l === mtArm.l) continue; for (let k = 0; k < 3; k++) objs.push({ t: 'coin', l, wz: nextWz + k * 180, len: 0 }); }
      nextWz += 640 + gap; continue;
    }
    if (nextWz > 4000 && rp < .42) { // 🐍 COBRINHA: moedas zigue-zague passando por todas as pistas
      let ll = [-1, 0, 1][Math.floor(Math.random() * 3)], dir = Math.random() < .5 ? -1 : 1;
      for (let k = 0; k < 12; k++) { if (k && k % 3 === 0) { if (ll + dir < -1 || ll + dir > 1) dir = -dir; ll += dir; } if (!(mtArm && ll === mtArm.l)) objs.push({ t: 'coin', l: ll, wz: nextWz + k * 120, len: 0 }); }
      nextWz += 1440 + gap; continue;
    }
    if (nextWz > 4000 && rp < .52) { // 🌈 ARCO: moedas no alto e embaixo, quem pula pega e quem corre também
      const al = [-1, 0, 1][Math.floor(Math.random() * 3)];
      if (!(mtArm && al === mtArm.l)) [30, 70, 105, 130, 105, 70, 30].forEach((hh, q) => objs.push({ t: 'coin', l: al, wz: nextWz + q * 125, len: 0, h: hh }));
      nextWz += 900 + gap; continue;
    }
    for (const l of [-1, 0, 1]) {
      if ((mtArm && l === mtArm.l) || l === free || Math.random() > Math.min(.65, .35 + dd() / 60000)) continue; // começo mais fácil (a dificuldade para de subir aos 45 s)
      const r = Math.random(), t = r < .3 ? 'barrier' : r < .5 ? 'bar' : r < .65 ? 'wall' : 'train', len = t === 'train' ? rnd(500, 1200) : t === 'wall' ? 90 : t === 'barrier' ? 120 : 40;
      // 🛗 RAMPA: às vezes o trem vem com uma rampa na frente, dá para subir no teto sem pular (como no Subway Surfers)
      const ramp = t === 'train' && nextWz > 3000 && Math.random() < .32, off0 = ramp ? RAMP_LEN : 0;
      if (ramp) objs.push({ t: 'ramp', l, wz: nextWz, len: RAMP_LEN });
      objs.push({ t, l, wz: nextWz + off0, len, col: COLORS[Math.floor(Math.random() * 4)] }); maxLen = Math.max(maxLen, off0 + len);
      let end = off0 + len;
      // 🚆 TRENS LIGADOS: outro trem logo depois com um vão curtinho, dá para pular de teto em teto (corredor de teto)
      if (t === 'train' && Math.random() < .3) {
        const g2 = rnd(150, 260), len2 = rnd(450, 900);
        objs.push({ t: 'train', l, wz: nextWz + end + g2, len: len2, col: COLORS[Math.floor(Math.random() * 4)] });
        end += g2 + len2;
        if (Math.random() < .35) { objs.push({ t: 'ramp', l, wz: nextWz + end + 40, len: RAMP_LEN, down: true }); end += 40 + RAMP_LEN; } // rampa de descida
        maxLen = Math.max(maxLen, end);
      }
      // moedas no teto (mais moedas = mais difícil para quem faz nocoin)
      if (t === 'train' && Math.random() < .8) {
        // às vezes (só em trem comprido) as moedas fazem um aro no alto e voltam pro teto: dá para passar por baixo dele
        const arc = len >= 1000 && Math.random() < .5, a0 = arc ? 60 + 170 * Math.floor(Math.random() * Math.floor((len - 60 - 660 - 60) / 170 + 1)) : -1;
        let off = 60;
        while (off <= len - 60) {
          objs.push({ t: 'coin', l, wz: nextWz + off0 + off, len: 0, h: TH }); // moeda reta no teto
          if (off === a0) { [55, 90, 105, 90, 55].forEach((hh, q) => objs.push({ t: 'coin', l, wz: nextWz + off0 + off + 110 * (q + 1), len: 0, h: TH + hh })); off += 660; } // aro de 5 moedas, termina em outra moeda reta
          else off += 170;
        }
      }
    }
    for (let k = 0; k < 3; k++) objs.push({ t: 'coin', l: free, wz: nextWz + k * 180, len: 0 }); // pista livre agora usa 3 moedas por fileira
    // moedas também em cima de barreiras e muros baixos, e na rampa
    for (const o of objs) if (!o._c && o.wz >= nextWz && o.wz <= nextWz + 5 && (o.t === 'wall' || o.t === 'barrier' || o.t === 'ramp')) { o._c = 1; const hh = o.t === 'ramp' ? 0 : TOPS[o.t]; if (o.t === 'ramp') { for (let k = 0; k < Math.floor(o.len / 130); k++) objs.push({ t: 'coin', l: o.l, wz: o.wz + 20 + k * 130, len: 0, h: TH * (o.down ? 1 - (k + .5) * 130 / o.len : (k + .5) * 130 / o.len) }); } else objs.push({ t: 'coin', l: o.l, wz: o.wz + o.len / 2, len: 0, h: hh }); }
    nextWz += Math.max(maxLen, 640) + gap;
  }
}

/* ---------- UPDATE 10: CÂMERA DE PERSEGUIÇÃO COM COLISÃO ----------
   A câmera fica atrás do personagem. Ela sobe junto quando você anda em cima de trem/rampa e NUNCA atravessa
   sólidos: se um trem/muro passa pela posição da câmera, ela é empurrada para o lado livre mais próximo; sem lado
   livre, ela sobe para ficar por cima do telhado. CAMBASE = altura da câmera sobre o chão; CAMZC = onde ela fica. */
const CAMBASE = 118, CAMZC = -230;
function solidTop(o, zRel) { // altura do sólido no ponto zRel (relativo ao jogador)
  if (o.t === 'train') return TH; if (o.t === 'wall') return TOPS.wall; if (o.t === 'barrier') return TOPS.barrier;
  if (o.t === 'steam') return STEAM_TOP[o.veh] || 110;
  if (o.t === 'ramp') { const u = Math.max(0, Math.min(1, (dist + zRel - o.wz) / o.len)); return TH * (o.down ? 1 - u : u); }
  return 0;
}
function camSolve(dt) {
  let tx = pl.px * (CFG.camFollow === false ? 0 : .3), th = pl.floor * .72 + Math.max(0, pl.jy - pl.floor) * .14;
  const hits = [];
  for (const o of objs) { if (o.t === 'coin' || o.t === 'bar') continue; const z = o.wz - dist; if (z > CAMZC + 45 || z + o.len < CAMZC - 45) continue; hits.push(o); }
  if (hits.length) {
    const inside = (x, h) => hits.some(o => Math.abs(x - o.l) < .52 && CAMBASE + h < solidTop(o, CAMZC) + 14);
    if (inside(tx, th)) {
      let best = null;
      for (const o of hits) for (const c of [o.l - .56, o.l + .56]) if (Math.abs(c) <= 1.75 && !inside(c, th) && (best === null || Math.abs(c - tx) < Math.abs(best - tx))) best = c;
      if (best !== null && Math.abs(best - tx) < .8) tx = best;
      else { let need = 0; for (const o of hits) if (Math.abs(tx - o.l) < .52) need = Math.max(need, solidTop(o, CAMZC) + 14 - CAMBASE); th = Math.max(th, need); }
    }
  }
  cam += (tx - cam) * Math.min(1, dt * (hits.length ? 9 : 4.5));
  camH += (th - camH) * Math.min(1, dt * (th > camH ? 9 : 5)); // sobe rápido (não deixa entrar no telhado), desce macio
  camB *= Math.exp(-dt * 11);
}
// Altura do "chão" em cima de cada objeto: dá para pular e andar por cima deles (como no Subway Surfers)
const TOPS = { train: TH, wall: 105, barrier: 55 };
// Altura do "teto seguro" de cada veículo (trem de frente/lado ainda mata; por cima dá para pular e andar sem dano)
const STEAM_TOP = { wagon: 75, ufo: 100, bonde: 95, bus: 105, ghost: 90, sled: 60, buggy: 70, logtruck: 100, minecart: 60, bullet: 95, metro: 105, steam: 110 };
// Física em passos curtos (máx. ~10 ms): nada é atravessado, mesmo com FPS baixo ou em alta velocidade
function update(dt, realMs) {
  const n = Math.max(1, Math.ceil(dt / .01));
  for (let i = 0; i < n; i++) { step(dt / n, realMs / n, i === 0); if (st !== 'play') return; }
  hud();
}
function step(dt, realMs, first) {
  speed = Math.min(LC.speedMax, LC.speed0 + dd() * LC.gain) * (pl.stun > 0 ? .55 : 1); dist += speed * dt; pl.inv -= dt; pl.stun -= dt; msgT -= dt; board.t -= dt; board.cd -= dt;
  for (const p of trail) p.life += dt; if (first) { trail = trail.filter(p => p.life < .9); // rastros
    if (CFG.trail !== 'off') trail.push({ l: pl.px + rnd(-.07, .07), wz: dist, h: pl.jy + rnd(4, 26), life: 0 }); }
  if (guard.t > 0) { guard.t -= dt; guard.age += dt; }
  { const laneError = pl.lane - pl.px; const laneEase = 1 - Math.exp(-dt * 14 * AG()); pl.px += laneError * laneEase; if (Math.abs(pl.lane - pl.px) < .0015) pl.px = pl.lane; }
  if (pl.jy <= pl.floor + 1 && pl.vy <= 0) pl.coy = .1; else pl.coy -= dt;
  if (pl.buf > 0) { pl.buf -= dt; if (pl.jy <= pl.floor + 1 && pl.vy <= 0) { pl.vy = JV(); pl.roll = 0; pl.buf = 0; sfx(420, .18, 'square', .07, 760); } }
  if (pl.jy < pl.floor && pl.vy <= 0) { pl.jy = pl.floor; pl.vy = 0; } // pousa em cima do objeto
  const vyBefore = pl.vy;
  if (pl.jy > pl.floor || pl.vy > 0) { pl.vy -= GRAV() * dt; pl.jy += pl.vy * dt; if (pl.jy <= pl.floor && pl.vy <= 0) { if (vyBefore < -700) camB = Math.min(16, -vyBefore * .009); pl.jy = pl.floor; pl.vy = 0; } }
  if (pl.roll > 0) pl.roll -= dt * AG();
  for (const p of slideDust) { p.life += dt; p.dx += p.vx * dt; p.dy += p.vy * dt; }
  slideDust = slideDust.filter(p => p.life < .58);
  if (first && pl.roll > 0 && pl.jy <= pl.floor + 46) {
    for (let i=0;i<4;i++) { const f = i < 3; slideDust.push({ dx:rnd(-16,16), dy:f ? -rnd(14,34) : rnd(4,12), vx:rnd(-50,50), vy:f ? -rnd(10,40) : rnd(10,40), size:rnd(4,10), spin:rnd(-.4,.4), life:0 }); }
    if (slideDust.length > 90) slideDust.splice(0,slideDust.length-90);
  }
  spawn();
  if (mtArm && !objs.some(o => o.l === mtArm.l && o.t !== 'steam' && o.wz + o.len > dist - 40)) { // pista livre: o trem aparece lá longe
    const vh = MAPS[CFG.map].veh || 'steam'; objs.push({ t: 'steam', veh: vh, l: mtArm.l, wz: dist + ZMAX * .92, len: { wagon:440, ufo:360, bonde:620, bus:520, ghost:780, sled:520, buggy:300, logtruck:700, minecart:720, bullet:900, metro:780 }[vh] || 820, v: 560 }); mtArm = null; mtNextAt = dist + rnd(7000, 13000);
    vehHorn(MAPS[CFG.map].veh); // buzina/som próprio de cada veículo
  }
  let top = 0; // altura do chão sob você agora (0 = rua; trem, muro e barreira = em cima deles)
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i]; if (o.v) o.wz -= o.v * dt; const z = o.wz - dist;
    if (z + o.len < -300) { objs.splice(i, 1); continue; }
    const near = Math.abs(pl.px - o.l) < (o.t === 'coin' ? .3 : .58);
    if (o.t === 'coin') { if (near && z < 26 && z > -26 && Math.abs(pl.jy - (o.h || 0)) < 70) { if (MATCH.active) { crash('PEGOU MOEDA! ELIMINADO'); return; } objs.splice(i, 1); coins++; ncBest = Math.max(ncBest, ncCur); ncCur = 0; sfx(880, .08, 'square', .06, 1320); if (CFG.nocoin && !tFrozen) { tFrozen = true; msgTxt = '🪙 PEGOU MOEDA: TIMER PARADO'; msgT = 2.5; } } continue; }
    if (o.t === 'steam') steamSnd(o, z, dt);
    if (!near || !(z < 40 && z + o.len > -40)) continue;
    if (o.t === 'steam') { { const tp = STEAM_TOP[o.veh] || 110; if (pl.jy >= tp - 18) { if (pl.vy <= 0 && pl.jy <= tp + 1) { pl.jy = tp; pl.vy = 0; top = Math.max(top, tp); } continue; } } if (pl.inv <= 0) return crash({ wagon:'ATROPELADO PELA CARROÇA!', ufo:'ABDUZIDO PELO OVNI!', bonde:'ATROPELADO PELO BONDINHO!', bus:'ATROPELADO PELO ÔNIBUS!', ghost:'ASSUSTADO PELO TREM FANTASMA!', sled:'ATROPELADO PELO TRENÓ!', buggy:'ATROPELADO PELO BUGGY!', logtruck:'ESMAGADO PELO CAMINHÃO DE TORAS!', minecart:'ATROPELADO PELA VAGONETA!', bullet:'ATROPELADO PELO TREM-BALA!', metro:'ATROPELADO PELO METRÔ!' }[o.veh] || 'ATROPELADO PELA MARIA FUMAÇA!'); continue; } // não dá para passar por cima: tem que trocar de pista
    if (o.t === 'ramp') { // rampa: o chão sobe (ou desce) suave; de lado, com o pé baixo, é parede
      const u = Math.max(0, Math.min(1, (dist - o.wz) / o.len)), h = TH * (o.down ? 1 - u : u);
      if (pl.jy >= h - 26) { if (pl.vy <= 0 && pl.jy <= h + (o.down ? 30 : 2)) { pl.jy = h; pl.vy = 0; } if (pl.jy <= h + 2) top = Math.max(top, h); }
      else if (pl.inv <= 0) { pl.lane = pl.prev !== o.l ? pl.prev : (o.l > 0 ? o.l - 1 : o.l + 1); stumble(); }
      else pl.lane = pl.prev !== o.l ? pl.prev : (o.l > 0 ? o.l - 1 : o.l + 1);
      continue;
    }
    const tp = TOPS[o.t];
    if (tp !== undefined) {
      if (pl.jy >= tp - 18) { // pés na altura do topo (ou acima): sobe e anda por cima; no ar passa por cima
        if (pl.vy <= 0 && pl.jy <= tp + 1) { pl.jy = tp; pl.vy = 0; top = Math.max(top, tp); }
        continue;
      }
      if (o.t === 'barrier') { if (pl.inv <= 0) stumble(); }
      else if (pl.inv <= 0) { // trem/muro: de frente = fim; de lado = tropeça e volta
        if (z > -30) return crash(guard.t > 0 ? 'PEGO PELO GUARDA!' : 'BATEU NO PAREDÃO!');
        pl.lane = pl.prev !== o.l ? pl.prev : (o.l > 0 ? o.l - 1 : o.l + 1); stumble();
      } else pl.lane = pl.prev !== o.l ? pl.prev : (o.l > 0 ? o.l - 1 : o.l + 1); // imune após tropeçar: mesmo assim não atravessa, é empurrado de volta
    } else if (o.t === 'bar' && pl.inv <= 0 && pl.roll <= 0 && pl.jy < 100) stumble();
    if (st !== 'play') return;
  }
  pl.floor = top; camSolve(dt);
  ncCur += realMs;
  { const now=performance.now(); if(now-MATCH.frameAt>=240){MATCH.frameAt=now;MATCH.frames.push({t:Math.round(now-MATCH.startedAt),d:Math.round(dist),l:Math.round(pl.lane),y:Math.round(pl.jy),c:CFG.char,o:objs.filter(o=>o.wz-dist<1700&&o.wz-dist>-100).slice(0,5).map(o=>({t:o.t,l:o.l,z:Math.round(o.wz-dist)}))});if(MATCH.frames.length>360)MATCH.frames.shift();} if(MATCH.active&&!MATCH.eliminated&&now-(MATCH.progressAt||0)>=500){MATCH.progressAt=now;roomSend({type:'progress',distance:Math.round(dist),lane:Math.round(pl.lane)});} }
  if (!tFrozen) tAccum += realMs; // o timer usa tempo real, então não depende do FPS
  if (CFG.timer.mode === 'down' && timerVal() === 0) { crash('TEMPO ESGOTADO'); }
}

/* ---------- 4. DESENHO (pseudo-3D no canvas) ---------- */
const cv = $('#c'), g = cv.getContext('2d');
// Arrecadações, quando configuradas, são lidas do armazenamento local.
async function getDonationConfig() {
  try {
    const d = JSON.parse(localStorage.getItem('rio_live_don') || 'null');
    // Mantém a configuração administrativa quando ela existe; oferece fallback de Pix caso ainda não tenha QR cadastrado.
    if (d && typeof d === 'object') return { ...d, pixKey: d.pixKey || 'doacaaochavepix@gmail.com', qrImage: d.qrImage || 'pix-qr.jpg', title: d.title || '💛 APOIE O SUBWAY RUN', message: d.message || 'Qualquer valor nos ajuda a melhorar cada vez mais o nosso jogo!' };
    return { enabled:true, title:'💛 APOIE O SUBWAY RUN', message:'Qualquer valor nos ajuda a melhorar cada vez mais o nosso jogo!', pixKey:'doacaaochavepix@gmail.com', qrImage:'pix-qr.jpg', goal:100, received:0, accentColor:'#ffe36a' };
  } catch (e) { return { enabled:true, title:'💛 APOIE O SUBWAY RUN', message:'Qualquer valor nos ajuda a melhorar cada vez mais o nosso jogo!', pixKey:'doacaaochavepix@gmail.com', qrImage:'pix-qr.jpg', goal:100, received:0, accentColor:'#ffe36a' }; }
}
async function showDonations() {
  card.innerHTML = '<h1>💛 ARRECADAÇÕES</h1><p>Carregando informações…</p><button class="btn g" id="bBackDon" type="button">VOLTAR</button>';
  $('#bBackDon').onclick = () => screen(backTo || 'title');
  try {
    const d = await getDonationConfig();
    if (!d.enabled) { card.innerHTML = '<h1>💛 ARRECADAÇÕES</h1><p>No momento, a arrecadação está desativada.</p><button class="btn g" id="bBackDon" type="button">VOLTAR</button>'; $('#bBackDon').onclick = () => screen(backTo || 'title'); return; }
    const goal = Math.max(0, Number(d.goal)||0), received = Math.max(0, Number(d.received)||0), pct = goal > 0 ? Math.min(100, received/goal*100) : 0;
    const money = n => Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    card.innerHTML = `<h1>${esc(d.title || '💛 APOIE O PROJETO')}</h1><p style="white-space:pre-wrap">${esc(d.message || 'Qualquer valor nos ajuda a melhorar cada vez mais o nosso jogo!')}</p>${d.imageUrl ? `<img src="${esc(d.imageUrl)}" alt="Imagem da arrecadação" loading="lazy" style="display:block;width:100%;max-height:220px;object-fit:contain;border-radius:16px;margin:10px 0">` : ''}${d.gifUrl ? `<img src="${esc(d.gifUrl)}" alt="Animação da arrecadação" loading="lazy" style="display:block;width:100%;max-height:220px;object-fit:contain;border-radius:16px;margin:10px 0">` : ''}<div style="text-align:left;background:#10162c;border:1px solid #36466d;padding:14px;border-radius:16px;margin:12px 0"><div style="display:flex;justify-content:space-between;gap:8px"><b>Meta: ${money(goal)}</b><b>${pct.toFixed(0)}%</b></div><div style="height:12px;border-radius:99px;background:#263451;overflow:hidden;margin:8px 0"><div style="height:100%;width:${pct}%;background:${/^#[0-9a-f]{6}$/i.test(d.accentColor||'')?d.accentColor:'#ffe36a'}"></div></div><p style="margin:0">Recebemos: <b>${money(received)}</b></p></div>${d.pixKey ? `<div style="text-align:left;background:#10162c;border:1px solid #36466d;padding:12px;border-radius:14px"><b>Chave Pix</b><p id="donPix" style="overflow-wrap:anywhere;margin:6px 0">${esc(d.pixKey)}</p><button class="btn b" id="copyPix" type="button">📋 COPIAR CHAVE PIX</button></div>` : ''}${d.qrImage ? `<h2>Escaneie o QR Code</h2><img src="${esc(d.qrImage)}" alt="QR Code Pix" style="width:min(260px,100%);background:white;padding:8px;border-radius:14px;margin:8px auto">` : ''}<p style="font-size:11px;opacity:.75">Qualquer valor nos ajuda a melhorar cada vez mais o nosso jogo. Obrigado por apoiar o Subway Run! Contribuição voluntária.</p><button class="btn g" id="bBackDon" type="button">VOLTAR</button>`;
    $('#bBackDon').onclick = () => screen(backTo || 'title');
    if ($('#copyPix')) $('#copyPix').onclick = async () => { try { await navigator.clipboard.writeText(d.pixKey); $('#copyPix').textContent = '✅ CHAVE COPIADA'; } catch (_) { const s = $('#donPix'); const rg = document.createRange(); rg.selectNodeContents(s); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); $('#copyPix').textContent = 'Selecione e copie a chave'; } };
  } catch (e) {
    card.innerHTML = `<h1>💛 ARRECADAÇÕES</h1><p>Não foi possível ler a configuração de arrecadações.</p><small>${esc(e.message||e)}</small><button class="btn g" id="bBackDon" type="button">VOLTAR</button>`;
    $('#bBackDon').onclick = () => screen(backTo || 'title');
  }
}

let W, H, HZ, GY, LW, U, PU;
function resize() {
  const adaptiveScale = (window.SRAdaptive && typeof window.SRAdaptive.getScale === 'function') ? window.SRAdaptive.getScale() : 1; const maxD0 = CFG.graphics==='suave' ? 0.85 : CFG.graphics==='padrao' ? 1.15 : CFG.graphics==='ultra' ? 1.5 : 2; const maxD = Math.max(0.55, maxD0 * adaptiveScale); const d = Math.min(maxD, devicePixelRatio || 1, Math.sqrt(1800000/Math.max(1,innerWidth*innerHeight))); W = Math.max(1, innerWidth); H = Math.max(1, innerHeight); cv.width = Math.round(W * d); cv.height = Math.round(H * d); cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0);
  HZ = H * .33; GY = H * .87; LW = Math.min(W * .3, 250); U = Math.min(H / 720, W / 420) * 1.22 * CAMZ; PU = U * .7;
}
addEventListener('resize', resize); resize();
// Projeção: pista (-1,0,1) e distância z → posição na tela e escala s
const P = (l, z) => { const s = 1 / (1 + Math.max(z, -200) / Z0); return { s, x: W / 2 + (l - cam) * LW * s, y: HZ + (GY - HZ + camH * U) * s }; };
const hash = (n, b) => Math.abs((Math.sin(n * 127.1 + b * 311.7) * 43758.5453) % 1);

function box(l, z0, z1, hgt, col, wd = .8, h0 = 0) { // bloco "voxel" estilo Crossy Road: cores chapadas, sem contorno
  const a = P(l, z0), b = P(l, z1), w = LW * wd;
  const ya = a.y - h0 * U * a.s, yb = b.y - h0 * U * b.s, ta = a.y - hgt * U * a.s, tb = b.y - hgt * U * b.s;
  if (!h0) { const o = w * .3; g.fillStyle = 'rgba(15,45,10,.22)'; g.beginPath(); g.moveTo(a.x - w * .5 * a.s + o * a.s, a.y); g.lineTo(a.x + w * .5 * a.s + o * a.s, a.y); g.lineTo(b.x + w * .5 * b.s + o * b.s, b.y); g.lineTo(b.x - w * .5 * b.s + o * b.s, b.y); g.fill(); } // sombra no chão
  if (l !== 0) { const sx = l < 0 ? 1 : -1; g.fillStyle = shade(col, .74); g.beginPath(); g.moveTo(a.x + sx * w / 2 * a.s, ya); g.lineTo(a.x + sx * w / 2 * a.s, ta); g.lineTo(b.x + sx * w / 2 * b.s, tb); g.lineTo(b.x + sx * w / 2 * b.s, yb); g.fill(); } // lateral
  g.fillStyle = shade(col, 1.18); g.beginPath(); g.moveTo(a.x - w / 2 * a.s, ta); g.lineTo(a.x + w / 2 * a.s, ta); g.lineTo(b.x + w / 2 * b.s, tb); g.lineTo(b.x - w / 2 * b.s, tb); g.fill(); // topo claro
  g.fillStyle = col; g.fillRect(a.x - w / 2 * a.s, ta, w * a.s, ya - ta); // frente
  return { a, ta, w, ya };
}
function sideQuad(l, za, zb, h0, h1, off, col) { // faixa/janela na lateral voltada para o centro
  if (l === 0) return; const sx = l < 0 ? 1 : -1; za = Math.max(za, -200); zb = Math.min(zb, ZMAX); if (zb <= za) return;
  const pt = (zz, hh) => { const p = P(l, zz); return [p.x + sx * LW * off * p.s, p.y - hh * U * p.s]; };
  const A = pt(za, h0), B = pt(zb, h0), C = pt(zb, h1), D = pt(za, h1);
  g.fillStyle = col; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(C[0], C[1]); g.lineTo(D[0], D[1]); g.closePath(); g.fill();
}
const CROSSY_COL = { '#e8453c': '#f2572b', '#27b4a3': '#7fcf4a', '#2f7bff': '#3fa7e8', '#ff7a1a': '#ffc236' };
/* ---------- 🔊 SONS DA MARIA FUMAÇA: tchuc-tchuc + buzina (WebAudio, sem arquivos) ---------- */
let steamNoise = null;
function steamCtx() { if (!CFG.sound) return null; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch (e) { return null; } }
function steamChug(vol) { // "tchuc": rajada curta de ruído filtrado (vapor) + baque grave
  const a = steamCtx(); if (!a || vol <= .01) return;
  try {
    if (!steamNoise) { steamNoise = a.createBuffer(1, a.sampleRate * .3, a.sampleRate); const d = steamNoise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = a.currentTime, src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = steamNoise; bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 300; bp.Q.value = .9;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.32 * vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + .11);
    src.connect(bp); bp.connect(g); g.connect(a.destination); src.start(t); src.stop(t + .13);
    const o = a.createOscillator(), og = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(45, t + .09);
    og.gain.setValueAtTime(.0001, t); og.gain.exponentialRampToValueAtTime(.22 * vol, t + .01); og.gain.exponentialRampToValueAtTime(.0001, t + .1);
    o.connect(og); og.connect(a.destination); o.start(t); o.stop(t + .12);
  } catch (e) {}
}
function steamHorn(vol, long) { // "fooom-fooom": dois tons graves de apito de locomotiva
  const a = steamCtx(); if (!a) return; vol = vol || 1;
  try {
    const t = a.currentTime, dur = long ? 1.5 : .9, g = a.createGain(), lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.2 * vol, t + .08); g.gain.setValueAtTime(.2 * vol, t + dur - .25); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    [233, 277].forEach((f, i) => { const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * .93, t); o.frequency.exponentialRampToValueAtTime(f, t + .12); o.connect(lp); o.start(t); o.stop(t + dur + .05); });
    lp.connect(g); g.connect(a.destination);
    if (CFG.sound) { try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} }
  } catch (e) {}
}
function steamSnd(o, z, dt) {
  if (o.veh && o.veh !== 'steam') return vehSnd(o, z, dt); // chamado todo frame por trem: ritmo e volume mudam conforme ele se aproxima
  if (z > ZMAX || z + o.len < -250) return;
  const near = Math.max(0, Math.min(1, 1 - Math.max(0, z) / ZMAX)), vol = .25 + .75 * near;
  o.chugT = (o.chugT === undefined ? 0 : o.chugT) - dt;
  if (o.chugT <= 0) { steamChug(vol); o.chugT = .5 - .26 * near; } // de longe: lento; perto: acelera
  if (!o.horn2 && z < 1100) { o.horn2 = true; steamHorn(.9, true); } // buzina de novo quando está chegando perto
}
/* ---------- TREM MARIA FUMAÇA (vem na direção do jogador) ---------- */
const STEAM = { body:'#2f7a62', dark:'#23262f', red:'#b8332b', brass:'#e0a93f', cab:'#a63a2f', coal:'#101116' };
function drawSteam(o, z, now, al) {
  if (o.veh && o.veh !== 'steam') return drawVeh(o, z, now, al);
  const l = o.l, S = STEAM, sides = l === 0 ? [-.42, .42] : [l < 0 ? .42 : -.42];
  const part = (a, b, h, col, wd, h0, dl) => { const za = Math.max(z + a, -200), zb = z + b; if (zb <= za || za >= ZMAX) return null; return box(l + (dl || 0), za, zb, h, col, wd, h0); };
  // chassi, tender com carvão e cabine (de trás para a frente)
  part(0, o.len, 24, S.dark, .8, 0);
  part(560, o.len, 92, S.dark, .72, 20); part(585, o.len - 22, 126, S.coal, .56, 88);
  sideQuad(l, z + 560, z + o.len, 42, 54, .37, S.red);
  const cab = part(330, 540, 172, S.cab, .8, 20);
  if (cab) { const cw = cab.w * cab.a.s, chh = cab.ya - cab.ta; g.fillStyle = '#2b3a52'; g.fillRect(cab.a.x - cw * .3, cab.ta + chh * .1, cw * .6, chh * .24); g.fillStyle = 'rgba(160,215,255,.55)'; g.fillRect(cab.a.x - cw * .26, cab.ta + chh * .14, cw * .22, chh * .1); }
  part(322, 552, 186, S.dark, .9, 172);
  sideQuad(l, z + 360, z + 420, 100, 150, .4, '#2b3a52'); sideQuad(l, z + 440, z + 505, 100, 150, .4, '#2b3a52');
  // caldeira cilíndrica: discos empilhados, com faixas de latão
  const r1 = Math.min(46 * U, LW * .36), hc = 72 * U;
  for (let i = 0; i <= 9; i++) {
    const zi = z + 330 - i * 34; if (zi < -200 || zi > ZMAX) continue;
    const p = P(l, zi), cx = p.x, cy = p.y - hc * p.s, r = r1 * p.s;
    g.fillStyle = shade(S.body, .7 + i / 9 * .22); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.arc(cx, cy - r * .3, r * .55, 0, 7); g.fill();
    if (i === 3 || i === 6) { g.strokeStyle = S.brass; g.lineWidth = Math.max(1.5, 4 * p.s * U); g.beginPath(); g.arc(cx, cy, r * .98, 0, 7); g.stroke(); }
  }
  // chaminé, cúpula de vapor
  part(205, 255, 142, S.brass, .22, 112);
  part(52, 98, 196, '#15171d', .15, 108); part(52, 98, 160, S.brass, .16, 150); part(44, 106, 210, '#15171d', .27, 190);
  // frente da caldeira: porta, rebites e farol aceso
  const zf = z + 24;
  if (zf > -200 && zf < ZMAX) {
    const p = P(l, zf), cx = p.x, cy = p.y - hc * p.s, r = r1 * p.s;
    g.strokeStyle = S.brass; g.lineWidth = Math.max(2, 5 * p.s * U); g.beginPath(); g.arc(cx, cy, r * .97, 0, 7); g.stroke();
    g.fillStyle = '#1c2027'; g.beginPath(); g.arc(cx, cy, r * .8, 0, 7); g.fill();
    g.fillStyle = '#2e343f'; g.beginPath(); g.arc(cx, cy, r * .58, 0, 7); g.fill();
    g.fillStyle = S.brass; for (let q = 0; q < 10; q++) { const a = q * .628; g.beginPath(); g.arc(cx + Math.cos(a) * r * .69, cy + Math.sin(a) * r * .69, Math.max(1, r * .045), 0, 7); g.fill(); }
    g.save(); g.shadowColor = '#ffe36a'; g.shadowBlur = 22 * p.s * U; g.fillStyle = '#fff6b0'; g.beginPath(); g.arc(cx, cy - r * .12, r * .2, 0, 7); g.fill(); g.restore();
  }
  // limpa-trilhos listrado e para-choques
  const pil = part(0, 70, 36, S.red, .84, 0);
  if (pil) { const pw = pil.w * pil.a.s, ph2 = pil.ya - pil.ta; g.fillStyle = 'rgba(255,255,255,.85)'; for (let q = 0; q < 6; q += 2) g.fillRect(pil.a.x - pw / 2 + pw * q / 6, pil.ta, pw / 6, ph2); }
  part(0, 22, 46, '#d7dae2', .12, 24, -.3); part(0, 22, 46, '#d7dae2', .12, 24, .3);
  // rodas motrizes vermelhas com cubo de latão e biela
  for (const a of [120, 205, 290, 440, 610, 705]) for (const sx of sides) {
    const za = Math.max(z + a, -200); if (za >= ZMAX || z + a + 36 <= -200) continue; const big = a < 330;
    box(l + sx, za, z + a + 36, big ? 52 : 36, S.red, .1); box(l + sx, za + 8, z + a + 28, big ? 38 : 26, S.brass, .11, big ? 14 : 10);
  }
  sideQuad(l, z + 120, z + 300, 22, 30, .47, '#cfd3de');
  // fumaça da chaminé (sobe e vai ficando para trás) e vapor dos cilindros
  const puff = (cx, cy, r, col, a) => { g.globalAlpha = al * a; g.fillStyle = col; for (const [dx, dy, k] of [[0, 0, 1], [.5, .12, .7], [-.45, .18, .62]]) { g.beginPath(); g.arc(cx + dx * r, cy + dy * r, r * k, 0, 7); g.fill(); } };
  const tt = now / 1000;
  for (let k = 0; k < 7; k++) {
    const a = (tt * .75 + k / 7) % 1, zc = z + 72 + a * 420; if (zc < -200 || zc > ZMAX) continue;
    const p = P(l, zc), r = (14 + a * 54) * U * p.s, c = Math.round(80 + a * 150);
    puff(p.x + Math.sin(a * 5 + k) * r * .35, p.y - (208 + a * 170) * U * p.s, r, 'rgb(' + c + ',' + c + ',' + (c + 8) + ')', .8 * (1 - a) * Math.min(1, a * 14));
  }
  for (const sx of sides) for (let k = 0; k < 2; k++) {
    const a = (tt * 1.7 + k * .5 + (sx > 0 ? .25 : 0)) % 1, zc = z + 100 + a * 90; if (zc < -200 || zc > ZMAX) continue;
    const p = P(l + sx, zc); puff(p.x, p.y - (22 + a * 36) * U * p.s, (8 + a * 22) * U * p.s, '#f4f7ff', .55 * (1 - a));
  }
  g.globalAlpha = 1;
}
/* ---------- 🚋🐂🛸 VEÍCULOS POR MAPA (carroça, OVNI, bondinho) ---------- */
function vtone(type, f0, f1, dur, vol, delay, lpf) {
  const a = steamCtx(); if (!a) return;
  try {
    const t = a.currentTime + (delay || 0), o = a.createOscillator(), gn = a.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + Math.min(.04, dur / 3)); gn.gain.exponentialRampToValueAtTime(.0001, t + dur);
    let node = o; if (lpf) { const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpf; o.connect(lp); node = lp; }
    node.connect(gn); gn.connect(a.destination); o.start(t); o.stop(t + dur + .05);
  } catch (e) {}
}
const VH = { // buzina de cada veículo: [tipo, f0, f1, duração, volume, atraso]
  bus: [['square', 340, 320, .5, .15], ['square', 270, 255, .5, .11]], ghost: [['sine', 320, 90, 1.3, .2], ['triangle', 160, 60, 1.3, .1, .1]],
  sled: [['triangle', 1568, 1568, .13, .16], ['triangle', 1760, 1760, .13, .16, .16], ['triangle', 1568, 1568, .13, .16, .32], ['sine', 3136, 3136, .2, .05, .32]],
  buggy: [['square', 520, 500, .22, .13], ['square', 520, 500, .22, .13, .3]], logtruck: [['sawtooth', 120, 105, 1, .2, 0, 500], ['sawtooth', 150, 130, 1, .1, 0, 500]],
  minecart: [['triangle', 880, 880, .12, .13], ['triangle', 660, 660, .2, .13, .14]], bullet: [['sawtooth', 920, 880, .8, .1], ['sawtooth', 1160, 1100, .8, .08]], metro: [['triangle', 440, 440, .7, .16], ['triangle', 554, 554, .7, .12]]
};
const VR = { // ritmo do veículo: [onda, f0, f1, duração, volume, intervalo(s)]
  bus: ['sawtooth', 75, 48, .09, .13, .34], ghost: ['sine', 200, 120, .4, .09, .7], sled: ['triangle', 1568, 1568, .06, .06, .26], buggy: ['square', 130, 80, .05, .1, .22],
  logtruck: ['sawtooth', 62, 40, .12, .16, .42], minecart: ['square', 700, 300, .04, .09, .17], bullet: ['sawtooth', 220, 200, .35, .06, .5], metro: ['square', 95, 80, .08, .09, .3]
};
function vehHorn(v) {
  if (VH[v]) { for (const t of VH[v]) vtone(t[0], t[1], t[2], t[3], t[4], t[5] || 0, t[6]); return; }
  if (v === 'wagon') { vtone('sawtooth', 170, 105, 1, .2, 0, 520); vtone('sawtooth', 130, 95, .8, .1, .05, 420); } // muuu
  else if (v === 'ufo') { vtone('sine', 180, 1500, .8, .2); vtone('square', 360, 1000, .8, .05); } // sweep alienígena
  else if (v === 'bonde') { vtone('triangle', 1318, 1318, .4, .22); vtone('triangle', 1318, 1318, .4, .22, .2); vtone('sine', 2636, 2636, .3, .06, .2); } // trim-trim
  else steamHorn(1, false);
}
function vehSnd(o, z, dt) {
  if (z > ZMAX || z + o.len < -250) return;
  const near = Math.max(0, Math.min(1, 1 - Math.max(0, z) / ZMAX)), vol = .25 + .75 * near;
  o.chugT = (o.chugT === undefined ? 0 : o.chugT) - dt;
  if (o.chugT <= 0) {
    if (o.veh === 'wagon') { vtone('sine', 150, 55, .09, .32 * vol); vtone('square', 900, 250, .04, .07 * vol, .01); o.chugT = .46 - .2 * near; if (Math.random() < .12) vtone('sawtooth', 220 + Math.random() * 90, 150, .3, .05 * vol, 0, 700); }
    else if (VR[o.veh]) { const q = VR[o.veh]; vtone(q[0], q[1], q[2], q[3], q[4] * vol); o.chugT = q[5] - .1 * near; }
    else if (o.veh === 'ufo') { o.ph = !o.ph; o.ph ? vtone('sine', 380, 680, .42, .13 * vol) : vtone('sine', 680, 380, .42, .13 * vol); vtone('sine', 95, 90, .45, .08 * vol); o.chugT = .4; }
    else { vtone('square', 110, 65, .06, .13 * vol); vtone('square', 120, 70, .06, .09 * vol, .14); o.chugT = .52 - .24 * near; o.bell = (o.bell || 0) + 1; if (o.bell % 5 === 0) { vtone('triangle', 1318, 1318, .3, .16 * vol); vtone('triangle', 1318, 1318, .3, .16 * vol, .17); } }
  }
  if (!o.horn2 && z < 1100) { o.horn2 = true; vehHorn(o.veh); }
}
function drawVeh(o, z, now, al) {
  const l = o.l, tt = now / 1000, sides = l === 0 ? [-.42, .42] : [l < 0 ? .42 : -.42];
  const part = (a, b, h, col, wd, h0, dl) => { const za = Math.max(z + a, -200), zb = z + b; if (zb <= za || za >= ZMAX) return null; return box(l + (dl || 0), za, zb, h, col, wd, h0); };
  const puff = (zc, hh, r0, col, a) => { if (zc < -200 || zc > ZMAX) return; const p = P(l, zc); g.globalAlpha = al * a; g.fillStyle = col; g.beginPath(); g.arc(p.x, p.y - hh * U * p.s, r0 * U * p.s, 0, 7); g.fill(); g.globalAlpha = 1; };
  if (o.veh === 'wagon') { // carroça puxada por dois bois, com um velhinho conduzindo
    part(250, 440, 52, '#8a5a2b', .72, 30); part(250, 440, 66, '#a8702f', .76, 52);
    part(268, 430, 150, '#f1e6c8', .6, 66); part(268, 430, 156, '#c2453b', .22, 148);
    for (const sx of sides) for (const a of [285, 395]) { box(l + sx, Math.max(z + a, -200), z + a + 30, 56, '#4a2d18', .09); box(l + sx, Math.max(z + a + 6, -200), z + a + 24, 22, '#c9a35a', .1, 17); }
    part(196, 244, 62, '#6b4423', .42, 30);
    part(204, 234, 106, '#3f6fb0', .26, 62); part(208, 230, 132, '#f2c9a0', .17, 106); part(206, 214, 118, '#f4f4f4', .15, 100); // camisa, cabeça, barba
    part(198, 240, 138, '#e3c26a', .34, 130); part(208, 230, 154, '#e3c26a', .17, 138); // chapéu de palha
    part(96, 122, 80, '#6b4423', .88, 70); // canga
    for (const [dl, col, sp] of [[-.2, '#7a4a2a', 0], [.2, '#efe4cc', 1.6]]) {
      for (const [a, ph] of [[46, 0], [66, 3], [112, 3.1], [132, .1]]) { const lift = Math.max(0, Math.sin(tt * 9 + ph + sp)) * 12; part(a, a + 14, 40, '#3a2414', .07, lift, dl + (a % 2 ? .08 : -.08)); }
      part(40, 150, 98, col, .3, 38, dl);
      if (sp) part(70, 96, 98, '#7a4a2a', .31, 38, dl); // mancha
      part(12, 46, 90, col, .2, 52, dl); part(10, 18, 66, '#d9a0a0', .14, 52, dl); // cabeça e focinho
      part(24, 34, 112, '#f7f3e6', .06, 90, dl - .13); part(24, 34, 112, '#f7f3e6', .06, 90, dl + .13); // chifres
    }
    for (let k = 0; k < 4; k++) { const a = (tt * 1.2 + k / 4) % 1; puff(z + 60 + a * 160, 10 + a * 30, 8 + a * 22, '#d9bf90', .5 * (1 - a)); } // poeira dos cascos
  } else if (o.veh === 'ufo') { // OVNI com um ET dentro da cúpula
    const x0 = P(l - .4, Math.max(z, -200)), x1 = P(l + .4, Math.max(z, -200)), y0 = P(l - .4, Math.min(z + o.len, ZMAX)), y1 = P(l + .4, Math.min(z + o.len, ZMAX));
    g.globalAlpha = al * (.2 + .08 * Math.sin(tt * 6)); g.fillStyle = '#7dffa8'; g.beginPath(); g.moveTo(x0.x, x0.y); g.lineTo(x1.x, x1.y); g.lineTo(y1.x, y1.y); g.lineTo(y0.x, y0.y); g.closePath(); g.fill(); g.globalAlpha = al;
    const zc = z + 70; if (zc < -200 || zc > ZMAX) return;
    const p = P(l, zc), R = LW * .5 * p.s, cx = p.x, cy = p.y - (170 + Math.sin(tt * 3) * 9) * U * p.s;
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(p.x, p.y, R * .9, R * .18, 0, 0, 7); g.fill();
    const bm = g.createLinearGradient(0, cy, 0, p.y); bm.addColorStop(0, 'rgba(150,255,190,.5)'); bm.addColorStop(1, 'rgba(150,255,190,.08)');
    g.fillStyle = bm; g.beginPath(); g.moveTo(cx - R * .38, cy + R * .1); g.lineTo(cx + R * .38, cy + R * .1); g.lineTo(cx + R * .85, p.y); g.lineTo(cx - R * .85, p.y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(150,230,255,.5)'; g.beginPath(); g.ellipse(cx, cy - R * .2, R * .38, R * .42, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#7cff6b'; g.beginPath(); g.ellipse(cx, cy - R * .3, R * .15, R * .19, 0, 0, 7); g.fill(); // cabeça do ET
    g.fillStyle = '#10141c'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * R * .075, cy - R * .3, R * .045, R * .075, s * .5, 0, 7); g.fill(); }
    g.strokeStyle = '#7cff6b'; g.lineWidth = Math.max(1, 2 * U * p.s); g.beginPath(); g.moveTo(cx - R * .08, cy - R * .46); g.lineTo(cx - R * .14, cy - R * .62); g.moveTo(cx + R * .08, cy - R * .46); g.lineTo(cx + R * .14, cy - R * .62); g.stroke();
    g.fillStyle = '#7cff6b'; for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * R * .14, cy - R * .63, R * .03, 0, 7); g.fill(); }
    const gr = g.createLinearGradient(0, cy - R * .3, 0, cy + R * .3); gr.addColorStop(0, '#e9eef8'); gr.addColorStop(1, '#6f7a93');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, R, R * .27, 0, 0, 7); g.fill();
    g.fillStyle = '#f6f9ff'; g.beginPath(); g.ellipse(cx, cy - R * .08, R * .74, R * .17, 0, 0, 7); g.fill();
    for (let i = 0; i < 8; i++) { const a = i * .785 + tt * 2.2; g.fillStyle = ['#ff4fc8', '#ffe36a', '#4ff0ff'][(i + Math.floor(tt * 4)) % 3]; g.beginPath(); g.arc(cx + Math.cos(a) * R * .8, cy + R * .06 + Math.sin(a) * R * .1, Math.max(1.5, R * .045), 0, 7); g.fill(); }
  } else if (o.veh === 'bus') { // ônibus amarelo
    part(0, 520, 26, '#1d1f27', .8, 8); part(10, 510, 130, '#f2b134', .84, 26); part(10, 510, 136, '#f7f0dc', .86, 130);
    sideQuad(l, z + 12, z + 508, 44, 56, .42, '#c93a2e');
    for (let w = 44; w < 470; w += 78) sideQuad(l, z + w, z + w + 56, 74, 114, .42, '#1d2a44'), sideQuad(l, z + w + 4, z + w + 52, 78, 110, .42, '#bfe6ff');
    part(0, 12, 112, '#bfe6ff', .66, 66); part(0, 12, 56, '#fff6b0', .13, 40, -.26); part(0, 12, 56, '#fff6b0', .13, 40, .26); part(0, 10, 134, '#c93a2e', .6, 118);
    for (const sx of sides) for (const a of [70, 400]) box(l + sx, Math.max(z + a, -200), z + a + 36, 36, '#15161b', .1);
    for (let k = 0; k < 2; k++) { const a = (tt * 1.4 + k / 2) % 1; puff(z + 500 + a * 70, 18 + a * 20, 5 + a * 10, '#8a8f9c', .5 * (1 - a)); }
  } else if (o.veh === 'ghost') { // trem fantasma flutuante
    const lf = 14 + Math.sin(tt * 3) * 8;
    part(0, 780, 24, '#4a5f7a', .78, lf); part(12, 770, 124, '#bfe3ff', .8, lf + 24); part(12, 770, 130, '#e9f6ff', .82, lf + 124);
    for (let w = 50; w < 720; w += 100) sideQuad(l, z + w, z + w + 60, lf + 60, lf + 110, .41, '#22ffa0');
    part(0, 14, 112, '#7dffa8', .5, lf + 56); part(0, 14, 70, '#22ffa0', .12, lf + 46, -.22); part(0, 14, 70, '#22ffa0', .12, lf + 46, .22);
    for (let k = 0; k < 5; k++) { const a = (tt * .8 + k / 5) % 1; puff(z + 780 + a * 140, 40 + a * 40, 8 + a * 16, '#bfe3ff', .5 * (1 - a)); }
  } else if (o.veh === 'sled') { // trenó do Papai Noel puxado por duas renas
    part(200, 480, 26, '#6b1f1f', .66, 22); part(200, 480, 70, '#c2332b', .72, 26); part(200, 262, 108, '#c2332b', .72, 70); part(300, 350, 100, '#2ee59d', .24, 70, -.14); part(370, 420, 96, '#ffd21f', .22, 70, .14); part(430, 466, 92, '#4ff0ff', .2, 70, -.1);
    for (const sx of sides) box(l + sx, Math.max(z + 190, -200), z + 490, 14, '#e8e3d0', .07);
    part(224, 266, 112, '#d92b2b', .3, 70); part(232, 260, 136, '#f2c9a0', .18, 112); part(226, 266, 150, '#d92b2b', .22, 136); part(236, 258, 122, '#ffffff', .16, 106);
    part(150, 210, 48, '#6b4423', .5, 40);
    for (const [dl, nose] of [[-.2, true], [.2, false]]) {
      for (const [a, ph] of [[46, 0], [66, 3], [112, 3.1], [132, .1]]) { const lift = Math.max(0, Math.sin(tt * 10 + ph)) * 14; part(a, a + 12, 44, '#4a2d14', .07, lift, dl + (a % 2 ? .07 : -.07)); }
      part(40, 150, 102, '#8a5a2b', .28, 40, dl); part(12, 46, 96, '#8a5a2b', .18, 56, dl); part(8, 18, nose ? 80 : 78, nose ? '#ff2d2d' : '#3a2414', .09, 62, dl);
      part(24, 34, 128, '#e8dcc0', .05, 96, dl - .08); part(24, 34, 128, '#e8dcc0', .05, 96, dl + .08);
    }
    for (let k = 0; k < 6; k++) { const a = (tt * 1.1 + k / 6) % 1; puff(z + 480 + a * 120, 30 + a * 30, 4 + a * 6, '#ffe36a', .8 * (1 - a)); }
  } else if (o.veh === 'buggy') { // buggy de praia com prancha de surf
    part(0, 300, 22, '#2b2b33', .7, 16); part(20, 290, 56, '#e8453c', .74, 22); part(100, 270, 84, '#e8453c', .66, 56);
    part(96, 110, 104, '#bfe6ff', .6, 60); for (const dl of [-.31, .31]) { part(100, 270, 124, '#2b2b33', .05, 84, dl); }
    part(100, 270, 128, '#2b2b33', .7, 124); part(160, 196, 108, '#f2c9a0', .14, 84); part(158, 198, 122, '#ffd21f', .18, 108);
    part(110, 290, 136, '#ffd21f', .18, 130); part(140, 260, 138, '#2fa8ff', .09, 136);
    part(0, 10, 50, '#fff6b0', .12, 36, -.25); part(0, 10, 50, '#fff6b0', .12, 36, .25);
    for (const sx of sides) for (const a of [24, 214]) box(l + sx, Math.max(z + a, -200), z + a + 56, 58, '#15161b', .14);
    for (let k = 0; k < 4; k++) { const a = (tt * 1.6 + k / 4) % 1; puff(z + 290 + a * 120, 6 + a * 24, 6 + a * 18, '#e8d6a0', .55 * (1 - a)); }
  } else if (o.veh === 'logtruck') { // caminhão de toras
    part(0, 150, 26, '#1d1f27', .8, 10); part(0, 150, 74, '#2f6b3f', .8, 26); part(0, 120, 130, '#2f6b3f', .72, 74); part(0, 10, 118, '#bfe6ff', .58, 84); part(0, 10, 56, '#fff6b0', .13, 40, -.28); part(0, 10, 56, '#fff6b0', .13, 40, .28);
    part(118, 132, 196, '#8d92a0', .06, 130, .3); part(130, 150, 126, '#14472a', .6, 74);
    part(150, 700, 30, '#4a2d18', .82, 22);
    for (const dl of [-.26, 0, .26]) { part(158, 692, 76, '#8a5a2b', .24, 30, dl); part(156, 162, 76, '#e0c08a', .2, 40, dl); part(688, 694, 76, '#e0c08a', .2, 40, dl); }
    for (const dl of [-.13, .13]) { part(164, 686, 110, '#a8702f', .24, 76, dl); part(162, 168, 110, '#e0c08a', .2, 80, dl); }
    for (const sx of sides) for (const a of [30, 200, 460, 600]) box(l + sx, Math.max(z + a, -200), z + a + 50, 52, '#15161b', .13);
    for (let k = 0; k < 3; k++) { const a = (tt * 1.2 + k / 3) % 1; puff(z + 120 + a * 40, 196 + a * 40, 4 + a * 10, '#8a8f9c', .5 * (1 - a)); }
  } else if (o.veh === 'minecart') { // trem de mineração com vagonetas de carvão em brasa
    part(0, 150, 20, '#2b2f3a', .72, 12); part(10, 150, 78, '#7a2a1f', .72, 20); part(30, 140, 124, '#a13a2a', .5, 78); part(0, 10, 100, '#ffd21f', .14, 70, -.18); part(0, 10, 100, '#ffd21f', .14, 70, .18);
    for (let a = 170; a < 700; a += 180) { part(a, a + 150, 24, '#2b2f3a', .7, 14); part(a, a + 150, 72, '#5a4a3a', .74, 24); part(a + 8, a + 142, 90, '#14131a', .6, 72); const fl = .6 + Math.sin(tt * 8 + a) * .4; part(a + 20, a + 60, 98, fl > .7 ? '#ffb23d' : '#ff6a2d', .16, 88, -.12); part(a + 80, a + 120, 98, fl > .7 ? '#ff6a2d' : '#ffb23d', .16, 88, .14); part(150, 172, 30, '#6b4423', .1, 24); }
    for (const sx of sides) for (const a of [20, 100, 200, 330, 380, 520, 560, 640]) box(l + sx, Math.max(z + a, -200), z + a + 22, 24, '#15161b', .09);
    for (let k = 0; k < 4; k++) { const a = (tt * 1.5 + k / 4) % 1; puff(z + 60 + a * 20, 126 + a * 50, 4 + a * 10, '#ff9a3d', .8 * (1 - a)); }
  } else if (o.veh === 'bullet') { // trem-bala
    part(0, 900, 22, '#2b3248', .76, 8); part(30, 880, 106, '#f4f7fb', .78, 22); part(0, 70, 82, '#f4f7fb', .62, 22); part(0, 32, 62, '#4ff0ff', .5, 26); part(0, 8, 60, '#fff6b0', .4, 34);
    sideQuad(l, z + 30, z + 880, 34, 46, .4, '#2f7bff');
    for (let w = 90; w < 840; w += 62) sideQuad(l, z + w, z + w + 40, 62, 92, .4, '#1d2a44'), sideQuad(l, z + w + 3, z + w + 37, 65, 89, .4, '#bfe6ff');
    part(880, 900, 70, '#2b3248', .6, 22);
    for (let k = 0; k < 4; k++) { const a = (tt * 3 + k / 4) % 1; puff(z + 900 + a * 160, 30 + k * 6, 6 + a * 8, '#ffffff', .35 * (1 - a)); }
  } else if (o.veh === 'metro') { // metrô
    part(0, 780, 26, '#2b2f3a', .78, 8); part(8, 772, 128, '#d7dde6', .8, 26); part(8, 772, 136, '#aeb6c4', .6, 128);
    sideQuad(l, z + 10, z + 770, 44, 56, .41, '#c8202f'); sideQuad(l, z + 10, z + 770, 56, 62, .41, '#2f4ba8');
    for (let w = 34; w < 740; w += 120) { sideQuad(l, z + w, z + w + 80, 64, 118, .41, '#9aa5b5'); sideQuad(l, z + w + 6, z + w + 74, 68, 112, .41, '#bfe6ff'); sideQuad(l, z + w + 38, z + w + 42, 68, 112, .41, '#9aa5b5'); }
    part(0, 14, 108, '#1d2a44', .66, 40); part(2, 14, 102, '#bfe6ff', .5, 66); part(0, 12, 56, '#fff6b0', .13, 44, -.27); part(0, 12, 56, '#fff6b0', .13, 44, .27);
    for (const sx of sides) for (const a of [60, 120, 620, 680]) box(l + sx, Math.max(z + a, -200), z + a + 30, 30, '#15161b', .1);
    for (let k = 0; k < 3; k++) { const a = (tt * 1.6 + k / 3) % 1; puff(z + 330 + a * 90, 148 + a * 18, 3 + a * 6, '#4ff0ff', .8 * (1 - a)); }
  } else { // bondinho de Santa Teresa
    part(0, o.len, 22, '#2b2f3a', .78, 8); part(14, o.len, 116, '#f2c230', .8, 28); part(8, o.len + 6, 134, '#f4efe1', .84, 116);
    sideQuad(l, z + 14, z + o.len, 40, 52, .4, '#c9372c');
    for (let w = 40; w < o.len - 60; w += 90) sideQuad(l, z + w, z + w + 55, 66, 108, .4, '#1d2a44'), sideQuad(l, z + w + 4, z + w + 51, 70, 104, .4, '#bfe6ff');
    for (const sx of sides) for (const a of [70, 230, 400, 540]) box(l + sx, Math.max(z + a, -200), z + a + 26, 30, '#1b1d24', .09);
    part(300, 312, 196, '#2b2f3a', .05, 134); part(0, 14, 106, '#bfe6ff', .56, 66); part(0, 14, 138, '#c9372c', .6, 112);
    part(0, 16, 74, '#fff6b0', .13, 58, -.24); part(0, 16, 74, '#fff6b0', .13, 58, .24);
    for (let k = 0; k < 3; k++) { const a = (tt * 1.6 + k / 3) % 1; puff(z + 320 + a * 90, 198 + a * 18, 3 + a * 6, '#ffe36a', .8 * (1 - a)); } // faísca do pantógrafo
  }
}
function drawSteamWarn(o, now) { // triângulo piscando na pista de onde o trem vem
  const z = o.wz - dist; if (z < 1300 || z > ZMAX || Math.floor(now / 170) % 2) return;
  const x = P(o.l, 0).x, y = HZ + (GY - HZ) * .5, s = 30 * U;
  g.save(); g.fillStyle = '#ffd21f'; g.strokeStyle = '#14172e'; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * .95, y + s * .7); g.lineTo(x - s * .95, y + s * .7); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#14172e'; g.font = '900 ' + Math.round(s * 1.1) + 'px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y + s * .22); g.restore();
}
function trainSide(o, z) { // janelas e faixas na lateral do trem
  if (o.l === 0) return; const sx = o.l < 0 ? 1 : -1;
  const pt = (zz, hh) => { const p = P(o.l, zz); return [p.x + sx * LW * .4 * p.s, p.y - hh * U * p.s]; };
  const quad = (z0, z1, h0, h1, col) => { const a = pt(z0, h0), b = pt(z1, h0), c = pt(z1, h1), d = pt(z0, h1); g.fillStyle = col; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill(); };
  const zs = Math.max(z, -200), ze = Math.min(z + o.len, ZMAX);
  quad(zs, ze, 16, 27, '#ffd21f'); quad(zs, ze, 27, 32, '#e8453c');
  for (let w = o.wz + 40; w < o.wz + o.len - 70; w += 95) { const a = Math.max(w - dist, -200), b = w - dist + 55; if (b < -190 || a > ZMAX) continue; quad(a, b, 50, 92, '#1d2a44'); quad(a + 3, b - 3, 54, 88, '#bfe6ff'); }
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const c = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; }

// 🧱 Minecraft: pinta "pixels" de textura na frente de um bloco (r = retorno do box())
function mcFace(r, cols, rows, pal, seed) {
  const fw = r.w * r.a.s, fh = r.ya - r.ta, x0 = r.a.x - fw / 2; if (fw < 5 || fh < 5) return;
  if (fw < 12) { g.fillStyle = pal[seed % pal.length]; g.globalAlpha *= .6; g.fillRect(x0, r.ta, fw, fh * .5); g.globalAlpha /= .6; return; }
  const cw = fw / cols, ch = fh / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { g.fillStyle = pal[Math.floor(hash(seed * 7 + i * 7 + j * 13, i + j * 5 + 3) * pal.length)]; g.fillRect(x0 + i * cw, r.ta + j * ch, cw + .6, ch + .6); }
}
// Cenário lateral de cada mapa: prédios com janelas, cactos, palmeiras, pinheiros, pedras de vulcão

/* ---------- UPDATE 10: ADEREÇOS EXTRAS (os mapas deixam de parecer vazios) ----------
   Cada mapa recebe um conjunto próprio de objetos perto da pista e no meio do cenário.
   row 2 = beira da pista (bem perto, passa rápido); row 3 = meio-cenário. */
const shx = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = v => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0'); return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255); };
const hexOf = (c, d = '#808080') => /^#[0-9a-f]{6}$/i.test(c || '') ? c : d;
function fillGroup(M) {
  if (M.minecraft) return 'mine'; if (M.halloween) return 'haunt'; if (M.skyisle) return 'sky'; if (M.industrial) return 'gear'; if (M.underwater) return 'abyss';
  if (M.moon) return 'luna'; if (M.deco === 'rock') return 'volcano'; if (M.snow) return 'snow'; if (M.deco === 'cactus') return 'desert'; if (M.deco === 'palm') return 'beach';
  if (M.deco === 'samurai') return 'samurai'; if (M.deco === 'city' || M.deco === 'house' || (M.bld && M.bld.length)) return 'urban'; return 'nature';
}
const FILL_SETS = { urban: ['lamp', 'sign', 'board', 'crate', 'bench', 'fence', 'bin', 'lamp', 'board'], nature: ['bush', 'rock', 'log', 'flowers', 'fence', 'bush', 'tuft', 'mush'], desert: ['cactusS', 'rockS', 'bones', 'cactusS', 'dune', 'rockS'],
  beach: ['umbrella', 'rockS', 'bush', 'barrel', 'dune', 'umbrella', 'tuft'], snow: ['mound', 'snowman', 'rockS', 'fence', 'mound', 'pineS'], haunt: ['tomb', 'pumpkin', 'deadtree', 'ironfence', 'tomb', 'lamp', 'tomb'],
  sky: ['crystal', 'puff', 'orb', 'crystal', 'puff'], gear: ['pipe', 'crate', 'gearW', 'lamp', 'pipe', 'barrel'], abyss: ['weed', 'coral', 'orb', 'weed', 'coral'], luna: ['rockS', 'antenna', 'rockS', 'flag', 'rockS'],
  volcano: ['lavaR', 'lavaR', 'ember', 'rockS', 'lavaR'], mine: ['bush', 'fence', 'torch', 'hay', 'bush', 'rockS'], samurai: ['stoneLamp', 'fence', 'neon', 'stoneLamp', 'bamboo', 'neon'] };
function fill(sd, k, z, M, row) {
  const h1 = hash(k * 7 + row, sd + 31), h2 = hash(k * 3 + row, sd + 47), h3 = hash(k + row * 11, sd + 59), h4 = hash(k * 5 + row * 3, sd + 71);
  if (h1 < .045) return;
  const grp = fillGroup(M), set = FILL_SETS[grp] || FILL_SETS.nature, kind = set[Math.floor(h2 * set.length) % set.length];
  const lx = sd * (row === 2 ? 1.78 + h3 * .55 : 2.7 + h3 * 2.4), gnd = hexOf(M.gnd, '#4a7a3a'), pal = (M.bld && M.bld.length ? M.bld : ['#e8453c', '#2f7bff', '#ffd21f', '#27b4a3']).map(c => hexOf(c, '#e8453c'));
  const pc = pal[Math.floor(h4 * pal.length) % pal.length], night = !!(M.nocl || M.stars || M.cyber), z0 = z + 10;
  const glow = (zz, hh, r, col) => { const p = P(lx, zz); if (p.s <= 0) return; g.fillStyle = col; g.beginPath(); g.arc(p.x, p.y - hh * U * p.s, Math.max(2, r * U * p.s), 0, 7); g.fill(); };
  if (h4 > .35 && row === 3 && grp !== 'abyss') box(lx + sd * h3, z0 - 10, z0 + 55 + h2 * 40, .8, shx(gnd, .9 + h1 * .22), .5 + h3 * .9); // mancha de chão (textura voxel)
  switch (kind) {
    case 'lamp': { const col = night ? '#ffe9a0' : '#d8deea'; box(lx, z0, z0 + 7, 118, '#3a3f52', .07); box(lx - sd * .1, z0 - 4, z0 + 12, 126, col, .22, 116); if (night) { glow(z0 + 4, 112, 20, 'rgba(255,230,150,.28)'); glow(z0 + 4, 112, 9, 'rgba(255,240,190,.5)'); } break; }
    case 'sign': { box(lx, z0 + 6, z0 + 12, 84, '#5a5f70', .05); box(lx, z0, z0 + 22, 100, pc, .26, 64); break; }
    case 'board': { box(lx - sd * .22, z0 + 6, z0 + 12, 90, '#4a4f60', .06); box(lx + sd * .22, z0 + 6, z0 + 12, 90, '#4a4f60', .06); const r = box(lx, z0, z0 + 10, 138, pc, .72, 84), fw = r.w * r.a.s, fh = r.ya - r.ta;
      g.fillStyle = night ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.7)'; g.fillRect(r.a.x - fw * .38, r.ta + fh * .2, fw * .76, fh * .2); g.fillRect(r.a.x - fw * .38, r.ta + fh * .55, fw * .4, fh * .14); if (night) glow(z0, 112, 40, shx(pc, 1) + '30'); break; }
    case 'crate': { box(lx, z0, z0 + 40, 32, '#9a6b3a', .36); box(lx + sd * .08, z0 + 6, z0 + 34, 56, '#b07a42', .26, 32); break; }
    case 'bench': { box(lx, z0, z0 + 46, 20, '#7a4f2a', .22); box(lx + sd * .08, z0, z0 + 46, 38, '#8a5a30', .06, 20); break; }
    case 'bin': { box(lx, z0, z0 + 22, 34, '#3d8a5a', .2); break; }
    case 'fence': { for (let j = 0; j < 4; j++) box(lx, z0 + j * 20, z0 + j * 20 + 6, 36, '#8a5f36', .06); box(lx, z0, z0 + 66, 28, '#a87a48', .04, 20); break; }
    case 'bush': { const c = M.minecraft ? '#3a8f34' : shx('#4fa03a', .85 + h1 * .3); box(lx, z0, z0 + 46, 22, c, .5); box(lx + sd * .1, z0 + 10, z0 + 38, 38, shx(c, 1.1), .32); break; }
    case 'rock': case 'rockS': { const c = M.moon ? '#8a8f9e' : grp === 'desert' ? '#b38a52' : grp === 'snow' ? '#aab4c4' : '#7d808a'; box(lx, z0, z0 + 42, 22 + h1 * 16, c, .42); box(lx + sd * .08, z0 + 8, z0 + 30, 38 + h1 * 12, shx(c, .9), .26); break; }
    case 'log': { box(lx, z0, z0 + 64, 18, '#6b4528', .24); const p = P(lx, z0 + 64), s2 = p.s * U; g.fillStyle = '#c9a070'; g.fillRect(p.x - 5 * s2, p.y - 15 * s2, 10 * s2, 10 * s2); break; }
    case 'flowers': { for (let j = 0; j < 5; j++) { const p = P(lx + (j % 3 - 1) * .12 * sd, z0 + j * 12), s2 = p.s * U; if (z0 + j * 12 < -200) continue; g.fillStyle = '#3f8f34'; g.fillRect(p.x - 1.5 * s2, p.y - 14 * s2, 3 * s2, 14 * s2); g.fillStyle = ['#ff5c8a', '#ffd21f', '#ffffff', '#8a6bff', '#ff8a2b'][(k + j) % 5]; g.fillRect(p.x - 5 * s2, p.y - 20 * s2, 10 * s2, 8 * s2); } break; }
    case 'tuft': { for (let j = 0; j < 4; j++) { const p = P(lx + (j - 1.5) * .09, z0 + j * 9), s2 = p.s * U; if (z0 + j * 9 < -200) continue; g.fillStyle = j % 2 ? '#4a9a3a' : '#60b44a'; g.fillRect(p.x - 3 * s2, p.y - (20 + j * 4) * s2, 6 * s2, (20 + j * 4) * s2); } break; }
    case 'mush': { box(lx, z0 + 6, z0 + 16, 14, '#efe6d2', .07); box(lx, z0, z0 + 22, 26, '#d4453a', .22, 14); break; }
    case 'cactusS': { box(lx, z0, z0 + 16, 58 + h1 * 26, '#3f8f46', .12); box(lx - sd * .1, z0, z0 + 12, 46, '#4a9f52', .08, 28); break; }
    case 'bones': { box(lx, z0, z0 + 52, 8, '#efe8d8', .1); box(lx + sd * .1, z0 + 14, z0 + 26, 22, '#efe8d8', .1, 6); break; }
    case 'dune': { box(lx, z0, z0 + 90, 14, shx(gnd, 1.1), .9); box(lx, z0 + 14, z0 + 70, 24, shx(gnd, 1.18), .5, 14); break; }
    case 'umbrella': { box(lx, z0 + 4, z0 + 10, 80, '#e8e8e8', .05); box(lx, z0 - 6, z0 + 22, 90, pc, .5, 76); box(lx + sd * .3, z0, z0 + 30, 16, '#ffe9a8', .26); break; }
    case 'barrel': { box(lx, z0, z0 + 24, 36, '#8a5a30', .2); box(lx, z0 + 1, z0 + 23, 12, '#5a3a1c', .21, 14); break; }
    case 'mound': { box(lx, z0, z0 + 70, 18, '#f2f7ff', .7); box(lx, z0 + 12, z0 + 56, 30, '#ffffff', .4, 18); break; }
    case 'snowman': { box(lx, z0, z0 + 30, 26, '#ffffff', .3); box(lx, z0 + 4, z0 + 26, 50, '#f2f7ff', .22, 26); box(lx, z0 + 7, z0 + 23, 68, '#ffffff', .16, 50); const p = P(lx, z0 + 12), s2 = p.s * U; g.fillStyle = '#ff8a2b'; g.fillRect(p.x - 2 * s2, p.y - 60 * s2, 4 * s2, 4 * s2); break; }
    case 'pineS': { box(lx, z0 + 8, z0 + 18, 22, '#5a3a1c', .08); box(lx, z0, z0 + 28, 46, '#2d6a4a', .34, 14); box(lx, z0 + 4, z0 + 24, 70, '#3a7f58', .24, 40); box(lx, z0 + 8, z0 + 20, 88, '#f2f7ff', .12, 66); break; }
    case 'tomb': { box(lx, z0, z0 + 14, 40 + h1 * 14, '#7e8294', .22); box(lx, z0 + 2, z0 + 12, 52 + h1 * 14, '#8c90a2', .14, 38); break; }
    case 'pumpkin': { box(lx, z0, z0 + 30, 26, '#f2862b', .3); box(lx, z0 + 12, z0 + 18, 34, '#3f6a2a', .05, 26); if (night) glow(z0 + 15, 14, 14, 'rgba(255,170,60,.3)'); break; }
    case 'deadtree': { box(lx, z0, z0 + 14, 110, '#2b2233', .1); box(lx - sd * .18, z0, z0 + 10, 96, '#2b2233', .06, 62); box(lx + sd * .16, z0 + 2, z0 + 10, 124, '#2b2233', .06, 80); break; }
    case 'ironfence': { for (let j = 0; j < 5; j++) { box(lx, z0 + j * 14, z0 + j * 14 + 4, 50, '#1c1826', .04); } box(lx, z0, z0 + 60, 36, '#2a2436', .03, 28); break; }
    case 'crystal': { const c = ['#8fe8ff', '#c79bff', '#ff9bd8'][k % 3]; box(lx, z0, z0 + 16, 70 + h1 * 40, c, .16); box(lx + sd * .12, z0 + 8, z0 + 22, 44, shx(c, .85), .12); glow(z0 + 8, 60, 22, c + '33'); break; }
    case 'puff': { for (let j = 0; j < 3; j++) box(lx + (j - 1) * .22 * sd, z0 + j * 10, z0 + 40 + j * 10, 18 + (j % 2) * 10, '#ffffff', .4); break; }
    case 'orb': { box(lx, z0 + 4, z0 + 10, 40, '#3a4660', .05); glow(z0 + 7, 56, 22, 'rgba(120,255,240,.3)'); glow(z0 + 7, 56, 9, 'rgba(210,255,250,.8)'); break; }
    case 'pipe': { box(lx, z0, z0 + 110, 30, '#7a6a58', .12, 18); box(lx, z0 + 40, z0 + 56, 74, '#6a5a48', .12); break; }
    case 'gearW': { const p = P(lx, z0 + 10), s2 = p.s * U, r = 28 * s2, a = dist * .004 * (sd); g.save(); g.translate(p.x, p.y - 34 * s2); g.rotate(a); g.fillStyle = '#8a7a62'; for (let j = 0; j < 8; j++) { g.rotate(Math.PI / 4); g.fillRect(-3 * s2, -r - 6 * s2, 6 * s2, 10 * s2); } g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.fillStyle = '#4e4b55'; g.beginPath(); g.arc(0, 0, r * .4, 0, 7); g.fill(); g.restore(); break; }
    case 'weed': { for (let j = 0; j < 3; j++) { const sw = Math.sin(dist * .004 + j + k) * 8; const p = P(lx + (j - 1) * .1, z0 + j * 8), s2 = p.s * U; if (z0 + j * 8 < -200) continue; g.strokeStyle = j % 2 ? '#26c9a0' : '#3fe0b8'; g.lineWidth = Math.max(1.5, 5 * s2); g.beginPath(); g.moveTo(p.x, p.y); g.quadraticCurveTo(p.x + sw * s2, p.y - 40 * s2, p.x - sw * s2 * .5, p.y - 80 * s2); g.stroke(); } break; }
    case 'coral': { const c = ['#ff6fa8', '#ff9a4a', '#a97bff'][k % 3]; box(lx, z0, z0 + 24, 30, c, .24); box(lx - sd * .08, z0 + 4, z0 + 16, 52, shx(c, 1.1), .12, 30); box(lx + sd * .1, z0 + 6, z0 + 18, 44, shx(c, .9), .1, 28); glow(z0 + 12, 36, 16, c + '30'); break; }
    case 'antenna': { box(lx, z0, z0 + 8, 100, '#cfd6e6', .05); box(lx, z0 - 6, z0 + 14, 108, '#e84a4a', .16, 98); break; }
    case 'flag': { box(lx, z0, z0 + 6, 90, '#e8eaf2', .04); box(lx, z0 - 2, z0 + 30, 88, '#2f7bff', .02, 66); break; }
    case 'lavaR': { box(lx, z0, z0 + 44, 26 + h1 * 26, '#3a2228', .44); box(lx + sd * .06, z0 + 8, z0 + 34, 50 + h1 * 14, '#2a161c', .26, 26); const p = P(lx, z0 + 4), s2 = p.s * U; g.fillStyle = '#ff7a1a'; g.fillRect(p.x - 3 * s2, p.y - 24 * s2, 6 * s2, 12 * s2); break; }
    case 'ember': { const p = P(lx, z0), s2 = p.s * U, fl = Math.sin(dist * .01 + k) * 4; glow(z0, 30 + fl, 18, 'rgba(255,120,30,.28)'); glow(z0, 30 + fl, 8, 'rgba(255,200,80,.75)'); break; }
    case 'torch': { box(lx, z0, z0 + 8, 46, '#6b4a2a', .07); glow(z0 + 4, 54, 10, 'rgba(255,170,60,.35)'); box(lx, z0, z0 + 8, 56, '#ffb33a', .08, 46); break; }
    case 'hay': { box(lx, z0, z0 + 42, 34, '#d8b44a', .4); box(lx, z0 + 6, z0 + 36, 40, '#c9a23c', .3, 34); break; }
    case 'stoneLamp': { box(lx, z0 + 4, z0 + 16, 34, '#7a7f90', .12); box(lx, z0, z0 + 20, 50, '#8a90a2', .22, 34); glow(z0 + 10, 42, 14, 'rgba(255,170,80,.4)'); box(lx, z0 - 2, z0 + 22, 60, '#5a5f70', .28, 50); break; }
    case 'neon': { box(lx, z0 + 6, z0 + 12, 70, '#2a2f44', .05); const r = box(lx, z0, z0 + 10, 118, pc, .4, 72); glow(z0, 96, 34, shx(pc, 1) + '38'); break; }
    case 'bamboo': { for (let j = 0; j < 3; j++) box(lx + (j - 1) * .08, z0 + j * 7, z0 + j * 7 + 6, 90 + j * 14, '#6fb04a', .05); break; }
  }
}
function deco(sd, k, z, M, row = 0) {
  if (row >= 2) return fill(sd, k, z, M, row);
  const h = hash(k + row * 13, sd), kind = (row && M.deco2) || M.deco || 'city', INK = '#14172e';
  if (hash(k + row * 5, sd + 7) < .045) return;
  // UPDATE 9: pedras, arbustos e tufos perto da pista para os mapas não ficarem vazios
  if (row === 0 && ['voxtree', 'cactus', 'palm', 'pine', 'rock', 'crater', 'dino', 'fern'].includes(kind) && hash(k, sd + 55) < .65) {
    const fl = sd * (1.95 + hash(k, sd + 56) * .5), ft = hash(k, sd + 57);
    const base = M.deco === 'cactus' ? '#b8864a' : M.deco === 'palm' ? '#d4b86a' : M.deco === 'rock' ? '#4a2a30' : M.moon ? '#7a7f90' : M.deco === 'pine' ? '#2d7a3f' : M.deco === 'dino' ? '#5f8a45' : '#4fa03a';
    box(fl, z + 40, z + 40 + 30 + ft * 20, 16 + ft * 26, base, .3); if (ft > .45) box(fl + sd * .2, z + 52, z + 76, 10 + ft * 14, shade(base, .85), .22);
    if (M.deco === 'rock' && ft > .6) { const q = P(fl, z + 55), s2 = q.s * U; g.fillStyle = '#ff7a1a'; g.fillRect(q.x - 3 * s2, q.y - 30 * s2, 6 * s2, 6 * s2); }
  }
  // Cenários exclusivos, compostos por formas próprias (não são apenas recolorações dos mapas antigos).
  if (kind === 'pixelMine') { // 🧱 UPDATE 9: cenário no estilo Minecraft (cada bloco tem textura de pixels, com vários tipos de coisas)
    const lx = sd * (2.15 + h * .72 + row * 1.5), rr = hash(k * 3 + row, sd + 99), hh = 74 + hash(k, sd + 18) * 80;
    const LEAF = ['#2f7d2a', '#3f9438', '#256a22', '#4aa83f', '#357f2f'], LOG = ['#6b4a2a', '#5a3c20', '#7a5632', '#4e3419'], BIR = ['#e3dfd2', '#d6d2c3', '#e3dfd2', '#cfcabb', '#3a3a36'], STONE = ['#8a8a8a', '#7d7d7d', '#999999', '#8a8a8a', '#6f6f6f'];
    const blk = (zz, len, top, base, wd, col, pal, seed, c = 4, r = 4, dl = 0) => { const q = box(lx + dl, zz, zz + len, top, col, wd, base); mcFace(q, c, r, pal, seed); return q; };
    if (rr < .26 || rr < .38) { // árvore: carvalho (tronco de tora + copa de folhas) ou bétula (tronco branco)
      const birch = rr >= .26, trunk = hh * .55, pal = birch ? BIR : LOG;
      blk(z + 22, 26, trunk, 0, .2, birch ? '#e3dfd2' : '#6b4a2a', pal, k, 2, 5);
      const leafPal = birch ? ['#6ea84a', '#7dba55', '#5f9740', '#86c35e'] : LEAF;
      blk(z, 70, trunk + hh * .38, trunk * .72, .72, leafPal[0], leafPal, k + 5, 5, 4);
      blk(z + 14, 42, trunk + hh * .62, trunk + hh * .38, .46, leafPal[1], leafPal, k + 9, 3, 2);
      return;
    }
    if (rr < .5) { // pilha de pedra com minério (carvão, ferro ou diamante)
      const ore = ['#2b2b2b', '#d8af93', '#4be0d4'][k % 3], pal = STONE.concat([ore, ore]);
      blk(z, 54, 34, 0, .46, '#8a8a8a', pal, k, 4, 4); blk(z + 8, 38, 66, 34, .34, '#7d7d7d', pal, k + 3, 3, 4, sd * .06);
      return;
    }
    if (rr < .62) { // grama alta e flores (dente-de-leão, papoula, flor azul)
      const fc = ['#f6d84a', '#d9322e', '#4aa3ff', '#ffffff'][k % 4];
      for (let j = 0; j < 5; j++) { const zz = z + j * 16, p = P(lx + (j - 2) * .1 * sd, zz), s2 = p.s * U; if (zz < -200) continue; g.fillStyle = j % 2 ? '#3f9438' : '#56b04a'; g.fillRect(p.x - 3 * s2, p.y - (24 + (j % 3) * 7) * s2, 6 * s2, (24 + (j % 3) * 7) * s2); if (j % 2) { g.fillStyle = '#2f7d2a'; g.fillRect(p.x - 9 * s2, p.y - 16 * s2, 6 * s2, 12 * s2); g.fillStyle = fc; g.fillRect(p.x - 6 * s2, p.y - 40 * s2, 12 * s2, 12 * s2); g.fillStyle = '#ffd23a'; g.fillRect(p.x - 2.5 * s2, p.y - 36 * s2, 5 * s2, 5 * s2); } }
      return;
    }
    if (rr < .7) { // TNT
      const q = box(lx, z, z + 46, 46, '#d6402f', .42), fw = q.w * q.a.s, fh = q.ya - q.ta, x0 = q.a.x - fw / 2;
      mcFace(q, 4, 4, ['#d6402f', '#c43828', '#e04c3a'], k, 4, 4); g.fillStyle = '#f2efe6'; g.fillRect(x0, q.ta + fh * .36, fw, fh * .28);
      if (fw > 14) { g.fillStyle = '#2a2a2a'; g.font = '900 ' + Math.max(6, fh * .22) + 'px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TNT', q.a.x, q.ta + fh * .5); }
      return;
    }
    if (rr < .78) { // abóbora com carinha
      const q = blk(z, 46, 44, 0, .42, '#d98a1f', ['#d98a1f', '#c97a17', '#e89a2a', '#b86d12'], k, 4, 4), fw = q.w * q.a.s, fh = q.ya - q.ta, x0 = q.a.x - fw / 2;
      g.fillStyle = '#3a2208'; g.fillRect(x0 + fw * .2, q.ta + fh * .25, fw * .18, fh * .18); g.fillRect(x0 + fw * .62, q.ta + fh * .25, fw * .18, fh * .18); g.fillRect(x0 + fw * .25, q.ta + fh * .6, fw * .5, fh * .14);
      return;
    }
    if (rr < .84) { // mesa de trabalho
      const q = blk(z, 46, 44, 0, .42, '#9a6a3a', ['#9a6a3a', '#8a5a2e', '#a97a46', '#6b4423'], k, 4, 4), fw = q.w * q.a.s, fh = q.ya - q.ta, x0 = q.a.x - fw / 2;
      g.fillStyle = '#5a3a1c'; g.fillRect(x0, q.ta + fh * .1, fw, fh * .14); g.fillStyle = '#d0d0d0'; g.fillRect(x0 + fw * .15, q.ta + fh * .45, fw * .2, fh * .3); g.fillStyle = '#4a4a4a'; g.fillRect(x0 + fw * .6, q.ta + fh * .45, fw * .22, fh * .3);
      return;
    }
    if (rr < .91) { // creeper 💚
      const GP = ['#4fa84a', '#3f8f3a', '#5fba58', '#2f7a2c'];
      blk(z + 6, 30, 38, 0, .3, '#3f8f3a', GP, k, 3, 3); const q = blk(z + 2, 38, 100, 62, .34, '#4fa84a', GP, k + 2, 4, 4), fw = q.w * q.a.s, fh = q.ya - q.ta, x0 = q.a.x - fw / 2;
      blk(z + 6, 30, 66, 36, .3, '#4fa84a', GP, k + 4, 3, 3);
      g.fillStyle = '#101010'; g.fillRect(x0 + fw * .15, q.ta + fh * .22, fw * .24, fh * .24); g.fillRect(x0 + fw * .61, q.ta + fh * .22, fw * .24, fh * .24); g.fillRect(x0 + fw * .36, q.ta + fh * .46, fw * .28, fh * .26); g.fillRect(x0 + fw * .26, q.ta + fh * .62, fw * .12, fh * .22); g.fillRect(x0 + fw * .62, q.ta + fh * .62, fw * .12, fh * .22);
      return;
    }
    if (rr < .97) { // porquinho
      const PP = ['#f0a8a8', '#e89a9a', '#f6b8b8', '#dd8b8b'];
      for (const dz of [8, 50]) box(lx - .1, z + dz, z + dz + 12, 14, '#c97f7f', .1); box(lx + .1, z + 8, z + 20, 14, '#c97f7f', .1);
      blk(z, 66, 36, 14, .42, '#f0a8a8', PP, k, 4, 3); const q = blk(z - 18, 24, 40, 18, .3, '#f6b8b8', PP, k + 1, 3, 3), fw = q.w * q.a.s, fh = q.ya - q.ta, x0 = q.a.x - fw / 2;
      g.fillStyle = '#d98080'; g.fillRect(x0 + fw * .3, q.ta + fh * .5, fw * .4, fh * .3); g.fillStyle = '#1a1a1a'; g.fillRect(x0 + fw * .12, q.ta + fh * .2, fw * .14, fh * .14); g.fillRect(x0 + fw * .74, q.ta + fh * .2, fw * .14, fh * .14);
      return;
    }
    { box(lx, z, z + 10, 46, '#6b4a2a', .08); const p = P(lx, z + 5), s2 = p.s * U; g.fillStyle = '#ffd23a'; g.fillRect(p.x - 5 * s2, p.y - 58 * s2, 10 * s2, 12 * s2); g.fillStyle = '#ff7a1a'; g.fillRect(p.x - 3 * s2, p.y - 54 * s2, 6 * s2, 8 * s2); return; } // tocha
  }
  if (kind === 'haunt' || kind === 'grave') {
    const lx=sd*(2.1+h*.75+row*1.4), hh=kind==='haunt'?100+h*110:32+h*25;
    if(kind==='grave'){const r=box(lx,z,z+52,hh,'#777184',.46);const fw=r.w*r.a.s,fh=r.a.y-r.ta;g.fillStyle='#40364f';g.fillRect(r.a.x-fw*.16,r.ta+fh*.2,fw*.32,fh*.48);g.fillStyle='#b8a7c9';g.fillRect(r.a.x-fw*.07,r.ta+fh*.25,fw*.14,fh*.38);return;}
    box(lx,z,z+90,hh,'#30253e',.72);box(lx,z+10,z+84,hh*.88,'#514057',.56);
    const r=box(lx,z+12,z+78,hh*.92,'#30243b',.34),fw=r.w*r.a.s,fh=r.a.y-r.ta;
    g.fillStyle='#ff8b37';g.fillRect(r.a.x-fw*.28,r.ta+fh*.3,fw*.18,fh*.17);g.fillRect(r.a.x+fw*.1,r.ta+fh*.3,fw*.18,fh*.17);
    g.fillStyle='#160f24';g.fillRect(r.a.x-fw*.24,r.ta+fh*.34,fw*.08,fh*.1);g.fillRect(r.a.x+fw*.15,r.ta+fh*.34,fw*.08,fh*.1);g.fillStyle='#21152c';g.fillRect(r.a.x-fw*.12,r.ta+fh*.64,fw*.24,fh*.12);
    if(k%2===0){g.strokeStyle='#a7a0b8';g.lineWidth=Math.max(1,2*U*r.a.s);g.beginPath();g.moveTo(r.a.x-fw*.55,r.ta+fh*.12);g.lineTo(r.a.x+fw*.55,r.ta+fh*.12);g.stroke();}return;
  }
  if (kind === 'skyisle' || kind === 'crystal') {
    const lx=sd*(2.2+h*.7+row*1.4), hh=kind==='crystal'?55+h*70:80+h*90;
    if(kind==='skyisle'){const r=box(lx,z,z+100,hh*.62,'#78c9a4',.78);box(lx,z+15,z+85,hh*.4,'#6c9b9c',.52);box(lx,z+30,z+70,hh*.2,'#8f7c91',.3);const fw=r.w*r.a.s;g.fillStyle='#d9f4d8';g.fillRect(r.a.x-fw*.42,r.ta+10*U,fw*.2,5*U);box(lx,z+30,z+62,hh*.5,'#5d9b65',.16);}else{const r=box(lx,z,z+44,hh,'#64fff0',.24);g.fillStyle='#c5fff8';g.beginPath();g.moveTo(r.a.x,r.ta-12*U*r.a.s);g.lineTo(r.a.x+r.w*r.a.s*.22,r.ta+r.w*r.a.s*.3);g.lineTo(r.a.x,r.ta+r.w*r.a.s*.55);g.lineTo(r.a.x-r.w*r.a.s*.2,r.ta+r.w*r.a.s*.3);g.closePath();g.fill();}return;
  }
  if (kind === 'gear') {
    const lx=sd*(2.1+h*.75+row*1.4), hh=65+h*100, r=box(lx,z,z+100,hh,k%2?'#7b6b59':'#a38a68',.6), fw=r.w*r.a.s,fh=r.a.y-r.ta;
    g.fillStyle='#3f414b';g.fillRect(r.a.x-fw*.42,r.ta+fh*.18,fw*.84,fh*.2);g.fillStyle='#f0bd53';for(let j=0;j<4;j++)g.fillRect(r.a.x-fw*.38+j*fw*.22,r.ta+fh*.22,fw*.12,fh*.1);
    g.strokeStyle='#d8a44b';g.lineWidth=Math.max(2,5*U*r.a.s);g.beginPath();g.arc(r.a.x,r.ta+fh*.63,fw*.22,0,Math.PI*2);g.stroke();g.beginPath();g.arc(r.a.x,r.ta+fh*.63,fw*.09,0,Math.PI*2);g.stroke();return;
  }
  if (kind === 'abyss' || kind === 'coral') {
    const lx=sd*(2.2+h*.7+row*1.5), hh=50+h*95;
    if(kind==='coral'){const r=box(lx,z,z+40,hh*.6,'#ff6b9d',.22);const p=P(lx,z);g.strokeStyle=k%2?'#68fff0':'#b77bff';g.lineWidth=Math.max(2,4*p.s);g.beginPath();g.moveTo(p.x,p.y);g.lineTo(p.x-15*U*p.s,p.y-hh*.45*U*p.s);g.moveTo(p.x,p.y-hh*.25*U*p.s);g.lineTo(p.x+17*U*p.s,p.y-hh*.55*U*p.s);g.stroke();box(lx+sd*.18,z,z+28,hh*.35,'#f7a0d0',.14);}else{box(lx,z,z+70,hh,'#12556a',.5);const r=box(lx,z+8,z+60,hh*.82,'#1d8290',.28),fw=r.w*r.a.s,fh=r.a.y-r.ta;g.fillStyle='#72fff0';for(let j=0;j<4;j++)g.fillRect(r.a.x-fw*.35+j*fw*.2,r.ta+fh*(.2+(j%2)*.23),Math.max(1,fw*.08),Math.max(1,fh*.08));}return;
  }
  if (kind === 'dino' || kind === 'fern') {
    const lx=sd*(2.1+h*.75+row*1.5), hh=kind==='dino'?105+h*70:50+h*55;
    if(kind==='fern'){box(lx,z,z+30,hh*.55,'#3d8a50',.18);const p=P(lx,z);g.strokeStyle='#8edb71';g.lineWidth=Math.max(2,4*p.s);for(let j=0;j<5;j++){g.beginPath();g.moveTo(p.x,p.y-hh*.1*j*U*p.s);g.lineTo(p.x+sd*(12+j*2)*U*p.s,p.y-(j+2)*hh*.1*U*p.s);g.stroke();}return;}
    const r=box(lx,z,z+100,hh*.52,'#5b8e47',.64);const fw=r.w*r.a.s,fh=r.a.y-r.ta;box(lx+sd*.22,z,z+55,hh*.24,'#719d50',.22);g.fillStyle='#d4b66b';g.fillRect(r.a.x+sd*fw*.2,r.ta+fh*.34,fw*.3,fh*.12);g.fillStyle='#fff3ce';g.fillRect(r.a.x+sd*fw*.32,r.ta+fh*.3,Math.max(1,fw*.045),Math.max(1,fh*.05));box(lx-sd*.12,z,z+28,hh*.22,'#8b6d49',.15);return;
  }
  if (kind === 'samurai' || kind === 'lantern') {
    const lx=sd*(2.1+h*.75+row*1.5), hh=kind==='lantern'?45+h*25:90+h*100;
    if(kind==='lantern'){const r=box(lx,z,z+38,hh,'#e84a86',.25);const fw=r.w*r.a.s,fh=r.a.y-r.ta;g.fillStyle='#ffd27c';g.fillRect(r.a.x-fw*.3,r.ta+fh*.2,fw*.6,fh*.6);g.fillStyle='#ffefff';g.fillRect(r.a.x-fw*.12,r.ta+fh*.3,fw*.24,fh*.25);return;}
    const r=box(lx,z,z+80,hh,'#312a59',.58),fw=r.w*r.a.s,fh=r.a.y-r.ta;g.fillStyle='#ff4fd8';g.fillRect(r.a.x-fw*.42,r.ta+fh*.22,fw*.84,fh*.07);g.fillStyle='#4ff0ff';g.fillRect(r.a.x-fw*.25,r.ta+fh*.42,fw*.5,fh*.06);g.fillStyle='#17162d';g.fillRect(r.a.x-fw*.12,r.ta+fh*.7,fw*.24,fh*.3);return;
  }

  if (kind === 'city') {
    if ((k + row) % 2) return;
    const r = box(sd * (3.3 + row * 2.4), z, z + 380, 150 + h * 420, M.bld[k % 4 | 0], 1.5), fh = r.a.y - r.ta, fw = r.w * r.a.s;
    const rows = Math.min(12, Math.floor(fh / (30 * U * r.a.s))), cols = 4;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      g.fillStyle = hash(k * 31 + i * 7 + j, sd) > .35 ? (M.win || '#fff3a8') : 'rgba(20,23,46,.35)';
      g.fillRect(r.a.x - fw / 2 + fw * (.1 + j * .22), r.ta + fh * .06 + i * (fh * .9 / rows), fw * .14, fh * .9 / rows * .55);
    }
    g.fillStyle = INK; g.fillRect(r.a.x - 2 * r.a.s, r.ta - 28 * U * r.a.s, 4 * r.a.s, 28 * U * r.a.s); // antena
    return;
  }
  if (kind === 'voxtree') { // árvore de cubos, estilo Crossy Road: tronco, copa e bloco de cima
    const lx = sd * (2.2 + h * .6 + row * 1.6), hh = 80 + hash(k, sd + 9) * 90, lc = k % 3 ? '#8cc63f' : '#a5da4b';
    box(lx, z + 12, z + 58, hh * .4, '#6b4528', .18);
    const r = box(lx, z, z + 70, hh, lc, .52, hh * .3), fh = r.ya - r.ta, fw = r.w * r.a.s;
    g.fillStyle = 'rgba(0,50,0,.10)'; for (let i = 1; i < 4; i++) g.fillRect(r.a.x - fw / 2, r.ta + fh * i / 4, fw, Math.max(1, 2.2 * r.a.s));
    box(lx, z + 8, z + 62, hh * 1.22, (k % 3 ? '#a5da4b' : '#b9e65a'), .32, hh);
    return;
  }
  if (kind === 'house') { // casinha de blocos com telhado
    const lx = sd * (2.2 + h * .5 + row * 1.6), hh = 90 + h * 70, r = box(lx, z, z + 110, hh, ['#f5c6a5', '#f6e3a1', '#a7d8e8', '#e9a8b8'][(k + row) % 4], .62), fw = r.w * r.a.s, fh = r.a.y - r.ta, x = r.a.x;
    g.fillStyle = '#b5532e'; g.beginPath(); g.moveTo(x - fw * .56, r.ta); g.lineTo(x + fw * .56, r.ta); g.lineTo(x + fw * .3, r.ta - fh * .28); g.lineTo(x - fw * .3, r.ta - fh * .28); g.closePath(); g.fill();
    g.fillStyle = '#7a4a2a'; g.fillRect(x - fw * .1, r.a.y - fh * .4, fw * .2, fh * .4); g.fillStyle = '#bfe6ff'; g.fillRect(x - fw * .38, r.ta + fh * .25, fw * .2, fh * .2); g.fillRect(x + fw * .18, r.ta + fh * .25, fw * .2, fh * .2);
    return;
  }
  if (kind === 'cactus' || kind === 'palm' || kind === 'pine' || kind === 'rock' || kind === 'crater') { // versões em blocos
    const lx = sd * (2.2 + h * .6 + row * 1.6), hh = 60 + h * 90; let r, fw, fh;
    if (kind === 'cactus') { r = box(lx, z, z + 50, hh, '#4fae5a', .26); box(lx - sd * .32, z, z + 50, hh * .5, '#63c46e', .18); }
    else if (kind === 'palm') { r = box(lx, z, z + 40, hh * 1.3, '#9a6a3a', .18); fw = r.w * r.a.s; fh = r.a.y - r.ta; g.fillStyle = '#2fa84f'; g.fillRect(r.a.x - fw * 2.4, r.ta - fh * .04, fw * 4.8, fh * .12); g.fillStyle = '#58d06a'; g.fillRect(r.a.x - fw * 1.5, r.ta - fh * .14, fw * 3, fh * .11); }
    else if (kind === 'pine') { const sn = M.snow; r = box(lx, z, z + 60, hh * .55, sn ? '#b9dcf5' : '#1f7a4a', .56); box(lx, z, z + 60, hh * .8, sn ? '#d4ecfa' : '#2a9d5c', .38); box(lx, z, z + 60, hh, sn ? '#f2fbff' : '#43b86b', .2); fw = r.w * r.a.s; fh = r.a.y - r.ta; g.fillStyle = '#5b3b27'; g.fillRect(r.a.x - fw * .12, r.a.y - fh * .18, fw * .24, fh * .18); }
    else if (kind === 'rock') { r = box(lx, z, z + 80, hh, '#4a3038', .42); fw = r.w * r.a.s; fh = r.a.y - r.ta; g.fillStyle = '#ff7a1a'; g.fillRect(r.a.x - fw * .07, r.ta + fh * .2, fw * .14, fh * .6); }
    else { r = box(lx, z, z + 50, 25 + h * 40, '#9aa0ae', .38); box(lx - sd * .2, z, z + 50, 15 + h * 20, '#8a90a0', .2); if (k % 4 === 0) { g.fillStyle = '#e8ecff'; g.fillRect(r.a.x, r.ta - 70 * U * r.a.s, 3 * U * r.a.s + 1, 70 * U * r.a.s); g.fillStyle = '#ff5468'; g.fillRect(r.a.x + 3 * U * r.a.s, r.ta - 70 * U * r.a.s, 26 * U * r.a.s, 16 * U * r.a.s); } }
    return;
  }
  const p = P(sd * (2.2 + h * .6 + row * 1.6), z), s = p.s * U, x = p.x, y = p.y;
  g.strokeStyle = INK; g.lineWidth = Math.max(1, 3 * p.s);
  if (kind === 'cactus') {
    const hh = (90 + h * 80) * s; g.fillStyle = '#3f9b4f';
    for (const [a, b, w, hgt, r] of [[-9, 0, 18, hh, 9], [-30, hh * .5 / s, 24, 11, 5], [-30, hh * .72 / s, 11, hh * .3 / s, 5], [6, hh * .4 / s, 24, 11, 5], [19, hh * .62 / s, 11, hh * .3 / s, 5]]) {
      g.beginPath(); g.roundRect(x + a * s, y - (b === 0 ? hh : b * s), w * s, (b === 0 ? hh : hgt * s), r * s); g.fill(); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x - 5 * s, y - hh + 6 * s, 4 * s, hh - 12 * s); g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x + 3 * s, y - hh + 6 * s, 4 * s, hh - 12 * s);
    g.fillStyle = '#f7f3d0'; for (let i = 0; i < 6; i++) g.fillRect(x - 8 * s + (i % 2) * 14 * s, y - hh * (.15 + i * .14), 2 * s, 2 * s);
    g.fillStyle = '#ff5c9a'; g.beginPath(); g.arc(x, y - hh - 4 * s, 6 * s, 0, 7); g.fill(); g.fillStyle = '#ffd21f'; g.beginPath(); g.arc(x, y - hh - 4 * s, 2.5 * s, 0, 7); g.fill();
  } else if (kind === 'palm') {
    const hh = (150 + h * 90) * s, tx = x - sd * 8 * s; g.strokeStyle = '#8a5a2b'; g.lineWidth = Math.max(2, 9 * s);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - sd * 20 * s, y - hh * .5, tx, y - hh); g.stroke();
    g.fillStyle = '#2fa84f'; g.strokeStyle = INK; g.lineWidth = Math.max(1, 2.5 * p.s);
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * .7; g.beginPath(); g.ellipse(tx + Math.cos(a) * 30 * s, y - hh + Math.sin(a) * 18 * s, 32 * s, 8 * s, a, 0, 7); g.fill(); g.stroke(); }
  } else if (kind === 'pine') {
    const hh = (110 + h * 90) * s; g.fillStyle = '#6b4423'; g.fillRect(x - 5 * s, y - 20 * s, 10 * s, 20 * s);
    for (let i = 0; i < 3; i++) {
      const w = (44 - i * 10) * s, yy = y - 20 * s - i * hh * .28;
      g.fillStyle = M.snow ? (i % 2 ? '#d9efff' : '#b9dcf5') : (i % 2 ? '#2a9d5c' : '#1f7a4a');
      g.beginPath(); g.moveTo(x - w, yy); g.lineTo(x, yy - hh * .45); g.lineTo(x + w, yy); g.closePath(); g.fill(); g.stroke();
    }
  } else if (kind === 'crater') { // cratera com borda e, de vez em quando, uma bandeira
    const w = (46 + h * 40) * s; g.fillStyle = '#9aa0ae'; g.beginPath(); g.ellipse(x, y, w, w * .28, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#5d6270'; g.beginPath(); g.ellipse(x, y + w * .04, w * .72, w * .2, 0, 0, 7); g.fill();
    if (k % 4 === 0) { g.strokeStyle = '#e8ecff'; g.lineWidth = Math.max(1, 3 * p.s); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 90 * s); g.stroke(); g.fillStyle = '#ff5468'; g.fillRect(x, y - 90 * s, 34 * s, 20 * s); }
  } else if (kind === 'rock') {
    const hh = (100 + h * 140) * s, w = (40 + h * 30) * s; g.fillStyle = '#3a2a30';
    g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w * .3, y - hh); g.lineTo(x + w * .1, y - hh * .7); g.lineTo(x + w * .5, y - hh * .95); g.lineTo(x + w, y); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#ff7a1a'; g.lineWidth = Math.max(1, 3 * p.s); g.beginPath(); g.moveTo(x - w * .1, y); g.lineTo(x, y - hh * .5); g.stroke(); // lava
  }
}
// Câmera: acompanha o personagem (desce ao rolar/trocar de pista, sobe de leve ao pular) com animação suave
let camY = 0, camR = 0, camT = 0;
function draw(now) {
  const dtc = Math.min(.05, Math.max(0, (now - (camT || now)) / 1000)); camT = now;
  const playing = st === 'play' || st === 'dying', side = playing ? pl.lane - pl.px : 0;
  const tY = playing ? (pl.roll > 0 ? 16 : 0) + Math.abs(side) * 9 - Math.min(14, pl.jy * .07) : 0, tR = playing ? side * .012 : 0;
  const k = 1 - Math.exp(-dtc * 9); camY += (tY + camB - camY) * k; camR += (tR - camR) * k;
  { const M0 = MAPS[CFG.map]; g.fillStyle = M0.sky[0]; g.fillRect(0, 0, W, HZ); g.fillStyle = M0.gnd; g.fillRect(0, HZ, W, H - HZ); } // cobre as bordas durante o balanço da câmera
  g.save(); g.translate(W / 2, GY); g.rotate(camR); g.scale(CFG.stretch || 1, 1); g.translate(-W / 2, -GY + camY * U);
  drawWorld(now);
  g.restore();
}
function drawBiomeHorizon(M, now) {
  const h = HZ, shift = (dist * .018) % Math.max(1, W), idx = MAPS.indexOf(M);
  const land = (color, y, a=0, b=0) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(-20, h);
    g.bezierCurveTo(W*.18, h-y+a, W*.25, h-y+b, W*.5, h-y);
    g.bezierCurveTo(W*.72, h-y-b, W*.84, h-y+a, W+20, h-y*.68);
    g.lineTo(W+20,h+10); g.lineTo(-20,h+10); g.closePath(); g.fill();
  };
  if (M.minecraft) {
    // Horizonte em degraus, montanhas quadradas e nuvens em blocos.
    for(let i=0;i<7;i++){const x=((i*173-shift*.18)%(W+260)+W+260)%(W+260)-130,y=h*(.12+(i%3)*.13),w=(70+i%3*38)*U,hh=14*U;g.fillStyle='rgba(255,255,255,.92)';g.fillRect(x,y,w,hh);g.fillRect(x+w*.18,y-hh*.9,w*.5,hh);g.fillRect(x-w*.12,y+hh*.5,w*.3,hh*.6);g.fillStyle='rgba(200,225,250,.9)';g.fillRect(x,y+hh*.65,w,hh*.35);} // nuvens quadradas
    for(let layer=0;layer<3;layer++){const base=h*(.72+layer*.09),step=Math.max(10,22*U);g.fillStyle=['#75b85b','#5b9848','#407b3b'][layer];for(let x=-step-(shift*(.12+layer*.1)%step);x<W+step;x+=step){const n=Math.floor(hash(Math.floor(x/step)+layer*41,layer+6)*4);g.fillRect(x,base-n*step,step+1,(h-base)+n*step);g.fillStyle=['#4f963f','#3f8337','#2d6d30'][layer];g.fillRect(x,base-n*step,step+1,Math.max(2,step*.2));g.fillStyle=['#75b85b','#5b9848','#407b3b'][layer];}}
    return;
  }
  if (M.halloween) {
    land('#382540',h*.23,7*U,16*U);land('#20172e',h*.12,3*U,9*U);
    // silhuetas da mansão e árvores tortas, com lua laranja
    g.fillStyle='#171222';g.fillRect(W*.12,h*.48,W*.19,h*.4);g.beginPath();g.moveTo(W*.09,h*.49);g.lineTo(W*.215,h*.32);g.lineTo(W*.34,h*.49);g.closePath();g.fill();
    for(let i=0;i<7;i++){const x=((i*157+shift*.27)%(W+80))-40,y=h*.83;g.strokeStyle='#171222';g.lineWidth=5*U;g.beginPath();g.moveTo(x,y);g.lineTo(x+((i%2)?-9:11)*U,y-55*U);g.lineTo(x+((i%2)?-23:27)*U,y-67*U);g.stroke();}
    g.fillStyle='#ffb14b';for(let i=0;i<5;i++){const x=((i*211+shift*.4)%(W+50))-25,y=h*(.76+(i%3)*.055),r=(4+i%3*2)*U;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.fillStyle='#30203b';g.fillRect(x-r*.45,y-r*.25,r*.25,r*.4);g.fillRect(x+r*.15,y-r*.25,r*.25,r*.4);g.fillStyle='#ffb14b';}
    return;
  }
  if (M.skyisle) {land('#a3d9e8',h*.23,9*U,17*U);land('#79c9bc',h*.14,5*U,9*U);for(let i=0;i<6;i++){const x=((i*177+shift*.35)%(W+100))-50,y=h*(.68+(i%3)*.07),w=(42+i%3*18)*U;g.fillStyle='#6dbd9f';g.fillRect(x,y,w,8*U);g.fillStyle='#8d8aaf';g.fillRect(x+w*.2,y+8*U,w*.6,18*U);g.fillStyle='#d8f4e8';g.fillRect(x+w*.15,y-3*U,w*.7,3*U);}return;}
  if (M.industrial) {land('#6b5d58',h*.2,4*U,15*U);for(let i=0;i<9;i++){const x=((i*143+shift*.4)%(W+70))-35,base=h*.9,hh=(35+(i*23)%70)*U;g.fillStyle=i%2?'#4d4b57':'#71636a';g.fillRect(x,base-hh,22*U,hh);g.fillStyle='#d5a14c';g.fillRect(x+5*U,base-hh-5*U,12*U,5*U);g.strokeStyle='#413b49';g.lineWidth=3*U;g.beginPath();g.moveTo(x+11*U,base-hh);g.lineTo(x+11*U,base-hh-24*U);g.stroke();}return;}
  if (M.underwater) {land('#0a354b',h*.17,4*U,10*U);for(let i=0;i<24;i++){const x=((i*83+shift*.5)%(W+30))-15,y=h*(.42+hash(i,5)*.48),r=(2+hash(i,8)*4)*U;g.strokeStyle=i%2?'#57fff0':'#9c7dff';g.lineWidth=Math.max(1,U);g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.stroke();}for(let i=0;i<7;i++){const x=((i*137+shift*.3)%(W+80))-40,y=h*.91;g.fillStyle=['#ff6b9d','#57d6d1','#9578ff'][i%3];for(let j=0;j<4;j++)g.fillRect(x+j*5*U,y-(j%2)*12*U,4*U,20*U);}return;}
  if (M.fossils) {land('#94b77a',h*.2,10*U,14*U);land('#6f9858',h*.11,3*U,10*U);for(let i=0;i<5;i++){const x=((i*183+shift*.32)%(W+90))-45,y=h*(.86+(i%2)*.03);g.fillStyle='#6a8a52';g.fillRect(x,y-45*U,12*U,45*U);g.fillRect(x-14*U,y-40*U,18*U,9*U);g.fillRect(x+8*U,y-30*U,17*U,8*U);g.fillStyle='#c5b98b';g.fillRect(x+3*U,y-58*U,5*U,7*U);}return;}
  if (M.samurai) {land('#32234f',h*.17,3*U,10*U);for(let i=0;i<13;i++){const x=((i*107+shift*.35)%(W+70))-35,w=(15+i%4*7)*U,hh=(30+(i*19)%70)*U,y=h*.91-hh;g.fillStyle=['#36274e','#253b60','#66274f'][i%3];g.fillRect(x,y,w,hh);g.fillStyle=i%2?'#ff4fd8':'#4ff0ff';g.fillRect(x+w*.2,y+8*U,w*.55,2*U);g.fillRect(x+w*.3,y+20*U,w*.35,2*U);}for(let i=0;i<4;i++){const x=W*(.15+i*.22),y=h*.7;g.strokeStyle='#e4a0d0';g.lineWidth=2*U;g.beginPath();g.moveTo(x,y);g.lineTo(x+10*U,y-30*U);g.stroke();g.fillStyle='#ffcf88';g.fillRect(x+6*U,y-35*U,7*U,13*U);}return;}
  if (idx === 0 || idx === 3 || idx === 7) {
    land(idx === 3 ? '#8ca8bb' : '#42785e', h*.28, 8*U, 20*U);
    land(idx === 3 ? '#c9dfeb' : '#28583e', h*.16, 12*U, 4*U);
    const snow = idx === 3;
    for (let i=0;i<12;i++) {
      const x=((i*137+shift*.42)%(W+100))-50, y=h*(.84+(i%3)*.035), size=(.36+(i%4)*.12)*U;
      g.fillStyle=snow?'#e8f6ff':'#17472f'; g.beginPath(); g.moveTo(x,y); g.lineTo(x-22*size,y+42*size); g.lineTo(x+22*size,y+42*size); g.closePath(); g.fill();
      if(snow){g.fillStyle='#fff';g.beginPath();g.moveTo(x,y);g.lineTo(x-8*size,y+15*size);g.lineTo(x,y+12*size);g.lineTo(x+8*size,y+15*size);g.closePath();g.fill();}
    }
  } else if (idx === 5) {
    land('#e4ad65', h*.2, 12*U, 5*U); land('#c98a4f',h*.105,6*U,15*U);
    g.fillStyle='#fff0bc'; for(let i=0;i<24;i++){const x=(hash(i,31)*W+shift*.22)%W,y=h*(.75+hash(i,32)*.22);g.fillRect(x,y,2*U,1.5*U);}
  } else if (idx === 6) {
    g.fillStyle='#35b7dc';g.fillRect(0,h*.82,W,h*.18);
    for(let i=0;i<9;i++){const x=((i*113+shift*.75)%(W+80))-40,y=h*(.84+(i%4)*.035);g.strokeStyle=i%2?'#c8f6ff88':'#fff8';g.lineWidth=Math.max(1,U*1.5);g.beginPath();g.moveTo(x,y);g.lineTo(x+24*U,y);g.stroke();}
    land('#d9c08a',h*.07,4*U,8*U);
    for(let i=0;i<5;i++){const x=((i*181+shift*.35)%(W+100))-50,y=h*.83;g.strokeStyle='#755438';g.lineWidth=3*U;g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x-8*U,y-22*U,x+4*U,y-46*U);g.stroke();g.fillStyle='#27784d';for(let j=0;j<5;j++){g.beginPath();g.ellipse(x+(j-2)*8*U,y-45*U-Math.abs(j-2)*3*U,15*U,4*U,(j-2)*.25,0,7);g.fill();}}
  } else if (idx === 8) {
    land('#481c28',h*.16,5*U,12*U);
    g.fillStyle='#291621';g.beginPath();g.moveTo(W*.24,h);g.lineTo(W*.4,h*.43);g.lineTo(W*.52,h*.55);g.lineTo(W*.69,h*.33);g.lineTo(W*.87,h);g.closePath();g.fill();
    g.strokeStyle='#ff692d';g.lineWidth=4*U;g.shadowColor='#ff512b';g.shadowBlur=14*U;g.beginPath();g.moveTo(W*.51,h*.57);g.lineTo(W*.48,h*.75);g.lineTo(W*.55,h*.86);g.stroke();g.shadowBlur=0;
  } else if (idx === 9 || idx === 11 || idx === 12 || idx === 1 || idx === 2) {
    land(idx===9||idx===12?'#211344':idx===2?'#151943':idx===11?'#546a78':'#78465c',h*.12,4*U,9*U);
    const colors=idx===9||idx===12?['#42307a','#233b70','#65317a']:M.bld;
    for(let i=0;i<16;i++){const x=((i*91+shift*.28)%(W+120))-60,w=(12+i%4*5)*U,hh=(24+(i*29)%54)*U,y=h*.91-hh;g.fillStyle=colors[i%colors.length]||'#33415e';g.fillRect(x,y,w,hh);g.fillStyle=idx===9?'#8df7ff':idx===2?'#ffe27a':'#ffd890';for(let wy=y+5*U;wy<h*.9;wy+=9*U)for(let wx=x+3*U;wx<x+w-2*U;wx+=7*U){g.globalAlpha=.38+(i%3)*.15;g.fillRect(wx,wy,2*U,3*U);}g.globalAlpha=1;}
    if(idx===9||idx===12){g.fillStyle=idx===12?'#4ff0ff':'#ff4cc9';g.shadowColor=g.fillStyle;g.shadowBlur=12*U;g.fillRect(W*.22,h*.68,3*U,h*.14);g.fillStyle='#ff4cc9';g.fillRect(W*.78,h*.72,2*U,h*.1);g.shadowBlur=0;}
  } else if (idx === 10) {
    g.fillStyle='#737989';g.beginPath();g.ellipse(W*.23,h*.94,W*.22,h*.11,0,Math.PI,Math.PI*2);g.fill();g.beginPath();g.ellipse(W*.78,h*.96,W*.3,h*.1,0,Math.PI,Math.PI*2);g.fill();
    g.strokeStyle='#d4d8e4';g.lineWidth=2*U;g.beginPath();g.ellipse(W*.24,h*.94,W*.13,h*.045,0,0,Math.PI*2);g.stroke();
  } else {
    land('#a56b64',h*.14,8*U,18*U);
  }
}

function drawWorld(now) {
  // céu e sol
  const M = MAPS[CFG.map], sky = g.createLinearGradient(0, 0, 0, HZ + 10); sky.addColorStop(0, M.sky[0]); sky.addColorStop(.7, M.sky[1]); sky.addColorStop(1, M.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, HZ + 10);
  if (CFG.map === 2 || M.stars) { g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) g.fillRect(hash(i, 1) * W, hash(i, 2) * HZ * .9, 2, 2); }
  g.fillStyle = M.orb; if (M.earth) { g.beginPath(); g.arc(W * .72, HZ - 40 * U, 46 * U, 0, 7); g.fill(); } else g.fillRect(W * .72 - 40 * U, HZ - 80 * U, 80 * U, 80 * U);
  if (M.earth) { // Terra no céu da Lua
    g.save(); g.beginPath(); g.arc(W * .72, HZ - 40 * U, 46 * U, 0, 7); g.clip(); g.fillStyle = '#3fbf6a';
    g.beginPath(); g.ellipse(W * .72 - 12 * U, HZ - 52 * U, 20 * U, 12 * U, .5, 0, 7); g.fill();
    g.beginPath(); g.ellipse(W * .72 + 14 * U, HZ - 26 * U, 16 * U, 10 * U, -.4, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(W * .72 - 50 * U, HZ - 70 * U, 100 * U, 6 * U); g.restore();
  }
  if (!M.nocl) { // nuvens
    g.fillStyle = 'rgba(255,255,255,.78)';
    for (let i = 0; i < 5; i++) {
      const T = W + 300, cx = ((hash(i, 3) * T - dist * .03 * (1 + i * .2)) % T + T) % T - 150, cy = HZ * (.15 + hash(i, 4) * .5), s = (30 + hash(i, 5) * 30) * U;
      for (const [dx, dy, rx, ry] of [[0, 0, 1.6, .5], [-.7, .1, 1, .4], [.8, .1, 1.1, .42]]) { g.fillRect(cx + (dx - rx) * s, cy + (dy - ry) * s, rx * 2 * s, ry * 2 * s); }
    }
  }
  if (skyImage && skyImage.complete && skyImage.naturalWidth > 0) {
    g.save(); g.globalAlpha = .92; g.drawImage(skyImage, 0, 0, W, Math.max(1, HZ + 10));
    g.fillStyle = 'rgba(8,13,28,.08)'; g.fillRect(0, 0, W, HZ + 10); g.restore();
  }
  drawBiomeHorizon(M, now);
  if (M.halloween) {
    // Sustos surpresa curtos e não piscantes: aparição lateral, sem alterar colisões/física.
    const phase=(now%19000), active=phase>13200&&phase<14600;
    if(active){const fade=Math.min(1,(phase-13200)/180,(14600-phase)/220);g.save();g.globalAlpha=Math.max(0,fade)*.92;const x=W*(phase%2?.18:.82),y=HZ*.58,s=U;
      g.fillStyle='#171020';g.beginPath();g.ellipse(x,y,32*s,42*s,0,0,Math.PI*2);g.fill();g.fillRect(x-22*s,y+20*s,44*s,45*s);
      g.fillStyle='#ff9d42';g.beginPath();g.moveTo(x-18*s,y-8*s);g.lineTo(x-5*s,y-1*s);g.lineTo(x-18*s,y+5*s);g.closePath();g.fill();g.beginPath();g.moveTo(x+18*s,y-8*s);g.lineTo(x+5*s,y-1*s);g.lineTo(x+18*s,y+5*s);g.closePath();g.fill();g.fillStyle='#f4d6c7';g.fillRect(x-10*s,y+13*s,20*s,5*s);g.restore();}
  }

  if (M.rain) { g.save(); g.strokeStyle='rgba(218,238,255,.34)'; g.lineWidth=Math.max(1,U); for(let i=0;i<46;i++){const x=(hash(i,81)*W-now*(.08+hash(i,82)*.06)%(W+30)+W+30)%(W+30),y=(hash(i,83)*HZ+now*(.12+hash(i,84)*.08))%HZ;g.beginPath();g.moveTo(x,y);g.lineTo(x-5*U,y+13*U);g.stroke();}g.restore(); }

  if (M.rio) { // mar, Pão de Açúcar com bondinho aéreo e brilho do sol
    const tt = now / 1000, sy = HZ * .7, sea = g.createLinearGradient(0, sy, 0, HZ); sea.addColorStop(0, '#1f9fd6'); sea.addColorStop(1, '#8be0ee');
    g.fillStyle = sea; g.fillRect(0, sy, W, HZ - sy);
    g.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 26; i++) { const x = (hash(i, 5) * W + tt * 14 * (1 + hash(i, 6))) % W, y = sy + (HZ - sy) * hash(i, 7); g.fillRect(x, y, (10 + 18 * hash(i, 8)) * U, 1.6 * U); }
    const bx = W * .76, pk = HZ * .42, gl = g.createRadialGradient(W * .2, HZ * .3, 0, W * .2, HZ * .3, W * .35); gl.addColorStop(0, 'rgba(255,240,170,.35)'); gl.addColorStop(1, 'rgba(255,240,170,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, HZ);
    g.fillStyle = '#8b8e99'; g.beginPath(); g.moveTo(bx - 120 * U, HZ); g.bezierCurveTo(bx - 95 * U, pk + 40 * U, bx - 60 * U, pk, bx - 10 * U, pk); g.bezierCurveTo(bx + 50 * U, pk, bx + 90 * U, pk + 60 * U, bx + 115 * U, HZ); g.closePath(); g.fill();
    g.fillStyle = '#4f9a63'; g.beginPath(); g.moveTo(bx - 70 * U, pk + 24 * U); g.bezierCurveTo(bx - 50 * U, pk - 4 * U, bx - 20 * U, pk - 2 * U, bx - 10 * U, pk); g.bezierCurveTo(bx + 30 * U, pk, bx + 55 * U, pk + 22 * U, bx + 62 * U, pk + 36 * U); g.lineTo(bx - 70 * U, pk + 36 * U); g.fill();
    const ux = W * .93, uy = HZ * .66; g.fillStyle = '#7d8a79'; g.beginPath(); g.ellipse(ux, HZ, 70 * U, HZ - uy, 0, Math.PI, 0); g.fill();
    g.strokeStyle = '#2b2f3a'; g.lineWidth = Math.max(1, U); g.beginPath(); g.moveTo(bx + 20 * U, pk + 4 * U); g.lineTo(ux, uy); g.stroke();
    const k = (tt * .07) % 1, gx = bx + 20 * U + (ux - bx - 20 * U) * k, gy = pk + 4 * U + (uy - pk - 4 * U) * k; g.fillStyle = '#e8453c'; g.fillRect(gx - 7 * U, gy + 2 * U, 14 * U, 9 * U); g.fillStyle = '#bfe6ff'; g.fillRect(gx - 5 * U, gy + 4 * U, 10 * U, 4 * U);
  }
  if (M.rio) {
    // Morros em camadas e o Cristo Redentor no alto do Corcovado.
    const horizon = HZ * .77;
    g.fillStyle = '#76a98b';
    g.beginPath(); g.moveTo(0, horizon + 24*U);
    g.bezierCurveTo(W*.12, horizon-42*U, W*.18, horizon-4*U, W*.30, horizon-58*U);
    g.bezierCurveTo(W*.43, horizon-104*U, W*.51, horizon-18*U, W*.64, horizon-56*U);
    g.bezierCurveTo(W*.78, horizon-110*U, W*.88, horizon-30*U, W, horizon-65*U);
    g.lineTo(W, HZ); g.lineTo(0,HZ); g.closePath(); g.fill();
    g.fillStyle = '#4f886d';
    g.beginPath(); g.moveTo(0,horizon+34*U); g.quadraticCurveTo(W*.18,horizon-50*U,W*.35,horizon+14*U);
    g.quadraticCurveTo(W*.58,horizon-78*U,W*.78,horizon+12*U); g.quadraticCurveTo(W*.9,horizon-26*U,W,horizon+6*U);
    g.lineTo(W,HZ);g.lineTo(0,HZ);g.closePath();g.fill();
    // Cristo simplificado em silhueta clara sobre o pico central.
    const cx=W*.49, cy=horizon-56*U, k=U;
    g.fillStyle='#f5f3e9'; g.strokeStyle='#777d83'; g.lineWidth=Math.max(1,1.2*U);
    g.beginPath(); g.moveTo(cx-5*k,cy+22*k);g.lineTo(cx-3*k,cy-2*k);g.lineTo(cx-17*k,cy-8*k);
    g.lineTo(cx-16*k,cy-12*k);g.lineTo(cx-3*k,cy-8*k);g.lineTo(cx-4*k,cy-20*k);
    g.lineTo(cx+4*k,cy-20*k);g.lineTo(cx+3*k,cy-8*k);g.lineTo(cx+16*k,cy-12*k);
    g.lineTo(cx+17*k,cy-8*k);g.lineTo(cx+4*k,cy-2*k);g.lineTo(cx+5*k,cy+22*k);g.closePath();g.fill();g.stroke();
    g.beginPath();g.arc(cx,cy-24*k,4*k,0,Math.PI*2);g.fill();g.stroke();
    // Prédios da orla ao lado direito, com janelas.
    for (let i=0;i<8;i++) {
      const bw=(12+i%3*4)*U, bh=(26+(i*17)%35)*U, bx=W*.68+i*W*.045, by=HZ*.83-bh;
      g.fillStyle=['#f2a18a','#f5d28a','#87c7c9','#b8a3dc'][i%4];
      g.fillRect(bx,by,bw,bh);
      g.fillStyle='rgba(255,245,190,.85)';
      for(let yy=by+5*U;yy<by+bh-2*U;yy+=8*U) for(let xx=bx+3*U;xx<bx+bw-2*U;xx+=6*U) g.fillRect(xx,yy,2.5*U,3*U);
    }
    // Faixa de mar e areia do lado esquerdo, antes da pista.
    g.fillStyle='#39bfe5';g.beginPath();g.moveTo(0,HZ*.78);g.lineTo(W*.24,HZ*.78);g.lineTo(W*.12,HZ);g.lineTo(0,HZ);g.closePath();g.fill();
    g.fillStyle='#f5d99a';g.beginPath();g.moveTo(0,HZ*.84);g.lineTo(W*.20,HZ*.84);g.lineTo(W*.12,HZ);g.lineTo(0,HZ);g.closePath();g.fill();
    // Guarda-sóis, toalhas e pequenas silhuetas na areia.
    for(let i=0;i<5;i++){
      const x=W*(.025+(i%3)*.055), y=HZ*(.855+Math.floor(i/3)*.065), r=(5+i%2*2)*U;
      g.fillStyle=i%2?'#f04f67':'#fff3d7';g.beginPath();g.moveTo(x-r,y);g.lineTo(x+r,y);g.lineTo(x,y-r*.85);g.closePath();g.fill();
      g.fillStyle='#f3e7c5';g.fillRect(x-r*.8,y, r*1.6, 2*U);
      g.fillStyle='#d95d4e';g.fillRect(x-r*.6,y+5*U,r*1.2,4*U);
      g.fillStyle='#d8a16d';g.beginPath();g.arc(x+3*U,y+4*U,2*U,0,Math.PI*2);g.fill();
      g.fillStyle='#324e82';g.fillRect(x+1*U,y+6*U,3*U,7*U);
    }
  }

  if (!M.rio) { const bw = W / 12; for (const [al, kk, mh] of [[.5, 21, 70], [.9, 33, 38]]) { g.globalAlpha = al; g.fillStyle = shade(M.gnd, al < .6 ? 1.05 : .85); for (let i = -1; i < 14; i++) { const hh = (14 + hash(i + kk, 11) * mh) * U; g.fillRect(i * bw, HZ - hh, bw + 1, hh); } } g.globalAlpha = 1; }
  const terrain = g.createLinearGradient(0,HZ,0,H); terrain.addColorStop(0,shade(M.gnd,1.08)); terrain.addColorStop(.48,M.gnd); terrain.addColorStop(1,shade(M.gnd,.72)); g.fillStyle=terrain; g.fillRect(0,HZ,W,H-HZ);
  if (M.pixelWorld) { // 🟩 blocos de grama estilo Minecraft em perspectiva (alinhados ao mundo, passam conforme você corre)
    const GR = ['#4e8a35', '#6db04a', '#5a9b3d', '#7bc455', '#427a2e', '#62a841'], DIRT = ['#866043', '#79553a'];
    let zf = ZMAX;
    for (let kz = Math.floor((dist + ZMAX) / 100); ; kz--) {
      const z0 = kz * 100 - dist; if (z0 < -200) break;
      const bd = z0 > 2600 ? 400 : z0 > 1000 ? 200 : 100, kk = Math.floor(kz * 100 / bd); if (z0 > 1000 && (kz * 100) % bd) continue;
      const za = Math.max(z0, -200), zb = Math.min(z0 + bd, ZMAX), pa = P(0, za), pb = P(0, zb); if (pa.y <= pb.y) continue;
      const mult = Math.max(1, Math.round(5 / (LW * .5 * pa.s))), step = .5 * mult, lw = LW * step * pa.s, y = pb.y, hgt = pa.y - pb.y + 1;
      const lmin = cam - (W / 2) / (LW * pa.s) - step, lmax = cam + (W / 2) / (LW * pa.s) + step;
      for (let wi = Math.floor(lmin / step); wi <= Math.ceil(lmax / step); wi++) {
        const l0 = wi * step; if (l0 > -1.9 && l0 + step < 1.9) continue; // o miolo é a pista
        const x = W / 2 + (l0 - cam) * LW * pa.s, v = hash(wi * 31 + kk, kk + 5);
        g.fillStyle = v < .05 ? DIRT[wi & 1] : GR[Math.floor(v * 97) % GR.length]; g.fillRect(x, y, lw + 1, hgt);
        if (lw > 9) { const v2 = hash(wi + kk * 3, 9); g.fillStyle = GR[Math.floor(v2 * 53) % GR.length]; g.fillRect(x + lw * .15, y + hgt * .2, lw * .3, hgt * .3); g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x + lw * .55, y + hgt * .55, lw * .3, hgt * .3); }
      }
    }
  }

  { const tint=M.snow?'#ffffff':M.deco==='cactus'?'#ffe2a5':M.deco==='palm'?'#e8f7c8':M.deco==='rock'?'#ff815a':M.moon?'#e8ecff':'#ffffff'; g.save(); g.globalAlpha=.13; for(let i=0;i<58;i++){const k=Math.floor((dist+900)/180)+i, x=((hash(k,41)*W-dist*.035)%(W+18)+(W+18))%(W+18)-9, depth=Math.pow(hash(k,42),.72), y=HZ+depth*(H-HZ), size=(1+hash(k,43)*3)*U*(.45+depth); g.fillStyle=tint; if(M.deco==='cactus'||M.deco==='palm'){g.beginPath();g.ellipse(x,y,size*1.8,size*.55,0,0,7);g.fill();}else g.fillRect(x,y,size*1.6,size*.65);} g.restore(); }
  { g.fillStyle = M.vox ? 'rgba(50,110,20,.2)' : 'rgba(0,0,0,.1)'; for (let k = Math.floor((dist + ZMAX) / 200); k * 200 - dist > -400; k--) { if (k % 2) continue; const a = P(0, k * 200 - dist), b = P(0, k * 200 - dist - 200); g.fillRect(0, a.y, W, b.y - a.y + 1); } }
  // leito da pista
  const f = P(0, ZMAX), n = P(0, -200), half = 1.75;
  g.fillStyle = M.bed; g.beginPath(); g.moveTo(f.x - half * LW * f.s, f.y); g.lineTo(f.x + half * LW * f.s, f.y); g.lineTo(n.x + half * LW * n.s, n.y); g.lineTo(n.x - half * LW * n.s, n.y); g.fill();
  if (M.pixelWorld) { // pedregulho/terra de Minecraft no leito da pista
    const BP = ['#7c7c7c', '#8a8a8a', '#6e6e6e', '#979797', '#70513a', '#5f4330'];
    for (let kz = Math.floor((dist + 3000) / 100); ; kz--) {
      const z0 = kz * 100 - dist; if (z0 < -200) break; const pa = P(0, Math.max(z0, -200)), pb = P(0, z0 + 100); if (pa.y <= pb.y) continue;
      for (let ci = -7; ci < 7; ci++) { const v = hash(ci * 17 + kz, kz + 2); const x = W / 2 + (ci * .25 - cam) * LW * pa.s; g.fillStyle = BP[Math.floor(v * 91) % BP.length]; g.globalAlpha = .5; g.fillRect(x, pb.y, LW * .25 * pa.s + 1, pa.y - pb.y + 1); }
    }
    g.globalAlpha = 1;
  }

  for (const sx of [-1, 1]) { const ea = P(sx * half, ZMAX), eb = P(sx * half, -200), ew = .09 * LW; g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.moveTo(ea.x - ew * ea.s, ea.y); g.lineTo(ea.x + ew * ea.s, ea.y); g.lineTo(eb.x + ew * eb.s, eb.y); g.lineTo(eb.x - ew * eb.s, eb.y); g.fill(); }
  if (M.rio) {
    // Ciclovia vermelha nas laterais da pista central.
    const lA=P(-1.82,ZMAX), lB=P(-1.82,-200), rA=P(1.82,ZMAX), rB=P(1.82,-200);
    g.fillStyle='#d94b50';
    g.beginPath();g.moveTo(lA.x,lA.y);g.lineTo(lA.x-18*U*lA.s,lA.y);g.lineTo(lB.x-18*U*lB.s,lB.y);g.lineTo(lB.x,lB.y);g.closePath();g.fill();
    g.beginPath();g.moveTo(rA.x,rA.y);g.lineTo(rA.x+18*U*rA.s,rA.y);g.lineTo(rB.x+18*U*rB.s,rB.y);g.lineTo(rB.x,rB.y);g.closePath();g.fill();
    g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=Math.max(1,2*U);
    for(const side of [-1,1]) for(let z=ZMAX-(dist%260);z>-150;z-=260){
      const a=P(side*1.82,z), b=P(side*1.82,z-85);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
    }
  }

  // dormentes (rolam com a distância)
  const off = dist % 200;
  for (let z = ZMAX - off; z > -150; z -= 200) { const p = P(0, z); for (const l of [-1, 0, 1]) { const x0 = p.x + (l - .36) * LW * p.s, ww = .72 * LW * p.s; g.fillStyle = '#6e4a2e'; g.fillRect(x0, p.y, ww, Math.max(2, 16 * U * p.s)); g.fillStyle = '#8a6040'; g.fillRect(x0, p.y, ww, Math.max(1, 4 * U * p.s)); } }
  // trilhos
  g.strokeStyle = M.rail; g.globalAlpha = .8; g.lineWidth = 3;
  if (false) { g.globalAlpha = .9; for (const l of [-.5, .5]) for (let k = Math.floor((dist + ZMAX) / 260); k * 260 - dist > -200; k--) { const a = P(l, k * 260 - dist), b = P(l, k * 260 - dist - 110); g.lineWidth = Math.max(1, 8 * U * a.s); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); } }
  else for (const l of [-1.5, -.5, .5, 1.5]) { const a = P(l, ZMAX), b = P(l, -200); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  g.globalAlpha = 1;
  // trilhos de aço (dois por pista) para dar profundidade
  g.strokeStyle = '#d5dcee'; g.lineWidth = 2.5;
  for (const l of [-1, 0, 1]) for (const dx of [-.22, .22]) { const a = P(l + dx, ZMAX), b = P(l + dx, -200); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  if (!M.moon && !M.vox) { g.strokeStyle = 'rgba(30,34,60,.5)'; g.lineWidth = Math.max(1, 1.5 * U); for (const i of [-2, -1, 0, 1, 2]) { g.beginPath(); g.moveTo(W / 2 + i * W * .24, 0); g.lineTo(W / 2 + i * W * .02, HZ); g.stroke(); }
    g.strokeStyle = '#3a3f52'; for (let k = Math.floor((dist + ZMAX) / 700); k * 700 - dist > -60; k--) { const zz = k * 700 - dist, p = P(2.05, zz), q = P(-2.05, zz); g.lineWidth = Math.max(1, 6 * U * p.s); for (const e of [p, q]) { g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(e.x, e.y - 300 * U * e.s); g.stroke(); } g.lineWidth = Math.max(1, 4 * U * p.s); g.beginPath(); g.moveTo(q.x, q.y - 300 * U * q.s); g.lineTo(p.x, p.y - 300 * U * p.s); g.stroke(); } }
  // prédios laterais + objetos, de longe para perto
  const items = [], m = Math.floor(dist / 190);
  for (let i = 36; i >= 0; i--) for (const sd of [-1, 1]) for (const row of [0, 1, 2, 3]) { const k = m + i, z = k * 150 - dist + (row >= 2 ? 75 : 0); if (z > -150) items.push({ z, b: { sd, k, row } }); }
  for (const o of objs) { const z = o.wz - dist; if (z < ZMAX && z + o.len > -200) items.push({ z: (o.t === 'train' || o.t === 'ramp' || o.t === 'steam' || o.t === 'wall' || o.t === 'barrier') ? (z < 40 && z + o.len > -40 ? 1 : z + o.len * .5) : z, o }); }
  items.sort((a, b) => b.z - a.z);
  let playerDone = false;
  const drawPlayer = () => { playerDone = true; if (st !== 'title' && st !== 'over') player(now); };
  for (const it of items) {
    if (!playerDone && it.z < 0) drawPlayer();
    if (it.b) { const { sd, k, row } = it.b; const da = Math.max(0, Math.min(1, (it.z + 150) / 170)); if (da < .03) continue; g.globalAlpha = da; deco(sd, k, it.z, M, row); g.globalAlpha = 1; continue; }
    const o = it.o, z = o.wz - dist;
    // objetos que já ficaram atrás do personagem (onde a câmera passa) somem aos poucos; os ao lado ficam semitransparentes
    // objetos onde a câmera está passando somem na hora (não ficam tampando a tela); só ficam inteiros se o personagem estiver em cima deles
    let al = 1; const NZ = -200; // só some quando o fim do objeto já saiu de verdade da tela
    if (o.t === 'coin') { if (z < -120) al = Math.max(0, 1 + (z + 120) / 80); }
    else { const back = z + o.len; if (back < -110) al = Math.max(0, 1 + (back + 110) / 80); }
    if (o.t === 'steam') al = Math.min(al, Math.max(0, (ZMAX - z) / 700)); // surge da névoa
    if (al < .03) continue; g.globalAlpha = al;
    if (o.t === 'train') { const nz = Math.max(z, NZ), col = CROSSY_COL[o.col] || o.col, hb = TH * .6, ze = z + o.len, vis = o.l !== 0 ? (o.l < 0 ? .4 : -.4) : 0;
      const wheel = sx => { for (let s2 = 30; s2 < o.len - 40; s2 += 150) { const a0 = z + s2, b0 = a0 + 36; if (b0 > NZ && a0 < ZMAX) box(o.l + sx, Math.max(a0, NZ), b0, 20, '#262b38', .09); } };
      if (o.l === 0) { wheel(-.4); wheel(.4); } else wheel(-vis); // rodas do lado escondido ficam atrás do corpo
      const r = box(o.l, nz, ze, hb, col, .8), w = r.w * r.a.s, x0 = r.a.x - w / 2, hh = r.ya - r.ta;
      if (o.l !== 0) wheel(vis);
      sideQuad(o.l, z, ze, hb * .28, hb * .4, .4, 'rgba(255,255,255,.38)');
      g.fillStyle = '#fff3a0'; g.fillRect(x0 + w * .1, r.ta + hh * .38, w * .17, hh * .2); g.fillRect(x0 + w * .73, r.ta + hh * .38, w * .17, hh * .2); // faróis quadrados
      g.fillStyle = '#2a2f3d'; g.fillRect(x0, r.ta + hh * .78, w, hh * .16); // para-choque
      const cs = z + Math.min(45, o.len * .08), ce = ze - Math.min(25, o.len * .05);
      if (ce > NZ && cs < ZMAX) {
        const c = box(o.l, Math.max(cs, NZ), ce, TH, '#f4f7ff', .64, hb), cw = c.w * c.a.s, cx0 = c.a.x - cw / 2, ch = c.ya - c.ta;
        g.fillStyle = '#2b3a52'; g.fillRect(cx0 + cw * .1, c.ta + ch * .18, cw * .8, ch * .56); g.fillStyle = 'rgba(160,215,255,.55)'; g.fillRect(cx0 + cw * .14, c.ta + ch * .24, cw * .28, ch * .22); // para-brisa
        for (let w2 = cs + 14; w2 < ce - 50; w2 += 78) { sideQuad(o.l, w2, w2 + 50, hb + 9, TH - 9, .32, '#2b3a52'); sideQuad(o.l, w2 + 4, w2 + 24, hb + 14, TH - 14, .32, 'rgba(160,215,255,.5)'); }
      } }
    else if (o.t === 'steam') drawSteam(o, z, now, al);
    else if (o.t === 'ramp') { const N = 9, sl = o.len / N, rc = '#9aa3b5'; // rampa feita de degraus de bloco (voxel), do mais longe para o mais perto
      for (let q = N - 1; q >= 0; q--) { const za = z + q * sl, zb = za + sl + 1; if (zb < NZ || za > ZMAX) continue; const hh = TH * (o.down ? 1 - (q + .5) / N : (q + .5) / N); box(o.l, Math.max(za, NZ), zb, Math.max(4, hh), q % 2 ? rc : shade(rc, .93), .8); }
      const pa = P(o.l, Math.max(z, NZ)), pb = P(o.l, Math.min(z + o.len, ZMAX)); g.strokeStyle = '#ffe36a'; g.lineWidth = Math.max(1, 4 * pa.s); g.setLineDash([10 * pa.s, 8 * pa.s]); g.beginPath(); g.moveTo(pa.x, pa.y - 4 * U * pa.s); g.lineTo(pb.x, pb.y - (o.down ? 0 : TH * U * pb.s * .9)); g.stroke(); g.setLineDash([]); }
    else if (o.t === 'wall') { const nz = Math.max(z, NZ), lc = (Math.floor(o.wz / 97) % 2) ? '#8cc63f' : '#a5da4b'; // sebe/árvore de blocos
      box(o.l, nz, z + o.len, 55, '#6b4528', .2); const r = box(o.l, nz, z + o.len, TOPS.wall, lc, .82, 45), fh = r.ya - r.ta, fw = r.w * r.a.s;
      g.fillStyle = 'rgba(0,50,0,.10)'; for (let q = 1; q < 4; q++) g.fillRect(r.a.x - fw / 2, r.ta + fh * q / 4, fw, Math.max(1, 2.2 * r.a.s)); }
    else if (o.t === 'barrier') { const nz = Math.max(z, NZ), r = box(o.l, nz, z + o.len, TOPS.barrier, '#8a4f3a', .84), fw = r.w * r.a.s, fh = r.ya - r.ta;
      g.fillStyle = 'rgba(40,15,5,.22)'; g.fillRect(r.a.x - fw / 2, r.ta + fh * .33, fw, fh * .12); g.fillRect(r.a.x - fw / 2, r.ta + fh * .68, fw, fh * .1); g.fillStyle = 'rgba(255,220,180,.25)'; g.fillRect(r.a.x - fw * .38, r.ta + fh * .5, fw * .3, fh * .1); }
    else if (o.t === 'bar') { const p = P(o.l, z), w = LW * .8 * p.s; g.fillStyle = '#6b4528'; g.fillRect(p.x - w / 2, p.y - 120 * U * p.s, 10 * U * p.s + 2, 120 * U * p.s); g.fillRect(p.x + w / 2 - 10 * U * p.s, p.y - 120 * U * p.s, 10 * U * p.s + 2, 120 * U * p.s); g.fillStyle = '#f2572b'; g.fillRect(p.x - w / 2, p.y - 105 * U * p.s, w, 32 * U * p.s); g.fillStyle = '#fff'; for (let q = 0; q < 4; q++) g.fillRect(p.x - w / 2 + w * (.08 + q * .24), p.y - 105 * U * p.s, w * .12, 32 * U * p.s); }
    else if (o.t === 'coin') { // moeda circular com aro metálico e rotação lenta, sem o antigo bloco quadrado
      g.save(); g.globalAlpha=1;
      const p = P(o.l, z), r = Math.max(3, 23 * U * p.s), spin = Math.cos(now / 520 + o.wz * .003), sx = Math.max(.16, Math.abs(spin)), cy = p.y - (45 + (o.h || 0)) * U * p.s, cc = CFG.coinColor || '#ffd23a';
      g.fillStyle = 'rgba(15,20,35,.25)'; g.beginPath(); g.ellipse(p.x + 3 * U * p.s, p.y - 2 * U * p.s, r * .82, r * .24, 0, 0, Math.PI * 2); g.fill();
      g.save(); g.translate(p.x, cy); g.scale(sx, 1);
      const metal = g.createLinearGradient(-r, -r, r, r); metal.addColorStop(0, shade(cc, 1.28)); metal.addColorStop(.28, cc); metal.addColorStop(.58, shade(cc, .76)); metal.addColorStop(.82, shade(cc, 1.18)); metal.addColorStop(1, shade(cc, .68));
      g.fillStyle = '#9b6723'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = metal; g.beginPath(); g.arc(0, 0, r * .88, 0, Math.PI * 2); g.fill();
      g.strokeStyle = shade(cc, 1.42); g.lineWidth = Math.max(1, 2 * p.s); g.beginPath(); g.arc(0, 0, r * .72, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,220,.8)'; g.lineWidth = Math.max(.8, 1.2 * p.s); g.beginPath(); g.arc(-r * .04, -r * .04, r * .56, Math.PI * 1.05, Math.PI * 1.82); g.stroke();
      if (sx > .42) { g.fillStyle = shade(cc, 1.42); g.font = `900 ${Math.max(7, r * .95)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('S', 0, 1 * p.s); }
      g.restore(); g.restore(); }
    g.globalAlpha = 1;
  }
  if (!playerDone) drawPlayer();
  for (const o of objs) if (o.t === 'steam') drawSteamWarn(o, now);
  // neblina: o fundo distante some na cor do horizonte (profundidade)
  const fc = parseInt(M.sky[2].slice(1), 16), fg = g.createLinearGradient(0, HZ - 40 * U, 0, HZ + (GY - HZ) * .5);
  fg.addColorStop(0, `rgba(${fc >> 16},${(fc >> 8) & 255},${fc & 255},.6)`); fg.addColorStop(1, `rgba(${fc >> 16},${(fc >> 8) & 255},${fc & 255},0)`);
  g.fillStyle = fg; g.fillRect(0, HZ - 40 * U, W, (GY - HZ) * .5 + 40 * U);
  if (st === 'play' && speed > 950) { // linhas de velocidade
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 2;
    for (let i = 0; i < 16; i++) { const a = hash(i, 7) * Math.PI * 2, r = (dist * .003 + hash(i, 8)) % 1, r0 = H * (.12 + r * .7), r1 = r0 + H * .05 * (1 + r); g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0 * 1.3, HZ + 40 * U + Math.sin(a) * r0 * .6); g.lineTo(W / 2 + Math.cos(a) * r1 * 1.3, HZ + 40 * U + Math.sin(a) * r1 * .6); g.stroke(); }
  }
}
function player(now) {
  const GYc = GY + camH * U; // chão do personagem na tela (considera a altura da câmera)
  const x = P(pl.px, 0).x;
  { const shadow=Math.max(.14,1-pl.jy/520), sl=pl.roll>0?1:0; g.save(); g.globalAlpha=.38*shadow; g.fillStyle='#050a16'; g.beginPath(); g.ellipse(x+4*PU,GYc+(3-sl*8)*PU,(28+sl*4)*PU*shadow,(7+sl*12)*PU*shadow,0,0,Math.PI*2); g.fill(); g.restore(); }
  g.globalAlpha = pl.inv > 0 && Math.floor(now / 80) % 2 ? .35 : 1; // pisca depois de bater
  // rastros: partículas que ficam no chão e se afastam conforme você corre
  for (const p of trail) {
    const z = p.wz - dist; if (z > -5 || z < -200) continue;
    const q = P(p.l, z), k = p.life / .9;
    g.globalAlpha = .55 * (1 - k);
    g.fillStyle = board.t > 0 ? (Math.floor(p.life * 20) % 2 ? '#4ff0ff' : '#ff5c8a') : CFG.trail === 'rainbow' ? `hsl(${(p.wz / 3) % 360},95%,60%)` : CFG.trail === 'fire' ? `hsl(${50 - 50 * k},100%,55%)` : CFG.trail === 'neon' ? (Math.floor(p.life * 14) % 2 ? '#4ff0ff' : '#ff3dcb') : CFG.trail === 'ice' ? `hsl(${190 + 20 * k},90%,${75 - 20 * k}%)` : CFG.trail === 'gold' ? `hsl(${45 + 10 * k},100%,${60 - 15 * k}%)` : CFG.trail === 'toxic' ? `hsl(${100 + 40 * k},95%,50%)` : CHARS[CFG.char].hood;
    g.beginPath(); g.arc(q.x, q.y - p.h * U * q.s, Math.max(1, 11 * U * q.s * (1 - k * .7)), 0, 7); g.fill();
  }
  const dustColor=MAPS[CFG.map].cyber?'#a4f7ff':'#e4ceb0';
  for(const p of slideDust){const age=p.life/.58,r=(p.size+age*15)*U;g.globalAlpha=(1-age)*.42;g.fillStyle=dustColor;g.beginPath();g.ellipse(x+p.dx*U,GYc-pl.floor*U+p.dy*U,r*1.35,r*.64,p.spin+age*.5,0,Math.PI*2);g.fill();}
  if(pl.roll>0&&pl.jy<=pl.floor+46){g.save();g.globalAlpha=.3*Math.min(1,pl.roll/.16);g.strokeStyle=dustColor;g.lineWidth=2.5*U;g.lineCap='round';for(let i=0;i<3;i++){g.beginPath();g.moveTo(x+(i-1)*17*U,GYc-pl.floor*U+(8+i)*U);g.lineTo(x+(i-1)*21*U,GYc-pl.floor*U+(30+i*5)*U);g.stroke();}g.restore();}
  g.globalAlpha = pl.inv > 0 && Math.floor(now / 80) % 2 ? .35 : 1;
  if (board.t > 0) { const by = GYc - pl.jy * U; g.save(); g.shadowColor = '#4ff0ff'; g.shadowBlur = 18 * U; g.fillStyle = '#ff5c8a'; g.strokeStyle = '#14172e'; g.lineWidth = 3 * U; g.beginPath(); g.roundRect(x - 34 * U, by - 12 * U, 68 * U, 12 * U, 6 * U); g.fill(); g.stroke(); g.restore(); }
  if (st === 'dying') { // queda: gira para trás, quica e fica tonto
    const k = Math.min(1, dieT / .8), bounce = Math.abs(Math.sin(dieT * 8)) * 38 * Math.max(0, 1 - dieT / 1.1) * U;
    g.save(); g.translate(x, GYc - 46 * U - bounce); g.rotate(-1.45 * (1 - Math.pow(1 - k, 3)));
    drawChar(g, 0, 46 * U, PU, CHARS[CFG.char], { air: true }); g.restore();
    if (dieT > .35) for (let i = 0; i < 4; i++) { const a = dieT * 7 + i * 1.57; g.fillStyle = '#ffd21f'; g.strokeStyle = '#14172e'; g.lineWidth = 2; g.beginPath(); g.arc(x + Math.cos(a) * 34 * U, GYc - 96 * U + Math.sin(a) * 9 * U, 6 * U, 0, 7); g.fill(); g.stroke(); }
  } else {
    const by = GYc - pl.jy * U - (board.t > 0 ? 12 * U : 0);
    if(pl.roll>0){ // carrinho de futebol: entra rápido, desliza deitado e levanta no fim
      const kk=Math.min(1,(ROLL_T-pl.roll)/.14,pl.roll/.2),k=kk*kk*(3-2*kk);
      drawChar(g,x,by,PU,CHARS[CFG.char],{run:dist/45,slide:true,slideK:k,slidePhase:now/70,yaw:(pl.px-pl.lane)*.12});
    }else{
      g.save();g.translate(x,by);g.rotate((pl.lane-pl.px)*.14);g.translate(-x,-by);
      drawChar(g,x,by,PU,CHARS[CFG.char],{run:dist/45,air:pl.jy>pl.floor+2,yaw:(pl.px-pl.lane)*.12});g.restore();
    }
  }
  g.globalAlpha = 1; if (guard.t > 0) drawGuard(now);
}
function playerOld(now) { // versão antiga (não usada)
  const x = P(pl.px, 0).x, y0 = GY - pl.jy * U, run = Math.sin(dist / 45), rl = pl.roll > 0;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, GY + 4, 30 * PU * (1 - pl.jy / 400), 8 * PU, 0, 0, 7); g.fill();
  g.lineWidth = 3 * U; g.strokeStyle = '#14172e';
  if (rl) { g.fillStyle = '#2f7bff'; g.beginPath(); g.roundRect(x - 28 * U, y0 - 48 * U, 56 * U, 44 * U, 18 * U); g.fill(); g.stroke(); g.fillStyle = '#ffd21f'; g.beginPath(); g.arc(x + 10 * U, y0 - 40 * U, 12 * U, 0, 7); g.fill(); g.stroke(); return; }
  g.fillStyle = '#1f3d99'; g.fillRect(x - 15 * U, y0 - 34 * U, 12 * U, 34 * U + run * 5 * U); g.fillRect(x + 3 * U, y0 - 34 * U, 12 * U, 34 * U - run * 5 * U);
  g.fillStyle = '#2f7bff'; g.beginPath(); g.roundRect(x - 20 * U, y0 - 82 * U, 40 * U, 54 * U, 10 * U); g.fill(); g.stroke();
  g.fillStyle = '#e8a979'; g.beginPath(); g.arc(x, y0 - 96 * U, 15 * U, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#ffd21f'; g.beginPath(); g.arc(x, y0 - 100 * U, 16 * U, Math.PI, 0); g.fill(); g.stroke();
}

// Desenha um personagem: c = contexto, (x,y0) = pés, u = escala, ch = dados do personagem
// ===== Personagem 3D: caixas giradas no espaço, projetadas com perspectiva e sombreadas por uma luz =====
function rot3(p, rx, ry, rz) { // gira um ponto [x,y,z]
  let x = p[0], y = p[1], z = p[2], c, s, t;
  if (rz) { c = Math.cos(rz); s = Math.sin(rz); t = x * c - y * s; y = x * s + y * c; x = t; }
  if (rx) { c = Math.cos(rx); s = Math.sin(rx); t = y * c - z * s; z = y * s + z * c; y = t; }
  if (ry) { c = Math.cos(ry); s = Math.sin(ry); t = x * c + z * s; z = -x * s + z * c; x = t; }
  return [x, y, z];
}
const FACES3 = [ // faces visíveis de um cubo (sem o fundo): normal + 4 cantos
  { n: [1, 0, 0], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, 0, 1], v: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  { n: [0, 0, -1], v: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] }
];

// Texturas UV simplificadas para o modelo de blocos existente.
// Cada imagem é projetada sobre uma face do personagem; o modelo e suas proporções não mudam.
const _srTextureImages = new Map();
function _srTextureImage(url) {
  if (!url || typeof url !== 'string' || !(/^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(url))) return null;
  let im = _srTextureImages.get(url);
  if (!im) {
    im = new Image(); im.crossOrigin = 'anonymous'; im.src = url;
    _srTextureImages.set(url, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
function _srPaintPlane(ctx, image, corners) {
  if (!image || !image.complete || !image.naturalWidth) return;
  // corners: superior-esquerdo, superior-direito, inferior-esquerdo, inferior-direito
  const [p0,p1,p2,p3] = corners;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(p0[0],p0[1]); ctx.lineTo(p1[0],p1[1]); ctx.lineTo(p3[0],p3[1]); ctx.lineTo(p2[0],p2[1]); ctx.closePath(); ctx.clip();
  const a=(p1[0]-p0[0])/image.naturalWidth, b=(p1[1]-p0[1])/image.naturalWidth;
  const cc=(p2[0]-p0[0])/image.naturalHeight, d=(p2[1]-p0[1])/image.naturalHeight;
  ctx.transform(a,b,cc,d,p0[0],p0[1]); ctx.globalAlpha=.98; ctx.drawImage(image,0,0); ctx.restore();
}
function _srPaintSkinTextures(ctx, ch, project, scale, baseX, baseY, yaw, bob) {
  if (!ch || !ch.textures) return;
  const proj = (x,y,z) => { const q=project([x,y+bob,z]), k=1/(1+q[2]*.0035); return [baseX+q[0]*scale*k,baseY-q[1]*scale*k]; };
  const t=ch.textures;
  const shirt=_srTextureImage(t.shirt);
  if (shirt) {
    const frontNormal = rot3(rot3([0,0,1],0,yaw,0),-.3,0,0);
    if (frontNormal[2] < -.02) _srPaintPlane(ctx,shirt,[proj(-17,84,10.15),proj(17,84,10.15),proj(-17,40,10.15),proj(17,40,10.15)]);
    const backNormal = rot3(rot3([0,0,-1],0,yaw,0),-.3,0,0);
    if (backNormal[2] < -.02) _srPaintPlane(ctx,shirt,[proj(17,84,-10.15),proj(-17,84,-10.15),proj(17,40,-10.15),proj(-17,40,-10.15)]);
  }
  const pants=_srTextureImage(t.pants);
  if (pants) {
    const frontNormal=rot3(rot3([0,0,1],0,yaw,0),-.3,0,0);
    const backNormal=rot3(rot3([0,0,-1],0,yaw,0),-.3,0,0);
    if (frontNormal[2] < -.02) [-1,1].forEach(side=>_srPaintPlane(ctx,pants,[proj(side*9-7,40,7.7),proj(side*9+7,40,7.7),proj(side*9-7,1,7.7),proj(side*9+7,1,7.7)]));
    if (backNormal[2] < -.02) [-1,1].forEach(side=>_srPaintPlane(ctx,pants,[proj(side*9+7,40,-7.7),proj(side*9-7,40,-7.7),proj(side*9+7,1,-7.7),proj(side*9-7,1,-7.7)]));
  }
  const backpack=_srTextureImage(t.backpack);
  if (backpack) {
    const backNormal=rot3(rot3([0,0,-1],0,yaw,0),-.3,0,0);
    if (backNormal[2] < -.02) _srPaintPlane(ctx,backpack,[proj( -10,70,-18),proj(10,70,-18),proj(-10,42,-18),proj(10,42,-18)]);
  }
  const accessory=_srTextureImage(t.accessory);
  if (accessory) {
    const frontNormal=rot3(rot3([0,0,1],0,yaw,0),-.3,0,0);
    const backNormal=rot3(rot3([0,0,-1],0,yaw,0),-.3,0,0);
    if (frontNormal[2] < -.02) _srPaintPlane(ctx,accessory,[proj(-11,111,12.4),proj(11,111,12.4),proj(-11,91,12.4),proj(11,91,12.4)]);
    if (backNormal[2] < -.02) _srPaintPlane(ctx,accessory,[proj(11,111,-12.4),proj(-11,111,-12.4),proj(11,91,-12.4),proj(-11,91,-12.4)]);
  }
}

function drawChar(c, x, y0, u, ch, o = {}) {
  const INK = '#14172e', sw = Math.sin(o.run || 0), yaw = o.yaw === undefined ? .5 : o.yaw, pit = -.3;
  const roll = !!o.roll, sliding = !!o.slide, sk = sliding ? (o.slideK === undefined ? 1 : o.slideK) : 0, phase = o.slidePhase || 0, ang = roll ? (.6 - (o.spin || 0)) * 10.5 : 0;
  const mx = (a, b) => a + (b - a) * sk, ph = Math.sin(phase); // mistura corrida → carrinho
  let lg = roll ? [-1.5,-1.5] : sliding ? [mx(o.air ? -.55 : sw*1.02, .02 + ph*.05), mx(o.air ? .45 : -sw*1.02, -.45 + Math.sin(phase+1.3)*.07)] : o.air ? [-.55,.45] : [sw*1.02,-sw*1.02];
  let ar = roll || o.air ? [-1.2,-1.2] : sliding ? [mx(-sw*.96, 2.05 + Math.sin(phase+.5)*.12), mx(sw*.96, 1.7 + Math.sin(phase+2)*.12)] : [-sw*.96,sw*.96];
  if (o.lg) lg = o.lg; if (o.ar) ar = o.ar; const leanA = o.lean || 0;
  const L = p => { if (!leanA) return p; const k = Math.max(0, Math.min(1, (p[1] - 34) / 30)) * leanA, q = rot3([p[0], p[1] - 34, p[2]], k, 0, 0); return [q[0], q[1] + 34, q[2]]; }; // inclina o tronco (quadril fixo)
  const bob = (roll || o.air ? 0 : Math.abs(sw)*3.2*(1-sk)) + (o.bobAdd || 0), parts = [];
  // B(centro x,y,z, largura,altura,profundidade, cor, pivô, giro): monta o modelo em "caixas"
  const B = (cx, cy, cz, w, h, d, col, pv, rx, nb) => { const dy = nb ? 0 : bob; parts.push({ c: [cx, cy + dy, cz], s: [w, h, d], col, pv: pv ? [pv[0], pv[1] + dy, pv[2]] : null, rx: rx || 0 }); };
  const skin = ch.skin, sh = ch.shoe || '#ffffff', sl = ch.sleeve || ch.hood, hand = ch.hand || skin;
  // Itens de mão (skins do painel): holdL / holdR = 'fanta' (garrafa de refrigerante laranja) ou 'plate' (prato de comida)
  const holdItem = (k, x, pv, rx) => {
    if (k === 'fanta') {
      B(x, 54, 3, 8, 16, 8, '#ff8f1a', pv, rx); B(x, 55.5, 3, 8.8, 6, 8.8, '#fff1d0', pv, rx); B(x, 55.5, 3, 9.2, 2.2, 9.2, '#2a62c9', pv, rx);
      B(x, 63.8, 3, 4.6, 3.6, 4.6, '#ff8f1a', pv, rx); B(x, 66.6, 3, 5.4, 2.4, 5.4, '#1f5fbf', pv, rx); B(x - 2.2, 58, 6.4, 1.2, 8, .8, '#ffc36b', pv, rx);
    } else if (k === 'plate') {
      B(x, 55, 3, 14, 1.4, 14, '#ffffff', pv, rx); B(x, 56.2, 3, 16, 1, 16, '#dfe3ea', pv, rx);
      B(x - 2.6, 58, 2, 6.4, 3, 6.4, '#8a4b2a', pv, rx); B(x + 3, 57.6, 4.4, 5, 2.4, 5, '#f2d16b', pv, rx); B(x + 1, 58.4, -1.6, 4, 2.4, 3.6, '#3f9a45', pv, rx); B(x - 3.4, 57.4, 6.6, 3.4, 2, 3, '#e8453c', pv, rx);
    }
  };
  [-1, 1].forEach((s, i) => { // pernas e tênis
    const px = s * 9, pv = [px, 40, 0], rx = lg[i];
    if (ch.shorts) { B(px, 31, 0, 14, 18, 15, ch.pants, pv, rx, 1); B(px, 12, 0, 11, 24, 12, skin, pv, rx, 1); }
    else {
      B(px, 20, 0, ch.baggy ? 22 : 14, 40, ch.baggy ? 22 : 15, ch.pants, pv, rx, 1);
      if (ch.baggy) {
        // Barra/cuff largo, costura lateral e joelheira sutil para dar volume à calça.
        B(px, 4, 0, 22, 8, 23, shade(ch.pants, .76), pv, rx, 1);
        B(px + s * 7, 24, 11.4, 2, 17, 1.8, ch.detail || shade(ch.cap, 1.1), pv, rx, 1);
        B(px, 28, 11.7, 13, 2, 1.6, shade(ch.pants, 1.25), pv, rx, 1);
      }
    }
    // Tênis maiores, com sola clara, biqueira e detalhe lateral.
    B(px, 5, 3, ch.baggy ? 20 : 15, 12, ch.baggy ? 25 : 22, sh, pv, rx, 1);
    B(px, 1, 4, ch.baggy ? 21 : 16, 3, ch.baggy ? 26 : 23, shade(sh, .68), pv, rx, 1);
    B(px, 7, 15, ch.baggy ? 10 : 7, 2, 2, ch.detail || ch.cap, pv, rx, 1);
  });
  [-1, 1].forEach((s, i) => { const pv = [s * 22, 84, 0], ax = s * 22; // braços
    if (ch.polo) { // manga curta de crochê + punho listrado + antebraço tatuado
      B(ax, 76, 0, 14, 16, 13, sl, pv, ar[i]); // manga larga (ombro caído)
      B(ax, 68.4, 0, 14.5, 1.5, 13.5, '#d2303a', pv, ar[i]); B(ax, 67, 0, 14.5, 1.4, 13.5, '#1d3f2e', pv, ar[i]); B(ax, 65.7, 0, 14.5, 1.4, 13.5, '#2d7fd1', pv, ar[i]);
      B(ax, 58, 0, 9, 15, 9, skin, pv, ar[i]); B(ax, 50, 0, 9, 8, 9, hand, pv, ar[i]);
      B(ax + s * 4.6, 59, -1, 1, 9, 6, '#5d564e', pv, ar[i]); B(ax + s * 4.6, 55, 1.5, 1, 4, 4, '#4a443d', pv, ar[i]); B(ax, 60, -4.6, 6, 8, 1, '#6a5f55', pv, ar[i]); B(ax, 55, -4.6, 4, 3, 1, '#51493f', pv, ar[i]);
      if (s === 1) { // pulseiras amarela e azul + copo branco na mão direita
        B(ax, 54.2, 0, 10.4, 2.2, 10.4, '#f2c230', pv, ar[i]); B(ax, 56.6, 0, 10.4, 2, 10.4, '#3a8fd8', pv, ar[i]); B(ax, 58.8, 0, 10.4, 1.6, 10.4, '#f2c230', pv, ar[i]);
        B(ax + 8, 56, 3, 8, 16, 8, '#ffffff', pv, ar[i]); B(ax + 8, 64.4, 3, 8.8, 1.4, 8.8, '#d9d9d9', pv, ar[i]); B(ax + 8, 48.4, 3, 6.4, 1.2, 6.4, '#e8e8e8', pv, ar[i]);
        B(ax, 50, 4.8, 9.4, 1.2, 1.2, '#cfd3dc', pv, ar[i]); // anel
      }
    } else if (ch.neto) { // manga curta azul, antebraço de pele (tatuado no esquerdo) e boneca na mão direita
      B(ax, 76, 0, 12, 18, 12, sl, pv, ar[i]); B(ax, 67.6, 0, 12.4, 1.6, 12.4, shade(sl, .72), pv, ar[i]);
      B(ax, 58, 0, 9, 18, 9, skin, pv, ar[i]); B(ax, 50, 0, 9, 8, 9, hand, pv, ar[i]);
      if (s === -1) { B(ax, 60, -4.6, 6, 10, 1, '#5d564e', pv, ar[i]); B(ax - 4.6, 58, 0, 1, 10, 6, '#5d564e', pv, ar[i]); B(ax, 55, -4.6, 4, 4, 1, '#4a443d', pv, ar[i]); B(ax, 63, -4.6, 3, 3, 1, '#6a5f55', pv, ar[i]); }
      if (s === 1) { // boneca careca de macacão claro, segurada pelo corpinho
        const dx = ax + 8, dz = 2, pk = '#f4b98f', pk2 = '#e9a67a';
        B(dx - 2.2, 42.5, dz, 3.6, 9, 4.4, pk, pv, ar[i]); B(dx + 2.2, 42.5, dz, 3.6, 9, 4.4, pk, pv, ar[i]);
        B(dx, 53, dz, 9.4, 12, 7, '#eef1f8', pv, ar[i]); B(dx, 56, dz - 3.7, 9.6, 1.4, .8, '#9fb0cf', pv, ar[i]); B(dx, 51, dz - 3.7, 9.6, 1.4, .8, '#9fb0cf', pv, ar[i]);
        B(dx - 5.8, 55, dz, 2.6, 8, 3.2, pk, pv, ar[i]); B(dx + 5.8, 55, dz, 2.6, 8, 3.2, pk, pv, ar[i]);
        B(dx, 65, dz, 10.4, 10.4, 10.4, pk, pv, ar[i]); B(dx - 5.7, 65, dz, 1.6, 3.6, 2.8, pk2, pv, ar[i]); B(dx + 5.7, 65, dz, 1.6, 3.6, 2.8, pk2, pv, ar[i]);
        B(dx - 2.4, 66, dz + 5.3, 1.8, 1.8, .6, '#2a1a14', pv, ar[i]); B(dx + 2.4, 66, dz + 5.3, 1.8, 1.8, .6, '#2a1a14', pv, ar[i]); B(dx, 62.6, dz + 5.3, 3, 1, .6, '#b5655a', pv, ar[i]);
      }
    } else { B(s * 22, 68, 0, 9, 32, 10, sl, pv, ar[i]); B(s * 22, 50, 0, 9, 8, 9, hand, pv, ar[i]); const hv = s === 1 ? ch.holdR : ch.holdL; if (hv) holdItem(hv, ax + s * 8, pv, ar[i]); }
  });
  if (ch.polo) { // polo de crochê oversize: gola listrada, botões, logo e costuras da trama
    B(0, 61, 0, 38, 46, 23, ch.hood); B(0, 39.5, 0, 38.6, 3, 23.6, shade(ch.hood, .93));
    B(0, 64, 11.9, 6, 32, 1.2, shade(ch.hood, .93)); [76, 69, 62].forEach(yy => B(0, yy, 12.2, 2.4, 2.4, 1.2, '#cfc9b8'));
    B(8, 71, 11.6, 5, 5, 1.4, '#f06a86'); B(8, 71, 12.6, 2.4, 2.4, 1, '#3a1420');
    B(0, 85.6, 0, 22, 4, 15, ch.hood);
    B(0, 87.4, 0, 22.8, 1.2, 15.8, '#d2303a'); B(0, 86.3, 0, 22.8, 1, 15.8, '#1d3f2e'); B(0, 85.3, 0, 22.8, 1, 15.8, '#2d7fd1');
  } else B(0, 62, 0, 34, 44, 20, ch.hood);
  if (ch.neto) { // polo azul clara: gola, barra e escudo no peito
    B(0, 85.6, 0, 22, 4, 15, shade(ch.hood, .8)); B(0, 39.5, 0, 34.6, 3, 20.6, shade(ch.hood, .88));
    B(-7, 72, 10.9, 6, 7, 1.6, '#ffffff'); B(-7, 72, 11.8, 3.6, 4.4, 1, '#14151a');
  }
  // Costuras, painel frontal e bolsinho da jaqueta/moletom.
  B(-10, 63, 10.7, 2, 31, 1.5, shade(ch.hood, 1.28));
  B(0, 51, 10.8, 20, 2, 1.5, shade(ch.hood, .72));
  B(7, 59, 11, 10, 10, 1.8, shade(ch.hood, .82));
  B(7, 59, 12.2, 5, 2, 1.2, ch.detail || ch.cap);
  if (ch.belt) B(0, 48, 0, 35, 5, 21, ch.belt);
  if (ch.bag) { // bolsa transversal: alça diagonal (frente e costas) + bolsa com aba e fivela no quadril
    const bs = shade(ch.bag, .78);
    for (let t = 0; t < 5; t++) { const bx = -11 + t * 4.6, by = 83 - t * 7.4; B(bx, by, 10.9, 4.4, 8.4, 1.3, bs); B(-bx, by, -10.9, 4.4, 8.4, 1.3, bs); }
    B(10, 46, 12.4, 17, 14, 5.4, ch.bag); B(10, 51, 15.4, 17.4, 5.4, 1.2, shade(ch.bag, .8)); B(10, 48.4, 16.2, 3.4, 3.4, .8, '#d8b34a'); B(10, 41, 12.4, 17, 1.6, 5.6, shade(ch.bag, .65));
  }
  if (!ch.nopack) { B(0, 64, -14, 22, 28, 8, ch.cap); B(7, 82, -13, 7, 16, 7, '#e8453c'); } // mochila e lata de spray
  B(0, 87, 0, 9, 6, 9, skin); B(0, 100, 0, 24, 24, 24, skin);
  if (!ch.nohair) B(0, 97, -11.5, 24, 15, 3, ch.hairCol || '#3a2616');
  if (ch.neto) { // barba cheia, bigode, olhos e brinco
    B(0, 93.5, 12.4, 19, 8, 2.4, '#1f1612'); B(0, 96.6, 12.7, 10, 2, 1.4, '#1f1612'); B(-12.2, 95, 5, 1.4, 10, 14, '#1f1612'); B(12.2, 95, 5, 1.4, 10, 14, '#1f1612');
    B(-5, 101.5, 12.3, 3, 2.2, 1, '#14151a'); B(5, 101.5, 12.3, 3, 2.2, 1, '#14151a'); B(0, 91.4, 12.6, 6, 1, 1, '#f3e4dc'); B(12.8, 97, 1, 1.8, 3.4, 3.4, '#e8ecf5');
  }

  // ---- ROSTO (UPDATE 10): todo personagem ganha rosto automaticamente, inclusive skins novas. ----
  // Personalize em qualquer skin com ch.face = { eye, eyeY, eyeGap } ou desligue com ch.noFace = true.
  if (!ch.noFace && !ch.neto && ch.acc !== 'dona' && ch.acc !== 'helmet') {
    const fc = ch.face || {}, ez = 12.45, ey = fc.eyeY || 100.2, ex = fc.eyeGap || 5.2, ink = fc.eye || '#14172e', emo = o.emote || 'smile', bl = !!o.blink, lk = o.look || 0, brow = shade(ch.hairCol || '#3a2616', 1), wow = emo === 'wow';
    [-1, 1].forEach(s => {
      const closed = bl || emo === 'happy' || (emo === 'wink' && s === 1);
      if (closed) { B(s * ex, ey - .4, ez, 5, 1.2, 1, ink); if (emo === 'happy') B(s * ex, ey + .8, ez, 3.4, 1, 1, ink); }
      else { B(s * ex, ey, ez, 5.2, wow ? 7.4 : 5.8, 1, '#ffffff'); B(s * ex + lk, ey - .3, ez + .5, 2.8, wow ? 3.4 : 3.8, 1, ink); B(s * ex + lk + .7, ey + .8, ez + 1, 1, 1, .5, '#ffffff'); }
      B(s * ex, ey + (wow ? 6.4 : 4.8) + (emo === 'wink' && s === 1 ? -1 : 0), ez, 5.6, 1.3, 1, brow);
      B(s * 8.4, ey - 3.2, ez, 3.2, 1.8, 1, '#f08a86'); // bochecha
    });
    B(0, ey - 3.8, ez + .4, 2.4, 2.8, 1.4, shade(skin, .86)); // nariz
    const my = ey - 8.4, mc = '#7a2a2e';
    if (emo === 'open' || emo === 'happy') { B(0, my, ez, 6.4, 4, 1, '#5a1418'); B(0, my + 1.4, ez + .3, 5.2, 1.2, 1, '#ffffff'); B(0, my - 1.2, ez + .3, 3.6, 1.6, 1, '#ff7a8a'); }
    else if (wow) B(0, my - .4, ez, 3.6, 4.6, 1, '#5a1418');
    else { B(0, my, ez, 6.4, 1.3, 1, mc); B(-3.6, my + .9, ez, 1.4, 1.4, 1, mc); B(3.6, my + .9, ez, 1.4, 1.4, 1, mc); if (emo === 'tongue') B(1.2, my - 1.9, ez + .4, 3.2, 3.4, 1, '#ff6f86'); }
  }
  const a = ch.acc, cp = ch.cap;
  if (a === 'cap' || a === 'visor') {
    const backCap = ch.capDir === 'back', brimZ = backCap ? -16 : 16, badgeZ = backCap ? 13.7 : -13.7;
    // Boné com aba projetada, topo facetado, costura, botão e emblema lateral em relevo.
    B(0, 110, 0, 26, 10, 26, cp);
    B(0, 108, brimZ, 25, 3.5, 13, shade(cp, .88));
    B(0, 110, brimZ + (backCap ? -5 : 5), 23, 2, 4, shade(cp, .68));
    B(0, 115, 0, 5, 2, 5, shade(cp, 1.25));
    B(0, 113, -2, 2, 7, 22, shade(cp, 1.12));
    B(backCap ? -11 : 11, 108, -2, 3, 3, 8, shade(cp, .72));
    B(0, 104, badgeZ, 8, 5, 2, ch.detail || shade(cp, .7));
    B(0, 104, badgeZ + (backCap ? -1 : 1), 3, 2, 1.2, '#ffffff');
    if (a === 'visor') B(0, 101, -12.5, 24, 5, 2, '#4ff0ff');
  }
  if (a === 'dona') {
    // cabelo escuro com topo mais alto, degradê nas laterais e mechas claras que pegam a luz
    B(0, 110.5, 0, 25, 6, 25, '#43362e'); B(0, 106, -12.6, 25, 9, 1.6, '#3b2f29'); B(0, 98.5, -12.4, 22, 6, 1.2, '#6b5b4e'); B(0, 109.4, -12.9, 16, 2.4, .8, '#d8cfbd'); B(-7, 106, -12.9, 5, 2, .8, '#bdb2a0'); B(7, 106.6, -12.9, 6, 2, .8, '#e6dfd0');
    B(-12.8, 103, -1, 1.6, 12, 22, '#5a4a3e'); B(12.8, 103, -1, 1.6, 12, 22, '#5a4a3e');
    B(-6, 113.8, 0, 7, 1.6, 24, '#d8cfbd'); B(3, 113.8, 0, 5, 1.6, 24, '#f1ebdc'); B(9, 113.6, 0, 3, 1.4, 22, '#c4b9a5');
    B(0, 113.6, 7, 14, 1.6, 9, '#ddd4c2'); B(-5, 108.5, -13.6, 4, 7, 1, '#cfc5b3'); B(5, 109.5, -13.6, 3, 6, 1, '#e6dfd0');
    // óculos escuros de lente única, com brilho e hastes
    B(0, 102.5, 12.6, 23, 5.5, 1.8, '#0a0a10'); B(-6, 103.6, 13.7, 5, 1.2, .8, '#8a90b0'); B(6, 103.6, 13.7, 5, 1.2, .8, '#8a90b0');
    B(-12.3, 102.5, 0, 1.4, 2.4, 24, '#0a0a10'); B(12.3, 102.5, 0, 1.4, 2.4, 24, '#0a0a10');
    B(0, 96.2, 12.5, 8, 1.2, 1, '#3b2f29'); B(0, 92.8, 12.5, 8, 2.4, 1, '#ffffff'); // bigode e sorriso
  }
  if (a === 'beanie') {
    B(0, 111, 0, 26, 13, 26, cp); B(0, 106, 0, 27, 5, 27, shade(cp, .75));
    B(0, 111, -13.7, 2, 8, 1.5, shade(cp, 1.25));
    B(-7, 112, -13.7, 2, 8, 1.5, shade(cp, .72));
    B(0, 119, 0, 8, 8, 8, ch.detail || '#ffffff');
  }
  if (a === 'phones') { B(0, 110, 0, 26, 6, 26, '#14172e'); B(0, 113, 0, 28, 3, 8, cp); B(-14, 100, 0, 6, 13, 13, cp); B(14, 100, 0, 6, 13, 13, cp); }
  if (a === 'spikes') { B(0, 110, 0, 26, 8, 26, '#14172e'); B(-8, 116, 0, 6, 12, 6, cp); B(0, 119, 0, 6, 16, 6, cp); B(8, 116, 0, 6, 12, 6, cp); }
  if (a === 'crown') { B(0, 112, 0, 22, 5, 22, '#ffd21f'); B(-8, 118, 0, 5, 8, 5, '#ffd21f'); B(0, 120, 0, 5, 10, 5, '#ffd21f'); B(8, 118, 0, 5, 8, 5, '#ffd21f'); }
  if (a === 'santa') { B(0, 110, 0, 27, 10, 27, '#d92b2b'); B(0, 105, 0, 28, 5, 28, '#ffffff'); B(0, 118, -2, 18, 10, 18, '#d92b2b'); B(0, 125, -6, 11, 8, 11, '#d92b2b'); B(0, 127, -11, 8, 8, 8, '#ffffff'); }
  if (a === 'pumpkin') { B(0, 114, 0, 5, 6, 5, '#4a8a2a'); B(4, 116, 0, 8, 2, 4, cp); B(-5, 100, -12.3, 2, 22, 1, shade(skin, .7)); B(5, 100, -12.3, 2, 22, 1, shade(skin, .7)); }
  if (a === 'witch') { B(0, 112, 0, 38, 3, 38, cp); B(0, 119, 0, 20, 12, 20, cp); B(0, 128, 0, 13, 10, 13, cp); B(0, 135, 0, 7, 8, 7, cp); B(0, 115, 0, 21, 3, 21, '#ff8a1f'); }
  if (a === 'ninja') { B(0, 106, 0, 26, 5, 26, cp); B(-4, 104, -14, 4, 11, 2, cp); B(5, 101, -14.5, 4, 11, 2, cp); }
  if (a === 'beach') { B(0, 111, 0, 38, 2, 38, cp); B(0, 115, 0, 22, 8, 22, shade(cp, 1.1)); B(0, 112.5, 0, 23, 2, 23, '#e8453c'); }
  if (a === 'helmet') { B(0, 101, 0, 32, 32, 32, cp); B(8, 120, 0, 2, 8, 2, '#e8453c'); }
  if (a === 'robot') { B(0, 115, 0, 3, 8, 3, '#cfd8ee'); B(0, 121, 0, 6, 6, 6, cp); B(-13, 100, 0, 4, 8, 8, cp); B(13, 100, 0, 4, 8, 8, cp); }
  if (a === 'pirate') { B(0, 110, 0, 30, 8, 30, '#14172e'); B(-16, 112, 0, 8, 8, 28, '#14172e'); B(16, 112, 0, 8, 8, 28, '#14172e'); B(0, 109, -15.5, 8, 6, 1, '#ffffff'); }
  if (ch.chain) {
    B(0, 72, -11.8, 19, 3, 2.6, shade(ch.chain, 1.18));
    B(0, 67, -12, 3.5, 10, 2.8, ch.chain);
    B(0, 62, -13.7, 6, 7, 2.8, ch.detail || ch.chain);
    B(0, 62, -15.2, 2, 3, 1.2, '#fff4c2');
  }
  if (ch.flag === 'br') { B(0, 62, -10.8, 14, 9, 2, '#18864b'); B(0, 62, -12, 7, 5, 2, '#f2c94c'); }
  if (ch.flag === 'fr') { B(-8, 62, -10.8, 5, 13, 2, '#253b8f'); B(0, 62, -10.8, 5, 13, 2, '#f7f7fb'); B(8, 62, -10.8, 5, 13, 2, '#e23b4b'); }
  if (ch.flag === 'uk') { B(0, 62, -10.8, 15, 12, 2, '#263b80'); B(0, 62, -12, 3, 12, 2, '#f7f7fb'); B(0, 62, -13, 15, 3, 2, '#e34b58'); }
  const cen = [0, 50, 0], faces = [];
  const SA = -1.0 * sk; // carrinho: corpo inclina para trás, quadril desce e as pernas vão à frente
  const G = p0 => { let p = L(p0); if (roll) { const q = rot3([p[0] - cen[0], p[1] - cen[1], p[2] - cen[2]], ang, 0, 0); p = [q[0] + cen[0], q[1] + cen[1], q[2] + cen[2]]; } if (sk) { const q = rot3([p[0], p[1] - 40, p[2]], SA, 0, 0); p = [q[0], q[1] + 40 - 22 * sk, q[2]]; } return rot3(rot3(p, 0, yaw, 0), pit, 0, 0); };
  const GN = n => { if (roll) n = rot3(n, ang, 0, 0); if (sk) n = rot3(n, SA, 0, 0); return rot3(rot3(n, 0, yaw, 0), pit, 0, 0); };
  for (const pt of parts) for (const f of FACES3) {
    let n = f.n; if (pt.pv) n = rot3(n, pt.rx, 0, 0);
    const gn = GN(n); if (gn[2] > .02) continue; // mantém faces rasantes para evitar cortes bruscos ao girar a câmera
    const pts = f.v.map(sg => {
      let p = [pt.c[0] + sg[0] * pt.s[0] / 2, pt.c[1] + sg[1] * pt.s[1] / 2, pt.c[2] + sg[2] * pt.s[2] / 2];
      if (pt.pv) { const r = rot3([p[0] - pt.pv[0], p[1] - pt.pv[1], p[2] - pt.pv[2]], pt.rx, 0, 0); p = [r[0] + pt.pv[0], r[1] + pt.pv[1], r[2] + pt.pv[2]]; }
      return G(p);
    });
    const lt = Math.max(0, gn[0] * -.4 + gn[1] * .8 + gn[2] * -.45); // luz vinda de cima, da esquerda e da frente da câmera
    faces.push({ pts, k: .55 + .65 * lt, col: pt.col, vis: Math.max(.08, Math.min(1, (-gn[2] + .02) / .18)), z: (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4 });
  }
  faces.sort((a1, b1) => b1.z - a1.z); // mais longe primeiro
  c.lineJoin = 'round'; c.lineWidth = Math.max(.8, 1.5 * u); c.strokeStyle = INK;
  for (const f of faces) {
    c.globalAlpha = f.vis === undefined ? 1 : f.vis;
    c.fillStyle = shade(f.col, f.k); c.strokeStyle = shade(f.col, f.k * .78); c.lineWidth = 1; c.beginPath();
    f.pts.forEach((p, i) => { const k = 1 / (1 + p[2] * .0035), px = x + p[0] * u * k, py = y0 - p[1] * u * k; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.closePath(); c.fill(); c.stroke();
  }
  c.globalAlpha = 1;
  // Texturas de camisa, calça e acessório desenhadas sobre o modelo original.
  _srPaintSkinTextures(c, ch, G, u, x, y0, yaw, bob);
  // Textura opcional na mochila, aplicada sobre a área traseira do personagem.
  if (!ch.nopack && backpackImage && backpackImage.complete && backpackImage.naturalWidth && !roll && !sk) {
    const bw=22*u*CFG.bpSize, bh=25*u*CFG.bpSize, bx=x-bw/2, by=y0-64.5*u-bh/2;
    c.save(); c.globalAlpha=.96; c.drawImage(backpackImage,bx,by,bw,bh); c.restore();
  }
  // Emblema personalizado na face frontal da pulseira, no pulso direito.
  if (!ch.nopack && wristImage && wristImage.complete && wristImage.naturalWidth && !roll && !sk) {
    const ww=Math.max(5, 11*u), wh=Math.max(4, 7*u), wx=x+15*u, wy=y0-52*u;
    c.save(); c.translate(wx, wy); c.rotate(-.12); c.drawImage(wristImage, -ww/2, -wh/2, ww, wh); c.restore();
  }
  // Trama de crochê e nome nas costas da camisa (acompanham a rotação do personagem)
  if ((ch.backText || ch.mesh) && !roll && !sk && GN([0, 0, -1])[2] < -.2) {
    const P = (mx, my) => { const q = G([mx, my + bob, -11.6]), k = 1 / (1 + q[2] * .0035); return [x + q[0] * u * k, y0 - q[1] * u * k]; };
    const O = P(0, 0), X = P(1, 0), Y = P(0, 1);
    c.save(); c.transform(X[0] - O[0], X[1] - O[1], Y[0] - O[0], Y[1] - O[1], O[0], O[1]); // coordenadas do modelo (y para cima)
    if (ch.mesh) { c.fillStyle = 'rgba(110,102,88,.34)'; for (let gy = 41, r = 0; gy < 83; gy += 3.4, r++) for (let gx = -17 + (r % 2) * 1.7; gx < 17; gx += 3.4) c.fillRect(gx, gy, 1.4, 1.4); }
    if (ch.backText) {
      const by = -(ch.backY || 64), fam = '900 FSpx Arial Black, Impact, Arial, sans-serif';
      c.scale(1, -1); c.textAlign = 'center'; c.textBaseline = 'middle';
      let fs = 10.5; c.font = fam.replace('FS', fs); const tw = c.measureText(ch.backText).width; if (tw > 30) { fs = fs * 30 / tw; c.font = fam.replace('FS', fs); } // cabe nas costas
      c.lineWidth = Math.min(1.8, fs * .17); c.strokeStyle = '#14172e'; c.lineJoin = 'round'; c.strokeText(ch.backText, 0, by); c.fillStyle = ch.backCol || '#d2303a'; c.fillText(ch.backText, 0, by);
    }
    c.restore();
  }
}
function drawChar2D(c, x, y0, u, ch, o = {}) { // versão 2D antiga (não usada)
  const sw = Math.sin(o.run || 0), INK = '#14172e';
  if (!o.air && !o.roll) y0 -= Math.abs(sw) * 3 * u; // balanço ao correr
  const dp = 3.2 * u; // espessura das peças (efeito 3D)
  c.lineWidth = 2.6 * u; c.strokeStyle = INK; c.lineJoin = 'round'; c.lineCap = 'round';
  const rr = (a, b, w, h, r, f) => { // peça com espessura (lado escuro) e luz diagonal
    c.fillStyle = shade(f, .5); c.beginPath(); c.roundRect(a + dp, b + dp * .6, w, h, r); c.fill(); c.stroke();
    const gr = c.createLinearGradient(a, b, a + w, b + h); gr.addColorStop(0, shade(f, 1.3)); gr.addColorStop(.55, shade(f, 1)); gr.addColorStop(1, shade(f, .72));
    c.fillStyle = gr; c.beginPath(); c.roundRect(a, b, w, h, r); c.fill(); c.stroke();
  };
  const dot = (a, b, r, f) => { // esfera com espessura, luz e brilho
    c.fillStyle = shade(f, .5); c.beginPath(); c.arc(a + dp * .7, b + dp * .4, r, 0, 7); c.fill(); c.stroke();
    const gr = c.createRadialGradient(a - r * .4, b - r * .45, r * .05, a, b, r * 1.05); gr.addColorStop(0, shade(f, 1.45)); gr.addColorStop(.5, shade(f, 1)); gr.addColorStop(1, shade(f, .7));
    c.fillStyle = gr; c.beginPath(); c.arc(a, b, r, 0, 7); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.ellipse(a - r * .35, b - r * .4, r * .28, r * .18, -.6, 0, 7); c.fill();
  };
  const ln = (a, b, d, e) => { c.beginPath(); c.moveTo(a, b); c.lineTo(d, e); c.stroke(); };
  if (o.roll) { // rolando
    c.save(); c.translate(x, y0 - 26 * u); c.rotate((o.spin || 0) * 18);
    rr(-24 * u, -22 * u, 48 * u, 44 * u, 20 * u, ch.hood); rr(-12 * u, -18 * u, 22 * u, 22 * u, 6 * u, ch.cap); dot(14 * u, -6 * u, 11 * u, ch.skin);
    c.restore(); return;
  }
  const lk = o.air ? 6 : sw * 8;
  for (const s of [-1, 1]) { // braços com mãos
    const ax = s < 0 ? x - 31 * u : x + 20 * u, ay = y0 - 82 * u - s * sw * 6 * u;
    rr(ax, ay, 11 * u, 28 * u, 5 * u, ch.hood); dot(ax + 5.5 * u, ay + 30 * u, 5 * u, ch.skin);
  }
  for (const s of [-1, 1]) { // pernas e tênis
    const lx = s < 0 ? x - 18 * u : x + 4 * u, d = s * lk * u * .5;
    rr(lx, y0 - 38 * u, 14 * u, 32 * u + d, 5 * u, ch.pants);
    rr(lx - 3 * u, y0 - 10 * u + d, 20 * u, 10 * u, 4 * u, '#ffffff');
    c.fillStyle = ch.cap; c.fillRect(lx - 1 * u, y0 - 3 * u + d, 16 * u, 2.5 * u);
  }
  rr(x - 21 * u, y0 - 86 * u, 42 * u, 54 * u, 11 * u, ch.hood); // corpo
  c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(x - 17 * u, y0 - 82 * u, 7 * u, 44 * u);
  c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x - 21 * u, y0 - 46 * u, 42 * u, 4 * u);
  c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1.6 * u; ln(x - 18 * u, y0 - 80 * u, x - 18 * u, y0 - 40 * u); c.strokeStyle = INK; c.lineWidth = 2.6 * u; // luz de borda
  rr(x - 14 * u, y0 - 90 * u, 28 * u, 10 * u, 5 * u, shade(ch.hood, .85)); // capuz
  rr(x - 13 * u, y0 - 78 * u, 26 * u, 30 * u, 6 * u, ch.cap); ln(x - 13 * u, y0 - 70 * u, x + 13 * u, y0 - 70 * u); // mochila
  rr(x + 6 * u, y0 - 93 * u, 7 * u, 16 * u, 2 * u, '#e8453c'); rr(x + 7 * u, y0 - 97 * u, 5 * u, 5 * u, 1.5 * u, '#ffffff'); // lata de spray
  c.fillStyle = shade(ch.skin, .8); c.fillRect(x - 5 * u, y0 - 88 * u, 10 * u, 6 * u); // pescoço
  dot(x - 15 * u, y0 - 96 * u, 4 * u, ch.skin); dot(x + 15 * u, y0 - 96 * u, 4 * u, ch.skin); // orelhas
  dot(x, y0 - 98 * u, 15 * u, ch.skin); rr(x - 11 * u, y0 - 92 * u, 22 * u, 7 * u, 3 * u, '#3a2616'); // cabeça e cabelo
  c.fillStyle = ch.acc === 'spikes' ? '#14172e' : ch.cap; c.beginPath(); c.arc(x, y0 - 100 * u, 16 * u, Math.PI * .95, Math.PI * 2.05); c.closePath(); c.fill(); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.45)'; c.beginPath(); c.arc(x - 2 * u, y0 - 102 * u, 11 * u, Math.PI * 1.1, Math.PI * 1.6); c.stroke(); c.strokeStyle = INK;
  if (ch.acc === 'cap') rr(x - 7 * u, y0 - 91 * u, 14 * u, 4 * u, 2 * u, shade(ch.cap, .7));
  if (ch.acc === 'beanie') { rr(x - 16 * u, y0 - 100 * u, 32 * u, 7 * u, 3 * u, shade(ch.cap, .75)); dot(x, y0 - 118 * u, 5 * u, '#ffffff'); }
  if (ch.acc === 'phones') { c.beginPath(); c.arc(x, y0 - 100 * u, 16 * u, Math.PI, 0); c.stroke(); dot(x - 16 * u, y0 - 97 * u, 6.5 * u, ch.cap); dot(x + 16 * u, y0 - 97 * u, 6.5 * u, ch.cap); }
  if (ch.acc === 'spikes') for (let i = -1; i <= 1; i++) { c.fillStyle = ch.cap; c.beginPath(); c.moveTo(x + i * 9 * u - 5 * u, y0 - 112 * u); c.lineTo(x + i * 9 * u, y0 - 128 * u); c.lineTo(x + i * 9 * u + 5 * u, y0 - 112 * u); c.closePath(); c.fill(); c.stroke(); }
  if (ch.acc === 'visor') rr(x - 13 * u, y0 - 104 * u, 26 * u, 7 * u, 3 * u, '#4ff0ff');
  if (ch.acc === 'crown') { c.fillStyle = '#ffd21f'; c.beginPath(); c.moveTo(x - 12 * u, y0 - 112 * u); c.lineTo(x - 12 * u, y0 - 126 * u); c.lineTo(x - 5 * u, y0 - 118 * u); c.lineTo(x, y0 - 128 * u); c.lineTo(x + 5 * u, y0 - 118 * u); c.lineTo(x + 12 * u, y0 - 126 * u); c.lineTo(x + 12 * u, y0 - 112 * u); c.closePath(); c.fill(); c.stroke(); }
}
function drawCharOld(c, x, y0, u, ch, o = {}) { // versão simples (não usada)
  const sw = Math.sin(o.run || 0);
  c.lineWidth = 3 * u; c.strokeStyle = '#14172e'; c.lineJoin = 'round';
  const rr = (a, b, w, h, r, f) => { c.fillStyle = f; c.beginPath(); c.roundRect(a, b, w, h, r); c.fill(); c.stroke(); };
  const dot = (a, b, r, f) => { c.fillStyle = f; c.beginPath(); c.arc(a, b, r, 0, 7); c.fill(); c.stroke(); };
  if (o.roll) { c.save(); c.translate(x, y0 - 26 * u); c.rotate((o.spin || 0) * 18); rr(-24 * u, -22 * u, 48 * u, 44 * u, 20 * u, ch.hood); dot(10 * u, -8 * u, 12 * u, ch.cap); c.restore(); return; }
  const lk = o.air ? 6 : sw * 8;
  rr(x - 31 * u, y0 - 82 * u + sw * 6 * u, 11 * u, 32 * u, 5 * u, ch.hood); // braços
  rr(x + 20 * u, y0 - 82 * u - sw * 6 * u, 11 * u, 32 * u, 5 * u, ch.hood);
  rr(x - 18 * u, y0 - 38 * u, 14 * u, 32 * u - lk * u * .5, 5 * u, ch.pants); // pernas
  rr(x + 4 * u, y0 - 38 * u, 14 * u, 32 * u + lk * u * .5, 5 * u, ch.pants);
  rr(x - 21 * u, y0 - 10 * u - lk * u * .5, 20 * u, 9 * u, 4 * u, '#fff'); // tênis
  rr(x + 2 * u, y0 - 10 * u + lk * u * .5, 20 * u, 9 * u, 4 * u, '#fff');
  rr(x - 21 * u, y0 - 86 * u, 42 * u, 54 * u, 11 * u, ch.hood); // corpo
  rr(x - 12 * u, y0 - 78 * u, 24 * u, 28 * u, 6 * u, ch.cap); // mochila
  c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x - 17 * u, y0 - 46 * u, 34 * u, 4 * u); // faixa da blusa
  dot(x, y0 - 98 * u, 15 * u, ch.skin); // cabeça
  c.fillStyle = ch.acc === 'spikes' ? '#14172e' : ch.cap; c.beginPath(); c.arc(x, y0 - 100 * u, 16 * u, Math.PI * .95, Math.PI * 2.05); c.closePath(); c.fill(); c.stroke();
  if (ch.acc === 'beanie') dot(x, y0 - 118 * u, 5 * u, '#fff');
  if (ch.acc === 'visor') rr(x - 13 * u, y0 - 104 * u, 26 * u, 7 * u, 3 * u, '#4ff0ff');
  if (ch.acc === 'crown') { c.fillStyle = '#ffd21f'; c.beginPath(); c.moveTo(x - 12 * u, y0 - 112 * u); c.lineTo(x - 12 * u, y0 - 126 * u); c.lineTo(x - 5 * u, y0 - 118 * u); c.lineTo(x, y0 - 128 * u); c.lineTo(x + 5 * u, y0 - 118 * u); c.lineTo(x + 12 * u, y0 - 126 * u); c.lineTo(x + 12 * u, y0 - 112 * u); c.closePath(); c.fill(); c.stroke(); }
  if (ch.acc === 'phones') { dot(x - 16 * u, y0 - 98 * u, 6 * u, ch.cap); dot(x + 16 * u, y0 - 98 * u, 6 * u, ch.cap); }
  if (ch.acc === 'spikes') for (let i = -1; i <= 1; i++) { c.fillStyle = ch.cap; c.beginPath(); c.moveTo(x + i * 9 * u - 5 * u, y0 - 112 * u); c.lineTo(x + i * 9 * u, y0 - 128 * u); c.lineTo(x + i * 9 * u + 5 * u, y0 - 112 * u); c.closePath(); c.fill(); c.stroke(); }
}
// Cachorro do guarda: modelo em "caixas" (quadradão), igual aos personagens, correndo de frente para a câmera e olhando para a frente
function drawDog(c, x, y0, u, t, fit = {}) {
  const INK = '#14172e', fur = fit.fur || '#c8823f', dk = fit.dk || '#7a4a20', cream = '#f0d3a6', red = fit.collar || '#ff5468', ph = t / 85, s = Math.sin(ph), yaw = 0, pit = -.12 + Math.sin(ph * 2) * .025;
  const bob = Math.abs(s) * 4.5 + 1, wag = Math.sin(t / 38) * 6, hb = Math.sin(ph * 2 + 1) * 1.5, parts = [];
  const B = (cx, cy, cz, w, h, d, col, pv, rx) => parts.push({ c: [cx, cy + (pv ? 0 : bob), cz], s: [w, h, d], col, pv: pv || null, rx: rx || 0 });
  // galope: patas da frente e de trás defasadas, com o corpo saltando entre as passadas
  for (const [lx, lz, off] of [[-7, 15, 0], [7, 15, .4], [-7, -15, 1.7], [7, -15, 2.1]]) {
    const pv = [lx, 14 + bob, lz], rx = Math.sin(ph + off) * 1.3;
    B(lx, 7 + bob, lz, 6.5, 14, 6.5, fur, pv, rx); B(lx, 1.5 + bob, lz + 1, 7.5, 3, 8, cream, pv, rx);
  }
  B(0, 23, 0, 21, 16, 40, fur); B(0, 31.5, 0, 13, 2, 32, dk); B(0, 17, 0, 17, 3, 34, cream); // corpo, manta, barriga
  if (fit.vest) { B(0, 27, 0, 22.5, 11, 24, fit.vest); B(0, 27, 0, 23, 2.2, 8, fit.vestDet || '#ffffff'); }
  B(wag, 33 + Math.abs(wag) * .3, -23, 4, 13, 4, fur); B(wag * 1.3, 40, -23, 4.5, 3, 4.5, cream); // rabo balançando
  B(0, 30, 20.5, 19, 19, 4, red);          // coleira
  B(0, 34 + hb, 27, 17, 17, 17, fur); B(0, 31 + hb, 38, 10, 8, 9, cream); B(0, 33 + hb, 43, 5, 4, 2, INK); // cabeça, focinho, nariz
  B(0, 26.5 + hb, 38, 5, 2, 6 + Math.abs(s) * 4, '#ff7a8a'); // língua pulando
  if (fit.hat) { B(0, 44 + hb, 27, 14, 4, 14, fit.hat); B(0, 42.5 + hb, 33, 14, 1.6, 6, shade(fit.hat, .8)); }
  for (const sx of [-1, 1]) {
    const ep = [sx * 9.5, 39 + bob + hb, 25]; B(sx * 9.5, 33 + bob + hb, 25, 3.5, 12, 8, dk, ep, .55 + Math.sin(ph * 2 + sx) * .5); // orelhas ao vento
    B(sx * 8.7, 37 + hb, 32, 1.4, 4, 4, '#ffffff'); B(sx * 9.1, 37 + hb, 32.6, 1.4, 2.2, 2.2, INK); // olhos
  }
  const G = p => rot3(rot3(p, 0, yaw, 0), pit, 0, 0), faces = [];
  for (const pt of parts) for (const f of FACES3) {
    let n = f.n; if (pt.pv) n = rot3(n, pt.rx, 0, 0);
    const gn = rot3(rot3(n, 0, yaw, 0), pit, 0, 0); if (gn[2] > .02) continue;
    const pts = f.v.map(sg => {
      let p = [pt.c[0] + sg[0] * pt.s[0] / 2, pt.c[1] + sg[1] * pt.s[1] / 2, pt.c[2] + sg[2] * pt.s[2] / 2];
      if (pt.pv) { const r = rot3([p[0] - pt.pv[0], p[1] - pt.pv[1], p[2] - pt.pv[2]], pt.rx, 0, 0); p = [r[0] + pt.pv[0], r[1] + pt.pv[1], r[2] + pt.pv[2]]; }
      return G(p);
    });
    const lt = Math.max(0, gn[0] * -.4 + gn[1] * .8 + gn[2] * -.45);
    faces.push({ pts, k: .55 + .65 * lt, col: pt.col, vis: Math.max(.08, Math.min(1, (-gn[2] + .02) / .18)), z: (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4 });
  }
  faces.sort((a1, b1) => b1.z - a1.z);
  c.lineJoin = 'round'; c.lineWidth = Math.max(.8, 1.5 * u); c.strokeStyle = INK;
  for (const f of faces) {
    c.globalAlpha = f.vis === undefined ? 1 : f.vis;
    c.fillStyle = shade(f.col, f.k); c.strokeStyle = shade(f.col, f.k * .78); c.lineWidth = 1; c.beginPath();
    f.pts.forEach((p, i) => { const k = 1 / (1 + p[2] * .0035), px = x + p[0] * u * k, py = y0 - p[1] * u * k; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.closePath(); c.fill(); c.stroke();
  }
  c.globalAlpha = 1;
}

/* ---------- UPDATE 10: GUARDA COM ROUPA DIFERENTE EM CADA TEMA DE MAPA ---------- */
const GUARD_SETS = {
  urban:   { hood: '#2a4ea8', pants: '#1c2f6b', cap: '#14172e', skin: '#e0a070', acc: 'cap', detail: '#ffd21f', dog: { collar: '#ff5468', vest: '#2a4ea8', vestDet: '#ffd21f' } },
  nature:  { hood: '#4a6b3a', pants: '#6b5a3a', cap: '#7a6a3a', skin: '#e0a070', acc: 'beach', detail: '#c9a23c', dog: { collar: '#c9a23c', vest: '#4a6b3a', hat: '#7a6a3a' } },
  desert:  { hood: '#c9a15a', pants: '#6b4a2a', cap: '#5a3a1c', skin: '#d29a62', acc: 'beach', detail: '#ffd21f', dog: { collar: '#ffd21f', vest: '#c9a15a', hat: '#5a3a1c' } },
  beach:   { hood: '#e8453c', pants: '#f4f4f4', cap: '#ffffff', skin: '#e0a070', acc: 'cap', shorts: true, detail: '#e8453c', dog: { collar: '#ffffff', vest: '#e8453c', vestDet: '#ffffff' } },
  snow:    { hood: '#ff7a1a', pants: '#2a3a5a', cap: '#ffffff', skin: '#f0c39a', acc: 'beanie', detail: '#2f7bff', dog: { collar: '#2f7bff', vest: '#ff7a1a', hat: '#ffffff' } },
  haunt:   { hood: '#3a2a4a', pants: '#1f1a2a', cap: '#2a2036', skin: '#8fb08a', acc: 'witch', detail: '#ff8a1f', dog: { fur: '#6a6a7a', dk: '#3a3a4a', collar: '#ff8a1f', vest: '#3a2a4a', vestDet: '#ff8a1f' } },
  sky:     { hood: '#ffffff', pants: '#e8d9a0', cap: '#ffd21f', skin: '#f0c39a', acc: 'crown', detail: '#ffd21f', dog: { fur: '#f4f4f4', dk: '#d8d8e8', collar: '#ffd21f', vest: '#ffd21f' } },
  gear:    { hood: '#ffb21f', pants: '#3a3a46', cap: '#ffd21f', skin: '#d29a62', acc: 'helmet', detail: '#ffffff', dog: { collar: '#ffb21f', vest: '#ffb21f', vestDet: '#ffffff', hat: '#ffd21f' } },
  abyss:   { hood: '#1f6a8a', pants: '#134a5f', cap: '#27d3c3', skin: '#e0a070', acc: 'helmet', detail: '#ffffff', dog: { collar: '#27d3c3', vest: '#1f6a8a', vestDet: '#27d3c3' } },
  luna:    { hood: '#eef1f8', pants: '#cfd6e6', cap: '#eef1f8', skin: '#e0a070', acc: 'helmet', detail: '#2f7bff', dog: { fur: '#e8eaf2', dk: '#b8bfd0', collar: '#2f7bff', vest: '#eef1f8', vestDet: '#2f7bff', hat: '#cfd6e6' } },
  volcano: { hood: '#d92b2b', pants: '#2a2a2a', cap: '#ffd21f', skin: '#c98a5b', acc: 'helmet', detail: '#ffd21f', dog: { collar: '#ffd21f', vest: '#d92b2b', vestDet: '#ffd21f', hat: '#ffd21f' } },
  mine:    { hood: '#8a90a2', pants: '#5a5f70', cap: '#9aa0b2', skin: '#e0a070', acc: 'helmet', detail: '#4ff0ff', dog: { collar: '#4ff0ff', vest: '#8a90a2' } },
  samurai: { hood: '#8a1f2a', pants: '#1a1a2a', cap: '#14151a', skin: '#e8b28c', acc: 'ninja', detail: '#c9a23c', dog: { fur: '#2a2a3a', dk: '#14151a', collar: '#c9a23c', vest: '#8a1f2a', vestDet: '#c9a23c' } }
};
const _guardCache = {};
function guardFor(M) { // cada tema de mapa tem seu uniforme; o brilho do detalhe usa a cor de destaque do mapa
  const grp = fillGroup(M || MAPS[CFG.map]), k = grp + '|' + (M && M.n);
  if (!_guardCache[k]) { const b = GUARD_SETS[grp] || GUARD_SETS.urban; _guardCache[k] = Object.assign({}, GUARD, b); }
  return _guardCache[k];
}
// Guarda e cachorro na sua cola (aparece depois da primeira batida)
function drawGuard(now) {
  const v = Math.min(1, guard.age / .5, guard.t / .6); if (v <= 0) return;
  const p = P(pl.px, -70 - 420 * (1 - v)), u = PU * 1.1 * p.s;
  const M = MAPS[CFG.map], gd = guardFor(M), ph = now / 85, sw = Math.sin(ph), dogFit = gd.dog || {};
  // corrida solta: braços balançando bem mais, braço direito esticado tentando agarrar, tronco inclinado e quicando
  const gop = { run: ph, yaw: Math.sin(ph * .5) * .025, ar: [-sw * 1.5, -1.75 + Math.sin(ph * .5 + 1) * .45], lg: [sw * 1.3, -sw * 1.3], lean: .26 + Math.sin(ph) * .05, bobAdd: Math.abs(sw) * 3, emote: 'open' };
  drawChar(g, p.x - 8 * u, p.y - Math.abs(sw) * 4 * u, u, gd, gop);
  drawDog(g, p.x + 46 * u, p.y - Math.abs(Math.sin(now / 85 + .8)) * 5 * u, u * 1.25, now, dogFit);
}
// Tela de derrota cinematográfica: desaceleração, vinheta vermelha e tipografia de impacto (visual original).
function drawRoomRacers(now){if(!MATCH.active||!MATCH.room)return;const ps=MATCH.room.players||[],me=ps.find(p=>p.id===MATCH.id),myOffset=Number(me&&me.startOffset)||0;for(const p of ps){if(p.id===MATCH.id||p.status!=='alive')continue;const relative=(Number(p.distance)||0)+(Number(p.startOffset)||0)-dist-myOffset;if(relative< -100||relative>1900)continue;const q=P(Number(p.lane)||0,relative),u=PU*q.s*.72;if(q.y<HZ-5||q.y>GY+5)continue;g.save();g.globalAlpha=Math.min(1,.5+q.s*.5);g.fillStyle='#07101f77';g.beginPath();g.ellipse(q.x,q.y+3*U,20*u,5*u,0,0,Math.PI*2);g.fill();drawChar(g,q.x,q.y,u,CHARS[Number(p.character)||0]||CHARS[0],{run:now/85,yaw:0});g.font='800 '+Math.max(9,11*U)+'px system-ui';g.textAlign='center';g.lineWidth=3;g.strokeStyle='#0a1024';g.fillStyle='#fff';g.strokeText(String(p.name||'Jogador').slice(0,14),q.x,q.y-88*u);g.fillText(String(p.name||'Jogador').slice(0,14),q.x,q.y-88*u);g.restore();}}
function drawDeath() {
  if (st !== 'dying') return;
  const fade = Math.max(0, 1 - dieT / 1.5), pulse = .5 + .5 * Math.sin(dieT * 8);
  g.save();
  g.fillStyle = `rgba(70, 5, 14, ${.18 + .22 * fade})`; g.fillRect(0, 0, W, H);
  const vg = g.createRadialGradient(W/2, H*.42, H*.08, W/2, H*.42, Math.max(W,H)*.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${.78 * fade})`); g.fillStyle = vg; g.fillRect(0,0,W,H);
  const scale = Math.min(1, dieT / .18) * (1 + .035 * pulse);
  g.translate(W/2, H*.31); g.scale(scale, scale); g.textAlign = 'center';
  g.font = `900 ${Math.max(28, 54*U)}px Impact, Arial Black, sans-serif`;
  g.lineWidth = Math.max(3, 7*U); g.strokeStyle = '#160b12'; g.fillStyle = '#f2f2f2';
  const headline = /PEGO/.test(dieTitle) ? 'VOCÊ FOI PEGO' : 'FIM DE JOGO';
  g.strokeText(headline, 0, 0); g.fillText(headline, 0, 0);
  g.font = `800 ${Math.max(12, 16*U)}px system-ui, sans-serif`; g.fillStyle = '#ff5364';
  g.fillText(String(dieTitle).toUpperCase(), 0, 30*U);
  g.fillStyle = 'rgba(255,255,255,.86)'; g.font = `700 ${Math.max(11, 14*U)}px system-ui, sans-serif`;
  g.fillText(`PONTOS  ${over.score || 0}     •     MOEDAS  ${coins || 0}`, 0, 58*U);
  g.restore();
}
let fpsN = 0, fpsT = 0;
function loop(now) {
  { const hm = st === 'title' || st === 'over'; if (document.body.classList.contains('home') !== hm) document.body.classList.toggle('home', hm); } // HUD só fica oculto no menu; em jogo/pausa/edição volta tudo
  const real = now - last; last = now;

  if (real > 0 && real < 1000) { fpsN++; fpsT += real; if (fpsT >= 500) { const fe = $('#fps'); if (fe && CFG.fps.show) fe.textContent = Math.round(fpsN * 1000 / fpsT) + ' FPS'; fpsN = 0; fpsT = 0; } }
  if (st === 'play') update(Math.max(0, Math.min(.05, real / 1000)), Math.max(0, real));
  else if (st === 'dying') { // o mundo desacelera enquanto o personagem cai
    const dt = Math.max(0, Math.min(.05, real / 1000)); dieT += dt; dist += speed * dt * Math.max(0, 1 - dieT / .7); guard.age += dt;
    if (dieT > 1.5 && MATCH.phase !== 'finished') MATCH.room ? screen('eliminated') : screen('over');
  }
  else if (st === 'title' || st === 'over') { dist += 110 * Math.max(0, Math.min(.05, real / 1000)); }
  g.save(); if ((st === 'dying' && dieT < .5) || (st === 'play' && pl.stun > 0)) g.translate(rnd(-6, 6), 0); // tremor de câmera ao bater
  draw(now);
  if (MATCH.active) drawRoomRacers(now);
  if (CFG.graphics==='ultra' || CFG.graphics==='ultramax') { g.save(); g.globalAlpha=CFG.graphics==='ultramax'?.10:.055; const grd=g.createRadialGradient(W/2,H*.45,Math.min(W,H)*.08,W/2,H*.45,Math.max(W,H)*.72); grd.addColorStop(0,'#ffffff'); grd.addColorStop(1,'#7dbdff'); g.fillStyle=grd; g.fillRect(0,0,W,H); g.restore(); }
  if (st === 'play' && guard.t > 0) { g.font = '900 ' + 20 * U + 'px Impact, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ff5468'; g.strokeStyle = '#14172e'; g.lineWidth = 4; const tx = '👮 GUARDA NA SUA COLA! ' + Math.ceil(guard.t) + 's'; g.strokeText(tx, W / 2, H * .2); g.fillText(tx, W / 2, H * .2); }
  if (st === 'play' && msgT > 0) { g.font = '900 ' + 22 * U + 'px Impact, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffd21f'; g.strokeStyle = '#14172e'; g.lineWidth = 4; g.strokeText(msgTxt, W / 2, H * .28); g.fillText(msgTxt, W / 2, H * .28); }
  g.restore(); drawDeath();
  requestAnimationFrame(loop);
}

/* ---------- 5. CONTROLES (KeyTweak, toque, aba oculta) ---------- */
function act(id) { pressFx(id);
  if (id === 'pause') return st === 'play' ? pauseGame() : st === 'pause' ? resume() : 0;
  if (st !== 'play') return;
  if (id === 'left') { pl.prev = pl.lane; pl.lane = Math.max(-1, pl.lane - 1); }
  if (id === 'right') { pl.prev = pl.lane; pl.lane = Math.min(1, pl.lane + 1); }
  if (id === 'board') { // prancha: dura 10s, recarrega 30s, absorve uma batida
    if (board.t > 0) return;
    if (board.cd > 0) { msgTxt = '🛹 PRANCHA RECARREGANDO ' + Math.ceil(board.cd) + 's'; msgT = 1.2; return; }
    board.t = 10; board.cd = 30; sfx(500, .3, 'triangle', .09, 900); msgTxt = '🛹 PRANCHA ATIVADA!'; msgT = 1.5;
  }
  if (id === 'coin') { tAccum = 0; tFrozen = false; msgTxt = '⏱️ TIMER ZERADO'; msgT = 1.5; hud(); } // só recomeça o tempo do zero: não pausa nem retoma
  if (id === 'jump') { // pulo com tolerância: pula logo após sair da borda ou guarda o toque por 0,15s
    if ((pl.jy <= pl.floor + 1 || pl.coy > 0) && pl.vy <= 0) { pl.vy = JV(); pl.roll = 0; pl.coy = 0; sfx(420, .18, 'square', .07, 760); } else pl.buf = .15;
  }
  if (id === 'roll') { if (pl.roll > .12) return; sfx(240, .2, 'triangle', .07, 95); pl.roll = ROLL_T; if (pl.jy > pl.floor) pl.vy = -1500; }
}
const MODS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph'];
addEventListener('keydown', e => {
  if (st === 'settings' && listening) {
    e.preventDefault();
    if (e.code === 'Escape') { listening = null; return drawSettings(); }
    if (MODS.includes(e.key)) return;
    const used = Object.keys(CFG.keys).find(k => CFG.keys[k].c === e.code && k !== listening);
    if (used) { setMsg('#kMsg', `Essa tecla já é de “${ACT[used][0]}”. Escolha outra.`, 0); return; }
    CFG.keys[listening] = { c: e.code, l: kName(e.code, e.key) }; listening = null; save(); drawSettings(); setMsg('#kMsg', 'Tecla salva.', 1); return;
  }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.repeat) return;
  if (e.code === 'Enter' && (st === 'title' || st === 'over')) return startGame();
  const ALT = { KeyA: 'left', KeyD: 'right', KeyW: 'jump', KeyS: 'roll', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'roll' }; // WASD e setas sempre funcionam
  const id = Object.keys(CFG.keys).find(k => CFG.keys[k].c === e.code) ;
  if (id) { e.preventDefault(); act(id); }
});
$('#pauseBtn').onclick = () => act('pause');
// Toque: deslize para esquerda/direita/cima (pular)/baixo (rolar)
let t0 = null, lastTap = 0, swiped = false, activePointer = null;
// Controles mobile robustos: captura o gesto no canvas e usa fallback touch para WebViews antigos.
cv.style.touchAction = 'none';
cv.style.webkitTouchCallout = 'none';
cv.style.userSelect = 'none';
cv.style.webkitUserSelect = 'none';
const swipeStart = (x, y, id = null) => { t0 = [x, y]; swiped = false; activePointer = id; };
const SWIPE_MIN = 20;
const swipeAct = (dx, dy) => act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'jump' : 'roll'));
const swipeMove = (x, y) => {
  if (!t0 || swiped) return;
  const dx = x - t0[0], dy = y - t0[1];
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
  swiped = true; swipeAct(dx, dy); // responde no meio do gesto, sem esperar soltar o dedo
};
const swipeEnd = (x, y) => {
  if (!t0) return;
  if (!swiped) { const dx = x - t0[0], dy = y - t0[1]; if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN) swipeAct(dx, dy); }
  t0 = null; swiped = false; activePointer = null;
};
const swipeReset = () => { t0 = null; swiped = false; activePointer = null; };
// Dedo (touch): caminho principal no celular.
cv.addEventListener('touchstart', e => { if (!e.touches.length) return; const t = e.touches[0]; window.focus(); swipeStart(t.clientX, t.clientY, 'touch'); e.preventDefault(); }, { passive:false });
cv.addEventListener('touchmove', e => { if (activePointer !== 'touch' || !e.touches.length) return; const t = e.touches[0]; swipeMove(t.clientX, t.clientY); e.preventDefault(); }, { passive:false });
cv.addEventListener('touchend', e => { if (activePointer !== 'touch') return; const t = e.changedTouches[0]; if (t) swipeEnd(t.clientX, t.clientY); else swipeReset(); e.preventDefault(); }, { passive:false });
cv.addEventListener('touchcancel', () => { if (activePointer === 'touch') swipeReset(); }, { passive:false });
// Mouse/caneta (computador) e aparelhos que só entregam PointerEvents; toque já é tratado acima.
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' && 'ontouchstart' in window) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  window.focus(); swipeStart(e.clientX, e.clientY, e.pointerId);
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
});
cv.addEventListener('pointermove', e => { if (activePointer === null || activePointer === 'touch' || e.pointerId !== activePointer) return; swipeMove(e.clientX, e.clientY); });
cv.addEventListener('pointerup', e => { if (activePointer === null || activePointer === 'touch' || e.pointerId !== activePointer) return; swipeEnd(e.clientX, e.clientY); });
cv.addEventListener('pointercancel', e => { if (activePointer !== 'touch' && e.pointerId === activePointer) swipeReset(); });
// Posição dos elementos da tela + barra de teclas (cada tecla também é botão de toque)
// Efeito de apertar: a tecla escurece e volta com fade (a transição está no CSS)
function pressFx(id) { const b = document.querySelector('#keysBar [data-a="' + id + '"]'); if (!b) return; b.classList.add('down'); void b.offsetWidth; setTimeout(() => b.classList.remove('down'), 70); }
// Modo arrastar: mova timer, moedas, pontos e teclas para qualquer lugar
const PLACE = { score: '#score', coins: '#coins', timer: '#timer', keys: '#keysBar', pause: '#pauseBtn', tela: '#tvWrap', fps: '#fps' }, EL = PLACE;
let pauseVis = '';
// posiciona (e escala) um elemento da tela: posição predefinida ou lugar arrastado (em %)
function placeEl(k) {
  const e = $(PLACE[k]); if (!e) return;
  const p = CFG.pos[k], fr = p === 'free' && CFG.free[k], sc = (CFG.scale && CFG.scale[k]) || 1;
  if (k === 'tela') e.classList.toggle('p-tv', !fr);
  else if (k !== 'pause') { e.className = 'hudi ' + (fr ? '' : 'p-' + (p === 'free' ? 'tl' : p)); e.style.display = p === 'off' ? 'none' : ''; }
  e.style.left = fr ? fr.x + '%' : ''; e.style.top = fr ? fr.y + '%' : ''; e.style.right = e.style.bottom = fr ? 'auto' : '';
  const tx = fr ? 'translate(-50%,-50%)' : (p === 'tc' || p === 'bc' || k === 'tela') ? 'translateX(-50%)' : '';
  e.style.transform = (tx + (sc !== 1 ? ' scale(' + sc + ')' : '')).trim();
}
// bolinha amarela no canto de cada item: arraste para mudar o tamanho
function editHandles() {
  for (const k in PLACE) {
    const e = $(PLACE[k]); if (!e) continue; let h = $('#rz_' + k);
    if (!h) {
      h = document.createElement('div'); h.id = 'rz_' + k; h.className = 'rzH'; h.textContent = '⤡'; h.setAttribute('aria-label', 'Mudar tamanho'); document.body.appendChild(h);
      h.onpointerdown = ev => {
        ev.preventDefault(); ev.stopPropagation(); h.setPointerCapture(ev.pointerId);
        const r = $(PLACE[k]).getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, s0 = (CFG.scale && CFG.scale[k]) || 1, d0 = Math.max(10, Math.hypot(ev.clientX - cx, ev.clientY - cy));
        h.onpointermove = m => { CFG.scale[k] = +Math.min(4, Math.max(.4, s0 * Math.hypot(m.clientX - cx, m.clientY - cy) / d0)).toFixed(2); placeEl(k); editHandles(); };
        h.onpointerup = h.onpointercancel = () => { h.onpointermove = h.onpointerup = h.onpointercancel = null; save(); editHandles(); };
      };
    }
    const r = e.getBoundingClientRect(); h.style.display = 'flex'; h.style.left = (r.right - 14) + 'px'; h.style.top = (r.bottom - 14) + 'px';
  }
}
function startEdit() {
  st = 'edit'; ov.classList.add('off'); pauseVis = $('#pauseBtn').style.visibility; $('#pauseBtn').style.visibility = 'visible';
  if (!$('#editDone')) { const d = document.createElement('button'); d.id = 'editDone'; d.className = 'btn'; d.textContent = 'CONCLUIR'; d.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:auto;z-index:20;padding:12px 28px'; d.onclick = endEdit; document.body.appendChild(d); }
  if (!$('#editHint')) { const t = document.createElement('div'); t.id = 'editHint'; t.textContent = 'Arraste para mover · bolinha amarela = tamanho'; document.body.appendChild(t); }
  $('#editDone').style.display = 'block'; $('#editHint').style.display = 'block';
  for (const k in EL) {
    const e = $(EL[k]); e.style.display = ''; e.style.pointerEvents = 'auto'; e.style.outline = '2px dashed #ffd21f'; e.style.cursor = 'move'; e.style.touchAction = 'none';
    e.onpointerdown = ev => {
      ev.preventDefault(); e.setPointerCapture(ev.pointerId);
      e.onpointermove = m => {
        const x = Math.min(98, Math.max(2, m.clientX / innerWidth * 100)), y = Math.min(98, Math.max(2, m.clientY / innerHeight * 100));
        CFG.free[k] = { x: +x.toFixed(1), y: +y.toFixed(1) }; CFG.pos[k] = 'free'; placeEl(k); editHandles();
      };
      e.onpointerup = e.onpointercancel = () => { e.onpointermove = e.onpointerup = e.onpointercancel = null; save(); editHandles(); };
    };
  }
  editHandles();
}
function endEdit() {
  for (const k in EL) { const e = $(EL[k]); e.onpointerdown = null; e.style.pointerEvents = e.style.outline = e.style.cursor = e.style.touchAction = ''; }
  document.querySelectorAll('.rzH').forEach(h => h.style.display = 'none'); $('#editHint').style.display = 'none';
  $('#pauseBtn').style.visibility = pauseVis; $('#editDone').style.display = 'none'; save(); screen('settings');
}
/* ---------- Telão voador (YouTube) ---------- */
function ytParse(u) {
  u = String(u || '').trim(); if (/^[\w-]{11}$/.test(u)) return { v: u };
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u), h = url.hostname.replace(/^(www|m)\./, '');
    if (h === 'youtu.be') { const id = url.pathname.slice(1).split('/')[0]; if (/^[\w-]{11}$/.test(id)) return { v: id }; }
    if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v'); if (v && /^[\w-]{11}$/.test(v)) return { v };
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/); if (m) return { v: m[1] };
      const l = url.searchParams.get('list'); if (l && /^[\w-]{10,50}$/.test(l)) return { l };
    }
  } catch (e) {}
  return null;
}
function tvSrc() {
  const V = CFG.tv.vids; if (!V.length) return '';
  const base = 'autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&loop=1&iv_load_policy=3&disablekb=1&fs=0' + (/^https?:$/.test(location.protocol) ? '&origin=' + encodeURIComponent(location.origin) : '');
  const vs = V.filter(x => x.v).map(x => x.v);
  if (vs.length) return 'https://www.youtube.com/embed/' + vs[0] + '?' + base + '&playlist=' + (vs.length > 1 ? vs.slice(1).join(',') : vs[0]);
  return 'https://www.youtube.com/embed/videoseries?list=' + V[0].l + '&' + base;
}
function tvCmd(func, args) { const f = $('#tvScreen iframe'); if (f && f.contentWindow) try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), '*'); } catch (e) {} }
function tvVol() { tvCmd('setVolume', [CFG.tv.vol]); tvCmd(CFG.tv.vol === 0 ? 'mute' : 'unMute'); }
function tvSync() {
  const w = $('#tvWrap'), box = $('#tvScreen'); if (!w) return;
  w.style.display = CFG.tv.on ? '' : 'none';
  const src = CFG.tv.on ? tvSrc() : '', cur = box.querySelector('iframe');
  box.classList.toggle('has', !!src);
  if (!src) { if (cur) cur.remove(); return; }
  if (cur && cur.dataset.src === src) return;
  if (cur) cur.remove();
  const f = document.createElement('iframe'); f.dataset.src = src; f.src = src; f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.referrerPolicy = 'strict-origin-when-cross-origin'; f.title = 'Telão';
  f.onload = () => { f.dataset.ready = '1'; try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e) {} [500, 1500, 3000].forEach(t => setTimeout(tvVol, t)); };
  box.appendChild(f);
}
// o navegador só libera o som depois do primeiro toque/tecla: aí ligamos o volume escolhido
let tvWakes = 0; const tvWake = () => { const f = $('#tvScreen iframe'); if (tvWakes < 4 && f && f.dataset.ready) { tvWakes++; tvCmd('playVideo'); tvVol(); } };
addEventListener('pointerdown', tvWake, true); addEventListener('keydown', tvWake, true);

// Posição dos elementos da tela + barra de teclas (cada tecla também é botão de toque)
function hudPlace() {
  if (!$('#keysBar')) { const kb = document.createElement('div'); kb.id = 'keysBar'; document.body.appendChild(kb); }
  for (const k in PLACE) placeEl(k);
  const bar = $('#keysBar'); bar.innerHTML = ''; bar.style.setProperty('--kb', (CFG.keysz || 40) + 'px'); bar.style.opacity = CFG.keyop === undefined ? 1 : CFG.keyop;
  const g1 = document.createElement('div'), g2 = document.createElement('div'); g1.className = 'kg1'; g2.className = 'kg2'; bar.append(g1, g2);
  for (const [id, cap] of [['-'], ['jump'], ['-'], ['left'], ['roll'], ['right']]) {
    if (id === '-') { g1.appendChild(document.createElement('span')); continue; }
    const b = document.createElement('button'); b.textContent = CFG.keys[id].l; b.setAttribute('aria-label', ACT[id][0]);
    b.dataset.a = id; b.onpointerdown = e => { e.preventDefault(); act(id); }; (['coin', 'pause'].includes(id) ? g2 : g1).appendChild(b);
  }
  hud(); tvSync();
}
// Gestos de toque tratados no bloco de controles mobile acima.
document.addEventListener('visibilitychange', () => { if (document.hidden && !MATCH.active) pauseGame(); }); // aba oculta = pausa (timer não corre)

// Telão do admin (live/telao): imagem ou transmissão ao vivo, igual para todos, na posição escolhida no painel
(function adminTv() {
  let el = null, key = '';
  const okImg = u => /^data:image\/(jpeg|png|webp);base64,/.test(u) || /^https:\/\/[^\s"'<>]{1,500}$/.test(u);
  const okUrl = u => /^https:\/\/[^\s"'<>]{1,800}$/.test(u);
  function render(d) {
    const k = [d.on, d.mode, d.updatedAt, d.x, d.y, d.w].join('|');
    if (k === key) return; key = k;
    if (el) { el.remove(); el = null; }
    if (!d.on) return;
    const w = Math.min(95, Math.max(10, +d.w || 50)), x = Math.min(100 - w, Math.max(0, +d.x || 0)), y = Math.max(0, +d.y || 0);
    const hp = w * 9 / 16; // altura em % da largura da tela (16:9)
    el = document.createElement('div'); el.id = 'adminTv';
    el.style.cssText = 'position:fixed;z-index:4;pointer-events:none;background:#05081a;border:2px solid #14172e;border-radius:10px;overflow:hidden;box-shadow:0 8px 30px #000a;left:' + x + '%;top:min(' + y + '%,calc(100% - ' + hp + 'vw));width:' + w + 'vw;aspect-ratio:16/9';
    if (d.mode === 'embed' && okUrl(d.embedUrl || '')) {
      const f = document.createElement('iframe'); f.src = d.embedUrl; f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.referrerPolicy = 'strict-origin-when-cross-origin'; f.title = 'Telão ao vivo';
      f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0'; el.appendChild(f);
    } else if (d.mode !== 'embed' && okImg(d.image || '')) {
      const i = document.createElement('img'); i.src = d.image; i.alt = ''; i.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block'; el.appendChild(i);
    } else { el = null; return; }
    document.body.appendChild(el);
  }
  const poll = async () => { try { const r = await fbApi('/api/telao', 'GET'); if (r && r.data && !r.down) render(r.data); } catch (_) {} };
  poll(); setInterval(poll, 10000);
})();
coins = 0; dist = 0; reset(); screen('title'); hudPlace(); requestAnimationFrame(loop);
reconcileSession().catch(() => {}).then(() => { if (st === 'title') screen('title'); startCloudPresence(); ensureMultiplayerSocket(); });
