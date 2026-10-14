import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import {
  SHIRT_NONE,
  calculateRegistrationAmounts,
  checkRegistrationShirtEdit,
  getDivisionParticipantCount,
  isShirtSize,
  validateShirtConfig
} from '../src/lib/shirtPricing.ts';

// Regressão estática da Story 1.38, painel do gestor (parte 1): cartão "Camisa
// do evento", lista de categorias, Bilheteria e Editar inscrição.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const admin = read('../src/app/admin/page.tsx');
const shirtSettings = read('../src/components/admin/EventShirtSettings.tsx');

const block = (source, pattern) => source.match(pattern)?.[0] || '';
const handler = (name) => block(admin, new RegExp(`const ${name} = (?:async )?\\([^)]*\\) => \\{[\\s\\S]*?\\n {2}\\};`));

const createEventBlock = handler('handleCreateEvent');
const updateEventBlock = handler('handleUpdateEventInfo');
const bilheteriaSaleBlock = handler('getBilheteriaSale');
const bilheteriaSubmitBlock = handler('handleBilheteriaSubmit');
const resetBilheteriaBlock = handler('resetBilheteriaForm');
const openEditRegistrationBlock = handler('handleOpenEditRegistration');
const saveEditRegistrationBlock = handler('handleSaveRegistrationEdit');
const newEventCard = block(admin, /<EventShirtSettings\s+idPrefix="new-event"[\s\S]*?\/>/);
const editEventCard = block(admin, /<EventShirtSettings\s+idPrefix="edit-event"[\s\S]*?\/>/);
const bilheteriaShirtOptions = block(admin, /const renderShirtOptions = \(\) => \([\s\S]*?\n {14}\);/);
const editShirtOptions = block(admin, /const renderEditShirtOptions = \(initialShirt: string\) => \([\s\S]*?\n {14}\);/);
const editModal = block(admin, /\{editingRegistration && \([\s\S]*?\{selectedRegistrationVoucher && \(/);

test('o cartão "Camisa do evento" é um componente usado nos formulários de novo e de editar evento', () => {
  assert.match(shirtSettings, /export function EventShirtSettings\(/);
  // O cartão recebe tudo por props; não lê o contexto.
  assert.doesNotMatch(shirtSettings, /useApp|@\/context\//);
  assert.match(admin, /import \{[\s\S]*EventShirtSettings,[\s\S]*\} from '@\/components\/admin\/EventShirtSettings'/);
  assert.equal(admin.match(/<EventShirtSettings\b/g)?.length, 2);

  assert.ok(newEventCard, 'o formulário de novo evento deve ter o cartão');
  assert.match(newEventCard, /mode=\{eventShirtMode\}/);
  assert.match(newEventCard, /price=\{eventShirtAddonPrice\}/);
  // Novo evento ainda não tem categorias nem inscrições.
  assert.doesNotMatch(newEventCard, /divisions=|existingRegistrations=/);

  assert.ok(editEventCard, 'o formulário de editar evento deve ter o cartão');
  assert.match(editEventCard, /mode=\{editEventShirtMode\}/);
  assert.match(editEventCard, /currency=\{selectedEventToManage\.currency\}/);
  assert.match(editEventCard, /divisions=\{selectedEventToManage\.divisions\}/);
  assert.match(editEventCard, /existingRegistrations=\{registrations\.filter\([\s\S]*r\.paymentStatus !== 'payment_cancelled'[\s\S]*\)\.length\}/);

  // Padrão "inclusa", adicional vazio e restauração ao abrir a edição.
  assert.match(admin, /const \[eventShirtMode, setEventShirtMode\] = useState<ShirtMode>\('included'\)/);
  assert.match(admin, /const \[eventShirtAddonPrice, setEventShirtAddonPrice\] = useState\(''\)/);
  assert.match(admin, /setEditEventShirtMode\(normalizeShirtMode\(evt\.shirtMode\)\)/);
  assert.match(admin, /setEditEventShirtAddonPrice\(toShirtPriceInput\(evt\.shirtAddonPrice\)\)/);
});

test('o cartão mostra os dois modos, o adicional com erro acessível e os avisos aprovados', () => {
  assert.match(shirtSettings, /role="radiogroup" aria-labelledby=\{titleId\}/);
  assert.match(shirtSettings, /type="radio"/);
  assert.match(shirtSettings, /htmlFor=\{inputId\}/);
  assert.match(shirtSettings, /Camisa inclusa no valor/);
  assert.match(shirtSettings, /Camisa opcional com adicional/);
  assert.match(shirtSettings, /Defina se a camisa já vem no valor da inscrição ou se é um adicional\./);
  assert.match(shirtSettings, /Valor adicional da camisa \(\{getCurrencySymbol\(currency\)\}\)/);
  assert.match(shirtSettings, /placeholder="Ex: 60"/);
  assert.match(shirtSettings, /disabled=\{!isOptional\}/);
  assert.match(shirtSettings, /aria-invalid=\{Boolean\(priceError\)\}/);
  assert.match(shirtSettings, /aria-describedby=\{priceError \? `\$\{priceErrorId\} \$\{priceHintId\}` : priceHintId\}/);
  // O erro do campo vem da mesma validação do servidor.
  assert.match(shirtSettings, /const config = validateShirtConfig\(\{ mode, price \}\)/);
  assert.match(shirtSettings, /Cobrado por atleta que escolher camisa\. Em duplas e equipes, cada integrante escolhe e paga o próprio adicional\./);
  assert.match(shirtSettings, /Como o atleta verá os valores/);
  assert.match(shirtSettings, /A alteração vale só para novas inscrições\./);
  assert.match(shirtSettings, /A taxa de serviço da plataforma incide sobre o total pago, incluindo a camisa\./);
  // O percentual da taxa varia por configuração: nunca fixo no texto.
  assert.doesNotMatch(shirtSettings, /\d+\s*%/);
  assert.doesNotMatch(admin, /10%/);
  // O selo "Novo" é só do protótipo.
  assert.doesNotMatch(shirtSettings, />Novo</);
});

test('salvar o evento bloqueia adicional inválido em camisa opcional e envia modo e valor', () => {
  assert.match(shirtSettings, /export const resolveShirtSettingsForSave = \(/);
  assert.match(shirtSettings, /if \(mode === 'included'\) return \{ ok: true, mode, price: savedPrice \}/);

  for (const [name, source, persist] of [
    ['handleCreateEvent', createEventBlock, 'await addEvent('],
    ['handleUpdateEventInfo', updateEventBlock, 'await updateEvent(']
  ]) {
    assert.ok(source, `${name} deve existir`);
    const guardIndex = source.indexOf('if (!shirtSettings.ok)');
    assert.ok(guardIndex > 0, `${name} deve validar a camisa`);
    assert.ok(guardIndex < source.indexOf(persist), `${name} deve validar antes de persistir`);
    assert.match(source, /if \(!shirtSettings\.ok\) \{[\s\S]*?setAdminNotice\(\{ text: `Revise a camisa do evento: \$\{shirtSettings\.error\}`, tone: 'error' \}\);[\s\S]*?\.focus\(\);\s*return;/);
    assert.match(source, /shirtMode: shirtSettings\.mode,\s*shirtAddonPrice: shirtSettings\.price/);
    // Erro 400 do servidor vira aviso com a mensagem recebida.
    assert.match(source, /err instanceof Error && err\.message/);
  }

  assert.match(createEventBlock, /resolveShirtSettingsForSave\(eventShirtMode, eventShirtAddonPrice\)/);
  // Na edição, um valor inválido no campo desabilitado volta ao último salvo.
  assert.match(updateEventBlock, /resolveShirtSettingsForSave\(\s*editEventShirtMode,\s*editEventShirtAddonPrice,\s*selectedEventToManage\.shirtAddonPrice \?\? 0\s*\)/);

  // A regra compartilhada recusa adicional ausente, zero ou negativo no modo opcional
  // e preserva o adicional no modo incluso.
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: '' }), { ok: false, error: 'Informe um valor maior que zero.' });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: '0' }), { ok: false, error: 'Informe um valor maior que zero.' });
  assert.equal(validateShirtConfig({ mode: 'optional', price: '-5' }).ok, false);
  assert.deepEqual(validateShirtConfig({ mode: 'included', price: '60' }), { ok: true, mode: 'included', price: 60 });
  assert.deepEqual(validateShirtConfig({ mode: 'optional', price: '59.999' }), { ok: true, mode: 'optional', price: 60 });
});

test('prévia e lista de categorias usam a conta do servidor, com todos os integrantes', () => {
  assert.match(shirtSettings, /export const getDivisionShirtPrices = /);
  assert.match(shirtSettings, /calculateRegistrationAmounts\(\{[\s\S]*shirtMode: 'optional',[\s\S]*shirtAddonCount[\s\S]*\}\)\.totalPaid/);
  assert.match(shirtSettings, /withShirt: totalFor\(getDivisionParticipantCount\(division\.type\)\)/);
  assert.match(shirtSettings, /Sem camisa<\/th>/);
  assert.match(shirtSettings, /Com camisa<\/th>/);
  assert.match(shirtSettings, /Valor \(camisa inclusa\)<\/th>/);

  // Equipe de 6 a R$ 150 com adicional de R$ 60: 150 + 6 × 60.
  const withShirt = calculateRegistrationAmounts({
    ticketPrice: 150,
    quantity: 1,
    discount: 0,
    shirtMode: 'optional',
    shirtAddonPrice: 60,
    shirtAddonCount: getDivisionParticipantCount('team6')
  });
  assert.equal(withShirt.totalPaid, 510);

  assert.match(admin, /const isShirtOptional = normalizeShirtMode\(selectedEventToManage\?\.shirtMode\) === 'optional'/);
  assert.match(admin, /const shirtPrices = getDivisionShirtPrices\(div, shirtAddonPrice\)/);
  assert.match(admin, /sem camisa \{formatEventMoney\(shirtPrices\.withoutShirt, eventCurrency\)\}/);
  assert.match(admin, /com camisa \{formatEventMoney\(shirtPrices\.withShirt, eventCurrency\)\}/);
  assert.match(admin, /Valor sem camisa\. O adicional da camisa é configurado no evento\./);
});

test('Bilheteria: "Sem camisa" só em opcional, escolha obrigatória e total pela regra do servidor', () => {
  assert.ok(bilheteriaSaleBlock, 'getBilheteriaSale deve existir');
  assert.match(bilheteriaSaleBlock, /const shirtMode = normalizeShirtMode\(selectedEventToManage\?\.shirtMode\)/);
  assert.match(bilheteriaSaleBlock, /participantShirts\.filter\(isShirtSize\)\.length/);
  assert.match(bilheteriaSaleBlock, /calculateRegistrationAmounts\(\{[\s\S]*discount: bilDiscountApplied,[\s\S]*shirtAddonCount[\s\S]*\}\)/);

  assert.ok(bilheteriaShirtOptions, 'a Bilheteria deve montar as opções de camisa');
  assert.match(bilheteriaShirtOptions, /\{isShirtOptional && <option value=\{SHIRT_NONE\}>Sem camisa \(sem adicional\)<\/option>\}/);
  assert.match(bilheteriaShirtOptions, /\$\{size\} \(\+ \$\{formatEventMoney\(sale\.shirtAddonPrice, eventCurrency\)\}\)/);
  assert.match(admin, /id="bil-shirt-size"[\s\S]*?\{renderShirtOptions\(\)\}/);
  assert.match(admin, /id=\{`bil-member-shirt-\$\{idx\}`\}[\s\S]*?\{renderShirtOptions\(\)\}/);
  assert.equal(SHIRT_NONE, 'NONE');

  // Escolha obrigatória no modo opcional, individual e por integrante.
  assert.match(bilheteriaSubmitBlock, /if \(sale\.shirtMode === 'optional'\) \{[\s\S]*findIndex\(size => !size\)[\s\S]*setAdminNotice\([\s\S]*integrante \$\{missingShirtIndex \+ 1\}[\s\S]*return;/);
  assert.match(bilheteriaSubmitBlock, /teamMembers: teamMembersPayload/);
  // O aviso de sucesso usa o total calculado pelo servidor.
  assert.match(bilheteriaSubmitBlock, /createdRegistration\.totalPaid > 0/);
  assert.match(bilheteriaSubmitBlock, /error instanceof Error \? error\.message/);

  // Resumo: inscrição, camisas, cupom e total a receber.
  assert.match(admin, /Resumo da venda/);
  assert.match(admin, /formatEventMoney\(sale\.amounts\.shirtAddonAmount, eventCurrency\)/);
  assert.match(admin, /-\{formatEventMoney\(sale\.amounts\.discount, eventCurrency\)\}/);
  assert.match(admin, /Total a receber/);
  assert.match(admin, /sale\.amounts\.totalPaid === 0 \?/);
  assert.doesNotMatch(admin, /bilFinalPrice/);
});

test('Bilheteria reserva posição para os 6 integrantes de team6', () => {
  assert.match(admin, /const MAX_TEAM_MEMBERS = getDivisionParticipantCount\('team6'\)/);
  assert.equal(getDivisionParticipantCount('team6'), 6);
  assert.match(admin, /useState<TeamMemberDraft\[\]>\(createEmptyTeamMembers\)/);
  assert.match(resetBilheteriaBlock, /setBilTeamMembers\(createEmptyTeamMembers\(\)\)/);
  assert.match(bilheteriaSubmitBlock, /const numIntegrantes = getDivisionParticipantCount\(div\.type\)/);
  assert.match(admin, /Array\.from\(\{ length: getDivisionParticipantCount\(selectedCat\.type\) \}\)/);
});

test('Editar inscrição troca só o tamanho: "Sem camisa" bloqueado e nunca oferecido', () => {
  assert.ok(editShirtOptions, 'o modal deve montar as opções de camisa');
  assert.doesNotMatch(editShirtOptions, /SHIRT_NONE|Sem camisa/);
  // O tamanho legado gravado continua como opção.
  assert.match(editShirtOptions, /initialShirt && !isShirtSize\(initialShirt\) && <option value=\{initialShirt\}>/);
  assert.match(editModal, /normalizeShirtMode\(selectedEventToManage\?\.shirtMode\) === 'optional'\s*\|\| \(editingRegistration\.shirtAddonAmount \?\? 0\) > 0/);

  // Quem escolheu "Sem camisa" vê o campo desabilitado, com explicação.
  assert.match(editModal, /id="edit-reg-shirt"\s*value=\{SHIRT_NONE\}\s*disabled/);
  assert.match(editModal, /id=\{`edit-member-shirt-\$\{idx\}`\}\s*value=\{SHIRT_NONE\}\s*disabled/);
  assert.match(editModal, /O atleta optou por não receber camisa\. Para incluir uma, é preciso uma nova inscrição, porque o valor muda\./);
  assert.match(editModal, /Você pode trocar só o tamanho\. Para retirar a camisa, cancele e refaça a inscrição\./);
  // Uma opção "Sem camisa" só existe nos campos bloqueados.
  assert.equal(editModal.match(/<option value=\{SHIRT_NONE\}>Sem camisa<\/option>/g)?.length, 2);

  // As camisas gravadas são lidas ao abrir; os integrantes 5 e 6 não são cortados.
  assert.match(openEditRegistrationBlock, /setEditRegInitialShirts\(\{ main: mainShirt, members: members\.map\(m => m\.shirtSize\) \}\)/);
  assert.match(openEditRegistrationBlock, /while \(members\.length < MAX_TEAM_MEMBERS\)/);
  assert.doesNotMatch(admin, /members\.slice\(0, 4\)/);

  // Erros 400/409 ficam visíveis dentro do modal, que continua aberto.
  assert.match(saveEditRegistrationBlock, /catch \(err\) \{[\s\S]*setEditRegError\(/);
  assert.doesNotMatch(saveEditRegistrationBlock.slice(saveEditRegistrationBlock.indexOf('catch (err)')), /setEditingRegistration\(null\)/);
  assert.match(editModal, /\{editRegError && \([\s\S]*?role="alert"/);
});

// Editar inscrição sem 409 evitável: o servidor recusa deixar em branco um
// tamanho já registrado (P/M/G/GG, legado ou "Sem camisa"), em qualquer modo.

const SHIRT_SIZE_OPTIONS = ['P', 'M', 'G', 'GG'];

const importTranspiled = async (source, fileName) => {
  const compiled = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment'
    }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
};

const loadResolveShirtSettingsForSave = async () => {
  const source = block(shirtSettings, /export const resolveShirtSettingsForSave = \([\s\S]*?\n\};/);
  assert.ok(source, 'resolveShirtSettingsForSave deve existir');
  const { create } = await importTranspiled(
    `export const create = (validateShirtConfig) => {\n${source.replace(/^export /, '')}\nreturn resolveShirtSettingsForSave;\n};`,
    'resolve-shirt-settings.ts'
  );
  return create(validateShirtConfig);
};

test('salvar em "inclusa" com o adicional apagado reenvia o último valor salvo', async () => {
  const resolve = await loadResolveShirtSettingsForSave();

  // Gestor apagou o adicional em "opcional" e voltou para "inclusa": não zera o guardado.
  assert.deepEqual(resolve('included', '', 60), { ok: true, mode: 'included', price: 60 });
  assert.deepEqual(resolve('included', '   ', 45.5), { ok: true, mode: 'included', price: 45.5 });
  // Novo evento: nada salvo ainda.
  assert.deepEqual(resolve('included', ''), { ok: true, mode: 'included', price: 0 });

  // Valor válido ≥ 0 no campo: envia o valor do campo, como antes.
  assert.deepEqual(resolve('included', '75', 60), { ok: true, mode: 'included', price: 75 });
  assert.deepEqual(resolve('included', '0', 60), { ok: true, mode: 'included', price: 0 });
  // Valor inválido no campo desabilitado: volta ao salvo e nunca trava o salvamento.
  assert.deepEqual(resolve('included', 'abc', 60), { ok: true, mode: 'included', price: 60 });
  assert.deepEqual(resolve('included', '-5', 60), { ok: true, mode: 'included', price: 60 });

  // "Opcional" vazio, zero ou negativo continua bloqueando.
  assert.deepEqual(resolve('optional', '', 60), { ok: false, error: 'Informe um valor maior que zero.' });
  assert.deepEqual(resolve('optional', '0', 60), { ok: false, error: 'Informe um valor maior que zero.' });
  assert.equal(resolve('optional', '-5', 60).ok, false);
  assert.deepEqual(resolve('optional', '80', 60), { ok: true, mode: 'optional', price: 80 });
});

test('Bilheteria: trocar de categoria remove o cupom aplicado e avisa para aplicar de novo', async () => {
  const categoryChangeBlock = handler('handleBilCategoryChange');
  assert.ok(categoryChangeBlock, 'handleBilCategoryChange deve existir');
  assert.match(admin, /id="bil-cat-select"[\s\S]*?onChange=\{\(e\) => handleBilCategoryChange\(e\.target\.value\)\}/);
  assert.match(admin, /<div aria-live="polite">\s*\{bilCouponClearedNotice && \([\s\S]*?Cupom removido: aplique novamente para a nova categoria\.[\s\S]*?\)\}\s*<\/div>/);
  // O aviso some ao aplicar outro cupom, gerar convite ou fechar o formulário.
  assert.match(handler('handleApplyBilCoupon'), /setBilCouponClearedNotice\(false\)/);
  assert.match(handler('handleGenerateGuestCoupon'), /setBilCouponClearedNotice\(false\)/);
  assert.match(resetBilheteriaBlock, /setBilCouponClearedNotice\(false\)/);

  const deps = ['bilAppliedCouponCode', 'setBilCatId', 'setBilAppliedCouponCode', 'setBilDiscountApplied', 'setBilIsGuest', 'setBilCouponClearedNotice'];
  const { create } = await importTranspiled(
    `export const create = ({ ${deps.join(', ')} }) => {\n${categoryChangeBlock}\nreturn handleBilCategoryChange;\n};`,
    'bil-category-change.ts'
  );
  const change = (appliedCode, divisionId) => {
    const state = { catId: 'div-a', couponCode: appliedCode, discount: appliedCode ? 30 : 0, guest: Boolean(appliedCode), notice: false };
    create({
      bilAppliedCouponCode: appliedCode,
      setBilCatId: (value) => { state.catId = value; },
      setBilAppliedCouponCode: (value) => { state.couponCode = value; },
      setBilDiscountApplied: (value) => { state.discount = value; },
      setBilIsGuest: (value) => { state.guest = value; },
      setBilCouponClearedNotice: (value) => { state.notice = value; }
    })(divisionId);
    return state;
  };

  // Com cupom aplicado: troca a categoria, zera o desconto e mostra o aviso.
  assert.deepEqual(change('PROMO20', 'div-b'), { catId: 'div-b', couponCode: '', discount: 0, guest: false, notice: true });
  // Sem cupom: só troca a categoria, sem aviso.
  assert.deepEqual(change('', 'div-b'), { catId: 'div-b', couponCode: '', discount: 0, guest: false, notice: false });
});

const loadRenderEditShirtOptions = async () => {
  const { create } = await importTranspiled(
    `export const create = (h, Fragment, SHIRT_SIZE_OPTIONS, isShirtSize) => {\n${editShirtOptions}\nreturn renderEditShirtOptions;\n};`,
    'edit-shirt-options.tsx'
  );
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  return create(h, 'Fragment', SHIRT_SIZE_OPTIONS, isShirtSize);
};

const optionValues = (node) => {
  if (Array.isArray(node)) return node.flatMap(optionValues);
  if (!node || typeof node !== 'object') return [];
  return node.type === 'option' ? [node.props.value] : optionValues(node.children);
};

test('Editar inscrição: "Selecione..." só aparece para quem não tinha tamanho gravado, em qualquer modo', async () => {
  assert.ok(editShirtOptions, 'o modal deve montar as opções de camisa');
  // A opção vazia não depende mais do modo do evento nem do adicional pago.
  assert.doesNotMatch(editShirtOptions, /isShirtSizeOnly/);
  assert.match(editShirtOptions, /\{!initialShirt && <option value="">Selecione\.\.\.<\/option>\}/);
  assert.equal(editModal.match(/<option value="">Selecione\.\.\.<\/option>/g)?.length, 1);

  // Individual e integrante passam o tamanho gravado ao abrir o modal.
  assert.match(editModal, /id="edit-reg-shirt"\s*value=\{editRegShirtSize\}[\s\S]*?\{renderEditShirtOptions\(editRegInitialShirts\.main\)\}/);
  assert.match(editModal, /const visibleMemberShirts = Array\.from\(\{ length: numIntegrantes \}, \(_, idx\) => editRegInitialShirts\.members\[idx\] \|\| ''\)/);
  assert.match(editModal, /id=\{`edit-member-shirt-\$\{idx\}`\}\s*value=\{editRegMembers\[idx\]\?\.shirtSize \|\| ''\}[\s\S]*?\{renderEditShirtOptions\(visibleMemberShirts\[idx\]\)\}/);

  const renderEditShirtOptions = await loadRenderEditShirtOptions();
  // Sem tamanho gravado: inscrição antiga em branco ou integrante novo numa relocação.
  assert.deepEqual(optionValues(renderEditShirtOptions('')), ['', ...SHIRT_SIZE_OPTIONS]);
  // Com tamanho gravado: só tamanhos, sem a opção vazia e sem "Sem camisa".
  for (const size of SHIRT_SIZE_OPTIONS) {
    assert.deepEqual(optionValues(renderEditShirtOptions(size)), SHIRT_SIZE_OPTIONS, `tamanho gravado ${size}`);
  }
  // Valor legado gravado continua como opção, também sem a vazia.
  assert.deepEqual(optionValues(renderEditShirtOptions('BL')), [...SHIRT_SIZE_OPTIONS, 'BL']);
});

const loadSaveRegistrationEdit = async () => {
  const deps = [
    'editingRegistration', 'selectedEventToManage', 'editRegDivisionId', 'editRegName', 'editRegMembers',
    'editRegInitialShirts', 'editRegShirtSize', 'editRegBox', 'editRegEmail', 'editRegPhone', 'editRegInstagram',
    'getDivisionParticipantCount', 'setEditRegError', 'setIsSavingRegistration', 'setAdminNotice',
    'setEditingRegistration', 'updateRegistrationDetails'
  ];
  const { create } = await importTranspiled(
    `export const create = ({ ${deps.join(', ')} }) => {\n${saveEditRegistrationBlock}\nreturn handleSaveRegistrationEdit;\n};`,
    'save-registration-edit.ts'
  );
  return create;
};

const individualShirts = (main) => ({ main, members: [] });
const teamShirts = (...members) => ({ main: members[0] || '', members });

// Mesmo estado que a rota monta para checkRegistrationShirtEdit (atual × seguinte).
const serverShirtEdit = ({ divisionType, initial, shirtSize = initial.main, memberShirts = [] }) => checkRegistrationShirtEdit(
  { isTeam: initial.members.length > 0, shirtSize: initial.main, teamMembers: initial.members.map(size => ({ shirtSize: size })) },
  divisionType === 'individual'
    ? { isTeam: false, shirtSize, teamMembers: [] }
    : {
      isTeam: true,
      shirtSize,
      teamMembers: memberShirts.slice(0, getDivisionParticipantCount(divisionType)).map(size => ({ shirtSize: size }))
    }
);

test('Editar inscrição: salvar avisa no modal, sem ir ao servidor, quando a camisa ficaria em branco', async () => {
  assert.ok(saveEditRegistrationBlock, 'handleSaveRegistrationEdit deve existir');
  const guardIndex = saveEditRegistrationBlock.indexOf('const lostShirtIndex');
  assert.ok(guardIndex > 0, 'o salvar deve checar camisas em branco');
  assert.ok(guardIndex < saveEditRegistrationBlock.indexOf('await updateRegistrationDetails('), 'a checagem vem antes do envio');

  const create = await loadSaveRegistrationEdit();
  const save = async ({ divisionType, initial, shirtSize = initial.main, memberShirts = [] }) => {
    const state = { error: '', payload: null, closed: false };
    const handleSave = create({
      editingRegistration: { id: 'reg-1', gender: 'male' },
      selectedEventToManage: { id: 'evt-1', divisions: [{ id: 'div-1', name: 'RX', type: divisionType, category: 'male' }] },
      editRegDivisionId: 'div-1',
      editRegName: 'Inscrição',
      editRegMembers: Array.from({ length: 6 }, (_, idx) => ({
        name: idx < memberShirts.length ? `Atleta ${idx + 1}` : '',
        instagram: '',
        shirtSize: memberShirts[idx] ?? ''
      })),
      editRegInitialShirts: initial,
      editRegShirtSize: shirtSize,
      editRegBox: '',
      editRegEmail: '',
      editRegPhone: '',
      editRegInstagram: '',
      getDivisionParticipantCount,
      setEditRegError: (message) => { state.error = message; },
      setIsSavingRegistration: () => {},
      setAdminNotice: () => {},
      setEditingRegistration: (value) => { state.closed = value === null; },
      updateRegistrationDetails: async (_registrationId, _eventId, payload) => { state.payload = payload; }
    });
    await handleSave({ preventDefault() {} });
    return state;
  };

  const LOST = /O tamanho já registrado não pode ficar em branco\./;
  const MORE_BLANKS = /A inscrição não pode ficar com mais camisas em branco do que já tinha\./;
  const cases = [
    // Individual: tamanho (ou legado) registrado não fica em branco; em branco → em branco passa.
    ['individual M → em branco', { divisionType: 'individual', initial: individualShirts('M'), shirtSize: '' }, /^Escolha o tamanho da camisa do atleta\./, LOST],
    ['individual legado → em branco', { divisionType: 'individual', initial: individualShirts('BL'), shirtSize: '' }, LOST],
    ['individual em branco → em branco', { divisionType: 'individual', initial: individualShirts(''), shirtSize: '' }, null],
    ['individual M → G', { divisionType: 'individual', initial: individualShirts('M'), shirtSize: 'G' }, null],
    // Integrante: idem, por posição.
    ['integrante 2 G → em branco', { divisionType: 'duo', initial: teamShirts('M', 'G'), memberShirts: ['M', ''] }, /^Escolha o tamanho da camisa do integrante 2\./, LOST],
    ['integrantes em branco seguem em branco', { divisionType: 'trio', initial: teamShirts('', '', 'M'), memberShirts: ['', '', 'G'] }, null],
    ['integrante "Sem camisa" mantido', { divisionType: 'duo', initial: teamShirts(SHIRT_NONE, 'M'), memberShirts: [SHIRT_NONE, 'G'] }, null],
    // Relocação: integrante novo precisa de tamanho quando aumentaria as camisas em branco.
    ['dupla → trio com integrante novo em branco', { divisionType: 'trio', initial: teamShirts('M', 'G'), memberShirts: ['M', 'G', ''] }, /^Escolha o tamanho da camisa do integrante 3\./, MORE_BLANKS],
    ['dupla → trio com integrante novo escolhido', { divisionType: 'trio', initial: teamShirts('M', 'G'), memberShirts: ['M', 'G', 'P'] }, null],
    ['individual M → dupla em branco', { divisionType: 'duo', initial: individualShirts('M'), memberShirts: ['', ''] }, /^Escolha o tamanho da camisa do integrante 1\./, MORE_BLANKS],
    ['individual em branco → dupla com um em branco', { divisionType: 'duo', initial: individualShirts(''), memberShirts: ['', 'M'] }, null],
    ['dupla → individual com o tamanho do 1º integrante', { divisionType: 'individual', initial: teamShirts('M', 'G'), shirtSize: 'M' }, null]
  ];

  for (const [name, scenario, ...expectedErrors] of cases) {
    const state = await save(scenario);
    const server = serverShirtEdit(scenario);
    const blocked = expectedErrors[0] !== null;

    // O cliente bloqueia exatamente o que o servidor recusaria por camisa em branco.
    assert.equal(server.ok, !blocked, `${name}: regra do servidor`);
    if (!server.ok) {
      assert.equal(server.status, 409, `${name}: 409 do servidor`);
      assert.match(server.error, /não pode ficar em branco/, `${name}: motivo do servidor`);
    }

    if (blocked) {
      for (const expected of expectedErrors) assert.match(state.error, expected, `${name}: mensagem no modal`);
      assert.equal(state.payload, null, `${name}: não envia ao servidor`);
      assert.equal(state.closed, false, `${name}: o modal continua aberto`);
    } else {
      assert.equal(state.error, '', `${name}: sem erro`);
      assert.ok(state.payload, `${name}: envia ao servidor`);
      assert.equal(state.closed, true, `${name}: fecha após salvar`);
    }
  }
});

test('tamanhos continuam P, M, G e GG no painel', () => {
  assert.match(admin, /const SHIRT_SIZE_OPTIONS = \['P', 'M', 'G', 'GG'\]/);
  for (const source of [admin, shirtSettings]) {
    assert.doesNotMatch(source, /\bPP\b/);
    assert.doesNotMatch(source, /\bXG\b/);
    assert.doesNotMatch(source, /\bXXG\b/);
  }
});
