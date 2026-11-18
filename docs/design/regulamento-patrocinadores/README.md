# Regulamento em PDF e patrocinadores com logo: decisões aprovadas

Proposta aprovada pelo usuário em 2026-11-18, com as decisões D1 a D8 como recomendadas (todas "A"). A maquete é [regulamento-patrocinadores-aprovado.html](regulamento-patrocinadores-aprovado.html), a cópia da página como foi aprovada (o que existe hoje, simulador painel × página, comparação, decisões e escopo). As Stories 1.150 a 1.152 citam esta pasta nos critérios de aceite.

O visual é o do painel do gestor e da página pública do evento (tema escuro de `src/app/globals.css`).

## O pedido

O botão "Regulamento" da página do evento não levava ao documento oficial, e a área de patrocinadores mostrava nomes em texto. O gestor precisa enviar o regulamento em PDF pelo painel e colocar as marcas patrocinadoras em PNG, dizendo quantas serão; a área de patrocinadores vira carrossel.

## O que havia (lido em 2026-11-18, 29 eventos públicos)

- Os 29 eventos mostravam os mesmos patrocinadores, "Bull Fit", "WOD Gear" e "Strong Nutrition": o painel gravava esses nomes ao criar o evento (`AppContext.addEvent`) e não tinha campo para trocá-los.
- O regulamento era só o texto de `events.rules`. Dos 16 eventos com texto, 5 só mandavam para fora ("Em breve.", "À apresentar.", "Na bio do Instagram", site da federação); 11 colaram o documento inteiro (420 a 20.948 caracteres).
- O envio de arquivos aceitava só imagem até 3 MB, por uma rota do servidor; a Vercel recusa requisições acima de 4,5 MB.

## Decisões aprovadas

1. **D1:** PDF oficial e resumo em texto opcional. O texto atual (`rules`) continua, como resumo.
2. **D2:** a folha do regulamento mostra o arquivo (nome, tamanho, data) com "Abrir PDF" numa nova aba e "Baixar". Sem PDF embutido.
3. **D3:** PDF até 10 MB, enviado direto ao Storage por link assinado pelo servidor, num espaço só de documentos (`event-documents`); o servidor confere o gestor e que o arquivo começa com `%PDF`.
4. **D4:** "Quantas marcas?" de 1 a 12 cria as vagas, na ordem do carrossel. Vaga vazia não aparece no site e o painel avisa quantas estão vazias.
5. **D5:** só PNG, até 2 MB, ajustado para até 600 px de largura, mantendo a transparência. Nome obrigatório (texto do leitor de tela) e link opcional (http ou https).
6. **D6:** cada logo num cartão claro na página escura.
7. **D7:** carrossel de duas marcas por vez, troca a cada 5 s, para ao tocar ou passar o mouse, com setas, pontos e botão de pausa; com até 2 marcas fica parado; sem movimento para quem pede menos animação.
8. **D8:** o painel para de gravar os três nomes fixos e a página para de mostrar a lista antiga. Nada é apagado do banco.

## Como ficou

- Banco: `events.rules_document` (JSONB) e `events.sponsor_logos` (JSONB, lista de vagas `{name, logoUrl, link}`), na migration `20261118120000_event_rules_document_sponsor_logos.sql`, que também documenta o bucket `event-documents`. O servidor cria o bucket no primeiro envio, como o de imagens.
- Sem a migration, a página e o painel seguem como antes: o bootstrap pede as colunas novas primeiro e volta para o select de antes; o painel só envia o PDF e as marcas quando mudaram, e a gravação responde 503 com o nome da migration.
- Regras puras em `src/lib/eventMediaFields.ts`; envio do PDF em `src/lib/rulesDocumentUpload.ts` e `POST /api/admin/documents/upload`; logo pela rota de mídia de antes, com o tipo `sponsor`.

## Fora de escopo

Telão, leaderboard, comprovantes e e-mails (não mostram patrocinadores), logo e banner do evento.
