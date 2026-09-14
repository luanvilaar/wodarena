import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260718133000_featured_home_event.sql');
const hardeningMigration = read('../supabase/migrations/20260914120000_harden_featured_home_event.sql');
const types = read('../src/types/index.ts');
const bootstrapPayload = read('../src/lib/bootstrapPayload.ts');
const authenticatedBootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const ownerPage = read('../src/app/owner/page.tsx');
const adminPersistence = read('../src/app/api/admin/persistence/route.ts');
const featuredBanner = read('../src/components/home/FeaturedEventBanner.tsx');
const globalsCss = read('../src/app/globals.css');

test('featured event flag is versioned and initializes the approved July 2026 event', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /COMMENT ON COLUMN events\.is_featured/);
  assert.match(migration, /name ILIKE '%Training Camp Fitblock%'/);
  assert.match(migration, /name ILIKE '%HYPULSE CHALLENGE%'/);
  assert.match(migration, /name ILIKE '%JULHO 2026%'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_set_featured_home_event/);
  assert.match(migration, /UPDATE events\s+SET is_featured = FALSE/);
  assert.match(migration, /SET is_featured = TRUE/);
});

test('featured event flag is exposed in event types and public bootstrap payload', () => {
  assert.match(types, /isFeatured\?: boolean/);
  assert.match(bootstrapPayload, /is_featured/);
  assert.match(bootstrapPayload, /PUBLIC_EVENT_SELECT_LEGACY/);
  assert.match(bootstrapPayload, /readEventsWithFeaturedFallback/);
  assert.match(bootstrapPayload, /withDefaultFeaturedFlag/);
  assert.match(authenticatedBootstrapRoute, /readEventsWithFeaturedFallback/);
  assert.match(appContext, /isFeatured: evt\.is_featured !== undefined && evt\.is_featured !== null \? Boolean\(evt\.is_featured\) : false/);
});

test('event managers cannot control the home highlight from event forms', () => {
  assert.doesNotMatch(adminPage, /Destaque na home/);
  assert.doesNotMatch(adminPage, /event-featured-home/);
  assert.doesNotMatch(adminPage, /edit-event-featured-home/);
  assert.doesNotMatch(adminPage, /setEventIsFeatured/);
  assert.doesNotMatch(adminPage, /setEditEventIsFeatured/);
  assert.doesNotMatch(appContext, /is_featured: newEvent\.isFeatured/);
  assert.doesNotMatch(appContext, /updatedData\.isFeatured/);
});

test('owner panel exposes the home banner highlight control and dedicated action', () => {
  assert.match(ownerPage, /setFeaturedHomeEvent/);
  assert.match(ownerPage, /owner-featured-home-event/);
  assert.match(ownerPage, /handleSaveFeaturedHomeEvent/);
  assert.match(ownerPage, /Banner da home/);
  assert.match(ownerPage, /getEventStatus\(event\) !== 'finished'/);
  assert.match(appContext, /setFeaturedHomeEvent: \(eventId: string \| null\) => Promise<void>/);
  assert.match(appContext, /adminPersist\('setFeaturedHomeEvent', \{ eventId \}\)/);
});

test('featured home event persistence is owner-only and bypasses generic event updates', () => {
  assert.match(adminPersistence, /case 'setFeaturedHomeEvent'/);
  assert.match(adminPersistence, /actor\.role !== 'owner'/);
  assert.match(adminPersistence, /admin_set_featured_home_event/);
  assert.match(adminPersistence, /delete event\.is_featured/);
  assert.match(adminPersistence, /'is_featured' in payload\.data/);
  assert.match(adminPersistence, /Use a acao setFeaturedHomeEvent/);
  assert.match(adminPersistence, /getEventStatus\(event\) === 'finished'/);
  assert.match(adminPersistence, /Apenas eventos ativos podem ser destacados na home/);
});

test('featured home RPC is server-only and rejects non-active event records', () => {
  assert.match(hardeningMigration, /AND status IN \('live', 'upcoming'\)/);
  assert.match(hardeningMigration, /REVOKE ALL ON FUNCTION public\.admin_set_featured_home_event\(TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION public\.admin_set_featured_home_event\(TEXT\) TO service_role/);
});

test('home banner carousel prioritizes highlighted events and keeps finished events excluded', () => {
  // Elegibilidade: eventos ativos, não encerrados, ordenados cronologicamente.
  assert.match(featuredBanner, /const eligibleEvents = useMemo\(\(\) => events/);
  assert.match(featuredBanner, /getEventStatus\(event\) !== 'finished'/);
  // Destaques do owner (isFeatured) vêm antes do resto na fila de slides.
  assert.match(featuredBanner, /const featured = eligibleEvents\.filter\(\(event\) => event\.isFeatured\);/);
  assert.match(featuredBanner, /const rest = eligibleEvents\.filter\(\(event\) => !event\.isFeatured\);/);
  assert.match(featuredBanner, /return \[\.\.\.featured, \.\.\.rest\]\.slice\(0, MAX_EVENT_SLIDES\);/);
});

test('home banner carousel opens with the commercial slide, one unified layout for every screen size', () => {
  // Um único componente responsivo — não há mais markup duplicado de mobile/desktop.
  assert.doesNotMatch(featuredBanner, /Banner Versão Mobile/);
  assert.doesNotMatch(featuredBanner, /Banner Versão Desktop/);
  assert.match(featuredBanner, /const slides: BannerSlide\[\] = useMemo\(\(\) => \[\s*\{ id: 'commercial', kind: 'commercial' \},/);
  assert.match(featuredBanner, /t\('newManagerCta'\)/);
  assert.match(featuredBanner, /onClick=\{openLeadModal\}/);
  // A primeira arte é o elemento LCP real da home: prioridade nela, lazy no resto.
  assert.match(featuredBanner, /priority=\{isFirstSlide\}/);
  assert.match(featuredBanner, /loading=\{isFirstSlide \? undefined : 'lazy'\}/);
  assert.match(featuredBanner, /className="object-cover"/);
  // Vendas encerradas: rótulo de estado + ação para ver o evento, não um botão desabilitado.
  assert.match(featuredBanner, /t\('salesClosedBadge'\)/);
  assert.match(featuredBanner, /t\('viewFullEvent'\)/);
  // Slide de evento declara estado da inscrição, data e localidade junto do título.
  assert.match(featuredBanner, /t\('kickerOpen'\)/);
  assert.match(featuredBanner, /const activePlace = activeEvent/);
  // Carrossel acessível: pausa em hover/foco, navegação por teclado, respeita reduced-motion.
  assert.match(featuredBanner, /const holdOnPointer = \{/);
  assert.match(featuredBanner, /prefers-reduced-motion: reduce/);
  assert.match(featuredBanner, /aria-roledescription="carousel"/);
});

test('carousel renders one content layer for the active slide, outside the slide loop', () => {
  // Defeito corrigido: título, CTA, selo e controles eram replicados dentro do
  // loop de slides. Com todos os slides visíveis ao mesmo tempo, o visitante
  // lia o conteúdo do último slide do DOM enquanto o clique atravessava para o
  // botão invisível do slide realmente ativo — e se inscrevia no evento errado.
  assert.match(featuredBanner, /const activeSlide = slides\[safeIndex\];/);
  assert.match(featuredBanner, /onClick=\{\(\) => setRegisteringEvent\(activeEvent\)\}/);
  assert.equal(featuredBanner.match(/<h2/g)?.length, 1);
  assert.equal(featuredBanner.match(/t\('registerNow'\)/g)?.length, 1);
  assert.equal(featuredBanner.match(/t\('pauseAutoplay'\)/g)?.length, 1);
  // Sem conteúdo duplicado não sobra slide inativo interceptando ponteiro,
  // foco ou leitor de tela.
  assert.doesNotMatch(featuredBanner, /tabIndex=\{isActive \? 0 : -1\}/);
  assert.doesNotMatch(featuredBanner, /pointer-events-none/);
  assert.doesNotMatch(featuredBanner, /aria-hidden=\{!isActive\}/);
});

test('carousel stays outside the home-broadcast animation namespace', () => {
  // Causa raiz do carrossel travado: .home-broadcast-featured-* aplicava
  // animation com fill-mode "both", que fixa opacity: 1 no nível de cascata de
  // animações e anula o opacity-0 dos slides inativos. Em reduced-motion a
  // regra [class*="home-broadcast-"] ainda forçava opacity: 1 !important.
  assert.doesNotMatch(featuredBanner, /home-broadcast-/);
  assert.match(featuredBanner, /className="wa-hero/);
  assert.doesNotMatch(globalsCss, /home-broadcast-featured/);
  assert.match(globalsCss, /\.wa-hero__copy \{\s*animation: wa-hero-copy-in [^;]*backwards;/);
  assert.doesNotMatch(globalsCss, /\.wa-hero__copy \{[^}]*both;/);
});

test('carousel autoplay pauses per interaction cause and never expires the pause on a timer', () => {
  // Cada motivo de pausa vive em seu próprio estado: mouse, foco e modal de
  // inscrição aberto. Um único booleano compartilhado exigia um timeout de
  // segurança que retomava o autoplay com o visitante ainda lendo o slide.
  assert.match(featuredBanner, /const isPaused = autoplayPaused \|\| pointerHold \|\| focusHold \|\| registeringEvent !== null;/);
  assert.doesNotMatch(featuredBanner, /MAX_PAUSE_MS/);
  assert.doesNotMatch(featuredBanner, /setIsPaused/);
  // Foco preso dentro dos controles mantém a pausa — sem isso o autoplay
  // avançava e trocava o conteúdo sob o elemento focado.
  // Foco por teclado segura; foco herdado de um clique nao — senao clicar em
  // "retomar" deixava o autoplay parado, preso pelo foco do proprio botao.
  assert.match(featuredBanner, /if \(isKeyboardFocus\(event\.target\)\) setFocusHold\(true\);/);
  assert.match(featuredBanner, /target\.matches\(':focus-visible'\)/);
  // Navegação manual (dots, setas, teclado, swipe) reinicia a contagem.
  assert.match(featuredBanner, /setManualNavToken\(token => token \+ 1\);/);
  assert.match(featuredBanner, /\}, \[slides\.length, hasMultipleSlides, isPaused, prefersReducedMotion, manualNavToken\]\);/);
  assert.match(featuredBanner, /onClick=\{\(\) => setAutoplayPaused\(\(paused\) => !paused\)\}/);
  assert.match(featuredBanner, /t\('resumeAutoplay'\)/);
  // Preferência de movimento reavaliada em runtime, não só na montagem.
  assert.match(featuredBanner, /query\.addEventListener\('change', sync\);/);
});

test('carousel only mounts the current artwork and its immediate neighbors', () => {
  assert.match(featuredBanner, /const renderedImageIndexes = new Set\(\[/);
  assert.match(featuredBanner, /if \(!renderedImageIndexes\.has\(index\)\) return null;/);
});

test('owner banner preview and public carousel stay bound to the same slide rule', () => {
  // O limite de slides de evento é a única fonte de divergência silenciosa
  // entre o preview do painel e o carrossel real: compara os dois números.
  const bannerLimit = featuredBanner.match(/const MAX_EVENT_SLIDES = (\d+);/);
  const panelLimit = ownerPage.match(/const BANNER_MAX_EVENT_SLIDES = (\d+);/);
  assert.ok(bannerLimit, 'MAX_EVENT_SLIDES ausente em FeaturedEventBanner');
  assert.ok(panelLimit, 'BANNER_MAX_EVENT_SLIDES ausente no painel do owner');
  assert.equal(panelLimit[1], bannerLimit[1]);

  // Mesma regra de elegibilidade nos dois lados (ativos e não encerrados).
  for (const source of [featuredBanner, ownerPage]) {
    assert.match(source, /event\.status === 'live' \|\| event\.status === 'upcoming'/);
    assert.match(source, /getEventStatus\(event\) !== 'finished'/);
    assert.match(source, /\.sort\(compareEventsByDateAsc\)/);
  }

  // Destaque primeiro, resto por data, corte no limite — nos dois lados.
  assert.match(featuredBanner, /return \[\.\.\.featured, \.\.\.rest\]\.slice\(0, MAX_EVENT_SLIDES\);/);
  assert.match(ownerPage, /return \[\.\.\.featured, \.\.\.rest\]\.slice\(0, BANNER_MAX_EVENT_SLIDES\);/);
});

test('owner banner tab previews the pending selection and never keeps a phantom draft', () => {
  // Preview espelha a seleção em tela, não o valor já publicado — trocar o
  // select tem de mudar a ordem exibida antes de salvar.
  assert.match(ownerPage, /const featured = featuredHomeCandidates\.filter\(event => event\.id === selectedFeaturedHomeDraftId\);/);
  assert.match(ownerPage, /const rest = featuredHomeCandidates\.filter\(event => event\.id !== selectedFeaturedHomeDraftId\);/);
  assert.match(ownerPage, /const isFeatured = event\.id === selectedFeaturedHomeDraftId;/);

  // Rascunho só vale se o select realmente oferece a opção, senão o controle
  // volta ao estado publicado em vez de travar o botão com valor fantasma.
  assert.match(ownerPage, /const featuredHomeDraftIsSelectable = featuredHomeDraftId !== null/);
  assert.match(ownerPage, /featuredHomeCandidates\.some\(event => event\.id === featuredHomeDraftId\)/);

  // Rascunho é descartado ao salvar e ao sair da aba.
  assert.match(ownerPage, /setFeaturedHomeDraftId\(null\);/);
  assert.match(ownerPage, /if \(tabId !== 'banner'\) setFeaturedHomeDraftId\(null\);/);

  // Avisos de estado: destaque fora do ar e alteração ainda não publicada.
  assert.match(ownerPage, /const featuredHomeEventIsOffAir = Boolean\(featuredHomeEvent\)/);
  assert.match(ownerPage, /const featuredHomeHasPendingChange = selectedFeaturedHomeDraftId !== \(featuredHomeEvent\?\.id \|\| ''\);/);
  assert.match(ownerPage, /Este evento encerrou e não aparece mais no carrossel/);
  assert.match(ownerPage, /Pré-visualização da alteração pendente/);

  // Candidatos ativos cortados pelo limite são declarados ao owner.
  assert.match(ownerPage, /const bannerOverflowEvents = useMemo/);
  assert.match(ownerPage, /Fora do carrossel:/);

  // Cada item da lista escolhe o destaque — o pill deixou de ser decoração.
  assert.match(ownerPage, /onClick=\{\(\) => setFeaturedHomeDraftId\(event\.id\)\}/);
  assert.match(ownerPage, /aria-pressed=\{isFeatured\}/);

  // Textos da aba seguem a ortografia do restante do painel.
  assert.doesNotMatch(ownerPage, /Selecao automatica/);
  assert.doesNotMatch(ownerPage, /proximos slides/);
  assert.doesNotMatch(ownerPage, /evento ativo disponivel/);
});
