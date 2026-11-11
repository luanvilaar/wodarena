import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.128: identidade própria, P9 opção A (docs/design/mobile-competitivo/).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const layout = read('../src/app/layout.tsx');
const globals = read('../src/app/globals.css');
const sectionOperations = read('../src/components/home/SectionOperations.tsx');
const home = read('../src/app/[locale]/HomeView.tsx');
const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');

test('o layout carrega a letra larga de título e os pesos de placar do Plex', () => {
  assert.match(layout, /import \{ Archivo, Inter, IBM_Plex_Sans \} from "next\/font\/google"/);
  assert.match(layout, /axes: \["wdth"\],\s*variable: "--font-display",\s*display: "swap"/);
  assert.match(layout, /weight: \["400", "500", "600", "700"\]/);
  assert.match(layout, /\$\{archivo\.variable\}/);
});

test('globals define título largo e rótulo de passo a partir dos tokens', () => {
  const display = globals.match(/\.type-display \{[\s\S]*?\}/)[0];
  assert.match(display, /font-family: var\(--font-display, var\(--font-body\)\)/);
  assert.match(display, /font-stretch: 125%/);
  assert.match(display, /text-transform: uppercase/);
  assert.match(globals, /\.lane-label \{[\s\S]*?font-family: var\(--font-number\)/);
  // Story 1.136 (D4): as linhas de raia saíram do topo da home e da ajuda.
  assert.doesNotMatch(globals, /\.lane-lines/);
});

test('títulos públicos usam a letra larga e o título da home mantém a animação', () => {
  assert.match(sectionOperations, /className="home-broadcast-title type-display/);
  // Story 1.132: o título da home é o do atleta; os grupos usam rótulo curto.
  assert.match(home, /<h1 id="home-title" className="type-display /);
  assert.match(eventView, /<h1 className="type-display /);
});
