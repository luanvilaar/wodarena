-- Controle de cancelamento de inscricoes e reembolso manual.
-- Nao executa estorno automatico no Mercado Pago; apenas registra a decisao operacional.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS refund_method TEXT,
  ADD COLUMN IF NOT EXISTS refund_note TEXT,
  ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_processed_by TEXT;

ALTER TABLE registrations
  DROP CONSTRAINT IF EXISTS registrations_refund_status_check;

ALTER TABLE registrations
  ADD CONSTRAINT registrations_refund_status_check
  CHECK (refund_status IN ('not_requested', 'manual_pending', 'manual_refunded'));

CREATE INDEX IF NOT EXISTS idx_registrations_refund_status
  ON registrations(refund_status)
  WHERE refund_status <> 'not_requested';

COMMENT ON COLUMN registrations.cancellation_reason IS
'Motivo informado pelo gestor/owner ao cancelar a inscricao.';

COMMENT ON COLUMN registrations.refund_status IS
'Controle financeiro manual: not_requested, manual_pending ou manual_refunded. Nao aciona estorno automatico no Mercado Pago.';

COMMENT ON COLUMN registrations.refund_amount IS
'Valor definido manualmente para devolucao ao atleta, considerando a politica do organizador e taxas nao reembolsaveis quando aplicavel.';
