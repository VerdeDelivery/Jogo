# Update 10
## Menu estilo Subway Surfers
Novo menu principal (`homeHTML` em app.js + bloco "UPDATE 10" no fim do style.css). Personagem grande animado com o mesmo `drawChar`; atalhos mantêm os mesmos ids (bShop, bRank, bMulti, bCfg, bMus, bLive, bPart, bDonate, bPoll, bFs).
## Câmera de perseguição com colisão
`camSolve()`: câmera com altura real (`camH`, usada em `P()`), sobe em trem/rampa, é empurrada para o lado livre ou sobe quando um sólido passa pela posição dela (`CAMBASE`, `CAMZC`).
## Física / tamanho
TH 110→150, pulo ~125 (`JV` 850, `GRAV` 2900), muro 140→105, rampa 320→440, rolar 0,66 s, troca de pista mais rápida, queda rápida ao rolar no ar, personagem +13% (`PU`).
## Mapas
`fill()`: aderços extras por tema (linhas 2 e 3 do cenário). Ajuste a densidade em `FILL_SETS` e na lista `[0,1,2,3]` do drawWorld.
## Não testado
Mapas 3–16 e 18–19, multiplayer, tela de fim de jogo em aparelho real.

## Correção
O HUD (timer, FPS, telão, moedas, pausa) só fica oculto no menu inicial; durante a corrida aparece normalmente e continua obedecendo as configurações. A regra de moeda / desafio 'sem moeda' não foi alterada.

## Rosto, danças, guarda (Update 10b)
- **Rosto automático** em `drawChar` (app.js e charrender.js): olhos, sobrancelhas, nariz, boca e bochechas. TODA skin nova já nasce com rosto. Personalizar: `ch.face = { eye, eyeY, eyeGap }`; desligar: `ch.noFace = true` (capacete `helmet`, `dona` e `neto` já têm o seu).
- **Danças/emojis**: `danceOpts()` + `charAnimLoop()`. Cada personagem recebe uma dança automática pelo nome (wave, disco, floss, hop, robot, flex) e troca de expressão (sorriso, boca aberta, piscadinha, língua, surpresa, olhos felizes). Fixar uma: `ch.dance = 'disco'`. Aparece no menu principal e na tela de skins.
- Novos parâmetros do `drawChar`: `ar`, `lg` (ângulos dos braços/pernas), `lean` (inclinação do tronco), `bobAdd`, `emote`, `blink`, `look`.
- **Menu**: removi a notícia "OLHA SÓ ISSO!" (era do jogo da imagem). Perfil mostra a foto/avatar da conta; sem conta, mostra o rosto do personagem escolhido. Enquete virou um botão normal.
- **Guarda por tema de mapa** (`GUARD_SETS`/`guardFor`): policial, guarda-florestal, xerife, salva-vidas, parca de neve, guarda zumbi, anjo, operário, mergulhador, astronauta, bombeiro, cavaleiro e ninja. O cachorro usa colete/chapéu do mesmo tema.
- **Animação solta**: guarda com tronco inclinado, braços balançando e um braço esticado tentando agarrar; cachorro galopando com orelhas ao vento, rabo e língua.
