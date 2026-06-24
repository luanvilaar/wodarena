import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const globals = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
const sourceFiles = [
  '../src/app/page.tsx',
  '../src/app/event/[id]/page.tsx',
  '../src/components/EventCard.tsx',
  '../src/components/Navbar.tsx',
  '../src/components/Footer.tsx',
  '../src/components/BrandLogo.tsx',
  '../src/components/Leaderboard.tsx',
  '../src/components/RegisterModal.tsx',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

test('exposes the documented Binance-inspired core tokens', () => {
  for (const token of ['#0b0e11', '#1e2329', '#2b3139', '#fcd535', '#f0b90b', '#ffffff', '#fafafa']) {
    assert.match(globals, new RegExp(token), `missing design token ${token}`);
  }
});

test('does not reintroduce legacy atmospheric styles', () => {
  for (const legacyStyle of ['glassmorphism', 'gold-glow', 'radial-gradient', '#CCFF00', '#08080C', 'transition-all']) {
    assert.doesNotMatch(sourceFiles, new RegExp(legacyStyle, 'i'), `legacy style found: ${legacyStyle}`);
  }
});

test('uses the institutional logo through the reusable brand component', () => {
  assert.match(sourceFiles, /Ativo_1\.svg/);
  assert.match(sourceFiles, /BrandLogo/);
});


test('documents exact event artwork proportions in the admin upload fields', () => {
  const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');

  assert.match(admin, /Proporção ideal:.*1:1/s);
  assert.match(admin, /512 × 512 px/);
  assert.match(admin, /Proporção ideal:.*5:2/s);
  assert.match(admin, /1600 × 640 px/);
});

test('renders event creation as an accessible light transactional surface', () => {
  const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');

  assert.match(admin, /transactional-surface/);
  assert.match(admin, /focus-within:outline-info/);
  assert.match(admin, /aria-label="Remover logo do evento"/);
  assert.match(admin, /aria-label="Remover banner do evento"/);
});

test('keeps the full admin panel aligned with flat multi-theme rules', () => {
  const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');

  for (const handler of ['handleCreateEvent', 'handleCreateDivision', 'handleCreateWorkout', 'handleScoreSubmit']) {
    assert.match(admin, new RegExp(`onSubmit=\\{${handler}\\}`), `missing admin form ${handler}`);
  }

  assert.match(admin, /const transactionalCardClassName = 'transactional-surface/);
  assert.match(admin, /currencyFormatter\.format/);
  assert.match(admin, /aria-pressed=\{activeTab === tab\.id\}/);
  assert.match(admin, /Cadastre um evento primeiro/);
  assert.match(admin, /text-primary-on-light/);
  assert.doesNotMatch(admin, /\balert\(/);
  assert.doesNotMatch(admin, /\bshadow(?:-[a-z]+)?\b/);
  assert.doesNotMatch(admin, /bg-gradient/);
  assert.doesNotMatch(admin, /#[0-9a-f]{3,8}/i);
});
