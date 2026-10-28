# Lista "Provas WODs Cadastradas" por prova do evento: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-10-27, com a opção **B** e as decisões D2 a D5 como sugeridas e D6 na sugestão. A maquete é [provas-cadastradas-aprovado.html](provas-cadastradas-aprovado.html), a cópia da página como foi aprovada (diagnóstico, simulador Hoje × A × B × C, comparação e decisões). A Story 1.91 cita esta pasta nos critérios de aceite.

O visual é o do painel do gestor (tokens de `src/app/globals.css`). A implementação não cria estilo novo.

## O pedido

Quando o gestor cadastra a mesma prova para várias categorias, a lista vira uma fila de cartões quase iguais, com a categoria no menor texto do cartão. Pediu três formas de organizar; só frontend e organização visual.

## Decisões aprovadas

1. **D1:** opção B. Uma seção por prova do evento ("PROVA 1 · 6 de 6 categorias") e uma linha por categoria. A numeração é a do construtor de baterias: a N-ésima prova de cada categoria, na ordem da aba Provas, é a Prova N (`getDivisionWorkoutsInOrder`).
2. **D2:** a descrição dos movimentos fica recolhida e abre por linha ("Movimentos"). Desempate, prazo de submissão (Qualifier) e súmula digital continuam visíveis.
3. **D3:** nome igual ao código aparece uma vez (só exibição; nada muda no cadastro).
4. **D4:** Editar e Excluir dizem a prova e a categoria ("Editar prova PROVA 1 · Dupla Rx Masculino").
5. **D5:** o que falta cadastrar aparece no fim da seção ("Sem prova 3: …"). "Cadastrar" só preenche o formulário ao lado com a categoria e o código; o gestor revisa e salva.
6. **D6:** prova "Geral" segue a regra do construtor: entra na posição dela em cada categoria e aparece como uma linha só ("Todas as categorias").

## Como ficou (e o que a maquete não mostrava)

- Regras puras em `src/lib/workoutStageList.ts`; tela em `src/components/admin/WorkoutStageList.tsx`.
- **Só a primeira prova que falta de uma categoria tem "cadastrar".** A próxima prova que a categoria cadastrar vira a seguinte dela, não a que o gestor clicou; as demais lacunas mostram "(cadastre antes a Prova N)".
- **Prova Geral que cai em posições diferentes** (a Rx tem uma prova própria antes dela, a Scaled não) aparece em dois grupos, cada linha com as categorias que ela cobre ("Geral · 1 categoria"). É o que o construtor faz.
- **Provas que nenhuma categoria enxerga** (categoria removida, evento sem categorias) vão para a seção "Sem categoria ativa", editáveis, para nada sumir da lista.
- O atalho "cadastrar" descarta o que estiver no formulário, como o botão Cancelar.

## Fora de escopo

Banco, migrations, API, autenticação, infraestrutura, o formulário de cadastro, o modal de exclusão, a ordem das provas, o ranking, a súmula e o construtor de baterias.
