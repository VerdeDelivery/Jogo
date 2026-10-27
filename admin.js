import { CFG, CFG2, FB_BASE, periodNow, fmtDateTime, WK } from './common.js';
import { cleanSkin, BASE_PROMPT } from './skins.js';
import { drawChar } from './charrender.js';
import { BUILTIN } from './builtin-skins.js';

const [A, Au, Fs] = await Promise.all([import(FB_BASE + 'firebase-app.js'), import(FB_BASE + 'firebase-auth.js'), import(FB_BASE + 'firebase-firestore.js')]);
const app = A.initializeApp(CFG, 'admin'), auth = Au.getAuth(app), db = Fs.getFirestore(app);
let auth2 = null, db2 = null; // Banco 2 (presença online), opcional
if (CFG2) { try { const app2 = A.initializeApp(CFG2, 'admin2'); auth2 = Au.getAuth(app2); db2 = Fs.getFirestore(app2); } catch (e) { console.warn('banco 2:', e); } }
await auth.authStateReady();
const RULES = "rules_version = '2';\n\nservice cloud.firestore {\n  match /databases/{database}/documents {\n\n    function isAdmin() {\n      return request.auth != null\n        && request.auth.token.email in [\n          'capamineiro@gmail.com',\n          'mgfpsmiguel@gmail.com'\n        ];\n    }\n\n    function isBanned(uid) {\n      return exists(\n        /databases/$(database)/documents/bans/$(uid)\n      );\n    }\n\n    function validWt() {\n      return !('wt' in request.resource.data)\n        || (request.resource.data.wt is int\n            && request.resource.data.wt >= 0\n            && request.resource.data.wt < 86400);\n    }\n\n    match /ranking/{uid} {\n      allow read: if true;\n\n      allow create: if isAdmin()\n        || (\n          request.auth != null\n          && request.auth.uid == uid\n          && !isBanned(uid)\n          && request.resource.data.t is int\n          && request.resource.data.t >= 0\n          && request.resource.data.t < 86400\n          && request.resource.data.name is string\n          && request.resource.data.name.size() <= 14\n          && validWt()\n        );\n\n      allow update: if isAdmin()\n        || (\n          request.auth != null\n          && request.auth.uid == uid\n          && !isBanned(uid)\n          && request.resource.data.t is int\n          && request.resource.data.t >= 0\n          && request.resource.data.t < 86400\n          && request.resource.data.name is string\n          && request.resource.data.name.size() <= 14\n          && request.resource.data.t >= resource.data.t\n          && validWt()\n        );\n\n      allow delete: if false;\n    }\n\n    match /profiles/{uid} {\n      allow read: if isAdmin()\n        || (request.auth != null && request.auth.uid == uid);\n\n      allow create, update: if request.auth != null\n        && request.auth.uid == uid\n        && !isBanned(uid)\n        && request.resource.data.keys().hasOnly([\n          'name',\n          'avatar',\n          'banner',\n          'photo',\n          'provider',\n          'updatedAt'\n        ])\n        && request.resource.data.name is string\n        && request.resource.data.name.size() <= 50;\n\n      allow delete: if false;\n    }\n\n    match /accountDevices/{uid} {\n      allow read: if isAdmin();\n\n      allow create, update: if request.auth != null\n        && request.auth.uid == uid\n        && !isBanned(uid)\n        && request.resource.data.keys().hasOnly([\n          'accounts',\n          'updatedAt'\n        ])\n        && request.resource.data.accounts is list\n        && request.resource.data.accounts.size() <= 100;\n\n      allow delete: if false;\n    }\n\n    match /players/{uid} {\n      allow read: if true;\n\n      allow create: if request.auth != null\n        && request.auth.uid == uid\n        && !isBanned(uid)\n        && request.resource.data.name is string\n        && request.resource.data.name.size() >= 3\n        && request.resource.data.name.size() <= 14\n        && request.resource.data.banned == false\n        && request.resource.data.best_no_coin == 0\n        && request.resource.data.best_score == 0\n        && request.resource.data.wins == 0;\n\n      allow update: if isAdmin()\n        || (\n          request.auth != null\n          && request.auth.uid == uid\n          && !isBanned(uid)\n          && request.resource.data.name == resource.data.name\n          && request.resource.data.banned == resource.data.banned\n          && request.resource.data.best_no_coin is int\n          && request.resource.data.best_no_coin >= resource.data.best_no_coin\n          && request.resource.data.best_no_coin < 86400\n          && request.resource.data.best_score is int\n          && request.resource.data.best_score >= resource.data.best_score\n          && request.resource.data.wins >= resource.data.wins\n        );\n\n      allow delete: if false;\n    }\n\n    match /replays/{uid} {\n      allow read: if true;\n      allow write: if request.auth != null\n        && request.auth.uid == uid\n        && !isBanned(uid)\n        && request.resource.data.frames_json.size() < 200000;\n    }\n\n    match /bans/{uid} {\n      allow read: if isAdmin()\n        || (\n          request.auth != null\n          && (\n            request.auth.uid == uid\n            || resource.data.ownerUid == request.auth.uid\n          )\n        );\n\n      allow create, update, delete: if isAdmin();\n    }\n\n    match /admins/{d} {\n      allow read: if isAdmin();\n      allow write: if false;\n    }\n\n    match /live/{d} {\n      allow read: if true;\n      allow write: if isAdmin();\n    }\n\n    // Enquetes: a enquete atual fica em live/poll; cada voto em polls/{id}/votes/{uid}\n    match /polls/{pollId}/votes/{uid} {\n      allow read: if true;\n      allow create: if request.auth != null\n        && request.auth.uid == uid\n        && !isBanned(uid)\n        && request.resource.data.keys().hasOnly(['opt', 'at'])\n        && request.resource.data.opt is int\n        && request.resource.data.opt >= 0\n        && request.resource.data.opt < 10\n        && get(/databases/$(database)/documents/live/poll).data.id == pollId\n        && request.time.toMillis() < get(/databases/$(database)/documents/live/poll).data.endsAt;\n      allow update, delete: if false;\n    }\n\n    // Multijogador (salas, convites e presença)\n    match /mp_lobby/{uid} {\n      allow read: if request.auth != null;\n      allow create, update, delete: if request.auth != null\n        && request.auth.uid == uid\n        && !isBanned(uid);\n    }\n\n    match /mp_rooms/{code} {\n      allow read: if request.auth != null;\n      allow create: if request.auth != null\n        && request.resource.data.owner == request.auth.uid\n        && !isBanned(request.auth.uid);\n      allow update, delete: if request.auth != null\n        && resource.data.owner == request.auth.uid;\n\n      match /p/{uid} {\n        allow read: if request.auth != null;\n        allow create, update: if request.auth != null\n          && request.auth.uid == uid\n          && !isBanned(uid);\n        allow delete: if request.auth != null\n          && (\n            request.auth.uid == uid\n            || get(/databases/$(database)/documents/mp_rooms/$(code)).data.owner == request.auth.uid\n          );\n      }\n    }\n\n    match /mp_invites/{uid} {\n      allow read, delete: if request.auth != null && request.auth.uid == uid;\n      allow create, update: if request.auth != null\n        && request.resource.data.fromUid == request.auth.uid\n        && !isBanned(request.auth.uid);\n    }\n  }\n}\n";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ONLINE_MS = 150000;
let toastT = 0, EMAIL = '';
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = '', bad ? 7000 : 2800); }
const explain = e => { const c = (e && (e.code || e.message)) || String(e); return /permission/i.test(c) ? 'Sem permissão (permission-denied). Publique as regras da aba “Regras” e confira se este e-mail está na lista isAdmin().' : c; };
async function guard(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { console.error(e); toast(explain(e), true); return undefined; } }
const fmtT = v => { v = Math.max(0, Math.floor(+v || 0)); const h = Math.floor(v / 3600), m = Math.floor(v % 3600 / 60), s = v % 60, p = n => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`; };
function parseT(str) { str = String(str || '').trim(); if (/^\d+$/.test(str)) return +str; const m = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/); return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] : NaN; }
const ago = ts => { if (!ts) return 'nunca'; const s = Math.floor((Date.now() - ts) / 1000); return s < 60 ? 'agora há pouco' : s < 3600 ? Math.floor(s / 60) + ' min atrás' : s < 86400 ? Math.floor(s / 3600) + ' h atrás' : Math.floor(s / 86400) + ' d atrás'; };
const AVE = ['😎', '🐶', '🐱', '🦊', '🐼', '🦁', '🐸', '🤖', '👽', '🔥', '💎', '👑', '🐯', '🐵', '🐧', '🦄', '🐲', '🦅', '🐺', '🦈', '🐙', '🦋', '⚡', '🌟', '🚀', '🎮', '🏆', '💀', '👻', '🎧', '🧢', '🛹', '🍕', '🍔', '🌴', '🌈', '🏖️', '⚽', '🐻', '🦖', '😈', '🥷'];
const face = p => /^https?:\/\//i.test(p.photo || '') && String(p.avatar) === 'g' ? `<img class="av" src="${esc(p.photo)}" referrerpolicy="no-referrer" alt="">` : `<span class="av">${AVE[+p.avatar] || '🙂'}</span>`;
const badge = t => t === 'dev' ? '<span class="vb dev" title="Dev">✔</span>' : t === 'streamer' ? '<span class="vb st" title="Streamer parceiro">✔</span>' : '';
const ms = ts => ts && ts.toMillis ? ts.toMillis() : 0;
const ref = (...p) => Fs.doc(db, ...p), col = (...p) => Fs.collection(db, ...p);
let CRED = null; // e-mail/senha desta sessão (só na memória) para entrar também no Banco 2
async function ensureDb2() {
  if (!auth2) return false; await auth2.authStateReady();
  if (!auth2.currentUser && CRED) { try { await Au.signInWithEmailAndPassword(auth2, CRED.em, CRED.pw); } catch (e) { try { await Au.createUserWithEmailAndPassword(auth2, CRED.em, CRED.pw); } catch (_) {} } }
  return !!auth2.currentUser;
}
// Conteúdo publicado (live/*): grava no Banco 1 (principal) E no Banco 2; o jogo lê do Banco 2 primeiro (alivia o Banco 1).
async function liveSet(name, data) {
  await Fs.setDoc(ref('live', name), data, { merge: true });
  if (db2) { try { if (!(await ensureDb2())) throw new Error('sem sessão no Banco 2'); await Fs.setDoc(Fs.doc(db2, 'live', name), data, { merge: true }); } catch (e) { toast('⚠️ Salvou no Banco 1, mas NÃO no Banco 2 (' + explain(e) + '). Saia e entre de novo no painel; confira se as regras foram publicadas no Banco 2.', true); } }
}
// Leitura: Banco 2 primeiro (leitura pública), senão Banco 1.
async function liveGet(name) {
  if (db2) { try { const d = await Fs.getDoc(Fs.doc(db2, 'live', name)); if (d.exists()) return d; } catch (_) {} }
  return Fs.getDoc(ref('live', name));
}
// Marca uma novidade (selo vermelho NOVO no menu do jogo por 24 h). Chaves: skins, poll, lives, partners, donate, music
const markNew = key => liveSet('news', { [key]: Date.now() }).catch(() => {});

/* ------------------------------ acesso ------------------------------ */
function showLogin() { $('#app').classList.add('hide'); $('#login').classList.remove('hide'); }
async function enter(user) {
  try { await Fs.getDoc(ref('admins', 'check')); } // só quem está em isAdmin() consegue ler
  catch (e) { await Au.signOut(auth); $('#lerr').textContent = 'Esta conta não é administradora (ou as regras do Firestore ainda não foram publicadas — veja a aba Regras do painel antigo ou o arquivo firestore.rules).'; return showLogin(); }
  EMAIL = user.email; $('#who').textContent = EMAIL; $('#login').classList.add('hide'); $('#app').classList.remove('hide'); buildNav(); go(curTab);
}
$('#lgo').onclick = async () => {
  const em = $('#em').value.trim().toLowerCase(), pw = $('#pw').value; $('#lerr').textContent = '';
  if (!em || !pw) { $('#lerr').textContent = 'Preencha e-mail e senha.'; return; }
  $('#lgo').disabled = true;
  CRED = { em, pw };
  if (auth2) Au.signInWithEmailAndPassword(auth2, em, pw).catch(() => Au.createUserWithEmailAndPassword(auth2, em, pw).catch(() => {}));
  try { await Au.signInWithEmailAndPassword(auth, em, pw); }
  catch (e) { $('#lerr').textContent = /too-many/.test(e.code || '') ? 'Muitas tentativas. Aguarde um pouco.' : /network/.test(e.code || '') ? 'Sem conexão.' : 'E-mail ou senha incorretos.'; }
  $('#lgo').disabled = false;
};
$('#pw').onkeydown = e => { if (e.key === 'Enter') $('#lgo').click(); };
$('#out').onclick = async () => { await Au.signOut(auth); location.reload(); };
$('#refresh').onclick = () => go(curTab);
Au.onAuthStateChanged(auth, u => u ? enter(u) : showLogin());

/* ------------------------------ contas (profiles + ranking) ------------------------------ */
let ACC = [], BANS = new Set(), VERIF = {};
async function loadAll() {
  const [ps, rs, bs, vd, ds] = await Promise.all([Fs.getDocs(col('profiles')), Fs.getDocs(col('ranking')), Fs.getDocs(col('bans')), liveGet('verified').catch(() => null), Fs.getDocs(col('accountDevices')).catch(() => null)]);
  const map = new Map();
  ps.docs.forEach(d => { const x = d.data(); map.set(d.id, { id: d.id, name: x.name || '', avatar: x.avatar ?? '0', banner: x.banner || '', photo: x.photo || '', provider: x.provider || 'local', seen: ms(x.updatedAt), t: 0, wt: 0, wk: -1 }); });
  rs.docs.forEach(d => { const x = d.data(), p = map.get(d.id) || { id: d.id, name: x.name || '', avatar: x.avatar ?? '0', banner: x.banner || '', photo: x.photo || '', provider: 'ranking', seen: 0 }; map.set(d.id, { ...p, name: p.name || x.name, t: x.t || 0, s: x.s || 0, wt: x.wt || 0, wk: x.wk ?? -1, rbanned: !!x.banned, admin: !!x.admin, seen: Math.max(p.seen, ms(x.u)) }); });
  if (ds) ds.docs.forEach(d => { (Array.isArray(d.data().accounts) ? d.data().accounts : []).forEach(a => { if (!a || !a.id || !a.name) return; const id = String(a.id); if ([...map.values()].some(p => p.name.toLowerCase() === String(a.name).toLowerCase())) return; if (!map.has(id)) map.set(id, { id, name: String(a.name), avatar: a.avatar ?? '0', banner: a.banner || '', photo: a.photo || '', provider: 'antiga', seen: 0, t: 0, wt: 0, wk: -1 }); }); }); // contas da versão antiga (só no aparelho)
  if (db2 && auth2 && auth2.currentUser) { try { (await Fs.getDocs(Fs.collection(db2, 'presence'))).docs.forEach(d => { const x = d.data(), p = map.get(x.uid1); if (p) p.seen = Math.max(p.seen || 0, ms(x.updatedAt)); }); } catch (e) { console.warn('presença banco 2:', e.code || e); } }
  ACC = [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  BANS = new Set(bs.docs.map(d => d.id));
  VERIF = {}; if (vd && vd.exists()) try { VERIF = JSON.parse(vd.data().json || '{}') || {}; } catch (_) {}
}

/* ------------------------------ navegação ------------------------------ */
const TABS = [['over', '📊 Visão geral'], ['acc', '👥 Contas'], ['rank', '🏆 Ranking'], ['ver', '✔️ Verificados'], ['skins', '🎨 Skins'], ['aviso', '📢 Avisos e jogo'], ['don', '💛 Arrecadações'], ['bn', '🏷️ Banners'], ['pf', '🖼️ Fotos de perfil'], ['poll', '📊 Enquetes'], ['tv', '📺 Telão'], ['site', '⚙️ Site'], ['rules', '📜 Regras']];
let curTab = 'over', timer = 0;
function buildNav() { $('#nav').innerHTML = TABS.map(([k, n]) => `<button data-t="${k}" class="${k === curTab ? 'on' : ''}">${n}</button>`).join(''); $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.t)); }
async function go(t) {
  curTab = t; clearInterval(timer); stopAnim(); buildNav();
  const v = $('#view'); v.innerHTML = '<p class="muted">Carregando…</p>';
  try { await ({ over: vOver, acc: vAcc, rank: vRank, ver: vVer, skins: vSkins, aviso: vAviso, don: vDon, bn: v => vAssets(v, 'bn'), pf: v => vAssets(v, 'pf'), site: vSite, tv: vTv, poll: vPoll, rules: vRules }[t])(v); } catch (e) { console.error(e); v.innerHTML = '<div class="warn">Erro: ' + esc(explain(e)) + '</div>'; }
}

/* ------------------------------ visão geral ------------------------------ */
async function vOver(v) {
  const draw = async () => {
    await loadAll();
    const P = periodNow(), base = P.n * WK, now = Date.now();
    const weekCount = await Fs.getCountFromServer(Fs.query(col('ranking'), Fs.where('wkt', '>', base))).then(r => r.data().count).catch(() => null);
    const onl = ACC.filter(p => p.seen > now - ONLINE_MS).sort((a, b) => b.seen - a.seen), total = ACC.length;
    v.innerHTML = `<div class="grid">
      <div class="card stat"><b>${total}</b><span>Contas criadas</span></div>
      <div class="card stat on"><b>${onl.length}</b><span>Online agora</span></div>
      <div class="card stat off"><b>${total - onl.length}</b><span>Offline</span></div>
      <div class="card stat"><b>${weekCount ?? '—'}</b><span>No ranking da semana</span></div>
      <div class="card stat bad"><b>${BANS.size}</b><span>Bloqueadas</span></div></div>
    <div class="card" style="margin-top:12px"><h3>Ranking semanal</h3><div class="muted">Começou em ${esc(fmtDateTime(P.start))}<br>Próximo reset: <b>${esc(fmtDateTime(P.next))}</b> (toda quinta-feira, em horário diferente a cada semana)</div></div>
    <h2>🟢 Online agora (${onl.length})</h2>
    ${onl.length ? `<div class="tw"><table><tr><th>Jogador</th><th>Recorde geral</th><th>Visto</th></tr>${onl.map(p => `<tr><td>${face(p)}${esc(p.name)} ${badge(VERIF[p.id])}</td><td>${fmtT(p.t)}</td><td>${ago(p.seen)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Ninguém online neste momento.</p>'}
    <p class="muted" style="margin-top:12px">Online = atividade nos últimos ${ONLINE_MS / 60000} minutos (o jogo avisa a cada ~1 min enquanto está aberto). Atualiza a cada 30 s. As contas somam todo o projeto Firebase (inclui as do jogo antigo, que usa o mesmo banco).</p>`;
  };
  await draw(); timer = setInterval(() => draw().catch(() => {}), 30000);
}

/* ------------------------------ contas ------------------------------ */
async function vAcc(v) {
  await loadAll();
  v.innerHTML = `<h2>👥 Contas (${ACC.length})</h2><div class="row" style="margin-bottom:10px"><input id="q" placeholder="Pesquisar por nome…"/></div><div class="tw" id="lst"></div><p class="muted" style="margin-top:8px">Bloquear não apaga a conta nem o progresso: só impede de jogar/entrar no ranking.</p>`;
  const draw = q => {
    const L = ACC.filter(p => !q || String(p.name).toLowerCase().includes(q.toLowerCase())).slice(0, 300), now = Date.now();
    $('#lst').innerHTML = L.length ? `<table><tr><th>Jogador</th><th>Status</th><th>Recorde geral</th><th>Semana</th><th>Ações</th></tr>${L.map(p => { const ban = BANS.has(p.id), on = p.seen > now - ONLINE_MS; return `<tr><td>${face(p)}${esc(p.name)} ${badge(VERIF[p.id])}</td><td>${ban ? '<span class="pill ban">bloqueada</span>' : on ? '<span class="pill on">online</span>' : '<span class="pill off">offline · ' + ago(p.seen) + '</span>'}</td><td>${p.t ? fmtT(p.t) : '—'}</td><td>${p.wk === periodNow().n && p.wt ? fmtT(p.wt) : '—'}</td><td><button class="btn g s" data-time="${esc(p.name)}">⏱ Tempo</button><button class="btn ${ban ? 'ok' : 'r'} s" data-ban="${p.id}">${ban ? 'Desbloquear' : 'Bloquear'}</button></td></tr>`; }).join('')}</table>` : '<p class="muted" style="padding:14px">Nenhuma conta encontrada.</p>';
    $('#lst').querySelectorAll('[data-time]').forEach(b => b.onclick = () => { rankPref = b.dataset.time; go('rank'); });
    $('#lst').querySelectorAll('[data-ban]').forEach(b => b.onclick = async () => {
      const p = ACC.find(x => x.id === b.dataset.ban), was = BANS.has(p.id);
      if (!confirm((was ? 'Desbloquear ' : 'Bloquear ') + p.name + '? (A conta não é apagada.)')) return;
      await guard(async () => {
        if (was) await Fs.deleteDoc(ref('bans', p.id)); else await Fs.setDoc(ref('bans', p.id), { uid: p.id, name: p.name, ownerUid: p.id, bannedAt: Fs.serverTimestamp(), by: EMAIL });
        if (p.t || p.wk >= 0) await Fs.updateDoc(ref('ranking', p.id), was ? { banned: false } : { banned: true, wt: 0, wkt: 0 }).catch(() => {});
        if (was) BANS.delete(p.id); else BANS.add(p.id); draw($('#q').value);
      }, was ? 'Conta desbloqueada.' : 'Conta bloqueada.');
    });
  };
  $('#q').oninput = e => draw(e.target.value); draw('');
}

/* ------------------------------ ranking ------------------------------ */
let rankPref = '';
async function vRank(v) {
  await loadAll();
  const P = periodNow(), base = P.n * WK;
  const top = (await Fs.getDocs(Fs.query(col('ranking'), Fs.where('wkt', '>', base), Fs.orderBy('wkt', 'desc'), Fs.limit(50)))).docs.map(d => ({ id: d.id, ...d.data() }));
  v.innerHTML = `<h2>🏆 Ranking da semana</h2>
  <div class="card" style="margin-bottom:14px"><div class="muted">Esta semana começou em <b>${esc(fmtDateTime(P.start))}</b>. Zera sozinha em <b>${esc(fmtDateTime(P.next))}</b>.</div></div>
  <div class="card"><h3>⏱ Definir / corrigir o tempo de um jogador</h3>
    <p class="muted" style="margin:0 0 8px">Se um bug impediu o tempo de contar e o jogador tem a prova, coloque o tempo aqui: ele entra no ranking desta semana e a posição é calculada sozinha.</p>
    <div class="row"><div><label class="f" for="rkName">Nome do jogador</label><input id="rkName" value="${esc(rankPref)}" placeholder="nome exato da conta" list="dlN"/><datalist id="dlN">${ACC.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div><div><label class="f" for="rkTime">Tempo (mm:ss ou segundos)</label><input id="rkTime" placeholder="ex.: 12:34"/></div><button class="btn" id="rkSet">Publicar tempo</button></div>
    <label class="muted" style="display:flex;gap:8px;margin-top:10px;align-items:center"><input type="checkbox" id="rkGen" style="width:auto" checked/> atualizar também o recorde geral com este valor (permite corrigir para menos)</label></div>
  <h2>Top 50 desta semana</h2>
  <div class="tw">${top.length ? `<table><tr><th>#</th><th>Jogador</th><th>Tempo</th><th>Pontos</th><th></th></tr>${top.map((e, i) => `<tr><td>${i + 1}º</td><td>${face(e)}${esc(e.name)} ${badge(VERIF[e.id])}${e.admin ? ' <span class="pill">editado</span>' : ''}${e.banned ? ' <span class="pill ban">bloqueada</span>' : ''}</td><td><b>${fmtT(e.wt)}</b></td><td>${e.s || 0}</td><td><button class="btn g s" data-edit="${esc(e.name)}">Editar</button><button class="btn r s" data-del="${e.id}">Limpar tempo</button></td></tr>`).join('')}</table>` : '<p class="muted" style="padding:14px">Ainda não há tempos nesta semana.</p>'}</div>
  <h2>🧹 Limpeza</h2>
  <div class="card"><p class="muted" style="margin-top:0">Só tempos são mexidos. <b>Nenhuma conta é excluída.</b></p>
    <div class="row"><button class="btn g" id="rkImp">Importar recordes gerais para esta semana</button><button class="btn r" id="rkClr">Zerar o ranking desta semana</button></div>
    <label class="muted" style="display:flex;gap:8px;margin-top:10px;align-items:center"><input type="checkbox" id="rkAlso" style="width:auto"/> ao zerar, também zerar o recorde geral (⚠️ o jogo antigo usa o mesmo recorde geral)</label></div>`;
  rankPref = '';
  $('#rkSet').onclick = () => guard(async () => {
    const name = $('#rkName').value.trim().toLowerCase(), t = parseT($('#rkTime').value);
    if (!name) throw new Error('Digite o nome do jogador.'); if (!(t >= 1 && t < 86400)) throw new Error('Tempo inválido. Use mm:ss (ex.: 12:34) ou segundos.');
    const m = ACC.filter(p => String(p.name).toLowerCase() === name);
    if (!m.length) throw new Error('Jogador não encontrado: ' + name); if (m.length > 1) throw new Error(m.length + ' contas com esse nome. Use o nome exato de uma só.');
    const p = m[0], er = ref('ranking', p.id), e = (await Fs.getDoc(er)).data() || {};
    await Fs.setDoc(er, { name: String(p.name).slice(0, 14), avatar: String(p.avatar ?? e.avatar ?? '0'), banner: p.banner || e.banner || '', photo: p.photo || e.photo || '', t: $('#rkGen').checked ? t : (e.t || 0), s: e.s || 0, wk: P.n, wt: t, wkt: base + t, u: Fs.serverTimestamp(), admin: true });
    const c = (await Fs.getCountFromServer(Fs.query(col('ranking'), Fs.where('wkt', '>', base + t)))).data().count;
    toast(`Tempo de ${p.name} publicado: ${fmtT(t)} → ${c + 1}º lugar.`); go('rank');
  });
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { $('#rkName').value = b.dataset.edit; $('#rkTime').focus(); scrollTo({ top: 0, behavior: 'smooth' }); });
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('Remover o tempo deste jogador do ranking semanal? A conta e o recorde geral continuam existindo.')) guard(async () => { await Fs.updateDoc(ref('ranking', b.dataset.del), { wt: 0, wkt: 0 }); go('rank'); }, 'Tempo removido.'); });
  $('#rkImp').onclick = () => guard(async () => {
    const all = (await Fs.getDocs(col('ranking'))).docs.filter(d => { const x = d.data(); return x.t > 0 && x.wk !== P.n && !x.banned; });
    for (let k = 0; k < all.length; k += 400) { const b = Fs.writeBatch(db); all.slice(k, k + 400).forEach(d => b.update(d.ref, { wk: P.n, wt: d.data().t, wkt: base + d.data().t })); await b.commit(); }
    toast(all.length + ' tempo(s) importado(s).'); go('rank');
  });
  $('#rkClr').onclick = async () => {
    if (prompt('Isso zera TODOS os tempos do ranking desta semana (as contas ficam).\nDigite ZERAR para confirmar:') !== 'ZERAR') return;
    await guard(async () => {
      const also = $('#rkAlso').checked, ds = (await Fs.getDocs(also ? col('ranking') : Fs.query(col('ranking'), Fs.where('wkt', '>', base)))).docs;
      for (let k = 0; k < ds.length; k += 400) { const b = Fs.writeBatch(db); ds.slice(k, k + 400).forEach(d => b.update(d.ref, also ? { wt: 0, wkt: 0, t: 0, s: 0 } : { wt: 0, wkt: 0 })); await b.commit(); }
      go('rank');
    }, 'Ranking zerado. As contas foram mantidas.');
  };
}

/* ------------------------------ verificados ------------------------------ */
async function vVer(v) {
  await loadAll();
  v.innerHTML = `<h2>✔️ Verificados</h2>
  <div class="card" style="margin-bottom:12px"><div class="row" style="align-items:center"><span class="vb dev" style="font-size:16px;margin:0">✔</span><div class="grow"><b>Dev</b> <span class="muted">— selo dourado para os criadores</span></div><span class="vb st" style="font-size:16px;margin:0">✔</span><div class="grow"><b>Streamer parceiro</b> <span class="muted">— selo roxo/azul</span></div></div></div>
  <input id="q" placeholder="Pesquisar o nome de usuário…" autocomplete="off"/>
  <div class="tw" id="lst" style="margin-top:10px"></div>
  <p class="muted" style="margin-top:8px">O selo aparece ao lado do nome no ranking e no perfil do jogador. Vale na próxima vez que o jogo for aberto.</p>`;
  const save = () => liveSet('verified', { json: JSON.stringify(VERIF), updatedAt: Date.now() }, { merge: true });
  const draw = q => {
    q = (q || '').trim().toLowerCase();
    const have = ACC.filter(p => VERIF[p.id]), L = (q ? ACC.filter(p => String(p.name).toLowerCase().includes(q)) : have).slice(0, 100);
    $('#lst').innerHTML = L.length ? `<table><tr><th>Jogador</th><th>Selo atual</th><th>Dar selo</th></tr>${L.map(p => `<tr><td>${face(p)}${esc(p.name)}</td><td>${VERIF[p.id] ? badge(VERIF[p.id]) + ' ' + (VERIF[p.id] === 'dev' ? 'Dev' : 'Streamer parceiro') : '<span class="muted">nenhum</span>'}</td><td><button class="btn s" data-set="dev:${p.id}">✔ Dev</button> <button class="btn s ok" data-set="streamer:${p.id}">✔ Streamer</button>${VERIF[p.id] ? ` <button class="btn r s" data-set="none:${p.id}">Remover</button>` : ''}</td></tr>`).join('')}</table>` : `<p class="muted" style="padding:14px">${q ? 'Nenhum jogador encontrado.' : 'Ninguém verificado ainda. Pesquise um nome acima para dar o selo.'}</p>`;
    $('#lst').querySelectorAll('[data-set]').forEach(b => b.onclick = () => { const [t, id] = b.dataset.set.split(':'), old = VERIF[id]; if (t === 'none') delete VERIF[id]; else VERIF[id] = t; guard(async () => { await save(); draw($('#q').value); }, t === 'none' ? 'Selo removido.' : 'Selo ' + (t === 'dev' ? 'Dev' : 'Streamer parceiro') + ' publicado!').then(r => { if (r === undefined && false) VERIF[id] = old; }); });
  };
  $('#q').oninput = e => draw(e.target.value); draw('');
}



/* ------------------------------ avisos, manutenção e arrecadações ------------------------------ */
// Envia a imagem do aparelho: reduz para caber no Firestore (<~450 KB). GIF animado só entra se já for pequeno (senão use o link).
function fileToData(file, maxPx, png) {
  return new Promise((ok, fail) => {
    if (!file || !/^image\//.test(file.type)) return fail(new Error('Escolha um arquivo de imagem.'));
    const rd = new FileReader();
    if (file.type === 'image/gif') { if (file.size > 400000) return fail(new Error('GIF grande demais para enviar (máx. ~400 KB). Hospede o GIF e cole o link.')); rd.onload = () => ok(rd.result); rd.onerror = () => fail(new Error('Não consegui ler o arquivo.')); return rd.readAsDataURL(file); }
    rd.onerror = () => fail(new Error('Não consegui ler o arquivo.'));
    rd.onload = () => { const im = new Image(); im.onerror = () => fail(new Error('Imagem inválida.')); im.onload = () => {
      let px = maxPx, out = '';
      for (let i = 0; i < 6; i++) {
        const k = Math.min(1, px / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
        const g = c.getContext('2d'); if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } g.drawImage(im, 0, 0, c.width, c.height);
        out = c.toDataURL(png && i < 2 ? 'image/png' : 'image/jpeg', .82); if (out.length < 450000) return ok(out); px = Math.round(px * .75);
      }
      fail(new Error('Imagem pesada demais. Use uma menor.'));
    }; im.src = rd.result; };
    rd.readAsDataURL(file);
  });
}
async function vAviso(v) {
  const d = (await liveGet('status')).data() || {};
  v.innerHTML = `<h2>📢 Avisos e jogo</h2>
  <div class="card" style="margin-bottom:14px"><h3>Aviso na tela inicial</h3>
    <p class="muted" style="margin:0 0 8px">Aparece no topo da tela inicial do jogo (ótimo para avisar de atualização). Atualiza sozinho em até 1 minuto para quem já está jogando.</p>
    <label class="ctl"><input type="checkbox" id="nOn" style="width:auto"/> Mostrar o aviso</label>
    <label class="f" for="nTx">Mensagem</label><textarea id="nTx" maxlength="400" style="font-family:inherit" placeholder="Ex.: Atualização hoje às 20h! O jogo pode reiniciar."></textarea>
    <label class="f" for="nImg">Imagem ou GIF (link, opcional)</label><input id="nImg" inputmode="url" placeholder="https://…/imagem.gif"/>
    <div class="row" style="margin-top:12px"><button class="btn ok" id="nSave" type="button">📣 Publicar aviso</button></div></div>
  <div class="card"><h3>🛠️ Liberar / bloquear o jogar</h3>
    <p class="muted" style="margin:0 0 8px">Ligado = ninguém consegue começar uma corrida (aparece a mensagem abaixo). Use enquanto conserta bugs ou atualiza.</p>
    <label class="ctl"><input type="checkbox" id="mOn" style="width:auto"/> <b>Jogo em manutenção (bloquear jogar)</b></label>
    <label class="f" for="mTx">Mensagem de manutenção</label><textarea id="mTx" maxlength="300" style="font-family:inherit" placeholder="Ex.: Estamos corrigindo um bug. Volte em alguns minutos!"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn r" id="mSave" type="button">💾 Aplicar</button><span class="pill ${d.maint ? 'ban' : 'on'}" style="flex:0 0 auto;align-self:center">${d.maint ? 'BLOQUEADO agora' : 'Liberado agora'}</span></div></div>`;
  $('#nOn').checked = !!d.noticeOn; $('#nTx').value = d.notice || ''; $('#nImg').value = d.noticeImg || ''; $('#mOn').checked = !!d.maint; $('#mTx').value = d.maintMsg || '';
  $('#nSave').onclick = () => { const img = $('#nImg').value.trim(); if (img && !URL_OK.test(img)) return toast('Link da imagem inválido (comece com https://).', true); guard(async () => { await liveSet('status', { noticeOn: $('#nOn').checked, notice: $('#nTx').value.trim(), noticeImg: img, updatedAt: Date.now() }); }, 'Aviso publicado!'); };
  $('#mSave').onclick = () => { const on = $('#mOn').checked; if (on && !confirm('Bloquear o jogar para TODOS os jogadores agora?')) return; guard(async () => { await liveSet('status', { maint: on, maintMsg: $('#mTx').value.trim(), updatedAt: Date.now() }); go('aviso'); }, on ? 'Jogo BLOQUEADO para todos.' : 'Jogo liberado!'); };
}
async function vDon(v) {
  const d = (await liveGet('don')).data() || {};
  const money = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  let IMG = d.imageUrl || '', QR = d.qrImage || '';
  v.innerHTML = `<h2>💛 Arrecadações</h2>
  <div class="card">
    <label class="ctl"><input type="checkbox" id="dOn" style="width:auto"/> <b>Arrecadação ativa</b> (aparece no menu do jogo)</label>
    <label class="f" for="dT">Título</label><input id="dT" maxlength="40" placeholder="💛 APOIE O PROJETO"/>
    <label class="f" for="dM">Mensagem (para que será o dinheiro)</label><textarea id="dM" maxlength="800" style="font-family:inherit" placeholder="Ex.: Estamos arrecadando para pagar o servidor e comprar novos mapas…"></textarea>
    <label class="f">Imagem da arrecadação</label>
    <div class="row"><input id="dI" inputmode="url" placeholder="Cole o link da imagem ou GIF (https://…)"/><label class="btn g" style="cursor:pointer;flex:0 0 auto">📁 Enviar do aparelho<input type="file" id="dIf" accept="image/*" class="hide"/></label><button class="btn g" id="dIx" type="button" style="flex:0 0 auto">Remover</button></div>
    <img id="dIp" alt="" style="max-width:100%;max-height:160px;border-radius:12px;margin-top:8px" class="hide"/>
    <label class="f">QR Code do Pix</label>
    <div class="row"><label class="btn g" style="cursor:pointer;flex:0 0 auto">📁 Enviar QR do aparelho<input type="file" id="dQf" accept="image/*" class="hide"/></label><button class="btn g" id="dQx" type="button" style="flex:0 0 auto">Remover</button></div>
    <img id="dQp" alt="" style="width:150px;background:#fff;padding:6px;border-radius:12px;margin-top:8px" class="hide"/>
    <label class="f" for="dP">Chave Pix (cole aqui)</label><input id="dP" maxlength="140" autocomplete="off" placeholder="e-mail, CPF, telefone ou chave aleatória"/>
    <div class="row" style="margin-top:6px"><div><label class="f" for="dG">Meta (R$)</label><input id="dG" inputmode="decimal" placeholder="500"/></div><div><label class="f" for="dR">Já recebemos (R$)</label><input id="dR" inputmode="decimal" placeholder="120"/></div><div><label class="f" for="dC">Cor da barra</label><input id="dC" type="color" style="height:42px;padding:4px"/></div></div>
    <div id="dBar" style="margin-top:12px"></div>
    <div class="row" style="margin-top:14px"><button class="btn ok" id="dSave" type="button">💾 Salvar arrecadação</button></div>
    <p class="muted" style="margin-top:8px">Atualize “Já recebemos” sempre que entrar dinheiro e salve: a barra do jogo muda para todos.</p>
  </div>`;
  const num = id => Math.max(0, parseFloat(String($(id).value).replace(/\./g, '').replace(',', '.')) || 0);
  const pics = () => { for (const [id, val] of [['#dIp', IMG], ['#dQp', QR]]) { const el = $(id); if (val) { el.src = val; el.classList.remove('hide'); } else { el.removeAttribute('src'); el.classList.add('hide'); } } };
  const bar = () => { const g = num('#dG'), r = num('#dR'), pc = g > 0 ? Math.min(100, r / g * 100) : 0; $('#dBar').innerHTML = `<div style="background:#10162c;border:1px solid #36466d;padding:14px;border-radius:16px"><div style="display:flex;justify-content:space-between"><b>Meta: ${money(g)}</b><b>${pc.toFixed(0)}%</b></div><div style="height:12px;border-radius:99px;background:#263451;overflow:hidden;margin:8px 0"><div style="height:100%;width:${pc}%;background:${$('#dC').value}"></div></div><span>Recebemos: <b>${money(r)}</b> · Faltam <b>${money(Math.max(0, g - r))}</b></span></div>`; };
  $('#dOn').checked = !!d.enabled; $('#dT').value = d.title || ''; $('#dM').value = d.message || ''; $('#dP').value = d.pixKey || ''; $('#dG').value = d.goal || ''; $('#dR').value = d.received || ''; $('#dC').value = /^#[0-9a-f]{6}$/i.test(d.accentColor || '') ? d.accentColor : '#ffe36a';
  $('#dI').value = /^data:/.test(IMG) ? '' : (IMG || d.gifUrl || ''); if (!IMG && d.gifUrl) IMG = d.gifUrl;
  pics(); bar();
  ['#dG', '#dR', '#dC'].forEach(i => $(i).oninput = bar);
  $('#dI').oninput = e => { IMG = e.target.value.trim(); pics(); };
  $('#dIf').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { IMG = await fileToData(f, 900, false); $('#dI').value = ''; pics(); toast('Imagem carregada. Toque em Salvar.'); } catch (x) { toast(x.message, true); } e.target.value = ''; };
  $('#dQf').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { QR = await fileToData(f, 600, true); pics(); toast('QR carregado. Toque em Salvar.'); } catch (x) { toast(x.message, true); } e.target.value = ''; };
  $('#dIx').onclick = () => { IMG = ''; $('#dI').value = ''; pics(); }; $('#dQx').onclick = () => { QR = ''; pics(); };
  $('#dSave').onclick = () => {
    if (IMG && !/^data:image\//.test(IMG) && !URL_OK.test(IMG)) return toast('Link da imagem inválido (comece com https://).', true);
    const data = { enabled: $('#dOn').checked, title: $('#dT').value.trim(), message: $('#dM').value.trim(), imageUrl: IMG, gifUrl: '', qrImage: QR, pixKey: $('#dP').value.trim(), goal: num('#dG'), received: num('#dR'), accentColor: $('#dC').value, updatedAt: Date.now() };
    if (JSON.stringify(data).length > 900000) return toast('As imagens somadas passam de 900 KB. Use imagens menores ou links.', true);
    guard(async () => { await liveSet('don', data); await markNew('donate'); }, 'Arrecadação salva! Aparece no jogo na próxima abertura (ou em instantes).');
  };
}

/* ------------------------------ banners e fotos de perfil ------------------------------ */
// Banner  -> live/meta.bnJson : [{ id, n, u (imagem/GIF), c1 (cor), p:[{u:uid, n:nome}] }]   (p vazio = todo mundo)
// Foto    -> live/meta.avJson : [{ id, t:'img', n, u (imagem/GIF), c1 (cor), p:[...] }]
const URL_OK = /^https?:\/\/[^\s"'()<>]{4,500}$/i;
const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#3b4696';
const bnCss = b => `background:linear-gradient(90deg,rgba(16,19,48,.1),rgba(16,19,48,.55)),${URL_OK.test(b.u || '') ? `url('${b.u}') center/cover no-repeat,` : ''}${hexOk(b.c1)};color:#fff;text-shadow:1px 1px 0 #000,-1px -1px 0 #000`;
async function vAssets(v, kind) {
  const isBn = kind === 'bn', KEY = isBn ? 'bnJson' : 'avJson', NOUN = isBn ? 'banner' : 'foto de perfil', NOUNS = isBn ? 'banners' : 'fotos de perfil';
  await loadAll();
  const meta = (await liveGet('meta')).data() || {};
  let LIST = []; try { LIST = JSON.parse(meta[KEY] || '[]') || []; } catch (_) {} if (!Array.isArray(LIST)) LIST = [];
  const blank = () => ({ id: (isBn ? 'b' : 'a') + Date.now().toString(36), n: '', u: '', c1: isBn ? '#3b4696' : '#26357a', p: [], ...(isBn ? {} : { t: 'img' }) });
  let ed = blank(), editing = false;
  const nameOf = x => { const a = ACC.find(q => q.id === x.u); return x.n || (a && a.name) || x.u; };
  const prevHTML = b => isBn
    ? `<div class="bnPrev" style="${esc(bnCss(b))}"><span class="pvAv">🙂</span><span>${esc(b.n || 'Nome do banner')}</span></div>`
    : `<img class="pfPrev" ${URL_OK.test(b.u || '') ? `src="${esc(b.u)}"` : ''} referrerpolicy="no-referrer" alt="" style="background:${hexOk(b.c1)}"/>`;
  v.innerHTML = `<style>.bnPrev{display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:14px;border:3px solid #14172e;min-height:56px;font-weight:900;font-size:17px;overflow:hidden;background:#101330}.pvAv{width:34px;height:34px;border-radius:50%;background:#26357a;display:inline-flex;align-items:center;justify-content:center}.pfPrev{width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid var(--y)}.chip{display:inline-flex;align-items:center;gap:6px;background:#1d2a5c;border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 12px;margin:4px 6px 0 0;font-size:13px}.chip button{border:0;background:#5a1e2b;color:#ff9aa8;border-radius:50%;width:20px;height:20px;cursor:pointer;font-weight:900;line-height:1}.ai{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ai .pv{flex:1 1 220px;min-width:0}</style>
  <h2>${isBn ? '🏷️ Banners' : '🖼️ Fotos de perfil'}</h2>
  <div class="card">
    <h3 id="fTitle">Criar ${NOUN}</h3>
    <label class="f" for="fN">Nome do ${NOUN} (aparece para o jogador)</label><input id="fN" maxlength="24" autocomplete="off" placeholder="${isBn ? 'Ex.: Chamas do Rei' : 'Ex.: Gatinho Ninja'}"/>
    <label class="f" for="fU">Link da imagem (foto normal ou GIF animado)</label><input id="fU" autocomplete="off" inputmode="url" placeholder="https://…/imagem.gif"/>
    <label class="f" for="fC">Cor de fundo (aparece enquanto a imagem carrega)</label><input id="fC" type="color" style="height:42px;padding:4px"/>
    <label class="f" for="fA">Quem pode usar</label>
    <select id="fA"><option value="all">🌍 Todo mundo</option><option value="some">⭐ Só usuários específicos</option></select>
    <div id="fBox" class="hide">
      <div class="row" style="margin-top:8px"><input id="fUser" autocomplete="off" autocapitalize="off" placeholder="Nome de usuário que existe no jogo"/><button class="btn g" id="fAdd" type="button">Verificar e adicionar</button></div>
      <div id="fChips"></div>
      <p class="muted" style="margin:6px 0 0">O painel confere se a conta existe no jogo antes de liberar. Só quem estiver na lista vê e consegue escolher.</p>
    </div>
    <label class="f">Prévia</label><div id="fPrev"></div>
    <div class="row" style="margin-top:14px"><button class="btn ok" id="fPub" type="button">📣 Publicar ${NOUN}</button><button class="btn g hide" id="fCancel" type="button">Cancelar edição</button></div>
  </div>
  <h2 id="lstH">Já criados</h2><div id="lst"></div>
  <p class="muted" style="margin-top:8px">Vale na próxima vez que o jogo for aberto. ${isBn ? 'O banner escolhido aparece no ranking semanal e no geral.' : 'A foto aparece na lista de avatares da conta.'}</p>`;
  const save = arr => liveSet('meta', { [KEY]: JSON.stringify(arr) }, { merge: true });
  const drawChips = () => { $('#fChips').innerHTML = ed.p.map((x, i) => `<span class="chip">${esc(nameOf(x))}<button type="button" data-rm="${i}" title="Remover">×</button></span>`).join(''); $('#fChips').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { ed.p.splice(+b.dataset.rm, 1); drawChips(); }); };
  const prev = () => { const t = { ...ed, n: $('#fN').value.trim(), u: $('#fU').value.trim(), c1: $('#fC').value }; $('#fPrev').innerHTML = prevHTML(t); };
  const fill = () => { $('#fN').value = ed.n || ''; $('#fU').value = ed.u || ''; $('#fC').value = hexOk(ed.c1); $('#fA').value = ed.p && ed.p.length ? 'some' : 'all'; $('#fBox').classList.toggle('hide', $('#fA').value !== 'some'); $('#fTitle').textContent = (editing ? 'Editar ' : 'Criar ') + NOUN; $('#fPub').textContent = editing ? '💾 Salvar alterações' : '📣 Publicar ' + NOUN; $('#fCancel').classList.toggle('hide', !editing); drawChips(); prev(); };
  const drawList = () => {
    $('#lstH').textContent = `Já criados (${LIST.length})`;
    $('#lst').innerHTML = LIST.length ? LIST.map((b, i) => `<div class="card" style="margin-bottom:10px"><div class="ai"><div class="pv">${prevHTML(b)}</div><div style="flex:1 1 200px"><b>${esc(b.n || '(sem nome)')}</b><div class="muted">${b.p && b.p.length ? '⭐ Exclusivo: ' + esc(b.p.map(nameOf).join(', ')) : '🌍 Todo mundo'}</div></div><div><button class="btn g s" data-ed="${i}">✏️ Editar</button> <button class="btn r s" data-del="${i}">🗑️ Excluir</button></div></div></div>`).join('') : `<p class="muted">Nenhum ${NOUN} criado ainda.</p>`;
    $('#lst').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { ed = JSON.parse(JSON.stringify(LIST[+b.dataset.ed])); if (!Array.isArray(ed.p)) ed.p = []; if (!isBn) ed.t = 'img'; editing = true; fill(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#lst').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const it = LIST[+b.dataset.del]; if (!confirm(`Excluir o ${NOUN} “${it.n || ''}”? Quem estiver usando volta ao padrão.`)) return; const next = LIST.filter(x => x !== it); guard(async () => { await save(next); LIST = next; if (editing && ed.id === it.id) { ed = blank(); editing = false; fill(); } drawList(); }, 'Excluído.'); });
  };
  const addUser = async () => {
    const q = $('#fUser').value.trim().toLowerCase(); if (!q) return;
    const find = () => ACC.find(a => String(a.name).trim().toLowerCase() === q);
    let m = find(); if (!m) { await loadAll(); m = find(); } // talvez a conta seja nova: recarrega e tenta de novo
    if (!m) return toast(`“${$('#fUser').value.trim()}” não existe no jogo. Confira o nome de usuário.`, true);
    if (ed.p.some(x => x.u === m.id)) return toast('Esse usuário já está na lista.', true);
    ed.p.push({ u: m.id, n: m.name }); $('#fUser').value = ''; drawChips(); toast(`✔ ${m.name} existe no jogo e foi adicionado.`);
  };
  $('#fAdd').onclick = addUser; $('#fUser').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addUser(); } };
  ['fN', 'fU', 'fC'].forEach(id => $('#' + id).oninput = prev);
  $('#fA').onchange = () => $('#fBox').classList.toggle('hide', $('#fA').value !== 'some');
  $('#fCancel').onclick = () => { ed = blank(); editing = false; fill(); };
  $('#fPub').onclick = () => {
    const item = { ...ed, n: $('#fN').value.trim(), u: $('#fU').value.trim(), c1: $('#fC').value, p: $('#fA').value === 'some' ? ed.p : [] };
    if (!item.n) return toast(`Dê um nome ao ${NOUN}.`, true);
    if (!URL_OK.test(item.u)) return toast('Cole um link válido da imagem (começando com https://).', true);
    if ($('#fA').value === 'some' && !item.p.length) return toast('Adicione pelo menos um usuário ou escolha “Todo mundo”.', true);
    const i = LIST.findIndex(x => x.id === item.id), next = LIST.slice(); if (i >= 0) next[i] = item; else next.push(item);
    guard(async () => { await save(next); LIST = next; ed = blank(); editing = false; fill(); drawList(); }, i >= 0 ? 'Alterações publicadas!' : `${isBn ? 'Banner publicado' : 'Foto publicada'}!`);
  };
  fill(); drawList();
}

/* ------------------------------ skins ------------------------------ */
const BGS = { dia: ['#4fc3ff', '#d4f3ff', '#a8e05f'], sol: ['#ff6a3d', '#ffd27a', '#4a2f52'], noite: ['#0b1033', '#6a3a8f', '#14183a'], neon: ['#18134c', '#ff3dcb', '#17172f'], neve: ['#7fb8e8', '#f0f8ff', '#9fb6cc'] };
let anims = [];
function stopAnim() { anims.forEach(a => cancelAnimationFrame(a.id)); anims = []; }
function stage(cv, getSkin, getOpts) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, a = { id: 0 };
  const parts = Array.from({ length: 26 }, (_, i) => ({ x: (i * 97 % 100) / 100, y: (i * 61 % 100) / 100, s: .6 + (i % 5) * .35, v: .05 + (i % 7) * .02 }));
  const draw = now => {
    const t = now / 1000, o = getOpts(), ch = getSkin(), bg = BGS[o.bg] || BGS.noite, floor = H * .82;
    const sky = g.createLinearGradient(0, 0, 0, floor); sky.addColorStop(0, bg[0]); sky.addColorStop(1, bg[1]); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (const p of parts) { g.globalAlpha = .35 + .35 * Math.sin(t * 2 + p.x * 9); g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x * W, ((p.y + t * p.v) % 1) * floor, p.s * (W / 360), 0, 7); g.fill(); } g.globalAlpha = 1;
    const fl = g.createLinearGradient(0, floor, 0, H); fl.addColorStop(0, bg[2]); fl.addColorStop(1, '#05081a'); g.fillStyle = fl; g.fillRect(0, floor, W, H - floor);
    g.strokeStyle = '#ffffff22'; g.lineWidth = 2; for (let k = -4; k <= 4; k++) { g.beginPath(); g.moveTo(W / 2 + k * W * .04, floor); g.lineTo(W / 2 + k * W * .24, H); g.stroke(); }
    const sp = g.createRadialGradient(W / 2, floor, 0, W / 2, floor, W * .55); sp.addColorStop(0, 'rgba(255,255,255,.38)'); sp.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sp; g.beginPath(); g.moveTo(W * .42, 0); g.lineTo(W * .58, 0); g.lineTo(W * .98, floor); g.lineTo(W * .02, floor); g.closePath(); g.globalAlpha = .55; g.fill(); g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(W / 2, floor + 4, W * .17, W * .035, 0, 0, 7); g.fill();
    if (!ch) { g.fillStyle = '#ffffffaa'; g.font = '700 ' + W * .045 + 'px system-ui'; g.textAlign = 'center'; g.fillText('Cole o código da skin para ver a prévia', W / 2, H * .45); a.id = requestAnimationFrame(draw); return; }
    const sc = W / 130, yaw = o.spin ? .5 + Math.sin(t * .9) * .75 : o.yaw, pose = o.pose, opt = { yaw, run: pose === 'run' ? t * 11 : 0 };
    if (pose === 'jump') { opt.air = true; opt.run = t * 6; } if (pose === 'slide') { opt.slide = true; opt.slideK = 1; opt.slidePhase = t * 7; }
    const lift = pose === 'jump' ? Math.abs(Math.sin(t * 3)) * H * .1 : 0;
    g.save(); g.translate(0, -lift); drawChar(g, W / 2, floor, sc, ch, opt); g.restore();
    g.save(); g.globalAlpha = .16; g.translate(0, floor * 2 + 10); g.scale(1, -1); g.beginPath(); g.rect(0, floor - H * .3, W, H * .3); g.clip(); drawChar(g, W / 2, floor, sc, ch, opt); g.restore();
    g.textAlign = 'center'; g.font = '900 ' + W * .08 + 'px Impact, system-ui'; g.lineWidth = W * .014; g.strokeStyle = '#14172e'; g.strokeText(ch.n.toUpperCase(), W / 2, H * .1); g.fillStyle = '#ffd21f'; g.fillText(ch.n.toUpperCase(), W / 2, H * .1);
    if (ch.price) { g.font = '800 ' + W * .045 + 'px system-ui'; g.fillStyle = '#fff'; g.fillText('🪙 ' + ch.price, W / 2, H * .1 + W * .07); }
    a.id = requestAnimationFrame(draw);
  };
  a.id = requestAnimationFrame(draw); anims.push(a);
}
function thumb(cv, ch) { const g = cv.getContext('2d'); g.fillStyle = '#0a1030'; g.fillRect(0, 0, cv.width, cv.height); drawChar(g, cv.width / 2, cv.height * .9, cv.width / 135, ch, { run: 0, yaw: .5 }); }
const rid = () => 'sk_' + Math.random().toString(36).slice(2, 10);

async function vSkins(v) {
  let clean = null, ideia = '';
  const meta = (await liveGet('meta')).data() || {};
  if (meta.skinsJson === undefined) { const old = (await Fs.getDoc(ref('live', 'skins')).catch(() => null)); if (old && old.exists()) { const o = old.data(); meta.skinsJson = typeof o.json === 'string' ? o.json : JSON.stringify(Array.isArray(o.items) ? o.items : []); if (meta.skRulesJson === undefined) meta.skRulesJson = typeof o.rulesJson === 'string' ? o.rulesJson : '{}'; } } // skins publicadas no painel antigo
  let SK = [], RL = {}; try { SK = JSON.parse(meta.skinsJson || '[]') || []; } catch (_) {} try { RL = JSON.parse(meta.skRulesJson || '{}') || {}; } catch (_) {}
  const dirty = { v: false };
  const publish = () => guard(async () => { await liveSet('meta', { skinsJson: JSON.stringify(SK), skRulesJson: JSON.stringify(RL) }, { merge: true }); await markNew('skins'); dirty.v = false; }, 'Skins publicadas! Valem na próxima abertura do jogo.');
  const isOn = k => !(RL[k] && RL[k].on === false);
  const setOn = (k, on) => { const r = RL[k] || {}; if (on) delete r.on; else r.on = false; if (Object.keys(r).length) RL[k] = r; else delete RL[k]; };
  v.innerHTML = `<h2>🎨 Criador de skins</h2>
  <div class="skwrap"><div>
    <div class="card"><h3>1) Peça a skin para a IA</h3>
      <label class="f" for="skIdea">Sua ideia (ex.: “astronauta rosa com óculos neon”)</label><input id="skIdea" placeholder="descreva a skin…"/>
      <label class="f" for="skPrompt">Prompt base (já configurado)</label><textarea id="skPrompt" readonly style="min-height:150px"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn" id="skCopy">📋 Copiar prompt completo</button></div></div>
    <div class="card" style="margin-top:12px"><h3>2) Cole o código que a IA gerou</h3>
      <textarea id="skCode" placeholder='{"n":"Minha Skin","hood":"#...", ...}'></textarea><div class="err" id="skErr"></div>
      <div class="row"><div><label class="f" for="skName">Nome</label><input id="skName" maxlength="18"/></div><div><label class="f" for="skPrice">Preço (moedas, 0 = grátis)</label><input id="skPrice" type="number" min="0" value="300"/></div></div>
      <div class="row" style="margin-top:10px"><button class="btn ok" id="skPub" disabled>🚀 Publicar no jogo</button></div></div>
  </div><div>
    <div class="stage"><canvas id="skCv" width="520" height="640"></canvas></div>
    <div class="ctl"><label>Pose <select id="skPose"><option value="run">Correndo</option><option value="jump">Pulando</option><option value="slide">Deslizando</option><option value="idle">Parado</option></select></label>
      <label>Cenário <select id="skBg"><option value="noite">Noite</option><option value="dia">Dia</option><option value="sol">Pôr do sol</option><option value="neon">Neon</option><option value="neve">Neve</option></select></label>
      <label><input type="checkbox" id="skSpin" checked style="width:auto"/> girar</label><label>Ângulo <input type="range" id="skYaw" min="-.4" max="1.4" step=".05" value=".5"/></label></div>
    <div class="poses"><canvas id="p1" width="130" height="143"></canvas><canvas id="p2" width="130" height="143"></canvas><canvas id="p3" width="130" height="143"></canvas></div>
  </div></div>
  <h2>Skins criadas por você (${SK.length})</h2>
  <div class="skl">${SK.map(s => `<div class="sk ${isOn(s.id) ? '' : 'offc'}"><canvas width="150" height="165" data-id="${esc(s.id)}"></canvas><b>${esc(s.n)}</b><span class="muted">${s.price ? '🪙 ' + s.price : 'grátis'} · ${isOn(s.id) ? 'na loja' : 'oculta'}</span><div style="margin-top:6px"><button class="btn g s" data-tog="${esc(s.id)}">${isOn(s.id) ? 'Ocultar' : 'Mostrar'}</button><button class="btn r s" data-rm="${esc(s.id)}">Excluir</button></div></div>`).join('') || '<p class="muted">Nenhuma ainda.</p>'}</div>
  <h2>🎚️ Skins que já vêm no jogo</h2>
  <p class="muted">Ligue ou desligue cada uma na loja. Depois clique em “Publicar loja”.</p>
  <div class="tw"><table>${BUILTIN.map(b => `<tr><td><span class="dotc" style="background:${b.h}"></span><span class="dotc" style="background:${b.pa}"></span><span class="dotc" style="background:${b.c}"></span><span class="dotc" style="background:${b.s}"></span></td><td>${esc(b.n)}</td><td class="muted">${b.p ? '🪙 ' + b.p : 'grátis'}</td><td><label class="sw"><input type="checkbox" data-bk="${b.k}" ${isOn(b.k) ? 'checked' : ''}><i></i></label></td></tr>`).join('')}</table></div>
  <div class="row" style="margin-top:12px"><button class="btn" id="pubShop">🚀 Publicar loja de skins (catálogo antigo)</button></div>
  <div class="card" style="margin-top:16px;border:1px solid #4ff0ff">
    <h3>🧵 Skin Lab — texturas e acessórios</h3>
    <p class="muted">Mantém o mesmo personagem blocado. Cole os links HTTPS diretos das imagens hospedadas no seu próprio site. Não usa Firebase Storage nem exige cartão; o Firebase salva somente os links e os dados da skin.</p>
    <label class="f" for="skBankPw">Senha do administrador no projeto de skins</label>
    <input id="skBankPw" type="password" autocomplete="current-password" placeholder="Use a senha da conta admin criada no Firebase skin-4f7da"/>
    <div class="row" style="margin-top:8px"><button class="btn" id="skBankConnect">🔐 Conectar banco de skins</button><span class="muted" id="skBankStatus">Não conectado</span></div>
    <div class="row" style="margin-top:10px">
      <div><label class="f" for="skTextureShirt">Link direto da camisa</label><input id="skTextureShirt" type="url" placeholder="https://seusite.com/camisa.png"/></div>
      <div><label class="f" for="skTexturePants">Link direto da calça</label><input id="skTexturePants" type="url" placeholder="https://seusite.com/calca.png"/></div>
      <div><label class="f" for="skTextureAccessory">Link direto do acessório/cabeça</label><input id="skTextureAccessory" type="url" placeholder="https://seusite.com/acessorio.png"/></div>
      <div><label class="f" for="skTextureBackpack">Link direto da mochila</label><input id="skTextureBackpack" type="url" placeholder="https://seusite.com/mochila.png"/></div>
    </div>
    <p class="muted">Use links públicos HTTPS que abram diretamente a imagem (PNG/JPG/WebP; PNG transparente recomendado para decal). O servidor de imagens precisa permitir CORS para a prévia no jogo. A textura é aplicada ao personagem blocado existente.</p>
    <div class="row" style="margin-top:10px"><button class="btn ok" id="skBankPublish" disabled>☁️ Salvar e publicar no banco novo</button></div>
    <div class="muted" id="skBankHelp" style="margin-top:8px">Para usar: cadastre o mesmo e-mail administrador no Authentication do projeto skin-4f7da, com login por e-mail/senha, e publique as regras incluídas no ZIP. As imagens ficam hospedadas no seu site; o Firebase guarda apenas os links.</div>
  </div>`;
  const texturePreviewUrls = {};
  const upPrompt = () => { $('#skPrompt').value = BASE_PROMPT + (ideia || '[escreva aqui a ideia da skin]'); }; upPrompt();
  $('#skIdea').oninput = e => { ideia = e.target.value; upPrompt(); };
  $('#skCopy').onclick = async () => { try { await navigator.clipboard.writeText(BASE_PROMPT + (ideia || '')); toast('Prompt copiado! Cole na IA.'); } catch (_) { $('#skPrompt').select(); document.execCommand('copy'); toast('Prompt copiado!'); } };
  const poseCvs = [$('#p1'), $('#p2'), $('#p3')];
  const refresh = () => {
    const txt = $('#skCode').value.trim(); $('#skErr').textContent = ''; clean = null; $('#skPub').disabled = true;
    if (txt) { clean = cleanSkin(txt); if (!clean) $('#skErr').textContent = 'Código inválido: precisa ser um JSON com pelo menos hood, pants, cap e skin (cores #hex).'; }
    if (clean) { if (!$('#skName').value) $('#skName').value = clean.n; clean.n = ($('#skName').value || clean.n).slice(0, 18); const pr = Math.max(0, Math.floor(+$('#skPrice').value || 0)); if (pr) clean.price = pr; else delete clean.price; if (Object.keys(texturePreviewUrls).length) clean.textures = { ...texturePreviewUrls }; $('#skPub').disabled = false; }
    poseCvs.forEach((c, i) => { const g = c.getContext('2d'); g.fillStyle = '#0a1030'; g.fillRect(0, 0, c.width, c.height); if (clean) drawChar(g, c.width / 2, c.height * .9, c.width / 135, clean, { yaw: [-.1, .5, 1.1][i], run: 0 }); });
  };
  $('#skCode').oninput = () => { $('#skName').value = ''; refresh(); }; $('#skName').oninput = refresh; $('#skPrice').oninput = refresh;
  stage($('#skCv'), () => clean, () => ({ pose: $('#skPose').value, bg: $('#skBg').value, spin: $('#skSpin').checked, yaw: +$('#skYaw').value }));
  $('#skPub').onclick = async () => { if (!clean) return; if (SK.length >= 30) return toast('Limite de 30 skins do painel.', true); const legacy={...clean}; delete legacy.textures; SK.push({ id: rid(), ...legacy }); await publish(); go('skins'); };
  SK.forEach(s => { const c = v.querySelector(`canvas[data-id="${s.id}"]`), o = cleanSkin(s); if (c && o) thumb(c, { ...o, n: s.n }); });
  v.querySelectorAll('[data-tog]').forEach(b => b.onclick = async () => { setOn(b.dataset.tog, !isOn(b.dataset.tog)); await publish(); go('skins'); });
  v.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (!confirm('Excluir esta skin do jogo?')) return; SK = SK.filter(x => x.id !== b.dataset.rm); delete RL[b.dataset.rm]; await publish(); go('skins'); });
  v.querySelectorAll('[data-bk]').forEach(i => i.onchange = () => setOn(i.dataset.bk, i.checked));
  $('#pubShop').onclick = publish;

  // Banco independente skin-4f7da: salva metadados e URLs externas; não usa Firebase Storage.
  let skinBank = null, bankUser = null;
  const SKIN_CFG = { apiKey:'AIzaSyCgFYmJlHaxPfpvnrOxVI0YjvwJMsWLBaE', authDomain:'skin-4f7da.firebaseapp.com', projectId:'skin-4f7da', storageBucket:'skin-4f7da.firebasestorage.app', messagingSenderId:'147966450703', appId:'1:147966450703:web:cb4083b37acf5a45c0577a' };
  const slots = [['shirt','skTextureShirt'],['pants','skTexturePants'],['accessory','skTextureAccessory'],['backpack','skTextureBackpack']];
  const setBankStatus = (msg, bad=false) => { $('#skBankStatus').textContent=msg; $('#skBankStatus').style.color=bad?'#ff8080':'#7fffd4'; $('#skBankPublish').disabled=!bankUser; };
  slots.forEach(([slot,id]) => $('#'+id).addEventListener('input', () => {
    const u=$('#'+id).value.trim();
    if (u && !/^https:\/\/[^\s"'()<>]+$/i.test(u)) { $('#skBankHelp').textContent='Esse link não parece válido. Use o link HTTPS direto da imagem.'; return; }
    if (u) texturePreviewUrls[slot]=u; else delete texturePreviewUrls[slot];
    refresh();
  }));
  $('#skBankConnect').onclick = async () => {
    try {
      const [A, Au, Fs] = await Promise.all([import(FB_BASE+'firebase-app.js'), import(FB_BASE+'firebase-auth.js'), import(FB_BASE+'firebase-firestore.js')]);
      const existing=A.getApps().find(a=>a.name==='sr-skin-bank-admin');
      const app=existing || A.initializeApp(SKIN_CFG,'sr-skin-bank-admin');
      const skinAuth=Au.getAuth(app), db=Fs.getFirestore(app);
      const adminEmail=(auth.currentUser?.email || '').trim().toLowerCase(), password=$('#skBankPw').value;
      if (!adminEmail || !password) { setBankStatus('Entre no painel com conta admin e digite a senha do banco.',true); return toast('Não foi possível identificar o e-mail admin.',true); }
      if (!['capamineiro@gmail.com','mgfpsmiguel@gmail.com'].includes(adminEmail)) { setBankStatus('E-mail fora da lista de administradores.',true); return toast('Este e-mail não está autorizado nas regras.',true); }
      await Au.signInWithEmailAndPassword(skinAuth,adminEmail,password);
      bankUser=skinAuth.currentUser; skinBank={A,Au,Fs,auth:skinAuth,db}; setBankStatus('Conectado: '+adminEmail);
      $('#skBankHelp').textContent='Banco conectado. Cole os links diretos das imagens, preencha nome/preço e publique. O jogo atualiza o catálogo em até 10 minutos.';
    } catch(e) { console.error(e); bankUser=null; skinBank=null; setBankStatus('Falha ao conectar ao banco de skins.',true); $('#skBankHelp').textContent='Ative Authentication > E-mail/senha no projeto skin-4f7da e crie o administrador autorizado. Não precisa ativar Storage.'; toast('Falha no banco de skins: '+(e.code||e.message||'erro'),true); }
  };
  $('#skBankPublish').onclick = async () => {
    if (!skinBank || !bankUser) return toast('Conecte primeiro o banco de skins.',true);
    const skin=cleanSkin($('#skCode').value.trim()); if (!skin) return toast('Cole um JSON válido de skin primeiro.',true);
    for (const k of ['hood','sleeve','pants','cap','skin','shoe','chain','detail','hand','hairCol','belt','backCol','bag']) if (typeof skin[k]==='string' && /^#[0-9a-f]{3}$/i.test(skin[k])) skin[k]='#'+skin[k][1]+skin[k][1]+skin[k][2]+skin[k][2]+skin[k][3]+skin[k][3];
    const textures={};
    for (const [slot,inputId] of slots) { const u=$('#'+inputId).value.trim(); if (u) { if (!/^https:\/\/[^\s"'()<>]{4,1000}$/i.test(u)) return toast('Link inválido em '+slot+'. Use HTTPS direto da imagem.',true); textures[slot]=u; } }
    const name=($('#skName').value || skin.n).trim().slice(0,18), price=Math.max(0,Math.min(100000,Math.floor(Number($('#skPrice').value)||0))), id=rid().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
    try {
      const docData={name,price,skinJson:{...skin,n:name,price},textures,status:'published',version:1,createdBy:bankUser.email,updatedAt:skinBank.Fs.serverTimestamp()};
      await skinBank.Fs.setDoc(skinBank.Fs.doc(skinBank.db,'skins',id),docData,{merge:false});
      const catalogRef=skinBank.Fs.doc(skinBank.db,'catalog','skins'), catalogSnap=await skinBank.Fs.getDoc(catalogRef), catalogData=catalogSnap.exists()?(catalogSnap.data()||{}):{}, items=Array.isArray(catalogData.items)?catalogData.items:[];
      const item={id,name,price,skinJson:{...skin,n:name,price},textures,status:'published',updatedAt:Date.now()}, idx=items.findIndex(x=>x&&x.id===id);
      if(idx>=0) items[idx]=item; else items.push(item); if(items.length>60) throw new Error('Limite de 60 skins no catálogo. Exclua uma skin antes de publicar outra.');
      await skinBank.Fs.setDoc(catalogRef,{items,updatedAt:skinBank.Fs.serverTimestamp()},{merge:false});
      toast('Skin publicada! Links externos salvos.'); $('#skBankHelp').textContent=`Publicada: ${name}. O Firebase guardou os links, sem enviar imagens para o Storage.`;
    } catch(e) { console.error(e); toast('Falha ao publicar: '+(e.code||e.message||'erro'),true); $('#skBankHelp').textContent='Verifique as regras do Firestore e a autenticação no projeto skin-4f7da.'; }
  };
}

/* ------------------------------ site ------------------------------ */
async function vSite(v) {
  const meta = (await liveGet('meta')).data() || {};
  v.innerHTML = `<h2>⚙️ Site</h2><div class="card"><h3>Foto do criador (tela de carregamento)</h3>
    <div class="row" style="align-items:center"><img class="photo" id="phImg" ${meta.creatorPhoto ? `src="${esc(meta.creatorPhoto)}"` : ''} alt="" style="flex:0 0 120px"/>
    <div><input type="file" id="phFile" accept="image/*"/><p class="muted">A foto é recortada em círculo na tela de carregamento. Envie uma imagem quadrada ou perto disso.</p><button class="btn" id="phSave" disabled>Salvar foto</button> <button class="btn g" id="phClr">Remover</button></div></div></div>`;
  let data = '';
  $('#phFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), m = Math.min(im.width, im.height); g.drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, 256, 256); data = c.toDataURL('image/jpeg', .85); $('#phImg').src = data; $('#phSave').disabled = false; }; im.src = URL.createObjectURL(f); };
  $('#phSave').onclick = () => guard(async () => { await liveSet('meta', { creatorPhoto: data }); $('#phSave').disabled = true; }, 'Foto salva! Aparece no carregamento do jogo.');
  $('#phClr').onclick = () => guard(async () => { await liveSet('meta', { creatorPhoto: '' }); $('#phImg').removeAttribute('src'); }, 'Foto removida.');
}

/* ------------------------------ regras ------------------------------ */

/* ------------------------------ telão (imagem ou ao vivo, para todos os jogadores) ------------------------------ */
const TV_PROMPT = "Crie um site chamado \"Telão ao Vivo\" para eu transmitir a tela do meu computador em tempo real para muitos espectadores, com qualidade ótima (1080p, 30 a 60 fps, com áudio do sistema quando o navegador permitir).\n\nTecnologia: use LiveKit Cloud (WebRTC com SFU) para a transmissão. Crie as Edge Functions/backend necessárias para gerar os tokens (publicador com permissão de publicar; espectador só de assistir) e guarde a chave e o segredo do LiveKit como segredos, nunca no código do navegador.\n\nDuas rotas:\n1) /transmitir — só para mim (login por senha única que eu defino num segredo). Botão \"Iniciar transmissão\" que usa getDisplayMedia (com áudio) e publica no LiveKit numa sala chamada \"telao\". Mostre uma prévia, o estado (AO VIVO / PARADO), o número de espectadores e um botão \"Parar\". Escolha de qualidade (720p / 1080p) e taxa de quadros (30 / 60). Reconecte sozinho se a internet cair.\n2) /assistir — pública, sem nenhum botão ou texto, fundo preto, vídeo ocupando 100% da tela (object-fit: contain), autoplay, começa mudo (por causa do navegador) e liga o som no primeiro toque. Se não houver transmissão, mostre uma tela preta com o texto \"Aguardando transmissão…\". Ela será colocada dentro de um iframe de 16:9 dentro de um jogo, então precisa funcionar em iframe (sem X-Frame-Options bloqueando) e ser leve em celulares.\n\nNão precisa de banco de dados. Quando estiver pronto, me diga a URL completa da rota /assistir: vou colar essa URL no meu painel administrativo (aba Telão), que a mostra no jogo para todos os jogadores.";
async function vTv(v) {
  const d = (await liveGet('telao')).data() || {};
  const S = { on: !!d.on, mode: d.mode === 'embed' ? 'embed' : 'image', image: d.image || '', embedUrl: d.embedUrl || '', x: Number.isFinite(d.x) ? d.x : 25, y: Number.isFinite(d.y) ? d.y : 12, w: Number.isFinite(d.w) ? d.w : 50 };
  v.innerHTML = `<h2>📺 Telão para todos os jogadores</h2>
  <div class="warn">O telão aparece por cima do jogo na posição que você escolher abaixo. Os jogadores recebem a mudança em até 10 segundos.</div>
  <div class="skwrap"><div>
    <div class="card">
      <label class="f"><input type="checkbox" id="tvOn" style="width:auto"> Telão ligado (visível para todos)</label>
      <label class="f" for="tvMode">Conteúdo</label>
      <select id="tvMode"><option value="image">🖼️ Imagem do meu aparelho</option><option value="embed">📡 Transmissão ao vivo (link)</option></select>
      <div id="tvImgBox"><label class="f" for="tvFile">Imagem</label><input id="tvFile" type="file" accept="image/*"><p class="muted" id="tvImgInfo"></p></div>
      <div id="tvEmbBox" class="hide"><label class="f" for="tvUrl">Link da transmissão (https)</label><input id="tvUrl" type="text" inputmode="url" placeholder="https://seu-telao.lovable.app/assistir"><p class="muted">Pode ser a rota /assistir do site criado no Lovable (veja o prompt abaixo), ou o link de incorporação (embed) de uma live do YouTube/Twitch.</p></div>
      <div class="ctl" style="margin-top:14px"><button class="btn ok" id="tvPub">📢 Publicar</button><button class="btn r" id="tvOff">🗑️ Retirar do jogo</button></div>
    </div></div>
  <div><div class="card"><h3>Pré-visualização (arraste o telão; a bolinha muda o tamanho)</h3>
    <div class="ctl" style="margin:0 0 8px"><label>Formato da tela do jogador <select id="tvAsp"><option value="p">Celular em pé</option><option value="l">Celular deitado / PC</option></select></label></div>
    <div id="tvStage" class="stage" style="position:relative;touch-action:none;max-width:340px;margin:0 auto;background:linear-gradient(#4a8fd8,#8fd0f0 55%,#33415f)"><div id="tvBox" style="position:absolute;cursor:move;border:2px solid var(--y);border-radius:8px;background:#05081a;overflow:hidden;display:grid;place-items:center;color:#fff;font-weight:800;font-size:13px;text-align:center"></div><i id="tvHandle" style="position:absolute;width:20px;height:20px;border-radius:50%;background:var(--y);border:2px solid #14172e;cursor:nwse-resize;z-index:2"></i></div>
    <p class="muted" id="tvPos"></p>
  </div></div></div>
  <h2>🤖 Prompt para o Lovable (transmitir a tela do PC ao vivo)</h2>
  <p class="muted">Copie este prompt e cole no Lovable. Quando o site ficar pronto, cole aqui em “Link da transmissão” a URL da rota /assistir, escolha “Transmissão ao vivo” e publique.</p>
  <pre class="code" id="tvPrompt" style="white-space:pre-wrap;max-height:none">${esc(TV_PROMPT)}</pre>
  <button class="btn g" id="tvCopy">📋 Copiar prompt</button>`;
  const stage = $('#tvStage'), box = $('#tvBox'), hd = $('#tvHandle');
  const asp = () => $('#tvAsp').value === 'l' ? 16 / 9 : 9 / 19.5;
  function layout() {
    stage.style.maxWidth = $('#tvAsp').value === 'l' ? '560px' : '300px'; stage.style.aspectRatio = $('#tvAsp').value === 'l' ? '16/9' : '9/19.5';
    const sw = stage.clientWidth, sh = stage.clientHeight, hp = S.w * 9 / 16 * sw / sh; // altura do telão em % da altura da tela
    S.w = Math.min(95, Math.max(15, S.w)); S.x = Math.min(100 - S.w, Math.max(0, S.x)); S.y = Math.min(Math.max(0, 100 - hp), Math.max(0, S.y));
    box.style.cssText += `;left:${S.x}%;top:${S.y}%;width:${S.w}%;aspect-ratio:16/9`;
    hd.style.left = `calc(${S.x + S.w}% - 14px)`; hd.style.top = `calc(${S.y + hp}% - 14px)`;
    $('#tvPos').textContent = `Posição: ${Math.round(S.x)}% da esquerda · ${Math.round(S.y)}% do topo · largura ${Math.round(S.w)}% da tela`;
  }
  function paint() {
    box.innerHTML = S.mode === 'embed' ? '📡<br>AO VIVO' : S.image ? `<img src="${esc(S.image)}" alt="" style="width:100%;height:100%;object-fit:contain;pointer-events:none">` : 'Sem imagem';
    $('#tvImgBox').classList.toggle('hide', S.mode !== 'image'); $('#tvEmbBox').classList.toggle('hide', S.mode !== 'embed'); layout();
  }
  let drag = null;
  const mv = e => { if (!drag) return; const r = stage.getBoundingClientRect(), dx = (e.clientX - drag.sx) / r.width * 100, dy = (e.clientY - drag.sy) / r.height * 100; if (drag.k === 'm') { S.x = drag.x + dx; S.y = drag.y + dy; } else S.w = drag.w + dx; layout(); };
  const up = () => { drag = null; removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  const st = (e, k) => { e.preventDefault(); e.stopPropagation(); drag = { k, sx: e.clientX, sy: e.clientY, x: S.x, y: S.y, w: S.w }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
  box.onpointerdown = e => st(e, 'm'); hd.onpointerdown = e => st(e, 'r');
  $('#tvOn').checked = S.on; $('#tvMode').value = S.mode; $('#tvUrl').value = S.embedUrl;
  $('#tvImgInfo').textContent = S.image ? 'Imagem atual carregada.' : 'Nenhuma imagem enviada ainda.';
  $('#tvAsp').onchange = layout; $('#tvMode').onchange = e => { S.mode = e.target.value; paint(); };
  $('#tvOn').onchange = e => { S.on = e.target.checked; }; $('#tvUrl').oninput = e => { S.embedUrl = e.target.value.trim(); };
  $('#tvFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return; const im = new Image(), u = URL.createObjectURL(f);
    im.onload = () => {
      let wd = Math.min(1280, im.naturalWidth), q = .85, out = '';
      for (let i = 0; i < 8; i++) { const c = document.createElement('canvas'); c.width = wd; c.height = Math.round(im.naturalHeight * wd / im.naturalWidth); const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); out = c.toDataURL('image/jpeg', q); if (out.length < 700000) break; q = Math.max(.5, q - .1); wd = Math.round(wd * .85); }
      URL.revokeObjectURL(u); if (out.length >= 900000) return toast('Imagem pesada demais. Use uma menor.', true);
      S.image = out; $('#tvImgInfo').textContent = 'Nova imagem pronta (' + Math.round(out.length / 1024) + ' KB). Clique em Publicar.'; paint();
    };
    im.onerror = () => toast('Não consegui abrir essa imagem.', true); im.src = u;
  };
  $('#tvPub').onclick = () => {
    if (S.mode === 'embed' && !/^https:\/\//.test(S.embedUrl)) return toast('O link da transmissão precisa começar com https://', true);
    if (S.mode === 'image' && !S.image) return toast('Escolha uma imagem primeiro.', true);
    S.on = $('#tvOn').checked = true;
    guard(() => liveSet('telao', { on: true, mode: S.mode, image: S.image, embedUrl: S.embedUrl, x: Math.round(S.x * 10) / 10, y: Math.round(S.y * 10) / 10, w: Math.round(S.w * 10) / 10, updatedAt: Date.now() }), 'Telão publicado! Aparece para todos em até 10 segundos.');
  };
  $('#tvOff').onclick = () => { if (!confirm('Retirar o telão do jogo de todos os jogadores?')) return; S.on = $('#tvOn').checked = false; S.image = ''; S.embedUrl = ''; $('#tvUrl').value = ''; paint(); guard(() => liveSet('telao', { on: false, mode: S.mode, image: '', embedUrl: '', x: S.x, y: S.y, w: S.w, updatedAt: Date.now() }), 'Telão retirado.'); };
  $('#tvCopy').onclick = async () => { try { await navigator.clipboard.writeText(TV_PROMPT); toast('Prompt copiado!'); } catch (_) { const r = document.createRange(); r.selectNodeContents($('#tvPrompt')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Selecionei o texto: copie manualmente.'); } };
  paint(); requestAnimationFrame(layout);
}


/* ------------------------------ enquetes ------------------------------ */
async function vPoll(v) {
  const cur = (await Fs.getDoc(ref('live', 'poll'))).data() || null;
  v.innerHTML = `<h2>📊 Enquetes</h2>
  <div class="skwrap"><div class="card"><h3>Nova enquete</h3>
    <label class="f" for="pq">Pergunta</label><input id="pq" maxlength="120" placeholder="Qual mapa novo vocês querem?">
    <label class="f" for="po">Opções (uma por linha, de 2 a 8)</label><textarea id="po" rows="5" placeholder="Praia&#10;Floresta&#10;Cidade"></textarea>
    <div class="row"><div><label class="f" for="pd">Duração</label><input id="pd" type="number" min="1" value="30"></div><div><label class="f" for="pu">Unidade</label><select id="pu"><option value="60000">minutos</option><option value="3600000">horas</option><option value="86400000">dias</option></select></div></div>
    <div class="ctl"><button class="btn ok" id="pPub">📢 Publicar enquete</button></div>
    <p class="muted">Publicar uma nova enquete substitui a atual (os votos antigos ficam guardados). Aparece no jogo com o selo vermelho NOVO por 24 h.</p></div>
  <div class="card" id="pRes"></div></div>
  <h2>🧾 Quem votou em quê</h2><div id="pVot"><p class="muted">Carregando…</p></div>`;
  $('#pPub').onclick = () => {
    const q = $('#pq').value.trim(), opts = $('#po').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 8), dur = Math.floor(+$('#pd').value * +$('#pu').value);
    if (!q) return toast('Escreva a pergunta.', true); if (opts.length < 2) return toast('Coloque pelo menos 2 opções.', true); if (!(dur >= 60000)) return toast('Duração inválida.', true);
    if (cur && cur.endsAt > Date.now() && !confirm('Já existe uma enquete em andamento. Substituir por esta?')) return;
    guard(async () => { await Fs.setDoc(ref('live', 'poll'), { id: 'p' + Date.now(), question: q, options: opts, createdAt: Date.now(), endsAt: Date.now() + dur }); await markNew('poll'); go('poll'); }, 'Enquete publicada!');
  };
  const box = $('#pRes');
  if (!cur || !cur.id) { box.innerHTML = '<h3>Enquete atual</h3><p class="muted">Nenhuma enquete publicada.</p>'; $('#pVot').innerHTML = ''; return; }
  const counts = await Promise.all(cur.options.map((_, i) => Fs.getCountFromServer(Fs.query(col('polls', cur.id, 'votes'), Fs.where('opt', '==', i))).then(r => r.data().count).catch(() => 0)));
  const total = counts.reduce((a, c) => a + c, 0), over = cur.endsAt <= Date.now();
  const order = counts.map((c, i) => ({ i, c })).sort((a, b) => b.c - a.c);
  box.innerHTML = `<h3>${esc(cur.question)}</h3><p>${over ? '<span class="pill off">ENCERRADA</span>' : '<span class="pill on">EM ANDAMENTO</span>'} <span class="muted">${over ? 'terminou em ' : 'termina em '}${fmtDateTime ? fmtDateTime(cur.endsAt) : new Date(cur.endsAt).toLocaleString('pt-BR')} · ${total} voto(s)</span></p>` +
    order.map((o, k) => { const pc = total ? Math.round(o.c * 100 / total) : 0; return `<div style="margin:8px 0"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>${k === 0 && total ? '🏆 ' : ''}${esc(cur.options[o.i])}</b><span>${o.c} · ${pc}%</span></div><div style="height:10px;border-radius:9px;background:#0a1030;border:1px solid var(--line);overflow:hidden"><div style="width:${pc}%;height:100%;background:${k === 0 && total ? 'var(--y)' : 'var(--c)'}"></div></div></div>`; }).join('') +
    `<p class="muted">Ordem: da mais votada para a menos votada.</p><div class="ctl"><button class="btn g s" id="pRef">↻ Atualizar</button>${over ? '' : '<button class="btn r s" id="pEnd">⏹ Encerrar agora</button>'}<button class="btn r s" id="pDel">🗑️ Remover do jogo</button></div>`;
  $('#pRef').onclick = () => go('poll');
  if ($('#pEnd')) $('#pEnd').onclick = () => { if (confirm('Encerrar a enquete agora?')) guard(async () => { await Fs.updateDoc(ref('live', 'poll'), { endsAt: Date.now() }); go('poll'); }, 'Enquete encerrada.'); };
  $('#pDel').onclick = () => { if (confirm('Remover a enquete do jogo? Os votos ficam guardados.')) guard(async () => { await Fs.deleteDoc(ref('live', 'poll')); go('poll'); }, 'Enquete removida.'); };
  try {
    await loadAll(); const nm = Object.fromEntries(ACC.map(a => [a.id, a.name]));
    const vs = (await Fs.getDocs(col('polls', cur.id, 'votes'))).docs.map(d => ({ uid: d.id, opt: d.data().opt, at: ms(d.data().at) })).sort((a, b) => b.at - a.at);
    $('#pVot').innerHTML = vs.length ? `<div class="tw"><table><tr><th>Jogador</th><th>Voto</th><th>Quando</th></tr>${vs.map(x => `<tr><td>${esc(nm[x.uid] || x.uid)}</td><td>${esc(cur.options[x.opt] ?? '?')}</td><td>${ago(x.at)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Ninguém votou ainda.</p>';
  } catch (e) { $('#pVot').innerHTML = '<div class="warn">Não consegui listar os votos: ' + esc(explain(e)) + '</div>'; }
}

async function vRules(v) {
  v.innerHTML = `<h2>📜 Regras do Firestore</h2><div class="card"><p class="muted" style="margin-top:0">São as suas regras atuais com <b>uma única mudança</b>: no bloco <code>ranking</code> o administrador também pode criar/editar (para corrigir tempos e zerar a semana). Cole em Firebase → Firestore Database → Regras → Publicar.</p><pre class="code" id="rl"></pre><button class="btn" id="rcp">Copiar regras</button></div>`;
  $('#rl').textContent = RULES; $('#rcp').onclick = async () => { try { await navigator.clipboard.writeText(RULES); toast('Regras copiadas.'); } catch (_) { toast('Selecione e copie manualmente.', true); } };
}
