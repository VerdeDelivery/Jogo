// Configuração compartilhada entre o jogo (firebase-dual.js) e o painel administrativo (admin.js).
export const FB_VERSION = '10.12.2';
export const FB_BASE = 'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/';
// BANCO 1 (principal): subway-run-dc9b5 — contas (Auth), ranking, profiles, bans, enquetes.
export const CFG = { apiKey:'AIzaSyAaKGet7VL3gsKYScfcOWmsVZW-fzuehq0', authDomain:'subway-run-dc9b5.firebaseapp.com', projectId:'subway-run-dc9b5', storageBucket:'subway-run-dc9b5.firebasestorage.app', messagingSenderId:'408336596205', appId:'1:408336596205:web:d505468d05905a84c3a0e4' };
export const lcOf = n => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();

// ---- Ranking semanal: zera toda quinta-feira, em um horário "aleatório" (fixo para cada semana, igual para todos) ----
const DAY = 864e5, TZ_OFF = 3 * 3600e3; // horário de Brasília (UTC-3)
function mix(n) { let x = (Math.imul(n | 0, 2654435761) + 0x9e3779b9) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0; x ^= x >>> 16; return x >>> 0; }
export const resetAt = w => w * 7 * DAY + (mix(w) % 1440) * 60000 + TZ_OFF; // dia 0 do calendário Unix foi uma quinta-feira
export function periodNow(now = Date.now()) {
  let w = Math.floor((now - TZ_OFF) / (7 * DAY));
  if (now < resetAt(w)) w--;
  return { id: 'p' + w, n: w, start: resetAt(w), next: resetAt(w + 1) };
}
export const fmtDateTime = ts => new Date(ts).toLocaleString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });

export const WK = 100000; // campo wkt = semana * 100000 + tempo da semana (permite ordenar/contar com índice simples)

// ---- BANCO 2 (opcional) ----------------------------------------------------------------------------
// Cole aqui a configuração do segundo projeto Firebase (Configurações do projeto > Seus apps > Config).
// Enquanto estiver null, TUDO roda só no Banco 1 (o jogo funciona normalmente).
// Divisão do trabalho quando preenchido:
//   BANCO 1 (principal): contas/Auth, ranking, profiles, bans, live (skins, enquetes, telão), players.
//   BANCO 2 (social):    presença online (heartbeat a cada ~50 s) e todo o multijogador (mp_lobby, mp_rooms, mp_invites).
// Conteúdo/Online e Skins agora dividem o MESMO projeto Firebase (skin-4f7da). Regras: firestore-conteudo-e-skins.rules
export const CFG2 = { apiKey:'AIzaSyCgFYmJlHaxPfpvnrOxVI0YjvwJMsWLBaE', authDomain:'skin-4f7da.firebaseapp.com', projectId:'skin-4f7da', storageBucket:'skin-4f7da.firebasestorage.app', messagingSenderId:'147966450703', appId:'1:147966450703:web:cb4083b37acf5a45c0577a' };
// BANCO 2: skin-4f7da (compartilhado com as skins) — conteúdo publicado pelo painel (skins, banners, fotos, avisos, manutenção, arrecadações, verificados, telão) e presença.
