---
name: project-qualifier-manager-result-actions
description: Contrato exato do DB (2026-09-22) para o gestor editar/excluir resultados revisados de qualifier. Migration 20260922120000, RPC qualifier_request_resubmission, status awaiting_resubmission e gaps que ficam para o @dev
metadata:
  type: project
---

Migration `supabase/migrations/20260922120000_qualifier_manager_result_actions.sql`, criada em 2026-09-22. Ainda NÃO aplicada em produção; o projeto aplica migrations manualmente, sem Supabase CLI linkado.

**Schema**
- `score_submissions.status` passa a aceitar também `'awaiting_resubmission'` (constraint `score_submissions_status_check`).
- `score_submission_reviews.decision` passa a aceitar também `'resubmission_requested'` (constraint `score_submission_reviews_decision_check`).

**RPC nova** (somente service_role): `qualifier_request_resubmission(p_submission_id TEXT, p_actor_id TEXT, p_expected_reviewed_at TIMESTAMPTZ, p_justification TEXT) RETURNS JSONB {reviewId, submissionId, status:'awaiting_resubmission'}`.
Erros possíveis:
- `qualifier_submission_not_found`
- `qualifier_request_resubmission_not_allowed` (judge, athlete ou manager que não é organizador)
- `qualifier_manager_access_expired`
- `qualifier_event_required`
- `qualifier_submission_not_reviewed` (status diferente de validated/penalized/rejected)
- `qualifier_review_state_conflict`
- `qualifier_workout_not_found`
- `qualifier_submission_deadline_required`
- `qualifier_submission_window_closed`
- `qualifier_open_contestation_exists`
- `qualifier_request_resubmission_justification_required` (vazia ou com mais de 2000 caracteres)

**RPCs alteradas** (mesmas assinaturas):
- `qualifier_apply_review`: sobre status diferente de pending_review, exige justificativa em qualquer decisão (erro `qualifier_review_justification_required`). Também toma o advisory lock antes de gravar em `scores`.
- `qualifier_submit_submission`: aceita reenvio a partir de `awaiting_resubmission`, com o mesmo `p_expected_version = current_version`, e volta o status para `pending_review`.

**Why:** feature aprovada pelo dono do produto (ver [[project-qualifier-result-edit-delete]] do architect e [[qualifier-manager-override]] do QA).

**How to apply (pendências do @dev, validadas por dry-run no PGlite):**
- Ao ler `reviewed_at` pelo PostgREST, repasse a string crua ao RPC. Se ela passar por `new Date()`, os microssegundos são truncados e o RPC SEMPRE devolve `qualifier_review_state_conflict`.
- Hoje `/api/contestations` permite abrir contestação em submissão `awaiting_resubmission`. Se ela for aprovada, `qualifier_reopen_submission` devolve o vídeo antigo para a fila do judge (reproduzido). Bloqueie esse status na criação da contestação.
- `apply_review` do gestor sobre `awaiting_resubmission` funciona como "desfazer exclusão" (restaura o vídeo antigo, com justificativa). O produto precisa decidir se bloqueia isso na rota.
- Pontos que precisam conhecer o novo status: tipo `ScoreSubmissionStatus` em `src/types/index.ts`, filtro de status em `/api/judge/queue`, UI `QualifierAthleteSubmissions` (hoje só habilita o formulário em pending_review), `bin/qualifier.mjs`.
- Risco residual já existente: `qualifier_reopen_submission` ainda apaga `scores` antes do advisory lock, então pode dar deadlock (erro 40P01) se rodar em paralelo com review/exclusão no mesmo workout e divisão.
