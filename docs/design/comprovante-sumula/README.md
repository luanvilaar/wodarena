# Comprovante de envio da súmula digital: decisões aprovadas

Plano aprovado pelo usuário em 2026-11-17, com as decisões D1 a D8 como recomendadas ("sim em todas"). A maquete é [comprovante-sumula-aprovado.html](comprovante-sumula-aprovado.html), a cópia da página como foi aprovada (o que existe hoje, as quatro telas com os seis estados, regras, plano, riscos e decisões). As Stories 1.144 a 1.146 citam esta pasta nos critérios de aceite.

O visual segue o verso do comprovante de inscrição (`RegistrationVoucher`, [docs/design/comprovante/](../comprovante/)) e, na Quadra, o tema claro de alto contraste. Vale só para súmulas de eventos de Functional Fitness presenciais.

## O pedido

Um comprovante de envio da súmula digital com os detalhes da prova, o resultado, quem foi o árbitro, o horário da prova e a bateria do atleta. Antes, depois do envio o judge via só "Publicada no ranking" e o atleta só o leaderboard.

## Decisões aprovadas

1. **D1:** o atleta encontra o comprovante na Área do Atleta, no cartão da inscrição (sem item novo no menu), e por um link para compartilhar. A Quadra mostra o resumo logo depois do envio (ou da marcação de ausente).
2. **D2:** sem e-mail por envio, pela cota diária do Resend.
3. **D3:** o árbitro aparece com o nome gravado na súmula (o nome que o gestor cadastrou, gravado quando a súmula foi aberta).
4. **D4:** quando o gestor corrige ou lança à mão, o comprovante mostra o resultado oficial e o enviado pelo judge, sem a justificativa do gestor.
5. **D5:** link sem login, sem prazo e fora de buscadores (assinado com HMAC do segredo de sessão, propósito próprio). A página mostra sempre o estado atual.
6. **D6:** QR Code e imagem para salvar ficam para depois.
7. **D7:** "Contestar" leva à Área do Atleta, em Contestações, sem preencher o formulário.
8. **D8:** o gestor copia e abre o comprovante no painel de detalhe da súmula (aba Súmulas e Judges).

## Estados

Publicada, corrigida pelo gestor, lançada à mão por cima, devolvida ao judge, atleta ausente e cancelada. Súmula nunca enviada não tem comprovante.

## Como ficou (e o que a maquete não mostrava)

- Modelo puro em `src/lib/sheetReceipt.ts`; leitura e acesso em `src/lib/serverSheetReceipt.ts`; rota `GET /api/sheet-receipts` (`?token=` sem login, `?sheetId=` com sessão, `?view=mine` na Área do Atleta); página em `src/app/[locale]/comprovante/sumula/[token]/page.tsx` com `src/components/SheetReceiptView.tsx`; Quadra e Área do Atleta em `src/components/SheetReceiptShortcuts.tsx`; painel em `ScoresheetsPanel.tsx`.
- **O link leva o idioma no caminho** (`/pt-br/comprovante/sumula/{token}`), como o do telão. O token tem um ponto, e o middleware de idioma trata caminho com ponto como arquivo e não põe o prefixo.
- **Lançada à mão** é detectada pelo ranking: o resultado atual do atleta na prova não aponta para esta súmula. Ordem dos estados: cancelada, lançada à mão, devolvida, ausente, corrigida, publicada.
- **O resumo da súmula** ("6 rounds + 27") é recalculado dos registros do judge na página do comprovante; a lista da Área do Atleta mostra só o resultado.
- **Área do Atleta:** quando o atleta tem mais de uma súmula na prova, aparece a ativa; sem ativa, a última cancelada.
- Conferido no servidor local com uma súmula corrigida do evento real (só leitura).

## Fora de escopo

Fitness Race, Qualifier, e-mail, QR Code, imagem, PDF, assinatura do atleta, banco, migrations, autenticação e infraestrutura.
