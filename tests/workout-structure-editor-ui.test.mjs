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
// navegador (ver as stories). Story 1.61: o quarto formato, Intervalado
// (Maquete 1 de docs/design/intervalado/).

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

const {
  addLine, analyzeDraft, createDraft, removeLine, setDraftFormat, toggleStepMark, updateIntervalMax, updateIntervalTiming, updateLift, updateLine
} = editorLib;

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
  assert.match(html, /<button[^>]*id="b-format-interval"[^>]*aria-checked="false"[^>]*tabindex="-1"/i);
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

test('painel: a súmula só aparece em evento Functional Fitness e para provas de tempo, AMRAP, carga ou distância', () => {
  assert.match(admin, /import \{ WorkoutStructureEditor \} from '@\/components\/admin\/WorkoutStructureEditor';/);
  assert.match(admin, /const workoutStructureSupported = !selectedEventToManage\?\.eventType \|\| selectedEventToManage\.eventType === 'functional_fitness';/);
  assert.match(admin, /\{workoutStructureSupported && \(wodStructure \|\| wodType === 'fortime' \|\| wodType === 'amrap' \|\| wodType === 'maxweight' \|\| wodType === 'distance'\) && \(\s*<WorkoutStructureEditor\s+key=\{editingWorkoutId \|\| 'nova-prova'\}\s+value=\{wodStructure\}\s+onChange=\{handleWorkoutStructureChange\}\s+defaultFormat=\{wodType === 'amrap' \? 'amrap' : wodType === 'maxweight' \? 'max_load' : wodType === 'distance' \? 'distance' : 'for_time'\}\s+workoutName=\{wodName\}\s+timeCapHint=\{wodTimeCap\}\s+lockedSheets=\{editingWorkoutId \? sheetLocks\[editingWorkoutId\] \?\? 0 : 0\}\s+idPrefix="wod-structure"/);
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
  // Story 1.61: o exemplo do Intervalado para conferir "Editar súmula" no navegador.
  const preview = read('../src/components/sheet/EditorPreview.tsx');
  assert.match(preview, /Carregar o exemplo do Intervalado \(5 × 02:00 \/ 02:00\)/);
  assert.match(preview, /onClick=\{\(\) => setValue\(INTERVAL_EXAMPLE\)\}/);
  const example = preview.match(/const INTERVAL_EXAMPLE: WorkoutStructure = (\{[\s\S]*?\n\});/)[1];
  assert.equal(validateWorkoutStructure(Function(`return (${example});`)()).ok, true, 'o exemplo é uma estrutura v3 válida');
});

test('o motor, a persistência, o judge e as dependências seguem como estavam', () => {
  assert.doesNotMatch(read('../src/lib/workoutStructure.ts'), /workoutStructureEditor|WorkoutStructureEditor|SheetDemo/);
  assert.doesNotMatch(read('../src/app/api/admin/persistence/route.ts'), /workoutStructureEditor|WorkoutStructureEditor/);
  assert.doesNotMatch(read('../src/app/judge/page.tsx'), /WorkoutStructureEditor|SheetDemo|SheetView/);
  assert.doesNotMatch(read('../package.json'), /"mapbox-gl"[\s\S]*"zod"|"zod"|"react-hook-form"/);
  assert.match(editorLib.describeStructureProblem.toString(), /validateWorkoutStructure/);
});

// ---------------------------------------------------------------------------
// Story 1.61: Intervalado no construtor (Maquete 1 de docs/design/intervalado/)
// ---------------------------------------------------------------------------

const intervalDraft = () => {
  let draft = setDraftFormat(createDraft('for_time'), 'interval');
  draft = updateLine(draft, 'interval', draft.interval.lines[0].key, { reps: '6', name: 'Ring Muscle Ups' });
  draft = addLine(draft, 'interval');
  draft = updateLine(draft, 'interval', draft.interval.lines[1].key, { reps: '15', name: 'Box Jump Overs (24/20 in)' });
  return updateIntervalMax(draft, { name: 'Squat Clean', load: '80' });
};
const sectionOf = (html, title) => html.slice(html.indexOf(`</span>${title}</h3>`), html.indexOf('</section>', html.indexOf(`</span>${title}</h3>`)));

test('Intervalado: quarto cartão depois de Carga máxima, um ponto de Tab e setas circulares entre os cinco formatos (o quinto é a Distância, Story 1.67)', () => {
  const html = renderPanel(intervalDraft());
  const cards = [...html.matchAll(/id="b-format-([a-z_]+)"[^>]*role="radio"[^>]*aria-checked="(true|false)"[^>]*tabindex="(-?\d)"/g)].map((match) => match.slice(1));
  assert.deepEqual(cards, [['for_time', 'false', '-1'], ['amrap', 'false', '-1'], ['max_load', 'false', '-1'], ['interval', 'true', '0'], ['distance', 'false', '-1']]);
  assert.match(html, /id="b-format-interval"[^>]*>.*?<svg[^>]*lucide-check[\s\S]*?<\/svg>Intervalado<\/span><span[^>]*>Rounds de trabalho e descanso; soma das repetições<\/span><\/button>/s);
  assert.equal((html.match(/role="radio"/g) || []).length, 5);
  assert.equal((html.match(/lucide-check/g) || []).length, 1, 'só o cartão escolhido leva o Check');

  const formats = block(formSource, /const FORMATS: [\s\S]*?\n\];/);
  assert.equal((formats.match(/\{ value: '/g) || []).length, 5);
  assert.match(formats, /\{ value: 'max_load', title: 'Carga máxima', detail: 'Maior carga válida, por tentativas' \},\s*\{ value: 'interval', title: 'Intervalado', detail: 'Rounds de trabalho e descanso; soma das repetições' \},\s*\{ value: 'distance', title: 'Distância', detail: 'Maior distância no tempo; o judge informa o total' \}/);
  assert.match(formSource, /const next = FORMATS\[\(index \+ step \+ FORMATS\.length\) % FORMATS\.length\]\.value;/);
  assert.match(formSource, /role="radiogroup" aria-labelledby=\{id\('format-title'\)\} onKeyDown=\{handleFormatKeys\} className="grid grid-cols-2 gap-2 sm:grid-cols-6"/);
  assert.doesNotMatch(formSource, /sm:grid-cols-3/, 'a grade dos formatos não fica em três colunas: são seis colunas, com 3 + 2 cartões no desktop');
  assert.match(formSource, /onClick=\{\(\) => onChange\(setDraftFormat\(draft, option\.value\)\)\}/);
});

test('Intervalado: seções 2 a 5, campos, linha do tempo, dicas e textos da maquete', () => {
  const html = renderPanel(intervalDraft());
  const titles = [...html.matchAll(/<h3 id="b-[a-z-]+"[^>]*><span class="font-number text-primary">(\d)<\/span>([^<]+)<\/h3>/g)].map((match) => `${match[1]} ${match[2]}`);
  assert.deepEqual(titles, ['1 Formato da prova', '2 Rounds e tempos', '3 Trabalho de cada round', '4 Pontuação', '5 Regra da prova']);

  // 2 Rounds e tempos: rótulos associados, duração somente leitura e calculada.
  const time = sectionOf(html, 'Rounds e tempos');
  for (const [field, label, value] of [['rounds', 'Rounds', '5'], ['on', 'Trabalho · ON \\(MM:SS\\)', '02:00'], ['off', 'Descanso · OFF \\(MM:SS\\)', '02:00']]) {
    assert.match(time, new RegExp(`<label for="b-iv-${field}"[^>]*>${label}</label><input id="b-iv-${field}"[^>]*aria-invalid="false"[^>]*value="${value}"`), field);
  }
  assert.match(time, /<label for="b-iv-duration"[^>]*>Duração da prova<\/label><input id="b-iv-duration" type="text" readOnly=""[^>]*value="18:00"/);
  assert.match(time, /role="img" aria-label="5 rounds de 02:00 de trabalho, 02:00 de descanso entre eles, 18:00 no total"/);
  assert.equal((time.match(/flex:120 0 0/g) || []).length, 9, '5 blocos de trabalho e 4 de descanso: sem descanso depois do último');
  assert.equal((time.match(/class="block h-full bg-info"/g) || []).length, 5);
  assert.equal((time.match(/class="block h-full bg-primary"/g) || []).length, 5);
  assert.match(time, /<div aria-hidden="true" class="relative mt-1[^"]*"><span[^>]*left:0%[^>]*>00:00<\/span>.*>16:00<\/span><span[^>]*left:100%[^>]*>18:00<\/span><\/div>/s);
  assert.match(time, /<\/span>Fixos<\/span>.*<\/span>Máximo<\/span>.*<\/span>\s*Descanso<\/span>/s, 'legenda com texto ao lado das cores');
  assert.match(time, /Sem descanso depois do último round\. Com OFF em 00:00 os rounds ficam colados \(EMOM\)\./);

  // 3 Trabalho de cada round: fixos como as linhas do AMRAP e a linha do máximo, fixa e por último.
  const work = sectionOf(html, 'Trabalho de cada round');
  assert.match(work, />Repetições<\/span><span[^>]*>Movimento<\/span><span[^>]*>Carga \(kg\)<\/span>/);
  assert.match(work, /aria-label="Repetições do movimento 1"[^>]*value="6"/);
  assert.match(work, /placeholder="10"/, 'um número por movimento, sem sequência');
  assert.match(work, /aria-label="Movimento 2"[^>]*value="Box Jump Overs \(24\/20 in\)"/);
  assert.match(work, /<input id="b-iv-k5-reps" type="text" disabled="" readOnly="" aria-label="Repetições do movimento máximo: sem meta"[^>]*value="Máx\."\/>/);
  assert.match(work, /aria-label="Movimento máximo"[^>]*value="Squat Clean"/);
  assert.match(work, /aria-label="Carga do movimento máximo em kg"[^>]*value="80"/);
  assert.ok(work.indexOf('Movimento 2"') < work.indexOf('Movimento máximo"'), 'o máximo vem depois dos fixos');
  assert.doesNotMatch(work, /Remover o movimento máximo|Subir o movimento máximo|Descer o movimento máximo/);
  assert.match(work, /aria-label="Mais opções do movimento máximo"/);
  assert.match(work, /<button[^>]*id="b-iv-add"[^>]*>.*Movimento<\/button>/s);
  assert.doesNotMatch(work, /<button[^>]*id="b-iv-add"[^>]*disabled=""/);
  assert.match(work, /aria-label="Remover o movimento 1"/);
  assert.match(work, /O movimento máximo fica sempre por último e não tem meta: o judge conta até o fim da janela\. A carga é uma por linha; 80 kg e 55 kg viram duas provas, uma por categoria \(campo &quot;Categoria vinculada&quot;\), como hoje\./);
  assert.match(formSource, /disabled=\{iv\.lines\.length >= MAX_INTERVAL_FIXED_LINES\}/, 'o botão "Movimento" para no limite de 9');
  assert.match(formSource, /minCount=\{list === 'interval' \? 0 : 1\}/, 'o último fixo pode sair (0 fixos)');

  // 4 Pontuação: Score e Desempate fixos, desabilitados.
  const score = sectionOf(html, 'Pontuação');
  assert.match(score, /<label for="b-iv-score"[^>]*>Score<\/label><input id="b-iv-score" type="text" disabled=""[^>]*value="Soma das repetições do máximo"/);
  assert.match(score, /<label for="b-iv-tiebreak"[^>]*>Desempate<\/label><input id="b-iv-tiebreak" type="text" disabled=""[^>]*value="Sem desempate"/);
  assert.match(score, /Round em que os movimentos fixos não terminam dentro da janela vale 0 no máximo\. Empates dividem a posição\./);

  // 5 Regra da prova: a frase com destaques e a lista de conferência.
  const rule = sectionOf(html, 'Regra da prova');
  assert.match(rule, /São <\/span><strong[^>]*>5 rounds<\/strong><span> de <\/span><strong[^>]*>02:00<\/strong><span> de trabalho<\/span><span>, com <\/span><strong[^>]*>02:00<\/strong>/);
  assert.match(rule, /<strong[^>]*>soma das repetições de Squat Clean<\/strong>/);
  assert.match(rule, /<ul class="space-y-1 text-xs" aria-live="polite">/);
  for (const text of ['5 rounds de 02:00 de trabalho e 02:00 de descanso · 18:00 no total', '2 movimentos fixos (21 repetições por round)', '1 movimento máximo: Squat Clean 80 kg', 'Sem desempate (opcional)']) {
    assert.ok(rule.includes(text), text);
  }

  // Ids únicos por idPrefix.
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  assert.ok(ids.filter((value) => value.startsWith('b-iv-')).length > 10);
});

test('Intervalado: erros marcados no campo, duração "—", sem linha do tempo e "Usar esta súmula" desligado', () => {
  const broken = updateIntervalMax(updateIntervalTiming(intervalDraft(), { rounds: '1', on: '00:10' }), { name: '' });
  const html = renderPanel(broken);
  assert.match(html, /<input id="b-iv-rounds"[^>]*aria-invalid="true" aria-describedby="b-iv-rounds-problem"/);
  assert.match(html, /<input id="b-iv-on"[^>]*aria-invalid="true" aria-describedby="b-iv-on-problem"/);
  assert.match(html, /<input id="b-iv-off"[^>]*aria-invalid="false"/);
  assert.match(html, /<p id="b-iv-rounds-problem"[^>]*>Rounds: de 2 a 20\.<\/p>/);
  assert.match(html, /<p id="b-iv-on-problem"[^>]*>Trabalho: de 00:30 a 30:00 \(MM:SS\)\.<\/p>/);
  assert.match(html, /<input id="b-iv-duration"[^>]*value="—"/);
  assert.doesNotMatch(html, /role="img"/, 'a linha do tempo some enquanto houver erro');
  assert.match(html, /aria-label="Movimento máximo" aria-invalid="true" aria-describedby="b-iv-k5-problem"/);
  assert.match(html, /<p id="b-iv-k5-problem"[^>]*>Movimento máximo: informe o movimento\.<\/p>/);
  assert.match(html, /<span class="sr-only">Corrigir: <\/span>Rounds: de 2 a 20\./, 'mensagem em texto, não só cor');
  assert.match(html, /3 itens para corrigir na regra da prova\./);
  assert.match(html, /<button[^>]*id="b-use"[^>]*disabled=""/);
  assert.match(html, /A regra aparece aqui quando os itens marcados com ! forem corrigidos\./);

  const long = renderPanel(updateIntervalTiming(intervalDraft(), { rounds: '20', on: '03:00', off: '03:00' }));
  assert.match(long, /<input id="b-iv-duration"[^>]*aria-invalid="true" aria-describedby="b-iv-duration-problem"[^>]*value="—"/);
  assert.match(long, /<p id="b-iv-duration-problem"[^>]*>A prova passa de 99:59 \(117:00\)\. Reduza rounds ou tempos\.<\/p>/);

  // Sem fixos e sem descanso: aceito, sem a cor dos fixos e sem bloco de descanso.
  let emom = updateIntervalTiming(intervalDraft(), { off: '00:00' });
  emom = removeLine(removeLine(emom, 'interval', emom.interval.lines[1].key), 'interval', emom.interval.lines[0].key);
  const emomHtml = renderPanel(emom);
  assert.match(emomHtml, /role="img" aria-label="5 rounds de 02:00 de trabalho, sem descanso entre eles, 10:00 no total"/);
  assert.doesNotMatch(emomHtml, /bg-info" style/);
  assert.match(emomHtml, /Nenhum movimento fixo/);
  assert.doesNotMatch(emomHtml, /<button[^>]*id="b-use"[^>]*disabled=""/);
});

test('Intervalado: a prévia mostra a súmula do judge do Intervalado (Story 1.62), sem o aviso da 1.61', () => {
  const html = renderPanel(intervalDraft());
  assert.doesNotMatch(html, /A prévia da súmula do Intervalado chega com a próxima etapa\./);
  assert.doesNotMatch(dialogSource, /INTERVAL_PREVIEW_NOTICE|próxima etapa/);
  assert.match(html, /aria-label="Súmula digital do intervalado"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital"/, 'nada da súmula de For Time ao lado');
  assert.match(html, /Súmula pronta\. Ela é gravada quando você salvar a prova\./);
  assert.doesNotMatch(html, /<button[^>]*id="b-use"[^>]*disabled=""/);
  // Com problemas, o mesmo aviso dos outros formatos.
  assert.match(renderPanel(createDraft('interval')), /Corrija os itens marcados com ! para ver a súmula\./);
  // Os outros formatos seguem com a súmula deles ao lado.
  assert.match(renderPanel(franDraft()), /aria-label="Súmula digital"/);
});

test('Intervalado no formulário da prova: resumo, frase da regra e "Editar súmula" a partir da estrutura gravada', () => {
  const structure = validateWorkoutStructure(analyzeDraft(intervalDraft()).structure).structure;
  const html = renderEditor({ value: structure });
  assert.match(html, /Intervalado · 5 rounds · 02:00 ON \/ 02:00 OFF · 18:00/);
  assert.match(html, /São 5 rounds de 02:00 de trabalho, com 02:00 de descanso entre eles \(18:00 no total\)\. Em cada round o atleta faz 6 Ring Muscle Ups e 15 Box Jump Overs \(24\/20 in\) e, com o tempo que sobrar, o máximo de Squat Clean 80 kg\./);
  assert.match(html, /id="t-open"[^>]*>.*Editar súmula/s);
  assert.doesNotMatch(html, /<button[^>]*id="t-open"[^>]*disabled=""/);
  // Trava da regra do motor 8, sem mudança: com súmula aberta, "Editar súmula" fica desabilitado com o aviso de hoje.
  const locked = renderEditor({ value: structure, lockedSheets: 1 });
  assert.match(locked, /<button[^>]*id="t-open"[^>]*disabled=""/);
  assert.match(locked, /Estrutura travada: 1 súmula já foi aberta na arbitragem\./);
  // O painel deriva o tipo legado "reps" ao usar a estrutura; o editor continua aparecendo porque wodStructure existe.
  assert.match(admin, /\{workoutStructureSupported && \(wodStructure \|\| wodType === 'fortime' \|\| wodType === 'amrap' \|\| wodType === 'maxweight' \|\| wodType === 'distance'\) && \(/);
  assert.match(editorSource, /notice: loaded && !loaded\.ok \? `\$\{loaded\.error\} Monte de novo em linhas; a súmula gravada só muda quando você usar a nova e salvar a prova\.` : null,/);
});

// ---------------------------------------------------------------------------
// Story 1.67: Distância (Maquete 1 de docs/design/distancia/)
// ---------------------------------------------------------------------------

const distanceUiDraft = (patch = {}) => {
  const draft = setDraftFormat(createDraft('for_time'), 'distance');
  return { ...draft, distance: { ...draft.distance, ...patch } };
};

test('Distância: quinto cartão, com o texto da maquete, ocupando a última linha da grade de seis colunas', () => {
  const html = renderPanel(distanceUiDraft());
  const cards = [...html.matchAll(/id="b-format-([a-z_]+)"[^>]*role="radio"[^>]*aria-checked="(true|false)"[^>]*tabindex="(-?\d)"/g)].map((match) => match.slice(1));
  assert.deepEqual(cards, [['for_time', 'false', '-1'], ['amrap', 'false', '-1'], ['max_load', 'false', '-1'], ['interval', 'false', '-1'], ['distance', 'true', '0']]);
  assert.match(html, /id="b-format-distance"[^>]*>.*?<svg[^>]*lucide-check[\s\S]*?<\/svg>Distância<\/span><span[^>]*>Maior distância no tempo; o judge informa o total<\/span><\/button>/s);
  assert.equal((html.match(/lucide-check/g) || []).length, 1, 'só o cartão escolhido leva o Check');
  // Cinco cartões preenchem a grade: 3 + 2 no desktop (spans 2, 2, 2, 3, 3) e 2 + 2 + 1 no celular (o último ocupa a linha).
  const spans = [...html.matchAll(/id="b-format-[a-z_]+"[^>]*class="[^"]*?((?:col-span-2 )?sm:col-span-\d)[^"]*"/g)].map((match) => match[1]);
  assert.deepEqual(spans, ['sm:col-span-2', 'sm:col-span-2', 'sm:col-span-2', 'sm:col-span-3', 'col-span-2 sm:col-span-3']);
  // Trocar de formato continua passando pelo rascunho: o clique chama setDraftFormat.
  assert.match(formSource, /onClick=\{\(\) => onChange\(setDraftFormat\(draft, option\.value\)\)\}/);
});

test('Distância: seções 2 a 4, campos, dicas e a frase da regra da maquete', () => {
  const html = renderPanel(distanceUiDraft({ note: '750 m corrida; máx. distância no remo.' }));
  const titles = [...html.matchAll(/<h3 id="b-[a-z-]+"[^>]*><span class="font-number text-primary">(\d)<\/span>([^<]+)<\/h3>/g)].map((match) => `${match[1]} ${match[2]}`);
  assert.deepEqual(titles, ['1 Formato da prova', '2 Duração e resumo', '3 Pontuação', '4 Regra da prova']);

  const time = sectionOf(html, 'Duração e resumo');
  assert.match(time, /<label for="b-di-duration"[^>]*>Duração da prova \(MM:SS\)<\/label>/);
  assert.match(time, /<input id="b-di-duration" type="text" inputMode="numeric" autoComplete="off" aria-invalid="false" aria-describedby="b-di-duration-note"[^>]*value="20:00"\/>/);
  assert.match(time, /De 00:30 a 99:59\. A súmula avisa quando a duração termina\./);
  assert.match(time, /<label for="b-di-note"[^>]*>Resumo da prova para o judge \(opcional\)<\/label>/);
  assert.match(time, /<textarea id="b-di-note" rows="3"[^>]*>750 m corrida; máx\. distância no remo\.<\/textarea>/);
  assert.match(time, /<span class="font-number">38<\/span>\/300 caracteres\. Aparece para o judge na súmula\./);

  // A unidade não é uma escolha (decisão 8) e não há desempate nem campos de movimentos.
  const score = sectionOf(html, 'Pontuação');
  assert.match(score, /Maior distância vence\. O judge informa o total em metros\. Sem desempate nesta versão: empates dividem a posição\./);
  assert.doesNotMatch(score, /<input|<select|<textarea/);
  assert.doesNotMatch(html, /Time cap \(MM:SS\)|Penalidade por repetição|Movimento máximo|Linhas|Carga \(kg\)/);

  const rule = sectionOf(html, 'Regra da prova');
  assert.match(rule, /<span>Vale a <\/span><strong[^>]*>maior distância total<\/strong><span> em <\/span><strong[^>]*>20:00<\/strong>/);
  assert.match(rule, /Duração: 20:00/);
  assert.match(rule, /Resultado em metros, maior vence/);
  assert.match(rule, /Sem desempate nesta versão/);
  assert.match(rule, /Resumo para o judge preenchido/);
});

test('Distância: erros marcados no campo, sem a súmula e com "Usar esta súmula" desligado', () => {
  const html = renderPanel(distanceUiDraft({ duration: '00:10', note: 'x'.repeat(301) }));
  assert.match(html, /<input id="b-di-duration"[^>]*aria-invalid="true"[^>]*class="[^"]*border-trading-down\/70[^"]*"/);
  assert.match(html, /<p id="b-di-duration-note" class="mt-1 text-\[11px\] font-semibold text-trading-down">Duração: use MM:SS entre 00:30 e 99:59\.<\/p>/);
  assert.match(html, /<textarea id="b-di-note"[^>]*aria-invalid="true"/);
  assert.match(html, /<span class="font-number">301<\/span>\/300 caracteres/);
  assert.match(html, /<button[^>]*id="b-use"[^>]*disabled=""/);
  assert.match(html, /Corrija os itens marcados com ! para ver a súmula\./);
  assert.match(html, /2 itens para corrigir na regra da prova\./);
  assert.doesNotMatch(html, /aria-label="Súmula digital da distância"/);
});

test('Distância: a prévia mostra a súmula do judge da distância (Story 1.68), com "Usar esta súmula" ligado', () => {
  const html = renderPanel(distanceUiDraft({ note: 'Corrida e remo' }));
  assert.match(html, /aria-label="Súmula digital da distância"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital"/, 'nada da súmula de For Time ao lado');
  assert.match(html, /Corrida e remo/);
  assert.match(html, /Súmula pronta\. Ela é gravada quando você salvar a prova\./);
  assert.doesNotMatch(html, /<button[^>]*id="b-use"[^>]*disabled=""/);
});

test('Distância no formulário da prova: resumo, frase da regra e "Editar súmula" a partir da estrutura gravada', () => {
  const structure = analyzeDraft(distanceUiDraft({ duration: '15:00', note: 'Corrida' })).structure;
  const html = renderEditor({ value: structure });
  assert.match(html, /Distância · 15:00 · maior vence/);
  assert.match(html, /Vale a maior distância total em 15:00\. O judge informa o total em metros\. Empates dividem a posição, sem desempate\./);
  assert.match(html, /id="t-open"[^>]*>.*Editar súmula/s);
  const locked = renderEditor({ value: structure, lockedSheets: 1 });
  assert.match(locked, /<button[^>]*id="t-open"[^>]*disabled=""/);
  assert.match(locked, /Estrutura travada: 1 súmula já foi aberta na arbitragem\./);
  // Reabrir devolve o rascunho da distância (o painel abre o construtor com o formato certo).
  const reopened = editorLib.draftFromStructure(structure);
  assert.deepEqual([reopened.draft.format, reopened.draft.distance], ['distance', { duration: '15:00', note: 'Corrida' }]);
});

test('Distância no painel: o tipo "Distância" do formulário oferece a súmula e abre o construtor na distância; o selo público diz "Distância"', () => {
  assert.match(admin, /\|\| wodType === 'distance'\) && \(\s*<WorkoutStructureEditor/);
  assert.match(admin, /wodType === 'maxweight' \? 'max_load' : wodType === 'distance' \? 'distance' : 'for_time'/);
  const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');
  assert.match(eventView, /wod\.type === 'distance' \? 'typeDistance' : 'typeReps'/);
  assert.match(read('../src/messages/pt-br.json'), /"typeReps": "Reps",\s*"typeDistance": "Distância",/);
  assert.match(read('../src/messages/en-gb.json'), /"typeReps": "Reps",\s*"typeDistance": "Distance",/);
  assert.match(read('../src/messages/pt-pt.json'), /"typeReps": "Reps",\s*"typeDistance": "Distância",/);
  // Os outros selos não mudam.
  for (const file of ['pt-br', 'pt-pt', 'en-gb']) {
    const messages = JSON.parse(read(`../src/messages/${file}.json`));
    const group = Object.values(messages).flatMap((value) => (value && typeof value === 'object' ? Object.values(value) : [])).find((value) => value && typeof value === 'object' && 'typeDistance' in value);
    assert.ok(group, `${file}: grupo com typeDistance`);
    for (const key of ['typeForTime', 'typeAmrap', 'typeMaxWeight', 'typeReps', 'typeDistance']) assert.equal(typeof group[key], 'string', `${file}: ${key}`);
  }
});
