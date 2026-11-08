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

## Como publicar (nessa ordem)
1. **Firestore → Regras:** cole o `firestore.rules` e publique.
2. Suba TODOS os arquivos do jogo (novos: `shield.js`, `boot.js`, `edgeone.json`; alterados: `index.html`, `app.js`, `firebase-dual.js`).
3. Teste: crie uma conta, jogue uma corrida com tempo > 1 s e veja se o ranking salva. Depois olhe no Firestore se apareceu `runs/{uid}`.
4. Cheats detectados aparecem em **Firestore → `flags`**. Para punir, crie `bans/{uid}` (como já faz hoje).

## Atenção
- **Migração de contas antigas:** em `firestore.rules`, `legacyOpen()` está `false` (seguro). Se precisar puxar recordes do jogo antigo, troque para `true`, deixe os jogadores entrarem e **volte para `false`**.
- **Falso positivo:** extensões de privacidade que mexem em relógio (ex.: JShelter) podem acusar suspeita. O limite é 3 pontos; sinais fracos valem 1–2.
- **Moedas/carteira:** o saldo fica no aparelho (`LocalDB`), então ainda dá para editar localmente. Isso só fecha de verdade movendo a carteira para o servidor (posso fazer na próxima).
- **Noclip / tirar trens em velocidade normal:** o servidor não consegue enxergar. Quem pega essa via é o shield (detecta o script/injeção) — e o `flags` mostra quem tentou.

## Limite honesto
Nada no navegador é 100% à prova de cheat: quem controla o navegador pode tentar adaptar o script. O que fizemos foi (a) tornar o ganho **inútil no servidor** e (b) deixar o cheat **muito mais caro** de manter e **rastreável**. Quando o cheater atualizar o script, você vê os códigos novos em `flags` e eu ajusto.
