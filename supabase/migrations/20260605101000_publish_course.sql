-- Migration para adicionar flag de percurso publicado nas categorias (divisions)
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS is_course_published BOOLEAN DEFAULT FALSE;
