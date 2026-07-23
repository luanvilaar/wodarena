import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260718133000_featured_home_event.sql');
const types = read('../src/types/index.ts');
const bootstrapPayload = read('../src/lib/bootstrapPayload.ts');
const authenticatedBootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const ownerPage = read('../src/app/owner/page.tsx');
const adminPersistence = read('../src/app/api/admin/persistence/route.ts');
const featuredBanner = read('../src/components/home/FeaturedEventBanner.tsx');
const mobileFeaturedBanner = featuredBanner.match(/\{\/\* Banner Versão Mobile \*\/\}[\s\S]*?\{\/\* Banner Versão Desktop \*\/\}/)?.[0] ?? '';

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
});

test('home banner prioritizes active highlighted events and keeps finished events excluded', () => {
  assert.match(featuredBanner, /const eligibleEvents = events\.filter/);
  assert.match(featuredBanner, /getEventStatus\(event\) !== 'finished'/);
  assert.match(featuredBanner, /const featuredEvent = eligibleEvents\.find\(\(event\) => event\.isFeatured\) \?\? eligibleEvents\[0\]/);
});

test('home banner mobile layout keeps event content readable and action hierarchy clear', () => {
  assert.match(mobileFeaturedBanner, /linear-gradient\(90deg/);
  assert.doesNotMatch(mobileFeaturedBanner, /radial-gradient\(circle at 76% 14%/);
  assert.match(mobileFeaturedBanner, /rounded-md border border-card-border bg-card px-3 py-2/);
  assert.match(mobileFeaturedBanner, /rounded-md border border-card-border bg-dark-gray px-3 py-2/);
  assert.match(mobileFeaturedBanner, /mt-1 flex flex-wrap items-center gap-x-3 gap-y-1/);
  assert.doesNotMatch(mobileFeaturedBanner, /backdrop-blur-md/);
  assert.match(mobileFeaturedBanner, /disabled=\{!registrationsAvailable\}/);
  assert.match(mobileFeaturedBanner, /aria-label=\{registrationsAvailable \? `Abrir inscricao para \$\{featuredEvent\.name\}` : 'Vendas encerradas'\}/);
  assert.match(mobileFeaturedBanner, /h-10 items-center justify-center rounded-md px-4 text-xs font-bold uppercase text-white\/80 transition-colors hover:text-primary/);
});
