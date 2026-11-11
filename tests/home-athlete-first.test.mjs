import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.132: home com o atleta primeiro e página /organizadores (P2 de
// docs/design/mobile-competitivo/).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('../src/app/[locale]/HomeView.tsx');
const homePage = read('../src/app/[locale]/page.tsx');
const organizersPage = read('../src/app/[locale]/organizadores/page.tsx');
const footer = read('../src/components/Footer.tsx');
const productStory = read('../src/components/home/ProductStory.tsx');
const messages = Object.fromEntries(['pt-br', 'pt-pt', 'en-gb'].map((l) => [l, JSON.parse(read(`../src/messages/${l}.json`))]));

test('a home abre com o título do atleta sobre o vídeo e a busca antes dos eventos', () => {
  // Story 1.136: o topo trocou a faixa de raias pelo vídeo de fundo.
  assert.ok(home.indexOf('<HeroVideo') < home.indexOf("t('heroTitle')"));
  assert.ok(home.indexOf("t('heroTitle')") < home.indexOf('id="event-search"'));
  assert.ok(home.indexOf('id="event-search"') < home.indexOf('<EventCard event={featuredEvent}'));
  assert.doesNotMatch(home, /t\('kicker'\)|t\('pastKicker'\)/, 'sem sobretítulo acima dos títulos');
});

test('o carrossel saiu do código e o contato comercial foi para /organizadores', () => {
  assert.equal(existsSync(new URL('../src/components/home/FeaturedEventBanner.tsx', import.meta.url)), false);
  assert.match(home, /if \(wantsOrganizers\) router\.replace\('\/organizadores#contato'\);/);
  assert.match(footer, /<Link href="\/organizadores"/);
  assert.match(organizersPage, /getScopedMessages\(\['Home', 'SectionOperations', 'Organizers'\]\)/);
  assert.match(homePage, /getScopedMessages\(\['Home', 'EventCard', 'Organizers', 'Checkout'\]\)/);
  assert.match(productStory, /href="\/organizadores"/);
});

test('textos novos nos três idiomas e namespace do carrossel removido', () => {
  for (const [locale, json] of Object.entries(messages)) {
    for (const key of ['heroTitle', 'heroSubtitle', 'eventCount', 'featuredTitle']) {
      assert.ok(json.Home[key], `${locale}: Home.${key}`);
    }
    for (const key of ['organizeCardTitle', 'storyTitle', 'storyLead', 'stepLabel', 'step1Title', 'step1Body', 'step2Title', 'step2Body', 'step3Title', 'step3Body']) {
      assert.ok(json.Organizers[key], `${locale}: Organizers.${key}`);
    }
    assert.equal(json.FeaturedEventBanner, undefined, `${locale}: FeaturedEventBanner saiu`);
  }
  assert.equal(messages['pt-br'].Home.heroTitle, 'Encontre sua próxima competição');
  assert.equal(messages['pt-br'].Organizers.storyTitle, 'O resultado nasce na quadra');
  for (const json of Object.values(messages)) assert.ok(json.EventCard.featuredBadge);
});

test('o destaque do dono abre os próximos em card largo, com o selo', () => {
  assert.match(home, /\{tab === 'upcoming' && featuredEvent && \(/);
  assert.match(home, /<EventCard event=\{featuredEvent\} priority featured wide \/>/);
  const card = read('../src/components/EventCard.tsx');
  assert.match(card, /\{featured && \(\s*<span[^>]*>\s*\{t\('featuredBadge'\)\}/);
  assert.match(card, /wide \? 'lg:grid lg:grid-cols-\[minmax\(0,1\.35fr\)_minmax\(0,1fr\)\] lg:grid-rows-\[auto_1fr\]' : ''/);
});
