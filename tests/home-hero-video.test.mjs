import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

// Story 1.136: hero da home com o vídeo de fundo e sem raias
// (docs/design/mobile-competitivo/hero-com-video/, D1 = A, D2, D3 e D4).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('../src/app/[locale]/HomeView.tsx');
const heroVideo = read('../src/components/home/HeroVideo.tsx');
const sectionOperations = read('../src/components/home/SectionOperations.tsx');
const help = read('../src/app/[locale]/ajuda/page.tsx');
const productStory = read('../src/components/home/ProductStory.tsx');
const globals = read('../src/app/globals.css');
const messages = Object.fromEntries(['pt-br', 'pt-pt', 'en-gb'].map((l) => [l, JSON.parse(read(`../src/messages/${l}.json`))]));

test('o topo da home tem o vídeo de fundo, a camada escura e o botão de pausa, antes do título', () => {
  const top = home.slice(home.indexOf('id="eventos"'), home.indexOf('id="event-search"'));
  assert.match(top, /<div className="relative overflow-hidden border-b border-card-border">/);
  assert.match(top, /<HeroVideo[\s\S]*?mediaClassName="absolute inset-0 [^"]*"/);
  assert.match(top, /toggle=\{\{ pauseLabel: t\('pauseVideo'\), playLabel: t\('playVideo'\), className: 'home-hero-toggle' \}\}/);
  assert.match(top, /<div className="home-hero-shade pointer-events-none absolute inset-0" aria-hidden="true" \/>/);
  assert.ok(top.indexOf('<HeroVideo') < top.indexOf('<h1 id="home-title"'));
  assert.ok(top.indexOf('home-hero-shade') < top.indexOf('<h1 id="home-title"'));
});

test('as raias saíram do topo da home e da ajuda; o rótulo de passo continua', () => {
  assert.doesNotMatch(home, /lane-lines|lane-label|laneLabel/);
  assert.doesNotMatch(help, /lane-lines/);
  assert.doesNotMatch(globals, /\.lane-lines/);
  assert.match(globals, /\.lane-label \{/);
  assert.match(productStory, /className="lane-label"/);
});

test('o título fica na mesma altura de antes: o espaço dos rótulos de raia virou padding', () => {
  // Antes: pt-5 + rótulo de 17 px + mt-5 (57 px) no celular; pt-8 + 17 + mt-8 (81 px) a partir de 640 px.
  assert.match(home, /className="relative mx-auto max-w-7xl px-4 pb-7 pt-14 sm:px-6 sm:pb-10 sm:pt-20 lg:px-8"/);
  assert.match(home, /<h1 id="home-title" className="type-display max-w-3xl text-balance text-\[1\.75rem\] text-white sm:text-5xl lg:text-\[3\.5rem\]">/);
});

test('o HeroVideo serve a versão leve no celular, mantém a capa com reduzir movimento e oferece pausa', () => {
  assert.match(heroVideo, /HERO_VIDEO_MOBILE_MEDIA = '\(max-width: 767px\)'/);
  const lite = heroVideo.indexOf('<source src="/hero-vertical-960.mp4" type="video/mp4" media={HERO_VIDEO_MOBILE_MEDIA} />');
  const webm = heroVideo.indexOf('<source src="/hero-vertical.webm" type="video/webm" />');
  const mp4 = heroVideo.indexOf('<source src="/hero-vertical-h264.mp4" type="video/mp4" />');
  assert.ok(lite !== -1 && lite < webm && webm < mp4, 'a versão leve vem primeiro, com media');
  assert.match(heroVideo, /if \(reducedMotion\) \{\s*return \(\s*<Image/);
  assert.match(heroVideo, /autoPlay\s+loop\s+muted\s+playsInline\s+preload="metadata"/);
  assert.match(heroVideo, /aria-label=\{paused \? toggle\.playLabel : toggle\.pauseLabel\}/);
  assert.match(heroVideo, /onPlay=\{\(\) => setPaused\(false\)\}\s+onPause=\{\(\) => setPaused\(true\)\}/);
  assert.match(heroVideo, /h-10 w-10[^`]*sm:h-11 sm:w-11/);
});

test('/organizadores mantém o quadro 16:9 sem botão de pausa (D3)', () => {
  const block = sectionOperations.match(/\{\/\* Vídeo da Hero[\s\S]*?(?=\{\/\* Feature Grid \*\/\})/)[0];
  assert.match(block, /aspect-video w-full overflow-hidden/);
  assert.match(block, /<HeroVideo\s/);
  assert.doesNotMatch(block, /toggle=/);
});

test('a camada escura e o botão usam o token de fundo e acompanham a margem do conteúdo', () => {
  assert.match(globals, /\.home-hero-shade \{\s*background: linear-gradient\(\s*180deg,\s*color-mix\(in srgb, var\(--background\) 62%, transparent\)/);
  assert.match(globals, /@media \(min-width: 1024px\) \{\s*\.home-hero-shade \{\s*background:\s*linear-gradient\(\s*90deg/);
  assert.match(globals, /\.home-hero-toggle \{\s*top: 0\.5rem;\s*right: 0\.5rem;\s*\}/);
  assert.match(globals, /\.home-hero-toggle \{\s*right: max\(2rem, calc\(\(100% - 80rem\) \/ 2 \+ 2rem\)\);\s*\}/);
});

test('textos do vídeo nos três idiomas e laneLabel removido', () => {
  for (const [locale, json] of Object.entries(messages)) {
    for (const key of ['heroVideoAlt', 'heroVideoAriaLabel', 'pauseVideo', 'playVideo']) {
      assert.ok(json.Home[key], `${locale}: Home.${key}`);
    }
    assert.equal(json.Home.laneLabel, undefined, `${locale}: Home.laneLabel saiu`);
  }
  assert.equal(messages['pt-br'].Home.pauseVideo, 'Pausar vídeo');
  assert.equal(messages['en-gb'].Home.playVideo, 'Play video');
});

test('a versão leve do vídeo é H.264 960 × 540, sem áudio e com menos de 3 MB (D2)', () => {
  const url = new URL('../public/hero-vertical-960.mp4', import.meta.url);
  assert.ok(existsSync(url), 'public/hero-vertical-960.mp4');
  assert.ok(statSync(url).size < 3_000_000, 'versão leve abaixo de 3 MB');
  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', url.pathname,
  ], { encoding: 'utf8' }));
  const video = probe.streams.find((s) => s.codec_type === 'video');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.width, 960);
  assert.equal(video.height, 540);
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(probe.streams.some((s) => s.codec_type === 'audio'), false);
});
