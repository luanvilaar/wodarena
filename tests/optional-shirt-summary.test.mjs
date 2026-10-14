import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { SHIRT_NONE, SHIRT_SIZES } from '../src/lib/shirtPricing.ts';
import {
  SHIRT_NONE_LABEL,
  buildShirtSummary,
  createRegistrationAthleteResolver,
  formatRegistrationShirts,
  formatShirtChoice,
  getAthleteTeamMembers,
  getShirtDeliveryLabel,
  getShirtSummaryRows,
  listRegistrationShirts
} from '../src/lib/shirtSummary.ts';

// Story 1.38, painel do gestor (parte 2): camisa por inscrição na lista,
// resumo para o pedido ao fornecedor (D5) e planilha "Exportar Camisas".

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const admin = read('../src/app/admin/page.tsx');
const summarySource = read('../src/lib/shirtSummary.ts');
const summaryCard = read('../src/components/admin/ShirtSummaryCard.tsx');

const block = (source, pattern) => source.match(pattern)?.[0] || '';
const registrationsTab = block(admin, /const renderAbaRegistrations = \(\) => \{[\s\S]*?\n {2}\};/);
const exportHandler = block(registrationsTab, /const handleExportShirtSizes = \(\) => \{[\s\S]*?\n {4}\};/);
const registrationList = block(registrationsTab, /\{filteredRegs\.map\(\(reg\) => \{[\s\S]*?\n {16}\}\)\}/);

const members = (...sizes) => sizes.map((shirtSize, index) => ({
  name: `Atleta ${index + 1}`,
  instagram: `atleta${index + 1}`,
  shirtSize
}));

const individual = (id, name, divisionId, shirtSize) => ({ id, name, divisionId, shirtSize, isTeam: false, teamMembers: [] });
const team = (id, name, divisionId, teamMembers, shirtSize = '') => ({ id, name, divisionId, shirtSize, isTeam: true, teamMembers });
const registration = (athleteName, divisionId, paymentStatus = 'payment_approved', extra = {}) => ({
  athleteName,
  divisionId,
  paymentStatus,
  ...extra
});

const EMPTY_SUMMARY = {
  sizes: { P: 0, M: 0, G: 0, GG: 0 },
  otherSizes: [],
  totalToProduce: 0,
  withoutShirt: 0,
  missingSize: 0,
  pendingShirts: 0,
  paidRegistrations: 0
};

test('formatShirtChoice escreve "Sem camisa" no lugar de NONE e mantém os tamanhos', () => {
  assert.equal(SHIRT_NONE_LABEL, 'Sem camisa');
  assert.equal(formatShirtChoice(SHIRT_NONE), 'Sem camisa');
  assert.equal(formatShirtChoice(' NONE '), 'Sem camisa');
  for (const size of SHIRT_SIZES) assert.equal(formatShirtChoice(size), size);
  assert.equal(formatShirtChoice(' GG '), 'GG');
  // Tamanho antigo, fora da lista atual, sai como foi gravado.
  assert.equal(formatShirtChoice('XG'), 'XG');
  assert.equal(formatShirtChoice(''), '');
  assert.equal(formatShirtChoice('   '), '');
  assert.equal(formatShirtChoice(null), '');
  assert.equal(formatShirtChoice(undefined), '');
});

test('listRegistrationShirts: atleta individual', () => {
  const reg = registration('Ana', 'rx');
  assert.deepEqual(listRegistrationShirts(reg, individual('a1', 'Ana', 'rx', 'M')), [
    { name: 'Ana', size: 'M', hasShirt: true }
  ]);
  assert.deepEqual(listRegistrationShirts(reg, individual('a1', 'Ana', 'rx', SHIRT_NONE)), [
    { name: 'Ana', size: SHIRT_NONE, hasShirt: false }
  ]);
  assert.deepEqual(listRegistrationShirts(reg, individual('a1', 'Ana', 'rx', undefined)), [
    { name: 'Ana', size: '', hasShirt: false }
  ]);
  // Integrantes de um cadastro que não é equipe são ignorados.
  const notTeam = { ...individual('a1', 'Ana', 'rx', 'G'), teamMembers: members('P', 'M') };
  assert.deepEqual(listRegistrationShirts(reg, notTeam), [{ name: 'Ana', size: 'G', hasShirt: true }]);
});

test('listRegistrationShirts: equipe com mistura, na ordem dos integrantes', () => {
  const athlete = team('t1', 'Iron Box', 'team', members('P', 'M', 'G', SHIRT_NONE));
  const shirts = listRegistrationShirts(registration('Iron Box', 'team'), athlete);
  assert.deepEqual(shirts, [
    { name: 'Atleta 1', size: 'P', hasShirt: true },
    { name: 'Atleta 2', size: 'M', hasShirt: true },
    { name: 'Atleta 3', size: 'G', hasShirt: true },
    { name: 'Atleta 4', size: SHIRT_NONE, hasShirt: false }
  ]);
  assert.equal(formatRegistrationShirts(shirts), 'P · M · G · Sem camisa');
  assert.equal(getAthleteTeamMembers(athlete).length, 4);

  // Camisa inclusa pela Bilheteria: o tamanho do responsável vale para o 1º integrante.
  const fromBilheteria = team('t2', 'Dupla', 'duo', members('', ''), 'GG');
  assert.deepEqual(listRegistrationShirts(registration('Dupla', 'duo'), fromBilheteria).map(shirt => shirt.size), ['GG', '']);
  assert.equal(formatRegistrationShirts(listRegistrationShirts(registration('Dupla', 'duo'), fromBilheteria)), 'GG · -');
});

test('listRegistrationShirts: equipe sem integrantes cai para a camisa do cadastro', () => {
  const athlete = team('t1', 'Trio Forte', 'trio', [], 'M');
  assert.deepEqual(listRegistrationShirts(registration('Trio Forte', 'trio'), athlete), [
    { name: 'Trio Forte', size: 'M', hasShirt: true }
  ]);
  assert.deepEqual(getAthleteTeamMembers(athlete), []);
  assert.deepEqual(getAthleteTeamMembers({ isTeam: true, teamMembers: undefined }), []);
});

test('listRegistrationShirts: sem cadastro de atleta, um participante sem tamanho', () => {
  for (const missing of [undefined, null]) {
    assert.deepEqual(listRegistrationShirts(registration('Sem Cadastro', 'rx'), missing), [
      { name: 'Sem Cadastro', size: '', hasShirt: false }
    ]);
  }
  assert.deepEqual(getAthleteTeamMembers(undefined), []);
});

test('getShirtDeliveryLabel separa produzir, sem camisa e tamanho não informado', () => {
  assert.equal(getShirtDeliveryLabel({ size: 'M', hasShirt: true }), 'Produzir');
  assert.equal(getShirtDeliveryLabel({ size: 'XG', hasShirt: true }), 'Produzir');
  assert.equal(getShirtDeliveryLabel({ size: SHIRT_NONE, hasShirt: false }), 'Não produzir (sem camisa)');
  assert.equal(getShirtDeliveryLabel({ size: '', hasShirt: false }), 'Tamanho não informado');
});

test('buildShirtSummary conta só inscrições pagas; pendentes à parte; canceladas, falhas e reembolsos fora', () => {
  const athletes = [
    individual('a1', 'Ana', 'rx', 'M'),
    individual('a2', 'Bruno', 'rx', 'G'),
    individual('a3', 'Carla', 'rx', 'P'),
    individual('a4', 'Davi', 'rx', 'GG'),
    individual('a5', 'Eva', 'rx', 'M'),
    individual('a6', 'Fábio', 'rx', 'M'),
    individual('a7', 'Gil', 'rx', 'G')
  ];
  const summary = buildShirtSummary([
    registration('Ana', 'rx', 'payment_approved'),
    registration('Bruno', 'rx', 'payment_pending'),
    registration('Carla', 'rx', 'payment_in_review'),
    registration('Davi', 'rx', 'payment_cancelled', { refundStatus: 'manual_pending' }),
    registration('Eva', 'rx', 'payment_failed'),
    registration('Fábio', 'rx', 'payment_cancelled', { refundStatus: 'manual_refunded' }),
    // Defesa: reembolso registrado tira a inscrição do pedido mesmo se o status não mudou.
    registration('Gil', 'rx', 'payment_approved', { refundStatus: 'manual_refunded' })
  ], athletes);

  assert.deepEqual(summary, {
    ...EMPTY_SUMMARY,
    sizes: { P: 0, M: 1, G: 0, GG: 0 },
    totalToProduce: 1,
    pendingShirts: 2,
    paidRegistrations: 1
  });
});

test('buildShirtSummary: "Sem camisa", tamanhos antigos e sem tamanho informado', () => {
  const athletes = [
    individual('a1', 'Ana', 'rx', 'P'),
    individual('a2', 'Bruno', 'rx', SHIRT_NONE),
    individual('a3', 'Carla', 'rx', 'XG'),
    individual('a4', 'Davi', 'rx', ''),
    team('t1', 'Iron Box', 'team', members('M', SHIRT_NONE, 'GG', 'XG')),
    team('t2', 'Dupla Pendente', 'duo', members('G', SHIRT_NONE))
  ];
  const summary = buildShirtSummary([
    registration('Ana', 'rx'),
    registration('Bruno', 'rx'),
    registration('Carla', 'rx'),
    registration('Davi', 'rx'),
    registration('Iron Box', 'team'),
    // Paga, mas sem cadastro de atleta: entra como sem tamanho informado.
    registration('Fantasma', 'rx'),
    // Pendente: só a camisa com tamanho conta à parte; "Sem camisa" não.
    registration('Dupla Pendente', 'duo', 'payment_pending')
  ], athletes);

  assert.deepEqual(summary, {
    sizes: { P: 1, M: 1, G: 0, GG: 1 },
    otherSizes: [{ size: 'XG', count: 2 }],
    totalToProduce: 5,
    withoutShirt: 2,
    missingSize: 2,
    pendingShirts: 1,
    paidRegistrations: 6
  });
  assert.deepEqual(Object.keys(summary.sizes), [...SHIRT_SIZES]);

  assert.deepEqual(getShirtSummaryRows(summary), [
    ['P', 1],
    ['M', 1],
    ['G', 0],
    ['GG', 1],
    ['XG (tamanho antigo)', 2],
    ['Total a produzir', 5],
    ['Sem camisa', 2],
    ['Sem tamanho informado', 2],
    ['Camisas em inscrições pendentes (não incluídas)', 1]
  ]);
});

test('buildShirtSummary resolve o atleta por athleteId ou por nome e categoria, sem diferenciar maiúsculas', () => {
  const athletes = [
    individual('a1', 'Ana Souza', 'rx', 'P'),
    individual('a2', 'Ana Souza', 'scale', 'GG'),
    individual('a3', 'Nome Antigo', 'rx', 'G')
  ];

  // Nome igual em outra categoria não é a mesma pessoa.
  assert.deepEqual(buildShirtSummary([registration('ANA SOUZA', 'rx')], athletes).sizes, { P: 1, M: 0, G: 0, GG: 0 });
  assert.deepEqual(buildShirtSummary([registration('ana souza', 'scale')], athletes).sizes, { P: 0, M: 0, G: 0, GG: 1 });
  // athleteId vale mesmo com o nome da inscrição diferente do cadastro.
  assert.deepEqual(buildShirtSummary([registration('Nome Novo', 'rx', 'payment_approved', { athleteId: 'a3' })], athletes).sizes, { P: 0, M: 0, G: 1, GG: 0 });
  // athleteId tem prioridade sobre um homônimo na mesma categoria.
  assert.deepEqual(buildShirtSummary([registration('Ana Souza', 'rx', 'payment_approved', { athleteId: 'a3' })], athletes).sizes, { P: 0, M: 0, G: 1, GG: 0 });
  // athleteId desconhecido cai para nome e categoria.
  assert.deepEqual(buildShirtSummary([registration('Ana Souza', 'rx', 'payment_approved', { athleteId: 'apagado' })], athletes).sizes, { P: 1, M: 0, G: 0, GG: 0 });
  // Nenhum dos dois encontrado: sem tamanho informado.
  assert.equal(buildShirtSummary([registration('Outra Pessoa', 'rx')], athletes).missingSize, 1);

  const resolve = createRegistrationAthleteResolver(athletes);
  assert.equal(resolve(registration('ANA SOUZA', 'scale'))?.id, 'a2');
  assert.equal(resolve(registration('', 'rx')), undefined);
});

test('buildShirtSummary respeita o subconjunto recebido (filtro da lista)', () => {
  const athletes = [individual('a1', 'Ana', 'rx', 'M'), individual('a2', 'Bia', 'scale', 'G')];
  const regs = [registration('Ana', 'rx'), registration('Bia', 'scale')];

  assert.equal(buildShirtSummary(regs, athletes).totalToProduce, 2);
  const onlyScale = buildShirtSummary(regs.filter(reg => reg.divisionId === 'scale'), athletes);
  assert.deepEqual(onlyScale.sizes, { P: 0, M: 0, G: 1, GG: 0 });
  assert.equal(onlyScale.paidRegistrations, 1);
  assert.deepEqual(buildShirtSummary([], athletes), EMPTY_SUMMARY);
});

test('shirtSummary.ts é puro: só imports de tipo e as constantes presas à regra', () => {
  const imports = summarySource.match(/^import[\s\S]*?;$/gm) || [];
  assert.ok(imports.length > 0);
  for (const statement of imports) assert.match(statement, /^import type /);
  assert.doesNotMatch(summarySource, /from 'react'|useState|useMemo/);
  // Valor reservado e tamanhos presos aos tipos de shirtPricing.ts.
  assert.match(summarySource, /const SHIRT_NONE: typeof SHIRT_NONE_RULE = 'NONE';/);
  assert.match(summarySource, /const SHIRT_SIZES: typeof SHIRT_SIZES_RULE = \['P', 'M', 'G', 'GG'\];/);
});

test('lista de inscrições mostra a camisa por participante e o adicional, nunca NONE', () => {
  assert.ok(registrationsTab, 'a aba de inscrições deve existir');
  assert.ok(registrationList, 'a lista de inscrições deve existir');

  // Mesma resolução de atleta na lista, no resumo e na planilha.
  assert.match(registrationsTab, /const resolveRegistrationAthlete = createRegistrationAthleteResolver\(athletes\)/);
  assert.match(registrationList, /const athleteInfo = resolveRegistrationAthlete\(reg\)/);
  assert.match(registrationList, /const registrationShirts = listRegistrationShirts\(reg, athleteInfo\)/);
  assert.match(registrationList, /formatRegistrationShirts\(registrationShirts\)/);
  // Adicional cobrado da inscrição, na moeda do evento.
  assert.match(registrationList, /const shirtAddonAmount = reg\.shirtAddonAmount \?\? 0/);
  assert.match(registrationList, /`\+ \$\{formatEventMoney\(shirtAddonAmount, reg\.currency \|\| selectedEventToManage\?\.currency\)\}`/);
  assert.match(registrationList, /<RegDetail label="Camisa" value=\{shirtSizeLabel\} accent \/>/);
  assert.match(registrationList, /const memberShirtLabel = formatShirtChoice\(registrationShirts\[idx\]\?\.size\)/);
  assert.match(registrationList, /<span className="sr-only">Camisa: <\/span>/);

  // O valor gravado nunca é impresso cru.
  assert.doesNotMatch(registrationList, /\{m\.shirtSize\}|\{athleteInfo\??\.shirtSize\}|String\(athleteInfo\.shirtSize\)/);
  assert.doesNotMatch(admin, /['"`]NONE['"`]/);
});

test('cartão "Resumo para o pedido ao fornecedor" usa o resumo puro e a coleção filtrada', () => {
  assert.match(admin, /import \{ ShirtSummaryCard \} from '@\/components\/admin\/ShirtSummaryCard'/);
  assert.match(registrationsTab, /const shirtSummary = buildShirtSummary\(filteredRegs, athletes\)/);
  assert.match(registrationsTab, /<ShirtSummaryCard summary=\{shirtSummary\} shirtMode=\{managedEventShirtMode\} isFiltered=\{isRegListFiltered\} \/>/);
  assert.match(registrationsTab, /const isRegListFiltered = Boolean\(regFilterCatId \|\| regFilterStatus \|\| regFilterName \|\| regFilterBox\)/);

  // O cartão recebe tudo por props e não lê o contexto.
  assert.doesNotMatch(summaryCard, /useApp|@\/context\//);
  assert.match(summaryCard, /<section aria-labelledby=\{titleId\}/);
  assert.match(summaryCard, /Resumo para o pedido ao fornecedor/);
  assert.match(summaryCard, /Conta só inscrições pagas\./);
  assert.match(summaryCard, /<ul aria-label="Camisas pagas por tamanho"/);
  assert.match(summaryCard, /\{SHIRT_SIZES\.map\(size => \(/);
  assert.match(summaryCard, /<span className="sr-only">Tamanho <\/span>/);
  assert.match(summaryCard, /'camisa a produzir', 'camisas a produzir'/);
  assert.match(summaryCard, /'camisa em inscrição pendente \(não incluída\)',\s*'camisas em inscrições pendentes \(não incluídas\)'/);
  assert.match(summaryCard, /sem tamanho informado/);
  // Estado vazio claro quando não há inscrição paga.
  assert.match(summaryCard, /Nenhuma inscrição paga com os filtros atuais\./);
  assert.match(summaryCard, /Nenhuma inscrição paga ainda\. O resumo aparece quando houver pagamento aprovado\./);
  assert.doesNotMatch(summaryCard, /['"`]NONE['"`]/);
});

test('"Exportar Camisas" escreve "Sem camisa", adicional, entrega e o resumo do pedido', () => {
  assert.ok(exportHandler, 'handleExportShirtSizes deve existir');
  assert.match(exportHandler, /const rows = filteredRegs\.flatMap\(\(reg\) => \{/);
  assert.match(exportHandler, /camisa: formatShirtChoice\(shirt\.size\)/);
  assert.match(exportHandler, /adicional: index === 0 \? shirtAddonPaid : ''/);
  assert.match(exportHandler, /entrega: getShirtDeliveryLabel\(shirt\)/);
  assert.match(exportHandler, /'Status', 'Data', 'Adicional pago', 'Entrega'\]/);
  assert.match(exportHandler, /const summaryRows = getShirtSummaryRows\(shirtSummary\)/);
  assert.match(exportHandler, /Resumo do pedido/);
  // Nome do arquivo e formato continuam os mesmos.
  assert.match(exportHandler, /application\/vnd\.ms-excel;charset=utf-8;/);
  assert.match(exportHandler, /link\.download = `camisas-\$\{/);
  assert.doesNotMatch(exportHandler, /camisa: member\.shirtSize|camisa: athleteInfo\?\.shirtSize/);

  // Todo valor interpolado nas células passa pelo escape.
  const table = block(exportHandler, /const table = `[\s\S]*?`;/);
  assert.ok(table, 'a planilha deve ser montada no handler');
  const cellInterpolations = table.match(/<t[hd][^>]*>\$\{[^}]*/g) || [];
  assert.ok(cellInterpolations.length >= 5);
  for (const cell of cellInterpolations) assert.match(cell, /\$\{escapeExcelCell\(/);
});

test('escapeExcelCell neutraliza HTML em nomes, e-mails e textos livres', async () => {
  const source = block(registrationsTab, /const escapeExcelCell = \(value: unknown\) => String\(value \?\? ''\)[\s\S]*?;\n/);
  assert.ok(source, 'escapeExcelCell deve existir');
  const compiled = ts.transpileModule(`export ${source}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const { escapeExcelCell } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

  assert.equal(
    escapeExcelCell('<img src=x onerror="alert(1)"> & O\'Neil'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; O&#39;Neil'
  );
  assert.equal(escapeExcelCell(0), '0');
  assert.equal(escapeExcelCell(null), '');
  assert.equal(escapeExcelCell(undefined), '');
});

// Editar inscrição e voucher: getRegistrationAthlete usa o mesmo resolvedor da
// lista, do resumo e da planilha. Antes buscava só por nome + categoria e, com o
// nome da inscrição editado, perdia o atleta (e a camisa).

const getRegistrationAthleteSource = block(
  admin,
  /const getRegistrationAthlete = \(registration: Registration\): Athlete => \{[\s\S]*?\n {2}\};/
);

const loadGetRegistrationAthlete = async (athletes) => {
  const compiled = ts.transpileModule(
    `export const create = (resolveRegistrationAthleteRecord) => {\n${getRegistrationAthleteSource}\nreturn getRegistrationAthlete;\n};`,
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const { create } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  return create(createRegistrationAthleteResolver(athletes));
};

test('getRegistrationAthlete reutiliza o resolvedor de shirtSummary.ts, sem busca própria', () => {
  assert.ok(getRegistrationAthleteSource, 'getRegistrationAthlete deve existir');
  assert.match(
    admin,
    /const resolveRegistrationAthleteRecord = useMemo\(\s*\(\) => createRegistrationAthleteResolver\(athletes\),\s*\[athletes\]\s*\);/
  );
  assert.match(getRegistrationAthleteSource, /const athlete = resolveRegistrationAthleteRecord\(registration\);/);
  assert.doesNotMatch(getRegistrationAthleteSource, /athletes\.find\(|toLowerCase\(/);

  // Editar inscrição e os dois vouchers do painel passam pelo helper.
  assert.match(admin, /const handleOpenEditRegistration = \(registration: Registration\) => \{\n\s*const athlete = getRegistrationAthlete\(registration\);/);
  assert.match(admin, /const handleOpenRegistrationVoucher = \(registration: Registration\) => \{[\s\S]*?athlete: getRegistrationAthlete\(registration\),/);
  assert.match(admin, /const handleOpenAthleteVoucher = \(registration: Registration\) => \{[\s\S]*?athlete: getRegistrationAthlete\(registration\),/);
});

test('getRegistrationAthlete: athleteId mesmo com o nome editado; depois nome + categoria; senão o substituto', async () => {
  const ironBox = { ...team('t1', 'Iron Box', 'team', members('P', SHIRT_NONE)), instagram: 'ironbox' };
  const anaRx = individual('a1', 'Ana Souza', 'rx', 'M');
  const anaScale = individual('a2', 'Ana Souza', 'scale', 'GG');
  const getRegistrationAthlete = await loadGetRegistrationAthlete([ironBox, anaRx, anaScale]);

  // 1) athleteId: nome da inscrição editado continua achando o cadastro e as camisas.
  const renamed = { id: 'r1', athleteId: 't1', athleteName: 'Iron Box Nova (Atleta 1 / Atleta 2)', divisionId: 'team' };
  assert.equal(getRegistrationAthlete(renamed), ironBox);
  assert.deepEqual(listRegistrationShirts(renamed, getRegistrationAthlete(renamed)).map(shirt => shirt.size), ['P', SHIRT_NONE]);
  // athleteId tem prioridade sobre um homônimo da mesma categoria.
  assert.equal(getRegistrationAthlete({ id: 'r2', athleteId: 'a1', athleteName: 'Ana Souza', divisionId: 'scale' }), anaRx);

  // 2) Sem athleteId (ou apagado): nome + categoria, sem diferenciar maiúsculas.
  assert.equal(getRegistrationAthlete({ id: 'r3', athleteName: 'ANA SOUZA', divisionId: 'scale' }), anaScale);
  assert.equal(getRegistrationAthlete({ id: 'r4', athleteId: 'apagado', athleteName: 'ana souza', divisionId: 'rx' }), anaRx);

  // 3) Nada encontrado: o mesmo atleta substituto de antes.
  const orphan = {
    id: 'r5',
    athleteId: 'apagado',
    athleteName: 'Outra Pessoa',
    divisionId: 'rx',
    box: '',
    gender: 'F',
    athleteEmail: 'outra@example.com',
    athletePhone: '85999990000'
  };
  assert.deepEqual(getRegistrationAthlete(orphan), {
    id: 'ath-voucher-r5',
    name: 'Outra Pessoa',
    box: 'Independente',
    country: 'BR',
    divisionId: 'rx',
    gender: 'F',
    email: 'outra@example.com',
    phone: '85999990000',
    isTeam: false,
    teamMembers: []
  });
  assert.equal(getRegistrationAthlete({ ...orphan, box: 'CrossFit X' }).box, 'CrossFit X');
});
