# CHANGELOG — Subway Run Skin Lab

## Implementado
- Adicionada conexão do painel com o projeto Firebase separado `skin-4f7da`.
- Adicionada seção Skin Lab para upload de texturas de camisa, calça, mochila e decal de acessório/cabeça.
- Upload de imagens para Firebase Storage; metadados da skin na coleção Firestore `skins`.
- O jogo busca documentos com `status == published`, guarda cache local por até 10 minutos e combina as skins do banco novo com o catálogo antigo.
- O renderizador mantém o modelo blocado atual e projeta texturas nas faces do personagem.
- Adicionados arquivos de regras separados para Firestore e Storage e instruções de configuração.

## Segurança/configuração
- As regras de `firestore-skins.rules` e `storage-skins.rules` são para o projeto `skin-4f7da`, não para o banco principal.
- O administrador precisa existir em Authentication do projeto de skins, com e-mail/senha habilitados.
- As imagens publicadas ficam publicamente legíveis para o jogo; escrita é restrita aos e-mails administrativos permitidos.

## Limitações conhecidas
- Camisa/calça usam projeção simples sobre as faces do modelo, não um editor UV completo de cada lado/costura.
- O campo de acessório aceita decal na área da cabeça; novos modelos 3D de acessórios ainda exigem código de geometria.
- O teste de ponta a ponta com o Firebase real depende de publicar as regras e configurar o usuário administrador no Console.


## Versão URL externa (sem Firebase Storage)
- O painel aceita links HTTPS diretos para camisa, calça, acessório e mochila.
- Publicação salva apenas metadados e URLs no Firestore do projeto `skin-4f7da`.
- O jogo aceita URLs HTTPS externas para texturas; use host público com CORS habilitado.
- Não é necessário ativar Firebase Storage nem cadastrar cartão para hospedar as imagens no Firebase.
