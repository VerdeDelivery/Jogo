// Camada de rede do jogo. Fala com o MESMO Firebase e com as MESMAS regras do jogo que já funciona:
//   ranking/{uid}  -> recorde (t) + campos da semana (wk, wt, wkt)      profiles/{uid} -> perfil / presença (updatedAt)
//   bans/{uid}     -> contas bloqueadas                                 live/{meta,verified} -> skins, avatares, banners, verificados
// (nome do arquivo mantido por compatibilidade com o app.js)
import { CFG, CFG2, FB_BASE as G, lcOf, periodNow, WK } from './common.js';
let H = null;
async function init() {
  if (H) return H;
  const [A, Au, Fs] = await Promise.all([import(G + 'firebase-app.js'), import(G + 'firebase-auth.js'), import(G + 'firebase-firestore.js')]);
  const app = A.initializeApp(CFG), auth = Au.getAuth(app), db = Fs.getFirestore(app);
  await auth.authStateReady();
  H = { Au, Fs, auth, db, b2:null };
  if (CFG2) { // Banco 2 (social): presença e multijogador. Se falhar, o jogo segue só no Banco 1.
    try { const app2 = A.initializeApp(CFG2, 'sr2'), auth2 = Au.getAuth(app2); await auth2.authStateReady(); H.b2 = { auth:auth2, db:Fs.getFirestore(app2) }; }
    catch (e) { console.warn('banco 2 indisponível:', e); }
  }
  return H;
}
// Entra no Banco 2 com o MESMO usuário/senha do Banco 1 (cria a conta lá na primeira vez). Falha em silêncio.
async function signDb2(h, lc, pw, name, create) {
  if (!h.b2) return false;
  const { Au } = h, { auth } = h.b2, em = await emailOf(lc);
  try { await Au.signInWithEmailAndPassword(auth, em, pw); }
  catch (e) {
    if (!create || !/user-not-found|invalid-credential|invalid-login/.test(e.code || '')) return false;
    try { await Au.createUserWithEmailAndPassword(auth, em, pw); } catch (_) { return false; }
  }
  try { if (auth.currentUser && !auth.currentUser.displayName) await Au.updateProfile(auth.currentUser, { displayName:name }); } catch (_) {}
  return true;
}
// Onde fica o trabalho de presença/multijogador: Banco 2 se houver sessão nele; senão Banco 1.
export async function fbShard() {
  const h = await init();
  if (h.b2 && h.b2.auth.currentUser) return { Fs:h.Fs, db:h.b2.db, auth:h.b2.auth, id:2 };
  return { Fs:h.Fs, db:h.db, auth:h.auth, id:1, wantB2:!!h.b2 };
}
async function emailOf(lc) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sr:' + lc)); return 'u' + [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('') + '@subwayrun.game'; }
const NAME_RE = /^[\p{L}\p{N}_ .-]{3,14}$/u;
const out = (status, data) => ({ status, data, down:false });
const err = (status, error) => out(status, { error });
const code = e => (e && (e.code || e.message)) || 'erro';
const cleanPhoto = v => { v = String(v || ''); return (/^data:image\/(jpeg|png|webp);base64,/.test(v) && v.length < 40000) || /^https:\/\/[^\s"'<>]{1,300}$/.test(v) ? v : ''; };
const pub = (uid, p) => ({ uid, name:p.name, avatar:String(p.avatar ?? '0'), banner:p.banner || '', photo:p.photo || '' });
const cacheGet = uid => { try { return JSON.parse(localStorage.getItem('sr_prof_' + uid) || '{}') || {}; } catch (_) { return {}; } };
const cacheSet = (uid, p) => { try { localStorage.setItem('sr_prof_' + uid, JSON.stringify({ avatar:p.avatar, banner:p.banner, photo:p.photo })); } catch (_) {} };
const jparse = (s, d) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : d; } catch (_) { return d; } };
let lastBeat = 0, verCache = null, verAt = 0;

// Conteúdo publicado pelo painel (live/*): lê do BANCO 2 primeiro (leitura pública, alivia o Banco 1); se não houver, cai no Banco 1.
async function getLive(h, name) {
  if (h.b2) { try { const d = await h.Fs.getDoc(h.Fs.doc(h.b2.db, 'live', name)); if (d.exists()) return d; } catch (_) {} }
  return h.Fs.getDoc(h.Fs.doc(h.db, 'live', name));
}
async function getVerified(h) {
  if (verCache && Date.now() - verAt < 60000) return verCache;
  try { const d = await getLive(h, 'verified'); verCache = d.exists() ? jparse(d.data().json, {}) : {}; } catch (_) { verCache = verCache || {}; }
  verAt = Date.now(); return verCache;
}

// Lê o perfil da conta logada (profiles/ranking) e devolve no formato público do jogo.
async function accountOf(h, u) {
  const { Fs, db } = h; let pr = null, rk = null;
  try { pr = (await Fs.getDoc(Fs.doc(db, 'profiles', u.uid))).data() || null; } catch (_) {}
  try { rk = (await Fs.getDoc(Fs.doc(db, 'ranking', u.uid))).data() || null; } catch (_) {}
  const src = pr || rk, o = cacheGet(u.uid), google = (u.providerData || []).some(p => p.providerId === 'google.com');
  const p = src ? { avatar:src.avatar, banner:src.banner, photo:src.photo } : o;
  const name = String((src && src.name) || u.displayName || '').trim();
  return { exists:!!src, anonymous:!!u.isAnonymous, google, account:{ ...pub(u.uid, { name, ...p }), provider:google ? 'google' : 'online' } };
}
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N}_ .-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);
// Nome já usado por OUTRA conta? (confere o ranking; testa algumas variações de maiúsculas/minúsculas)
async function nameTaken(h, name, uid) {
  const { Fs, db } = h, lc = name.toLowerCase(), cap = lc.charAt(0).toUpperCase() + lc.slice(1);
  try {
    const q = Fs.query(Fs.collection(db, 'ranking'), Fs.where('name', 'in', [...new Set([name, lc, cap, name.toUpperCase()])]));
    return (await Fs.getDocs(q)).docs.some(d => d.id !== uid);
  } catch (_) { return false; }
}
let redirectDone = false;
const legacyDone = {};
// Puxa os recordes das contas do jogo antigo (players/{uid}: best_no_coin / best_score) para o ranking/{uid} do jogo novo.
// Só SOBE valores (nunca apaga nem reduz). Roda uma vez por conta por sessão.
async function syncLegacy(h, u, name) {
  if (!u || legacyDone[u.uid]) return; legacyDone[u.uid] = 1;
  const { Fs, db } = h;
  try {
    const pl = await Fs.getDoc(Fs.doc(db, 'players', u.uid)); if (!pl.exists()) return;
    const x = pl.data(), lt = Math.floor(+x.best_no_coin || 0), ls = Math.floor(+x.best_score || 0);
    if (!(lt >= 0 && lt < 86400 && ls >= 0 && ls <= 1e8) || (lt === 0 && ls === 0)) return;
    const rref = Fs.doc(db, 'ranking', u.uid), snap = await Fs.getDoc(rref), e = snap.exists() ? snap.data() : null;
    if (e && lt <= (e.t || 0) && ls <= (e.s || 0)) return;
    if (e) await Fs.updateDoc(rref, { t:Math.max(e.t || 0, lt), s:Math.max(e.s || 0, ls), name:String(e.name || name || '').slice(0, 14), u:Fs.serverTimestamp() });
    else { const o = cacheGet(u.uid); await Fs.setDoc(rref, { name:String(name || u.displayName || x.name || '').slice(0, 14), avatar:String(o.avatar ?? '0'), banner:o.banner || '', photo:o.photo || '', t:lt, s:ls, wk:0, wt:0, wkt:0, u:Fs.serverTimestamp() }); }
  } catch (e) { legacyDone[u.uid] = 0; console.warn('legado:', code(e)); }
}
async function isBanned(h, uid) { try { return (await h.Fs.getDoc(h.Fs.doc(h.db, 'bans', uid))).exists(); } catch (_) { return false; } }

export async function fbApi(path, method, body) {
  try {
    const h = await init(), { Au, Fs, auth, db } = h, b = body || {};
    if (path === '/api/auth/register') {
      const name = String(b.username || '').trim().replace(/\s+/g, ' '), pw = String(b.password || '');
      if (!NAME_RE.test(name)) return err(400, 'Nome de usuário: de 3 a 14 caracteres (letras, números, espaço, _ . -).');
      if (pw.length < 6 || pw.length > 72) return err(400, 'A senha precisa ter entre 6 e 72 caracteres.');
      let cred; try { cred = await Au.createUserWithEmailAndPassword(auth, await emailOf(lcOf(name)), pw); }
      catch (e) {
        if (e.code === 'auth/email-already-in-use') return err(409, 'Esse nome de usuário já está em uso.');
        if (e.code === 'auth/operation-not-allowed') return err(503, 'O login por e-mail/senha está desativado no Firebase (Authentication → Método de login → E-mail/senha → Ativar).');
        if (e.code === 'auth/network-request-failed') return { down:true };
        return err(400, 'Não foi possível criar a conta (' + code(e) + ').');
      }
      const p = { name, avatar:String(b.avatar ?? '0'), banner:String(b.banner || ''), photo:cleanPhoto(b.photo) };
      try { await Au.updateProfile(cred.user, { displayName:name }); } catch (_) {}
      try { await Fs.setDoc(Fs.doc(db, 'profiles', cred.user.uid), { ...p, provider:'local', updatedAt:Fs.serverTimestamp() }); } catch (e) { console.warn('perfil:', code(e)); }
      // Conta do jogo antigo (só existia no aparelho): leva o recorde junto — o do aparelho e o do ranking/{uid} antigo, se o nome bater.
      let t0 = Math.floor(+b.best) || 0, s0 = Math.floor(+b.bs) || 0, from = '';
      const lu = String(b.legacyUid || '');
      if (/^[\w-]{6,60}$/.test(lu)) {
        try { const o = (await Fs.getDoc(Fs.doc(db, 'ranking', lu))).data(); if (o && lcOf(o.name) === lcOf(name)) { t0 = Math.max(t0, Math.floor(+o.t) || 0); s0 = Math.max(s0, Math.floor(+o.s) || 0); from = lu; } } catch (_) {}
      }
      if (!(t0 >= 0 && t0 < 86400)) t0 = 0; if (!(s0 >= 0 && s0 <= 1e8)) s0 = 0;
      try { await Fs.setDoc(Fs.doc(db, 'ranking', cred.user.uid), { name:name.slice(0, 14), avatar:p.avatar, banner:p.banner, photo:p.photo, t:t0, s:s0, wk:0, wt:0, wkt:0, ...(from ? { migratedFrom:from } : {}), u:Fs.serverTimestamp() }); } catch (e) { console.warn('ranking:', code(e)); } // a conta já aparece no painel
      cacheSet(cred.user.uid, p);
      await signDb2(h, lcOf(name), pw, name, true);
      return out(201, { ok:true, token:'fb', account:pub(cred.user.uid, p) });
    }
    if (path === '/api/auth/login') {
      const lc = lcOf(b.username), pw = String(b.password || '');
      if (!lc || pw.length > 72) return err(401, 'Usuário ou senha incorretos.');
      let cred; try { cred = await Au.signInWithEmailAndPassword(auth, await emailOf(lc), pw); }
      catch (e) {
        if (e.code === 'auth/too-many-requests') return err(429, 'Muitas tentativas erradas. Tente de novo em alguns minutos.');
        if (e.code === 'auth/operation-not-allowed') return err(503, 'O login por e-mail/senha está desativado no Firebase (Authentication → Método de login).');
        if (e.code === 'auth/network-request-failed') return { down:true };
        return err(401, 'Usuário ou senha incorretos.');
      }
      if (await isBanned(h, cred.user.uid)) { await Au.signOut(auth); return err(403, 'Esta conta foi bloqueada neste jogo.'); }
      let p = cacheGet(cred.user.uid), pr = null, rk = null;
      try { pr = (await Fs.getDoc(Fs.doc(db, 'profiles', cred.user.uid))).data() || null; } catch (_) {}
      try { rk = (await Fs.getDoc(Fs.doc(db, 'ranking', cred.user.uid))).data() || null; } catch (_) {}
      const src = pr || rk; if (src) p = { avatar:src.avatar, banner:src.banner, photo:src.photo }; // foto e banner que a conta já tinha
      p.name = cred.user.displayName || String(b.username).trim(); cacheSet(cred.user.uid, p);
      const nm = p.name.slice(0, 14), av = String(p.avatar ?? '0'), bn = p.banner || '', ph = cleanPhoto(p.photo);
      if (!pr) { try { await Fs.setDoc(Fs.doc(db, 'profiles', cred.user.uid), { name:p.name.slice(0, 50), avatar:av, banner:bn, photo:ph, provider:'local', updatedAt:Fs.serverTimestamp() }); } catch (e) { console.warn('perfil:', code(e)); } }
      if (!rk) { try { await Fs.setDoc(Fs.doc(db, 'ranking', cred.user.uid), { name:nm, avatar:av, banner:bn, photo:ph, t:0, s:0, wk:0, wt:0, wkt:0, u:Fs.serverTimestamp() }); } catch (e) { console.warn('ranking:', code(e)); } }
      await signDb2(h, lc, pw, p.name, true);
      await syncLegacy(h, cred.user, p.name);
      return out(200, { ok:true, token:'fb', account:pub(cred.user.uid, p) });
    }

    if (path === '/api/auth/session') { // quem está logado de verdade no Firebase neste aparelho
      if (!redirectDone) { redirectDone = true; try { await Au.getRedirectResult(auth); } catch (e) { console.warn('google redirect:', code(e)); } }
      const cu = auth.currentUser; if (!cu) return out(200, { user:null });
      if (await isBanned(h, cu.uid)) { try { await Au.signOut(auth); } catch (_) {} return out(200, { user:null, banned:true }); }
      const a = await accountOf(h, cu);
      return out(200, { user:{ ...a.account, exists:a.exists, anonymous:a.anonymous } });
    }
    if (path === '/api/auth/google') { // entrar / criar conta com o Google
      const prov = new Au.GoogleAuthProvider(); let cred;
      try { cred = await Au.signInWithPopup(auth, prov); }
      catch (e) {
        if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(e.code || '')) { try { await Au.signInWithRedirect(auth, prov); return out(200, { redirecting:true }); } catch (e2) { return err(400, 'Não foi possível abrir o Google (' + code(e2) + ').'); } }
        if (/popup-closed|cancelled-popup/.test(e.code || '')) return err(400, 'Login com o Google cancelado.');
        if (e.code === 'auth/unauthorized-domain') return err(400, 'Este endereço não está autorizado no Firebase (Authentication → Configurações → Domínios autorizados).');
        if (e.code === 'auth/operation-not-allowed') return err(503, 'O login com o Google está desativado no Firebase (Authentication → Método de login → Google).');
        if (e.code === 'auth/network-request-failed') return { down:true };
        return err(400, 'Não foi possível entrar com o Google (' + code(e) + ').');
      }
      const gu = cred.user;
      if (await isBanned(h, gu.uid)) { await Au.signOut(auth); return err(403, 'Esta conta foi bloqueada neste jogo.'); }
      const a = await accountOf(h, gu);
      if (!a.exists) return out(200, { ok:true, token:'fb', needsProfile:true, account:{ uid:gu.uid, name:cleanName(gu.displayName), avatar:cleanPhoto(gu.photoURL) ? 'g' : '0', banner:'', photo:cleanPhoto(gu.photoURL), provider:'google' } });
      cacheSet(gu.uid, a.account);
      return out(200, { ok:true, token:'fb', account:a.account });
    }
    if (path === '/api/poll/vote') { // vota com a conta logada; conta antiga sem sessão vota via login anônimo do Firebase
      const opt = Math.floor(+b.opt), pid = String(b.id || '');
      if (!pid || !(opt >= 0 && opt < 10)) return err(400, 'Voto inválido.');
      let vu = auth.currentUser;
      if (!vu) { try { vu = (await Au.signInAnonymously(auth)).user; } catch (e) { return err(403, 'Entre numa conta online (usuário e senha ou Google) para votar.'); } }
      try { await Fs.setDoc(Fs.doc(db, 'polls', pid, 'votes', vu.uid), { opt, at:Fs.serverTimestamp() }); return out(200, { ok:true }); }
      catch (e) { return err(403, 'Não foi possível votar (a enquete já acabou ou você já votou).'); }
    }
    if (path === '/api/auth/logout') { await Au.signOut(auth); if (h.b2) { try { await Au.signOut(h.b2.auth); } catch (_) {} } return out(200, { ok:true }); }
    if (path === '/api/live') { // skins, avatares, banners e verificados publicados pelo painel
      const res = { meta:{}, verified:{} };
      try { const d = await getLive(h, 'meta'); if (d.exists()) res.meta = d.data(); } catch (_) {}
      if (res.meta.skinsJson === undefined) { // skins publicadas pelo painel antigo ficavam em live/skins
        try { const o = await Fs.getDoc(Fs.doc(db, 'live', 'skins')); if (o.exists()) { const d = o.data(); res.meta = { ...res.meta, skinsJson: typeof d.json === 'string' ? d.json : JSON.stringify(Array.isArray(d.items) ? d.items : []), skRulesJson: res.meta.skRulesJson !== undefined ? res.meta.skRulesJson : (typeof d.rulesJson === 'string' ? d.rulesJson : '{}') }; } } catch (_) {}
      }
      res.verified = await getVerified(h);
      const ex = {}; await Promise.all(['lives', 'partners', 'music'].map(async n => { try { const d = await getLive(h, n); if (d.exists() && typeof d.data().json === 'string') ex[n] = d.data().json; } catch (_) {} }));
      try { const d = await getLive(h, 'news'); ex.news = d.exists() ? d.data() : {}; } catch (_) { ex.news = {}; }
      res.extra = ex;
      try { const d = await getLive(h, 'status'); res.status = d.exists() ? d.data() : {}; } catch (_) { res.status = {}; }
      try { const d = await getLive(h, 'don'); res.don = d.exists() ? d.data() : {}; } catch (_) { res.don = {}; }
      return out(200, res);
    }
    if (path === '/api/status') { try { const d = await getLive(h, 'status'); return out(200, d.exists() ? d.data() : {}); } catch (_) { return out(200, {}); } }
    if (path === '/api/news') { try { const d = await getLive(h, 'news'); return out(200, d.exists() ? d.data() : {}); } catch (_) { return out(200, {}); } }
    if (path === '/api/poll') { // enquete atual + votos de cada opção (contagem no servidor)
      let p = null; try { const d = await Fs.getDoc(Fs.doc(db, 'live', 'poll')); p = d.exists() ? d.data() : null; } catch (_) {}
      if (!p || !p.id || !Array.isArray(p.options)) return out(200, { poll:null });
      const counts = p.options.map(() => 0);
      try { await Promise.all(p.options.map(async (_, i) => { counts[i] = (await Fs.getCountFromServer(Fs.query(Fs.collection(db, 'polls', p.id, 'votes'), Fs.where('opt', '==', i)))).data().count; })); }
      catch (e) { return out(200, { poll:p, counts, total:0, mine:null, errors:[code(e)] }); }
      let mine = null; const u = auth.currentUser;
      if (u) { try { const v = await Fs.getDoc(Fs.doc(db, 'polls', p.id, 'votes', u.uid)); if (v.exists()) mine = v.data().opt; } catch (_) {} }
      return out(200, { poll:p, counts, total:counts.reduce((a, c) => a + c, 0), mine });
    }
    if (path === '/api/telao') { // telão global do admin (imagem ou transmissão ao vivo)
      try { const d = await getLive(h, 'telao'); return out(200, d.exists() ? d.data() : {}); } catch (_) { return out(200, {}); }
    }
    if (path === '/api/leaderboard/all') { // ranking GERAL (recorde de todos os tempos): todas as contas com tempo, online ou não
      const ver = await getVerified(h);
      let docs; try { docs = (await Fs.getDocs(Fs.query(Fs.collection(db, 'ranking'), Fs.where('t', '>', 0), Fs.orderBy('t', 'desc'), Fs.limit(60)))).docs; }
      catch (e) { return out(200, { rows:[], mine:null, errors:[code(e)] }); }
      const rows = docs.map(d => ({ id:d.id, ...d.data() })).filter(r => !r.banned).filter((r, i, arr) => arr.findIndex(o => lcOf(o.name) === lcOf(r.name)) === i).slice(0, 50) // já vem do maior para o menor: fica o melhor de cada nome
        .map(r => ({ user_id:r.id, username:r.name, avatar:r.avatar ?? '0', banner:r.banner || '', photo:r.photo || '', has_account:1, best_no_coin:r.t, best_score:r.s || 0, verified:ver[r.id] || '' }));
      let mine = null; const u = auth.currentUser;
      if (u) { try { const e = (await Fs.getDoc(Fs.doc(db, 'ranking', u.uid))).data(); if (e && e.t > 0 && !e.banned) { const c = (await Fs.getCountFromServer(Fs.query(Fs.collection(db, 'ranking'), Fs.where('t', '>', e.t)))).data().count; mine = { pos:c + 1, name:e.name, t:e.t, s:e.s || 0, avatar:e.avatar ?? '0', photo:e.photo || '', banner:e.banner || '', uid:u.uid, verified:ver[u.uid] || '' }; } } catch (_) {} }
      return out(200, { rows, mine, errors:[] });
    }
    if (path === '/api/leaderboard') {
      const P = periodNow(), base = P.n * WK, ver = await getVerified(h);
      let docs; try { docs = (await Fs.getDocs(Fs.query(Fs.collection(db, 'ranking'), Fs.where('wkt', '>=', base), Fs.orderBy('wkt', 'desc'), Fs.limit(60)))).docs; }
      catch (e) { return out(200, { rows:[], mine:null, period:P, errors:[code(e)] }); }
      const rows = docs.map(d => ({ id:d.id, ...d.data() })).filter(r => !r.banned && r.wt > 0).slice(0, 50)
        .map(r => ({ user_id:r.id, username:r.name, avatar:r.avatar ?? '0', banner:r.banner || '', photo:r.photo || '', has_account:1, best_no_coin:r.wt, best_score:r.s || 0, verified:ver[r.id] || '' }));
      let mine = null; const u = auth.currentUser;
      if (u) {
        try {
          const e = (await Fs.getDoc(Fs.doc(db, 'ranking', u.uid))).data();
          if (e && e.wk === P.n && e.wt > 0 && !e.banned) {
            const c = (await Fs.getCountFromServer(Fs.query(Fs.collection(db, 'ranking'), Fs.where('wkt', '>', base + e.wt)))).data().count;
            mine = { pos:c + 1, name:e.name, t:e.wt, s:e.s || 0, avatar:e.avatar ?? '0', photo:e.photo || '', banner:e.banner || '', uid:u.uid, verified:ver[u.uid] || '' };
          }
        } catch (_) {}
      }
      return out(200, { rows, mine, period:P, errors:[] });
    }
    if (path === '/api/game/match-leaderboard') return out(200, []);
    if (path.startsWith('/api/replay')) return err(404, 'Replay indisponível nesta versão.');
    const u = auth.currentUser;
    if (!u) return err(401, 'Sessão expirada.');
    const now = Date.now(), pref = Fs.doc(db, 'profiles', u.uid), rref = Fs.doc(db, 'ranking', u.uid);
    if (path === '/api/me/record') { // recorde pessoal guardado na conta (vale em qualquer aparelho)
      try {
        await syncLegacy(h, u, u.displayName || '');
        const e = (await Fs.getDoc(rref)).data(); if (!e) return out(200, { rec:null });
        const P = periodNow(), cnt = async (fld, v) => (await Fs.getCountFromServer(Fs.query(Fs.collection(db, 'ranking'), Fs.where(fld, '>', v)))).data().count;
        const wt = e.wk === P.n ? (e.wt || 0) : 0;
        return out(200, { rec:{ t:e.t || 0, s:e.s || 0, wt, posAll:e.t > 0 ? (await cnt('t', e.t)) + 1 : 0, posWeek:wt > 0 ? (await cnt('wkt', P.n * WK + wt)) + 1 : 0 } });
      } catch (e) { return out(200, { rec:null, error:code(e) }); }
    }
    if (path === '/api/auth/google-profile') { // perfil da conta Google (nome + avatar + banner)
      const name = cleanName(b.name); if (!NAME_RE.test(name)) return err(400, 'Nome de usuário: de 3 a 14 caracteres (letras, números, espaço, _ . -).');
      if (await isBanned(h, u.uid)) return err(403, 'Esta conta foi bloqueada neste jogo.');
      if (await nameTaken(h, name, u.uid)) return err(409, 'Esse nome de usuário já está em uso. Escolha outro.');
      const p = { name, avatar:String(b.avatar ?? '0'), banner:String(b.banner || ''), photo:cleanPhoto(b.photo) };
      try { await Au.updateProfile(u, { displayName:name }); } catch (_) {}
      try { await Fs.setDoc(pref, { ...p, provider:'google', updatedAt:Fs.serverTimestamp() }); } catch (e) { return err(500, 'Não foi possível salvar o perfil (' + code(e) + ').'); }
      try { const e = (await Fs.getDoc(rref)).data(); if (e) await Fs.updateDoc(rref, { name:name.slice(0, 14), avatar:p.avatar, banner:p.banner, photo:p.photo, t:e.t }); else await Fs.setDoc(rref, { name:name.slice(0, 14), avatar:p.avatar, banner:p.banner, photo:p.photo, t:0, s:0, wk:0, wt:0, wkt:0, u:Fs.serverTimestamp() }); } catch (e) { console.warn('ranking:', code(e)); }
      cacheSet(u.uid, p);
      return out(200, { ok:true, token:'fb', account:{ ...pub(u.uid, p), provider:'google' } });
    }
    if (path === '/api/auth/me') return out(200, { ok:true, account:pub(u.uid, { name:u.displayName || '', ...cacheGet(u.uid) }) });
    if (path === '/api/auth/profile') {
      if (b.newPassword) {
        const np = String(b.newPassword); if (np.length < 6 || np.length > 72) return err(400, 'A nova senha precisa ter entre 6 e 72 caracteres.');
        try { await Au.reauthenticateWithCredential(u, Au.EmailAuthProvider.credential(u.email, String(b.currentPassword || ''))); await Au.updatePassword(u, np); } catch (_) { return err(403, 'Senha atual incorreta.'); }
        if (h.b2 && h.b2.auth.currentUser) { try { await Au.updatePassword(h.b2.auth.currentUser, np); } catch (_) {} }
      }
      const prov = (u.providerData || []).some(x => x.providerId === 'google.com') ? 'google' : 'local';
      const cur = (await accountOf(h, u)).account.name || u.displayName || ''; // nome salvo no jogo (não o do e-mail do Google)
      let name = cur;
      if (prov === 'google' && b.name !== undefined) { // só conta Google troca o nome aqui (conta manual tem o login atrelado ao nome)
        const nn = cleanName(b.name); if (!NAME_RE.test(nn)) return err(400, 'Nome de usuário: de 3 a 14 caracteres (letras, números, espaço, _ . -).');
        if (nn !== cur) {
          if (await nameTaken(h, nn, u.uid)) return err(409, 'Esse nome de usuário já está em uso. Escolha outro.');
          name = nn; try { await Au.updateProfile(u, { displayName:nn }); } catch (_) {}
        }
      }
      const old = cacheGet(u.uid), p = { name, avatar:String(b.avatar ?? old.avatar ?? '0'), banner:String(b.banner ?? old.banner ?? ''), photo:b.photo !== undefined ? cleanPhoto(b.photo) : (old.photo || '') };
      try { await Fs.setDoc(pref, { ...p, provider:prov, updatedAt:Fs.serverTimestamp() }); } catch (e) { console.warn('perfil:', code(e)); }
      try { const e = (await Fs.getDoc(rref)).data(); if (e) await Fs.updateDoc(rref, { name:p.name.slice(0, 14), avatar:p.avatar, banner:p.banner, photo:p.photo, t:e.t }); } catch (_) {}
      cacheSet(u.uid, p);
      return out(200, { ok:true, account:{ ...pub(u.uid, p), provider:prov } });
    }
    if (path === '/api/game/heartbeat') {
      if (now - lastBeat > 50000) {
        lastBeat = now;
        if (!legacyDone[u.uid]) syncLegacy(h, u, u.displayName || '');
        const u2 = h.b2 && h.b2.auth.currentUser; // presença no Banco 2 (alivia o Banco 1)
        if (u2) { try { await Fs.setDoc(Fs.doc(h.b2.db, 'presence', u2.uid), { uid1:u.uid, name:(u.displayName || '').slice(0, 50), updatedAt:Fs.serverTimestamp() }); } catch (e) { console.warn('presença (banco 2):', code(e)); } }
        else {
          try { await Fs.updateDoc(pref, { updatedAt:Fs.serverTimestamp() }); }
          catch (_) { try { const o = cacheGet(u.uid); await Fs.setDoc(pref, { name:u.displayName || '', avatar:String(o.avatar ?? '0'), banner:o.banner || '', photo:o.photo || '', provider:'local', updatedAt:Fs.serverTimestamp() }); } catch (e) { console.warn('presença:', code(e)); } }
        }
      }
      return out(200, { ok:true, serverTime:now });
    }
    if (path === '/api/game/score') {
      const sc = Math.floor(+b.score), t = Math.floor(+b.noCoinSeconds);
      if (!(sc >= 0 && sc <= 1e8 && t >= 0 && t < 86400)) return err(400, 'Resultado inválido.');
      if (await isBanned(h, u.uid)) return err(403, 'Esta conta foi bloqueada neste jogo.');
      if (t < 1) return out(200, { ok:true });
      const P = periodNow(), o = cacheGet(u.uid), name = (u.displayName || '').slice(0, 14);
      try {
        const e = (await Fs.getDoc(rref)).data() || {};
        const wt = e.wk === P.n ? Math.max(e.wt || 0, t) : t;
        await Fs.setDoc(rref, { name, avatar:String(o.avatar ?? e.avatar ?? '0'), banner:o.banner ?? e.banner ?? '', photo:o.photo ?? e.photo ?? '', t:Math.max(e.t || 0, t), s:Math.max(e.s || 0, sc), wk:P.n, wt, wkt:P.n * WK + wt, u:Fs.serverTimestamp() });
      } catch (e) { return err(500, 'Não foi possível salvar no ranking (' + code(e) + ').'); }
      return out(200, { ok:true, updatedAt:now });
    }
    if (path === '/api/game/match-result') return out(200, { ok:true });
    return err(404, 'Rota inexistente.');
  } catch (e) { console.warn('firebase:', e); return { status:0, data:null, down:true }; }
}
export { init as fbInit };
