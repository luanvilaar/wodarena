import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const homePage = read('../src/app/page.tsx');
const eventCard = read('../src/components/EventCard.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const featuredBanner = read('../src/components/home/FeaturedEventBanner.tsx');
const sectionOperations = read('../src/components/home/SectionOperations.tsx');
const mobileFeaturedBanner = featuredBanner.match(/\{\/\* Banner Versão Mobile \*\/\}[\s\S]*?\{\/\* Banner Versão Desktop \*\/\}/)?.[0] ?? '';

const probeMedia = (path) => JSON.parse(execFileSync('ffprobe', [
  '-v', 'error',
  '-show_entries', 'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,pix_fmt:stream_tags=alpha_mode',
  '-of', 'json',
  new URL(path, import.meta.url).pathname,
], { encoding: 'utf8' }));

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

test('hero video opens the home with optimized RochaFit media and safe fallbacks', () => {
  assert.match(sectionOperations, /ROCHAFIT_HERO_POSTER = '\/rochafit-hero-poster\.jpg'/);
  assert.match(sectionOperations, /prefers-reduced-motion: reduce/);
  assert.match(sectionOperations, /preload="metadata"/);
  assert.match(sectionOperations, /<source src="\/rochafit-hero\.webm" type="video\/webm" \/>/);
  assert.match(sectionOperations, /<source src="\/rochafit-hero\.mp4" type="video\/mp4" \/>/);
  assert.match(sectionOperations, /<source src="\/rochafit-logo-alpha\.webm" type="video\/webm" \/>/);
  assert.match(sectionOperations, /ROCHAFIT_LOGO_FALLBACK = '\/rochafit-logo\.png'/);

  for (const asset of [
    '../public/rochafit-hero-poster.jpg',
    '../public/rochafit-hero.webm',
    '../public/rochafit-hero.mp4',
    '../public/rochafit-logo-alpha.webm',
    '../public/rochafit-logo.png',
  ]) {
    const url = new URL(asset, import.meta.url);
    assert.ok(existsSync(url), `missing hero asset: ${asset}`);
    assert.ok(statSync(url).size > 0, `empty hero asset: ${asset}`);
  }
});

test('RochaFit hero media keeps web-safe codecs, dimensions and file weights', () => {
  const heroMp4 = probeMedia('../public/rochafit-hero.mp4');
  const heroWebm = probeMedia('../public/rochafit-hero.webm');
  const logoWebm = probeMedia('../public/rochafit-logo-alpha.webm');
  const poster = statSync(new URL('../public/rochafit-hero-poster.jpg', import.meta.url));
  const logoPng = statSync(new URL('../public/rochafit-logo.png', import.meta.url));

  const [mp4Video] = heroMp4.streams.filter((stream) => stream.codec_type === 'video');
  const [webmVideo] = heroWebm.streams.filter((stream) => stream.codec_type === 'video');
  const [logoVideo] = logoWebm.streams.filter((stream) => stream.codec_type === 'video');

  assert.equal(heroMp4.streams.some((stream) => stream.codec_type === 'audio'), false);
  assert.equal(heroWebm.streams.some((stream) => stream.codec_type === 'audio'), false);
  assert.equal(logoWebm.streams.some((stream) => stream.codec_type === 'audio'), false);

  assert.equal(mp4Video.codec_name, 'h264');
  assert.equal(mp4Video.width, 1920);
  assert.equal(mp4Video.height, 1080);
  assert.equal(webmVideo.codec_name, 'vp9');
  assert.equal(webmVideo.width, 1920);
  assert.equal(webmVideo.height, 1080);
  assert.equal(logoVideo.codec_name, 'vp9');
  assert.equal(logoVideo.width, 512);
  assert.equal(logoVideo.height, 512);
  assert.equal(logoVideo.tags?.alpha_mode, '1');

  assert.ok(Number(heroMp4.format.size) < 10_000_000, 'MP4 hero should stay under 10 MB');
  assert.ok(Number(heroWebm.format.size) < 9_000_000, 'WebM hero should stay under 9 MB');
  assert.ok(Number(logoWebm.format.size) < 300_000, 'animated logo should stay under 300 KB');
  assert.ok(poster.size < 300_000, 'poster should stay under 300 KB');
  assert.ok(logoPng.size < 700_000, 'logo fallback should stay under 700 KB');
});

test('featured banner image is no longer marked priority now that it does not open the home', () => {
  assert.doesNotMatch(mobileFeaturedBanner, /\bpriority\b/);
  assert.match(mobileFeaturedBanner, /loading="lazy"/);
});
