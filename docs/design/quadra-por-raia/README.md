# Quadra do judge por raia: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-11-17, com as decisões D1 a D8 como recomendadas (todas "A"). A maquete é [quadra-por-raia-aprovado.html](quadra-por-raia-aprovado.html), a cópia da página como foi aprovada (diagnóstico do Hibrido Games, achados no código, simulador Hoje × Proposta, comparação, decisões e escopo). As Stories 1.147 a 1.149 citam esta pasta nos critérios de aceite.

O visual das telas é o da quadra (tema claro `court-light` de `src/app/globals.css`, moldura `CourtShell`). Vale só para eventos de Functional Fitness presenciais; Fitness Race fica de fora (já pede a estação ao árbitro e tem escala de judges).

## O pedido

Os árbitros abriam atletas que não eram os deles e se confundiam com a ferramenta. No Hibrido Games (15/11), 32 das 186 súmulas foram canceladas; na Bateria 1 da Prova 2, o gestor cancelou 11 antes de a bateria terminar. Outras 11 foram abertas na véspera, em atletas reais. Pediu a melhor organização, sem mexer no código antes da aprovação.

## Achados no código (antes)

- O servidor só confere se o judge está atribuído ao evento (`serverSheetAccess.ts`); a quadra lista todas as baterias da prova e todas as raias com o mesmo peso (`CourtBoard.tsx`).
- Um toque cria a súmula Em andamento com o judge (`openSheet`), sem confirmação, e a raia entra na chamada do telão (`broadcastMode.ts`, regra 3). O judge não desfaz; o gestor só cancela, embora a mensagem de bloqueio peça para "liberar".
- A quadra abre sempre na primeira prova e volta para ela depois de cada súmula.
- Súmula real abre a qualquer hora; não há treino na quadra.
- A lista "Atletas sem bateria" vem na ordem do banco, sem busca.
- O judge não vê as súmulas que deixou abertas.

## Decisões aprovadas

1. **D1:** o judge escolhe a raia no aparelho ao entrar no evento ("Em qual raia você está?"), com "Trocar" sempre à vista e a opção "Vou cobrir várias raias". A escolha fica no aparelho (por evento), sem banco.
2. **D2:** a bateria "agora" vem das súmulas, com a regra do telão: a primeira bateria, na ordem do cronograma, que ainda não terminou; "em chamada" quando já tem súmula aberta. O horário só ordena.
3. **D3:** abrir fora da sua raia ou fora da bateria atual pede confirmação, com a raia, o atleta e a bateria em destaque ("Abrir mesmo assim"). Na sua raia e na bateria atual, abre direto.
4. **D4:** o próprio judge libera a súmula enquanto nada foi registrado nela: a súmula vazia é descartada (não vira cancelada) e sai da chamada do telão. Depois do primeiro registro, só o gestor.
5. **D5:** o servidor só abre súmula de bateria do dia (fuso America/Fortaleza) para judge. Gestor e owner seguem livres; bateria sem data não trava.
6. **D6:** botão "Treinar a súmula com atleta fictício" na quadra, que abre a súmula de cada prova com um atleta de treino. Nada é gravado; usa a súmula de demonstração que já existe (`SheetDemo`).
7. **D7:** a lista de atletas sem bateria fica em ordem alfabética, com busca, confirmação ao abrir e o aviso de que a prova tem atletas fora das baterias.
8. **D8:** "Liberar para outro judge" no detalhe da súmula, no painel do gestor: os registros ficam e quem abrir em seguida assume. Pede uma migration pequena para o histórico aceitar a ação "released".

Também entram, sem decisão própria: a faixa "Sua súmula aberta" (com "Retomar") no topo da quadra, o voltar da súmula para "Agora" na sua raia, e o nome inteiro do atleta no cartão da raia.

## Stories

- **1.147** Quadra por raia: D1, D2, D3, D7, súmulas abertas e voltar para "Agora". Tela e módulo puro.
- **1.148** Liberar súmula: D4 no judge e D8 no gestor. API, painel e uma migration.
- **1.149** Treino e dia da bateria: D5 e D6. Servidor e quadra.

## Fora de escopo

A súmula em si (contagem, cronômetro, fila no aparelho, envio), ranking, leaderboard, telão (a regra é reaproveitada, não muda), Fitness Race, a aba Súmulas e Judges além do botão da D8.
