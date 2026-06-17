import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const context = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const route = read('../src/app/api/athlete/profile/route.ts');
const cli = read('../bin/athlete-profile.mjs');
const packageJson = read('../package.json');

test('app context exposes athlete profile update action', () => {
  assert.match(context, /export type AthleteProfileUpdateInput/);
  assert.match(context, /updateAthleteProfile: \(data: AthleteProfileUpdateInput\) => Promise<boolean>/);
  assert.match(context, /const mapAthleteFromDb = \(a: AthleteDbRow\): Athlete =>/);
  assert.match(context, /const updateAthleteProfile = async \(\{ fullName, birthDate \}: AthleteProfileUpdateInput\): Promise<boolean> =>/);
  assert.match(context, /fetch\('\/api\/athlete\/profile'/);
  assert.match(context, /setCurrentUser\(payload\.user as User\)/);
});

test('athlete profile route validates session and updates linked records', () => {
  assert.match(route, /requireSession\(request, \['athlete'\]\)/);
  assert.match(route, /A data de nascimento deve estar no formato YYYY-MM-DD/);
  assert.match(route, /from\('users'\)[\s\S]*update\(\{ name: fullName \}\)/);
  assert.match(route, /from\('registrations'\)[\s\S]*update\(\{ athlete_name: fullName \}\)/);
  assert.match(route, /from\('athletes'\)[\s\S]*update\(\{\s*name: fullName,\s*birth_date: birthDate/s);
  assert.match(route, /getSessionCookieHeader\(createSessionToken\(nextSessionUser\)\)/);
});

test('athlete area exposes sidebar sections, profile form and event history', () => {
  assert.match(adminPage, /activeAthleteSection/);
  assert.match(adminPage, /Dados do Perfil/);
  assert.match(adminPage, /Historico de Eventos/);
  assert.match(adminPage, /Contestacoes de Prova/);
  assert.match(adminPage, /Salvar perfil/);
  assert.match(adminPage, /Informacoes da conta/);
  assert.match(adminPage, /Registros, resultados e acessos rapidos/);
  assert.match(adminPage, /Ver detalhes do evento/);
  assert.match(adminPage, /Ver leaderboard/);
});

test('cli entrypoint supports athlete profile read and update flows', () => {
  assert.match(packageJson, /"athlete-profile:cli": "node bin\/athlete-profile\.mjs"/);
  assert.match(cli, /npm run athlete-profile:cli -- show --user USER_ID/);
  assert.match(cli, /npm run athlete-profile:cli -- update --user USER_ID --name "Nome completo"/);
  assert.match(cli, /if \(command === 'show'\)/);
  assert.match(cli, /if \(command === 'update'\)/);
  assert.match(cli, /A data de nascimento deve estar no formato YYYY-MM-DD/);
});
