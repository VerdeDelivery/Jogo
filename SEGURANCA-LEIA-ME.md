# SEGURANÇA ANTI-CHEAT — Subway Run

## O que o cheat fazia (o script do Tampermonkey)
1. Baixava o `app.js`, **reescrevia o texto** (regex em `stumble`, `draw`…) e rodava de novo como `blob:`.
2. Trocava `performance.now` e `requestAnimationFrame` → **Speed até 1000x**.
3. Mexia em `LC` (velocidade, moedas), `pl` (voar, noclip) e removia trens.

## Camadas novas (da mais forte para a mais fraca)

| # | Camada | Arquivo | O que bloqueia |
|---|--------|---------|----------------|
| 1 | **Tempo do ranking limitado pelo relógio do SERVIDOR** | `firestore.rules` + `firebase-dual.js` | Speed-hack: o tempo gravado nunca pode ser maior que o tempo real desde o início da corrida (+5 s). Também fecha: `wkt`/`wk` inventados, `players` gravável pelo cliente, pontos acima de 100 mi. |
| 2 | **CSP** (bloqueia `<script>` blob/inline/estranho) | `index.html`, `edgeone.json` | A injeção do cheat (`blob:`) deixa de executar. Testado em Chromium. |
| 3 | **Relógio blindado** | `shield.js` | Troca `performance.now`/`rAF` por relógio nativo (`Event.timeStamp`) e **trava** (não dá para sobrescrever). Testado: com 1000x o jogo andou em 1x. |
| 4 | **Detecção + bloqueio da corrida** | `shield.js` | `__MOD__`, `GM_*`, menus flutuantes, `<script blob:>`, funções nativas trocadas, relógio fora de compasso, `app.js` reescrito (tripwires), velocidade/multiplicador de moeda impossíveis. Passou do limite → a corrida **não vale** para o ranking. |
| 5 | **Relatórios** | coleção `flags/{uid}` | Cada tentativa fica registrada (códigos, navegador, contagem, data). Só você (admin) lê. |

## Banimento automático (novo)
Quando o shield vê uma **assinatura inequívoca** de cheat (ex.: `__MOD__`, menu do script, `<script blob:>`, `app.js` reescrito):
- o site daquele aparelho vira uma tela **"DISPOSITIVO BANIDO"** (o jogo é removido e o aviso volta se apagarem);
- o banimento fica salvo no aparelho (localStorage + cookie + IndexedDB): ao recarregar, o jogo **nem inicia**;
- a conta logada é banida no servidor (`bans/{uid}`, `auto:true`). Só o admin desfaz: apague o documento em `bans`.
Sinais fracos (ex.: extensão de privacidade mexendo em relógio) **não banem**: só bloqueiam o ranking, para evitar banir inocente.
Limites: o aparelho pode ser "limpo" (limpar dados do site/outro navegador); aí vale o ban da conta e o `flags`.

## v2 — Ban na hora, anti-inspeção, anti-clone (novo)
- **Sem recarregar:** varredura a cada 0,4 s + eventos. Ao detectar, aparece "DISPOSITIVO BANIDO" e o jogo congela na hora.
- **Inspeção (PC):** DevTools aberto (teste com `debugger`), F12, Ctrl+Shift+I/J/C/K, Ctrl+U (ver código), Ctrl+S, Cmd+Opt+I/J/U. Clique direito é bloqueado. A 1ª tentativa de atalho só avisa; a 2ª bane (`SHORTCUT_STRIKES` no topo do `shield.js`; ponha 1 para banir na primeira).
- **Impressão digital do aparelho:** o ban é gravado em `deviceBans/{impressão}`. Trocar de conta, limpar dados ou **usar VPN não adianta** (o ban segue o aparelho, não o IP). Para desbanir: apague o documento em `deviceBans` e o da conta em `bans` (procure pelo "Código" que aparece na tela do jogador, campo `code`).
- **Anti-clone / golpe:** o jogo só roda em `ALLOWED_HOSTS` (topo do `shield.js`). Em site copiado aparece "SITE NÃO OFICIAL". **Edite essa lista com todos os seus domínios**, senão o jogo trava neles.
- **Chave do dono:** abra UMA vez `https://SEU-SITE/#dono=SUA_CHAVE` no seu aparelho. Daí em diante você usa F12/inspecionar sem ser banido. Guarde a chave em segredo (o zip só tem o hash dela).
- **Cache:** `shield.js` agora é `?v=2` e `app.js` `?v=14`. Sempre que alterar um arquivo, aumente o número, senão celulares/CDN usam a versão velha.
- **VPN:** o navegador não consegue saber se alguém usa VPN (e banir todo mundo que usa VPN pegaria muito inocente). O que funciona é banir o aparelho.
- **Ver código-fonte:** impossível impedir de verdade (o navegador precisa baixar o código para rodar). O que fazemos é bloquear os atalhos, banir quem abre o DevTools e tornar o código inútil para clonar (domínio travado + servidor validando).
- **Recomendado depois:** Firebase **App Check** (reCAPTCHA) para o servidor recusar sites/robôs clonados.

## Como publicar (nessa ordem)
1. **Firestore → Regras:** cole o `firestore.rules` e publique.
2. Suba TODOS os arquivos do jogo (novos: `shield.js`, `boot.js`, `edgeone.json`; alterados: `index.html`, `app.js`, `firebase-dual.js`) e depois force atualizar no celular (limpar cache do site).
3. Teste: crie uma conta, jogue uma corrida com tempo > 1 s e veja se o ranking salva. Depois olhe no Firestore se apareceu `runs/{uid}`.
4. Cheats detectados aparecem em **Firestore → `flags`**. Para punir, crie `bans/{uid}` (como já faz hoje).

## Atenção
- **Migração de contas antigas:** em `firestore.rules`, `legacyOpen()` está `false` (seguro). Se precisar puxar recordes do jogo antigo, troque para `true`, deixe os jogadores entrarem e **volte para `false`**.
- **Falso positivo:** extensões de privacidade que mexem em relógio (ex.: JShelter) podem acusar suspeita. O limite é 3 pontos; sinais fracos valem 1–2.
- **Moedas/carteira:** o saldo fica no aparelho (`LocalDB`), então ainda dá para editar localmente. Isso só fecha de verdade movendo a carteira para o servidor (posso fazer na próxima).
- **Noclip / tirar trens em velocidade normal:** o servidor não consegue enxergar. Quem pega essa via é o shield (detecta o script/injeção) — e o `flags` mostra quem tentou.

## Limite honesto
Nada no navegador é 100% à prova de cheat: quem controla o navegador pode tentar adaptar o script. O que fizemos foi (a) tornar o ganho **inútil no servidor** e (b) deixar o cheat **muito mais caro** de manter e **rastreável**. Quando o cheater atualizar o script, você vê os códigos novos em `flags` e eu ajusto.
