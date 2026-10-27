SUBWAY RUN — SKIN LAB / BANCO EXCLUSIVO DE SKINS
================================================

O que esta versão adiciona
- Mantém o modelo blocado atual do personagem e as proporções existentes.
- Adiciona texturas de camisa (frente/costas), calça, decal de acessório/cabeça e mochila.
- O painel administrativo tem a seção “Skin Lab — texturas e acessórios”.
- As imagens ficam hospedadas no seu site/host externo; o painel salva somente URLs HTTPS no Firestore. Firebase Storage não é usado.
- Metadados individuais e cores da skin são salvos na coleção Firestore `skins`; o catálogo compacto `catalog/skins` é atualizado para que cada jogador leia só um documento.
- O jogo lê um único documento `catalog/skins` (uma leitura do catálogo por atualização), que contém metadados e URLs das skins publicadas, e mantém cache local por até 10 minutos.
- Formato de exportação atual continua usando o JSON de cores existente; as texturas são URLs HTTPS diretas fornecidas por você.

CONFIGURAÇÃO OBRIGATÓRIA NO PROJETO skin-4f7da
1. Firebase Console > Authentication > Sign-in method: habilite E-mail/senha.
2. Authentication > Users: crie os usuários administradores com os e-mails:
   - capamineiro@gmail.com
   - mgfpsmiguel@gmail.com
   Use a senha de administrador que será digitada na seção Skin Lab do painel.
   O usuário precisa existir neste projeto separado; autenticação do Banco 1 não autentica automaticamente no projeto de skins.
3. Firestore Database: crie o banco de dados (se ainda não existir).
4. Firestore > Regras: publique o conteúdo de `firestore-skins.rules` NESTE projeto skin-4f7da.
5. Não habilite Firebase Storage para este fluxo. Basta publicar as regras de Firestore em `firestore-skins.rules`.
6. No painel admin, abra Skins > Skin Lab, digite a senha da conta admin do projeto skin-4f7da e clique “Conectar banco de skins”.
7. Cole um JSON válido no criador existente, informe nome e preço, escolha texturas PNG/JPG/WebP (máximo 2 MB por arquivo) e clique “Salvar e publicar no banco novo”.
8. Recarregue o jogo para testar. O jogo usa cache por até 10 minutos; reabrir/atualizar o jogo força uma nova sessão e pode buscar a versão publicada. A leitura do catálogo custa uma leitura de documento por atualização do cache, não uma leitura por skin.

IMPORTANTE SOBRE AS REGRAS
- As regras anexadas são APENAS para o novo projeto skin-4f7da. Não substitua as regras do banco principal de contas/ranking por estas regras.
- As regras permitem leitura pública somente de skins com status `published`. Apenas os dois e-mails listados podem publicar/editar/apagar skins.
- Se os e-mails administradores forem outros, altere-os nas duas regras antes de publicar.
- Não coloque service-account JSON nem chaves privadas no frontend.
- A configuração Firebase web e a apiKey são identificadores públicos do cliente; a segurança é aplicada por Authentication e Rules.
- Use imagens públicas. O host precisa permitir acesso HTTPS e CORS para o jogo desenhar a imagem no personagem.
- As regras não criam o banco nem habilitam Authentication automaticamente; isso precisa ser feito no Console. Storage não é necessário nesta versão.

LIMITAÇÕES DA TEXTURA NESTA VERSÃO
- O personagem mantém a geometria blocada atual.
- Camisa e calça são imagens projetadas sobre as faces frontais/traseiras; mochila e decal de cabeça também aceitam imagem. O formato é uma textura simples por peça, não um editor UV completo com costuras independentes para cada face.
- “Acessório” nesta primeira integração é um decal visual na área da cabeça, não uma nova peça 3D arbitrária. Para acessórios 3D modelados (óculos/orelhas/mochila com geometria própria), será necessária uma extensão adicional do renderizador.
- O banco novo é a fonte das skins novas; o catálogo antigo do painel continua disponível para compatibilidade.
- Testes com Firebase real não foram executados neste ambiente. Faça primeiro uma skin de teste grátis e confirme que ela aparece no jogo antes de publicar muitas skins.
