import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Stories 1.49 a 1.52 (etapa E3), lado do aparelho e das telas: a fila da
// súmula no celular (funções puras), a área do judge na quadra em tema claro, a
// aba "Súmulas e Judges" do gestor, a trava da estrutura no formulário da prova
// e a confirmação do lançamento manual. As telas dependem da sessão (useApp) e
// da rede; aqui fica a regressão estática, e o fluxo foi conferido no navegador.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const sync = await importServerModule('lib/sheetSync.ts');
const { WorkoutStructureEditor } = await importServerModule('components/admin/WorkoutStructureEditor.tsx');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');

const queued = (id, at = 1) => ({ id, event: { t: 'rep', seg: 's1', at } });

// ---------------------------------------------------------------------------
// Fila no aparelho (Story 1.50, decisão 7)
// ---------------------------------------------------------------------------

test('fila: o que o servidor já gravou sai da fila; o resto continua pendente, na ordem', () => {
  const server = [queued('a'), queued('b')];
  assert.deepEqual(sync.mergePending(server, [queued('b'), queued('c'), queued('d')]).map((item) => item.id), ['c', 'd']);
  assert.deepEqual(sync.mergePending([], [queued('x')]).map((item) => item.id), ['x']);
  assert.deepEqual(sync.mergePending(server, []), []);
});

test('relógio: guardado no aparelho, ou parado no último registro, ou pronto', () => {
  assert.deepEqual(sync.initialClock(null, []), sync.READY_CLOCK);
  assert.deepEqual(sync.initialClock(null, [queued('a', 30), queued('b', 95)]), { phase: 'stopped', baseSeconds: 95, startedAtMs: null });
  const saved = { phase: 'running', baseSeconds: 40, startedAtMs: 1_000 };
  assert.deepEqual(sync.initialClock(saved, [queued('a', 95)]), saved, 'o relógio do aparelho vale mais');

  const running = sync.startClock({ phase: 'stopped', baseSeconds: 10, startedAtMs: null }, 5_000);
  assert.equal(sync.clockSeconds(running, 7_500), 12.5);
  const stopped = sync.stopClock(running, 9_000);
  assert.deepEqual(stopped, { phase: 'stopped', baseSeconds: 14, startedAtMs: null });
  assert.equal(sync.clockSeconds(stopped, 99_999), 14);
  assert.equal(sync.clockSeconds(running, 4_000), 10, 'relógio do aparelho atrasado não volta o tempo');
});

test('estado da gravação: nunca diz "Salvo" com registro pendente; espera cresce até 15 s', () => {
  assert.equal(sync.describeSyncStatus('saved', 0), 'Salvo');
  assert.equal(sync.describeSyncStatus('saved', 2), 'Salvando 2 registros…');
  assert.equal(sync.describeSyncStatus('saving', 1), 'Salvando 1 registro…');
  assert.equal(sync.describeSyncStatus('offline', 3), 'Sem conexão: 3 registros guardados no aparelho');
  assert.match(sync.describeSyncStatus('conflict', 0), /outro aparelho/);
  assert.match(sync.describeSyncStatus('rejected', 1), /recusado/);
  assert.deepEqual([0, 1, 2, 3, 10].map(sync.retryDelayMs), [2000, 4000, 8000, 15000, 15000]);
  assert.match(sync.newClientEventId(), /^[A-Za-z0-9_-]{1,64}$/);
});

test('o gancho de gravação: lote com a posição confirmada, conflito para, sem rede tenta de novo, guarda no aparelho', () => {
  const hook = read('../src/components/judge/useSheetSync.ts');
  assert.match(hook, /body: JSON\.stringify\(\{ action: 'append', sheetId, fromSeq: confirmedRef\.current\.length, events: batch \}\)/);
  assert.match(hook, /pendingRef\.current\.slice\(0, 200\)/);
  assert.match(hook, /if \(response\.status === 409\) \{\s*stopped\.current = true;\s*setStatus\('conflict'\);/);
  assert.match(hook, /setStatus\('offline'\);\s*const delay = retryDelayMs\(attempt\.current\);/);
  assert.match(hook, /window\.addEventListener\('online', online\)/);
  // O finally é o único dono de inFlight; o lote seguinte sai depois de liberar a marca.
  assert.equal(hook.match(/inFlight\.current = false;/g)?.length, 1);
  assert.match(hook, /inFlight\.current = false;\s*if \(flushAgain\) void flushRef\.current\(\);\s*\}/);
  assert.match(hook, /saveLocalSheet\(sheetId, \{ pending: pendingRef\.current, clock: clockRef\.current \}\)/);
  assert.match(hook, /mergePending\(serverEvents, loadLocalSheet\(sheetId\)\.pending\)/);
  assert.doesNotMatch(hook, /supabase|useApp/);
});

// ---------------------------------------------------------------------------
// Área do judge na quadra (Stories 1.49 a 1.51, decisão 9: tema claro)
// ---------------------------------------------------------------------------

test('quadra: rotas novas fora do painel do Qualifier, link no painel do judge e tema claro', () => {
  for (const path of ['../src/app/judge/quadra/page.tsx', '../src/app/judge/quadra/[eventId]/page.tsx', '../src/app/judge/quadra/sumula/[sheetId]/page.tsx']) {
    assert.ok(existsSync(new URL(path, import.meta.url)), path);
  }
  assert.match(read('../src/app/judge/page.tsx'), /href="\/judge\/quadra"/);
  const shell = read('../src/components/judge/CourtShell.tsx');
  assert.match(shell, /<div className="court-light min-h-screen">/);
  assert.match(shell, /const ALLOWED = new Set\(\['judge', 'manager', 'owner'\]\);/);
  const css = read('../src/app/globals.css');
  const block = css.match(/\.court-light \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(block, /--background: #ffffff;/);
  assert.match(block, /--foreground: #0b0e11;/);
  assert.match(block, /color-scheme: light;/);
  assert.match(css, /\.court-light \.text-primary \{\s*color: #7a5c00;/);
  for (const path of ['../src/components/sheet/SheetView.tsx', '../src/components/sheet/MaxLoadSheetView.tsx', '../src/components/sheet/IntervalSheetView.tsx', '../src/components/sheet/sheetUi.tsx']) {
    assert.doesNotMatch(read(path), /text-white/, `${path}: a súmula usa a cor de texto do tema`);
  }
});

test('quadro: abre a súmula pela rota, mostra quem está com cada raia e atualiza sozinho', () => {
  const board = read('../src/components/judge/CourtBoard.tsx');
  assert.match(board, /fetch\(`\/api\/sheets\?view=board&eventId=\$\{encodeURIComponent\(eventId\)\}`\)/);
  assert.match(board, /body: JSON\.stringify\(\{ action: 'open', eventId, workoutId, athleteId, heatId, lane \}\)/);
  assert.match(board, /router\.push\(`\/judge\/quadra\/sumula\/\$\{encodeURIComponent\(data\.sheet\.id\)\}`\)/);
  assert.match(board, /const REFRESH_MS = 15_000;/);
  assert.match(board, /sheet\.judgeUserId !== board\?\.viewer\.id/);
  assert.match(board, /\(!workout\?\.divisionId \|\| athlete\.divisionId === workout\.divisionId\)/);
});

test('súmula na quadra: envia só com tudo salvo, confirma antes, limpa o aparelho e ajusta pelo cronômetro oficial', () => {
  const sheet = read('../src/components/judge/CourtSheet.tsx');
  assert.match(sheet, /const syncReady = sync\.pendingCount === 0 && sync\.status === 'saved';/);
  assert.match(sheet, /body: JSON\.stringify\(\{ action: 'submit', sheetId: sheet\.id, expectedCount: sync\.confirmedCount \}\)/);
  assert.match(sheet, /disabled=\{!syncReady \|\| !outcome\.ok\}/);
  assert.match(sheet, /Confirmar envio/);
  assert.match(sheet, /O resultado vai direto para o ranking\./);
  assert.match(sheet, /clearLocalSheet\(sheet\.id\);/);
  assert.match(sheet, /const check = checkOfficialTime\(structure, state, target, parsed\.seconds\);/);
  assert.match(sheet, /onRecord\(\{ t: 'time', target, v: parsed\.seconds, at \}\);/);
  assert.match(sheet, /wakeLock\.request\('screen'\)/);
  assert.match(sheet, /const writable = isWriter && \(status === 'in_progress' \|\| status === 'returned'\);/);
  assert.match(sheet, /onEvent=\{writable \? sync\.record : undefined\}/);
  for (const path of ['../src/components/judge/CourtSheet.tsx', '../src/components/judge/CourtBoard.tsx', '../src/components/judge/CourtEventsList.tsx']) {
    assert.doesNotMatch(read(path), /supabase|localStorage\.setItem/, path);
  }
});

// Story 1.62: o Intervalado na quadra, sem cair nos caminhos de For Time e de carga máxima.
test('súmula na quadra: o intervalado revisa ao parar, mostra "repetições" e não tem cronômetro oficial', () => {
  const sheet = read('../src/components/judge/CourtSheet.tsx');
  const finished = sheet.match(/const finished = useMemo\(\(\) => \{[\s\S]*?\}, \[structure, events\]\);/)?.[0] || '';
  assert.match(finished, /if \(structure\.format === 'interval'\) return false;/);
  assert.ok(finished.indexOf("'interval'") < finished.indexOf('deriveSheetState'), 'o intervalado sai antes do motor de segmentos');
  assert.match(sheet, /const showReview = writable && \(clock\.phase === 'stopped' \|\| finished\);/);
  assert.match(sheet, /structure\.format === 'max_load' \? ' kg' : structure\.format === 'interval' \? \(value === 1 \? ' repetição' : ' repetições'\) : ''/);
  // Story 1.68: o resultado passa por resultText (a distância em metros; os outros formatos como antes, com resultUnit).
  assert.match(sheet, /\$\{result\.replace\('\.', ','\)\}\$\{resultUnit\(value\)\}/);
  assert.match(sheet, /\{resultText\(outcome\.result, outcome\.value\)\}/);
  assert.match(sheet, /\{\(structure\.format === 'for_time' \|\| structure\.format === 'amrap'\) && <OfficialTimeForm /);
  assert.doesNotMatch(sheet, /structure\.format !== 'max_load' && <OfficialTimeForm/);
  assert.match(sheet, /Enviar \{outcome\.ok \? resultText\(outcome\.result, outcome\.value\) : ''\} de \{context\.athleteName\}\? O resultado vai direto para o ranking\./);
  assert.match(sheet, /const canMarkAbsent = writable && sync\.confirmedCount === 0 && sync\.pendingCount === 0 && events\.length === 0;/);
});

// ---------------------------------------------------------------------------
// Gestor: aba Súmulas e Judges, trava e lançamento manual (Stories 1.49, 1.51, 1.52)
// ---------------------------------------------------------------------------

test('aba Súmulas e Judges: só em evento presencial, com revisão, histórico, judges e scores do servidor', () => {
  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /import \{ ScoresheetsPanel \} from '@\/components\/admin\/ScoresheetsPanel';/);
  assert.equal((admin.match(/\? \[\{ id: 'sheets', label: 'Súmulas e Judges' \}, \{ id: 'broadcast', label: 'Telão' \}\]/g) || []).length, 2, 'celular e desktop');
  assert.match(admin, /\{activeEventTab === 'sheets' && \(selectedEventToManage\.eventType \|\| 'functional_fitness'\) === 'functional_fitness' && <ScoresheetsPanel event=\{selectedEventToManage\} \/>\}/);

  const panel = read('../src/components/admin/ScoresheetsPanel.tsx');
  assert.match(panel, /fetch\(`\/api\/sheets\?view=manage&eventId=\$\{encodeURIComponent\(event\.id\)\}`\)/);
  assert.match(panel, /replaceWorkoutScores\(workoutId, scores as Score\[\]\)/);
  assert.match(panel, /review: mode\.kind,/);
  assert.match(panel, /disabled=\{busy \|\| \(mode\.kind === 'cancel' && !form\.acknowledged\)\}/);
  assert.match(panel, /adminAction\('createJudge', \{ eventId: event\.id, \.\.\.judgeForm \}\)/);
  assert.match(panel, /adminAction\('removeJudgeFromEvent', \{ eventId: event\.id, judgeId: judge\.id \}\)/);
  assert.match(read('../src/context/AppContext.tsx'), /const replaceWorkoutScores = useCallback\(\(workoutId: string, incoming: Score\[\]\) => \{\s*setScores\(previous => \[\.\.\.previous\.filter\(score => score\.workoutId !== workoutId\), \.\.\.incoming\]\);/);
});

test('lançamento manual por cima de súmula publicada pede confirmação antes de salvar', () => {
  const admin = read('../src/app/admin/page.tsx');
  const save = admin.match(/const handleScoresSave = \(\) => \{[\s\S]*?\n {2}\};/)?.[0] || '';
  assert.match(save, /const published = publishedSheetResults\[`\$\{score\.workoutId\}\|\$\{score\.athleteId\}`\];/);
  assert.match(save, /Lançar à mão substitui o resultado da súmula e fica registrado no histórico\. Continuar\?/);
  assert.ok(save.indexOf('window.confirm(') < save.indexOf('submitScoresBulk(scoresToSubmit)'), 'confirma antes de salvar');
  assert.match(admin, /if \(!confirmed\) return;/);
});

test('trava no formulário da prova: com súmula aberta, editar e remover ficam desligados e o motivo aparece', () => {
  const segment = (id, round, reps) => ({ id, round, name: 'Burpee', reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps' });
  const structure = validateWorkoutStructure({
    version: 2, format: 'for_time', totalReps: 10, timeCapSeconds: 300, incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
    tieBreak: null, generator: null, customized: true, entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [segment('s1', 1, 10)], maxLoad: null, scoreDisplay: null
  }).structure;
  const render = (lockedSheets) => renderToStaticMarkup(createElement(WorkoutStructureEditor, { value: structure, onChange: () => {}, idPrefix: 't', lockedSheets }));
  const locked = render(2);
  assert.match(locked, /Estrutura travada: 2 súmulas já foram abertas na arbitragem\./);
  assert.match(locked, /<button[^>]*id="t-open"[^>]*disabled=""/);
  assert.match(locked, /<button[^>]*id="t-remove"[^>]*disabled=""/);
  const free = render(0);
  assert.doesNotMatch(free, /Estrutura travada/);
  assert.doesNotMatch(free, /<button[^>]*id="t-open"[^>]*disabled=""/);
});
