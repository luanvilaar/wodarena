-- Datas estruturadas do evento (Story 1.71).
--
-- Até aqui a data do evento era só texto livre (events.date, ex.: "17 e 18 de
-- outubro"). O app lia esse texto para decidir se o evento já aconteceu; sem
-- ano, a leitura falhava e o evento seguia "aberto" na home e no checkout. O
-- gestor passa a informar o primeiro e o último dia em seletores de data, e o
-- texto vira só o rótulo de exibição.
--
-- Mudanças (aditivas):
--   1. events.start_date e events.end_date (DATE, nullable, sem default).
--   2. events_date_range_check: as duas preenchidas ou as duas NULL, e o fim
--      não antes do início.
--   3. Preenchimento dos 22 eventos existentes em 2026-10-26, a partir do texto
--      de cada um e conferido contra o cronograma. Os que estavam sem ano
--      receberam 2026 (o cronograma de todos está em 2026). Só preenche linha
--      ainda sem data: reaplicar não sobrescreve ajuste feito pelo gestor.
--
-- Evento sem as datas (criado antes do deploy, ou fora da lista abaixo) segue
-- a regra antiga, pela leitura do texto (src/lib/eventStatus.ts). A validação
-- de entrada fica também no servidor (resolveEventDatesForWrite em
-- src/lib/eventDates.ts, usado por /api/admin/persistence).
--
-- RLS e grants: events segue com RLS ligada e sem policy de leitura para
-- anon/authenticated; a aplicação lê e grava por service_role, e o bootstrap
-- expõe as colunas pelo PUBLIC_EVENT_SELECT.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CHECK criado só se não existir e
-- UPDATE só onde start_date ainda é NULL.
--
-- Ordem de deploy: aplicar ANTES de publicar o código da Story 1.71. O
-- bootstrap e o checkout toleram a coluna ausente, mas salvar evento pelo
-- painel sem a migration falha. Se o PostgREST não recarregar o schema sozinho:
-- NOTIFY pgrst, 'reload schema';
--
-- Rollback (em nova migration, depois de voltar o código; perde as datas
-- informadas pelos gestores):
--   * ALTER TABLE events DROP CONSTRAINT IF EXISTS events_date_range_check;
--   * ALTER TABLE events DROP COLUMN IF EXISTS end_date, DROP COLUMN IF EXISTS start_date;

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- ---------------------------------------------------------------------------
-- 2. CHECK com nome fixo
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_date_range_check'
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_date_range_check
      CHECK (
        (start_date IS NULL AND end_date IS NULL)
        OR (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Preenchimento dos eventos existentes
-- ---------------------------------------------------------------------------

UPDATE public.events AS e
SET start_date = v.start_date::date,
    end_date = v.end_date::date
FROM (VALUES
  -- Sem ano no texto; ano confirmado pelo cronograma.
  ('evt-org-1788227050436-x-games-2-0-mti0pt4w-k4ujvn', '2026-10-17', '2026-10-18'),               -- "17 e 18 de outubro"
  ('evt-org-1789233456519-cn-games-26-provins-ground-mu1la0r9-qop2rv', '2026-10-17', '2026-10-18'), -- "17 E 18 DE OUTUBRO"
  ('evt-org-1787075957072-qualifier-selva-2027-msyzn6mf-7u3ivc', '2026-10-05', '2026-10-20'),       -- "05 a 20 de Outubro"
  ('evt-org-1791714452929-wod-base-games-2026-mv5chaor-8qbml4', '2026-11-20', '2026-11-21'),        -- "20 e 21 de Novembro"
  ('evt-org-1787842059881-hero-games-2026-mtd030mw-zxp8u5', '2026-11-07', '2026-11-08'),           -- "07 e 08 de Novembro"
  -- Com ano no texto.
  ('evt-org-1785863912310-new-city-games-msexcq7h-z3e02r', '2026-08-15', '2026-08-15'),
  ('evt-org-1790087286337-bravos-games-2-0-muo4b2op-3smlv0', '2026-11-28', '2026-11-28'),
  ('evt-org-1784315946309-athletic-games-edicao-outubro-2026-mv8gpw94-1y05dd', '2026-10-24', '2026-10-24'),
  ('evt-org-1791488175361-chua-experience-cup-mv09cs85-blyamw', '2026-11-07', '2026-11-07'),
  ('evt-org-1-luan-angelino-vilar-ms7btfwf-nu0307', '2026-11-14', '2026-11-14'),
  ('evt-org-1780879466859-sertao-hybrid-run-mq5hxil9-wv7zdo', '2026-08-29', '2026-08-29'),
  ('evt-org-1780938999213-copa-intergames-bull-mq5hyg7r-maoee5', '2026-06-13', '2026-06-13'),
  ('evt-org-1784315946309-hypulse-challenge-edicao-setembro-2026-ms3ajhpk-zr0z8h', '2026-09-12', '2026-09-12'),
  ('evt-org-1-training-camp-fitblock-mri7wxfh-647720', '2026-08-29', '2026-08-29'),
  ('evt-org-1790966023625-simulado-haus-murazxaq-kzckwv', '2026-10-10', '2026-10-10'),
  ('evt-org-1780663725088-simulado-hibrido-race-mv8oewvj-pjxjfz', '2026-10-31', '2026-10-31'),
  ('evt-org-1786956092437-natal-wod-champions-mswzkvjr-cq2kuo', '2026-11-14', '2026-11-14'),
  ('evt-org-1784315946309-hypulse-challenge-edicao-julho-mrpdlto8-qjp847', '2026-07-25', '2026-07-25'),
  ('evt-org-1-hibirdo-race-mto5ilom-9odh15', '2026-11-14', '2026-11-14'),
  ('evt-org-1780663725088-wodarena-mvcu5oca-aw4xrt', '2026-12-12', '2026-12-12'),
  ('evt-org-1787075957072-selva-2027-presencial-mvfin7mf-ldbdhr', '2027-01-16', '2027-01-16'),
  ('evt-org-1791226434862-batalha-light-box-mva1gn0g-d2fno4', '2026-10-24', '2026-10-24')
) AS v(id, start_date, end_date)
WHERE e.id = v.id
  AND e.start_date IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Documentação das colunas
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.events.start_date IS
  'Primeiro dia do evento (data local do evento, sem hora). Preenchido junto com end_date (events_date_range_check). NULL nas duas = evento antigo: a aplicação lê o texto de events.date.';

COMMENT ON COLUMN public.events.end_date IS
  'Último dia do evento. O evento conta como realizado a partir da meia-noite seguinte, no fuso events.time_zone; essa regra decide a home, a página do evento e a trava de inscrição do checkout.';
