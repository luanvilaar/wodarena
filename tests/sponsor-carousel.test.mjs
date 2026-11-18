import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.152 (docs/design/regulamento-patrocinadores/, D6 e D7): carrossel de
// patrocinadores na página do evento.

const fields = await importServerModule('lib/eventMediaFields.ts');
const { SponsorCarousel } = await importServerModule('components/SponsorCarousel.tsx');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const labels = {
  carousel: 'carrossel', slide: 'página', previous: 'Marcas anteriores', next: 'Próximas marcas',
  pause: 'Pausar o carrossel', play: 'Tocar o carrossel',
  goTo: (page) => `Ir para a página ${page}`, page: (page, total) => `${page} de ${total}`,
  opensNewTab: (name) => `${name} (abre em nova aba)`
};
const sponsor = (name, link = '') => ({ name, logoUrl: `https://proj.supabase.co/storage/v1/object/public/event-media/events/u1/${name}.png`, link });
const render = (sponsors) => renderToStaticMarkup(createElement(SponsorCarousel, { heading: 'Patrocinadores do Evento', sponsors, labels }));

test('páginas de duas marcas; só gira com mais de duas', () => {
  assert.deepEqual(fields.sponsorPages([1, 2, 3, 4, 5]), [[1, 2], [3, 4], [5]]);
  assert.equal(fields.sponsorsRotate(2), false);
  assert.equal(fields.sponsorsRotate(3), true);
});

test('até duas marcas: grade parada, sem controles', () => {
  const html = render([sponsor('ferro'), sponsor('mare')]);
  assert.doesNotMatch(html, /aria-roledescription="carrossel"/);
  assert.doesNotMatch(html, /Pausar o carrossel/);
  assert.match(html, /grid-cols-2/);
  assert.match(html, /alt="ferro"/);
  assert.equal(render([]), '');
});

test('mais de duas: carrossel com páginas inertes fora de vista, pontos, pausa e setas', () => {
  const html = render([sponsor('a', 'https://a.example.com/'), sponsor('b'), sponsor('c')]);
  assert.match(html, /role="region" aria-roledescription="carrossel" aria-labelledby="event-sponsors-heading"/);
  assert.match(html, /aria-label="1 de 2" aria-hidden="false"/);
  assert.match(html, /aria-label="2 de 2" aria-hidden="true" inert=""/);
  assert.match(html, /aria-label="Ir para a página 2" aria-current="false"/);
  assert.match(html, /aria-label="Pausar o carrossel"/);
  assert.match(html, /aria-label="Marcas anteriores"/);
  // Marca com link: abre em nova aba como link patrocinado; o nome vai no rótulo do link.
  assert.match(html, /href="https:\/\/a\.example\.com\/" target="_blank" rel="sponsored noopener noreferrer" aria-label="a \(abre em nova aba\)"/);
  assert.match(html, /border-sponsor-tile-border bg-sponsor-tile/);
});

test('carrossel: 5 s, para ao tocar, passar o mouse ou focar, e respeita menos movimento', () => {
  const source = read('../src/components/SponsorCarousel.tsx');
  assert.match(source, /const ROTATE_MS = 5000;/);
  assert.match(source, /if \(!rotates \|\| paused \|\| holding \|\| reducedMotion\) return;/);
  // Achado do CodeRabbit: mouse, foco e toque pausam cada um por si.
  assert.match(source, /const holding = hover \|\| focused \|\| touching;/);
  assert.match(source, /onMouseLeave=\{\(\) => setHover\(false\)\}/);
  assert.match(source, /setFocused\(false\)/);
  assert.match(source, /onTouchCancel=/);
  assert.match(source, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(source, /motion-reduce:transition-none/);
});

test('página do evento: só os logos enviados; a lista antiga de nomes não aparece (D8)', () => {
  const view = read('../src/app/[locale]/event/[id]/EventView.tsx');
  assert.match(view, /const publicSponsorList = publicSponsors\(event\.sponsorLogos \?\? \[\]\);/);
  assert.match(view, /\{publicSponsorList\.length > 0 && \(\s*<SponsorCarousel/);
  assert.doesNotMatch(view, /event\.sponsors\.map/);
  for (const locale of ['pt-br', 'pt-pt', 'en-gb']) {
    const sidebar = JSON.parse(read(`../src/messages/${locale}.json`)).Event.sidebar;
    for (const key of ['sponsorsCarousel', 'sponsorsSlide', 'sponsorsPrevious', 'sponsorsNext', 'sponsorsPause', 'sponsorsPlay', 'sponsorsGoTo', 'sponsorsPage', 'sponsorsOpensNewTab']) {
      assert.ok(sidebar[key], `${locale}: ${key}`);
    }
  }
});
