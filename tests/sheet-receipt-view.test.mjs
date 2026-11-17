import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.145: página do comprovante de envio da súmula (plano aprovado em
// docs/design/comprovante-sumula/). A marcação do componente nos seis estados e
// os metadados da rota (fora de buscadores, sem referer, lida a cada visita).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const { buildSheetReceipt } = await importServerModule('lib/sheetReceipt.ts');
const { SheetReceiptView, SHEET_RECEIPT_CONTEST_HREF } = await importServerModule('components/SheetReceiptView.tsx');

const input = (sheet = {}, extra = {}) => ({
  sheet: {
    id: 'sheet-7q4k2m9x', status: 'submitted', absent: false, corrected: false, official_result: '387', official_tie_break: '11:12', computed_result: '387',
    heat_number: 3, lane: 5, judge_name: 'Iara', created_at: '2026-11-15T13:47:00.000Z', submitted_at: '2026-11-15T13:59:00.000Z',
    structure: { format: 'amrap', timeCapSeconds: 720 }, ...sheet
  },
  event: { name: 'Desafio Litoral 2026', date: '15/11/2026', location: 'Arena Norte', time_zone: 'America/Fortaleza' },
  workout: { code: 'PROVA 2', name: 'PROVA 2', description: '10 thrusters\n20 wall balls', tie_breaker: 'Tempo do último round' },
  athlete: { name: 'Os Insistentes (Yuri Lacerda / Breno Macedo)', box: 'CT Maré Alta' },
  divisionName: 'Dupla Intermediário Masculino',
  heat: { date: '2026-11-15', time: '10:46' },
  reviews: [
    { action: 'opened', actor_name: 'Iara', actor_role: 'judge', created_at: '2026-11-15T13:47:00.000Z' },
    { action: 'submitted', actor_name: 'Iara', actor_role: 'judge', applied_result: '387', created_at: '2026-11-15T13:59:00.000Z' }
  ],
  score: { result: '387', scoresheet_id: 'sheet-7q4k2m9x' },
  summary: '6 rounds + 27 (total 387)',
  ...extra
});
const render = (model) => renderToStaticMarkup(createElement(SheetReceiptView, { receipt: model }));

test('1.145: comprovante publicado com evento, prova, atleta, resultado, bateria, árbitro, horários, linha do tempo e ações', () => {
  const html = render(buildSheetReceipt(input()));
  for (const expected of [
    'Desafio Litoral 2026', '>DL<', 'Comprovante de envio da súmula', '>Publicada<', 'PROVA 2 · AMRAP 12 min',
    'Os Insistentes', 'Yuri Lacerda / Breno Macedo', 'CT Maré Alta · Dupla Intermediário Masculino',
    '>387<', '>reps<', 'tie-break 11:12', 'Na súmula do judge: 6 rounds + 27 (total 387)',
    '3 · Raia 5', 'Horário no cronograma', '15/11, 10:46', 'Árbitro', '>Iara<', 'Súmula aberta', '15/11, 10:47', '>Enviada<', '15/11, 10:59',
    'Linha do tempo', 'Enviada e publicada', 'Ver movimentos e desempate', '10 thrusters', 'Desempate: Tempo do último round',
    'Publicada no ranking', 'Código da súmula', '7Q4K2M9X', 'Copiar link', 'Contestar'
  ]) assert.ok(html.includes(expected), expected);
  assert.match(html, new RegExp(`href="${SHEET_RECEIPT_CONTEST_HREF}"`));
  assert.equal(SHEET_RECEIPT_CONTEST_HREF, '/admin#contestar', 'Área do Atleta, seção Contestações (D7)');
  assert.doesNotMatch(html, /Resultado oficial|Enviado pelo judge|line-through/);
});

test('1.145: corrigida e lançada à mão mostram o oficial e o enviado pelo judge; cancelada risca; ausente e sem bateria', () => {
  const corrected = render(buildSheetReceipt(input({ corrected: true, official_result: '391' }, {
    score: { result: '391', scoresheet_id: 'sheet-7q4k2m9x' },
    reviews: [...input().reviews, { action: 'corrected', actor_name: 'Gestora', actor_role: 'manager', reason: 'Vídeo', previous_result: '387', applied_result: '391', created_at: '2026-11-15T14:31:00.000Z' }]
  })));
  assert.match(corrected, /Resultado oficial/);
  assert.match(corrected, /Enviado pelo judge: <span[^>]*>387 reps<\/span>/);
  assert.match(corrected, />Corrigida pelo gestor</);
  assert.doesNotMatch(corrected, /Gestora|Vídeo/);

  const manual = render(buildSheetReceipt(input({}, { score: { result: '391', scoresheet_id: null } })));
  assert.match(manual, /Resultado lançado à mão pelo gestor/);
  assert.match(manual, />391</);

  const cancelled = render(buildSheetReceipt(input({ status: 'cancelled' }, { score: null })));
  assert.match(cancelled, /line-through/);
  assert.match(cancelled, /Este resultado não conta no ranking\./);
  assert.match(cancelled, /Súmula cancelada pelo gestor/);

  const returned = render(buildSheetReceipt(input({ status: 'returned' })));
  assert.match(returned, /Devolvida ao judge para correção/);

  const absent = render(buildSheetReceipt(input({ absent: true, official_result: '0', official_tie_break: null }, { summary: null })));
  assert.match(absent, /Ausência marcada/);
  assert.match(absent, />Ausente</);

  const loose = render(buildSheetReceipt(input({ heat_number: null, lane: null }, { heat: null })));
  assert.match(loose, /Sem bateria no cronograma/);
  assert.doesNotMatch(loose, /Horário no cronograma/);
});

test('1.145: rota do comprovante fora de buscadores, sem referer, lida a cada visita e sem dizer por que o link falhou', () => {
  const page = read('../src/app/[locale]/comprovante/sumula/[token]/page.tsx');
  assert.match(page, /export const dynamic = 'force-dynamic';/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /referrer: 'no-referrer'/);
  assert.match(page, /readSheetReceiptByToken\(createSupabaseAdmin\(\), decodeToken\(token\)\)/);
  assert.match(page, /Comprovante não encontrado/);
});
