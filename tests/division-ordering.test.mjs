import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');
const context = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
const divisionOrder = readFileSync(new URL('../src/lib/divisionOrder.ts', import.meta.url), 'utf8');
const bootstrapPayload = readFileSync(new URL('../src/lib/bootstrapPayload.ts', import.meta.url), 'utf8');
const persistence = readFileSync(new URL('../src/app/api/admin/persistence/route.ts', import.meta.url), 'utf8');
const fitnessRacing = readFileSync(new URL('../src/lib/fitnessRacing.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8');

test('migração cria order_index em divisions com backfill e índice', () => {
  const migrationPath = new URL('../supabase/migrations/20260730160000_division_order_index.sql', import.meta.url);
  assert.equal(existsSync(migrationPath), true, 'A migração de ordenação de categorias deve existir');

  const sql = readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE divisions\s+ADD COLUMN IF NOT EXISTS order_index INTEGER/i);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY event_id ORDER BY ctid\)/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_divisions_event_order/i);
});

test('helper puro de ordenação expõe as operações usadas pela UI', () => {
  assert.match(divisionOrder, /export const sortDivisions/);
  assert.match(divisionOrder, /export const getNextDivisionOrderIndex/);
  assert.match(divisionOrder, /export const moveDivisionId/);
  assert.match(divisionOrder, /export const shiftDivisionId/);
  assert.match(divisionOrder, /export const buildDivisionOrderMap/);
  // Categorias legadas (sem order_index) não podem sumir da lista
  assert.match(divisionOrder, /const FALLBACK_ORDER = Number\.MAX_SAFE_INTEGER/);
  assert.match(types, /orderIndex\?: number/);
});

test('bootstrap carrega order_index e o contexto ordena as categorias', () => {
  assert.match(bootstrapPayload, /PUBLIC_DIVISION_SELECT = '[^']*order_index/);
  assert.match(context, /const evDivs: Division\[\] = sortDivisions\(dbDivisions/);
  assert.match(context, /orderIndex: d\.order_index !== undefined && d\.order_index !== null \? Number\(d\.order_index\) : undefined/);
});

test('categoria nova entra no fim e updateDivision persiste a ordem', () => {
  assert.match(context, /orderIndex: getNextDivisionOrderIndex\(event\.divisions\)/);
  assert.match(context, /order_index: newDivision\.orderIndex/);
  assert.match(context, /dbPayload\.order_index = updatedData\.orderIndex/);
  assert.match(fitnessRacing, /orderIndex: index \+ 1/);
});

test('contexto expõe reorderDivisions com rollback otimista', () => {
  assert.match(context, /reorderDivisions: \(eventId: string, orderedIds: string\[\]\) => Promise<void>/);
  assert.match(context, /const reorderDivisions = async \(eventId: string, orderedIds: string\[\]\)/);
  assert.match(context, /throw new Error\('Ordem de categorias inválida para este evento\.'\)/);
  assert.match(context, /await adminPersist\('reorderDivisions', \{ eventId, orderedIds \}\)/);
});

test('persistência valida dono do evento e conjunto de categorias ao reordenar', () => {
  assert.match(persistence, /case 'reorderDivisions': \{/);
  assert.match(persistence, /case 'reorderDivisions': \{\s*\n\s*await ensureEventOwner\(supabaseAdmin, actor, payload\.eventId\)/);
  assert.match(persistence, /A ordem enviada nao corresponde as categorias deste evento\./);
  assert.match(persistence, /\.update\(\{ order_index: index \+ 1 \}\)\s*\n\s*\.eq\('id', divisionId\)\s*\n\s*\.eq\('event_id', payload\.eventId\)/);
});

test('painel de categorias permite arrastar e mover com setas', () => {
  assert.match(admin, /const \[draggedDivisionId, setDraggedDivisionId\] = useState\(''\)/);
  assert.match(admin, /const applyDivisionOrder = async \(orderedIds: string\[\]\)/);
  assert.match(admin, /const handleDropDivision = async \(targetDivisionId: string\)/);
  assert.match(admin, /const handleMoveDivision = async \(divisionId: string, direction: 'up' \| 'down'\)/);
  assert.match(admin, /onDragStart=\{\(\) => setDraggedDivisionId\(div\.id\)\}/);
  assert.match(admin, /onDrop=\{\(\) => handleDropDivision\(div\.id\)\}/);
  assert.match(admin, /aria-label=\{`Mover categoria \$\{div\.name\} para cima`\}/);
  assert.match(admin, /aria-label=\{`Mover categoria \$\{div\.name\} para baixo`\}/);
  // Falha ao salvar avisa o gestor (o contexto restaura a ordem anterior)
  assert.match(admin, /Não foi possível salvar a nova ordem das categorias\./);
  assert.match(admin, /disabled=\{divIndex === 0 \|\| isReorderingDivisions\}/);
  assert.match(admin, /disabled=\{divIndex === divisions\.length - 1 \|\| isReorderingDivisions\}/);
});

test('inscrições seguem a ordem das categorias definida pelo gestor', () => {
  assert.match(admin, /const divisionOrderMap = buildDivisionOrderMap\(divisions\)/);
  assert.match(admin, /getDivisionOrderPosition\(divisionOrderMap, a\.divisionId\)/);
  assert.match(admin, /new Date\(a\.createdAt\)\.getTime\(\) - new Date\(b\.createdAt\)\.getTime\(\)/);
});
