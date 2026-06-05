import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');
const context = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');

test('mapeamento de isCoursePublished no banco de dados e no contexto', () => {
  assert.match(context, /isCoursePublished: d\.is_course_published/);
  assert.match(context, /dbPayload\.is_course_published = updatedData\.isCoursePublished/);
});

test('lógica de auditoria em tempo real para percursos de Fitness Racing', () => {
  assert.match(admin, /courseAuditAlerts/);
  assert.match(admin, /O percurso de Fitness Racing deve conter exatamente 16 etapas\./);
  assert.match(admin, /O percurso deve alternar entre Corridas e Estações de Exercício\./);
});

test('funcionalidade de replicação e publicação de percursos', () => {
  assert.match(admin, /handlePublishActiveCourse/);
  assert.match(admin, /selectedDivisionIdsForCourse/);
  assert.match(admin, /saveCourseLayout/);
});

test('migração SQL de publicação de percursos existe', () => {
  const migrationPath = new URL('../supabase/migrations/20260605101000_publish_course.sql', import.meta.url);
  assert.equal(existsSync(migrationPath), true, 'A migração SQL deve existir');
  const sql = readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE divisions ADD COLUMN IF NOT EXISTS is_course_published/i);
});

test('alocação mista de atletas e seleção multi-categoria em Fitness Racing', () => {
  assert.match(admin, /isFitnessRacingTotal/);
  assert.match(admin, /allDivisionsAthletes/);
  assert.match(admin, /reversedIds/);
});
