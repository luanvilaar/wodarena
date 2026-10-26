# Comprovante de inscrição único (proposta 1B aprovada)

Diagnóstico e desenho aprovados pelo usuário em 2026-10-26: **proposta 1B, "Pôster tipográfico"**. Referência das Stories 1.73 a 1.76.

- **Artefato publicado:** https://claude.ai/artifact/MMfNLXZp2mqJ7aNjLEF7wY (privado).
- **Cópia no repo:** [comprovante-aprovado.html](comprovante-aprovado.html). O desenho aprovado é a seção "1B · Pôster tipográfico" (em "Variações do pôster de atleta") com a anatomia comum em "Base da solução". As propostas 1, 1A, 1C, 2 e 3 ficaram de fora.

## O problema

Pix e inscrição gratuita abriam dois comprovantes empilhados (o ticket de `RegisterModal` por baixo e o `RegistrationVoucher` por cima, no mesmo evento de sucesso) e dois e-mails (um do servidor, ao aprovar; outro do navegador, em `/api/checkout/email`). Os dois e-mails tinham conteúdo diferente (um sem CPF, outro com).

## Decisões

1. **Um componente, frente e verso.** A frente é o pôster 1B (imagem para os Stories); o verso é o registro completo. O mesmo `RegistrationVoucher` serve o sucesso da inscrição (aberto pelo próprio `RegisterModal`, em qualquer tela), o painel do gestor e a área do atleta.
2. **Dados só do servidor.** Frente, verso e e-mail leem a inscrição gravada. O retorno do cartão confirma o status em `/api/checkout/status` antes de abrir o comprovante.
3. **Um e-mail por inscrição, enviado só pelo servidor.** Chave `Idempotency-Key` do Resend = `registration-confirmed/{id}`. A segunda via do painel continua enviando a cada pedido, sem chave. Inscrição gratuita passa a ser enviada por `/api/registrations/start`.
4. **O CPF sai do comprovante e do e-mail.** O servidor nunca guardou o CPF, então a versão com CPF só existia no e-mail disparado pelo navegador. Tudo fica igual e com menos dado pessoal.
5. **Imagem no e-mail como anexo embutido** (`content_id`), não como link. Se a imagem falhar, o e-mail sai com o cabeçalho de texto.
6. **Fonte do pôster:** Anton (títulos) e Inter (rótulos), em `src/assets/fonts/`, lidas do disco pela rota da imagem e pelo e-mail. Só existem na imagem; app e e-mail seguem em Inter e IBM Plex Sans.
7. **Logo do evento no pôster** só é buscado no armazenamento do próprio Supabase e em PNG ou JPEG; qualquer outro caso mostra as iniciais do evento.
8. **Pagamento pendente, em análise, falho ou cancelado não tem frente:** só o verso ("Registro de inscrição") e o e-mail "Inscrição registrada", como antes.
9. **QR Code de check-in fica de fora.** Os Termos citam um QR que não existe no código; o código de barras decorativo do ticket antigo saiu.
