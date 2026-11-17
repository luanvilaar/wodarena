import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.146: onde o comprovante de envio da súmula aparece (plano aprovado em
// docs/design/comprovante-sumula/): resumo na Quadra, lista no cartão da
// inscrição na Área do Atleta e copiar/abrir no painel do gestor. As partes de
// exibição são renderizadas aqui; o que depende de sessão e rede fica na
// regressão estática.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const { buildSheetReceipt } = await importServerModule('lib/sheetReceipt.ts');
const { CourtReceiptSummary, AthleteSheetReceiptList } = await importServerModule('components/SheetReceiptShortcuts.tsx');

const model = buildSheetReceipt({
  sheet: {
    id: 'sheet-quadra-1', status: 'submitted', official_result: '387', official_tie_break: null, computed_result: '387', heat_number: 3, lane: 5,
    judge_name: 'Iara', created_at: '2026-11-15T13:47:00.000Z', submitted_at: '2026-11-15T13:59:00.000Z', structure: { format: 'amrap', timeCapSeconds: 720 }
  },
  event: { name: 'Desafio Litoral 2026', time_zone: 'America/Fortaleza' },
  workout: { code: 'PROVA 2', name: 'PROVA 2' },
  athlete: { name: 'Os Insistentes (Yuri Lacerda / Breno Macedo)', box: 'CT Maré Alta' },
  divisionName: 'Dupla Intermediário Masculino',
  heat: { date: '2026-11-15', time: '10:46' },
  reviews: [],
  score: { result: '387', scoresheet_id: 'sheet-quadra-1' }
});

test('1.146: Quadra mostra atleta, bateria com horário, árbitro, envio e "Ver comprovante"', () => {
  const html = renderToStaticMarkup(createElement(CourtReceiptSummary, { receipt: model, path: '/pt-br/comprovante/sumula/tok.sig' }));
  for (const expected of ['Comprovante do atleta', 'Os Insistentes', '3 · Raia 5 · 10:46', 'Árbitro', 'Iara', '>Enviada<', '15/11, 10:59', 'O atleta encontra este comprovante na Área do Atleta, em Inscrições.', 'Ver comprovante']) {
    assert.ok(html.includes(expected), expected);
  }
  assert.match(html, /href="\/pt-br\/comprovante\/sumula\/tok\.sig"/);
});

test('1.146: Área do Atleta lista as provas com comprovante e as que aguardam; sem prova, nada aparece', () => {
  const provas = [
    { workoutId: 'w1', code: 'PROVA 1', receipt: null },
    { workoutId: 'w2', code: 'PROVA 2', receipt: { sheetId: 's2', state: 'corrected', stateLabel: 'Corrigida pelo gestor', result: '391 reps', struck: false, heatNumber: 3, lane: 5, scheduled: '15/11, 10:46', judgeName: 'Iara', path: '/pt-br/comprovante/sumula/a.b' } },
    { workoutId: 'w3', code: 'PROVA 3.1', receipt: { sheetId: 's3', state: 'cancelled', stateLabel: 'Cancelada', result: '120 kg', struck: true, heatNumber: null, lane: null, scheduled: null, judgeName: '', path: '/pt-br/comprovante/sumula/c.d' } }
  ];
  const html = renderToStaticMarkup(createElement(AthleteSheetReceiptList, { provas }));
  assert.match(html, /Comprovantes das provas/);
  assert.match(html, /PROVA 1<\/p><p[^>]*>Súmula ainda não enviada/);
  assert.match(html, />Aguardando</);
  assert.match(html, /Bateria 3 · Raia 5 · Árbitro Iara/);
  assert.match(html, />391 reps</);
  assert.match(html, />Corrigida pelo gestor</);
  assert.match(html, /aria-label="Ver comprovante da PROVA 2" class="[^"]*" href="\/pt-br\/comprovante\/sumula\/a\.b"|href="\/pt-br\/comprovante\/sumula\/a\.b"/);
  assert.match(html, /line-through[^>]*>120 kg/);
  assert.match(html, /Sem bateria/);
  assert.equal(renderToStaticMarkup(createElement(AthleteSheetReceiptList, { provas: [] })), '');
});

test('1.146: Quadra, cartão da inscrição e painel do gestor ligados ao comprovante', () => {
  const court = read('../src/components/judge/CourtSheet.tsx');
  assert.match(court, /import \{ CourtSheetReceipt \} from '@\/components\/SheetReceiptShortcuts';/);
  assert.match(court, /\{status === 'submitted' && <CourtSheetReceipt sheetId=\{sheet\.id\}/);

  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /\{reg\.paymentStatus === 'payment_approved' && \(event\?\.eventType \|\| 'functional_fitness'\) === 'functional_fitness' && \(\s*<AthleteSheetReceipts registrationId=\{reg\.id\} \/>/);

  const shortcuts = read('../src/components/SheetReceiptShortcuts.tsx');
  assert.match(shortcuts, /fetchJson\(`\/api\/sheet-receipts\?sheetId=\$\{encodeURIComponent\(sheetId\)\}`\)/);
  assert.match(shortcuts, /fetchJson\(`\/api\/sheet-receipts\?view=mine&registrationId=\$\{encodeURIComponent\(registrationId\)\}`\)/);

  const panel = read('../src/components/admin/ScoresheetsPanel.tsx');
  assert.match(panel, /fetch\(`\/api\/sheet-receipts\?sheetId=\$\{encodeURIComponent\(sheetId\)\}`, \{ cache: 'no-store' \}\)/);
  assert.match(panel, /\{sheet\?\.submittedAt && \(/, 'só súmula enviada tem comprovante');
  assert.match(panel, />Comprovante do atleta</);
  assert.match(panel, /Copiar link/);
  assert.match(panel, /Abrir comprovante/);
  assert.match(panel, /if \(targetSheet\?\.submittedAt\) void loadReceiptLink\(targetSheet\.id\);/);
  assert.doesNotMatch(panel, /race/i, 'o painel de Functional Fitness não fala de Fitness Race');
});
