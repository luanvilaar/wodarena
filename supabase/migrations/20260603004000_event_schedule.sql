-- Cronograma publico do evento: briefing, entrega de kits e programacao oficial.
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_schedule JSONB DEFAULT '[]'::JSONB;
