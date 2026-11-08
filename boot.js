/* Carregamento: sobe até 100% e então abre o menu principal do jogo.
   Foto do criador: coloque o arquivo "perfil.jpg" na mesma pasta deste HTML (ou troque o caminho em src acima). */
(function () {
  var boot = document.getElementById('boot'), bar = document.getElementById('bootBar'), pc = document.getElementById('bootPc'), img = document.getElementById('bootImg'), letter = document.getElementById('bootLetter');
  var vid = document.getElementById('bootVideo'), vidDone = !vid, imgDone = false, pageDone = false, fontsDone = false, t0 = performance.now(), MIN = 2300, shown = 0, finished = false;
  var cp = ''; try { cp = localStorage.getItem('sr_creator_photo') || ''; } catch (_) {} if (cp) img.src = cp;
  img.onload = function () { imgDone = true; }; var tried = false; img.onerror = function () { if (!tried) { tried = true; img.src = 'perfil.jpg'; return; } imgDone = true; img.style.display = 'none'; letter.style.display = 'block'; }; // se o link falhar, tenta perfil.jpg e por fim a letra S
  if (img.complete) { if (img.naturalWidth) imgDone = true; else if (img.src) img.onerror(); }
  if (vid) { var vd = function () { vidDone = true; }; vid.addEventListener('loadeddata', vd); vid.addEventListener('error', vd); vid.addEventListener('stalled', vd);
    var pl = vid.play && vid.play(); if (pl && pl.catch) pl.catch(function () {}); } // muted + playsinline: o navegador deixa tocar sozinho
  addEventListener('load', function () { pageDone = true; });
  if (document.readyState === 'complete') pageDone = true;
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { fontsDone = true; }, function () { fontsDone = true; });
  setTimeout(function () { imgDone = pageDone = fontsDone = vidDone = true; }, 7000); // segurança: nunca trava
  function tick() {
    var ready = imgDone && pageDone && fontsDone && vidDone, el = performance.now() - t0;
    var target = Math.min(100, el / MIN * 100); if (!ready) target = Math.min(target, 92);
    shown += (target - shown) * .25; if (target - shown < .4) shown = target;
    var v = Math.floor(shown); bar.style.width = (Math.floor(shown / 5) * 5) + '%'; pc.textContent = v + '%'; // barra anda em blocos de 5% (pixel art)
    if (shown >= 99.9 && ready && !finished) { finished = true; bar.style.width = '100%'; pc.textContent = '100%'; setTimeout(function () { boot.classList.add('out'); setTimeout(function () { boot.remove(); }, 700); }, 300); return; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
