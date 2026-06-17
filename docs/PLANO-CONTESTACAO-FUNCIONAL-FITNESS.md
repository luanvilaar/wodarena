# Plano de Implementacao - Contestacao de Provas (Functional Fitness)

## Objetivo

Implementar um sistema de contestacao de provas no painel do atleta, restrito a eventos `functional_fitness`, com:

- abertura de recurso pelo atleta;
- controle de 2 creditos por atleta no evento;
- historico e status no painel;
- decisao administrativa;
- notificacao por e-mail nas mudancas de status.

## Recomendacoes de Escopo

### 1. Escopo do credito

Recomendacao: tratar o credito no contexto da inscricao/evento, nao como saldo global da conta.

Motivos:

- a contestacao existe por evento;
- o painel do atleta hoje e organizado por inscricoes;
- evita conflito quando um mesmo atleta participa de mais de um evento.

### 2. Fonte do saldo

Recomendacao: nao criar uma carteira separada no primeiro momento.

Calcular o saldo com base nas proprias contestacoes:

- base: `2` creditos por inscricao elegivel;
- `utilizados`: quantidade total de contestacoes enviadas;
- `devolvidos`: quantidade de contestacoes com credito devolvido;
- `disponiveis = 2 - utilizados + devolvidos`.

Isso reduz complexidade e deixa o historico auditavel.

### 3. Modelagem da bateria e da raia

O sistema ja possui baterias oficiais em `events.event_schedule` com itens `kind = 'heat'`.

Recomendacao:

- prova: selecionar a partir de `event.workouts`;
- bateria: selecionar a partir das baterias oficiais vinculadas ao `workoutId`;
- raia: armazenar como campo textual curto no MVP, porque hoje a modelagem de baterias nao persiste lane por atleta.

Se a organizacao precisar validar raia de forma estruturada depois, isso vira uma evolucao separada da alocacao de baterias.

## Modelo de Dados

Criar uma tabela dedicada, por exemplo `contestations`, com colunas equivalentes a:

- `id`
- `event_id`
- `registration_id`
- `user_id`
- `athlete_id`
- `workout_id`
- `heat_id`
- `heat_number`
- `lane`
- `description`
- `status`
- `credit_consumed`
- `credit_refunded`
- `manager_note`
- `created_at`
- `updated_at`
- `resolved_at`

Status recomendados:

- `under_review`
- `approved`
- `rejected`

Mapeamento de exibicao:

- `under_review` -> `Em analise`
- `approved` -> `Deferida`
- `rejected` -> `Indeferida`

Indices recomendados:

- `event_id`
- `registration_id`
- `user_id`
- `athlete_id`
- `status`

## Fluxo do Atleta

### Etapa 1. Entrada no painel

Na Area do Atleta em `/admin`, adicionar uma secao `Contestacao de Provas` para inscricoes de eventos `functional_fitness`.

Essa secao deve mostrar:

- creditos disponiveis;
- creditos utilizados;
- historico das contestacoes;
- status de cada contestacao.

### Etapa 2. Abertura de recurso

Ao clicar em `Contestar Prova`:

1. selecionar a prova;
2. preencher formulario com:
   - prova confirmada;
   - bateria confirmada;
   - raia;
   - descricao detalhada.

### Etapa 3. Confirmacao

Ao concluir o envio:

- persistir a contestacao com status `under_review`;
- consumir 1 credito;
- exibir exatamente a mensagem solicitada pelo produto.

## Fluxo da Organizacao

Adicionar uma superficie administrativa no evento para:

- listar contestacoes por evento;
- filtrar por status;
- visualizar prova, bateria, raia, atleta e descricao;
- decidir entre `Em analise`, `Deferida` e `Indeferida`;
- marcar se o credito sera devolvido quando a contestacao for procedente.

Recomendacao de UX:

- colocar a operacao em uma nova aba do evento dentro de `/admin`;
- manter a acao de decisao inline ou em drawer leve, sem criar um fluxo paralelo fora do evento.

## APIs e Regras

### API do atleta

Criar endpoints para:

- listar as proprias contestacoes;
- criar uma nova contestacao.

Validacoes minimas:

- sessao valida com role `athlete`;
- inscricao vinculada ao usuario;
- evento do tipo `functional_fitness`;
- credito disponivel;
- prova pertence ao evento;
- bateria pertence a prova selecionada, quando informada;
- descricao obrigatoria.

### API administrativa

Criar endpoint para atualizar status e devolucao de credito.

Validacoes minimas:

- sessao valida com role `manager` ou `owner`;
- evento pertence ao gestor autenticado, quando aplicavel;
- status permitido;
- devolucao de credito so pode ocorrer em contestacao procedente.

## Bootstrap e Tipos Compartilhados

Atualizar:

- `src/types/index.ts`
- `src/context/AppContext.tsx`
- `src/app/api/app/bootstrap/route.ts`

Objetivo:

- carregar contestacoes no mesmo bootstrap do painel;
- manter o isolamento atual entre atleta, gestor e publico;
- evitar roundtrips desnecessarios para montar o painel inicial.

Para `athlete`, devolver apenas as contestacoes do proprio usuario/inscricao.
Para `manager`, devolver apenas contestacoes dos eventos do organizador.

## E-mail e Notificacao

Reaproveitar `src/lib/resend.ts` com um novo template para contestacoes.

Disparos:

- opcionalmente no momento da abertura do recurso, como comprovante;
- obrigatoriamente em toda mudanca de status.

Conteudo minimo do e-mail:

- evento;
- prova;
- bateria;
- status atual;
- informacao sobre devolucao ou perda do credito, quando aplicavel.

## Fases de Implementacao

### Fase 0 - Alinhamento e story

- registrar story;
- fechar premissas de credito por evento;
- fechar premissa de raia textual no MVP.

### Fase 1 - Persistencia

- migration da tabela de contestacoes;
- indices;
- tipos compartilhados.

### Fase 2 - Servidor

- endpoints de criacao, listagem e atualizacao;
- validacoes de permissao e escopo;
- integracao com e-mail.

### Fase 3 - Painel do atleta

- cards de credito;
- CTA `Contestar Prova`;
- fluxo em 2 etapas;
- historico e status;
- sinal visual de credito perdido.

### Fase 4 - Painel da organizacao

- listagem por evento;
- filtros;
- mudanca de status;
- devolucao de credito.

### Fase 5 - Regressao e quality gates

- testes de schema e renderizacao;
- `npm run lint`;
- `npm run typecheck`;
- `npm test`;
- idealmente `npm run build`.

## Riscos e Atencoes

### 1. CLI First

A constitution pede `CLI First -> Observability Second -> UI Third`.

Como o repositorio ainda nao possui um fluxo CLI consolidado para essa operacao, a implementacao deve prever ao menos um entrypoint operacional minimo para listar e atualizar contestacoes antes de depender exclusivamente da UI administrativa.

### 2. Lane nao estruturada

O modelo atual nao grava raia por atleta dentro da bateria. Se isso mudar no futuro, a modelagem da contestacao deve continuar compativel sem migracao destrutiva.

### 3. Isolamento de dados

O bootstrap atual ja tem regras diferentes para `athlete` e `manager`. Contestacoes precisam seguir o mesmo padrao para nao expor recursos entre atletas ou organizadores.

### 4. Credito devolvido

Devolver credito automaticamente em toda contestacao deferida parece simples, mas conflita com a regra "conforme definicao da organizacao".

Recomendacao: a devolucao deve ser uma decisao explicita da organizacao.

## Arquivos Provaveis

- `docs/stories/1.12.story.md`
- `docs/PLANO-CONTESTACAO-FUNCIONAL-FITNESS.md`
- `supabase/migrations/<timestamp>_functional_fitness_contestations.sql`
- `src/types/index.ts`
- `src/context/AppContext.tsx`
- `src/app/api/app/bootstrap/route.ts`
- `src/app/api/contestations/route.ts`
- `src/app/api/contestations/[id]/route.ts`
- `src/app/admin/page.tsx`
- `src/lib/resend.ts`
- `tests/functional-fitness-contestations.test.mjs`

## Resultado Esperado

Ao fim da implementacao:

- o atleta abre recursos pelo proprio painel;
- a organizacao analisa no admin do evento;
- o saldo de creditos fica visivel e consistente;
- indeferimentos sinalizam perda de credito;
- alteracoes de status geram notificacao por e-mail;
- o fluxo fica restrito a Functional Fitness e nao impacta Fitness Racing.
