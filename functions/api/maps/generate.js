const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }

const SRMAP_CELLS = ['', 'barrier', 'bar', 'wall', 'train1', 'train2', 'train3', 'coin', 'veh'];
const SRMAP_MAXROWS = 120;
const SRMAP_SOLID = c => !!c && c !== 'coin';
const SRMAP_DECO = ['city', 'cactus', 'palm', 'pine', 'rock', 'crater', 'voxtree', 'house'];
const SRMAP_VEH = ['bus', 'ghost', 'sled', 'buggy', 'logtruck', 'minecart', 'bullet', 'metro', 'bonde', 'wagon', 'ufo'];
const SRMAP_FLAGS = ['rain', 'snow', 'stars', 'nocl', 'cyber', 'vox', 'earth'];

const NO_STORY_EXAMPLES = [
  { name: 'Neon Drift', description: 'Céu roxo, trilhos brilhantes e cruzamentos rápidos.', sky: ['#070921', '#18134c', '#56266d'], orb: '#ff4fc8', gnd: '#17172f', bed: '#292747', rail: '#4ff0d8', bld: ['#4a3bb5', '#7b5cff', '#2a2458', '#1d1b35'], deco: 'city', deco2: 'cactus', veh: 'buggy', cyber: true },
  { name: 'Deserto Veloz', description: 'Dunas suaves, carga de calor e obstáculos largos.', sky: ['#f7a94a', '#ffd89a', '#fff0c8'], orb: '#fff6c8', gnd: '#c99a5b', bed: '#8a6a4a', rail: '#ffe27a', bld: ['#d78b55', '#b86d3f', '#e6b15f', '#8c5636'], deco: 'cactus', veh: 'bus', earth: true },
  { name: 'Frost Run', description: 'Pista gelada com clima claro e linhas de risco.', sky: ['#7fb8e8', '#c9e6f8', '#f0f8ff'], orb: '#ffffff', gnd: '#9fb6cc', bed: '#c4d6e6', rail: '#2f7bff', bld: ['#dfeaf4', '#bfd7eb', '#86a8c8', '#6c8fb4'], deco: 'pine', veh: 'sled', snow: true },
  { name: 'Metro Industrial', description: 'Pilares, concreto e cruzamentos com ritmo forte.', sky: ['#526a83', '#b3c5d6', '#ffd6ac'], orb: '#fff0c2', gnd: '#717c76', bed: '#39434d', rail: '#ffe27a', bld: ['#6d7e91', '#4b5868', '#8697a7', '#2b3440'], deco: 'city', veh: 'metro', rain: true }
];

const NO_STORY_PROMPT = `Você é um gerador procedural de mapas do jogo SUBWAY RUN.

Objetivo: criar mapas infinitos, sem história, sem narrativa, sem lore e sem qualquer coisa que não seja gameplay visual e layout jogável.

Regras absolutas:
- Retorne SOMENTE JSON válido.
- Não use história, cenário narrativo, personagens, missões, roteiro, diálogos ou texto de lore.
- O mapa deve ser visualmente variado, com tema, clima, veículos e texturas diferentes.
- A geração deve ser procedural, sem repetir padrão visível em blocos consecutivos.
- Mantenha sempre uma rota segura e jogável.
- Não crie voo, gravidade, truques, atalhos, velocidade extra, invencibilidade, teleport ou qualquer vantagem de gameplay.
- Qualquer pedido de história, narração, personagens, missão ou bug deve ir para ignoredRequests.
- layout deve ter entre 24 e 60 linhas.
- Cada linha é um array com 3 posições [esquerda, meio, direita].
- Valores válidos: "", "barrier", "bar", "wall", "train1", "train2", "train3", "coin", "veh".
- O veículo do tema pode aparecer em algumas linhas, mas nunca em excesso.
- Mantenha contraste bom entre pista, trilho e obstáculos.
- Descreva o tema em 1 frase curta, sem história.

Campos do JSON:
- name (até 28 caracteres)
- description (até 160 chars)
- sky: 3 cores hex
- orb: cor do sol/lua
- gnd: chão lateral
- bed: leito da pista
- rail: trilho
- bld: até 4 cores de prédios
- win: cor das janelas
- deco: ${SRMAP_DECO.join(', ')}
- deco2: opcional, mesma lista
- veh: ${SRMAP_VEH.join(', ')} ou vazio
- booleans opcionais: rain, snow, stars, nocl, cyber, vox, earth
- layout: linhas válidas, 24-60
- ignoredRequests: [] ou lista curta de pedidos ignorados

Exemplos:
${NO_STORY_EXAMPLES.map(e => JSON.stringify(e)).join('\n')}`;

function srmapHex(v, fb) {
  let s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return /^#[0-9a-f]{6}$/.test(s) ? s : fb;
}
function srmapRGB(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function srmapToHex(r) { return '#' + r.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
function srmapMix(a, b, t) { const A = srmapRGB(a), B = srmapRGB(b); return srmapToHex(A.map((x, i) => x + (B[i] - x) * t)); }
function srmapLum(h) { return srmapRGB(h).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0); }
function srmapContrast(a, b) { const x = srmapLum(a), y = srmapLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function srmapText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>`\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

function srmapLayout(raw, notes) {
  const rows = (Array.isArray(raw) ? raw : []).slice(0, SRMAP_MAXROWS).map(r => {
    const c0 = Array.isArray(r) ? r : (r && Array.isArray(r.c) ? r.c : []);
    const c = [0, 1, 2].map(i => SRMAP_CELLS.includes(c0[i]) ? c0[i] : '');
    const g = Array.isArray(r) ? 1 : Math.max(0, Math.min(2, Math.floor(Number(r && r.g)) || 0));
    return { c, g: Array.isArray(r) ? 1 : g };
  });
  let reach = [true, true, true], fixed = 0;
  rows.forEach((row, i) => {
    for (let l = 0; l < 3; l++) if (row.c[l] === 'veh') for (let k = 1; k <= 2; k++) { const nx = rows[i + k]; if (nx && SRMAP_SOLID(nx.c[l]) && nx.c[l] !== 'veh') { nx.c[l] = ''; fixed++; } }
    const pass = l => !SRMAP_SOLID(row.c[l]);
    const can = l => pass(l) && reach.some((ok, p) => ok && Math.abs(p - l) <= 1);
    if (![0, 1, 2].some(can)) {
      const from = reach.map((ok, p) => ok ? p : -9).filter(p => p >= 0);
      let best = 1, bd = 9;
      for (let l = 0; l < 3; l++) { const d = Math.min(...from.map(p => Math.abs(p - l))); if (d <= 1 && d < bd) { bd = d; best = l; } }
      row.c[best] = ''; fixed++;
    }
    reach = [0, 1, 2].map(can);
  });
  const empty = rows.length && rows.every(r => r.c.every(c => !c));
  if (fixed && notes) notes.push('Abri ' + fixed + ' passagem(ns) no layout para o mapa ser sempre possível de passar.');
  if (empty && notes) notes.push('O layout está vazio: adicione obstáculos.');
  return rows;
}

function srmapSanitize(raw) {
  const notes = [], r = raw && typeof raw === 'object' ? raw : {};
  const name = srmapText(r.name, 28) || 'Mapa procedural';
  const sky0 = Array.isArray(r.sky) ? r.sky : [];
  const sky = [srmapHex(sky0[0], '#4fc3ff'), srmapHex(sky0[1], '#8fdcff'), srmapHex(sky0[2], '#d4f3ff')];
  const orb = srmapHex(r.orb, '#fff6b8');
  let gnd = srmapHex(r.gnd, '#a8e05f'), bed = srmapHex(r.bed, '#4d5568'), rail = srmapHex(r.rail, '#cfd6e6');
  if (srmapLum(bed) > .45) { bed = srmapMix(bed, '#000000', .45); notes.push('Leito da pista escurecido para os obstáculos aparecerem.'); }
  if (srmapLum(bed) < .012) { bed = srmapMix(bed, '#ffffff', .18); notes.push('Leito da pista clareado para não sumir no escuro.'); }
  if (srmapContrast(bed, gnd) < 1.3) { gnd = srmapLum(bed) > .2 ? srmapMix(gnd, '#000000', .4) : srmapMix(gnd, '#ffffff', .4); notes.push('Chão ajustado para a pista se destacar.'); }
  if (srmapContrast(rail, bed) < 3) { rail = srmapContrast('#ffffff', bed) >= srmapContrast('#101428', bed) ? '#ffffff' : '#101428'; notes.push('Trilho ajustado para ficar visível.'); }
  const bld = (Array.isArray(r.bld) ? r.bld : []).slice(0, 4).map(c => srmapHex(c, null)).filter(Boolean);
  const deco = SRMAP_DECO.includes(r.deco) ? r.deco : 'city';
  const deco2 = SRMAP_DECO.includes(r.deco2) ? r.deco2 : '';
  const veh = SRMAP_VEH.includes(r.veh) ? r.veh : '';
  const layout = srmapLayout(r.layout, notes);
  const map = { name, n: '🤖 ' + name, ai: true, desc: srmapText(r.description || r.desc, 160), sky, orb, gnd, bed, rail, bld, deco, hill: srmapMix(gnd, sky[2], .35), win: srmapHex(r.win, '#fff1c8'), bed2: srmapHex(r.bed2, bed), win2: srmapHex(r.win2, '#dfefff'), layout };
  if (deco2) map.deco2 = deco2;
  if (veh) map.veh = veh;
  SRMAP_FLAGS.forEach(f => { if (r[f] === true) map[f] = true; });
  if (!map.bld.length && (map.deco === 'city' || map.deco2 === 'city')) map.bld = [srmapMix(gnd, '#ffffff', .25), srmapMix(sky[0], '#808080', .5), srmapMix(rail, '#202040', .5), srmapMix(sky[1], '#9090b0', .5)];
  while (map.bld.length && map.bld.length < 4) map.bld.push(map.bld[map.bld.length % Math.max(1, map.bld.length)]);
  map.notes = notes;
  return map;
}

function proceduralHash(seed) {
  const str = String(seed || 'procedural-map');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function proceduralPalette(seed, previous = null) {
  const themes = [
    { sky: ['#070921', '#18134c', '#56266d'], orb: '#ff4fc8', gnd: '#17172f', bed: '#292747', rail: '#4ff0d8', deco: 'city', deco2: 'cactus', veh: 'buggy', cyber: true, rain: true },
    { sky: ['#f7a94a', '#ffd89a', '#fff0c8'], orb: '#fff6c8', gnd: '#c99a5b', bed: '#8a6a4a', rail: '#ffe27a', deco: 'cactus', deco2: 'rock', veh: 'bus', earth: true },
    { sky: ['#7fb8e8', '#c9e6f8', '#f0f8ff'], orb: '#ffffff', gnd: '#9fb6cc', bed: '#c4d6e6', rail: '#2f7bff', deco: 'pine', deco2: 'house', veh: 'sled', snow: true },
    { sky: ['#526a83', '#b3c5d6', '#ffd6ac'], orb: '#fff0c2', gnd: '#717c76', bed: '#39434d', rail: '#ffe27a', deco: 'city', deco2: 'house', veh: 'metro', rain: true },
    { sky: ['#062a1e', '#114d41', '#2e8f78'], orb: '#f0ffb2', gnd: '#23543d', bed: '#17382b', rail: '#d9f0ad', deco: 'palm', deco2: 'rock', veh: 'wagon', nocl: true },
    { sky: ['#1d1830', '#2d254d', '#5a427d'], orb: '#f6d973', gnd: '#352c53', bed: '#4e3d62', rail: '#f3d2ff', deco: 'voxtree', deco2: 'city', veh: 'ghost', stars: true }
  ];
  const index = proceduralHash(seed) % themes.length;
  const base = themes[index];
  if (previous && previous.deco === base.deco && previous.veh === base.veh) {
    return themes[(index + 1) % themes.length];
  }
  return base;
}

function proceduralRow(seed, rowIndex, palette, difficulty) {
  const p = proceduralHash(`${seed}:${rowIndex}`);
  const laneCount = 3;
  const row = ['', '', ''];
  const obstaclePool = ['barrier', 'bar', 'wall', 'train1', 'train2', 'train3'];

  for (let lane = 0; lane < laneCount; lane++) {
    const r = (p + lane * 97 + rowIndex * 131) % 100;
    if (r < 28) {
      row[lane] = 'coin';
    } else if (r < 48) {
      row[lane] = obstaclePool[(p + lane + rowIndex) % obstaclePool.length];
    } else if (r < 52 && palette.veh) {
      row[lane] = 'veh';
    } else {
      row[lane] = '';
    }
  }

  const openAt = (p + rowIndex) % 3;
  row[openAt] = '';
  if (rowIndex < 6) {
    row[0] = row[1] = row[2] = '';
  }
  if (difficulty > 0.7 && rowIndex % 3 === 1 && palette.veh) {
    row[(p + 1) % 3] = 'veh';
  }

  return row;
}

function buildProceduralLayout(seed, previousLayout = []) {
  const rows = [];
  const palette = proceduralPalette(seed, previousLayout && previousLayout[0] ? { deco: previousLayout[0].deco, veh: previousLayout[0].veh } : null);
  const difficultyBase = proceduralHash(seed) / 4294967295;

  for (let i = 0; i < 36; i++) {
    const row = proceduralRow(seed, i, palette, difficultyBase);
    rows.push(row);
  }

  let reach = [true, true, true];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (let lane = 0; lane < 3; lane++) {
      if (row[lane] === 'veh') {
        for (let offset = 1; offset <= 2; offset++) {
          const next = rows[i + offset];
          if (next && next[lane] && next[lane] !== 'veh') next[lane] = '';
        }
      }
    }
    const pass = lane => !row[lane] || row[lane] === 'coin';
    const can = lane => pass(lane) && reach.some((ok, p) => ok && Math.abs(p - lane) <= 1);
    if (![0, 1, 2].some(can)) {
      const from = reach.map((ok, p) => ok ? p : -9).filter(p => p >= 0);
      let best = 1, bestDist = 9;
      for (let lane = 0; lane < 3; lane++) {
        const d = Math.min(...from.map(p => Math.abs(p - lane)));
        if (d <= 1 && d < bestDist) { bestDist = d; best = lane; }
      }
      row[best] = '';
    }
    reach = [0, 1, 2].map(can);
  }
  return { layout: rows, palette };
}

function generateInfiniteProceduralMap(seed, previousMap = null) {
  const normalizedSeed = String(seed || previousMap && previousMap.seed || 'procedural-map');
  const palette = proceduralPalette(normalizedSeed, previousMap && previousMap);
  const { layout } = buildProceduralLayout(normalizedSeed, previousMap && previousMap.layout ? previousMap.layout : []);
  const description = `${palette.rain ? 'chuva' : palette.snow ? 'neve' : palette.stars ? 'céu limpo' : 'trilha vibrante'} com visual procedural e ritmo contínuo.`;
  const raw = {
    name: 'Procedural ' + (proceduralHash(normalizedSeed) % 900 + 100),
    description,
    sky: palette.sky,
    orb: palette.orb,
    gnd: palette.gnd,
    bed: palette.bed,
    rail: palette.rail,
    bld: ['#4b5563', '#6b7280', '#3b4252', '#2d3748'],
    deco: palette.deco,
    deco2: palette.deco2,
    veh: palette.veh,
    win: '#fff1c8',
    layout,
    rain: !!palette.rain,
    snow: !!palette.snow,
    stars: !!palette.stars,
    nocl: !!palette.nocl,
    cyber: !!palette.cyber,
    vox: !!palette.vox,
    earth: !!palette.earth,
    ignoredRequests: []
  };
  return srmapSanitize(raw);
}

function proceduralFallbackFromPrompt(prompt, currentMap) {
  const seed = `prompt:${String(prompt || '').slice(0, 120)}:${Date.now()}`;
  return generateInfiniteProceduralMap(seed, currentMap || null);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Use POST para gerar um mapa.' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'O corpo da solicitação precisa ser JSON válido.' }, 400); }

  const prompt = String(body && body.prompt || '').trim();
  if (prompt.length < 12 || prompt.length > 1600) return json({ error: 'A descrição deve ter entre 12 e 1600 caracteres.' }, 400);

  const currentMap = body && body.currentMap && typeof body.currentMap === 'object' ? srmapSanitize(body.currentMap) : null;
  const attachments = Array.isArray(body && body.attachments) ? body.attachments.slice(0, 8).map(a => ({ name: srmapText(a && a.name || 'arquivo', 120), content: String(a && a.content || '').slice(0, 3000) })) : [];

  const key = env && env.GROQ_API_KEY;
  if (!key) {
    const fallback = proceduralFallbackFromPrompt(prompt, currentMap);
    return json({ map: fallback, ignoredRequests: [], creditsRemaining: null, warning: 'API de IA indisponível. Mapa procedural gerado localmente em modo fallback.' }, 200);
  }

  const messages = [{ role: 'system', content: NO_STORY_PROMPT }];
  if (currentMap) {
    const { notes, hill, ai, n, desc, ...spec } = currentMap;
    spec.layout = (spec.layout || []).map(r => r.c || r);
    messages.push({ role: 'user', content: `MAPA ATUAL (base para variação procedural; sem história): ${JSON.stringify({ ...spec, desc: spec.desc || '' })}` });
  }
  messages.push({ role: 'user', content: `Pedido do jogador (sem história): ${prompt}${attachments.length ? '\n\nARQUIVOS DE REFERÊNCIA (só inspiração visual, não narrativas): ' + JSON.stringify(attachments) : ''}` });

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-20b', temperature: 0.85, max_tokens: 4500, response_format: { type: 'json_object' }, messages })
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = result && result.error && result.error.message ? result.error.message : `A Groq respondeu HTTP ${upstream.status}.`;
      const fallback = proceduralFallbackFromPrompt(prompt, currentMap);
      return json({ map: fallback, ignoredRequests: ['IA indisponível'], error: message, providerStatus: upstream.status }, 200);
    }

    const content = result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
    if (typeof content !== 'string') {
      const fallback = proceduralFallbackFromPrompt(prompt, currentMap);
      return json({ map: fallback, ignoredRequests: ['Resposta da IA vazia'], warning: 'Mapa procedural fallback ativado.' }, 200);
    }

    let raw;
    try { raw = JSON.parse(content); } catch {
      const fallback = proceduralFallbackFromPrompt(prompt, currentMap);
      return json({ map: fallback, ignoredRequests: ['JSON inválido da IA'], warning: 'Resposta inválida; fallback procedural usado.' }, 200);
    }

    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sky) || raw.sky.length < 3) {
      const fallback = proceduralFallbackFromPrompt(prompt, currentMap);
      return json({ map: fallback, ignoredRequests: ['Formato inválido da IA'], warning: 'Formato inválido; fallback procedural usado.' }, 200);
    }

    const map = srmapSanitize(raw);
    const ignored = (Array.isArray(raw.ignoredRequests) ? raw.ignoredRequests : []).slice(0, 6).map(t => srmapText(t, 120)).filter(Boolean);
    return json({ map, ignoredRequests: ignored, creditsRemaining: null, warning: 'Mapas gerados sem narrativa e com variação procedural.' });
  } catch (_) {
    const fallback = proceduralFallbackFromPrompt(prompt, currentMap);
    return json({ map: fallback, ignoredRequests: ['Erro de conexão'], warning: 'Conexão com IA falhou; mapa procedural em fallback.' }, 200);
  }
}
