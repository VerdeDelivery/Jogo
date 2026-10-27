// Multijogador próprio (sem WebSim): salas, convites e corrida em tempo real usando o Firestore do jogo.
// Imita o protocolo de mensagens do servidor antigo, então a tela do jogo continua igual.
import { fbInit } from './firebase-dual.js';

const ONLINE_MS = 100000, ROOM_ALIVE_MS = 120000, BEAT_MS = 30000, POLL_MS = 6000, MAX_PLAYERS = 12, COUNTDOWN_MS = 5000;
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
const clean = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sr-room:' + s)));
const ts = v => (v && v.toMillis ? v.toMillis() : typeof v === 'number' ? v : 0);

export async function joinFsRoom() {
  const h = await fbInit();
  if (!h.auth.currentUser) throw new Error('Entre numa conta (usuário e senha) para usar o multijogador.');
  // Multijogador e presença ficam sempre no Banco 1 (principal), junto das contas.
  // Assim todos os jogadores que estiverem com o jogo aberto e autenticados usam o mesmo lobby.
  const sh = { Fs:h.Fs, db:h.db, auth:h.auth, id:1 };
  try { if ((await h.Fs.getDoc(h.Fs.doc(h.db, 'bans', h.auth.currentUser.uid))).exists()) throw new Error('Esta conta foi bloqueada neste jogo.'); } catch (e) { if (/bloqueada/.test(e.message)) throw e; }
  const s = new FsSocket({ Fs:sh.Fs, db:sh.db, auth:sh.auth }); s.start(); return s;
}

class FsSocket {
  constructor(h) {
    this.h = h; this.uid = h.auth.currentUser.uid;
    this.me = { name: clean(h.auth.currentUser.displayName, 20) || 'Jogador', avatar: '0', character: 0 };
    this.room = null; this.phase = ''; this.players = new Map(); this.users = []; this.rooms = [];
    this.unsubs = []; this.roomUnsubs = []; this.timers = []; this.goT = 0;
    this.running = false; this.finished = false; this.closed = false; this.lastLobby = ''; this.errShown = false;
  }
  emit(o) { if (this.closed) return; setTimeout(() => { try { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } catch (e) { console.warn('mp:', e); } }, 0); }
  err(m) { this.emit({ type: 'error', message: m }); }
  fail(e) {
    const c = (e && (e.code || e.message)) || '';
    if (/permission/i.test(c)) { if (this.errShown) return; this.errShown = true; this.err('Sem permissão no multijogador. Publique as regras novas do Firebase (painel → aba Regras).'); }
    else this.err('Falha no multijogador (' + c + ').');
  }
  get F() { return this.h.Fs; } get db() { return this.h.db; }
  roomRef(code) { return this.F.doc(this.db, 'mp_rooms', code); }
  pRef(code, uid) { return this.F.doc(this.db, 'mp_rooms', code, 'p', uid || this.uid); }

  start() {
    this.beat(); this.timers.push(setInterval(() => this.beat(), BEAT_MS));
    this.poll(true); this.timers.push(setInterval(() => this.poll(false), POLL_MS));
    this.unsubs.push(this.F.onSnapshot(this.F.doc(this.db, 'mp_invites', this.uid), snap => {
      const d = snap.exists() ? snap.data() : null; if (!d) return;
      if (Date.now() - (d.at || 0) < 120000) this.emit({ type: 'invite', code: d.code, title: d.title, name: d.name, avatar: d.avatar, locked: !!d.locked });
      this.F.deleteDoc(snap.ref).catch(() => {});
    }, () => {}));
  }
  close() {
    this.closed = true; this.timers.forEach(clearInterval); clearTimeout(this.goT); this.unsubs.forEach(u => { try { u(); } catch (_) {} }); this.detach();
    this.F.deleteDoc(this.F.doc(this.db, 'mp_lobby', this.uid)).catch(() => {});
  }
  detach() { this.roomUnsubs.forEach(u => { try { u(); } catch (_) {} }); this.roomUnsubs = []; }

  async beat() {
    try {
      await this.F.setDoc(this.F.doc(this.db, 'mp_lobby', this.uid), { name: this.me.name, avatar: this.me.avatar, character: this.me.character, roomId: this.room ? this.room.code : '', seen: Date.now() });
      if (this.room && this.room.owner === this.uid && this.phase === 'lobby') await this.F.updateDoc(this.roomRef(this.room.code), { seen: Date.now() });
    } catch (e) { this.fail(e); }
  }
  async poll(first) {
    const F = this.F, db = this.db, now = Date.now();
    try {
      const [us, rs] = await Promise.all([
        F.getDocs(F.query(F.collection(db, 'mp_lobby'), F.where('seen', '>', now - ONLINE_MS), F.limit(80))),
        F.getDocs(F.query(F.collection(db, 'mp_rooms'), F.where('phase', '==', 'lobby'), F.limit(40)))
      ]);
      const myRoom = this.room ? this.room.code : '';
      let users = us.docs.filter(d => d.id !== this.uid).map(d => { const x = d.data(); return { id: d.id, name: clean(x.name, 20) || 'Jogador', avatar: String(x.avatar ?? '0'), character: x.character | 0, roomId: x.roomId || '' }; });
      users.unshift({ id: this.uid, name: this.me.name, avatar: this.me.avatar, character: this.me.character, roomId: myRoom });
      const rooms = rs.docs.filter(d => now - (d.data().seen || 0) < ROOM_ALIVE_MS).map(d => { const r = d.data(); return { code: d.id, title: r.title, owner: r.ownerName, players: Math.max(1, users.filter(u => u.roomId === d.id).length), max: r.max || MAX_PLAYERS, locked: !!r.locked, phase: r.phase }; });
      this.users = users; this.rooms = rooms;
      const key = JSON.stringify([users, rooms]);
      if (first) { this.lastLobby = key; this.emit({ type: 'welcome', id: this.uid, users, rooms }); }
      else if (key !== this.lastLobby) { this.lastLobby = key; this.emit({ type: 'lobby', users, rooms }); }
    } catch (e) {
      if (first) this.emit({ type: 'welcome', id: this.uid, users: [{ id: this.uid, name: this.me.name, avatar: this.me.avatar, character: this.me.character, roomId: '' }], rooms: [] });
      this.fail(e);
    }
  }

  send(m) {
    if (this.closed || !m || typeof m !== 'object') return;
    this.handle(m).catch(e => this.fail(e));
  }
  async handle(m) {
    const F = this.F, db = this.db, t = m.type;
    if (t === 'profile') {
      this.me = { name: clean(m.name, 20) || this.me.name, avatar: /^(\d{1,3}|c_[\w.:-]{1,60}|g)$/.test(String(m.avatar)) ? String(m.avatar) : '0', character: Math.max(0, Math.min(200, Math.floor(+m.character) || 0)) };
      await this.beat();
      if (this.room) F.updateDoc(this.pRef(this.room.code), { name: this.me.name, avatar: this.me.avatar, character: this.me.character }).catch(() => {});
      return;
    }
    if (t === 'create') {
      if (this.room) return this.err('Saia da sala atual antes de criar outra.');
      const title = clean(m.title, 32) || 'Sala NOCOIN', pw = String(m.password || '').slice(0, 24);
      let code = ''; for (let i = 0; i < 6 && !code; i++) { const c = newCode(); if (!(await F.getDoc(this.roomRef(c))).exists()) code = c; }
      if (!code) return this.err('Não consegui gerar o código da sala. Tente de novo.');
      const room = { owner: this.uid, ownerName: this.me.name, title, pwh: pw ? await sha(pw) : '', locked: !!pw, max: MAX_PLAYERS, phase: 'lobby', cdAt: null, seen: Date.now(), createdAt: Date.now() };
      await F.setDoc(this.roomRef(code), room);
      await this.enter(code, room); this.emit({ type: 'created', code }); return;
    }
    if (t === 'join') {
      if (this.room) return this.err('Saia da sala atual antes de entrar em outra.');
      const code = clean(m.code, 8).toUpperCase(); if (!code) return this.err('Digite o código da sala.');
      const snap = await F.getDoc(this.roomRef(code)); if (!snap.exists()) return this.err('Sala não encontrada.');
      const r = snap.data();
      if (r.phase !== 'lobby') return this.err('Essa partida já começou.');
      if (r.locked && (await sha(String(m.password || '').slice(0, 24))) !== r.pwh) return this.err('Senha incorreta.');
      const ps = await F.getDocs(F.collection(db, 'mp_rooms', code, 'p')); if (ps.size >= (r.max || MAX_PLAYERS)) return this.err('Sala cheia.');
      await this.enter(code, r); this.emit({ type: 'joined', code }); return;
    }
    if (t === 'leave') return this.leave();
    if (t === 'invite') {
      if (!this.room) return this.err('Convite indisponível.');
      const id = String(m.id || ''); if (!id || id === this.uid) return this.err('Convite indisponível.');
      await F.setDoc(F.doc(db, 'mp_invites', id), { fromUid: this.uid, name: this.me.name, avatar: this.me.avatar, code: this.room.code, title: this.room.title, locked: !!this.room.locked, at: Date.now() }); return;
    }
    if (t === 'start') {
      if (!this.room || this.room.owner !== this.uid) return this.err('Só quem criou a sala pode começar.');
      if (this.players.size < 2) return this.err('São necessários pelo menos 2 jogadores.');
      if (this.phase !== 'lobby') return;
      await F.updateDoc(this.roomRef(this.room.code), { phase: 'countdown', cdAt: F.serverTimestamp(), seen: Date.now() }); return;
    }
    if (!this.room) return;
    if (t === 'progress') {
      if (!this.running || this.finished) return;
      const d = Math.floor(+m.distance); if (!Number.isFinite(d) || d < 0) return;
      const patch = { distance: d, seen: Date.now() }; if (Number.isFinite(+m.lane)) patch.lane = Math.max(-1, Math.min(1, Math.round(+m.lane)));
      await F.updateDoc(this.pRef(this.room.code), patch); return;
    }
    if (t === 'eliminate') {
      if (!this.running || this.finished) return;
      const patch = { status: 'out', eliminatedAt: Date.now(), reason: clean(m.reason, 40) || 'Eliminado', seen: Date.now() };
      const d = Math.floor(+m.distance); if (Number.isFinite(d) && d >= 0) patch.distance = d;
      await F.updateDoc(this.pRef(this.room.code), patch); return;
    }
  }

  async enter(code, room) {
    this.room = { ...room, code }; this.phase = room.phase || 'lobby'; this.players = new Map(); this.running = false; this.finished = false;
    await this.F.setDoc(this.pRef(code), { id: this.uid, name: this.me.name, avatar: this.me.avatar, character: this.me.character, status: 'lobby', distance: 0, rank: 0, joinedAt: Date.now(), seen: Date.now() });
    this.beat();
    this.roomUnsubs.push(this.F.onSnapshot(this.roomRef(code), snap => this.onRoom(snap), e => this.fail(e)));
    this.roomUnsubs.push(this.F.onSnapshot(this.F.collection(this.db, 'mp_rooms', code, 'p'), snap => this.onPlayers(snap), e => this.fail(e)));
  }
  cleanupRoom() { clearTimeout(this.goT); this.detach(); this.room = null; this.phase = ''; this.players = new Map(); this.running = false; this.finished = false; this.beat(); }
  async leave() {
    if (!this.room) return;
    const code = this.room.code, owner = this.room.owner === this.uid, ids = [...this.players.keys()];
    this.cleanupRoom();
    try {
      if (owner) { await Promise.all(ids.map(id => this.F.deleteDoc(this.pRef(code, id)).catch(() => {}))); await this.F.deleteDoc(this.roomRef(code)); }
      else await this.F.deleteDoc(this.pRef(code));
    } catch (_) {}
  }

  onRoom(snap) {
    if (!this.room) return;
    if (!snap.exists()) { this.cleanupRoom(); this.emit({ type: 'closed', message: 'O dono encerrou a sala.' }); return; }
    const d = snap.data({ serverTimestamps: 'estimate' }), before = this.phase;
    this.room = { ...d, code: snap.id }; this.phase = d.phase;
    if (d.phase === 'countdown' && before !== 'countdown') this.beginCountdown();
    this.pushMatch();
  }
  beginCountdown() {
    const startAt = Date.now() + COUNTDOWN_MS + (this.room.owner === this.uid ? 300 : 0); // o dono recebe o aviso antes dos outros: compensa
    this.emit({ type: 'countdown', startAt });
    clearTimeout(this.goT); this.goT = setTimeout(() => this.go(startAt), Math.max(0, startAt - Date.now()) + 120);
  }
  go(startAt) {
    if (!this.room || this.finished) return;
    this.running = true;
    this.F.updateDoc(this.pRef(this.room.code), { status: 'alive', distance: 0, seen: Date.now() }).catch(() => {});
    if (this.room.owner === this.uid) this.F.updateDoc(this.roomRef(this.room.code), { phase: 'running' }).catch(() => {});
    this.emit({ type: 'go', startedAt: startAt });
  }
  onPlayers(snap) {
    const prev = this.players, cur = new Map(); snap.docs.forEach(d => cur.set(d.id, { id: d.id, ...d.data() }));
    let structural = prev.size !== cur.size; const prog = [], elim = [];
    for (const [id, p] of cur) {
      const o = prev.get(id); if (!o) { structural = true; continue; }
      if (o.status !== p.status || o.name !== p.name || o.avatar !== p.avatar || o.character !== p.character) { structural = true; if (p.status === 'out' && o.status !== 'out') elim.push({ type: 'eliminated', id, reason: p.reason || 'Eliminado' }); }
      else if (o.distance !== p.distance || o.lane !== p.lane) prog.push({ type: 'progress', id, distance: Math.floor(p.distance || 0), lane: p.lane });
    }
    this.players = cur;
    if (!this.room) return;
    elim.forEach(e => this.emit(e));
    if (structural) this.pushMatch(); else prog.forEach(x => this.emit(x));
    this.settle();
  }
  list() { return [...this.players.values()].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || (a.id < b.id ? -1 : 1)); }
  pushMatch() {
    const r = this.room; if (!r) return;
    const players = this.list().map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar || '0', avatarUrl: '', character: p.character || 0, lane: Number.isFinite(p.lane) ? p.lane : (i % 3) - 1, startOffset: Math.floor(i / 3) * 160, status: p.status, distance: p.distance || 0, rank: p.rank || 0 }));
    this.emit({ type: 'match', room: { code: r.code, title: r.title, phase: r.phase, countdownAt: ts(r.cdAt), owner: r.owner, players } });
  }
  settle() {
    if (!this.room || this.finished || !this.running) return;
    const all = this.list(); if (!all.length) return;
    const active = all.filter(p => p.status !== 'out' && p.status !== 'finished'); if (active.length > 1) return;
    this.finished = true;
    const podium = [...all].sort((a, b) => ((a.status === 'out' ? 1 : 0) - (b.status === 'out' ? 1 : 0)) || (b.distance || 0) - (a.distance || 0) || (a.eliminatedAt || 0) - (b.eliminatedAt || 0))
      .map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar || '0', avatarUrl: '', character: p.character || 0, distance: Math.floor(p.distance || 0), rank: i + 1, status: p.status }));
    this.emit({ type: 'podium', room: this.room.code, podium });
    this.F.updateDoc(this.pRef(this.room.code), { status: 'finished' }).catch(() => {});
    if (this.room.owner === this.uid) this.F.updateDoc(this.roomRef(this.room.code), { phase: 'finished' }).catch(() => {});
  }
}
