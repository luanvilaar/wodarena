import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const homePage = read('../src/app/page.tsx');
const eventCard = read('../src/components/EventCard.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const featuredBanner = read('../src/components/home/FeaturedEventBanner.tsx');
const sectionOperations = read('../src/components/home/SectionOperations.tsx');
const mobileFeaturedBanner = featuredBanner.match(/\{\/\* Banner Versão Mobile \*\/\}[\s\S]*?\{\/\* Banner Versão Desktop \*\/\}/)?.[0] ?? '';

test('home opens with the hero video, then the featured event, then event listings', () => {
  const institutionalIndex = homePage.indexOf('<SectionOperations');
  const featuredBannerIndex = homePage.indexOf('<FeaturedEventBanner');
  const openEventsIndex = homePage.indexOf('id="eventos"');
  const pastEventsIndex = homePage.indexOf('id="eventos-passados"');

  for (const [label, index] of Object.entries({
    institutionalIndex,
    featuredBannerIndex,
    openEventsIndex,
    pastEventsIndex,
  })) {
    assert.notEqual(index, -1, `missing home section: ${label}`);
  }

  assert.ok(institutionalIndex < featuredBannerIndex, 'hero video must open the home');
  assert.ok(featuredBannerIndex < openEventsIndex, 'featured banner must render before open events');
  assert.ok(openEventsIndex < pastEventsIndex, 'past events must stay last');
});

test('event card renders artwork in the same 5:2 ratio required on upload', () => {
  assert.match(adminPage, /Proporção ideal:.*5:2/s);
  assert.match(eventCard, /aspect-\[5\/2\] w-full overflow-hidden bg-dark-gray/);
  assert.doesNotMatch(eventCard, /aspect-video/);
});

test('mobile featured banner shows the full artwork through next/image instead of a stretched background', () => {
  assert.match(featuredBanner, /^import Image from 'next\/image';$/m);
  assert.match(mobileFeaturedBanner, /aspect-\[5\/2\] w-full overflow-hidden bg-dark-gray/);
  assert.match(mobileFeaturedBanner, /sizes="100vw"/);
  assert.match(mobileFeaturedBanner, /className="object-cover"/);
  assert.doesNotMatch(mobileFeaturedBanner, /backgroundImage/);
  assert.doesNotMatch(mobileFeaturedBanner, /min-h-\[520px\]/);
});

test('hero video opens the home eagerly with a poster to avoid a blank first paint', () => {
  assert.match(sectionOperations, /preload="auto"/);
  assert.match(sectionOperations, /poster="\/hero-vertical-poster\.jpg"/);
});

test('featured banner image is no longer marked priority now that it does not open the home', () => {
  assert.doesNotMatch(mobileFeaturedBanner, /\bpriority\b/);
  assert.match(mobileFeaturedBanner, /loading="lazy"/);
});
