# Plano: Área do Atleta e Gestão de Inscrição

## Status da Implementação

Implementado em 2026-06-06 pela Story 1.7: `docs/stories/1.7.story.md`.

## Objetivo

Criar uma área do atleta na plataforma WODArena para que cada atleta consiga acessar suas inscrições, acompanhar o status do pagamento, visualizar ou solicitar a 2ª via da inscrição e receber avisos claros quando o pagamento por cartão de crédito não for processado.

O fluxo de inscrição também deve ser ajustado para registrar o atleta mesmo quando o pagamento falhar, garantindo que ele tenha acesso ao painel e consiga resolver pendências sem depender do gestor.

---

## Contexto do Problema

Hoje o sistema possui:

- Página pública de evento em `src/app/event/[id]/page.tsx`.
- Login de gestores em `/admin`, usando `src/app/api/auth/login/route.ts`.
- Registro de inscrições em `registrations`.
- Cadastro de atletas em `athletes`.
- Checkout Mercado Pago por Pix, cartão e preferência.
- Webhook Mercado Pago em `src/app/api/webhooks/mercadopago/route.ts`.
- Componente de comprovante/inscrição `RegistrationVoucher`.

Problema atual identificado:

- O webhook grava a inscrição apenas quando o pagamento chega como `approved`.
- Em falhas de cartão, alguns atletas ficam sem registro persistido.
- Como não há painel do atleta, ele não consegue ver a tentativa, a pendência ou solicitar uma 2ª via.

---

## Princípios de Implementação

Seguir a Constitution do projeto:

1. **CLI First**: criar primeiro o comportamento de dados/API e validação automatizada.
2. **Observability Second**: registrar estados de inscrição e pagamento para auditoria.
3. **UI Third**: criar a área visual do atleta depois que o fluxo estiver persistindo corretamente.
4. **Story-Driven Development**: antes da implementação, criar uma story em `docs/stories/`.
5. **No Invention**: este plano cobre apenas os requisitos informados: painel do atleta, 2ª via, aviso de falha no cartão, mesma rota de login `/admin`, senha no ato da inscrição e persistência mesmo com erro de pagamento.

---

## Escopo Funcional

### 1. Cadastro de senha no ato da inscrição

Adicionar no formulário de inscrição:

- Campo `senha`.
- Campo `confirmar senha`.
- Validação mínima:
  - Senha obrigatória.
  - Mínimo de 6 caracteres.
  - Confirmação deve ser igual à senha.

Com isso, ao finalizar o formulário de inscrição, o atleta já terá credenciais para acessar o painel.

### 2. Login do atleta pela rota `/admin`

Manter a mesma rota de login atual:

- `/admin`

Após autenticar:

- Se `role = owner`, exibir painel do proprietário.
- Se `role = manager`, exibir painel do gestor.
- Se `role = athlete`, exibir área do atleta.

Isso evita criar uma segunda tela de login e reaproveita o fluxo existente.

### 3. Área do atleta

Criar uma visão específica para atletas dentro do fluxo autenticado.

Conteúdo mínimo:

- Dados do atleta:
  - Nome.
  - E-mail.
  - Telefone.
  - Box.
- Lista de inscrições vinculadas ao e-mail/usuário do atleta.
- Detalhes da inscrição:
  - Evento.
  - Categoria/divisão.
  - Tipo de inscrição.
  - Valor.
  - Data da inscrição.
  - Status do pagamento.
  - Código/ID da inscrição.
- Botão para visualizar a inscrição.
- Botão para solicitar ou reenviar 2ª via da inscrição.

### 4. 2ª via da inscrição

A 2ª via deve reaproveitar o fluxo já existente do comprovante:

- Usar o componente `RegistrationVoucher` quando possível.
- Permitir envio por e-mail pela API já existente `src/app/api/checkout/email/route.ts`.
- Registrar feedback visual no painel:
  - Enviado com sucesso.
  - Falha no envio.

A 2ª via deve estar disponível quando a inscrição existir, mesmo que o pagamento ainda esteja pendente ou recusado, desde que o status visual deixe claro que a inscrição não está confirmada financeiramente.

### 5. Registro mesmo com falha no pagamento

Alterar o fluxo de checkout para persistir a intenção de inscrição antes ou durante a tentativa de pagamento.

Novo comportamento esperado:

- O sistema cria uma inscrição assim que o atleta envia o formulário e inicia o pagamento.
- Essa inscrição nasce com status inicial, por exemplo: `payment_pending`.
- Se o cartão for aprovado, status muda para `payment_approved`.
- Se o cartão for recusado ou não processado, status muda para `payment_failed`.
- Se o pagamento ficar em análise, status muda para `payment_in_review` ou `payment_pending`.

Resultado:

- O atleta sempre terá acesso ao painel.
- O gestor conseguirá ver tentativas com falha.
- O atleta conseguirá solicitar 2ª via ou acompanhar pendência.

### 6. Aviso de falha no cartão no painel do atleta

Quando uma inscrição tiver pagamento com falha, exibir aviso destacado:

> Pagamento não processado. Sua inscrição foi registrada, mas ainda não está confirmada. Verifique os dados do cartão ou tente outra forma de pagamento.

O aviso deve aparecer:

- Na visão geral do painel do atleta.
- No detalhe da inscrição afetada.

O painel também deve indicar que a participação no evento depende da regularização do pagamento.

---

## Modelo de Dados Proposto

### Alterar `users`

Adicionar o papel de atleta:

- `role = 'athlete'`

Atualmente `User.role` aceita apenas:

- `owner`
- `manager`

Será necessário atualizar:

- Tipo TypeScript `User`.
- Constraint SQL da tabela `users`.
- Login e roteamento de painel.

### Criar ou adaptar segredo de senha

O login atual usa `users` e `users_secrets`.

O cadastro do atleta deve:

- Criar ou reutilizar usuário pelo e-mail.
- Criar senha em `users_secrets`.
- Evitar duplicidade por e-mail.
- Se o e-mail já existir como atleta, vincular nova inscrição ao mesmo usuário.

### Alterar `registrations`

Adicionar campos para rastrear o estado da inscrição e do pagamento:

- `user_id`
- `athlete_id`
- `payment_status`
- `payment_method`
- `payment_id`
- `payment_status_detail`
- `payment_error_message`
- `updated_at`

Status sugeridos:

- `payment_pending`
- `payment_approved`
- `payment_failed`
- `payment_in_review`
- `payment_cancelled`

Campos importantes:

- `payment_status` define o que aparece no painel.
- `payment_id` vincula a inscrição ao Mercado Pago.
- `payment_status_detail` guarda o detalhe técnico retornado pelo Mercado Pago.
- `payment_error_message` guarda mensagem amigável ou diagnóstico de falha.

---

## Fluxo Técnico Proposto

### Fase 1: Story e contrato de dados

Criar story em `docs/stories/` com:

- Contexto.
- Acceptance Criteria.
- Tasks.
- File List.
- Change Log.

Critérios mínimos:

- Atleta cria senha no formulário de inscrição.
- Inscrição é persistida mesmo com falha no cartão.
- Atleta consegue logar via `/admin`.
- Atleta vê suas inscrições.
- Atleta vê alerta de cartão não processado.
- Atleta solicita 2ª via da inscrição.

### Fase 2: Banco de dados e tipos

Criar migration Supabase para:

- Permitir `role = 'athlete'` em `users`.
- Adicionar vínculo de usuário/atleta em `registrations`.
- Adicionar campos de status de pagamento.
- Garantir índices por `user_id`, `athlete_email`, `event_id` e `payment_id`.

Atualizar:

- `src/types/index.ts`
- Mapeamento de `registrations` em `AppContext.tsx`
- Tipos auxiliares do checkout.

### Fase 3: API/CLI-first do registro de inscrição

Criar uma API server-side para iniciar inscrição:

- Sugestão: `POST /api/registrations/start`

Responsabilidades:

- Validar dados do atleta.
- Validar senha.
- Criar ou recuperar usuário atleta.
- Criar ou atualizar segredo de senha.
- Criar atleta em `athletes` se necessário.
- Criar inscrição com `payment_pending`.
- Retornar `registrationId` para o checkout.

Esse endpoint deve ser chamado antes de iniciar Pix/cartão/preferência.

### Fase 4: Ajuste do checkout Mercado Pago

Atualizar:

- `src/app/api/checkout/card/route.ts`
- `src/app/api/checkout/pix/route.ts`
- `src/app/api/checkout/preference/route.ts`
- `src/app/api/checkout/status/route.ts`
- `src/app/api/webhooks/mercadopago/route.ts`

Novo comportamento:

- Receber `registrationId`.
- Usar `registrationId` como chave de idempotência.
- Atualizar a inscrição existente em vez de criar apenas no `approved`.
- Registrar `payment_id`, `payment_status`, `payment_status_detail` e mensagem de erro.

Para cartão:

- Se Mercado Pago retornar erro HTTP, marcar inscrição como `payment_failed`.
- Se retornar `rejected`, marcar como `payment_failed`.
- Se retornar `approved`, marcar como `payment_approved`.
- Se retornar `in_process` ou `pending`, manter pendente/análise.

### Fase 5: Login e roteamento por perfil

Atualizar login para aceitar atleta:

- `src/app/api/auth/login/route.ts`
- `src/context/AppContext.tsx`
- `src/app/admin/page.tsx`

Após login:

- `owner`: painel owner.
- `manager`: painel gestor.
- `athlete`: área do atleta.

Não criar nova rota de login. A rota `/admin` continua sendo o ponto de entrada.

### Fase 6: Interface da área do atleta

Dentro de `src/app/admin/page.tsx`, criar renderização específica para `role = athlete`.

Componentes ou blocos sugeridos:

- Cabeçalho do atleta.
- Cards de status:
  - Inscrições.
  - Pagamentos pendentes.
  - Pagamentos com falha.
- Lista de inscrições.
- Detalhe da inscrição.
- Ação de 2ª via.
- Alerta de pagamento não processado.

O layout deve seguir a identidade atual do painel, mas sem expor funções de gestor.

### Fase 7: E-mail e 2ª via

Reaproveitar `src/app/api/checkout/email/route.ts` quando possível.

Garantir:

- Atleta só solicita 2ª via das próprias inscrições.
- Gestor continua podendo reenviar comprovante pelo painel administrativo.
- Mensagem de e-mail deixa claro quando a inscrição ainda depende de pagamento.

---

## Regras de Negócio

- Uma inscrição pode existir sem pagamento aprovado.
- Inscrição com pagamento falho não deve ser tratada como vaga confirmada financeiramente.
- O atleta deve conseguir acessar o painel mesmo se o cartão falhar.
- A 2ª via pode ser exibida para inscrição pendente/falha, mas deve mostrar o status real.
- O gestor deve conseguir identificar inscrições com pagamento falho.
- O e-mail deve ser a chave principal para login do atleta.
- Se o atleta usar o mesmo e-mail em outro evento, o painel deve listar todas as inscrições dele.

---

## Acceptance Criteria

- [x] AC1: O formulário de inscrição exige senha e confirmação de senha.
- [x] AC2: Ao enviar inscrição, o sistema cria usuário atleta com `role = athlete`.
- [x] AC3: A inscrição é persistida antes da conclusão do pagamento.
- [x] AC4: Em falha de cartão, a inscrição permanece registrada com `payment_status = payment_failed`.
- [x] AC5: O atleta consegue acessar `/admin` com e-mail e senha cadastrados na inscrição.
- [x] AC6: Usuário atleta não acessa telas administrativas de gestor ou owner.
- [x] AC7: Área do atleta lista inscrições vinculadas ao seu usuário/e-mail.
- [x] AC8: Área do atleta exibe alerta quando o cartão não foi processado.
- [x] AC9: Área do atleta permite visualizar a inscrição.
- [x] AC10: Área do atleta permite solicitar 2ª via da inscrição.
- [x] AC11: Webhook Mercado Pago atualiza inscrição existente por `registrationId`/`payment_id`.
- [x] AC12: Gestor continua visualizando inscrições normalmente, com novo status de pagamento.

---

## Plano de Validação

Executar:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Testes automatizados sugeridos:

- Criar usuário atleta ao iniciar inscrição.
- Persistir inscrição com `payment_pending`.
- Atualizar inscrição para `payment_failed` em erro de cartão.
- Atualizar inscrição para `payment_approved` em pagamento aprovado.
- Login de atleta pela API existente.
- Restringir acesso do atleta ao painel administrativo.
- Listar apenas inscrições do atleta logado.
- Solicitar 2ª via de inscrição própria.

Testes manuais:

- Inscrição com cartão aprovado.
- Inscrição com cartão recusado.
- Inscrição com erro de processamento no cartão.
- Login do atleta após falha de pagamento.
- Solicitação de 2ª via.
- Conferência do painel do gestor com status de pagamento.

---

## Ordem Recomendada de Execução

1. Criar story em `docs/stories/`.
2. Criar migration Supabase.
3. Atualizar tipos TypeScript.
4. Criar endpoint server-side para iniciar inscrição.
5. Ajustar checkout para usar inscrição existente.
6. Ajustar webhook para atualizar status em vez de criar somente no aprovado.
7. Ajustar login para `role = athlete`.
8. Criar área do atleta dentro de `/admin`.
9. Reaproveitar/ajustar 2ª via.
10. Atualizar testes.
11. Rodar quality gates.
12. Atualizar checklist e File List da story.

---

## Fora de Escopo Neste Plano

- Carteira financeira completa do atleta.
- Reembolso automático.
- Troca de categoria pelo atleta.
- Upload de documentos.
- Chat com organizador.
- Criação de nova rota pública separada para login do atleta.
- Regras automáticas de liberação de vaga por pagamento aprovado.

Esses itens podem virar novas stories depois que a área básica do atleta estiver funcionando.
