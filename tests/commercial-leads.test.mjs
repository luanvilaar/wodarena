import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const types = read('../src/types/index.ts');
const helper = read('../src/lib/commercialLeads.ts');
const migration = read('../supabase/migrations/20260620110000_commercial_leads.sql');
const fixOwnerEmailMigration = read('../supabase/migrations/20260620123000_fix_owner_email_for_commercial_leads.sql');
const route = read('../src/app/api/commercial-leads/route.ts');
const resend = read('../src/lib/resend.ts');
const homePage = read('../src/app/page.tsx');
const ownerPage = read('../src/app/owner/page.tsx');
const story = read('../docs/stories/1.14.story.md');

test('shared model exposes commercial lead entity and helper labels', () => {
  assert.match(types, /export type CommercialLeadStatus = 'new' \| 'contacted' \| 'qualified' \| 'discarded'/);
  assert.match(types, /export type CommercialLeadEmailNotificationStatus = 'pending' \| 'sent' \| 'failed' \| 'skipped'/);
  assert.match(types, /export interface CommercialLead/);
  assert.match(helper, /export const COMMERCIAL_LEAD_SOURCE = 'homepage-commercial-interest'/);
  assert.match(helper, /export const COMMERCIAL_LEAD_TERMS_VERSION = 'wodarena-commercial-lead-v1'/);
  assert.match(helper, /getCommercialLeadStatusLabel/);
  assert.match(helper, /getCommercialLeadEmailStatusLabel/);
  assert.match(helper, /mapCommercialLeadFromDb/);
});

test('migration creates commercial leads table with consent and notification tracking', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS commercial_leads/);
  assert.match(migration, /lead_status TEXT NOT NULL DEFAULT 'new'/);
  assert.match(migration, /accepted_terms BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /terms_version TEXT NOT NULL/);
  assert.match(migration, /owner_email_notification_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(migration, /owner_email_notified_at TIMESTAMPTZ/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_commercial_leads_phone_normalized/);
  assert.match(migration, /CREATE TRIGGER trg_commercial_leads_updated_at/);
});

test('data fix migration rewrites stale owner email recipients to l.vilaar@gmail.com', () => {
  assert.match(fixOwnerEmailMigration, /UPDATE users/);
  assert.match(fixOwnerEmailMigration, /UPDATE commercial_leads/);
  assert.match(fixOwnerEmailMigration, /'l\.vilaar@gmail\.com'/);
  assert.match(fixOwnerEmailMigration, /'owner@wodarena\.com'/);
});

test('commercial leads route protects owner listing and persists public submissions before notification', () => {
  assert.match(route, /requireSession\(request, \['owner'\]\)/);
  assert.match(route, /checkRateLimit/);
  assert.match(route, /limit: 5/);
  assert.match(route, /process\.env\.COMMERCIAL_LEADS_OWNER_EMAIL \|\| process\.env\.WODARENA_OWNER_EMAIL/);
  assert.match(route, /const CANONICAL_COMMERCIAL_LEADS_OWNER_EMAIL = 'l\.vilaar@gmail\.com'/);
  assert.match(route, /const LEGACY_OWNER_EMAILS = new Set\(\['owner@wodarena\.com'\]\)/);
  assert.match(route, /normalizeOwnerEmailCandidate/);
  assert.match(route, /\.eq\('email', CANONICAL_COMMERCIAL_LEADS_OWNER_EMAIL\)/);
  assert.match(route, /\.eq\('id', 'owner-1'\)/);
  assert.match(route, /return fallbackEmail \|\| CANONICAL_COMMERCIAL_LEADS_OWNER_EMAIL/);
  assert.match(route, /Ja recebemos recentemente uma solicitacao com esse telefone para este evento/);
  assert.match(route, /owner_email_notification_status: 'pending'/);
  assert.match(route, /sendCommercialLeadOwnerEmail/);
  assert.match(route, /ownerEmailNotificationStatus: 'sent' \| 'failed' \| 'skipped'/);
  assert.match(route, /message: COMMERCIAL_LEAD_SUCCESS_MESSAGE/);
  assert.match(route, /lead: mapCommercialLeadFromDb/);
});

test('resend service exposes dedicated owner notification template', () => {
  assert.match(resend, /export async function sendCommercialLeadOwnerEmail/);
  assert.match(resend, /Novo gestor interessado no WODArena/);
  assert.match(resend, /Lead comercial/);
  assert.match(resend, /Data\/Hora do Cadastro/);
});

test('homepage renders the commercial campaign and inline form with privacy consent', () => {
  assert.match(homePage, /Seja um dos primeiros gestores a utilizar o WODArena\./);
  assert.match(homePage, /Quero utilizar o WODArena/);
  assert.match(homePage, /fetch\('\/api\/commercial-leads'/);
  assert.match(homePage, /Nome do gestor/);
  assert.match(homePage, /Telefone/);
  assert.match(homePage, /Estado \(UF\)/);
  assert.match(homePage, /Politica de Privacidade/);
  assert.match(homePage, /\/termos#privacidade/);
  assert.match(homePage, /Solicitação enviada com sucesso!/);
});

test('owner panel exposes a dedicated leads tab with email notification status', () => {
  assert.match(ownerPage, /'dashboard' \| 'managers' \| 'events' \| 'leaderboards' \| 'leads'/);
  assert.match(ownerPage, /Leads Comerciais/);
  assert.match(ownerPage, /fetch\('\/api\/commercial-leads'\)/);
  assert.match(ownerPage, /ownerEmailNotificationStatus/);
  assert.match(ownerPage, /getCommercialLeadEmailStatusLabel/);
  assert.match(ownerPage, /Nenhum lead capturado ainda/);
});

test('story 1.14 tracks the implementation scope and quality gates', () => {
  assert.match(story, /# Story 1\.14 - Captacao Comercial na Homepage com Leads no Painel do Proprietario/);
  assert.match(story, /AC10: O painel `\/owner` passa a ter uma aba dedicada/);
  assert.match(story, /Criar migration para persistir `commercial_leads`/);
  assert.match(story, /Rodar `npm run lint`/);
  assert.match(story, /Atualizar checklist, file list e change log/);
});
