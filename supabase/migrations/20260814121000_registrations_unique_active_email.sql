-- =============================================================================
-- Trava, no banco, duplicidade de inscrição por (evento, e-mail) sob concorrência
-- (security review 2026-08-14)
-- =============================================================================
-- A checagem de "já existe inscrição ativa" em /api/registrations/start é
-- check-then-act (SELECT seguido de INSERT), não atômica. Duas requisições
-- concorrentes com o mesmo e-mail/evento podiam passar ambas na checagem e
-- criar duas inscrições (IDs distintos, sem conflito de PK).
--
-- Este índice único parcial fecha a janela de corrida: só permite UMA
-- inscrição não cancelada por (event_id, lower(athlete_email)). Se a migration
-- falhar por duplicatas já existentes, resolva-as manualmente antes de
-- reaplicar.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_email_active_unique
  ON registrations (event_id, lower(athlete_email))
  WHERE payment_status <> 'payment_cancelled';
