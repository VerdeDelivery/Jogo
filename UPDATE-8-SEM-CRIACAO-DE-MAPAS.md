# Update 8 — Criação de mapas removida

- Removido o Estúdio de Mapas por completo (IA, Editor manual, Meus mapas e importação por código).
- Removido o botão "CRIAR MAPAS" do menu.
- Mapas criados pelos jogadores deixam de existir: o jogo não carrega mais nada salvo e apaga do aparelho a chave `sr_ai_maps_v1` e os créditos antigos da IA.
- Sobram apenas os 20 mapas originais do jogo.
- Removidos: `functions/api/maps/generate.js`, a rota `POST /api/maps/generate` do `server.js`, código de validação/desenho de mapas de jogadores no `app.js` e o CSS do Estúdio.
- A variável `GROQ_API_KEY` não é mais usada e pode ser apagada do EdgeOne.
