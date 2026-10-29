# Atualização 13 — moedas, movimento e personagens

- A sequência especial que distribui moedas pelos três trilhos agora usa três moedas por trilho, espaçadas a 180 unidades, em vez de quatro.
- O movimento lateral usa interpolação exponencial suave e continua respondendo aos comandos sem remover as animações.
- O personagem principal, o guarda e o cachorro foram ajustados para ficar de frente para a câmera; os outros corredores do multijogador também usam orientação frontal.
- A moeda padrão agora é desenhada como uma peça circular dourada com aro, brilho e letra central, com rotação mais lenta e sem o desenho quadrado anterior. A imagem de moeda personalizada continua sendo respeitada quando configurada.
- A versão do cliente foi incrementada para 13.0.0.

## Validação

`app.js` passou na verificação de sintaxe do Node.js. A aparência e a jogabilidade ainda devem ser verificadas no navegador/dispositivo antes da publicação.
