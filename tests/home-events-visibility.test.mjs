import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const globals = read('../src/app/globals.css');
const homePage = read('../src/app/[locale]/HomeView.tsx');
const eventCard = read('../src/components/EventCard.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const featuredBanner = read('../src/components/home/FeaturedEventBanner.tsx');
const sectionOperations = read('../src/components/home/SectionOperations.tsx');

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

test('event card keeps interface controls outside the event artwork', () => {
  assert.match(eventCard, /flex min-h-11 flex-wrap items-center justify-between/);
  assert.doesNotMatch(eventCard, /absolute (?:left|right|top|bottom|inset)/);
});

test('event card uses the established flat surfaces, tokens, and type hierarchy', () => {
  assert.match(eventCard, /border-card-border bg-card/);
  assert.match(eventCard, /text-xl font-bold leading-tight tracking-tight/);
  assert.match(eventCard, /font-number text-primary/);
  assert.doesNotMatch(eventCard, /backdrop-blur|shadow-\[|font-black|#[0-9a-fA-F]{3,8}/);
});

test('featured banner shows the full artwork through next/image instead of a stretched background, at every screen size', () => {
  assert.match(featuredBanner, /^import Image from 'next\/image';$/m);
  assert.match(featuredBanner, /sizes="100vw"/);
  assert.match(featuredBanner, /className="object-cover"/);
  assert.doesNotMatch(featuredBanner, /backgroundImage/);
});

test('hero video opens the home with optimized WODArena media and safe fallbacks', () => {
  assert.match(sectionOperations, /HERO_VIDEO_POSTER = '\/hero-vertical-poster\.jpg'/);
  assert.match(sectionOperations, /prefers-reduced-motion: reduce/);
  assert.match(sectionOperations, /preload="metadata"/);
  assert.match(sectionOperations, /<source src="\/hero-vertical\.webm" type="video\/webm" \/>/);
  assert.match(sectionOperations, /<source src="\/hero-vertical-h264\.mp4" type="video\/mp4" \/>/);
  assert.doesNotMatch(sectionOperations, /rochafit-hero/);
  assert.doesNotMatch(sectionOperations, /rochafit-logo-alpha|ROCHAFIT_LOGO_FALLBACK|mix-blend-screen/);

  for (const asset of [
    '../public/hero-vertical.mp4',
    '../public/hero-vertical-poster.jpg',
    '../public/hero-vertical.webm',
    '../public/hero-vertical-h264.mp4',
  ]) {
    const url = new URL(asset, import.meta.url);
    assert.ok(existsSync(url), `missing hero asset: ${asset}`);
    assert.ok(statSync(url).size > 0, `empty hero asset: ${asset}`);
  }
});

test('hero video keeps a fixed 16:9 frame identically on mobile and desktop', () => {
  const heroBlockMatch = sectionOperations.match(/\{\/\* Vídeo da Hero[\s\S]*?(?=\{\/\* Feature Grid \*\/\})/);
  assert.ok(heroBlockMatch, 'hero video block not found');
  const heroBlock = heroBlockMatch[0];

  assert.match(heroBlock, /aspect-video w-full overflow-hidden/);
  assert.doesNotMatch(heroBlock, /\bsm:hidden\b/);
  assert.doesNotMatch(heroBlock, /\bsm:block\b/);
  assert.doesNotMatch(heroBlock, /\blg:hidden\b/);
});

test('home entrance motion follows the Arena Broadcast package with reduced-motion guardrails', () => {
  for (const token of [
    '--motion-broadcast-ease',
    '@keyframes home-broadcast-title',
    '@keyframes home-broadcast-video',
    '@keyframes home-broadcast-panel',
    '@keyframes home-broadcast-modal-panel',
  ]) {
    assert.match(globals, new RegExp(token), `missing motion token: ${token}`);
  }

  assert.match(globals, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.home-broadcast-video/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\[class\*="home-broadcast-"\]/);
  assert.doesNotMatch(globals, /animation-iteration-count:\s*infinite|filter:|backdrop-filter:|will-change:/);

  assert.match(sectionOperations, /home-broadcast-title/);
  assert.match(sectionOperations, /home-broadcast-video/);
  assert.match(sectionOperations, /home-broadcast-chip/);
  // O carrossel do hero tem pacote de movimento proprio (wa-hero-*). Ele saiu
  // do namespace home-broadcast-* porque aquelas regras usam fill-mode "both",
  // que fixa opacity: 1 e impedia a troca de slides, e porque reduced-motion
  // forca opacity: 1 !important em todo [class*="home-broadcast-"].
  assert.doesNotMatch(featuredBanner, /home-broadcast-/);
  assert.match(globals, /@keyframes wa-hero-copy-in/);
  assert.match(globals, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.wa-hero__copy/);
  assert.match(featuredBanner, /className="wa-hero/);
  assert.match(homePage, /home-broadcast-event-card/);
  assert.match(homePage, /Math\.min\(index, 5\)/);
});

test('hero master and optimized derivatives keep the intended codecs and file weights', () => {
  const heroMaster = probeMedia('../public/hero-vertical.mp4');
  const heroMp4 = probeMedia('../public/hero-vertical-h264.mp4');
  const heroWebm = probeMedia('../public/hero-vertical.webm');
  const poster = statSync(new URL('../public/hero-vertical-poster.jpg', import.meta.url));

  const [masterVideo] = heroMaster.streams.filter((stream) => stream.codec_type === 'video');
  const [mp4Video] = heroMp4.streams.filter((stream) => stream.codec_type === 'video');
  const [webmVideo] = heroWebm.streams.filter((stream) => stream.codec_type === 'video');

  assert.equal(masterVideo.codec_name, 'hevc');
  assert.equal(masterVideo.width, 1920);
  assert.equal(masterVideo.height, 1080);
  assert.equal(heroMaster.streams.some((stream) => stream.codec_type === 'audio'), true);

  assert.equal(heroMp4.streams.some((stream) => stream.codec_type === 'audio'), false);
  assert.equal(heroWebm.streams.some((stream) => stream.codec_type === 'audio'), false);

  assert.equal(mp4Video.codec_name, 'h264');
  assert.equal(mp4Video.width, 1920);
  assert.equal(mp4Video.height, 1080);
  assert.equal(mp4Video.width / mp4Video.height, 16 / 9);
  assert.equal(webmVideo.codec_name, 'vp9');
  assert.equal(webmVideo.width, 1920);
  assert.equal(webmVideo.height, 1080);
  assert.equal(webmVideo.width / webmVideo.height, 16 / 9);

  assert.ok(Number(heroMp4.format.size) < 10_000_000, 'MP4 hero should stay under 10 MB');
  assert.ok(Number(heroWebm.format.size) < 10_000_000, 'WebM hero should stay under 10 MB');
  assert.ok(poster.size < 300_000, 'poster should stay under 300 KB');
});

test('featured banner opens the home, so its first artwork is the prioritized LCP candidate', () => {
  // O banner voltou a ser o primeiro bloco visivel da home: a arte do slide
  // inicial e o elemento LCP real e nao pode entrar por lazy loading. As
  // demais artes continuam sob demanda.
  assert.match(featuredBanner, /priority=\{isFirstSlide\}/);
  assert.match(featuredBanner, /loading=\{isFirstSlide \? undefined : 'lazy'\}/);
});
