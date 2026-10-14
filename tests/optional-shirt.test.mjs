import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Regressão estática da Story 1.38 (camisa opcional com adicional): o servidor
// calcula e valida a camisa, o cupom não desconta a camisa e nenhuma rota de
// pagamento muda.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const shirtPricing = read('../src/lib/shirtPricing.ts');
const serverCheckout = read('../src/lib/serverCheckout.ts');
const startRoute = read('../src/app/api/registrations/start/route.ts');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const bootstrapPayload = read('../src/lib/bootstrapPayload.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const types = read('../src/types/index.ts');

const paymentRoutes = {
  card: read('../src/app/api/checkout/card/route.ts'),
  pix: read('../src/app/api/checkout/pix/route.ts'),
  preference: read('../src/app/api/checkout/preference/route.ts'),
  status: read('../src/app/api/checkout/status/route.ts'),
  mercadopagoWebhook: read('../src/app/api/webhooks/mercadopago/route.ts'),
  stripeWebhook: read('../src/app/api/webhooks/stripe/route.ts'),
  stripeReturn: read('../src/app/api/stripe/return/route.ts')
};

const block = (source, pattern) => source.match(pattern)?.[0] || '';
const caseBlock = (name) => block(persistenceRoute, new RegExp(`case '${name}': \\{[\\s\\S]*?\\n {6}\\}`));
const selectList = (source, constName) => source.match(new RegExp(`const ${constName} = '([^']*)'`))?.[1] || '';

const snapshotBlock = block(serverCheckout, /export const calculateSecureRegistrationSnapshot[\s\S]*?\n\};/);
const couponBlock = block(serverCheckout, /export const validateCheckoutCoupon[\s\S]*?\n\};/);
const managerBlock = block(serverCheckout, /export const createManagerRegistration[\s\S]*?\n\};/);
const loadSnapshotBlock = block(serverCheckout, /export const loadRegistrationCheckoutSnapshot[\s\S]*?\n\};/);
const emailTriggerBlock = block(serverCheckout, /export const triggerRegistrationApprovedEmail[\s\S]*?\n\};/);

test('shirtPricing é um módulo puro: sem imports, sem enum e sem alias', () => {
  assert.doesNotMatch(shirtPricing, /^\s*import\s/m);
  assert.doesNotMatch(shirtPricing, /\benum\b/);
  assert.doesNotMatch(shirtPricing, /from '@\//);
  assert.match(shirtPricing, /Math\.round\(\(amount \+ Number\.EPSILON\) \* 100\)/);
});

test('o snapshot do checkout valida a camisa e calcula o total no servidor', () => {
  assert.match(serverCheckout, /import \{ calculateRegistrationAmounts, getDivisionParticipantCount, normalizeShirtMode, resolveParticipantShirts \} from '@\/lib\/shirtPricing'/);
  assert.ok(snapshotBlock, 'calculateSecureRegistrationSnapshot deve existir');
  assert.match(snapshotBlock, /is_ticketing_active, shirt_mode, shirt_addon_price'\)/);
  assert.match(snapshotBlock, /resolveParticipantShirts\(\{ mode: shirtMode, divisionType: division\.type, athleteProfile \}\)/);
  assert.match(snapshotBlock, /throw new RegistrationAccessError\(shirts\.error, 400\)/);
  assert.match(snapshotBlock, /calculateRegistrationAmounts\(\{[\s\S]*discount,[\s\S]*shirtAddonPrice: asNumber\(event\.shirt_addon_price, 0\),[\s\S]*shirtAddonCount: shirts\.addonCount[\s\S]*\}\)/);
  assert.match(snapshotBlock, /const transactionAmount = amounts\.totalPaid/);
  assert.doesNotMatch(snapshotBlock, /subtotal - discount/);
  // Valores do navegador são sobrescritos: o spread vem antes dos campos do servidor.
  assert.match(snapshotBlock, /\.\.\.clientRegistrationData,[\s\S]*ticketPrice,[\s\S]*totalPaid: transactionAmount,[\s\S]*shirtAddonCount: shirts\.addonCount,[\s\S]*shirtAddonAmount: amounts\.shirtAddonAmount/);
  assert.match(snapshotBlock, /athleteProfile: \{\s*\.\.\.clientAthleteProfile,\s*isTeam,\s*shirtSize: shirts\.shirtSize,\s*teamMembers: shirts\.teamMembers\s*\}/);
  // Validações existentes continuam antes do cálculo.
  assert.match(snapshotBlock, /assertRegistrationAvailableForEvent\(event\)[\s\S]*assertManagerSalesAccessForEvent[\s\S]*division\.is_active === false[\s\S]*resolveParticipantShirts[\s\S]*divisionSlotsLimit/);
});

test('o cupom incide só sobre a categoria, nunca sobre a camisa (D1)', () => {
  assert.doesNotMatch(couponBlock, /shirt/i);
  assert.equal(serverCheckout.match(/calculateDiscount\(/g)?.length, 1);
  assert.match(couponBlock, /calculateDiscount\(ticketPrice, coupon\.discount_type, coupon\.discount_value\)/);
  assert.match(shirtPricing, /const discountCents = Math\.min\(toCents\(asFiniteNumber\(discount\)\), subtotalCents\)/);
  assert.match(shirtPricing, /const totalCents = subtotalCents - discountCents \+ addonCents/);
});

test('o checkout público grava o adicional calculado e o perfil saneado', () => {
  assert.match(startRoute, /calculateSecureRegistrationSnapshot\(supabaseAdmin, registrationData, athleteProfile\)/);
  assert.match(startRoute, /const safeAthleteProfile = secureSnapshot\.athleteProfile/);
  assert.match(startRoute, /shirt_addon_count: Number\(safeRegistrationData\.shirtAddonCount \|\| 0\)/);
  assert.match(startRoute, /shirt_addon_amount: Number\(safeRegistrationData\.shirtAddonAmount \|\| 0\)/);
  assert.match(startRoute, /total_paid: Number\(safeRegistrationData\.totalPaid\)/);
  assert.match(startRoute, /team_members: safeAthleteProfile\.teamMembers/);
  assert.doesNotMatch(startRoute, /shirt_size: athleteProfile\.|team_members: athleteProfile\./);
  // A resposta devolve os valores calculados no servidor.
  assert.match(startRoute, /registrationData: \{\s*\.\.\.safeRegistrationData,/);
  // Total zero (convite 100% e "Sem camisa") continua nascendo aprovado.
  assert.match(startRoute, /secureSnapshot\.transactionAmount === 0 \? 'payment_approved' : 'payment_pending'/);
});

test('a Bilheteria passa os tamanhos pelo mesmo cálculo do checkout', () => {
  assert.match(managerBlock, /calculateSecureRegistrationSnapshot\([\s\S]*\{\s*shirtSize: input\.shirtSize,\s*teamMembers: input\.teamMembers \|\| \[\]\s*\}/);
  assert.match(managerBlock, /const safeShirtSize = asString\(secureSnapshot\.athleteProfile\.shirtSize\) \|\| null/);
  assert.match(managerBlock, /JSON\.stringify\(secureSnapshot\.athleteProfile\.teamMembers \|\| \[\]\)/);
  assert.doesNotMatch(managerBlock, /shirt_size: input\.shirtSize|JSON\.stringify\(input\.teamMembers/);
  assert.match(managerBlock, /shirt_addon_count: Number\(safeRegistrationData\.shirtAddonCount \|\| 0\)/);
  assert.match(managerBlock, /shirt_addon_amount: Number\(safeRegistrationData\.shirtAddonAmount \|\| 0\)/);
  assert.match(managerBlock, /secureSnapshot\.transactionAmount === 0 \? 'payment_approved' : 'payment_pending'/);

  const createRegistration = caseBlock('createRegistration');
  assert.match(createRegistration, /shirtSize: asTrimmed\(athleteProfile\?\.shirtSize\) \|\| undefined/);
  assert.match(createRegistration, /teamMembers: Array\.isArray\(athleteProfile\?\.teamMembers\)/);
  assert.match(createRegistration, /error instanceof RegistrationAccessError[\s\S]*status: error\.status/);
});

test('is_team sai da categoria no servidor, não do navegador (L-5)', () => {
  // Mesma fonte dos tamanhos: o tipo da categoria lido do banco.
  assert.match(snapshotBlock, /const isTeam = getDivisionParticipantCount\(division\.type\) > 1;/);
  assert.match(snapshotBlock, /resolveParticipantShirts[\s\S]*const isTeam = getDivisionParticipantCount[\s\S]*athleteProfile: \{\s*\.\.\.clientAthleteProfile,\s*isTeam,/);

  // Checkout público grava o perfil saneado devolvido pelo snapshot.
  assert.match(startRoute, /is_team: safeAthleteProfile\.isTeam \|\| false/);
  assert.doesNotMatch(startRoute, /is_team: athleteProfile\./);

  // Bilheteria: nem o snapshot nem a gravação usam o isTeam enviado pelo painel.
  assert.match(managerBlock, /const safeIsTeam = Boolean\(secureSnapshot\.athleteProfile\.isTeam\);/);
  assert.equal(managerBlock.match(/is_team: safeIsTeam/g)?.length, 2);
  assert.doesNotMatch(managerBlock, /input\.isTeam/);
  assert.doesNotMatch(block(serverCheckout, /export type ManagerRegistrationInput = \{[\s\S]*?\n\};/), /isTeam/);
  assert.doesNotMatch(caseBlock('createRegistration'), /isTeam/);
});

test('pagamento, conciliação e e-mail leem o adicional já gravado', () => {
  assert.match(loadSnapshotBlock, /shirtAddonCount: Number\(registration\.shirt_addon_count\) \|\| 0/);
  assert.match(loadSnapshotBlock, /shirtAddonAmount: Number\(registration\.shirt_addon_amount\) \|\| 0/);
  assert.match(emailTriggerBlock, /shirtMode: normalizeShirtMode\(dbEvent\.shirt_mode\)/);
  assert.match(emailTriggerBlock, /shirtAddonPrice: Number\(dbEvent\.shirt_addon_price\) \|\| 0/);
  assert.match(emailTriggerBlock, /shirtAddonCount: Number\(snapshot\.registrationData\.shirtAddonCount\) \|\| 0/);
  assert.match(emailTriggerBlock, /shirtAddonAmount: Number\(snapshot\.registrationData\.shirtAddonAmount\) \|\| 0/);
});

test('nenhuma rota de pagamento conhece a camisa: cobram o total_paid gravado (AC7)', () => {
  for (const [name, source] of Object.entries(paymentRoutes)) {
    assert.doesNotMatch(source, /shirt_addon|shirtAddon|shirt_mode|shirtMode|shirtPricing/, `rota ${name}`);
  }
});

test('createEvent e updateEvent validam modo e adicional da camisa', () => {
  const updatableFields = persistenceRoute.match(/const EVENT_UPDATABLE_FIELDS = \[([\s\S]*?)\] as const;/)?.[1] || '';
  assert.match(updatableFields, /'shirt_mode'/);
  assert.match(updatableFields, /'shirt_addon_price'/);
  assert.match(persistenceRoute, /import \{ checkRegistrationShirtEdit, validateShirtConfig \} from '@\/lib\/shirtPricing'/);

  const createEvent = caseBlock('createEvent');
  assert.match(createEvent, /if \('shirt_mode' in event \|\| 'shirt_addon_price' in event\)/);
  assert.match(createEvent, /validateShirtConfig\(\{ mode: event\.shirt_mode, price: event\.shirt_addon_price \}\)/);
  assert.match(createEvent, /error: shirtConfig\.error \}, \{ status: 400 \}/);
  assert.match(createEvent, /event\.shirt_mode = shirtConfig\.mode;\s*event\.shirt_addon_price = shirtConfig\.price;/);
  assert.match(createEvent, /validateShirtConfig[\s\S]*from\('events'\)\.insert\(event\)/);

  const updateEvent = caseBlock('updateEvent');
  assert.match(updateEvent, /ensureEventOwner\(supabaseAdmin, actor, payload\.eventId\)[\s\S]*validateShirtConfig/);
  assert.match(updateEvent, /\.select\('shirt_mode, shirt_addon_price'\)/);
  assert.match(updateEvent, /mode: 'shirt_mode' in allowedData \? allowedData\.shirt_mode : currentShirt\.shirt_mode/);
  assert.match(updateEvent, /price: 'shirt_addon_price' in allowedData \? allowedData\.shirt_addon_price : currentShirt\.shirt_addon_price/);
  assert.match(updateEvent, /error: shirtConfig\.error \}, \{ status: 400 \}/);
  assert.match(updateEvent, /allowedData\.shirt_mode = shirtConfig\.mode;\s*allowedData\.shirt_addon_price = shirtConfig\.price;/);
  assert.match(updateEvent, /validateShirtConfig[\s\S]*from\('events'\)\.update\(allowedData\)/);
});

test('editar inscrição só troca o tamanho: com ↔ sem camisa responde 409 (D4)', () => {
  const updateRegistration = caseBlock('updateRegistration');
  assert.match(updateRegistration, /\.from\('athletes'\)\s*\.select\('shirt_size, team_members, is_team'\)\s*\.eq\('id', registration\.athlete_id\)/);
  assert.match(updateRegistration, /checkRegistrationShirtEdit\(/);
  assert.match(updateRegistration, /isTeam: nextIsTeam \?\? currentAthlete\?\.is_team/);
  assert.match(updateRegistration, /shirtSize: nextShirtSize/);
  assert.match(updateRegistration, /teamMembers: nextMembers \?\? currentAthlete\?\.team_members/);
  assert.match(updateRegistration, /return NextResponse\.json\(\{ error: shirtEdit\.error \}, \{ status: shirtEdit\.status \}\)/);
  assert.match(updateRegistration, /checkRegistrationShirtEdit[\s\S]*\.rpc\('admin_update_registration_details'/);
  assert.match(shirtPricing, /status: 409, error: SHIRT_EDIT_LOCKED_MESSAGE/);
  assert.match(shirtPricing, /'Só é possível trocar o tamanho da camisa\. Para incluir ou retirar a camisa, cancele e refaça a inscrição\.'/);
  // O valor pago e as camisas cobradas seguem preservados: a RPC não recebe valores.
  const rpcArguments = block(updateRegistration, /\.rpc\('admin_update_registration_details', \{[\s\S]*?\}\)/);
  assert.ok(rpcArguments, 'chamada da RPC deve existir');
  assert.doesNotMatch(rpcArguments, /total|shirt_addon|price/i);
});

test('respostas de inscrição do painel trazem o adicional da camisa', () => {
  const mapper = block(persistenceRoute, /const mapRegistrationForClient = [\s\S]*?\n\}\);/);
  assert.match(mapper, /shirtAddonCount: Number\(registration\.shirt_addon_count\) \|\| 0/);
  assert.match(mapper, /shirtAddonAmount: Number\(registration\.shirt_addon_amount\) \|\| 0/);
  const updateRegistration = caseBlock('updateRegistration');
  assert.match(updateRegistration, /shirtAddonCount: Number\(updatedRegistration\.shirt_addon_count\) \|\| 0/);
  assert.match(updateRegistration, /shirtAddonAmount: Number\(updatedRegistration\.shirt_addon_amount\) \|\| 0/);
});

test('bootstrap entrega modo e adicional do evento e o adicional da inscrição só no privado', () => {
  for (const constName of ['PUBLIC_EVENT_SELECT', 'PUBLIC_EVENT_SELECT_LEGACY']) {
    assert.match(selectList(bootstrapPayload, constName), /, shirt_mode, shirt_addon_price$/, constName);
  }
  assert.match(selectList(bootstrapRoute, 'PRIVATE_REGISTRATION_SELECT'), /shirt_addon_count, shirt_addon_amount/);
  // AC14: o bootstrap público não ganha dado novo de atleta nem de inscrição.
  assert.doesNotMatch(selectList(bootstrapPayload, 'PUBLIC_ATHLETE_SELECT'), /shirt_size/);
  assert.doesNotMatch(block(bootstrapPayload, /export const sanitizePublicAthlete[\s\S]*?\}\);/), /shirt_size/);
  assert.doesNotMatch(bootstrapPayload, /shirt_addon_count|shirt_addon_amount|from\('registrations'\)/);
});

test('AppContext e tipos propagam o modo, o adicional e as camisas cobradas', () => {
  assert.match(types, /import type \{ ShirtMode \} from '@\/lib\/shirtPricing'/);
  assert.match(types, /shirtMode\?: ShirtMode;\s*shirtAddonPrice\?: number;/);
  assert.match(types, /shirtAddonCount\?: number;\s*shirtAddonAmount\?: number;/);

  assert.match(appContext, /import \{ normalizeShirtMode \} from '@\/lib\/shirtPricing'/);
  assert.match(appContext, /shirtMode: normalizeShirtMode\(evt\.shirt_mode\),\s*shirtAddonPrice: Number\(evt\.shirt_addon_price\) \|\| 0/);
  assert.match(appContext, /shirtAddonCount: Number\(r\.shirt_addon_count\) \|\| 0,\s*shirtAddonAmount: Number\(r\.shirt_addon_amount\) \|\| 0/);

  const addEvent = block(appContext, /const addEvent = async[\s\S]*?\n {2}\};/);
  assert.match(addEvent, /shirtMode: normalizeShirtMode\(eventData\.shirtMode\)/);
  assert.match(addEvent, /shirtAddonPrice: Number\(eventData\.shirtAddonPrice\) \|\| 0/);
  assert.match(addEvent, /shirt_mode: newEvent\.shirtMode,\s*shirt_addon_price: newEvent\.shirtAddonPrice/);
  assert.match(addEvent, /adminPersist\('createEvent'/);

  const updateEvent = block(appContext, /const updateEvent = async[\s\S]*?\n {2}\};/);
  assert.match(updateEvent, /if \(updatedData\.shirtMode !== undefined\) dbPayload\.shirt_mode = updatedData\.shirtMode;/);
  assert.match(updateEvent, /if \(updatedData\.shirtAddonPrice !== undefined\) dbPayload\.shirt_addon_price = updatedData\.shirtAddonPrice;/);
  assert.match(updateEvent, /catch \(error\) \{\s*setEvents\(previousEvents\);/);
});

test('o método "free" é decisão do servidor, não do navegador', () => {
  assert.match(startRoute, /const safePaymentMethod = secureSnapshot\.transactionAmount === 0\s*\? 'free'\s*: \(paymentMethod === 'free' \? null : paymentMethod \|\| null\);/);
  assert.match(startRoute, /payment_method: safePaymentMethod,/);
  assert.doesNotMatch(startRoute, /payment_method: paymentMethod/);
});
