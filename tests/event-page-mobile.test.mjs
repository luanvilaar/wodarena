import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.131: página do evento com a inscrição sempre à mão (P5 de
// docs/design/mobile-competitivo/).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');
const buyBar = read('../src/components/EventBuyBar.tsx');
const rulesSheet = read('../src/components/EventRulesSheet.tsx');
const page = read('../src/app/[locale]/event/[id]/page.tsx');
const messages = Object.fromEntries(['pt-br', 'pt-pt', 'en-gb'].map((l) => [l, JSON.parse(read(`../src/messages/${l}.json`))]));

test('topo: banner inteiro 5:2, título largo, regulamento só quando existe e comprovante', () => {
  assert.match(eventView, /relative aspect-\[5\/2\] w-full overflow-hidden bg-dark-gray/);
  assert.doesNotMatch(eventView, /h-\[390px\]|opacity-55/, 'o banner não fica mais escurecido atrás do texto');
  assert.match(eventView, /<h1 className="type-display /);
  assert.match(eventView, /const rulesText = \(event\.rules \?\? ''\)\.trim\(\);/);
  assert.match(eventView, /\{rulesText && \(\s*<button/);
  assert.match(eventView, /<NextLink href="\/admin#inscricoes"/);
  assert.match(eventView, /tTop\('divisionsCount', \{ count: activeDivisions\.length \}\)/);
});

test('folha do regulamento: diálogo acessível que fecha por Esc, fora ou botão e devolve o foco', () => {
  assert.match(rulesSheet, /role="dialog"\s+aria-modal="true"\s+aria-labelledby="event-rules-title"/);
  assert.match(rulesSheet, /if \(event\.key === 'Escape'\) onClose\(\);/);
  assert.match(rulesSheet, /aria-hidden="true" onClick=\{onClose\}/);
  assert.match(rulesSheet, /opener\?\.focus\(\);/);
  assert.match(rulesSheet, /whitespace-pre-wrap/);
  assert.match(eventView, /const closeRules = useCallback\(\(\) => setIsRulesOpen\(false\), \[\]\);/);
});

test('barra fixa: acima da navegação do rodapé no celular, some a partir de 1024 px', () => {
  assert.match(buyBar, /fixed inset-x-0 bottom-\[calc\(3\.5rem\+1px\+env\(safe-area-inset-bottom\)\)\] z-30 [^"]*md:bottom-0 md:pb-\[env\(safe-area-inset-bottom\)\] lg:hidden/);
  assert.match(buyBar, /aria-hidden="true" className="h-\[4\.75rem\] lg:hidden"/);
  assert.match(eventView, /\{registrationsAvailable \? \(\s*<EventBuyBar\s+mode="register"/);
  assert.match(eventView, /mode="results"/);
  assert.match(eventView, /mode="schedule"/);
  assert.match(eventView, /hidden space-y-4 rounded-xl border border-card-border bg-card p-6 transition-colors hover:border-primary lg:block/);
});

test('verbo único "Inscrever-se" e abas com nomes do atleta', () => {
  const pt = messages['pt-br'];
  assert.equal(pt.Event.buyTicket, 'Inscrever-se');
  assert.equal(pt.Event.sidebar.registerCta, 'Inscrever-se');
  assert.equal(pt.EventCard.guaranteeSpot, 'Inscrever-se');
  assert.deepEqual(pt.Event.tabs, { details: 'Sobre', divisions: 'Categorias', schedule: 'Cronograma', workouts: 'Provas', leaderboard: 'Ranking' });
  for (const locale of Object.keys(messages)) {
    for (const key of ['rules', 'closeRules', 'alreadyRegistered', 'from', 'perAthlete', 'perDuo', 'perTrio', 'perTeam', 'divisionsCount', 'viewSchedule', 'viewResults']) {
      assert.ok(messages[locale].Event.top[key], `${locale}: Event.top.${key}`);
    }
  }
  assert.doesNotMatch(eventView, /target="_blank"\s+rel="noopener noreferrer"\s+className=\{classes\}/, 'Ranking abre na mesma aba');
  assert.match(page, /getScopedMessages\(\['Event', 'EventCard', 'Checkout'\]\)/);
});
