-- Atualizar a constraint CHECK de divisions para aceitar team4 e team6
ALTER TABLE divisions DROP CONSTRAINT IF EXISTS divisions_type_check;
ALTER TABLE divisions ADD CONSTRAINT divisions_type_check CHECK (type IN ('individual', 'duo', 'trio', 'team', 'team4', 'team6'));
