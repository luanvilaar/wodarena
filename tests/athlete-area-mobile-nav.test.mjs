import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ATHLETE_SECTIONS,
  DEFAULT_ATHLETE_SECTION,
  getAthleteRegistrationElementId,
  getAthleteSectionHash,
  getAthleteSectionServerSnapshot,
  getAthleteSectionSnapshot,
  pushAthleteSection,
  resolveAthleteSectionFromHash,
  subscribeToAthleteSection
} from '../src/lib/athleteSections.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const adminPage = read('../src/app/admin/page.tsx');
const sectionsModule = read('../src/lib/athleteSections.ts');
const globalsCss = read('../src/app/globals.css');
const athleteSubmissions = read('../src/components/QualifierAthleteSubmissions.tsx');
const athleteContestation = read('../src/components/QualifierAthleteContestation.tsx');

// Ramo da Área do Atleta: do early return do atleta até o próximo early return.
const athleteBranchStart = adminPage.indexOf('if (isAthleteLoggedIn && currentUser) {');
const athleteBranchEnd = adminPage.indexOf('if (isManagerLoggedIn && currentUser && isManagerAccessExpired)');
const athleteBranch = adminPage.slice(athleteBranchStart, athleteBranchEnd);

const bottomNavStart = athleteBranch.indexOf('data-athlete-bottom-nav=""');
const bottomNav = athleteBranch.slice(bottomNavStart, athleteBranch.indexOf('</nav>', bottomNavStart));
const sidebarStart = athleteBranch.indexOf('<aside');
const sidebar = athleteBranch.slice(sidebarStart, athleteBranch.indexOf('</aside>', sidebarStart));

// Regras de nível superior do CSS (fora de qualquer @media/@layer), com o
// seletor exato; devolve o corpo da regra ou null.
const topLevelRule = (source, selector) => {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let ruleStart = 0;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') {
      if (depth === 0 && css.slice(ruleStart, index).trim() === selector) {
        return css.slice(index + 1, css.indexOf('}', index));
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) ruleStart = index + 1;
    } else if (char === ';' && depth === 0) {
      ruleStart = index + 1;
    }
  }
  return null;
};

// Especificidade simplificada (ids, classes/atributos/pseudo-classes, elementos).
const specificity = (selector) => [
  (selector.match(/#[\w-]+/g) || []).length,
  (selector.match(/\[[^\]]+\]|\.[\w-]+|:(?!:)[\w-]+/g) || []).length,
  (selector.replace(/\[[^\]]+\]|[.#:][\w-]+/g, ' ').match(/\b[a-z][\w-]*\b/gi) || []).length
];
const outranks = (a, b) => {
  const [sa, sb] = [specificity(a), specificity(b)];
  for (let index = 0; index < 3; index += 1) {
    if (sa[index] !== sb[index]) return sa[index] > sb[index];
  }
  return false;
};

test('athlete branch boundaries are found in the admin page', () => {
  assert.ok(athleteBranchStart > 0, 'athlete branch start not found');
  assert.ok(athleteBranchEnd > athleteBranchStart, 'athlete branch end not found');
  assert.ok(bottomNavStart > 0, 'bottom nav not found in athlete branch');
  assert.ok(sidebarStart > 0, 'sidebar not found in athlete branch');
});

test('sections follow Inscrições · Resultados · Contestar · Perfil and open on events', () => {
  assert.deepEqual(ATHLETE_SECTIONS.map(section => section.id), ['events', 'submissions', 'contestations', 'profile']);
  assert.deepEqual(ATHLETE_SECTIONS.map(section => section.shortLabel), ['Inscrições', 'Resultados', 'Contestar', 'Perfil']);
  assert.deepEqual(ATHLETE_SECTIONS.map(section => section.label), ['Inscrições', 'Enviar resultados', 'Contestações', 'Dados do perfil']);
  assert.equal(DEFAULT_ATHLETE_SECTION, 'events');
  assert.equal(getAthleteSectionServerSnapshot(), 'events');
  assert.doesNotMatch(adminPage, /useState<'profile' \| 'events' \| 'submissions' \| 'contestations'>\('profile'\)/);
});

test('section hash mapping round-trips and tolerates foreign hashes', () => {
  assert.equal(getAthleteSectionHash('events'), '#inscricoes');
  assert.equal(getAthleteSectionHash('submissions'), '#resultados');
  assert.equal(getAthleteSectionHash('contestations'), '#contestar');
  assert.equal(getAthleteSectionHash('profile'), '#perfil');

  for (const section of ATHLETE_SECTIONS) {
    assert.equal(resolveAthleteSectionFromHash(getAthleteSectionHash(section.id)), section.id);
  }

  // Ausente ou vazio: seção padrão, mesmo vindo de outra seção.
  assert.equal(resolveAthleteSectionFromHash('', 'profile'), 'events');
  assert.equal(resolveAthleteSectionFromHash('#', 'profile'), 'events');
  // Inválido na abertura: seção padrão.
  assert.equal(resolveAthleteSectionFromHash('#qualquer-coisa'), 'events');
  assert.equal(resolveAthleteSectionFromHash('#__proto__'), 'events');
  // Hash de outra finalidade (skip link) não derruba a seção atual.
  assert.equal(resolveAthleteSectionFromHash('#main-content', 'contestations'), 'contestations');
  assert.equal(resolveAthleteSectionFromHash('#PERFIL'), 'profile');
});

test('section store is event driven: no spontaneous change on render, history in sync', () => {
  // window falso: EventTarget real + location/history mínimos.
  const fakeWindow = new EventTarget();
  const listenerCount = new Map();
  const addEventListener = fakeWindow.addEventListener.bind(fakeWindow);
  const removeEventListener = fakeWindow.removeEventListener.bind(fakeWindow);
  fakeWindow.addEventListener = (type, listener) => {
    listenerCount.set(type, (listenerCount.get(type) ?? 0) + 1);
    addEventListener(type, listener);
  };
  fakeWindow.removeEventListener = (type, listener) => {
    listenerCount.set(type, (listenerCount.get(type) ?? 0) - 1);
    removeEventListener(type, listener);
  };
  const pushed = [];
  fakeWindow.location = { hash: '#perfil' };
  fakeWindow.history = { pushState: (_state, _title, url) => { pushed.push(url); fakeWindow.location.hash = url; } };
  fakeWindow.navigation = new EventTarget();
  globalThis.window = fakeWindow;

  try {
    // Montagem: lê o hash atual.
    let notified = 0;
    const unsubscribe = subscribeToAthleteSection(() => { notified += 1; });
    assert.equal(getAthleteSectionSnapshot(), 'profile');

    // <Link> do Next limpa o hash sem hashchange/popstate: render seguinte não troca a seção.
    fakeWindow.location.hash = '';
    assert.equal(getAthleteSectionSnapshot(), 'profile');
    assert.equal(getAthleteSectionSnapshot(), 'profile');
    assert.equal(notified, 0);

    // Navigation API: replaceState interno do Next não é navegação do atleta.
    const entryChange = (navigationType) => Object.assign(new Event('currententrychange'), { navigationType });
    fakeWindow.navigation.dispatchEvent(entryChange('replace'));
    assert.equal(getAthleteSectionSnapshot(), 'profile');
    assert.equal(notified, 0);

    // Uma entrada nova (push, ex.: <Link> para /admin) realinha seção e URL.
    fakeWindow.navigation.dispatchEvent(entryChange('push'));
    assert.equal(getAthleteSectionSnapshot(), 'events');
    assert.equal(notified, 1);

    // Ação do usuário: empilha uma vez só e notifica.
    pushAthleteSection('submissions');
    pushAthleteSection('submissions');
    assert.deepEqual(pushed, ['#resultados']);
    assert.equal(getAthleteSectionSnapshot(), 'submissions');

    // Skip link: hash estranho mantém a seção.
    fakeWindow.location.hash = '#main-content';
    fakeWindow.dispatchEvent(new Event('hashchange'));
    assert.equal(getAthleteSectionSnapshot(), 'submissions');

    // Voltar até a entrada sem hash: Inscrições.
    fakeWindow.location.hash = '';
    fakeWindow.dispatchEvent(new Event('popstate'));
    assert.equal(getAthleteSectionSnapshot(), 'events');

    // Desmontar remove todos os ouvintes e zera a memória.
    unsubscribe();
    for (const type of ['hashchange', 'popstate', 'wodarena:athlete-section-change']) {
      assert.equal(listenerCount.get(type), 0, `listener ${type} left behind`);
    }
    fakeWindow.location.hash = '#contestar';
    assert.equal(getAthleteSectionSnapshot(), 'contestations');
  } finally {
    delete globalThis.window;
  }
});

test('active section uses the external store without hooks in the athlete branch', () => {
  assert.match(adminPage, /const activeAthleteSection = useSyncExternalStore\(\s*subscribeToAthleteSection,\s*getAthleteSectionSnapshot,\s*getAthleteSectionServerSnapshot\s*\)/);
  // Regras dos hooks: o ramo do atleta vem depois de early returns.
  assert.doesNotMatch(athleteBranch, /\buse(?:State|Effect|LayoutEffect|SyncExternalStore|Ref|Memo|Callback)\(/);
  assert.match(sectionsModule, /getAthleteSectionSnapshot = \(\): AthleteSectionId =>\s*currentAthleteSection \?\? readAthleteSection\(\)/);
  assert.match(adminPage, /if \(section !== activeAthleteSection\) \{\s*pushAthleteSection\(section\);/);
});

test('switching sections keeps the section start visible on short screens and moves focus', () => {
  assert.match(adminPage, /const ATHLETE_SECTION_MIN_VISIBLE_PX = 160;/);
  assert.match(adminPage, /document\.querySelector\('\[data-athlete-bottom-nav\]'\)\?\.getBoundingClientRect\(\)/);
  assert.match(adminPage, /const visibleBottom = bottomNavRect && bottomNavRect\.height > 0 \? bottomNavRect\.top : window\.innerHeight;/);
  assert.match(adminPage, /if \(top < scrollMarginTop \|\| top > visibleBottom - ATHLETE_SECTION_MIN_VISIBLE_PX\) \{/);
  assert.match(adminPage, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches \? 'instant' : 'smooth'/);
  assert.equal((adminPage.match(/target\.focus\(\{ preventScroll: true \}\)/g) || []).length, 2);

  // Contêiner focável, nomeado e sem contorno visual.
  assert.match(athleteBranch, /ref=\{athleteContentRef\}\s+tabIndex=\{-1\}\s+role="region"\s+aria-label=\{activeAthleteSectionLabel\}\s+data-athlete-section-content=""\s+className="min-w-0 scroll-mt-20 space-y-6"/);
  const containerRule = topLevelRule(globalsCss, '[data-athlete-section-content]:focus-visible');
  assert.ok(containerRule, 'content container focus rule must be a top-level (unlayered) rule');
  assert.match(containerRule, /outline: none;/);
});

test('mobile bottom navigation is fixed, thumb sized, accessible and safe-area aware', () => {
  assert.match(athleteBranch, /<nav\s+aria-label="Seções da Área do Atleta"\s+data-athlete-bottom-nav=""/);
  assert.match(bottomNav, /className="fixed inset-x-0 bottom-0 z-40 [^"]*lg:hidden"/);
  assert.match(bottomNav, /border-t border-card-border bg-card/);
  assert.match(bottomNav, /pb-\[max\(0\.5rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(bottomNav, /grid max-w-lg grid-cols-4/);
  assert.match(bottomNav, /type="button"/);
  assert.match(bottomNav, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(bottomNav, /min-h-14 w-full/);
  assert.match(bottomNav, /text-\[11px\]/);
  assert.match(bottomNav, /isActive \? 'font-bold text-primary'/);
  assert.match(bottomNav, /motion-reduce:transition-none/);
  assert.match(bottomNav, /\{section\.shortLabel\}/);
  assert.doesNotMatch(bottomNav, /backdrop-blur|bg-gradient/);
});

test('focus ring of bottom bar items is drawn inside and actually beats the global rule', () => {
  const globalRule = topLevelRule(globalsCss, ':focus-visible');
  const barRule = topLevelRule(globalsCss, '[data-athlete-bottom-nav] button:focus-visible');
  assert.ok(globalRule, 'global :focus-visible rule not found at top level');
  assert.ok(barRule, 'bottom bar focus rule must be a top-level (unlayered) rule');
  assert.match(globalRule, /outline: 2px solid var\(--info\);/);
  assert.match(barRule, /outline-offset: -4px;/);
  assert.ok(outranks('[data-athlete-bottom-nav] button:focus-visible', ':focus-visible'));
  assert.ok(outranks('[data-athlete-section-content]:focus-visible', ':focus-visible'));
  // Utilitários focus-visible do Tailwind ficam em @layer e perderiam para o
  // :focus-visible global sem camada: não devem voltar ao ramo do atleta.
  assert.doesNotMatch(athleteBranch, /focus-visible:/);
});

test('desktop keeps a vertical sticky sidebar and no horizontal scrolling nav remains', () => {
  assert.match(sidebar, /<aside className="hidden self-start lg:sticky lg:top-24 lg:block">/);
  assert.match(sidebar, /<nav aria-label="Seções da Área do Atleta"/);
  assert.match(sidebar, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(sidebar, /\{section\.label\}/);
  assert.doesNotMatch(athleteBranch, /overflow-x-auto/);
});

test('document keeps clearance for the fixed bar below lg, including the global footer', () => {
  assert.match(globalsCss, /@media \(width < 64rem\) \{\s*html:has\(\[data-athlete-bottom-nav\]\) \{/);
  assert.match(globalsCss, /--athlete-bottom-nav-clearance: calc\(4rem \+ max\(0\.5rem, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(globalsCss, /html:has\(\[data-athlete-bottom-nav\]\) body \{\s*padding-bottom: var\(--athlete-bottom-nav-clearance\);/);
});

test('one pending set feeds the nav badge, the "Pendentes" count and its target', () => {
  assert.match(athleteBranch, /const athletePendingRegistrations = athleteRegistrations\.filter\(reg =>\s*reg\.paymentStatus === 'payment_failed' \|\|\s*reg\.paymentStatus === 'payment_pending' \|\|\s*reg\.paymentStatus === 'payment_in_review'\s*\);/);
  assert.match(athleteBranch, /const athletePendingCount = athletePendingRegistrations\.length;/);
  assert.doesNotMatch(athleteBranch, /pendingPayments|athletePaymentActionCount/);

  // Selo (barra e sidebar) e faixa leem o mesmo número.
  assert.match(bottomNav, /showPendingBadge = section\.id === 'events' && athletePendingCount > 0/);
  assert.match(sidebar, /showPendingBadge = section\.id === 'events' && athletePendingCount > 0/);
  assert.match(athleteBranch, /\{athletePendingCount > 0 \? \(/);
  assert.match(athleteBranch, /<span className=\{`\$\{athleteStatNumberClassName\} text-primary`\}>\{athletePendingCount\}<\/span>/);

  // Visual aria-hidden + texto acessível com singular correto.
  assert.match(bottomNav, /aria-hidden="true"[\s\S]*\{athletePendingBadge\}/);
  assert.match(bottomNav, /<span className="sr-only">, \{athletePendingLabel\}<\/span>/);
  assert.match(athleteBranch, /\? '1 inscrição com pagamento pendente'\s*: `\$\{athletePendingCount\} inscrições com pagamento pendente`/);

  // "Pendentes" leva ao primeiro cartão do conjunto, mesmo já estando em Inscrições.
  assert.match(athleteBranch, /onClick=\{\(\) => navigateToAthleteSection\('events', getAthleteRegistrationElementId\(athletePendingRegistrations\[0\]\.id\)\)\}/);
  assert.match(athleteBranch, /const athleteStatCellClassName = 'flex min-h-14 /);
  assert.match(athleteBranch, /grid grid-cols-3 divide-x divide-card-border/);
});

test('compact header keeps a 44px "Sair" at every size', () => {
  assert.match(athleteBranch, /<BrandLogo className="h-10 w-10 shrink-0/);
  assert.match(athleteBranch, /<h2 id="athlete-area-title" className="truncate[^"]*">Área do Atleta<\/h2>/);
  assert.match(athleteBranch, /className="truncate text-xs text-muted" title=\{currentUser\.email\}/);
  assert.match(athleteBranch, /onClick=\{logout\}\s+className="flex min-h-11 [^"]*"\s*>\s*<LogOut className="h-4 w-4" aria-hidden="true" \/>\s*<span>Sair<\/span>/);
  assert.doesNotMatch(athleteBranch, /Desconectar/);
});

test('section headers match the navigation, without eyebrows and with accents', () => {
  assert.doesNotMatch(athleteBranch, /tracking-\[0\.16em\] text-primary/);
  assert.doesNotMatch(athleteSubmissions, /tracking-\[0\.16em\] text-primary/);
  assert.match(athleteBranch, /<h3 className="[^"]*">Dados do perfil<\/h3>/);
  assert.match(athleteBranch, /<h3 className="[^"]*">Minhas inscrições<\/h3>/);
  assert.match(athleteSubmissions, /<h3 className="[^"]*">Enviar resultados<\/h3>/);
  assert.match(athleteBranch, /<h3 className="[^"]*">Contestar prova<\/h3>/);
  assert.match(athleteBranch, /<h3 className="[^"]*">Contestações enviadas<\/h3>/);
  // Formulário de contestação do qualifier: contexto no próprio título, sem eyebrow.
  assert.doesNotMatch(athleteContestation, /text-primary">Qualifier online</);
  assert.match(athleteContestation, /<h4 className="[^"]*">Contestar uma decisão de submissão do Qualifier online<\/h4>/);
});

test('failed payment banner offers "Pagar agora" that scrolls to the first failed registration', () => {
  assert.match(athleteBranch, /Pagamento não processado/);
  assert.match(athleteBranch, /onClick=\{\(\) => navigateToAthleteSection\('events', getAthleteRegistrationElementId\(failedPayments\[0\]\.id\)\)\}/);
  assert.match(athleteBranch, /<span>Pagar agora<\/span>/);
  assert.equal(getAthleteRegistrationElementId('abc-123'), 'athlete-registration-abc-123');
  assert.match(athleteBranch, /id=\{registrationElementId\}\s+tabIndex=\{-1\}/);
  assert.match(athleteBranch, /className="scroll-mt-20 rounded-lg border/);
});

test('registration card keeps every action and handler with the new hierarchy', () => {
  assert.match(athleteBranch, /setPayingPixRegistration\(\{ reg, event, athlete \}\)/);
  assert.match(athleteBranch, /onClick=\{\(\) => handleRedirectToCardPreference\(reg\)\}/);
  assert.match(athleteBranch, /onClick=\{\(\) => handleOpenAthleteVoucher\(reg\)\}/);
  assert.match(athleteBranch, /onClick=\{\(\) => handleResendRegistrationVoucher\(reg\)\}/);
  assert.match(athleteBranch, /href=\{`\/event\/\$\{event\.id\}`\}/);
  assert.match(athleteBranch, /href=\{`\/event\/\$\{event\.id\}\/leaderboard`\}/);

  // Pix primária em verde; Cartão em contorno com a nota do redirecionamento.
  assert.match(athleteBranch, /min-h-11 w-full items-center justify-center gap-1\.5 rounded-md bg-trading-up/);
  assert.match(athleteBranch, /aria-describedby=\{cardRedirectNoteId\}\s+className=\{athleteSecondaryActionClassName\}/);
  assert.match(athleteBranch, /Abre a página do Mercado Pago/);
  assert.match(athleteBranch, /className=\{needsPayment \? athleteTertiaryActionClassName : athleteSecondaryActionClassName\}/);

  const secondary = athleteBranch.match(/const athleteSecondaryActionClassName = '([^']+)'/)?.[1] ?? '';
  const tertiary = athleteBranch.match(/const athleteTertiaryActionClassName = '([^']+)'/)?.[1] ?? '';
  assert.match(secondary, /\bborder-muted-soft\b/, 'contorno do secundário com contraste >= 3:1');
  for (const className of [secondary, tertiary]) {
    assert.match(className, /\bmin-h-11\b/);
    assert.match(className, /\bw-full\b/);
    assert.doesNotMatch(className, /\bbg-primary\b/, 'comprovante e 2ª via nunca em amarelo cheio');
  }

  // Mobile: ações de pagamento vêm antes dos links do evento; em lg as ações
  // ocupam a coluna da direita e os links voltam para baixo da informação.
  const actionsIndex = athleteBranch.indexOf('lg:col-start-2 lg:row-span-2 lg:row-start-1');
  const linksIndex = athleteBranch.indexOf('lg:col-start-1 lg:row-start-2');
  assert.ok(actionsIndex > 0 && linksIndex > actionsIndex, 'ações de pagamento devem preceder os links do evento no DOM');

  // Id interno e nome do atleta saem do bloco principal para o rodapé do cartão.
  assert.match(athleteBranch, /<dl className="mt-\d flex flex-wrap[^"]*text-\[11px\]/);
  assert.match(athleteBranch, /<dt className="shrink-0 font-semibold">Inscrição:<\/dt>/);
  assert.match(athleteBranch, /<dt className="shrink-0 font-semibold">Atleta:<\/dt>/);
  assert.doesNotMatch(athleteBranch, /min-h-10|min-h-9/);
});
