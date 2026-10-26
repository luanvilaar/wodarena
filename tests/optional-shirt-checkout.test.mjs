import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { calculateRegistrationAmounts, isShirtNone } from '../src/lib/shirtPricing.ts';
import { calculateServiceFee } from '../src/lib/serviceFee.ts';

// Regressão da Story 1.38 no lado do atleta: o checkout usa a mesma regra de
// preço do servidor, "Sem camisa" só existe no modo opcional, e página do
// evento, voucher, e-mail e textos acompanham nos três idiomas.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const registerModal = read('../src/components/RegisterModal.tsx');
const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');
const voucher = read('../src/components/RegistrationVoucher.tsx');
const resend = read('../src/lib/resend.ts');
// A rota da segunda via e o carregador compartilhado (Story 1.76) montam a inscrição enviada ao e-mail.
const emailRoute = `${read('../src/app/api/checkout/email/route.ts')}\n${read('../src/lib/serverRegistrationConfirmation.ts')}`;
const cardModal = read('../src/components/CardPaymentModal.tsx');
const pixModal = read('../src/components/PixPaymentModal.tsx');

const LOCALES = ['pt-br', 'pt-pt', 'en-gb'];
const messages = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(read(`../src/messages/${locale}.json`))]));

const paymentRoutes = {
  card: read('../src/app/api/checkout/card/route.ts'),
  pix: read('../src/app/api/checkout/pix/route.ts'),
  preference: read('../src/app/api/checkout/preference/route.ts'),
  status: read('../src/app/api/checkout/status/route.ts'),
  coupon: read('../src/app/api/checkout/coupon/route.ts'),
  mercadopagoWebhook: read('../src/app/api/webhooks/mercadopago/route.ts'),
  stripeWebhook: read('../src/app/api/webhooks/stripe/route.ts'),
  stripeReturn: read('../src/app/api/stripe/return/route.ts')
};

const NEW_KEYS = [
  'Checkout.shirtSizeAddonOption',
  'Checkout.shirtNoneOption',
  'Checkout.orderSummaryShirts',
  'Checkout.couponShirtNotice',
  'Checkout.amountsUpdatedNotice',
  'Checkout.amountsUpdatedConfirmedNotice',
  'Checkout.registrationAlreadyStartedGuidance',
  'Event.sidebar.optionalShirt',
  'Voucher.shirtLabel',
  'Voucher.shirtNone',
  'Voucher.shirtAddon'
];

const getMessage = (locale, path) => path.split('.').reduce((node, key) => node?.[key], messages[locale]);

const flattenKeys = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (
  typeof value === 'object' && value !== null ? flattenKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`]
));

// Argumentos ICU ({amount}, {count, plural, ...}); o texto dos ramos do plural fica de fora.
const placeholders = (message) => [...new Set(message.match(/\{\w+(?=[,}])/g) || [])].sort();
const tags = (message) => [...new Set(message.match(/<(\w+)>/g) || [])].sort();

const block = (source, pattern) => source.match(pattern)?.[0] || '';

test('o checkout calcula o total pela regra compartilhada com o servidor', () => {
  assert.match(registerModal, /import \{\s*calculateRegistrationAmounts,\s*getDivisionParticipantCount,\s*isShirtSize,\s*normalizeShirtMode,\s*SHIRT_NONE,\s*SHIRT_SIZES\s*\} from '@\/lib\/shirtPricing'/);
  assert.match(registerModal, /calculateRegistrationAmounts\(\{\s*ticketPrice,\s*quantity: 1,\s*discount: discountApplied,\s*shirtMode,\s*shirtAddonPrice,\s*shirtAddonCount\s*\}\)/);
  assert.match(registerModal, /const totalPaid = registrationAmounts\.totalPaid;/);
  assert.equal(registerModal.match(/const totalPaid = /g)?.length, 1);
  // Nenhuma conta própria de total ou de mínimo de cobrança no navegador.
  assert.doesNotMatch(registerModal, /baseTotalPaid|ticketPrice - discountApplied|< 1\.00 \? 1\.00/);

  // Só tamanhos pagam o adicional, e só no modo opcional; "Sem camisa" não conta.
  assert.match(registerModal, /const shirtAddonCount = isOptionalShirt\s*\?\s*visibleParticipants\.filter\(\(participant\) => isShirtSize\(participant\.shirtSize\)\)\.length\s*:\s*0;/);
  assert.match(registerModal, /const shirtMode = normalizeShirtMode\(event\.shirtMode\);/);
  assert.match(registerModal, /const shirtAddonPrice = event\.shirtAddonPrice \?\? 0;/);

  // Participantes por categoria vêm da mesma função usada pelo servidor.
  assert.match(registerModal, /getDivisionParticipantCount\(selectedDivision\?\.type\)/);
  assert.doesNotMatch(registerModal, /selectedDivision\.type === 'duo'/);
});

test('"Sem camisa" só aparece no modo opcional, com o adicional escrito em cada tamanho (D7)', () => {
  const select = block(registerModal, /<select\s+id=\{`athlete-\$\{index\}-shirt-size`\}[\s\S]*?<\/select>/);
  assert.ok(select, 'select de camisa deve existir');
  assert.match(select, /required/);
  assert.match(select, /<option value="">\{t\('selectPlaceholder'\)\}<\/option>/);
  assert.match(select, /SHIRT_SIZES\.map\(size =>/);
  assert.match(select, /\{isOptionalShirt \? t\('shirtSizeAddonOption', \{ size, amount: shirtAddonPriceLabel \}\) : size\}/);
  assert.match(select, /\{isOptionalShirt && \(\s*<option value=\{SHIRT_NONE\}>\{t\('shirtNoneOption'\)\}<\/option>\s*\)\}/);
  // "Sem camisa" é a última opção.
  assert.ok(select.indexOf('SHIRT_NONE') > select.indexOf('SHIRT_SIZES.map'));
  assert.doesNotMatch(registerModal, /value="NONE"|'NONE'/);
  assert.doesNotMatch(registerModal, /shirtSizeOptions/);

  // A escolha continua obrigatória: "Selecione" bloqueia, "Sem camisa" é válida.
  assert.match(registerModal, /!participant\.shirtSize/);
  assert.match(registerModal, /const shirtAddonPriceLabel = formatMoney\(shirtAddonPrice, event\.currency \?\? 'BRL', locale\);/);
});

const handleSubmit = block(registerModal, /const handleSubmit = useCallback\([\s\S]*?\n  \}, \[/);

test('gratuito ou pago é decidido pelo retorno do servidor, não pelo total do navegador (M-1)', () => {
  assert.ok(handleSubmit, 'handleSubmit deve existir');
  assert.match(registerModal, /calculateServiceFee\(totalPaid, serviceFeeConfig\.percent, serviceFeeConfig\.enabled\)/);

  // O rótulo do meio de pagamento continua o de antes quando cliente e servidor
  // concordam; a rota grava o valor como veio e as rotas de pagamento o sobrescrevem.
  assert.match(registerModal, /paymentMethod: totalPaid === 0 \? 'free' : paymentMethod/);
  // Status inicial calculado no navegador saiu do corpo (a rota sempre o ignorou).
  assert.doesNotMatch(registerModal, /initialPaymentStatus|'payment_pending'/);

  // Ramo gratuito: só com aprovação e total zero devolvidos por /api/registrations/start.
  assert.match(handleSubmit, /const serverTotalPaid = Number\(activeRegistrationData\.totalPaid\);/);
  assert.match(handleSubmit, /if \(!Number\.isFinite\(serverTotalPaid\)\) \{\s*throw new Error\(t\('registrationStartError'\)\);/);
  assert.match(handleSubmit, /const isServerApprovedFree = activeRegistrationData\.paymentStatus === 'payment_approved' && serverTotalPaid === 0;/);
  assert.match(handleSubmit, /if \(isServerApprovedFree\) \{/);
  assert.doesNotMatch(handleSubmit, /if \(totalPaid === 0\)/);
  // O registro local e o e-mail usam a inscrição devolvida pelo servidor.
  assert.match(handleSubmit, /const finalReg = createdReg \|\| \{\s*\.\.\.activeRegistrationData,/);
  assert.doesNotMatch(handleSubmit, /\.\.\.registrationData,\s*id: registrationData\.id/);

  // Ordem: início no servidor → comparação → gratuito → Pix ou preference.
  const position = (needle) => {
    const index = handleSubmit.indexOf(needle);
    assert.ok(index > -1, `trecho ausente: ${needle}`);
    return index;
  };
  const order = [
    'await startRegistration(registrationData, athleteProfile)',
    'toMinorUnits(serverTotalPaid',
    'if (isServerApprovedFree) {',
    "fetch('/api/checkout/pix'",
    "fetch('/api/checkout/preference'"
  ].map(position);
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  // O preço unitário segue sendo o da categoria; o servidor recalcula tudo.
  const registrationData = block(registerModal, /const registrationData = \{[\s\S]*?\};/);
  assert.match(registrationData, /ticketPrice,\s*quantity: 1,\s*totalPaid,/);
  assert.doesNotMatch(registrationData, /shirtAddon/);
});

test('total do servidor diferente do exibido: avisa, não cobra e mantém o formulário (M-1)', () => {
  const mismatch = block(handleSubmit, /if \(!confirmedServerCheckout && toMinorUnits\(serverTotalPaid, eventCurrency, locale\) !== toMinorUnits\(totalPaid, eventCurrency, locale\)\) \{[\s\S]*?\n {6}\}/);
  assert.ok(mismatch, 'comparação em centavos do total do servidor com o exibido');
  assert.match(handleSubmit, /const eventCurrency = event\.currency \?\? 'BRL';/);
  assert.match(registerModal, /import \{ formatMoney, toMinorUnits \} from '@\/lib\/intl\/format';/);
  assert.match(mismatch, /setServerUpdatedCheckout\(\{ requestKey, \.\.\.started \}\);/);
  assert.match(mismatch, /const updatedAmount = formatMoney\(Number\(activeRegistrationData\.amountCollected \?\? serverTotalPaid\), eventCurrency, locale\);/);
  // Pendente: para e pede nova confirmação. Já aprovada com total 0: segue ao sucesso com o aviso.
  assert.match(mismatch, /if \(!isServerApprovedFree\) \{\s*setAmountsUpdatedNotice\(t\('amountsUpdatedNotice', \{ amount: updatedAmount \}\)\);\s*setIsProcessing\(false\);\s*return;\s*\}/);
  assert.match(mismatch, /setAmountsUpdatedNotice\(t\('amountsUpdatedConfirmedNotice', \{ amount: updatedAmount \}\)\);\s*\}$/);
  // Nada de cobrança, confirmação, registro local ou e-mail nesse ramo; nem cancelamento.
  assert.doesNotMatch(mismatch, /fetch\(|registerTicket|setIsSuccess|onSuccess|setPixData|location/);
  assert.doesNotMatch(registerModal, /payment_cancelled|cancelRegistration/);

  // Reenvio com os mesmos dados segue com a inscrição já criada, sem novo start
  // (a rota recusaria o mesmo e-mail no evento) e sem novo aviso.
  assert.match(handleSubmit, /const requestKey = JSON\.stringify\(\{\s*registrationData: \{ \.\.\.registrationData, id: undefined \},\s*athleteProfile: \{ \.\.\.athleteProfile, id: undefined \},\s*password: athletePassword,\s*passwordConfirmation: athletePasswordConfirmation\s*\}\);/);
  assert.match(handleSubmit, /const confirmedServerCheckout = serverUpdatedCheckout\?\.requestKey === requestKey \? serverUpdatedCheckout : null;/);
  assert.match(handleSubmit, /const started = confirmedServerCheckout \?\? await startRegistration\(registrationData, athleteProfile\);/);
  assert.equal(registerModal.match(/await startRegistration\(/g)?.length, 1);
  assert.match(registerModal, /serverUpdatedCheckout,\s*appliedCoupon,/);

  // Aviso anunciado, junto do botão de envio; limpo a cada envio e ao abrir/fechar.
  assert.match(registerModal, /\{amountsUpdatedNotice && \(\s*<p role="alert"[^>]*>\s*\{amountsUpdatedNotice\}\s*<\/p>\s*\)\}/);
  assert.ok(registerModal.indexOf('{amountsUpdatedNotice && (') < registerModal.indexOf('type="submit"'));
  assert.match(handleSubmit, /setAmountsUpdatedNotice\(null\);\s*let paymentAttemptStarted = false;/);
  const resetOnToggle = block(registerModal, /if \(isOpen !== prevIsOpen\) \{[\s\S]*?\n  \}/);
  assert.match(resetOnToggle, /setServerUpdatedCheckout\(null\);/);
  assert.match(resetOnToggle, /setAmountsUpdatedNotice\(null\);/);

  // Depois da confirmação, o comprovante único mostra o valor gravado no servidor
  // (a inscrição que abre é a devolvida pelo start, nunca o cálculo local).
  assert.match(registerModal, /const finalReg = createdReg \|\| \{\s*\.\.\.activeRegistrationData,/);
  assert.doesNotMatch(registerModal, /ticketTotalPaid|ticketAmountCollected/);
  assert.match(registerModal, /<RegistrationVoucher\s+registration=\{confirmedVoucher\.registration\}/);
});

test('depois do aviso: gratuita aprovada vai ao sucesso, novo envio limpa a resposta guardada e a recusa orienta (R2-L-1)', () => {
  // (a) O aviso também aparece na tela de sucesso.
  const successScreen = block(registerModal, /\{isSuccess \? \([\s\S]*?\) : pixData \? \(/);
  assert.ok(successScreen, 'tela de sucesso');
  assert.match(successScreen, /\{amountsUpdatedNotice && \(\s*<p[^>]*>\s*\{amountsUpdatedNotice\}\s*<\/p>\s*\)\}/);

  // (b) Só um novo início no servidor descarta a resposta guardada; o reenvio idêntico a reaproveita.
  assert.match(handleSubmit, /paymentAttemptStarted = true;[\s\S]*?if \(!confirmedServerCheckout\) setServerUpdatedCheckout\(null\);/);

  // (c) Recusa do início com resposta guardada: mensagem do servidor + orientação traduzida.
  const catchBlock = handleSubmit.slice(handleSubmit.indexOf('} catch (err) {'));
  assert.match(catchBlock, /const errorMessage = err instanceof Error \? err\.message : t\('genericCheckoutError'\);/);
  assert.match(catchBlock, /const baseMessage = !paymentAttemptStarted && serverUpdatedCheckout\s*\? `\$\{errorMessage\}\\n\\n\$\{t\('registrationAlreadyStartedGuidance'\)\}`\s*: errorMessage;/);
  assert.match(catchBlock, /alert\(paymentAttemptStarted \? `\$\{baseMessage\}\\n\\n\$\{t\('paymentFailureGuidance'\)\}` : baseMessage\);/);
});

// Executa o handleSubmit real com dependências falsas (sem rede nem banco).
const handleSubmitSource = registerModal.match(/const handleSubmit = useCallback\((async \(e: React\.FormEvent\) => \{[\s\S]*?\n {2}\}), \[/)?.[1] || '';
const SUBMIT_DEPS = [
  'acceptedTerms', 'alert', 't', 'visibleParticipants', 'isFitnessRacing', 'isTeamCategory', 'teamName', 'box',
  'primaryParticipant', 'athletePassword', 'athletePasswordConfirmation', 'paymentMethod', 'isValidCPF', 'cpf',
  'setIsProcessing', 'selectedDivision', 'normalizeInstagram', 'generateUniqueId', 'event', 'selectedDivisionId',
  'ticketPrice', 'totalPaid', 'appliedCoupon', 'serverUpdatedCheckout', 'setAmountsUpdatedNotice', 'startRegistration',
  'toMinorUnits', 'setServerUpdatedCheckout', 'formatMoney', 'locale', 'registerTicket', 'fetch', 'onSuccess',
  'setIsSuccess', 'sessionStorage', 'setPixData', 'getCheckoutErrorMessage', 'window', 'console'
];

const loadHandleSubmit = async () => {
  assert.ok(handleSubmitSource, 'handleSubmit deve existir');
  const compiled = ts.transpileModule(
    `export const create = ({ ${SUBMIT_DEPS.join(', ')} }) => (${handleSubmitSource});`,
    { fileName: 'handle-submit.ts', compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).create;
};

const ATHLETE = {
  name: 'Ana Souza', email: 'ana@example.com', phone: '85999990000', gender: 'female', birthDate: '',
  city: '', state: '', instagram: '@ana', photoUrl: '', shirtSize: 'M'
};

const serverRegistration = (overrides) => ({
  registrationData: { id: 'reg-server', accessToken: 'tok', totalPaid: 60, amountCollected: 66, paymentStatus: 'payment_pending', ...overrides },
  athleteProfile: { id: 'ath-server', name: 'Ana Souza' }
});

const submitCheckout = async (create, { totalPaid, stored = null, athlete = ATHLETE, start = null, startError = null, pixOk = true }) => {
  let sequence = 0;
  const calls = { starts: 0, fetches: [], alerts: [], notices: [], stored: [], processing: [], success: false, tickets: 0, onSuccess: 0 };
  const handleSubmit = create({
    acceptedTerms: true,
    alert: (message) => { calls.alerts.push(message); },
    t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
    visibleParticipants: [athlete],
    isFitnessRacing: false,
    isTeamCategory: false,
    teamName: '',
    box: '',
    primaryParticipant: athlete,
    athletePassword: 'segredo1',
    athletePasswordConfirmation: 'segredo1',
    paymentMethod: 'pix',
    isValidCPF: () => true,
    cpf: '12345678909',
    setIsProcessing: (value) => { calls.processing.push(value); },
    selectedDivision: { id: 'div-1', name: 'RX', type: 'individual' },
    normalizeInstagram: (value) => value.replace(/^@/, ''),
    generateUniqueId: (prefix) => `${prefix}-${++sequence}`,
    event: { id: 'evt-1', currency: 'BRL' },
    selectedDivisionId: 'div-1',
    ticketPrice: 150,
    totalPaid,
    appliedCoupon: 'CONVITE',
    serverUpdatedCheckout: stored,
    setAmountsUpdatedNotice: (value) => { calls.notices.push(value); },
    startRegistration: async () => {
      calls.starts += 1;
      if (startError) throw new Error(startError);
      return start;
    },
    toMinorUnits: (amount) => Math.round(amount * 100),
    setServerUpdatedCheckout: (value) => { calls.stored.push(value); },
    formatMoney: (amount) => `R$ ${amount.toFixed(2)}`,
    locale: 'pt-br',
    registerTicket: (registration) => { calls.tickets += 1; return { ...registration, createdAt: '2026-10-14T00:00:00Z' }; },
    fetch: async (url) => {
      calls.fetches.push(url);
      return { ok: url !== '/api/checkout/pix' || pixOk, json: async () => ({ paymentId: 'pay-1' }) };
    },
    onSuccess: () => { calls.onSuccess += 1; },
    setIsSuccess: (value) => { calls.success = value; },
    sessionStorage: { setItem() {} },
    setPixData: (value) => { calls.pix = value; },
    getCheckoutErrorMessage: async (_response, fallback) => fallback,
    window: { location: { origin: 'http://localhost', assign() {} } },
    console: { log() {}, error() {} }
  });
  await handleSubmit({ preventDefault() {} });
  return calls;
};

test('handleSubmit real: cenários depois do aviso de valores atualizados (R2-L-1)', async () => {
  const create = await loadHandleSubmit();
  const DUPLICATE = 'Este e-mail já possui uma inscrição ativa para este evento.';

  // Pendente com outro total: guarda a resposta, avisa e para, sem cobrar.
  const pending = await submitCheckout(create, { totalPaid: 0, start: serverRegistration() });
  const storedCheckout = pending.stored.at(-1);
  assert.equal(pending.starts, 1);
  assert.equal(storedCheckout.registrationData.id, 'reg-server');
  assert.equal(pending.notices.at(-1), 'amountsUpdatedNotice {"amount":"R$ 66.00"}');
  assert.equal(pending.success, false);
  assert.deepEqual(pending.fetches, []);
  assert.equal(pending.processing.at(-1), false);

  // (a) Navegador 60, servidor já aprovou com total 0: sucesso direto, com aviso e e-mail.
  const approvedFree = await submitCheckout(create, {
    totalPaid: 60,
    start: serverRegistration({ totalPaid: 0, amountCollected: 0, paymentStatus: 'payment_approved' })
  });
  assert.equal(approvedFree.notices.at(-1), 'amountsUpdatedConfirmedNotice {"amount":"R$ 0.00"}');
  assert.equal(approvedFree.stored.at(-1).registrationData.totalPaid, 0, 'o ticket mostra o valor do servidor');
  assert.equal(approvedFree.success, true);
  assert.equal(approvedFree.tickets, 1);
  assert.equal(approvedFree.onSuccess, 1);
  assert.deepEqual(approvedFree.fetches, [], 'o e-mail da gratuita sai do servidor (Story 1.76)');
  assert.deepEqual(approvedFree.alerts, []);
  assert.equal(approvedFree.processing.at(-1), false);

  // (b) Reenvio idêntico: reaproveita a resposta guardada, sem novo início nem limpeza.
  const resend = await submitCheckout(create, { totalPaid: 0, stored: storedCheckout });
  assert.equal(resend.starts, 0);
  assert.deepEqual(resend.stored, []);
  assert.deepEqual(resend.fetches, ['/api/checkout/pix']);
  assert.equal(resend.pix.registrationId, 'reg-server');

  // (b) Dados mudaram (outro e-mail) e o servidor criou nova inscrição: a resposta antiga é descartada.
  const changedEmail = await submitCheckout(create, {
    totalPaid: 60,
    stored: storedCheckout,
    athlete: { ...ATHLETE, email: 'ana.nova@example.com' },
    start: serverRegistration({ id: 'reg-new', totalPaid: 60 })
  });
  assert.equal(changedEmail.starts, 1);
  assert.deepEqual(changedEmail.stored, [null]);
  assert.equal(changedEmail.pix.registrationId, 'reg-new');

  // (c) Dados mudaram e o servidor recusa o mesmo e-mail: mensagem do servidor + orientação.
  const refused = await submitCheckout(create, {
    totalPaid: 0,
    stored: storedCheckout,
    athlete: { ...ATHLETE, shirtSize: 'G' },
    startError: DUPLICATE
  });
  assert.equal(refused.starts, 1);
  assert.deepEqual(refused.alerts, [`${DUPLICATE}\n\nregistrationAlreadyStartedGuidance`]);
  assert.deepEqual(refused.stored, [], 'a resposta guardada continua valendo para um reenvio idêntico');
  assert.equal(refused.success, false);
  assert.equal(refused.processing.at(-1), false);

  // Sem resposta guardada, a recusa mostra só a mensagem do servidor (como antes).
  const refusedWithoutStored = await submitCheckout(create, { totalPaid: 0, startError: DUPLICATE });
  assert.deepEqual(refusedWithoutStored.alerts, [DUPLICATE]);

  // Falha no pagamento depois de criada a inscrição continua com a orientação de pagamento.
  const pixFailed = await submitCheckout(create, { totalPaid: 0, stored: storedCheckout, pixOk: false });
  assert.deepEqual(pixFailed.alerts, ['pixCreateError\n\npaymentFailureGuidance']);
});

test('cenários de discordância cliente x servidor que o aviso cobre (M-1)', () => {
  const amounts = (overrides) => calculateRegistrationAmounts({
    ticketPrice: 150,
    quantity: 1,
    discount: 150,
    shirtMode: 'included',
    shirtAddonPrice: 60,
    shirtAddonCount: 0,
    ...overrides
  });

  // Checkout aberto com camisa inclusa e convite de 100%: o navegador vê 0.
  // O gestor muda para camisa opcional antes do envio: o servidor cobra a camisa.
  const browser = amounts({});
  const server = amounts({ shirtMode: 'optional', shirtAddonCount: 1 });
  assert.equal(browser.totalPaid, 0);
  assert.equal(server.totalPaid, 60);

  // Inverso: o navegador cobra a camisa e o servidor, já em "inclusa", aprova em 0.
  assert.equal(amounts({ shirtMode: 'optional', shirtAddonCount: 1 }).totalPaid, 60);
  assert.equal(amounts({ shirtMode: 'included', shirtAddonCount: 1 }).totalPaid, 0);
});

test('o cupom usa só o desconto da rota; o totalPaid dela fica de fora (D1)', () => {
  assert.match(registerModal, /setDiscountApplied\(Number\(data\.discount\)\)/);
  assert.doesNotMatch(registerModal, /data\.totalPaid/);
  assert.doesNotMatch(block(registerModal, /type CouponValidationResponse = \{[\s\S]*?\};/), /totalPaid/);

  // Aviso discreto ligado ao campo do cupom, só no modo opcional, dentro de uma
  // região viva sempre montada para ser anunciado ao aparecer.
  assert.match(registerModal, /const showCouponShirtNotice = isOptionalShirt && Boolean\(appliedCoupon\);/);
  assert.match(registerModal, /aria-describedby=\{showCouponShirtNotice \? 'checkout-coupon-shirt-notice' : undefined\}/);
  assert.match(registerModal, /<div aria-live="polite">\s*\{couponNotice && \([\s\S]*?\)\}\s*\{showCouponShirtNotice && \(\s*<p id="checkout-coupon-shirt-notice"[^>]*>\s*\{t\('couponShirtNotice'\)\}\s*<\/p>\s*\)\}\s*<\/div>/);

  // O resumo mostra o desconto efetivamente abatido (limitado à inscrição).
  assert.match(registerModal, /\{appliedCoupon && registrationAmounts\.discount > 0 && \(/);
  assert.match(registerModal, /- \{formatMoney\(registrationAmounts\.discount, event\.currency \?\? 'BRL', locale\)\}/);
});

test('resumo do pedido: inscrição, camisa, desconto, taxa e total, nessa ordem', () => {
  const order = [
    "t('orderSummaryRegistration'",
    "t('orderSummaryShirts'",
    "t('discountLabel'",
    "t('serviceFeeLabel'",
    "t('totalLabel')"
  ].map((needle) => registerModal.indexOf(needle));
  assert.ok(order.every((index) => index > -1), 'todas as linhas do resumo devem existir');
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  assert.match(registerModal, /\{registrationAmounts\.shirtAddonAmount > 0 && \(/);
  assert.match(registerModal, /t\('orderSummaryShirts', \{ count: shirtAddonCount, amount: shirtAddonPriceLabel \}\)/);
  assert.match(registerModal, /\+ \{formatMoney\(registrationAmounts\.shirtAddonAmount, event\.currency \?\? 'BRL', locale\)\}/);
});

test('cenários do checkout fecham a conta como o servidor (D1 e D2)', () => {
  const checkout = (overrides) => {
    const amounts = calculateRegistrationAmounts({
      ticketPrice: 150,
      quantity: 1,
      discount: 0,
      shirtMode: 'optional',
      shirtAddonPrice: 60,
      shirtAddonCount: 0,
      ...overrides
    });
    return { ...amounts, ...calculateServiceFee(amounts.totalPaid, 10, true) };
  };

  // Convite de 100% com camisa: paga a camisa e a taxa sobre ela; não é gratuita.
  const inviteWithShirt = checkout({ discount: 150, shirtAddonCount: 1 });
  assert.equal(inviteWithShirt.totalPaid, 60);
  assert.equal(inviteWithShirt.amountCollected, 66);

  // Convite de 100% e "Sem camisa": total zero, segue o fluxo gratuito.
  const inviteWithoutShirt = checkout({ discount: 150, shirtAddonCount: 0 });
  assert.equal(inviteWithoutShirt.totalPaid, 0);
  assert.equal(inviteWithoutShirt.amountCollected, 0);

  // Cupom fixo maior que a categoria não abate a camisa.
  const bigFixedCoupon = checkout({ discount: 200, shirtAddonCount: 1 });
  assert.equal(bigFixedCoupon.discount, 150);
  assert.equal(bigFixedCoupon.totalPaid, 60);

  // Time de 4 com três camisas e um "Sem camisa".
  const team = checkout({ ticketPrice: 520, shirtAddonCount: 3 });
  assert.equal(team.shirtAddonAmount, 180);
  assert.equal(team.totalPaid, 700);
  assert.equal(team.amountCollected, 770);

  // Camisa inclusa: nenhum adicional, como hoje.
  assert.equal(checkout({ shirtMode: 'included', shirtAddonCount: 1 }).totalPaid, 150);
});

test('a página do evento mostra o adicional só no modo opcional e mantém o "a partir de" (D6)', () => {
  assert.match(eventView, /import \{ normalizeShirtMode \} from '@\/lib\/shirtPricing'/);
  assert.match(eventView, /const optionalShirtPriceLabel = normalizeShirtMode\(event\.shirtMode\) === 'optional' && shirtAddonPrice > 0\s*\?\s*formatMoney\(shirtAddonPrice, event\.currency \?\? 'BRL', locale\)\s*:\s*null;/);
  assert.match(eventView, /\{optionalShirtPriceLabel && \(\s*<p[^>]*>\s*\{tSidebar\.rich\('optionalShirt', \{/);
  assert.ok(eventView.indexOf("tSidebar('priceFrom')") < eventView.indexOf("tSidebar.rich('optionalShirt'"));

  // O menor preço continua vindo só das categorias (preço sem camisa).
  const minPrice = block(eventView, /const minPrice = React\.useMemo\([\s\S]*?\}, \[event\]\);/);
  assert.match(minPrice, /Math\.min\(\.\.\.activeDivs\.map\(d => d\.price\)\)/);
  assert.doesNotMatch(minPrice, /shirt/i);
});

test('voucher e e-mail mostram a camisa por participante, "Sem camisa" e o adicional (AC12)', () => {
  assert.match(voucher, /import \{ isShirtNone \} from '@\/lib\/shirtPricing'/);
  // Integrantes na ordem em equipe; o próprio atleta no individual.
  assert.match(voucher, /\(teamMemberList\.length > 0 \? teamMemberList\.map\(member => member\.shirtSize\) : \[athlete\.shirtSize\]\)/);
  assert.match(voucher, /isShirtNone\(size\) \? t\('shirtNone'\)/);
  assert.match(voucher, /const shirtAddonAmount = registration\.shirtAddonAmount \?\? 0;/);
  assert.match(voucher, /t\('shirtAddon', \{ amount: formatMoney\(shirtAddonAmount, currency, locale\) \}\)/);
  assert.match(voucher, /shirtSizes\.some\(Boolean\)/);
  assert.match(voucher, /\{shirtSummary && \(\s*<VoucherInfo label=\{t\('shirtLabel'\)\} value=\{shirtSummary\}/);

  assert.match(resend, /import \{ isShirtNone \} from '@\/lib\/shirtPricing'/);
  assert.match(resend, /\(teamMembers\.length > 0 \? teamMembers\.map\(m => m\.shirtSize\) : \[athlete\.shirtSize\]\)/);
  assert.match(resend, /escapeHtml\(isShirtNone\(size\) \? c\.shirt\.none : size \|\| '—'\)/);
  assert.match(resend, /escapeHtml\(c\.shirt\.addon\(moneyFormatter\.format\(shirtAddonAmount\)\)\)/);
  assert.match(resend, /const shirtAddonAmount = Number\(registration\.shirtAddonAmount\) \|\| 0;/);
  assert.match(resend, /\$\{shirtSummary \? `[\s\S]*?c\.shirt\.label[\s\S]*?\$\{shirtSummary\}[\s\S]*?` : ''\}\s*<tr>\s*<td class="label">\$\{c\.fields\.totalPaid\}/);
  // Dicionário do e-mail nos três idiomas.
  const shirtCopies = [...resend.matchAll(/shirt: \{\s*label: '([^']+)',\s*none: '([^']+)',/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(shirtCopies, [['Camisa', 'Sem camisa'], ['T-shirt', 'Sem t-shirt'], ['Shirt', 'No shirt']]);

  // A rota de reenvio do e-mail lê do banco os mesmos campos que o serverCheckout.
  assert.match(emailRoute, /import \{ normalizeShirtMode \} from '@\/lib\/shirtPricing'/);
  assert.match(emailRoute, /shirtAddonCount: Number\(dbReg\.shirt_addon_count\) \|\| 0,\s*shirtAddonAmount: Number\(dbReg\.shirt_addon_amount\) \|\| 0/);
  assert.match(emailRoute, /shirtMode: normalizeShirtMode\(dbEvent\.shirt_mode\),\s*shirtAddonPrice: Number\(dbEvent\.shirt_addon_price\) \|\| 0/);
});

test('linha de camisa só com escolha de camisa opcional: camisa inclusa fica como antes (L-7, AC13)', () => {
  // Adicional pago ou algum "Sem camisa"; nunca o modo atual do evento, que pode
  // ter mudado depois da inscrição.
  const rule = /const hasOptionalShirtChoice = shirtAddonAmount > 0 \|\| shirtSizes\.some\(isShirtNone\);/;
  const gate = /const shirtSummary = hasOptionalShirtChoice\s*\?\s*\[[\s\S]*?\]\.filter\(Boolean\)\.join\(' · '\)\s*:\s*'';/;
  for (const [name, source] of Object.entries({ voucher, resend })) {
    assert.match(source, rule, name);
    assert.match(source, gate, name);
    assert.doesNotMatch(source, /shirtMode/, name);
  }

  // A rota de reenvio só entrega os dados gravados; a regra fica no resend.
  assert.doesNotMatch(emailRoute, /hasOptionalShirtChoice|shirtSummary/);
  assert.match(emailRoute, /shirtSize: dbAthlete\?\.shirt_size \|\| ''/);
  assert.match(emailRoute, /isTeam: dbAthlete\?\.is_team \|\| false/);

  // Cenários avaliando a expressão escrita em cada arquivo, com os tamanhos já
  // saneados como no código (String(size || '').trim()).
  for (const [name, source] of Object.entries({ voucher, resend })) {
    const expression = source.match(/const hasOptionalShirtChoice = ([^;]+);/)?.[1];
    assert.ok(expression, name);
    const showsShirtLine = new Function('shirtAddonAmount', 'shirtSizes', 'isShirtNone', `return ${expression};`);
    const shows = (sizes, shirtAddonAmount) => showsShirtLine(shirtAddonAmount, sizes.map((size) => String(size || '').trim()), isShirtNone);

    // Camisa inclusa (com ou sem tamanho, individual ou equipe): sem linha, como antes.
    assert.equal(shows(['M'], 0), false, name);
    assert.equal(shows(['M', 'G'], 0), false, name);
    assert.equal(shows([''], 0), false, name);
    assert.equal(shows([undefined], 0), false, name);
    // Camisa opcional: com adicional, só "Sem camisa" ou equipe mista.
    assert.equal(shows(['M'], 60), true, name);
    assert.equal(shows(['NONE'], 0), true, name);
    assert.equal(shows(['M', 'NONE'], 60), true, name);
  }
});

test('textos novos existem nos três idiomas, com os mesmos parâmetros e o vocabulário de cada um', () => {
  for (const key of NEW_KEYS) {
    const [reference, ...others] = LOCALES.map((locale) => getMessage(locale, key));
    assert.equal(typeof reference, 'string', `${key} em pt-br`);
    for (const [index, message] of others.entries()) {
      assert.equal(typeof message, 'string', `${key} em ${LOCALES[index + 1]}`);
      assert.deepEqual(placeholders(message), placeholders(reference), `${key}: parâmetros em ${LOCALES[index + 1]}`);
      assert.deepEqual(tags(message), tags(reference), `${key}: marcações em ${LOCALES[index + 1]}`);
    }
  }

  // Namespaces tocados seguem com as mesmas chaves nos três idiomas.
  for (const namespace of ['Checkout', 'Voucher', 'Event.sidebar']) {
    const [reference, ...others] = LOCALES.map((locale) => flattenKeys(getMessage(locale, namespace)).sort());
    for (const keys of others) assert.deepEqual(keys, reference, namespace);
  }

  for (const locale of LOCALES) {
    assert.match(getMessage(locale, 'Checkout.orderSummaryShirts'), /^\{count, plural, one \{[^{}]*# × \{amount\}[^{}]*\} other \{[^{}]*# × \{amount\}[^{}]*\}\}$/);
  }

  assert.equal(getMessage('pt-br', 'Checkout.shirtNoneOption'), 'Sem camisa (sem adicional)');
  assert.equal(getMessage('pt-br', 'Checkout.couponShirtNotice'), 'O cupom desconta a inscrição. A camisa é cobrada à parte; escolha “Sem camisa” para não pagar por ela.');
  assert.equal(getMessage('pt-br', 'Event.sidebar.optionalShirt'), 'Camisa opcional: <price>+ {amount}</price> por atleta');
  assert.equal(getMessage('pt-pt', 'Checkout.shirtNoneOption'), 'Sem t-shirt (sem adicional)');
  assert.match(getMessage('pt-pt', 'Checkout.couponShirtNotice'), /^O cupão desconta a inscrição\. A t-shirt é cobrada à parte/);
  assert.equal(getMessage('en-gb', 'Checkout.shirtNoneOption'), 'No shirt (no extra charge)');
  assert.match(getMessage('en-gb', 'Event.sidebar.optionalShirt'), /^Optional shirt:/);

  // Aviso de valores recalculados pelo servidor (M-1): novo total e convite a confirmar de novo.
  assert.equal(getMessage('pt-br', 'Checkout.amountsUpdatedNotice'), 'Os valores desta inscrição foram atualizados. O novo total é {amount}. Confira e confirme de novo para continuar.');
  assert.match(getMessage('pt-pt', 'Checkout.amountsUpdatedNotice'), /^Os valores desta inscrição foram atualizados\. O novo total é \{amount\}\./);
  assert.match(getMessage('en-gb', 'Checkout.amountsUpdatedNotice'), /^The amounts for this registration have been updated\. The new total is \{amount\}\./);

  // R2-L-1: aviso na tela de sucesso (já confirmada) e orientação quando o novo envio é recusado.
  assert.equal(getMessage('pt-br', 'Checkout.amountsUpdatedConfirmedNotice'), 'Os valores desta inscrição foram atualizados. O total final é {amount} e a inscrição já está confirmada.');
  assert.equal(getMessage('pt-br', 'Checkout.registrationAlreadyStartedGuidance'), 'Se você já iniciou esta inscrição, conclua o pagamento pela Área do Atleta.');
  assert.match(getMessage('pt-pt', 'Checkout.registrationAlreadyStartedGuidance'), /Área do Atleta/);
  assert.match(getMessage('en-gb', 'Checkout.registrationAlreadyStartedGuidance'), /Athlete Area/);
  for (const locale of LOCALES) {
    assert.doesNotMatch(getMessage(locale, 'Checkout.amountsUpdatedConfirmedNotice'), /confirme de novo|confirme novamente|confirm again/, locale);
  }
});

test('pagamento não conhece a camisa: rotas e modais cobram o total_paid gravado (AC7)', () => {
  for (const [name, source] of Object.entries(paymentRoutes)) {
    assert.doesNotMatch(source, /shirt/i, `rota ${name}`);
  }
  for (const [name, source] of Object.entries({ card: cardModal, pix: pixModal })) {
    assert.match(source, /const activeTotalPaid = registration\.totalPaid > 0/, `modal ${name}`);
    // Tamanhos (inclusive NONE) só trafegam; a cobrança sai do snapshot do servidor.
    assert.match(source, /shirtSize: athlete\.shirtSize,/, `modal ${name}`);
    assert.doesNotMatch(source, /shirtAddon|shirtPricing|SHIRT_NONE/, `modal ${name}`);
  }
});
