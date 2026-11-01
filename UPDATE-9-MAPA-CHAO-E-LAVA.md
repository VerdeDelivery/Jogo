# Update 9 — Novo mapa: O Chão é Lava 🌋

Mapa 21 do seletor (aparece depois de "Neon Samurai"; use ‹ no menu para chegar rápido).

## Como funciona
- O chão da pista é magma. Só é seguro: estar no ar, em cima de uma **pedra de basalto**, ou em cima de muros/blocos.
- Encostou na lava = morte instantânea.
- As pedras são geradas em sequência com buracos proporcionais à velocidade (sempre dá para atravessar com um pulo). Lanes vizinhas têm pedras menores, pilares (altos) e blocos de obsidiana; às vezes um arco de magma (rolar ou pular).
- Você começa em uma pedra larga nas 3 pistas. Moedas ficam na pedra principal.
- Mensagem de fim: "QUEIMADO NA LAVA!".

## Visual
Lava animada (crosta, rachaduras, bolhas), vulcões com cratera no horizonte, brasas subindo, pedras com brilho de magma, cutscene própria.

## Código (app.js)
`MAPS[20]` com `lava:true`; `spawnLava()`, objeto `rock`, `lavaHeat` no `step()`, `drawLavaFloor/drawRock/drawEmbers/drawHeat`. Os outros 20 mapas não foram alterados.

## Revisão
- Textura da lava refeita: correntes onduladas, placas de crosta com borda incandescente, veios quase brancos, bolhas com respingo e ar tremendo de calor.
- Mais estruturas: pedras laterais maiores, pilares altos (com moeda no topo), blocos de obsidiana e pedrinhas soltas sobre os buracos (rotas alternativas).
- Moedas em zigue-zague entre as pistas, com espaçamento maior (260–340), mais arcos de moedas sobre os buracos que exigem pulo.
