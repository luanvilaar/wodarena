// Regra da camisa do evento (Story 1.38). Módulo puro, sem imports: checkout,
// Bilheteria, prévias do painel e servidor usam as mesmas funções, e o
// node --test importa este arquivo direto.
//
// Modo `included`: a camisa já vem no valor da categoria, sem adicional.
// Modo `optional`: cada participante escolhe um tamanho (paga o adicional do
// evento) ou "Sem camisa" (valor reservado NONE, sem adicional).

export const SHIRT_NONE = 'NONE';
export const SHIRT_SIZES = ['P', 'M', 'G', 'GG'] as const;
export const SHIRT_ADDON_PRICE_MAX = 10000;

export type ShirtMode = 'included' | 'optional';
export type ShirtSizeCode = typeof SHIRT_SIZES[number];

export type ShirtConfigResult =
  | { ok: true; mode: ShirtMode; price: number }
  | { ok: false; error: string };

export type ParticipantShirtsResult =
  | {
    ok: true;
    /** Tamanho saneado de cada participante, na ordem da inscrição. */
    sizes: string[];
    /** Participantes que pagam o adicional (sempre 0 no modo `included`). */
    addonCount: number;
    /** Valor saneado para `athletes.shirt_size`. */
    shirtSize: string;
    /** Integrantes com `shirtSize` saneado; vazio em categoria individual. */
    teamMembers: Record<string, unknown>[];
  }
  | { ok: false; error: string };

export type RegistrationShirtState = {
  isTeam?: unknown;
  shirtSize?: unknown;
  teamMembers?: unknown;
};

export type ShirtEditCheck =
  | { ok: true }
  | { ok: false; status: 400 | 409; error: string };

export type RegistrationAmountsInput = {
  ticketPrice: number;
  quantity: number;
  discount: number;
  shirtMode: unknown;
  shirtAddonPrice: number;
  shirtAddonCount: number;
};

export type RegistrationAmounts = {
  subtotal: number;
  discount: number;
  shirtAddonAmount: number;
  totalPaid: number;
};

const MINIMUM_CHARGE_CENTS = 100;

const SHIRT_EDIT_LOCKED_MESSAGE = 'Só é possível trocar o tamanho da camisa. Para incluir ou retirar a camisa, cancele e refaça a inscrição.';

const SHIRT_EDIT_BLANK_MESSAGE = 'O tamanho da camisa não pode ficar em branco. Escolha um tamanho para cada participante ou mantenha a opção já registrada.';

const INVALID_TEAM_MEMBERS_MESSAGE = 'Dados dos integrantes inválidos.';

// Mesmo arredondamento de serviceFee.ts: todo cálculo em centavos inteiros.
const toCents = (amount: number) => Math.max(0, Math.round((amount + Number.EPSILON) * 100));

const fromCents = (cents: number) => cents / 100;

const asFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

// Espaços nas pontas são removidos; maiúsculas não são corrigidas ('m' é inválido).
const readShirtField = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim());

const readMemberShirt = (member: unknown) => readShirtField(isRecord(member) ? member.shirtSize : undefined);

const parseTeamMembers = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const normalizeShirtMode = (value: unknown): ShirtMode => (value === 'optional' ? 'optional' : 'included');

export const isShirtSize = (value: unknown): value is ShirtSizeCode => (
  typeof value === 'string' && (SHIRT_SIZES as readonly string[]).includes(value)
);

export const isShirtNone = (value: unknown): value is typeof SHIRT_NONE => value === SHIRT_NONE;

const countNone = (sizes: string[]) => sizes.filter(isShirtNone).length;

const countBlank = (sizes: string[]) => sizes.filter((size) => !size).length;

export const getDivisionParticipantCount = (type: unknown): number => {
  switch (type) {
    case 'duo':
      return 2;
    case 'trio':
      return 3;
    case 'team':
    case 'team4':
      return 4;
    case 'team6':
      return 6;
    default:
      return 1;
  }
};

// Ausente ('' / null / undefined) vale 0; texto só com dígitos e ponto decimal.
const parsePriceInput = (value: unknown): number | null => {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
  }
  return null;
};

export const validateShirtConfig = ({ mode, price }: { mode: unknown; price: unknown }): ShirtConfigResult => {
  if (mode !== undefined && mode !== null && mode !== 'included' && mode !== 'optional') {
    return { ok: false, error: 'Modo de camisa inválido.' };
  }
  const shirtMode: ShirtMode = mode === 'optional' ? 'optional' : 'included';

  const parsed = parsePriceInput(price);
  if (parsed === null) {
    return { ok: false, error: 'Informe um valor adicional válido para a camisa.' };
  }
  if (parsed < 0) {
    return { ok: false, error: 'O valor adicional da camisa não pode ser negativo.' };
  }

  const cents = toCents(parsed);
  if (!Number.isFinite(cents)) {
    return { ok: false, error: 'Informe um valor adicional válido para a camisa.' };
  }
  if (shirtMode === 'optional' && cents <= 0) {
    return { ok: false, error: 'Informe um valor maior que zero.' };
  }
  // O teto vale também no modo incluso: o valor fica guardado e volta a valer
  // quando o gestor muda para opcional.
  if (cents > SHIRT_ADDON_PRICE_MAX * 100) {
    return { ok: false, error: 'O valor adicional da camisa não pode ser maior que 10.000.' };
  }

  return { ok: true, mode: shirtMode, price: fromCents(cents) };
};

const checkParticipantSize = (size: string, mode: ShirtMode, who: string): string | null => {
  if (!size) {
    // Vazio segue aceito no modo incluso (compatibilidade com a Bilheteria).
    return mode === 'optional' ? `Escolha o tamanho da camisa ou "Sem camisa"${who}.` : null;
  }
  if (isShirtSize(size)) return null;
  if (isShirtNone(size)) {
    return mode === 'optional'
      ? null
      : `Este evento já inclui a camisa no valor da inscrição. Escolha um tamanho (P, M, G ou GG)${who}.`;
  }
  return mode === 'optional'
    ? `Tamanho de camisa inválido${who}. Escolha P, M, G, GG ou "Sem camisa".`
    : `Tamanho de camisa inválido${who}. Escolha P, M, G ou GG.`;
};

const countAddonShirts = (mode: ShirtMode, sizes: string[]) => (
  mode === 'optional' ? sizes.filter(isShirtSize).length : 0
);

export const resolveParticipantShirts = ({
  mode,
  divisionType,
  athleteProfile
}: {
  mode: unknown;
  divisionType: unknown;
  athleteProfile: unknown;
}): ParticipantShirtsResult => {
  const shirtMode = normalizeShirtMode(mode);
  const profile = isRecord(athleteProfile) ? athleteProfile : {};
  const expectedParticipants = getDivisionParticipantCount(divisionType);
  const mainSize = readShirtField(profile.shirtSize);

  if (expectedParticipants === 1) {
    const error = checkParticipantSize(mainSize, shirtMode, '');
    if (error) return { ok: false, error };
    return {
      ok: true,
      sizes: [mainSize],
      addonCount: countAddonShirts(shirtMode, [mainSize]),
      shirtSize: mainSize,
      teamMembers: []
    };
  }

  const members = parseTeamMembers(profile.teamMembers);
  // Integrante que não é objeto quebra voucher e e-mail depois de gravado.
  if (!members.every(isRecord)) {
    return { ok: false, error: INVALID_TEAM_MEMBERS_MESSAGE };
  }
  // Cobrança por integrante: no modo opcional cada um precisa ter escolhido.
  if (shirtMode === 'optional' && members.length !== expectedParticipants) {
    return { ok: false, error: `Informe a camisa de cada um dos ${expectedParticipants} integrantes da equipe.` };
  }

  const sizes = members.map(readMemberShirt);
  for (const [index, size] of sizes.entries()) {
    const error = checkParticipantSize(size, shirtMode, ` para o atleta ${index + 1}`);
    if (error) return { ok: false, error };
  }

  // O campo principal da equipe espelha o primeiro integrante. No modo incluso
  // ele ainda serve de reserva quando a Bilheteria não preencheu o integrante.
  let shirtSize = sizes[0] || '';
  if (shirtMode === 'included') {
    const error = checkParticipantSize(mainSize, shirtMode, ' para o responsável pela inscrição');
    if (error) return { ok: false, error };
    shirtSize = shirtSize || mainSize;
  }

  return {
    ok: true,
    sizes,
    addonCount: countAddonShirts(shirtMode, sizes),
    shirtSize,
    teamMembers: members.map((member, index) => ({ ...member, shirtSize: sizes[index] }))
  };
};

const shirtAddonCents = (mode: unknown, price: unknown, count: unknown) => {
  if (normalizeShirtMode(mode) !== 'optional') return 0;
  return toCents(asFiniteNumber(price)) * Math.max(0, Math.trunc(asFiniteNumber(count)));
};

export const calculateShirtAddonAmount = (mode: unknown, price: unknown, count: unknown): number => (
  fromCents(shirtAddonCents(mode, price, count))
);

export const calculateRegistrationAmounts = ({
  ticketPrice,
  quantity,
  discount,
  shirtMode,
  shirtAddonPrice,
  shirtAddonCount
}: RegistrationAmountsInput): RegistrationAmounts => {
  const subtotalCents = toCents(asFiniteNumber(ticketPrice)) * Math.max(1, Math.trunc(asFiniteNumber(quantity)));
  // D1: o cupom desconta só a inscrição, nunca a camisa.
  const discountCents = Math.min(toCents(asFiniteNumber(discount)), subtotalCents);
  const addonCents = shirtAddonCents(shirtMode, shirtAddonPrice, shirtAddonCount);
  const totalCents = subtotalCents - discountCents + addonCents;

  return {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    shirtAddonAmount: fromCents(addonCents),
    // Regra atual: total entre 0 e 1 cobra o mínimo de 1,00; total 0 continua gratuito.
    totalPaid: fromCents(totalCents > 0 && totalCents < MINIMUM_CHARGE_CENTS ? MINIMUM_CHARGE_CENTS : totalCents)
  };
};

// Tamanhos por participante: integrantes na equipe, o próprio atleta no individual.
const getRegistrationShirtSizes = ({ isTeam, shirtSize, teamMembers }: RegistrationShirtState): string[] => {
  const members = parseTeamMembers(teamMembers);
  return Boolean(isTeam) && members.length > 0 ? members.map(readMemberShirt) : [readShirtField(shirtSize)];
};

/**
 * D4: a edição pelo gestor só troca o tamanho. Mudar a quantidade de
 * participantes "Sem camisa" muda o valor devido, então é recusada (409).
 * Valores já gravados fora da lista atual (legado, de qualquer participante)
 * seguem aceitos, para não travar a correção de nome, e-mail ou categoria.
 */
export const checkRegistrationShirtEdit = (
  current: RegistrationShirtState,
  next: RegistrationShirtState
): ShirtEditCheck => {
  const currentSizes = getRegistrationShirtSizes(current);
  const nextSizes = getRegistrationShirtSizes(next);
  const currentMain = readShirtField(current.shirtSize);
  const nextMain = readShirtField(next.shirtSize);
  const storedValues = new Set([...currentSizes, currentMain]);
  const isAcceptable = (size: string) => !size || isShirtSize(size) || isShirtNone(size) || storedValues.has(size);

  if (!nextSizes.every(isAcceptable) || !isAcceptable(nextMain)) {
    return { ok: false, status: 400, error: 'Tamanho de camisa inválido. Escolha P, M, G ou GG.' };
  }

  // Vazio vira NULL na RPC e a camisa (paga ou "Sem camisa") some do pedido e
  // da produção. Só não pode aumentar: cadastro antigo já em branco segue
  // editável. Na equipe o campo principal é reserva do 1º integrante no resumo.
  if (countBlank(nextSizes) > countBlank(currentSizes) || (currentMain !== '' && nextMain === '')) {
    return { ok: false, status: 409, error: SHIRT_EDIT_BLANK_MESSAGE };
  }

  const currentNone = countNone(currentSizes);
  if (countNone(nextSizes) !== currentNone) {
    return { ok: false, status: 409, error: SHIRT_EDIT_LOCKED_MESSAGE };
  }

  // Na equipe o campo principal não entra na contagem; "Sem camisa" nele só
  // vale se a inscrição já tinha alguém sem camisa.
  if (isShirtNone(nextMain) && !isShirtNone(currentMain) && currentNone === 0) {
    return { ok: false, status: 409, error: SHIRT_EDIT_LOCKED_MESSAGE };
  }

  return { ok: true };
};
