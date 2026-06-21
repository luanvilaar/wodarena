-- Adiciona campo registration_deadline à tabela events.
-- Usado para calcular o ciclo de vida do evento (ATIVO / PERÍODO FINAL / ENCERRADO)
-- e exibir sinais visuais no EventCard conforme spec-event-lifecycle-signals.md.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ;
