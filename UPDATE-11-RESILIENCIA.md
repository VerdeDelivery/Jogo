ATUALIZAÇÃO 12 — CÂMERA, CENÁRIO E COMPATIBILIDADE

- O renderizador suaviza a transição das faces em ângulos rasantes para reduzir o efeito de peças que parecem cortar/sumir abruptamente quando o personagem vira. A aparência precisa ser validada em execução com as skins e ângulos que reproduzem o defeito.
- O gerador desenha mais elementos nas laterais e reduz os intervalos vazios, sem alterar os trilhos nem as regras de colisão. O aumento de objetos pode custar FPS em aparelhos fracos; o ajuste adaptativo de resolução continua ativo.
- O runtime identifica PC/celular localmente. No ranking, os ícones de outras pessoas só aparecem quando o servidor realmente envia `device`/`platform` e `countryFlag`/`flag`; não presume que todos usam o mesmo dispositivo. A bandeira local é uma estimativa do idioma/região do navegador, não uma localização verificada.
- O HTML, CSS e JavaScript receberam identificadores de versão novos para reduzir a chance de cache antigo. As meta tags não substituem cabeçalhos HTTP: configure a hospedagem para revalidar `index.html` e `version.json` a cada entrada.
- A verificação de versão roda ao abrir/reabrir a página, não durante a corrida. Um cliente que ainda executa um runtime antigo não pode receber uma verificação que nunca foi carregada; por isso, o cache da hospedagem precisa ser configurado corretamente.
- O ajuste de FPS reduz a resolução de renderização, não faz overclock real e não garante 60 FPS em todo aparelho.

PUBLICAÇÃO E TESTE
1. Faça backup da versão atual e substitua os arquivos pela pasta `Jogo-main` deste ZIP.
2. Configure o hosting para `index.html` e `version.json` com `Cache-Control: no-cache, must-revalidate`; assets com query de versão podem ter cache longo.
3. Teste em PC e celular, incluindo skins com acessórios, viradas laterais, cenários e aparelhos de baixo desempenho.
4. Para bandeiras e ícones individuais no ranking, atualize também o backend/perfil para persistir e devolver os campos de cada jogador.
