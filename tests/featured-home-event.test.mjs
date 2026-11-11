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
// Story 1.126: a vitrine da home foi para a seção Configurações (OwnerHomeShowcase).
const ownerPageOnly = read('../src/app/owner/page.tsx');
const ownerPage = `${ownerPageOnly}\n${read('../src/components/owner/OwnerHomeShowcase.tsx')}\n${read('../src/lib/homeShowcase.ts')}`;
const adminPersistence = read('../src/app/api/admin/persistence/route.ts');
const homeView = read('../src/app/[locale]/HomeView.tsx');
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
  assert.match(ownerPage, /Destaque da home atualizado para/);
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
  // Story 1.71: o evento é lido com as datas e convertido antes da regra.
  assert.match(adminPersistence, /getEventStatus\(toEventLifecycleInput\(event\)\) === 'finished'/);
  assert.match(adminPersistence, /Apenas eventos ativos podem ser destacados na home/);
});

test('featured home RPC is server-only and rejects non-active event records', () => {
  assert.match(hardeningMigration, /AND status IN \('live', 'upcoming'\)/);
  assert.match(hardeningMigration, /REVOKE ALL ON FUNCTION public\.admin_set_featured_home_event\(TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION public\.admin_set_featured_home_event\(TEXT\) TO service_role/);
});

test('home: o destaque do dono abre a lista e o carrossel saiu (Story 1.132)', () => {
  // Mesma regra de candidato do painel (ativo e não encerrado), em HomeView.
  assert.match(homeView, /import \{ isFeaturedHomeCandidate \} from '@\/lib\/homeShowcase';/);
  assert.match(homeView, /const featuredEvent = upcomingEvents\.find\(\(event\) => event\.isFeatured && isFeaturedHomeCandidate\(event\)\) \?\? null;/);
  assert.match(homeView, /const listedUpcoming = featuredEvent \? upcomingEvents\.filter\(\(event\) => event\.id !== featuredEvent\.id\) : upcomingEvents;/);
  assert.match(homeView, /<EventCard event=\{featuredEvent\} priority featured wide \/>/);
  assert.doesNotMatch(homeView, /FeaturedEventBanner/);
  assert.doesNotMatch(globalsCss, /wa-hero/);
});

test('painel e home ordenam igual: destaque primeiro, resto por data, sem limite de slides', () => {
  assert.match(ownerPage, /event\.status === 'live' \|\| event\.status === 'upcoming'/);
  assert.match(ownerPage, /getEventStatus\(event\) !== 'finished'/);
  assert.match(ownerPage, /\.sort\(compareEventsByDateAsc\)/);
  assert.match(ownerPage, /return \[\.\.\.featured, \.\.\.rest\];/);
  assert.doesNotMatch(ownerPage, /BANNER_MAX_EVENT_SLIDES|Slide comercial|carrossel/i);
  assert.match(homeView, /upcomingEvents: upcoming\.sort\(compareEventsByDateAsc\)/);
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
  // Story 1.123: a vitrine da home fica na seção Configurações.
  // O componente só existe dentro de Configurações: sair da seção desmonta e descarta o rascunho.
  assert.match(ownerPageOnly, /activeSection === 'configuracoes' && \([\s\S]*?<OwnerHomeShowcase events=\{events\} setFeaturedHomeEvent=\{setFeaturedHomeEvent\} onSaved=\{reloadOverview\} \/>/);

  // Avisos de estado: destaque fora do ar e alteração ainda não publicada.
  assert.match(ownerPage, /const featuredHomeEventIsOffAir = Boolean\(featuredHomeEvent\)/);
  assert.match(ownerPage, /const featuredHomeHasPendingChange = selectedFeaturedHomeDraftId !== \(featuredHomeEvent\?\.id \|\| ''\);/);
  assert.match(ownerPage, /Este evento encerrou e não aparece mais na home/);
  assert.match(ownerPage, /Pré-visualização da alteração pendente/);

  // Story 1.132: sem limite de slides, a prévia lista todos os candidatos na ordem da home.
  assert.match(ownerPage, /const homeEventOrder = useMemo/);

  // Cada item da lista escolhe o destaque — o pill deixou de ser decoração.
  assert.match(ownerPage, /onClick=\{\(\) => setFeaturedHomeDraftId\(event\.id\)\}/);
  assert.match(ownerPage, /aria-pressed=\{isFeatured\}/);

  // Textos da aba seguem a ortografia do restante do painel.
  assert.doesNotMatch(ownerPage, /Selecao automatica/);
  assert.doesNotMatch(ownerPage, /proximos slides/);
  assert.doesNotMatch(ownerPage, /evento ativo disponivel/);
});
