# Atleta ausente na súmula digital: decisões aprovadas

Diagnóstico e decisões aprovados pelo usuário em 2026-10-21 (as decisões 10 e 11 são as respostas dele às duas perguntas abertas, e as decisões 12 a 17 são escolhas da story que ele confirmou, todas no mesmo dia). A implementação é a [Story 1.59](../../stories/1.59.story.md), que cita este arquivo nos critérios de aceite. Não há maquete: a interface reaproveita padrões que já existem (o botão com confirmação do "Enviar e publicar" na súmula do judge, e o formulário com motivo da aba "Súmulas e Judges" do painel).

## O problema

- **Pontuação:** no evento presencial (`functional_fitness`), prova sem resultado vale 0 ponto (`src/lib/leaderboardStandings.ts`: "em caso de ausência real, o organizador lança manualmente a pontuação máxima"). Como a classificação é low-point (menos pontos é melhor), o atleta que falta fica à frente de quem competiu.
- **Telão:** na súmula digital, a raia de um atleta ausente fica com a súmula aberta, sem nenhum toque. Isso prende o telão na Chamada (achado MEDIUM 2, REQ-002, do QA da Story 1.56). A correção do telão em si está sendo feita à parte, nas Stories 1.56 e 1.58; esta decisão dá ao judge e ao gestor a saída que faltava.

## O que foi aprovado

1. **Botão "Atleta ausente" na súmula do judge** (`CourtSheet`). Só aparece enquanto a súmula não tem nenhum registro (seq 0) e está em andamento ou devolvida. Pede confirmação, no padrão do "Enviar e publicar". Publica na hora, e a súmula fica enviada.
2. **Resultado atribuído, sempre calculado no servidor** a partir da estrutura da prova (nunca vem do aparelho):
   - **For Time:** time cap + (total de repetições da prova × segundos por repetição da regra `incomplete`). Exemplo: cap 12:00, 150 repetições, 1 s por repetição → 14:30;
   - **AMRAP:** 0 repetições;
   - **Carga máxima:** 0 kg.

   O resultado é gravado em `scores` com `result_status = 'absent'`. O CHECK do banco já aceita `'absent'`; `Leaderboard.tsx` já tem o selo "Ausente" e a chave `absent` existe em `src/messages` (pt-br, pt-pt e en-gb).
3. **Pontuação na prova = a maior em jogo.** O ausente fica depois de qualquer resultado real, inclusive o de quem estourou o cap com 0 repetições, o de quem fez 0 repetições ou 0 kg de verdade e o de For Time com penalidade de 0 s por repetição (que o sistema permite). Os ausentes dividem a última posição, na regra de empate que já existe: os empatados recebem a melhor posição do grupo.
   - 10 atletas e 1 ausente → 10 pontos;
   - 10 atletas e 2 ausentes → 9 pontos para cada um.

   Tudo recalcula sozinho quando outro atleta é marcado ausente.
4. **O gestor também marca ausente pelo painel** (aba "Súmulas e Judges"), com **motivo obrigatório** (a mesma regra de 3 a 500 caracteres das outras ações). Depois confere a pontuação atribuída na aba **Leaderboard** do painel e na página pública: a prova mostra o resultado (por exemplo 14:30) com o selo "Ausente", e a posição e os pontos são os de qualquer atleta.
5. **Desfazer:**
   - **Devolver** (gestor) reabre a súmula para o judge lançar o resultado; ao reenviar do jeito normal, o selo sai;
   - **Corrigir** (gestor) também tira o selo;
   - **Lançamento manual** por cima também tira o selo.
6. **Telão:** a raia ausente mostra "Ausente" e conta como enviada (não segura a bateria aberta). No ranking ao vivo da bateria, fica por último.
7. **Histórico da súmula:** registra "Atleta ausente", com quem marcou (judge ou gestor) e o motivo quando for o gestor.
8. **Banco:** migration nova e pequena (`20261021120000_scoresheet_absent.sql`): `scoresheets.absent BOOLEAN NOT NULL DEFAULT false` e a ação `absent` no CHECK de `scoresheet_reviews.action`. Idempotente, com rollback documentado, sem alterar migrations anteriores. Sem a migration aplicada, o botão responde que a migration está pendente e o resto segue igual (o mesmo padrão tolerante das Stories 1.50 e 1.53).
9. **Qualifier não muda** (`functional_fitness_qualifier`): ele tem regra própria de ausência no SQL e em `leaderboardStandings`.
10. **O gestor também marca ausente o atleta que não tem súmula aberta** (raia sem judge). Pela bateria do cronograma e/ou pela prova (atleta + prova), a ação cria a súmula já como ausente (enviada, `absent = true`), com motivo obrigatório (3 a 500 caracteres), histórico "Atleta ausente" e o mesmo resultado e ranking das decisões 2 e 3. Se já existe uma súmula não cancelada do atleta nessa prova, vale o caminho da decisão 4 sobre ela (o índice único de súmula ativa por prova e atleta continua valendo). O atleta precisa pertencer ao evento e a prova precisa ter estrutura; as regras de dono do evento e de gestor com acesso expirado são as das outras ações.
    - **Quem é o judge dessa súmula:** `judge_user_id` fica nulo e `judge_name` leva o nome do gestor (ou do owner) que marcou. Assim, se o gestor devolver essa súmula, o primeiro judge atribuído ao evento que a abrir assume a súmula; com o gestor como dono, nenhum judge conseguiria reabri-la.
11. **O selo "Ausente" é por prova.** O atleta pode perder uma prova por algum motivo e seguir competindo nas demais.
    - **Onde aparece:** na célula daquela prova, no leaderboard do painel e no público, na classificação geral do telão e no quadro de baterias do judge (`CourtBoard`), que mostra "Ausente" em vez de "Publicada · 14:30";
    - **O que não muda:** não existe marca global no atleta. Ser ausente numa prova não afeta as outras: o atleta continua nas baterias seguintes, o judge abre as súmulas das próximas provas normalmente e o ranking das outras provas não muda;
    - **Fora:** as exportações CSV e PDF do painel continuam sem o selo.
12. **Súmula criada pelo gestor fica sem judge** (confirmação da AUTO-DECISION 9 da Story 1.59). `judge_user_id` fica nulo e `judge_name` leva o nome do gestor (ou do owner) que marcou. Depois de "Devolver", o judge que abre a súmula assume (passa a ser o judge dela) e lança o resultado; para isso, a abertura da súmula (`openSheet`) muda e aceita a súmula devolvida sem judge.
13. **Prova de outra categoria é recusada** (confirmação da AUTO-DECISION 12 da Story 1.59). Marcar ausente o atleta numa prova vinculada a uma categoria que não é a dele responde 400 e não cria súmula.
14. **O gestor pode marcar ausente uma súmula já enviada com resultado real** (confirmação da AUTO-DECISION 2 da Story 1.59). A confirmação no painel mostra o resultado que será substituído, e o histórico guarda o antes.
15. **Lançamento manual com o mesmo valor mantém o selo.** O selo "Ausente" só sai pelo lançamento manual quando o resultado muda.
16. **Só o judge assume a súmula sem judge.** Na súmula devolvida ou em andamento sem judge, quem assume é o usuário com papel `judge` atribuído ao evento que a abre; o gestor dono e o owner a abrem só para leitura.
17. **A regra de assumir vale também para a súmula cujo judge foi apagado** (que hoje fica sem judge e sem saída).

## Exemplo aprovado

For Time, cap 12:00, 150 repetições, 1 s por repetição faltante, sem desempate. São 14 atletas e 3 ausentes. O resultado de cada ausente é 12:00 + 150 × 1 s = **14:30** (870 segundos).

| Posição | Atleta | Resultado | Como saiu | Pontos |
|---|---|---|---|---|
| 1 | A | 08:42 | concluiu | 1 |
| 2 | B | 09:15 | concluiu | 2 |
| 3 | C | 09:58 | concluiu | 3 |
| 4 | D | 10:20 | concluiu | 4 |
| 4 | E | 10:20 | concluiu, empate com D | 4 |
| 6 | F | 10:47 | concluiu | 6 |
| 7 | G | 11:05 | concluiu | 7 |
| 8 | H | 11:39 | concluiu | 8 |
| 9 | I | 11:58 | concluiu | 9 |
| 10 | J | 12:08 | cap com 142 de 150 (+8 s) | 10 |
| 11 | K | 12:30 | cap com 120 de 150 (+30 s) | 11 |
| 12 | L | 14:30 · Ausente | marcado pelo judge | 12 |
| 12 | M | 14:30 · Ausente | marcado pelo judge | 12 |
| 12 | N | 14:30 · Ausente | marcado pelo gestor | 12 |

Em segundos (para os testes): A 522, B 555, C 598, D e E 620, F 647, G 665, H 699, I 718, J 728, K 750, L, M e N 870.

Notas aprovadas:

- com 1 ausente só (os outros 13 competiram), ele levaria 14 pontos;
- um 4º ausente marcado depois (um dos 11 que tinham resultado) faz os 4 passarem a 11 pontos cada, porque sobram 10 resultados reais;
- AMRAP (0 repetições) e carga máxima (0 kg) dão as mesmas posições e pontos: o ausente fica depois de todos os resultados reais e divide a última posição com os outros ausentes;
- sem o botão, esses 3 atletas ficariam com 0 ponto na prova, à frente de todos.

### Caso de teste: a ausência é só daquela prova

Este caso não faz parte da tabela aprovada acima: é o teste da decisão 11, montado sobre ela. O atleta L é marcado ausente na prova 1 e compete normalmente na prova 2 (os 14 atletas competem; L termina em 5º).

| Atleta L | Prova 1 | Prova 2 | Geral |
|---|---|---|---|
| Resultado | 14:30 · Ausente | resultado real, sem selo | |
| Posição | 12 | 5 | |
| Pontos | 12 | 5 | 12 + 5 = **17** |

- o selo "Ausente" aparece só na célula da prova 1;
- os pontos dos outros 13 atletas na prova 2 são os mesmos que teriam sem a marcação de L na prova 1;
- o judge abre a súmula de L na prova 2 normalmente (a súmula da prova 1 não bloqueia a outra).

## Fora desta decisão

- **Exportações CSV e PDF do painel:** sem o selo "Ausente".
- **Qualifier e Fitness Race:** sem mudança.
- **Detecção do telão:** a correção da bateria presa na Chamada (REQ-002 e PERF-001 da Story 1.56) segue nas Stories 1.56 e 1.58.
