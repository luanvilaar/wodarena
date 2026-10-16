import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.45 (AC2 a AC9) e Story 1.46: a súmula digital no formulário da prova
// (resumo e botão), o construtor em tela cheia com a súmula ao lado, a
// integração no painel, o tipo e o mapper de `structure`, o bootstrap de gestor
// com fallback e as páginas de desenvolvimento. Os componentes rodam em
// renderização de servidor; o comportamento interativo foi conferido no
// navegador (ver as stories).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const { WorkoutStructureEditor } = await importServerModule('components/admin/WorkoutStructureEditor.tsx');
const { SheetBuilderPanel } = await importServerModule('components/admin/WorkoutSheetBuilderDialog.tsx');
const editorLib = await importServerModule('lib/workoutStructureEditor.ts');
const { getWorkoutChanges } = await importServerModule('lib/workoutEdit.ts');
const { readWorkoutStructures, attachWorkoutStructures } = await importServerModule('lib/serverWorkoutStructures.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');

const admin = read('../src/app/admin/page.tsx');
const editorSource = read('../src/components/admin/WorkoutStructureEditor.tsx');
const dialogSource = read('../src/components/admin/WorkoutSheetBuilderDialog.tsx');
const formSource = read('../src/components/admin/SheetBuilderForm.tsx');
const appContext = read('../src/context/AppContext.tsx');
const types = read('../src/types/index.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const bootstrapPayload = read('../src/lib/bootstrapPayload.ts');

const { addLine, analyzeDraft, createDraft, setDraftFormat, toggleStepMark, updateLift, updateLine } = editorLib;

const franDraft = () => {
  let draft = createDraft('for_time');
  draft = updateLine(draft, 'forTime', draft.forTime.lines[0].key, { reps: '21-15-9', name: 'Thruster', load: '43' });
  draft = addLine(draft, 'forTime');
  draft = updateLine(draft, 'forTime', draft.forTime.lines[1].key, { name: 'Pull-up' });
  return toggleStepMark(draft, { line: draft.forTime.lines[1].key, round: 3 });
};
const fran = () => analyzeDraft(franDraft()).structure;

const renderEditor = (props) => renderToStaticMarkup(createElement(WorkoutStructureEditor, { onChange: () => {}, idPrefix: 't', ...props }));
const renderPanel = (draft, props = {}) => renderToStaticMarkup(createElement(SheetBuilderPanel, {
  initialDraft: draft, idPrefix: 'b', workoutName: 'Fran', onCancel: () => {}, onSave: () => {}, ...props
}));
const block = (source, pattern) => source.match(pattern)?.[0] || '';

// ---------------------------------------------------------------------------
// Súmula no formulário da prova (resumo e botão)
// ---------------------------------------------------------------------------

test('sem súmula: o formulário mostra só a explicação e o botão "Estruturar a súmula"', () => {
  const html = renderEditor({ value: null });
  assert.match(html, /Súmula digital/);
  assert.match(html, /<button[^>]*id="t-open"[^>]*>.*Estruturar a súmula<\/button>/s);
  assert.match(html, /repetições, movimento e carga, como no quadro do box/);
  assert.match(html, /A descrição em texto continua valendo para os atletas|a descrição em texto continua valendo para os atletas/);
  assert.doesNotMatch(html, /role="dialog"|Remover súmula/, 'o construtor só abre ao clicar');
});

test('com súmula: resumo, regra em frase, "Editar súmula" e "Remover súmula"', () => {
  const html = renderEditor({ value: fran() });
  assert.match(html, /For Time · 6 etapas · 90 repetições · cap 10:00/);
  assert.match(html, /vence o menor tempo ao concluir 9 Pull-up do round 3/);
  assert.match(html, /id="t-open"[^>]*>.*Editar súmula/s);
  assert.match(html, /id="t-remove"[^>]*>.*Remover súmula/s);
  assert.doesNotMatch(html, /role="dialog"/);
});

// ---------------------------------------------------------------------------
// Construtor em tela cheia (desenho aprovado: repetições, movimento e carga)
// ---------------------------------------------------------------------------

test('construtor For Time: formato, linhas com repetições, movimento e carga, etapas com bandeira, pontuação e regra', () => {
  const html = renderPanel(franDraft());
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="b-title"/);
  assert.match(html, /Construtor da súmula · Fran/);
  assert.match(html, /<button[^>]*id="b-format-for_time"[^>]*role="radio"[^>]*aria-checked="true"/);
  assert.match(html, /<button[^>]*id="b-format-amrap"[^>]*aria-checked="false"/);
  assert.match(html, /<button[^>]*id="b-format-max_load"[^>]*aria-checked="false"/);
  // Revisão QA (QA-146-3): um ponto de Tab no grupo (o formato escolhido); as setas trocam a escolha.
  assert.match(html, /id="b-format-for_time"[^>]*aria-checked="true"[^>]*tabindex="0"/i);
  assert.match(html, /id="b-format-amrap"[^>]*aria-checked="false"[^>]*tabindex="-1"/i);
  assert.match(formSource, /onKeyDown=\{handleFormatKeys\}/);
  assert.match(formSource, /event\.key === 'ArrowRight' \|\| event\.key === 'ArrowDown' \? 1 : event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowUp' \? -1 : 0/);
  assert.match(html, />Repetições<\/span><span[^>]*>Movimento<\/span><span[^>]*>Carga \(kg\)<\/span>/);
  assert.match(html, /aria-label="Repetições do movimento 1"[^>]*value="21-15-9"/);
  assert.match(html, /aria-label="Movimento 1"[^>]*value="Thruster"/);
  assert.match(html, /aria-label="Carga do movimento 1 em kg"[^>]*value="43"/);
  assert.match(html, /aria-label="Movimento 2"[^>]*value="Pull-up"/);
  assert.match(html, /<input[^>]*id="b-ft-rounds"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*id="b-ft-rounds"/);
  assert.match(html, /Definido pela sequência de repetições \(3 rounds\)\./);
  assert.equal((html.match(/aria-label="Marcar o tempo de desempate ao concluir /g) || []).length, 6);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="Marcar o tempo de desempate ao concluir 9 Pull-up, round 3"/);
  assert.match(html, /Time cap \(MM:SS\)/);
  assert.match(html, /Penalidade por repetição \(s\)/);
  assert.match(html, /Quem terminar as <\/span><strong[^>]*>90 repetições<\/strong>/);
  assert.match(html, /6 etapas na súmula, 90 repetições/);
  assert.match(html, /Como o judge verá/);
  assert.match(html, /aria-label="Súmula digital"/, 'a súmula do judge aparece ao lado');
  assert.match(html, /Súmula pronta\. Ela é gravada quando você salvar a prova\./);
  assert.doesNotMatch(html, /<button[^>]*id="b-use"[^>]*disabled=""/);
  // A montagem (antes da súmula do judge) não usa o vocabulário do editor antigo.
  assert.doesNotMatch(html.slice(0, html.indexOf('Como o judge verá')), /segmento|Gerar segmentos|Esquema e movimentos/i);
});

test('construtor com problema: itens a corrigir, sem súmula ao lado e "Usar esta súmula" desligado', () => {
  const html = renderPanel(createDraft('for_time'));
  assert.match(html, /1 item para corrigir na regra da prova\./);
  assert.match(html, /<button[^>]*id="b-use"[^>]*disabled=""/);
  assert.match(html, /Corrija os itens marcados com ! para ver a súmula\./);
  assert.match(html, /Linha 1: informe o movimento; informe as repetições\./);
  assert.match(html, /A regra aparece aqui quando os itens marcados com ! forem corrigidos\./);
});

test('construtor AMRAP e carga máxima: campos de cada formato', () => {
  let amrap = setDraftFormat(createDraft('for_time'), 'amrap');
  amrap = updateLine(amrap, 'amrap', amrap.amrap.lines[0].key, { reps: '10', name: 'Thruster' });
  const amrapHtml = renderPanel(amrap);
  assert.match(amrapHtml, /Um round/);
  assert.match(amrapHtml, /Duração \(MM:SS\)/);
  assert.match(amrapHtml, /Score exibido/);
  assert.match(amrapHtml, /Tempo do último round completo/);
  assert.doesNotMatch(amrapHtml, /Penalidade|Time cap \(MM:SS\)/);

  let maxLoad = setDraftFormat(createDraft('for_time'), 'max_load');
  maxLoad = updateLift(maxLoad, maxLoad.maxLoad.lifts[0].key, { name: 'Back Squat', load: '100' });
  const maxHtml = renderPanel(maxLoad);
  assert.match(maxHtml, /Movimentos de carga/);
  assert.match(maxHtml, />Reps \/ tentativa<\/span><span[^>]*>Movimento<\/span><span[^>]*>Carga inicial \(kg\)<\/span><span[^>]*>Tentativas<\/span>/);
  assert.match(maxHtml, /aria-label="Carga inicial do movimento 1 em kg"[^>]*value="100"/);
  assert.match(maxHtml, /Janela de tempo \(MM:SS, vazio = sem janela\)/);
  assert.match(maxHtml, /Incremento mínimo \(kg\)/);
  assert.match(maxHtml, /Tempo em que terminou o último movimento/);
  assert.match(maxHtml, /aria-label="Súmula digital de carga máxima"/);
});

test('construtor em portal, com rascunho próprio, Esc, foco preso e confirmação ao descartar; sem rede nem armazenamento', () => {
  for (const source of [editorSource, dialogSource, formSource]) {
    assert.doesNotMatch(source, /fetch\(|useApp|supabase|localStorage|sessionStorage/);
  }
  assert.match(dialogSource, /createPortal\(<SheetBuilderPanel \{\.\.\.props\} \/>, document\.body\)/);
  assert.match(dialogSource, /if \(!open \|\| typeof document === 'undefined'\) return null;/);
  assert.match(dialogSource, /<SheetDemo\s+key=\{JSON\.stringify\(analysis\.structure\)\}/);
  assert.match(dialogSource, /if \(event\.key === 'Escape'\)/);
  assert.match(dialogSource, /Descartar as mudanças da súmula\?/);
  assert.match(dialogSource, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(editorSource, /draftFromStructure\(value\)/);
  assert.match(editorSource, /createDraft\(value\?\.format \?\? defaultFormat, \{ timeCap: timeCapHint \}\)/);
  assert.match(editorSource, /onClick=\{\(\) => onChange\(null\)\}/);
  assert.doesNotMatch(editorSource + formSource, /entry\.(mode|marking|publish)|setEntry/, 'configurações de entrada ficam fora');
});

// ---------------------------------------------------------------------------
// Integração no painel
// ---------------------------------------------------------------------------

test('painel: a súmula só aparece em evento Functional Fitness e para provas de tempo, AMRAP ou carga', () => {
  assert.match(admin, /import \{ WorkoutStructureEditor \} from '@\/components\/admin\/WorkoutStructureEditor';/);
  assert.match(admin, /const workoutStructureSupported = !selectedEventToManage\?\.eventType \|\| selectedEventToManage\.eventType === 'functional_fitness';/);
  assert.match(admin, /\{workoutStructureSupported && \(wodStructure \|\| wodType === 'fortime' \|\| wodType === 'amrap' \|\| wodType === 'maxweight'\) && \(\s*<WorkoutStructureEditor\s+key=\{editingWorkoutId \|\| 'nova-prova'\}\s+value=\{wodStructure\}\s+onChange=\{handleWorkoutStructureChange\}\s+defaultFormat=\{wodType === 'amrap' \? 'amrap' : wodType === 'maxweight' \? 'max_load' : 'for_time'\}\s+workoutName=\{wodName\}\s+timeCapHint=\{wodTimeCap\}\s+lockedSheets=\{editingWorkoutId \? sheetLocks\[editingWorkoutId\] \?\? 0 : 0\}\s+idPrefix="wod-structure"/);
  assert.equal((admin.match(/<WorkoutStructureEditor\b/g) || []).length, 1);
});

test('painel: com estrutura, tipo, time cap e desempate espelham o derivado e ficam somente leitura', () => {
  const change = block(admin, /const handleWorkoutStructureChange = \(next: WorkoutStructure \| null\) => \{[\s\S]*?\n {2}\};/);
  assert.match(change, /setWodStructure\(next\);\s*if \(!next\) return;/);
  assert.match(change, /const checked = validateWorkoutStructure\(next\);\s*if \(!checked\.ok\) return;/);
  assert.match(change, /setWodType\(derived\.type\);\s*setWodTimeCap\(derived\.timeCap\);\s*setWodTieBreaker\(derived\.tieBreaker\);/);
  assert.match(admin, /disabled=\{scoreTypeLocked \|\| Boolean\(wodStructure\)\}/);
  assert.match(admin, /value=\{wodTimeCap\}\s+readOnly=\{Boolean\(wodStructure\)\}/);
  assert.match(admin, /value=\{wodTieBreaker\}\s+disabled=\{Boolean\(wodStructure\)\}/);
  assert.match(admin, /Tipo de score, time cap e desempate vêm da estrutura da prova/);
});

test('painel: salvar valida a estrutura, bloqueia com aviso e foco, e só envia structure quando cabe', () => {
  const save = block(admin, /const handleCreateWorkout = async \(e: React\.FormEvent\) => \{[\s\S]*?\n {2}\};/);
  assert.match(save, /if \(wodStructure && workoutStructureSupported\) \{\s*const checked = validateWorkoutStructure\(wodStructure\);\s*if \(!checked\.ok\) \{\s*setAdminNotice\(\{ text: `Revise a estrutura da prova: \$\{checked\.error\}`, tone: 'error' \}\);\s*document\.getElementById\('wod-structure-open'\)\?\.focus\(\);\s*return;/);
  assert.match(save, /legacyFields = deriveLegacyWorkoutFields\(checked\.structure\);/);
  assert.match(save, /type: legacyFields \? legacyFields\.type : wodType,/);
  assert.match(save, /timeCap: \(legacyFields \? legacyFields\.timeCap : wodTimeCap\) \|\| undefined,/);
  assert.match(save, /tieBreaker: legacyFields \? legacyFields\.tieBreaker : wodTieBreaker,/);
  assert.match(save, /\.\.\.\(workoutStructureSupported && \(structureForSave \|\| editingWorkoutId\) \? \{ structure: structureForSave \} : \{\}\),/);
  assert.ok(save.indexOf('validateWorkoutStructure(wodStructure)') < save.indexOf('await addWorkout('), 'valida antes de criar');
  assert.ok(save.indexOf('validateWorkoutStructure(wodStructure)') < save.indexOf('await updateWorkout('), 'valida antes de editar');
});

test('painel: editar carrega a estrutura, cancelar e resetar a limpam, e a lista mostra a súmula digital', () => {
  assert.match(admin, /setWodStructure\(workout\.structure \?\? null\);/);
  assert.match(block(admin, /const resetWorkoutForm = \(\) => \{[\s\S]*?\n {2}\};/), /setWodStructure\(null\);/);
  assert.match(admin, /\{wod\.structure && \(\s*<p [^>]*>\s*Súmula digital · \{summarizeStructure\(wod\.structure\)\}/);
});

test('painel: eventos Fitness Racing e Qualifier não recebem nem enviam estrutura', () => {
  // O editor depende de workoutStructureSupported, e a chave structure só entra no payload nesse caso.
  // Story 1.52: o resumo das súmulas (trava e confirmação do lançamento manual) também só em evento presencial.
  assert.equal((admin.match(/workoutStructureSupported/g) || []).length, 5);
  assert.match(admin, /const sheetOverviewEventId = workoutStructureSupported && \(activeEventTab === 'wods' \|\| activeEventTab === 'scores'\)/);
});

// ---------------------------------------------------------------------------
// Tipo, mapper e persistência no cliente
// ---------------------------------------------------------------------------

test('Workout.structure, mapper e envio no AppContext', () => {
  assert.match(types, /import type \{ WorkoutStructure \} from '@\/lib\/workoutStructure';/);
  assert.match(types, /structure\?: WorkoutStructure \| null;/);
  assert.match(appContext, /const readWorkoutStructure = \(raw: unknown\): WorkoutStructure \| undefined => \{\s*if \(raw === null \|\| raw === undefined\) return undefined;\s*const result = validateWorkoutStructure\(raw\);\s*return result\.ok \? result\.structure : undefined;/);
  assert.match(appContext, /structure: readWorkoutStructure\(w\.structure\),/);
  assert.match(appContext, /\.\.\.\(newWorkout\.structure \? \{ structure: newWorkout\.structure \} : \{\}\),/);
  assert.match(appContext, /if \(Object\.hasOwn\(updatedData, 'structure'\)\) dbData\.structure = updatedData\.structure \?\? null;/);
  assert.match(appContext, /structure: WorkoutStructure \| null;/);
});

test('getWorkoutChanges compara a estrutura por conteúdo e trata null como desligada', () => {
  const structure = validateWorkoutStructure(fran()).structure;
  const form = (overrides = {}) => ({
    name: 'Fran', description: 'x', type: 'fortime', timeCap: '10:00', code: 'W1', orderIndex: 1, divisionId: undefined,
    tieBreaker: 'Tempo', submissionOpensAt: undefined, submissionClosesAt: undefined, ...overrides
  });
  const original = { id: 'w1', ...form({ structure }) };

  assert.deepEqual(getWorkoutChanges(original, form({ structure: structuredClone(structure) })), {}, 'mesmo conteúdo, sem mudança');
  const edited = { ...structure, totalReps: 89, segments: structure.segments.map((item) => (item.id === 's1' ? { ...item, reps: 20 } : item)) };
  assert.equal(validateWorkoutStructure(edited).ok, true);
  assert.deepEqual(Object.keys(getWorkoutChanges(original, form({ structure: edited }))), ['structure']);
  assert.deepEqual(getWorkoutChanges(original, form({ structure: null })), { structure: null }, 'desligar envia null');
  assert.deepEqual(getWorkoutChanges({ id: 'w2', ...form() }, form({ structure: null })), {}, 'sem estrutura nos dois lados: nada');
  assert.deepEqual(getWorkoutChanges({ id: 'w2', ...form() }, form()), {});
  assert.deepEqual(getWorkoutChanges({ id: 'w2', ...form() }, form({ structure })), { structure }, 'ligar envia a estrutura');
});

// ---------------------------------------------------------------------------
// Bootstrap autenticado
// ---------------------------------------------------------------------------

test('bootstrap: gestor e dono recebem structure por leitura própria; os outros papéis e o público não', () => {
  assert.match(bootstrapRoute, /import \{ attachWorkoutStructures, readWorkoutStructures \} from '@\/lib\/serverWorkoutStructures';/);
  assert.match(bootstrapRoute, /session\.role === 'manager' \|\| session\.role === 'owner'\s*\? readWorkoutStructures\(supabaseAdmin, session\.role === 'manager' \? eventIdFilter : null\)\s*: Promise\.resolve\(new Map<string, unknown>\(\)\)/);
  assert.match(bootstrapRoute, /const workouts = attachWorkoutStructures\(workoutRows, workoutStructures\);/);
  assert.doesNotMatch(bootstrapPayload, /structure/, 'o bootstrap público não conhece structure');
  const publicSelect = bootstrapPayload.match(/export const PUBLIC_WORKOUT_SELECT = '([^']*)'/)[1];
  assert.doesNotMatch(publicSelect, /structure/);
  assert.equal((bootstrapRoute.match(/\.from\('workouts'\)/g) || []).length, 2, 'as consultas de provas continuam as mesmas');
});

test('readWorkoutStructures: escopo por evento do gestor, todas para o dono e só provas com estrutura', async () => {
  const database = createFakeSupabase({
    workouts: [
      { id: 'w1', event_id: 'e1', structure: { version: 1 } },
      { id: 'w2', event_id: 'e1', structure: null },
      { id: 'w3', event_id: 'e2', structure: { version: 1, x: 1 } },
      { id: 'w4', event_id: 'e3' }
    ]
  });
  const manager = await readWorkoutStructures(database.client, ['e1']);
  assert.deepEqual([...manager.keys()], ['w1']);
  const multi = await readWorkoutStructures(database.client, ['e1', 'e2']);
  assert.deepEqual([...multi.keys()].sort(), ['w1', 'w3']);
  const owner = await readWorkoutStructures(database.client, null);
  assert.deepEqual([...owner.keys()].sort(), ['w1', 'w3']);
  assert.equal((await readWorkoutStructures(database.client, [])).size, 0, 'gestor sem eventos: nenhuma consulta');
});

test('attachWorkoutStructures junta só onde há estrutura e não toca nas outras linhas', () => {
  const rows = [{ id: 'w1', name: 'A' }, { id: 'w2', name: 'B' }];
  assert.equal(attachWorkoutStructures(rows, new Map()), rows, 'sem estruturas devolve as mesmas linhas');
  const merged = attachWorkoutStructures(rows, new Map([['w2', { version: 1 }]]));
  assert.deepEqual(merged, [{ id: 'w1', name: 'A' }, { id: 'w2', name: 'B', structure: { version: 1 } }]);
  assert.equal('structure' in merged[0], false);
  assert.equal('structure' in rows[1], false, 'não muta a linha original');
});

test('readWorkoutStructures tolera banco sem a coluna (42703 e PGRST204) e propaga outros erros', async (t) => {
  const failing = (error) => {
    const result = Promise.resolve({ data: null, error });
    return { from: () => ({ select: () => Object.assign(Promise.resolve({ data: null, error }), { in: () => result }) }) };
  };
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});

  for (const code of ['42703', 'PGRST204']) {
    for (const ids of [['e1'], null]) {
      const result = await readWorkoutStructures(failing({ code, message: 'column workouts.structure does not exist' }), ids);
      assert.equal(result.size, 0, `${code} ${ids}`);
    }
  }
  await assert.rejects(readWorkoutStructures(failing({ code: '42703', message: 'column workouts.outra does not exist' }), ['e1']), /Falha ao carregar estruturas das provas/);
  await assert.rejects(readWorkoutStructures(failing({ code: '57014', message: 'timeout' }), null), /Falha ao carregar estruturas das provas/);
});

// ---------------------------------------------------------------------------
// Páginas de desenvolvimento e arquivos que não mudam
// ---------------------------------------------------------------------------

test('as páginas de pré-visualização só existem em desenvolvimento', () => {
  for (const path of ['../src/app/[locale]/sumula-preview/page.tsx', '../src/app/[locale]/sumula-preview/editor/page.tsx']) {
    assert.match(read(path), /if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/, path);
  }
  assert.match(read('../src/components/sheet/SheetPreview.tsx'), /<SheetDemo/);
  assert.match(read('../src/components/sheet/EditorPreview.tsx'), /<WorkoutStructureEditor/);
});

test('o motor, a persistência, o judge e as dependências seguem como estavam', () => {
  assert.doesNotMatch(read('../src/lib/workoutStructure.ts'), /workoutStructureEditor|WorkoutStructureEditor|SheetDemo/);
  assert.doesNotMatch(read('../src/app/api/admin/persistence/route.ts'), /workoutStructureEditor|WorkoutStructureEditor/);
  assert.doesNotMatch(read('../src/app/judge/page.tsx'), /WorkoutStructureEditor|SheetDemo|SheetView/);
  assert.doesNotMatch(read('../package.json'), /"mapbox-gl"[\s\S]*"zod"|"zod"|"react-hook-form"/);
  assert.match(editorLib.describeStructureProblem.toString(), /validateWorkoutStructure/);
});
