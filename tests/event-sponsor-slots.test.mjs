import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.151 (docs/design/regulamento-patrocinadores/, D4, D5 e D8): vagas de
// patrocinador com logo PNG no painel, gravadas em events.sponsor_logos.

const fields = await importServerModule('lib/eventMediaFields.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MEDIA = fields.storagePublicPrefix('https://proj.supabase.co', 'event-media');
const logo = (name) => `${MEDIA}events/u1/sponsor-${name}.png`;

test('link da marca: só http ou https; sem protocolo entra https://', () => {
  assert.deepEqual(fields.normalizeSponsorLink(''), { ok: true, value: '' });
  assert.deepEqual(fields.normalizeSponsorLink('instagram.com/ferroforte'), { ok: true, value: 'https://instagram.com/ferroforte' });
  assert.deepEqual(fields.normalizeSponsorLink('http://loja.example.com'), { ok: true, value: 'http://loja.example.com/' });
  assert.equal(fields.normalizeSponsorLink('javascript:alert(1)').ok, false);
  assert.equal(fields.normalizeSponsorLink('ftp://arquivo.example.com').ok, false);
  assert.equal(fields.normalizeSponsorLink('semponto').ok, false);
  // O limite vale também depois de normalizar (o https:// conta).
  assert.equal(fields.normalizeSponsorLink(`${'a'.repeat(288)}.example.com`).ok, false);
});

test('vagas para gravar: até 12, logo do Storage do projeto, nome obrigatório com logo', () => {
  const ok = fields.normalizeSponsorSlots([
    { name: '  Ferro  Forte ', logoUrl: logo('a'), link: 'ferroforte.com.br' },
    { name: '', logoUrl: null, link: '' }
  ], MEDIA);
  assert.deepEqual(ok, { ok: true, value: [
    { name: 'Ferro Forte', logoUrl: logo('a'), link: 'https://ferroforte.com.br/' },
    { name: '', logoUrl: null, link: '' }
  ] });
  assert.deepEqual(fields.normalizeSponsorSlots(null, MEDIA), { ok: true, value: [] });
  assert.match(fields.normalizeSponsorSlots(Array.from({ length: 13 }, () => ({ name: '', logoUrl: null, link: '' })), MEDIA).error, /No máximo 12/);
  assert.match(fields.normalizeSponsorSlots([{ name: 'X', logoUrl: 'https://evil.example/x.png', link: '' }], MEDIA).error, /enviado pelo painel/);
  assert.match(fields.normalizeSponsorSlots([{ name: ' ', logoUrl: logo('b'), link: '' }], MEDIA).error, /Falta o nome do patrocinador 1/);
  assert.match(fields.normalizeSponsorSlots([{ name: 'X', logoUrl: logo('c'), link: 'javascript:x' }], MEDIA).error, /Patrocinador 1:/);
  // No painel, a mesma regra sem conferir de onde vem o logo.
  assert.equal(fields.findSponsorSlotIssue([{ name: 'X', logoUrl: 'blob:qualquer', link: '' }]), null);
  assert.match(fields.findSponsorSlotIssue([{ name: '', logoUrl: 'blob:qualquer', link: '' }]), /Falta o nome/);
});

test('leitura do banco e o que a página mostra: só vaga com logo e nome', () => {
  const slots = fields.readSponsorSlots('[{"name":"A","logoUrl":"https://x/a.png","link":""},{"name":"","logoUrl":null},{"bad":1},"lixo"]');
  assert.equal(slots.length, 3);
  assert.deepEqual(fields.publicSponsors(slots).map((slot) => slot.name), ['A']);
  assert.deepEqual(fields.readSponsorSlots('não é json'), []);
  assert.deepEqual(fields.readSponsorSlots(undefined), []);
});

test('o evento nasce sem os três nomes fixos (D8) e o painel grava as vagas', () => {
  const context = read('../src/context/AppContext.tsx');
  assert.doesNotMatch(context, /'Bull Fit', 'WOD Gear', 'Strong Nutrition'/);
  assert.match(context, /sponsors: \[\],/);
  assert.match(context, /sponsorLogos: readSponsorSlots\(evt\.sponsor_logos\)/);
  assert.match(context, /if \(updatedData\.sponsorLogos !== undefined\) dbPayload\.sponsor_logos = updatedData\.sponsorLogos;/);
  assert.match(context, /newEvent\.sponsorLogos && newEvent\.sponsorLogos\.length > 0 \? \{ sponsor_logos: newEvent\.sponsorLogos \}/);

  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /<SponsorSlotsField key=\{selectedEventToManage\?\.id \?\? 'edit'\} idPrefix="edit-event-sponsors" value=\{editEventSponsorLogos\} onChange=\{setEditEventSponsorLogos\} onUploadingChange=\{setEditEventSponsorUploading\} \/>/);
  assert.match(admin, /<SponsorSlotsField idPrefix="event-sponsors" value=\{eventSponsorLogos\} onChange=\{setEventSponsorLogos\} onUploadingChange=\{setEventSponsorUploading\} \/>/);
  assert.equal((admin.match(/const sponsorIssue = findSponsorSlotIssue\(/g) || []).length, 2);
  assert.match(admin, /JSON\.stringify\(editEventSponsorLogos\) !== JSON\.stringify\(selectedEventToManage\.sponsorLogos \?\? \[\]\)/);

  const field = read('../src/components/admin/SponsorSlotsField.tsx');
  assert.match(field, /Quantas marcas\?/);
  // Achado do CodeRabbit (major): durante o envio, quantidade, ordem e "tirar" ficam travados.
  assert.match(field, /disabled=\{disabled \|\| busy \|\| count >= SPONSOR_MAX_SLOTS\}/);
  assert.match(field, /disabled=\{disabled \|\| busy \|\| index === 0\}/);
  assert.match(field, /disabled=\{disabled \|\| busy\}/);
  assert.match(field, /accept="image\/png"/);
  assert.match(field, /uploadEventMedia\(file, 'sponsor'\)/);
  assert.match(field, /Falta o nome: ele é lido por quem usa leitor de tela\./);
});

test('logo do patrocinador: só PNG, sai em PNG (transparência) e a rota recusa outro formato', () => {
  const client = read('../src/lib/eventMediaUpload.ts');
  assert.match(client, /sponsor: \{ maxWidth: 600, maxHeight: 300, quality: 1 \}/);
  assert.match(client, /if \(file\.type !== 'image\/png'\) throw new EventMediaUploadError\('Só PNG\./);
  assert.match(client, /const outputType = kind === 'sponsor' \? 'image\/png' : 'image\/webp';/);
  const route = read('../src/app/api/admin/media/upload/route.ts');
  assert.match(route, /kind !== 'logo' && kind !== 'banner' && kind !== 'sponsor'/);
  assert.match(route, /if \(kind === 'sponsor' && file\.type !== 'image\/png'\)/);
  const css = read('../src/app/globals.css');
  assert.match(css, /--sponsor-tile: #eef0f3;/);
  assert.match(css, /--color-sponsor-tile: var\(--sponsor-tile\);/);
});
