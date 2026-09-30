import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const context = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const athleteSections = read('../src/lib/athleteSections.ts');
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

test('athlete area exposes navigation sections, profile form and event history', () => {
  // Rótulos da navegação: fonte única em src/lib/athleteSections.ts.
  assert.match(athleteSections, /\{ id: 'events', hash: 'inscricoes', label: 'Inscrições', shortLabel: 'Inscrições' \}/);
  assert.match(athleteSections, /\{ id: 'contestations', hash: 'contestar', label: 'Contestações', shortLabel: 'Contestar' \}/);
  assert.match(athleteSections, /\{ id: 'profile', hash: 'perfil', label: 'Dados do perfil', shortLabel: 'Perfil' \}/);
  assert.match(adminPage, /const activeAthleteSection = useSyncExternalStore\(/);

  // Cabeçalhos reais das seções (JSX renderizado, não comentários).
  assert.match(adminPage, /\{activeAthleteSection === 'profile' && \(\s*<section id="activeAthleteSection-profile"[\s\S]*?<h3 className="[^"]*">Dados do perfil<\/h3>/);
  assert.match(adminPage, /Essas informações são usadas em inscrições e leaderboards\.<\/p>/);
  assert.match(adminPage, /onSubmit=\{handleSaveAthleteProfile\}[\s\S]*?'Salvar perfil'/);
  assert.match(adminPage, /\{activeAthleteSection === 'events' && \(\s*<section id="activeAthleteSection-events"[\s\S]*?<h3 className="[^"]*">Minhas inscrições<\/h3>/);
  assert.match(adminPage, />Registros, resultados e acessos rápidos das suas participações\.<\/p>/);
  assert.match(adminPage, /\{activeAthleteSection === 'contestations' && \(\s*<section id="activeAthleteSection-contestations"[\s\S]*?<h3 className="[^"]*">Contestar prova<\/h3>/);
  assert.match(adminPage, /<span>Ver detalhes do evento<\/span>/);
  assert.match(adminPage, /<span>Ver leaderboard<\/span>/);
});

test('cli entrypoint supports athlete profile read and update flows', () => {
  assert.match(packageJson, /"athlete-profile:cli": "node bin\/athlete-profile\.mjs"/);
  assert.match(cli, /npm run athlete-profile:cli -- show --user USER_ID/);
  assert.match(cli, /npm run athlete-profile:cli -- update --user USER_ID --name "Nome completo"/);
  assert.match(cli, /if \(command === 'show'\)/);
  assert.match(cli, /if \(command === 'update'\)/);
  assert.match(cli, /A data de nascimento deve estar no formato YYYY-MM-DD/);
});
