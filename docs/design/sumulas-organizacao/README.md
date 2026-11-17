# Aba "Súmulas e Judges" por prova e bateria: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-11-16, com as decisões D1 a D7 como recomendadas. A maquete é [sumulas-organizacao-aprovado.html](sumulas-organizacao-aprovado.html), a cópia da página como foi aprovada (diagnóstico, simulador Hoje × Proposta, comparação, decisões e escopo). As Stories 1.141 a 1.143 citam esta pasta nos critérios de aceite.

O visual é o do painel do gestor (tokens de `src/app/globals.css`). Vale só para eventos de Functional Fitness: a aba já só aparece neles.

## O pedido

Durante um evento presencial, com o acúmulo de súmulas, ficou difícil para o gestor achar resultados prova a prova na aba. A tela fazia um grupo por prova de cada categoria (cinco grupos "PROVA 2 · PROVA 2", sem dizer a categoria), mostrava tudo aberto (186 cartões e 640 botões no evento), misturava canceladas com válidas e não mostrava o que estava pendente. Pediu a melhor organização, sem mexer no código antes da aprovação.

## Decisões aprovadas

1. **D1:** uma prova por código, juntando as categorias. As provas com o mesmo código ("PROVA 2" de cada categoria) viram uma só; códigos diferentes ("PROVA 3.1" e "PROVA 3.2") ficam separados.
2. **D2:** dentro da prova, a lista segue as baterias do cronograma, raia por raia, como a quadra. A categoria vira filtro. Prova sem bateria no cronograma usa a bateria gravada em cada súmula; sem bateria nenhuma, a lista vai por categoria e nome.
3. **D3:** canceladas escondidas por padrão. A linha do atleta avisa "+1 cancelada" e a opção "Canceladas" mostra todas.
4. **D4:** corrigir, devolver e cancelar saem do cartão e vão para um painel de detalhe, com o histórico sempre à vista. Os formulários, as regras e os textos são os de antes.
5. **D5:** as raias do cronograma sem súmula aparecem ("Sem súmula"), só em provas com bateria no cronograma.
6. **D6:** judges numa sub-aba própria, com o mesmo cadastro.
7. **D7:** a aba abre na prova com a súmula mais recente. Bateria completa começa recolhida; com busca ou filtro ligado, as baterias que têm resultado abrem.

## Como ficou (e o que a maquete não mostrava)

- Regras puras em `src/lib/scoresheetBoard.ts`; lista em `src/components/admin/ScoresheetBoard.tsx`; sub-abas, filtros e painel de detalhe em `src/components/admin/ScoresheetsPanel.tsx`.
- **Bateria que ainda não começou** (nenhuma súmula aberta nela) mostra "Aguardando" e não conta como pendência. Sem isso, durante o evento todas as raias das baterias futuras apareceriam como "sem súmula". A maquete mostrava o fim do dia, quando todas já tinham começado.
- **Raia só com súmula cancelada** é "Sem súmula" (com o aviso "+1 cancelada"): a raia está sem resultado.
- **Súmula fora do cronograma** numa prova que tem bateria vai para o grupo "Fora das baterias do cronograma". Em prova sem bateria no cronograma, a lista usa a bateria gravada na súmula e, sem ela, "Sem bateria". Nenhuma súmula some da lista.
- **Código da prova** sem diferença de maiúsculas e espaços ("PROVA 2" e "Prova 2 " são a mesma prova). Sem código, vale o nome.
- **Prova inicial:** a da súmula atualizada por último no primeiro carregamento; depois disso a atualização automática não troca a prova.
- Conferido com os dados do evento que originou o pedido (só leitura): Prova 2 com 3 raias sem súmula, 3.1 com 2, Prova 4 com 4, 4 súmulas em andamento, e todas as 186 súmulas em algum grupo.

## Fora de escopo

Banco, migrations, API, autenticação, infraestrutura, a Quadra do judge, o telão, o leaderboard, o lançamento manual e a súmula de Fitness Race.
