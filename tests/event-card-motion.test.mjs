import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.65: movimento dos cards de evento da home. Desenho aprovado em
// docs/design/cards-eventos-animados/. A contagem é função pura; o resto é
// contrato estático (o projeto não sobe navegador nos testes).

const { EVENT_CARD_MOTION, easeOutExpo, getCountValue, getShineDelayMs, swapCountInText } =
  await importServerModule('lib/eventCardMotion.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const globals = read('../src/app/globals.css');
const eventCard = read('../src/components/EventCard.tsx');
const homeView = read('../src/app/[locale]/HomeView.tsx');
const revealHook = read('../src/hooks/useRevealOnView.ts');
const countHook = read('../src/hooks/useCountUp.ts');
const shineHook = read('../src/hooks/useShineOnView.ts');

const block = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `marcador ausente: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `marcador ausente: ${endMarker}`);
  return source.slice(start, end);
};

// Do primeiro keyframe do card até o início do bloco seguinte da home.
const cardMotionCss = block(globals, '@keyframes event-card-open', '@keyframes home-broadcast-modal-overlay');

test('easeOutExpo vai de 0 a 1 e só sobe', () => {
  assert.equal(easeOutExpo(0), 0);
  assert.equal(easeOutExpo(1), 1);
  assert.equal(easeOutExpo(-3), 0);
  assert.equal(easeOutExpo(7), 1);
  let previous = 0;
  for (let step = 1; step <= 100; step += 1) {
    const value = easeOutExpo(step / 100);
    assert.ok(value >= previous, 'a desaceleração nunca desce');
    previous = value;
  }
  assert.ok(easeOutExpo(0.5) > 0.9, 'a metade do tempo já passa de 90% do valor');
});

test('contagem do preço: zero até o atraso, inteiro no meio, valor exato no fim', () => {
  const timing = EVENT_CARD_MOTION.priceCount;
  assert.equal(getCountValue(80, 0, timing), 0);
  assert.equal(getCountValue(80, timing.delayMs, timing), 0, 'no instante do atraso ainda mostra zero');
  const half = getCountValue(80, timing.delayMs + timing.durationMs / 2, timing);
  assert.ok(Number.isInteger(half) && half > 0 && half < 80, `meio da contagem: ${half}`);
  assert.equal(getCountValue(80, timing.delayMs + timing.durationMs, timing), 80);
  assert.equal(getCountValue(80, 60_000, timing), 80);
});

test('o valor final nunca é arredondado e o intermediário nunca o ultrapassa', () => {
  const timing = EVENT_CARD_MOTION.priceCount;
  assert.equal(getCountValue(99.9, timing.delayMs + timing.durationMs, timing), 99.9);
  for (let elapsed = 0; elapsed < timing.delayMs + timing.durationMs; elapsed += 7) {
    assert.ok(getCountValue(99.9, elapsed, timing) < 99.9, `antes do fim fica abaixo do alvo (${elapsed} ms)`);
  }
});

test('a contagem nunca recua e preço zero ou divisões zero não contam', () => {
  const timing = EVENT_CARD_MOTION.divisionCount;
  let previous = 0;
  for (let elapsed = 0; elapsed <= 1200; elapsed += 16) {
    const value = getCountValue(22, elapsed, timing);
    assert.ok(value >= previous, `recuou em ${elapsed} ms`);
    previous = value;
  }
  assert.equal(previous, 22);
  assert.equal(getCountValue(0, 300, timing), 0);
});

test('a contagem acompanha a cascata: preço a 450 ms e divisões a 500 ms', () => {
  assert.deepEqual({ ...EVENT_CARD_MOTION.priceCount }, { delayMs: 450, durationMs: 700 });
  assert.deepEqual({ ...EVENT_CARD_MOTION.divisionCount }, { delayMs: 500, durationMs: 500 });
  assert.equal(EVENT_CARD_MOTION.revealRootMargin, '0px 0px -96px 0px');
  assert.deepEqual({ ...EVENT_CARD_MOTION.shine }, { settleMs: 1250, minDelayMs: 150, visibleRatio: 0.6 });
});

test('brilho do botão: espera a cascata assentar, e depois dela toca quase na hora', () => {
  assert.equal(getShineDelayMs(0), 1250, 'botão já visível na entrada: espera a cascata');
  assert.equal(getShineDelayMs(400), 850);
  assert.equal(getShineDelayMs(1100), 150);
  assert.equal(getShineDelayMs(9000), 150, 'botão visto muito depois: 150 ms');
});

test('contagem de divisões mantém o texto traduzido e o plural do valor final', () => {
  assert.equal(swapCountInText('6 divisões disponíveis', 6, 6), '6 divisões disponíveis');
  assert.equal(swapCountInText('6 divisões disponíveis', 6, 0), '0 divisões disponíveis', 'nunca vira "0 divisão"');
  assert.equal(swapCountInText('22 divisões disponíveis', 22, 5), '5 divisões disponíveis');
  assert.equal(swapCountInText('2 divisions available', 2, 0), '0 divisions available');
  assert.equal(swapCountInText('1 divisão disponível', 1, 1), '1 divisão disponível');
});

test('a entrada do card vive fora do namespace home-broadcast-* e usa fill-mode backwards', () => {
  assert.doesNotMatch(eventCard, /home-broadcast-/);
  assert.doesNotMatch(homeView, /home-broadcast-event-card/);
  assert.doesNotMatch(cardMotionCss, /home-broadcast-/);
  assert.doesNotMatch(cardMotionCss, /\bboth\b/, 'both fixaria opacity: 1 e anularia o estado do card');
  for (const rule of [
    'animation: event-card-open 520ms var(--motion-broadcast-ease) backwards;',
    'animation: event-card-rise 440ms var(--motion-broadcast-ease) backwards;',
    'animation: event-card-zoom 900ms var(--motion-broadcast-ease) backwards;',
    'animation: event-card-fade 240ms linear backwards;',
  ]) {
    assert.ok(cardMotionCss.includes(rule), `regra ausente: ${rule}`);
  }
  assert.match(cardMotionCss, /calc\(var\(--ec-d\) \+ 100ms \+ var\(--ec-i, 0\) \* 90ms\)/);
});

test('só transform, opacity e clip-path animam (sem propriedade de layout)', () => {
  const keyframes = cardMotionCss.match(/@keyframes event-[\s\S]*?\n}\n/g) ?? [];
  assert.equal(keyframes.length, 5);
  for (const frames of keyframes) {
    assert.doesNotMatch(frames, /\b(?:width|height|top|left|right|bottom|margin|padding)\s*:/);
  }
  assert.doesNotMatch(cardMotionCss, /will-change|filter:|infinite/);
});

test('o card nunca fica escondido sob movimento reduzido', () => {
  const pending = cardMotionCss.indexOf('[data-reveal="pending"]');
  assert.notEqual(pending, -1);
  const mediaStart = cardMotionCss.lastIndexOf('@media (prefers-reduced-motion: no-preference) {', pending);
  assert.notEqual(mediaStart, -1, 'o estado pending só esconde sob no-preference');
  const beforeNextMedia = cardMotionCss.slice(mediaStart, pending);
  assert.doesNotMatch(beforeNextMedia, /\n}\n/, 'pending está dentro do bloco no-preference');
  assert.match(cardMotionCss, /@media print \{\s*\.event-card\[data-reveal="pending"\] \{\s*opacity: 1;/, 'impressão nunca sai em branco');
  // O bloco reduce do namespace home-broadcast-* continua valendo para o resto da home.
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\[class\*="home-broadcast-"\]/);
});

test('hover só com hover: hover; o brilho único do celular só em hover: none', () => {
  assert.match(cardMotionCss, /@media \(prefers-reduced-motion: no-preference\) and \(hover: hover\) \{[\s\S]*\.event-cta-shine:hover::after \{\s*animation: event-cta-shine 700ms/);
  assert.match(cardMotionCss, /@media \(prefers-reduced-motion: no-preference\) and \(hover: none\) \{\s*\.event-card\[data-reveal="run"\]\[data-shine="on"\] \.event-cta-shine::after \{\s*animation: event-cta-shine 750ms[^;]*backwards;\s*animation-delay: var\(--ec-shine-delay, 0ms\)/);
  assert.match(cardMotionCss, /\.event-cta:active \{\s*transform: scale\(0\.97\);\s*transition-duration: 80ms;/);
});

test('card encerrado entra só com fade: sem abertura, cascata nem zoom', () => {
  assert.match(cardMotionCss, /\[data-reveal="run"\]\[data-card-state="closed"\] \{\s*animation: event-card-fade/);
  assert.match(cardMotionCss, /\[data-card-state="closed"\] \.ec-block,\s*\.event-card\[data-reveal="run"\]\[data-card-state="closed"\] \.ec-banner-art \{\s*animation: none;/);
  assert.match(eventCard, /data-card-state=\{isFinished \? 'closed' : 'open'\}/);
  assert.match(eventCard, /isFinished \? '' : 'group-hover:scale-\[1\.03\]'/);
  assert.match(eventCard, /const countPhase = isFinished \? 'done' : phase;/);
});

test('o EventCard marca os cinco blocos da cascata e o brilho só no Garantir Vaga', () => {
  for (let index = 0; index <= 4; index += 1) {
    assert.equal((eventCard.match(new RegExp(`ec-block ec-i${index}\\b`, 'g')) ?? []).length, 1, `bloco ec-i${index}`);
  }
  assert.match(eventCard, /className="event-cta event-cta-shine flex min-h-12/);
  assert.equal((eventCard.match(/event-cta-shine/g) ?? []).length, 1, 'brilho só no Garantir Vaga');
  assert.equal((eventCard.match(/event-cta /g) ?? []).length + (eventCard.match(/event-cta"/g) ?? []).length, 4);
  assert.equal((eventCard.match(/<button\s+type="button"\s+disabled/g) ?? []).length, 1);
  const disabledButton = block(eventCard, 'type="button"\n                disabled', '</button>');
  assert.doesNotMatch(disabledButton, /event-cta/, 'botão desabilitado não responde ao toque');
});

test('preço e divisões contam só visualmente: leitor de tela lê o texto final', () => {
  assert.match(eventCard, /<span className="sr-only">\{priceLabel\}<\/span>/);
  assert.match(eventCard, /<span className="font-number text-primary tabular-nums" aria-hidden="true">\{priceDisplayLabel\}<\/span>/);
  assert.match(eventCard, /const divisionsFinalText = t\('divisionsAvailable', \{ count: divisionCount \}\);/);
  assert.match(eventCard, /<span className="sr-only">\{divisionsFinalText\}<\/span>/);
  assert.match(eventCard, /<span aria-hidden="true">\{swapCountInText\(divisionsFinalText, divisionCount, animatedDivisions\)\}<\/span>/);
  assert.match(eventCard, /minPrice !== null && minPrice > 0\s*\?\s*formatMoney\(animatedPrice/, 'preço gratuito não conta');
});

test('useRevealOnView: uma vez por evento, sem suporte ou com movimento reduzido nasce pronto', () => {
  assert.match(revealHook, /const revealedIds = new Set<string>\(\)/);
  assert.match(revealHook, /useState<RevealPhase>\(\(\) => \(revealedIds\.has\(id\) \? 'done' : 'pending'\)\)/);
  assert.match(revealHook, /useMediaQuery\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(revealHook, /typeof IntersectionObserver !== 'undefined'/);
  assert.match(revealHook, /rootMargin: EVENT_CARD_MOTION\.revealRootMargin/);
  assert.match(revealHook, /observer\.disconnect\(\);\s*revealedIds\.add\(id\);\s*setPhase\('run'\)/);
  assert.match(revealHook, /phase: skipMotion \? \('done' as const\) : phase/);
});

test('useCountUp: roda uma vez, zerado enquanto escondido e valor final em done', () => {
  assert.match(countHook, /if \(phase === 'done' \|\| finished\) return target;/);
  assert.match(countHook, /return phase === 'pending' \? 0 : animated;/);
  assert.match(countHook, /if \(phase !== 'run' \|\| finished\) return;/);
  assert.match(countHook, /requestAnimationFrame\(tick\)/);
  assert.match(countHook, /cancelAnimationFrame\(frame\)/);
});

test('useShineOnView: observa o botão, dispara uma vez e só depois de o card entrar', () => {
  assert.match(shineHook, /if \(phase !== 'run' \|\| shineDelayMs !== null \|\| !node/);
  assert.match(shineHook, /threshold: EVENT_CARD_MOTION\.shine\.visibleRatio/);
  assert.match(shineHook, /observer\.disconnect\(\);\s*setShineDelayMs\(getShineDelayMs\(performance\.now\(\) - revealedAt\)\)/);
  assert.match(eventCard, /ref=\{guaranteeRef\}/);
  assert.match(eventCard, /data-shine=\{shineDelayMs === null \? undefined : 'on'\}/);
  assert.match(eventCard, /'--ec-shine-delay': `\$\{shineDelayMs\}ms`/);
});

test('o carrossel do topo e o resto da home continuam como estavam', () => {
  const featured = read('../src/components/home/FeaturedEventBanner.tsx');
  assert.doesNotMatch(featured, /event-card|ec-block|data-reveal/);
  assert.match(globals, /\.home-broadcast-chip,\s*\.home-broadcast-tile \{\s*animation: home-broadcast-rise 380ms/);
});
