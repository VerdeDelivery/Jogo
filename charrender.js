// Desenho 3D do personagem (cópia do app.js) — usado pela prévia de skins do painel administrativo.
let backpackImage = null, wristImage = null;
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
    } else {
      // Prop genérico para objetos personalizados definidos pela IA: volume de base e detalhes.
      const name = String(k).toLowerCase();
      const gold = /troféu|trofeu|taça|taca|ouro|gold/.test(name);
      const metal = gold ? '#f5c542' : '#b8c4d8';
      B(x, 57, 3, 9, 15, 8, metal, pv, rx);
      B(x, 64, 3, 5, 4, 5, gold ? '#fff0a6' : '#e7edf7', pv, rx);
      B(x, 50, 3, 13, 3, 11, gold ? '#d69b19' : '#7b8798', pv, rx);
      B(x, 55, 3, 3, 9, 3, metal, pv, rx);
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
    const gn = GN(n); if (gn[2] > -.02) continue; // de costas para a câmera
    const pts = f.v.map(sg => {
      let p = [pt.c[0] + sg[0] * pt.s[0] / 2, pt.c[1] + sg[1] * pt.s[1] / 2, pt.c[2] + sg[2] * pt.s[2] / 2];
      if (pt.pv) { const r = rot3([p[0] - pt.pv[0], p[1] - pt.pv[1], p[2] - pt.pv[2]], pt.rx, 0, 0); p = [r[0] + pt.pv[0], r[1] + pt.pv[1], r[2] + pt.pv[2]]; }
      return G(p);
    });
    const lt = Math.max(0, gn[0] * -.4 + gn[1] * .8 + gn[2] * -.45); // luz vinda de cima, da esquerda e da frente da câmera
    faces.push({ pts, k: .55 + .65 * lt, col: pt.col, z: (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4 });
  }
  faces.sort((a1, b1) => b1.z - a1.z); // mais longe primeiro
  c.lineJoin = 'round'; c.lineWidth = Math.max(.8, 1.5 * u); c.strokeStyle = INK;
  for (const f of faces) {
    c.fillStyle = shade(f.col, f.k); c.strokeStyle = shade(f.col, f.k * .78); c.lineWidth = 1; c.beginPath();
    f.pts.forEach((p, i) => { const k = 1 / (1 + p[2] * .0035), px = x + p[0] * u * k, py = y0 - p[1] * u * k; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.closePath(); c.fill(); c.stroke();
  }
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
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const c = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; }
export { drawChar, shade };
