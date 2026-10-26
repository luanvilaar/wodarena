-- Tipo de prova "tonnage" (Story 1.78, formato Tonelagem da súmula digital).
--
-- A Tonelagem (contrato v5 da estrutura da prova, Story 1.77) deriva o tipo
-- legado da prova da própria estrutura: type = 'tonnage', "maior vence", em kg
-- (soma de carga × repetições válidas). Sem este tipo na restrição CHECK, o
-- servidor não consegue gravar a prova (o INSERT/UPDATE de workouts falha).
--
-- Mudança (aditiva): workouts_type_check passa a aceitar 'tonnage', além dos
-- seis tipos de hoje (fortime, amrap, maxweight, reps, points, distance).
-- Nenhuma linha existente muda: todas já têm um dos seis tipos anteriores.
--
-- Fora desta migration, de propósito:
--   * as funções SQL de correção de qualifier têm uma lista própria de tipos
--     que podem ser reclassificados (amrap, reps, maxweight, distance, points);
--     a Tonelagem não entra nela agora, e mexer nessas funções exigiria
--     reescrever funções já aplicadas;
--   * scores.value já é NUMERIC (aceita kg com casas decimais) e scores.splits
--     já é JSONB: nenhuma coluna nova.
--
-- RLS e grants: workouts segue com RLS ligada e o acesso pela aplicação só por
-- service_role (rotas de API). Esta migration não mexe em policies.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS antes do ADD; reaplicar não muda nada.
--
-- Ordem de deploy: aplicar ANTES de publicar o construtor da Tonelagem (Story
-- 1.79). Até lá nenhuma prova de tonelagem pode ser salva pelo painel.
--
-- Rollback (em nova migration, depois de voltar o código e de reclassificar ou
-- apagar as provas de tonelagem; sem isso o ADD CONSTRAINT falha):
--   * ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_type_check;
--   * ALTER TABLE workouts ADD CONSTRAINT workouts_type_check
--       CHECK (type IN ('fortime', 'amrap', 'maxweight', 'reps', 'points', 'distance'));

ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_type_check;
ALTER TABLE workouts ADD CONSTRAINT workouts_type_check
  CHECK (type IN ('fortime', 'amrap', 'maxweight', 'reps', 'points', 'distance', 'tonnage'));
