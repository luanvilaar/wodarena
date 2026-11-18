import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.150 (docs/design/regulamento-patrocinadores/, D1 a D3): regulamento
// oficial em PDF, enviado direto ao Storage por link assinado e conferido pelo
// servidor; a página mostra o arquivo e o texto vira resumo.

const fields = await importServerModule('lib/eventMediaFields.ts');
const storage = await importServerModule('lib/mediaStorage.ts');
const bootstrap = await importServerModule('lib/bootstrapPayload.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const BASE = 'https://proj.supabase.co';
const DOCS = fields.storagePublicPrefix(BASE, 'event-documents');
const pdfBytes = (size = 64) => { const bytes = new Uint8Array(size); bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); return bytes; };

test('PDF de verdade: os bytes começam com %PDF-', () => {
  assert.equal(fields.isPdfSignature(pdfBytes()), true);
  assert.equal(fields.isPdfSignature(new TextEncoder().encode('PK\u0003\u0004docx')), false);
  assert.equal(fields.isPdfSignature(new Uint8Array([0x25, 0x50])), false);
});

test('nome do arquivo: sem caminho nem controle, sempre .pdf', () => {
  assert.equal(fields.cleanPdfFileName('C:\\docs\\Regulamento Final.pdf'), 'Regulamento Final.pdf');
  assert.equal(fields.cleanPdfFileName('regras\u0007 2026'), 'regras 2026.pdf');
  assert.equal(fields.cleanPdfFileName(''), 'Regulamento.pdf');
  assert.ok(fields.cleanPdfFileName('a'.repeat(400)).length <= 200);
});

test('documento para gravar: URL do espaço de documentos, até 10 MB e data válida; null tira o PDF', () => {
  const ok = fields.normalizeRulesDocument({ url: `${DOCS}events/u1/regulamento-x.pdf`, name: 'Reg.pdf', size: 2_500_000, uploadedAt: '2026-11-18T12:00:00Z' }, DOCS);
  assert.deepEqual(ok, { ok: true, value: { url: `${DOCS}events/u1/regulamento-x.pdf`, name: 'Reg.pdf', size: 2_500_000, uploadedAt: '2026-11-18T12:00:00.000Z' } });
  assert.deepEqual(fields.normalizeRulesDocument(null, DOCS), { ok: true, value: null });
  assert.equal(fields.normalizeRulesDocument({ url: 'https://evil.example/x.pdf', size: 10, uploadedAt: '2026-11-18' }, DOCS).ok, false);
  assert.equal(fields.normalizeRulesDocument({ url: `${BASE}/storage/v1/object/public/event-media/x.pdf`, size: 10, uploadedAt: '2026-11-18' }, DOCS).ok, false);
  assert.equal(fields.normalizeRulesDocument({ url: `${DOCS}events/u1/x.pdf`, size: 11 * 1024 * 1024, uploadedAt: '2026-11-18' }, DOCS).ok, false);
  assert.equal(fields.normalizeRulesDocument({ url: `${DOCS}events/u1/x.pdf`, size: 10, uploadedAt: 'ontem' }, DOCS).ok, false);
  assert.equal(fields.readRulesDocument('{"url":"https://a/x.pdf","name":"x","size":5}').name, 'x.pdf');
  assert.equal(fields.readRulesDocument({}), null);
});

test('caminho do envio: só a pasta do próprio gestor e o nome gerado pelo servidor', () => {
  assert.equal(storage.isOwnRulesDocumentPath('events/u1/regulamento-lz3k9a-0123456789ab.pdf', 'u1'), true);
  assert.equal(storage.isOwnRulesDocumentPath('events/u2/regulamento-lz3k9a-0123456789ab.pdf', 'u1'), false);
  assert.equal(storage.isOwnRulesDocumentPath('events/u1/../u2/regulamento-lz3k9a-0123456789ab.pdf', 'u1'), false);
  assert.equal(storage.isOwnRulesDocumentPath('events/u1/logo-lz3k9a-0123456789ab.png', 'u1'), false);
});

const fakeStorage = (bytes) => {
  const removed = [];
  return {
    removed,
    client: {
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob([bytes]), error: null }),
          remove: async (paths) => { removed.push(...paths); return { data: null, error: null }; },
          getPublicUrl: (path) => ({ data: { publicUrl: `${DOCS}${path}` } })
        })
      }
    }
  };
};

test('conferir o envio: PDF vira documento; arquivo que não é PDF é apagado do Storage', async () => {
  const path = 'events/u1/regulamento-lz3k9a-0123456789ab.pdf';
  const good = fakeStorage(pdfBytes(1200));
  const document = await storage.confirmRulesDocumentUpload(good.client, 'u1', path, 'Regulamento Copa.pdf');
  assert.equal(document.url, `${DOCS}${path}`);
  assert.equal(document.name, 'Regulamento Copa.pdf');
  assert.equal(document.size, 1200);
  assert.ok(Number.isFinite(Date.parse(document.uploadedAt)));
  assert.deepEqual(good.removed, []);

  const bad = fakeStorage(new TextEncoder().encode('PK docx renomeado'));
  await assert.rejects(storage.confirmRulesDocumentUpload(bad.client, 'u1', path, 'x.pdf'), /não é um PDF/);
  assert.deepEqual(bad.removed, [path]);

  await assert.rejects(storage.confirmRulesDocumentUpload(good.client, 'u2', path, 'x.pdf'), /inválido/);
});

test('bootstrap: pede PDF e marcas primeiro; sem a migration, lê o select de antes', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const selects = [];
  const rows = await bootstrap.readEventsWithFeaturedFallback(
    'eventos de teste',
    async (select) => {
      selects.push(select);
      return /sponsor_logos/.test(select)
        ? { data: null, error: { code: '42703', message: 'column events.sponsor_logos does not exist' } }
        : { data: [{ id: 'evt-1' }], error: null };
    },
    async () => { throw new Error('não deveria cair no legado'); }
  );
  assert.equal(bootstrap.PUBLIC_EVENT_SELECT_WITH_MEDIA, `${bootstrap.PUBLIC_EVENT_SELECT}, rules_document, sponsor_logos`);
  assert.deepEqual(selects, [bootstrap.PUBLIC_EVENT_SELECT_WITH_MEDIA, bootstrap.PUBLIC_EVENT_SELECT]);
  assert.deepEqual(rows, [{ id: 'evt-1' }]);
});

test('rota de envio, gravação, painel, página e migration', () => {
  const route = read('../src/app/api/admin/documents/upload/route.ts');
  assert.match(route, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(route, /await assertManagerOperationalAccess\(supabaseAdmin, actor\);/);
  assert.match(route, /if \(size > RULES_DOCUMENT_MAX_BYTES\)/);
  assert.match(route, /await ensureEventDocumentsBucket\(supabaseAdmin\);\s*return NextResponse\.json\(await createRulesDocumentUpload\(supabaseAdmin, actor\.id\)\);/);
  assert.match(route, /confirmRulesDocumentUpload\(supabaseAdmin, actor\.id, body\?\.path, body\?\.fileName\)/);

  const client = read('../src/lib/rulesDocumentUpload.ts');
  assert.match(client, /await import\('@\/lib\/supabase'\)/);
  assert.match(client, /uploadToSignedUrl\(signed\.path, signed\.token, body\)/);

  const persistence = read('../src/app/api/admin/persistence/route.ts');
  assert.match(persistence, /'rules_document', 'sponsor_logos'\n\] as const;/);
  assert.match(persistence, /const mediaError = applyEventMediaFields\(event\);[\s\S]*\.from\('events'\)\.insert\(event\)/);
  assert.match(persistence, /const mediaError = applyEventMediaFields\(allowedData\);[\s\S]*\.from\('events'\)\.update\(allowedData\)/);
  assert.match(persistence, /isMissingEventMediaColumn\(error\)\) return NextResponse\.json\(\{ error: EVENT_MEDIA_MIGRATION_MESSAGE \}, \{ status: 503 \}\)/);

  const admin = read('../src/app/admin/page.tsx');
  // Achado do CodeRabbit: o campo é refeito por evento e salvar espera o envio terminar.
  assert.match(admin, /<RulesDocumentField key=\{`\$\{selectedEventToManage\?\.id \?\? 'edit'\}-rules`\} id="edit-event-rules-pdf" value=\{editEventRulesDocument\} onChange=\{setEditEventRulesDocument\} onUploadingChange=\{setEditEventPdfUploading\} \/>/);
  assert.match(admin, /<RulesDocumentField id="event-rules-pdf" value=\{eventRulesDocument\} onChange=\{setEventRulesDocument\} onUploadingChange=\{setEventPdfUploading\} \/>/);
  assert.match(admin, /if \(editEventPdfUploading \|\| editEventSponsorUploading\) \{/);
  assert.match(admin, /if \(eventPdfUploading \|\| eventSponsorUploading\) \{/);
  assert.match(read('../src/components/admin/RulesDocumentField.tsx'), /if \(mounted\.current\) onChange\(document\);/);
  assert.match(admin, /Resumo do regulamento \(opcional\)/);
  assert.match(admin, /JSON\.stringify\(editEventRulesDocument\) !== JSON\.stringify\(selectedEventToManage\.rulesDocument \?\? null\)/);

  const view = read('../src/app/[locale]/event/[id]/EventView.tsx');
  assert.match(view, /downloadUrl: `\$\{rulesDocument\.url\}\?download=\$\{encodeURIComponent\(rulesDocument\.name\)\}`/);
  assert.match(view, /document=\{rulesSheetDocument\}/);
  const sheet = read('../src/components/EventRulesSheet.tsx');
  assert.match(sheet, /target="_blank"\s+rel="noopener noreferrer"/);
  for (const locale of ['pt-br', 'pt-pt', 'en-gb']) {
    const messages = JSON.parse(read(`../src/messages/${locale}.json`));
    for (const key of ['rulesPdf', 'rulesOpenPdf', 'rulesDownload', 'rulesSummary', 'rulesUpdated']) assert.ok(messages.Event.top[key], `${locale}: ${key}`);
  }

  const migration = read('../supabase/migrations/20261118120000_event_rules_document_sponsor_logos.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS rules_document JSONB;/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS sponsor_logos JSONB NOT NULL DEFAULT '\[\]'::jsonb;/);
  assert.match(migration, /VALUES \('event-documents', 'event-documents', true, 10485760, ARRAY\['application\/pdf'\]\)/);
});
