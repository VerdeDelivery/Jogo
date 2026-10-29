/* Runtime resiliente Subway Run: detecção de dispositivo, perfil e ajuste adaptativo de renderização. */
(() => {
  'use strict';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  let country = '🌐';
  try {
    const locale = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    const m = locale.match(/-([A-Z]{2})(?:-|$)/i);
    const code = m ? m[1].toUpperCase() : '';
    if (code && /^[A-Z]{2}$/.test(code)) country = [...code].map(c => String.fromCodePoint(127397+c.charCodeAt(0))).join('');
  } catch (_) {}
  // Não tenta obter localização nem enviar telemetria. País é apenas uma estimativa pelo idioma do navegador.
  const profile = Object.freeze({ device: mobile ? 'mobile' : 'pc', icon: mobile ? '📱' : '🖥️', countryFlag: country });
  window.SRClientProfile = profile;

  let scale = 1, slowFrames = 0, goodFrames = 0, last = performance.now(), frames = 0, fps = 60;
  let changed = false;
  function sample(now) {
    frames++;
    const elapsed = now - last;
    if (elapsed >= 1000) {
      fps = frames * 1000 / elapsed; frames = 0; last = now;
      if (fps < 24) { slowFrames++; goodFrames = 0; }
      else if (fps > 43) { goodFrames++; slowFrames = 0; }
      else { slowFrames = Math.max(0, slowFrames - 1); goodFrames = 0; }
      // Reduz o custo visual gradualmente; não altera velocidade, física ou regras do jogo.
      if (slowFrames >= 2 && scale > 0.55) { scale = Math.max(0.55, scale - 0.15); slowFrames = 0; changed = true; }
      if (goodFrames >= 8 && scale < 1) { scale = Math.min(1, scale + 0.05); goodFrames = 0; changed = true; }
      if (changed) {
        document.documentElement.dataset.performance = scale < .7 ? 'economy' : scale < .95 ? 'balanced' : 'full';
        window.dispatchEvent(new CustomEvent('sr:qualitychange', { detail: { scale, fps: Math.round(fps) } }));
        changed = false;
      }
    }
    requestAnimationFrame(sample);
  }
  window.SRAdaptive = Object.freeze({ profile, getScale: () => scale, getFPS: () => Math.round(fps) });
  requestAnimationFrame(sample);

  // Verificação de versão somente ao entrar/reabrir a página. Nunca recarrega durante uma corrida.
  const VERSION = '12.0.0';
  try {
    const key = 'sr_deployed_version', guard = 'sr_version_reload_guard';
    const prior = localStorage.getItem(key);
    if (prior && prior !== VERSION && sessionStorage.getItem(guard) !== VERSION) {
      sessionStorage.setItem(guard, VERSION);
      localStorage.setItem(key, VERSION);
      const u = new URL(location.href); u.searchParams.set('build', VERSION);
      location.replace(u.href);
    } else {
      localStorage.setItem(key, VERSION);
      if (sessionStorage.getItem(guard) === VERSION) sessionStorage.removeItem(guard);
    }
  } catch (_) {}
})();
