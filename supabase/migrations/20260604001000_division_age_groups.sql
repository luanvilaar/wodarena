-- Adiciona suporte a faixas etárias customizadas persistidas como array JSONB na tabela divisions
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS age_groups JSONB DEFAULT '[]'::JSONB;
