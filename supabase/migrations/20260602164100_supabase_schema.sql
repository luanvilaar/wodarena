-- Script SQL para Configuração do Banco de Dados no Supabase
-- Copie e cole este script no painel SQL Editor do seu projeto Supabase

-- 1. Criar tabela de usuários
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
    organization TEXT
);

-- 2. Criar tabela de eventos
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo_url TEXT NOT NULL,
    banner_url TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('upcoming', 'live', 'finished')),
    location TEXT NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    organizer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sponsors TEXT[] DEFAULT '{}'::TEXT[],
    format TEXT DEFAULT 'individual' CHECK (format IN ('individual', 'duo', 'trio')),
    ticket_price NUMERIC DEFAULT 150.00,
    ticket_slots INTEGER DEFAULT 100,
    is_ticketing_active BOOLEAN DEFAULT TRUE
);

-- 3. Criar tabela de divisões
CREATE TABLE IF NOT EXISTS divisions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('male', 'female', 'team'))
);

-- 4. Criar tabela de provas (workouts)
CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('fortime', 'amrap', 'maxweight', 'reps')),
    time_cap TEXT
);

-- 5. Criar tabela de atletas
CREATE TABLE IF NOT EXISTS athletes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    box TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'BR',
    division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE
);

-- 6. Criar tabela de pontuações (scores)
CREATE TABLE IF NOT EXISTS scores (
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    result TEXT NOT NULL,
    value NUMERIC NOT NULL,
    rank INTEGER,
    points INTEGER,
    PRIMARY KEY (athlete_id, workout_id)
);

-- 7. Criar tabela de inscrições (registrations)
CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
    athlete_name TEXT NOT NULL,
    athlete_email TEXT NOT NULL,
    athlete_phone TEXT NOT NULL,
    box TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
    ticket_type TEXT NOT NULL,
    ticket_price NUMERIC NOT NULL,
    quantity INTEGER NOT NULL,
    total_paid NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Inserir contas iniciais para demonstração (se as tabelas estiverem vazias)
INSERT INTO users (id, name, email, password, role, organization)
VALUES 
('owner-1', 'Luan Vilaar', 'l.vilaar@gmail.com', 'owner', 'owner', 'WODArena Corp'),
('org-1', 'Gestor Carioca', 'org1@wodarena.com', 'manager1', 'manager', 'Carioca Box'),
('org-2', 'Gestor Warmup', 'org2@wodarena.com', 'manager2', 'manager', 'Warmup Box')
ON CONFLICT (id) DO NOTHING;

-- 9. Dados iniciais de demonstração limpos para início de testes manuais.

ALTER TABLE events ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'individual' CHECK (format IN ('individual', 'duo', 'trio'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_price NUMERIC DEFAULT 150.00;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_slots INTEGER DEFAULT 100;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_ticketing_active BOOLEAN DEFAULT TRUE;

-- 15. Colunas para reestruturação e enriquecimento do painel
ALTER TABLE events ADD COLUMN IF NOT EXISTS time TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS rules TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_schedule JSONB DEFAULT '[]'::JSONB;

-- Atualização na tabela divisions (Categorias)
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'individual' CHECK (type IN ('individual', 'duo', 'trio', 'team'));
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS slots_limit INTEGER DEFAULT 100;
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 150.00;
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Atualização na tabela workouts (Provas)
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS code TEXT DEFAULT '';
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 1;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS division_id TEXT REFERENCES divisions(id) ON DELETE CASCADE;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS tie_breaker TEXT DEFAULT '';

-- Atualização na restrição CHECK de workouts.type
ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_type_check;
ALTER TABLE workouts ADD CONSTRAINT workouts_type_check CHECK (type IN ('fortime', 'amrap', 'maxweight', 'reps', 'points', 'distance'));

-- Atualização na tabela athletes para perfis detalhados de atletas e equipes
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS birth_date TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS is_team BOOLEAN DEFAULT FALSE;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS team_members JSONB DEFAULT '[]'::JSONB;
