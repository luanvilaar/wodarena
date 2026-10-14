-- Camisa opcional com adicional na inscrição (Story 1.38).
--
-- Até aqui a camisa era só um campo de cadastro (athletes.shirt_size e
-- team_members[].shirtSize), sem efeito no preço. O gestor passa a escolher,
-- por evento, se a camisa vem inclusa no valor da inscrição ou se é um
-- adicional opcional com valor próprio. A inscrição guarda quantas camisas
-- foram cobradas e quanto custaram, para que a conta
-- ticket_price × quantity − desconto + shirt_addon_amount = total_paid
-- (antes do mínimo de R$ 1,00) possa ser conferida depois.
--
-- Mudanças (todas aditivas e com padrão; eventos e inscrições existentes ficam
-- em 'included' / 0 sem backfill e sem mudar de comportamento):
--   1. events.shirt_mode ('included' | 'optional') e events.shirt_addon_price.
--   2. events_optional_shirt_has_price: modo 'optional' exige adicional > 0.
--   3. registrations.shirt_addon_count e registrations.shirt_addon_amount.
--
-- "Sem camisa" não ganha coluna: é o valor reservado 'NONE' em
-- athletes.shirt_size e em team_members[].shirtSize (texto livre, sem CHECK).
-- admin_update_registration_details (20260718120000) grava o tamanho recebido
-- sem validar, então já aceita 'NONE'; a validação de tamanho e a regra de
-- edição (só troca de tamanho) ficam no servidor.
--
-- RLS e grants: events e registrations seguem com RLS ligada e sem policy de
-- leitura para anon/authenticated (20260608120000 e 20260621153000); não há
-- GRANT por coluna nem view sobre elas. A aplicação lê e grava por service_role.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS e cada CHECK nomeado só é criado se
-- ainda não existir. Reaplicar não falha nem altera dados.
--
-- Ordem de deploy: aplicar antes de publicar o código da Story 1.38, que pede
-- estas colunas no bootstrap e no checkout.
--
-- Rollback (em nova migration, depois de voltar o código; perde o modo, o
-- adicional e os valores de camisa cobrados):
--   * ALTER TABLE events DROP CONSTRAINT IF EXISTS events_optional_shirt_has_price;
--   * ALTER TABLE events DROP COLUMN IF EXISTS shirt_addon_price, DROP COLUMN IF EXISTS shirt_mode;
--   * ALTER TABLE registrations DROP COLUMN IF EXISTS shirt_addon_amount, DROP COLUMN IF EXISTS shirt_addon_count;
--   Tamanhos 'NONE' já gravados em athletes continuam como texto.

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

-- Padrão constante: no Postgres 11+ o ADD COLUMN não reescreve a tabela e as
-- linhas existentes passam a ler o padrão.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS shirt_mode TEXT NOT NULL DEFAULT 'included',
  ADD COLUMN IF NOT EXISTS shirt_addon_price NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS shirt_addon_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shirt_addon_amount NUMERIC NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. CHECKs com nome fixo
-- ---------------------------------------------------------------------------

-- Fora do ADD COLUMN para não depender dele: se a coluna já existir, o CHECK
-- inline seria pulado junto. Cada um só é criado quando ainda não existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_shirt_mode_check'
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_shirt_mode_check
      CHECK (shirt_mode IN ('included', 'optional'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_shirt_addon_price_check'
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_shirt_addon_price_check
      CHECK (shirt_addon_price >= 0);
  END IF;

  -- Camisa opcional sem valor viraria camisa grátis sem o gestor perceber.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_optional_shirt_has_price'
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_optional_shirt_has_price
      CHECK (shirt_mode <> 'optional' OR shirt_addon_price > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.registrations'::regclass AND conname = 'registrations_shirt_addon_count_check'
  ) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_shirt_addon_count_check
      CHECK (shirt_addon_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.registrations'::regclass AND conname = 'registrations_shirt_addon_amount_check'
  ) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_shirt_addon_amount_check
      CHECK (shirt_addon_amount >= 0);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Documentação das colunas
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.events.shirt_mode IS
  'Camisa do evento: included (vem no valor da inscrição; padrão e comportamento anterior) ou optional (adicional por participante que escolhe tamanho). "Sem camisa" não é coluna: é o valor NONE em athletes.shirt_size e team_members[].shirtSize, aceito pelo servidor só em optional.';

COMMENT ON COLUMN public.events.shirt_addon_price IS
  'Valor adicional por camisa, na moeda do evento. Em optional precisa ser > 0 (events_optional_shirt_has_price). Em included é ignorado e fica guardado para o gestor reencontrar ao voltar para optional.';

COMMENT ON COLUMN public.registrations.shirt_addon_count IS
  'Quantas camisas foram cobradas como adicional nesta inscrição (participantes com tamanho P, M, G ou GG em evento optional). 0 em evento included, para quem escolheu NONE (sem camisa, em athletes.shirt_size / team_members[].shirtSize) e nas inscrições anteriores à Story 1.38.';

COMMENT ON COLUMN public.registrations.shirt_addon_amount IS
  'Valor cobrado pelas camisas (shirt_addon_count × adicional do evento no momento da inscrição), já somado em total_paid e fora do desconto do cupom. Retrato da cobrança: não muda se o evento for reconfigurado depois.';
