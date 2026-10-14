import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHIRT_ADDON_PRICE_MAX,
  SHIRT_NONE,
  SHIRT_SIZES,
  calculateRegistrationAmounts,
  calculateShirtAddonAmount,
  checkRegistrationShirtEdit,
  getDivisionParticipantCount,
  isShirtNone,
  isShirtSize,
  normalizeShirtMode,
  resolveParticipantShirts,
  validateShirtConfig
} from '../src/lib/shirtPricing.ts';

const EDIT_LOCKED = 'Só é possível trocar o tamanho da camisa. Para incluir ou retirar a camisa, cancele e refaça a inscrição.';
const EDIT_BLANK = 'O tamanho da camisa não pode ficar em branco. Escolha um tamanho para cada participante ou mantenha a opção já registrada.';
const INVALID_MEMBERS = { ok: false, error: 'Dados dos integrantes inválidos.' };
const PRICE_TOO_HIGH = { ok: false, error: 'O valor adicional da camisa não pode ser maior que 10.000.' };

const members = (...sizes) => sizes.map((shirtSize, index) => ({ name: `Atleta ${index + 1}`, instagram: `atleta${index + 1}`, shirtSize }));

const amounts = (overrides = {}) => calculateRegistrationAmounts({
  ticketPrice: 150,
  quantity: 1,
  discount: 0,
  shirtMode: 'optional',
  shirtAddonPrice: 60,
  shirtAddonCount: 0,
  ...overrides
});

test('constantes da camisa seguem o contrato da story', () => {
  assert.equal(SHIRT_NONE, 'NONE');
  assert.deepEqual([...SHIRT_SIZES], ['P', 'M', 'G', 'GG']);
  assert.equal(SHIRT_ADDON_PRICE_MAX, 10000);
});

test('normalizeShirtMode só aceita optional exato; o resto vira included', () => {
  assert.equal(normalizeShirtMode('optional'), 'optional');
  assert.equal(normalizeShirtMode('included'), 'included');
  for (const value of [undefined, null, '', 'OPTIONAL', ' optional', 'free', 1, true, {}]) {
    assert.equal(normalizeShirtMode(value), 'included', `valor ${String(value)}`);
  }
});

test('isShirtSize e isShirtNone comparam o valor exato', () => {
  for (const size of ['P', 'M', 'G', 'GG']) assert.equal(isShirtSize(size), true);
  for (const value of ['PP', 'XG', 'XXG', 'm', ' M ', '', 'NONE', null, undefined, 1]) {
    assert.equal(isShirtSize(value), false, `valor ${String(value)}`);
  }
  assert.equal(isShirtNone('NONE'), true);
  for (const value of ['none', ' NONE', '', 'M', null]) assert.equal(isShirtNone(value), false);
});

test('getDivisionParticipantCount cobre todos os tipos de categoria', () => {
  assert.equal(getDivisionParticipantCount('individual'), 1);
  assert.equal(getDivisionParticipantCount('duo'), 2);
  assert.equal(getDivisionParticipantCount('trio'), 3);
  assert.equal(getDivisionParticipantCount('team'), 4);
  assert.equal(getDivisionParticipantCount('team4'), 4);
  assert.equal(getDivisionParticipantCount('team6'), 6);
  for (const value of [undefined, null, '', 'TEAM', 'constructor', 'team8']) {
    assert.equal(getDivisionParticipantCount(value), 1, `tipo ${String(value)}`);
  }
});

test('validateShirtConfig: modo opcional exige 0 < valor <= 10.000 e arredonda a 2 casas', () => {
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 60 }), { ok: true, mode: 'optional', price: 60 });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: '60' }), { ok: true, mode: 'optional', price: 60 });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 10000 }), { ok: true, mode: 'optional', price: 10000 });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 0.01 }), { ok: true, mode: 'optional', price: 0.01 });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 59.999 }), { ok: true, mode: 'optional', price: 60 });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 12.344 }), { ok: true, mode: 'optional', price: 12.34 });

  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 0 }), { ok: false, error: 'Informe um valor maior que zero.' });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: undefined }), { ok: false, error: 'Informe um valor maior que zero.' });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: '' }), { ok: false, error: 'Informe um valor maior que zero.' });
  // Arredondado para zero centavo continua sendo zero.
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 0.004 }), { ok: false, error: 'Informe um valor maior que zero.' });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: 10000.01 }), PRICE_TOO_HIGH);
});

test('validateShirtConfig: modo incluso aceita valor de 0 a 10.000 e o guarda', () => {
  assert.deepEqual(validateShirtConfig({ mode: 'included', price: 0 }), { ok: true, mode: 'included', price: 0 });
  assert.deepEqual(validateShirtConfig({ mode: 'included', price: 60 }), { ok: true, mode: 'included', price: 60 });
  assert.deepEqual(validateShirtConfig({ mode: 'included', price: 10000 }), { ok: true, mode: 'included', price: 10000 });
  assert.deepEqual(validateShirtConfig({ mode: 'included', price: null }), { ok: true, mode: 'included', price: 0 });
  // Sem modo informado vale o padrão do banco (included).
  assert.deepEqual(validateShirtConfig({ mode: undefined, price: 40 }), { ok: true, mode: 'included', price: 40 });
});

test('validateShirtConfig: o teto de 10.000 vale nos dois modos (o valor guardado volta no opcional)', () => {
  for (const mode of ['included', 'optional', undefined]) {
    for (const price of [10000.01, '10000.01', 25000, 1e20]) {
      assert.deepEqual(validateShirtConfig({ mode, price }), PRICE_TOO_HIGH, `${String(mode)} com ${String(price)}`);
    }
  }
});

test('validateShirtConfig recusa modo inválido, NaN, Infinity, texto e negativo', () => {
  const invalidPrice = { ok: false, error: 'Informe um valor adicional válido para a camisa.' };
  for (const mode of ['optional', 'included']) {
    for (const price of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'abc', '60,00', '1e3', true, {}, []]) {
      assert.deepEqual(validateShirtConfig({ mode, price }), invalidPrice, `${mode} com ${String(price)}`);
    }
    assert.deepEqual(
      validateShirtConfig({ mode, price: -1 }),
      { ok: false, error: 'O valor adicional da camisa não pode ser negativo.' }
    );
    assert.deepEqual(
      validateShirtConfig({ mode, price: '-0.5' }),
      { ok: false, error: 'O valor adicional da camisa não pode ser negativo.' }
    );
  }
  for (const mode of ['OPTIONAL', 'free', '', 1, true]) {
    assert.deepEqual(validateShirtConfig({ mode, price: 60 }), { ok: false, error: 'Modo de camisa inválido.' });
  }
});

test('resolveParticipantShirts individual: modo opcional exige tamanho ou NONE', () => {
  const base = { mode: 'optional', divisionType: 'individual' };
  assert.deepEqual(resolveParticipantShirts({ ...base, athleteProfile: { shirtSize: 'M' } }), {
    ok: true, sizes: ['M'], addonCount: 1, shirtSize: 'M', teamMembers: []
  });
  assert.deepEqual(resolveParticipantShirts({ ...base, athleteProfile: { shirtSize: 'NONE' } }), {
    ok: true, sizes: ['NONE'], addonCount: 0, shirtSize: 'NONE', teamMembers: []
  });
  for (const shirtSize of ['', '   ', undefined, null]) {
    assert.deepEqual(
      resolveParticipantShirts({ ...base, athleteProfile: { shirtSize } }),
      { ok: false, error: 'Escolha o tamanho da camisa ou "Sem camisa".' }
    );
  }
  assert.deepEqual(
    resolveParticipantShirts({ ...base, athleteProfile: { shirtSize: 'XG' } }),
    { ok: false, error: 'Tamanho de camisa inválido. Escolha P, M, G, GG ou "Sem camisa".' }
  );
  // Sem perfil algum (ex.: navegador adulterado) também é recusado.
  assert.equal(resolveParticipantShirts({ ...base, athleteProfile: undefined }).ok, false);
});

test('resolveParticipantShirts individual: modo incluso recusa NONE e aceita vazio', () => {
  const base = { mode: 'included', divisionType: 'individual' };
  assert.deepEqual(resolveParticipantShirts({ ...base, athleteProfile: { shirtSize: 'GG' } }), {
    ok: true, sizes: ['GG'], addonCount: 0, shirtSize: 'GG', teamMembers: []
  });
  assert.deepEqual(resolveParticipantShirts({ ...base, athleteProfile: {} }), {
    ok: true, sizes: [''], addonCount: 0, shirtSize: '', teamMembers: []
  });
  assert.deepEqual(
    resolveParticipantShirts({ ...base, athleteProfile: { shirtSize: 'NONE' } }),
    { ok: false, error: 'Este evento já inclui a camisa no valor da inscrição. Escolha um tamanho (P, M, G ou GG).' }
  );
  assert.deepEqual(
    resolveParticipantShirts({ ...base, athleteProfile: { shirtSize: 'XXG' } }),
    { ok: false, error: 'Tamanho de camisa inválido. Escolha P, M, G ou GG.' }
  );
  // Categoria individual não grava integrantes, mesmo que o navegador envie.
  const withMembers = resolveParticipantShirts({ ...base, athleteProfile: { shirtSize: 'M', teamMembers: members('NONE') } });
  assert.equal(withMembers.ok, true);
  assert.deepEqual(withMembers.teamMembers, []);
});

test('tamanhos: espaços nas pontas são removidos, maiúsculas não são corrigidas', () => {
  const trimmed = resolveParticipantShirts({ mode: 'optional', divisionType: 'individual', athleteProfile: { shirtSize: ' M ' } });
  assert.deepEqual(trimmed, { ok: true, sizes: ['M'], addonCount: 1, shirtSize: 'M', teamMembers: [] });
  for (const shirtSize of ['m', 'gg', 'none', 'None']) {
    assert.equal(
      resolveParticipantShirts({ mode: 'optional', divisionType: 'individual', athleteProfile: { shirtSize } }).ok,
      false,
      `tamanho ${shirtSize}`
    );
  }
});

test('resolveParticipantShirts em equipes cobra por integrante com camisa', () => {
  const cases = [
    ['duo', ['M', 'NONE'], 1],
    ['trio', ['P', 'G', 'GG'], 3],
    ['team', ['NONE', 'NONE', 'NONE', 'NONE'], 0],
    ['team4', ['P', 'NONE', 'G', 'NONE'], 2],
    ['team6', ['P', 'M', 'G', 'GG', 'NONE', 'M'], 5]
  ];
  for (const [divisionType, sizes, addonCount] of cases) {
    const result = resolveParticipantShirts({
      mode: 'optional',
      divisionType,
      athleteProfile: { shirtSize: 'GG', teamMembers: members(...sizes) }
    });
    assert.equal(result.ok, true, divisionType);
    assert.deepEqual(result.sizes, sizes, divisionType);
    assert.equal(result.addonCount, addonCount, divisionType);
    // O campo principal espelha o primeiro integrante, não o valor enviado.
    assert.equal(result.shirtSize, sizes[0], divisionType);
    assert.deepEqual(result.teamMembers, members(...sizes), divisionType);
  }
});

test('resolveParticipantShirts em equipe opcional exige a quantidade exata e a escolha de todos', () => {
  const duo = (teamMembers) => resolveParticipantShirts({ mode: 'optional', divisionType: 'duo', athleteProfile: { teamMembers } });
  assert.deepEqual(duo(members('M')), { ok: false, error: 'Informe a camisa de cada um dos 2 integrantes da equipe.' });
  assert.deepEqual(duo(members('M', 'G', 'P')), { ok: false, error: 'Informe a camisa de cada um dos 2 integrantes da equipe.' });
  assert.deepEqual(duo(undefined), { ok: false, error: 'Informe a camisa de cada um dos 2 integrantes da equipe.' });
  assert.deepEqual(duo('não é json'), { ok: false, error: 'Informe a camisa de cada um dos 2 integrantes da equipe.' });
  assert.deepEqual(duo(members('M', '')), { ok: false, error: 'Escolha o tamanho da camisa ou "Sem camisa" para o atleta 2.' });
  assert.deepEqual(
    duo(members('XG', 'M')),
    { ok: false, error: 'Tamanho de camisa inválido para o atleta 1. Escolha P, M, G, GG ou "Sem camisa".' }
  );
});

test('resolveParticipantShirts recusa integrante que não é objeto nos dois modos', () => {
  const valid = { name: 'B', shirtSize: 'M' };
  for (const mode of ['optional', 'included']) {
    for (const invalid of [null, 42, 'texto', ['M'], true]) {
      assert.deepEqual(
        resolveParticipantShirts({ mode, divisionType: 'duo', athleteProfile: { shirtSize: 'M', teamMembers: [invalid, valid] } }),
        INVALID_MEMBERS,
        `${mode} com ${JSON.stringify(invalid)}`
      );
    }
    // Também quando os integrantes chegam como JSON (Bilheteria antiga).
    assert.deepEqual(
      resolveParticipantShirts({ mode, divisionType: 'duo', athleteProfile: { shirtSize: 'M', teamMembers: JSON.stringify([valid, null]) } }),
      INVALID_MEMBERS,
      `${mode} com JSON`
    );
  }
  // Categoria individual descarta os integrantes enviados, então não recusa.
  assert.equal(
    resolveParticipantShirts({ mode: 'included', divisionType: 'individual', athleteProfile: { shirtSize: 'M', teamMembers: [null] } }).ok,
    true
  );
});

test('resolveParticipantShirts aceita integrantes em JSON e preserva os demais campos', () => {
  const teamMembers = JSON.stringify([
    { name: 'Ana', instagram: 'ana', shirtSize: ' P ' },
    { name: 'Bia', instagram: 'bia', shirtSize: 'NONE', extra: 1 }
  ]);
  assert.deepEqual(
    resolveParticipantShirts({ mode: 'optional', divisionType: 'duo', athleteProfile: { teamMembers } }),
    {
      ok: true,
      sizes: ['P', 'NONE'],
      addonCount: 1,
      shirtSize: 'P',
      teamMembers: [
        { name: 'Ana', instagram: 'ana', shirtSize: 'P' },
        { name: 'Bia', instagram: 'bia', shirtSize: 'NONE', extra: 1 }
      ]
    }
  );
});

test('resolveParticipantShirts em equipe inclusa: NONE recusado, vazio aceito e quantidade livre', () => {
  const included = (athleteProfile) => resolveParticipantShirts({ mode: 'included', divisionType: 'team4', athleteProfile });
  assert.deepEqual(
    included({ teamMembers: members('M', 'NONE') }),
    { ok: false, error: 'Este evento já inclui a camisa no valor da inscrição. Escolha um tamanho (P, M, G ou GG) para o atleta 2.' }
  );
  assert.deepEqual(
    included({ shirtSize: 'NONE', teamMembers: members('M') }),
    { ok: false, error: 'Este evento já inclui a camisa no valor da inscrição. Escolha um tamanho (P, M, G ou GG) para o responsável pela inscrição.' }
  );
  assert.deepEqual(
    included({ teamMembers: members('M', 'm') }),
    { ok: false, error: 'Tamanho de camisa inválido para o atleta 2. Escolha P, M, G ou GG.' }
  );

  const partial = included({ shirtSize: 'G', teamMembers: members('', 'M') });
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.sizes, ['', 'M']);
  assert.equal(partial.addonCount, 0);
  // Bilheteria antiga: o tamanho do responsável segue como reserva do primeiro integrante.
  assert.equal(partial.shirtSize, 'G');

  const empty = included({});
  assert.deepEqual(empty, { ok: true, sizes: [], addonCount: 0, shirtSize: '', teamMembers: [] });
});

test('calculateShirtAddonAmount soma em centavos só no modo opcional', () => {
  assert.equal(calculateShirtAddonAmount('optional', 60, 3), 180);
  assert.equal(calculateShirtAddonAmount('optional', 33.33, 3), 99.99);
  assert.equal(calculateShirtAddonAmount('optional', 0.1, 3), 0.3);
  assert.equal(calculateShirtAddonAmount('optional', 60, 0), 0);
  assert.equal(calculateShirtAddonAmount('optional', 60, -2), 0);
  assert.equal(calculateShirtAddonAmount('optional', 60, 2.9), 120);
  assert.equal(calculateShirtAddonAmount('included', 60, 3), 0);
  assert.equal(calculateShirtAddonAmount(undefined, 60, 3), 0);
});

test('calculateRegistrationAmounts: inscrição + camisa, com cupom só na inscrição (D1)', () => {
  assert.deepEqual(amounts({ shirtAddonCount: 1 }), { subtotal: 150, discount: 0, shirtAddonAmount: 60, totalPaid: 210 });
  // Cupom de 20% sobre R$ 150 desconta 30 da inscrição; a camisa segue cheia.
  assert.deepEqual(amounts({ discount: 30, shirtAddonCount: 1 }), { subtotal: 150, discount: 30, shirtAddonAmount: 60, totalPaid: 180 });
  // Convite de 100% com camisa: paga só o adicional.
  assert.deepEqual(amounts({ discount: 150, shirtAddonCount: 1 }), { subtotal: 150, discount: 150, shirtAddonAmount: 60, totalPaid: 60 });
  // Convite de 100% e "Sem camisa": inscrição gratuita.
  assert.deepEqual(amounts({ discount: 150, shirtAddonCount: 0 }), { subtotal: 150, discount: 150, shirtAddonAmount: 0, totalPaid: 0 });
});

test('calculateRegistrationAmounts: desconto maior que a inscrição nunca come a camisa', () => {
  assert.deepEqual(amounts({ discount: 500, shirtAddonCount: 2 }), { subtotal: 150, discount: 150, shirtAddonAmount: 120, totalPaid: 120 });
  assert.deepEqual(amounts({ discount: 500, shirtAddonCount: 0 }), { subtotal: 150, discount: 150, shirtAddonAmount: 0, totalPaid: 0 });
});

test('calculateRegistrationAmounts: mínimo de 1,00 quando 0 < total < 1; zero continua zero', () => {
  assert.deepEqual(amounts({ discount: 149.5 }), { subtotal: 150, discount: 149.5, shirtAddonAmount: 0, totalPaid: 1 });
  assert.deepEqual(amounts({ discount: 150, shirtAddonPrice: 0.5, shirtAddonCount: 1 }), { subtotal: 150, discount: 150, shirtAddonAmount: 0.5, totalPaid: 1 });
  assert.deepEqual(amounts({ discount: 149.01 }), { subtotal: 150, discount: 149.01, shirtAddonAmount: 0, totalPaid: 1 });
  assert.deepEqual(amounts({ discount: 149 }), { subtotal: 150, discount: 149, shirtAddonAmount: 0, totalPaid: 1 });
  assert.deepEqual(amounts({ ticketPrice: 0 }), { subtotal: 0, discount: 0, shirtAddonAmount: 0, totalPaid: 0 });
});

test('calculateRegistrationAmounts: centavos sem erro de ponto flutuante e quantidade > 1', () => {
  assert.deepEqual(
    amounts({ ticketPrice: 33.33, quantity: 3, shirtAddonPrice: 33.33, shirtAddonCount: 3 }),
    { subtotal: 99.99, discount: 0, shirtAddonAmount: 99.99, totalPaid: 199.98 }
  );
  assert.deepEqual(
    amounts({ ticketPrice: 0.1, quantity: 3, shirtAddonPrice: 0.2, shirtAddonCount: 1 }),
    { subtotal: 0.3, discount: 0, shirtAddonAmount: 0.2, totalPaid: 1 }
  );
  assert.deepEqual(
    amounts({ ticketPrice: 99.9, discount: 12.4875, shirtAddonCount: 1 }),
    { subtotal: 99.9, discount: 12.49, shirtAddonAmount: 60, totalPaid: 147.41 }
  );
  assert.deepEqual(amounts({ quantity: 2, shirtAddonCount: 2 }), { subtotal: 300, discount: 0, shirtAddonAmount: 120, totalPaid: 420 });
  // Quantidade inválida vale 1, como no servidor.
  assert.deepEqual(amounts({ quantity: 0 }), amounts({ quantity: 1 }));
  assert.deepEqual(amounts({ quantity: Number.NaN }), amounts({ quantity: 1 }));
});

test('calculateRegistrationAmounts: modo incluso ignora adicional e contagem', () => {
  assert.deepEqual(
    amounts({ shirtMode: 'included', shirtAddonPrice: 60, shirtAddonCount: 4 }),
    { subtotal: 150, discount: 0, shirtAddonAmount: 0, totalPaid: 150 }
  );
  assert.deepEqual(
    amounts({ shirtMode: 'qualquer', shirtAddonPrice: 60, shirtAddonCount: 4 }),
    { subtotal: 150, discount: 0, shirtAddonAmount: 0, totalPaid: 150 }
  );
});

test('a conta da inscrição fecha: ticket × quantidade − desconto + adicional = total', () => {
  const ticketPrice = 129.9;
  const discount = 25.98;
  const result = amounts({ ticketPrice, discount, shirtAddonPrice: 59.9, shirtAddonCount: 3 });
  assert.equal(Math.round(ticketPrice * 100) - Math.round(discount * 100) + Math.round(result.shirtAddonAmount * 100), Math.round(result.totalPaid * 100));
  assert.deepEqual(result, { subtotal: 129.9, discount: 25.98, shirtAddonAmount: 179.7, totalPaid: 283.62 });
});

test('checkRegistrationShirtEdit: troca de tamanho é livre, com ↔ sem camisa é 409 (D4)', () => {
  const individual = (shirtSize) => ({ isTeam: false, shirtSize, teamMembers: '[]' });
  assert.deepEqual(checkRegistrationShirtEdit(individual('M'), individual('G')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit(individual('NONE'), individual('NONE')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit(individual('M'), individual('NONE')), { ok: false, status: 409, error: EDIT_LOCKED });
  assert.deepEqual(checkRegistrationShirtEdit(individual('NONE'), individual('M')), { ok: false, status: 409, error: EDIT_LOCKED });
  // Inscrição sem atleta vinculado: "Sem camisa" não pode ser incluído.
  assert.deepEqual(checkRegistrationShirtEdit({}, individual('NONE')), { ok: false, status: 409, error: EDIT_LOCKED });
});

test('checkRegistrationShirtEdit: tamanho registrado não pode ficar em branco (409), em qualquer modo', () => {
  const blank = { ok: false, status: 409, error: EDIT_BLANK };
  const individual = (shirtSize) => ({ isTeam: false, shirtSize, teamMembers: '[]' });
  const team = (shirtSize, ...sizes) => ({ isTeam: true, shirtSize, teamMembers: members(...sizes) });

  // Camisa paga (ou inclusa) que perderia o tamanho: a RPC gravaria NULL.
  assert.deepEqual(checkRegistrationShirtEdit(individual('M'), individual('')), blank);
  assert.deepEqual(checkRegistrationShirtEdit(individual('M'), { isTeam: false }), blank);
  assert.deepEqual(checkRegistrationShirtEdit(individual('NONE'), individual('')), blank);
  // Equipe: integrante com "Sem camisa" ou com tamanho não pode ficar em branco.
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', 'NONE'), team('M', 'M', '')), blank);
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', 'G'), team('M', '', 'G')), blank);
  // O campo principal da equipe é a reserva do 1º integrante no resumo de produção.
  assert.deepEqual(checkRegistrationShirtEdit(team('G', '', 'M'), team('', '', 'M')), blank);
  // Relocação para equipe com integrante novo sem tamanho.
  assert.deepEqual(checkRegistrationShirtEdit(individual('M'), team('M', 'M', '')), blank);

  // Cadastro antigo já em branco continua editável (nome, e-mail, telefone).
  assert.deepEqual(checkRegistrationShirtEdit(individual(''), individual('')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit(individual(null), individual('')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit(team('', '', 'M'), team('', '', 'G')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit({}, individual('')), { ok: true });
  // Troca de tamanho e edição que não mexe na camisa seguem livres.
  assert.deepEqual(checkRegistrationShirtEdit(individual('M'), individual('G')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit(individual('M'), individual('M')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', 'NONE'), team('M', 'M', 'NONE')), { ok: true });
  // Preencher um tamanho que estava em branco reduz os vazios e é aceito.
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', ''), team('M', 'M', 'G')), { ok: true });
});

test('checkRegistrationShirtEdit em equipes compara a quantidade de integrantes sem camisa', () => {
  const team = (shirtSize, ...sizes) => ({ isTeam: true, shirtSize, teamMembers: JSON.stringify(members(...sizes)) });
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', 'NONE'), team('M', 'G', 'NONE')), { ok: true });
  // Troca de quem fica sem camisa mantém a quantidade e o valor devido.
  assert.deepEqual(checkRegistrationShirtEdit(team('NONE', 'NONE', 'M'), team('M', 'M', 'NONE')), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', 'NONE'), team('M', 'M', 'G')), { ok: false, status: 409, error: EDIT_LOCKED });
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', 'G'), team('M', 'M', 'NONE')), { ok: false, status: 409, error: EDIT_LOCKED });
  // O campo principal da equipe não pode introduzir "Sem camisa".
  assert.deepEqual(checkRegistrationShirtEdit(team('M', 'M', 'G'), team('NONE', 'M', 'G')), { ok: false, status: 409, error: EDIT_LOCKED });
  // Relocação para individual leva o campo principal como único participante.
  assert.deepEqual(
    checkRegistrationShirtEdit(team('M', 'M', 'NONE'), { isTeam: false, shirtSize: 'M', teamMembers: [] }),
    { ok: false, status: 409, error: EDIT_LOCKED }
  );
  assert.deepEqual(
    checkRegistrationShirtEdit(team('M', 'M', 'G'), { isTeam: false, shirtSize: 'G', teamMembers: [] }),
    { ok: true }
  );
});

test('checkRegistrationShirtEdit recusa tamanho inválido com 400, mas tolera valor legado inalterado', () => {
  const invalid = { ok: false, status: 400, error: 'Tamanho de camisa inválido. Escolha P, M, G ou GG.' };
  assert.deepEqual(checkRegistrationShirtEdit({ shirtSize: 'M' }, { shirtSize: 'XL' }), invalid);
  assert.deepEqual(checkRegistrationShirtEdit({ shirtSize: 'M' }, { shirtSize: 'm' }), invalid);
  assert.deepEqual(
    checkRegistrationShirtEdit(
      { isTeam: true, teamMembers: members('M', 'G') },
      { isTeam: true, teamMembers: members('M', 'XGG') }
    ),
    invalid
  );
  // Tamanho anterior à lista atual (ex.: XG) não trava a correção de nome ou e-mail.
  assert.deepEqual(checkRegistrationShirtEdit({ shirtSize: 'XG' }, { shirtSize: 'XG' }), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit({ shirtSize: 'XG' }, { shirtSize: 'M' }), { ok: true });
  assert.deepEqual(checkRegistrationShirtEdit({ shirtSize: 'M' }, { shirtSize: 'XG' }), invalid);
});
