import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const types = read('../src/types/index.ts');
const managerAccess = read('../src/lib/managerAccess.ts');
const serverManagerAccess = read('../src/lib/serverManagerAccess.ts');
const migration = read('../supabase/migrations/20260621100000_manager_service_validity.sql');
const context = read('../src/context/AppContext.tsx');
const bootstrap = read('../src/app/api/app/bootstrap/route.ts');
const createUserRoute = read('../src/app/api/admin/create-user/route.ts');
const adminPersistence = read('../src/app/api/admin/persistence/route.ts');
const serverCheckout = read('../src/lib/serverCheckout.ts');
const registrationStart = read('../src/app/api/registrations/start/route.ts');
const couponRoute = read('../src/app/api/checkout/coupon/route.ts');
const cardRoute = read('../src/app/api/checkout/card/route.ts');
const pixRoute = read('../src/app/api/checkout/pix/route.ts');
const preferenceRoute = read('../src/app/api/checkout/preference/route.ts');
const ownerPage = read('../src/app/owner/page.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const cli = read('../bin/manager-service.mjs');
const packageJson = read('../package.json');
const story = read('../docs/stories/1.15.story.md');

test('shared model and helpers expose manager service validity state', () => {
  assert.match(types, /export type ManagerAccessStatus = 'active' \| 'expired' \| 'expiring_soon' \| 'unconfigured'/);
  assert.match(types, /serviceValidUntil\?: string/);
  assert.match(types, /managerAccessStatus\?: ManagerAccessStatus/);
  assert.match(managerAccess, /export const MANAGER_EXPIRING_SOON_DAYS = 7/);
  assert.match(managerAccess, /export const getManagerAccessStatus =/);
  assert.match(managerAccess, /export const getManagerAccessStatusLabel =/);
  assert.match(serverManagerAccess, /export class ManagerAccessError extends Error/);
  assert.match(serverManagerAccess, /assertManagerOperationalAccess/);
  assert.match(serverManagerAccess, /assertManagerSalesAccessForEvent/);
});

test('migration, bootstrap and context carry service validity for managers', () => {
  assert.match(migration, /ALTER TABLE users/);
  assert.match(migration, /service_valid_until DATE/);
  assert.match(migration, /idx_users_service_valid_until/);
  assert.match(bootstrap, /service_valid_until/);
  assert.match(bootstrap, /managerAccessStatus:/);
  assert.match(context, /updateManagerServiceValidity: \(userId: string, serviceValidUntil\?: string \| null\) => Promise<User \| null>/);
  assert.match(context, /const mapUserFromDb = \(user: Record<string, unknown>\): User =>/);
  assert.match(context, /method: 'PUT'/);
  assert.match(context, /serviceValidUntil: serviceValidUntil \|\| null/);
});

test('owner routes and sales flows enforce manager validity server-side', () => {
  assert.match(createUserRoute, /export async function PUT/);
  assert.match(createUserRoute, /service_valid_until/);
  assert.match(createUserRoute, /A validade de uso deve estar no formato YYYY-MM-DD/);
  assert.match(adminPersistence, /assertManagerOperationalAccess/);
  assert.match(serverCheckout, /assertManagerSalesAccessForEvent/);
  assert.match(registrationStart, /managerAccessErrorResponse/);
  assert.match(couponRoute, /managerAccessErrorResponse/);
  assert.match(cardRoute, /assertManagerSalesAccessForEvent/);
  assert.match(pixRoute, /assertManagerSalesAccessForEvent/);
  assert.match(preferenceRoute, /assertManagerSalesAccessForEvent/);
});

test('owner and admin interfaces expose renewal workflow and blocked manager surface', () => {
  assert.match(ownerPage, /Gestores e Vendas/);
  assert.match(ownerPage, /Validade de Uso/);
  assert.match(ownerPage, /Carteira de Gestores/);
  assert.match(ownerPage, /Painel e vendas bloqueados/);
  assert.match(ownerPage, /handleSaveManagerValidity/);
  assert.match(adminPage, /Seu periodo de uso da plataforma expirou/);
  assert.match(adminPage, /As funções operacionais do painel e as vendas online dos seus eventos estão temporariamente bloqueadas/);
  assert.match(adminPage, /getManagerAccessStatusLabel/);
});

test('cli entrypoint supports manager validity read and update flows', () => {
  assert.match(packageJson, /"manager-service:cli": "node bin\/manager-service\.mjs"/);
  assert.match(cli, /npm run manager-service:cli -- list/);
  assert.match(cli, /npm run manager-service:cli -- show --user USER_ID/);
  assert.match(cli, /npm run manager-service:cli -- update --user USER_ID --valid-until YYYY-MM-DD/);
  assert.match(cli, /if \(command === 'list'\)/);
  assert.match(cli, /if \(command === 'show'\)/);
  assert.match(cli, /if \(command === 'update'\)/);
  assert.match(cli, /if \(command === 'clear'\)/);
  assert.match(cli, /A validade deve estar no formato YYYY-MM-DD/);
});

test('story 1.15 tracks validity, blocking and CLI-first implementation scope', () => {
  assert.match(story, /# Story 1\.15 - Validade de Uso do Gestor com Bloqueio Operacional e Renovacao/);
  assert.match(story, /AC4: Quando o prazo do gestor expira, o login continua funcionando, mas o painel `\/admin` do gestor exibe uma tela de bloqueio/);
  assert.match(story, /AC6: Quando o prazo do gestor expira, novas vendas online dos eventos dele ficam bloqueadas server-side/);
  assert.match(story, /Implementar CLI para consultar e atualizar validade de gestores/);
  assert.match(story, /Rodar `npm run lint`/);
});
