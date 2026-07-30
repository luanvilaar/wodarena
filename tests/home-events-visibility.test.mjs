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

test('home puts event listings ahead of the institutional pitch', () => {
  const featuredBannerIndex = homePage.indexOf('<FeaturedEventBanner');
  const openEventsIndex = homePage.indexOf('id="eventos"');
  const institutionalIndex = homePage.indexOf('<SectionOperations');
  const pastEventsIndex = homePage.indexOf('id="eventos-passados"');

  for (const [label, index] of Object.entries({
    featuredBannerIndex,
    openEventsIndex,
    institutionalIndex,
    pastEventsIndex,
  })) {
    assert.notEqual(index, -1, `missing home section: ${label}`);
  }

  assert.ok(featuredBannerIndex < openEventsIndex, 'featured banner must open the home');
  assert.ok(openEventsIndex < institutionalIndex, 'open events must render before SectionOperations');
  assert.ok(institutionalIndex < pastEventsIndex, 'past events must stay after SectionOperations');
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

test('institutional background video no longer competes with the banner for bandwidth', () => {
  assert.match(sectionOperations, /preload="none"/);
});
