-- Adiciona a coluna event_type para classificar a modalidade do evento
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'functional_fitness' CHECK (event_type IN ('functional_fitness', 'fitness_racing'));

-- Adiciona suporte a faixas etárias opcionais nas divisões
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS use_age_groups BOOLEAN DEFAULT FALSE;

-- Adiciona a coluna course_layout nas divisões para persistir o layout de etapas do percurso (Corridas/Estações)
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS course_layout JSONB DEFAULT '[]'::JSONB;

-- Adiciona a coluna splits nas pontuações (scores) para persistir os tempos de cada etapa do percurso
ALTER TABLE scores ADD COLUMN IF NOT EXISTS splits JSONB DEFAULT '{}'::JSONB;
