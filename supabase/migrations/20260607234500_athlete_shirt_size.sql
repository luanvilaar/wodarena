-- Coleta de tamanho de camisa para montagem de kits dos atletas.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS shirt_size TEXT;
