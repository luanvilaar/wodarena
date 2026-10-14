// Camisas por inscrição e resumo do pedido ao fornecedor (Story 1.38, D5).
// Módulo puro: a lista de inscrições, o cartão de resumo e a planilha do painel
// do gestor usam as mesmas contas, e o node --test importa este arquivo direto.
//
// Só há imports de tipo (apagados na execução). Por isso o valor reservado e os
// tamanhos são repetidos aqui, presos aos tipos de shirtPricing.ts: se a regra
// mudar lá, o typecheck acusa a diferença.

import type {
  SHIRT_NONE as SHIRT_NONE_RULE,
  SHIRT_SIZES as SHIRT_SIZES_RULE,
  ShirtSizeCode
} from '@/lib/shirtPricing';
import type { Athlete, Registration } from '@/types';

const SHIRT_NONE: typeof SHIRT_NONE_RULE = 'NONE';
const SHIRT_SIZES: typeof SHIRT_SIZES_RULE = ['P', 'M', 'G', 'GG'];

export const SHIRT_NONE_LABEL = 'Sem camisa';

export type ShirtSummaryAthlete = Pick<Athlete, 'id' | 'name' | 'divisionId' | 'shirtSize' | 'isTeam' | 'teamMembers'>;

export type ShirtSummaryRegistration = Pick<
  Registration,
  'athleteId' | 'athleteName' | 'divisionId' | 'paymentStatus' | 'refundStatus'
>;

export type RegistrationShirt = {
  /** Integrante (equipe) ou atleta (individual), quando o nome é conhecido. */
  name?: string;
  /** Valor gravado, sem espaços nas pontas: tamanho, NONE ou vazio (não informado). */
  size: string;
  /** Há camisa a produzir: tamanho informado e diferente de "Sem camisa". */
  hasShirt: boolean;
};

export type ShirtSummary = {
  /** Camisas pagas por tamanho da lista atual (P, M, G, GG). */
  sizes: Record<ShirtSizeCode, number>;
  /** Tamanhos gravados fora da lista atual (inscrições antigas), em ordem alfabética. */
  otherSizes: { size: string; count: number }[];
  /** Soma de todos os tamanhos pagos, inclusive os antigos. */
  totalToProduce: number;
  /** Participantes de inscrições pagas que escolheram "Sem camisa". */
  withoutShirt: number;
  /** Participantes de inscrições pagas sem tamanho gravado (ou sem cadastro de atleta). */
  missingSize: number;
  /** Camisas de inscrições pendentes ou em análise: ficam fora do pedido. */
  pendingShirts: number;
  /** Inscrições pagas consideradas no resumo. */
  paidRegistrations: number;
};

type ShirtOrderStage = 'paid' | 'pending' | 'excluded';

const PENDING_PAYMENT_STATUSES: ReadonlySet<unknown> = new Set(['payment_pending', 'payment_in_review']);

const readShirtValue = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim());

const isCurrentShirtSize = (value: string): value is ShirtSizeCode => (SHIRT_SIZES as readonly string[]).includes(value);

const toRegistrationShirt = (name: unknown, size: string): RegistrationShirt => {
  const participantName = typeof name === 'string' ? name.trim() : '';
  return {
    ...(participantName ? { name: participantName } : {}),
    size,
    hasShirt: size !== '' && size !== SHIRT_NONE
  };
};

/** "NONE" vira "Sem camisa"; tamanhos (atuais ou antigos) saem como foram gravados. */
export const formatShirtChoice = (size: unknown): string => {
  const value = readShirtValue(size);
  return value === SHIRT_NONE ? SHIRT_NONE_LABEL : value;
};

/** Integrantes da equipe na ordem da inscrição; vazio para atleta individual. */
export const getAthleteTeamMembers = (
  athlete?: Pick<ShirtSummaryAthlete, 'isTeam' | 'teamMembers'> | null
): NonNullable<Athlete['teamMembers']> => (
  athlete?.isTeam && Array.isArray(athlete.teamMembers) ? athlete.teamMembers : []
);

/**
 * Camisa de cada participante da inscrição, na ordem: um item no individual,
 * um por integrante na equipe. Equipe sem integrantes gravados usa a camisa do
 * cadastro principal. Sem cadastro de atleta, devolve um único participante sem
 * tamanho, para a inscrição aparecer como "sem tamanho informado".
 */
export const listRegistrationShirts = (
  registration: Pick<ShirtSummaryRegistration, 'athleteName'>,
  athlete?: ShirtSummaryAthlete | null
): RegistrationShirt[] => {
  if (!athlete) return [toRegistrationShirt(registration.athleteName, '')];

  const members = getAthleteTeamMembers(athlete);
  if (members.length > 0) {
    const mainSize = readShirtValue(athlete.shirtSize);
    // Mesmo critério da planilha anterior: na camisa inclusa a Bilheteria pode ter
    // gravado só o tamanho do responsável, que vale para o primeiro integrante.
    return members.map((member, index) => toRegistrationShirt(
      member?.name,
      readShirtValue(member?.shirtSize) || (index === 0 ? mainSize : '')
    ));
  }

  return [toRegistrationShirt(athlete.name, readShirtValue(athlete.shirtSize))];
};

/** Texto das camisas da inscrição, na ordem: "P · M · Sem camisa"; "-" quando não informado. */
export const formatRegistrationShirts = (shirts: readonly RegistrationShirt[]): string => (
  shirts.map(shirt => formatShirtChoice(shirt.size) || '-').join(' · ')
);

/** Coluna "Entrega" da planilha. */
export const getShirtDeliveryLabel = (shirt: RegistrationShirt): string => {
  if (shirt.hasShirt) return 'Produzir';
  if (shirt.size === SHIRT_NONE) return 'Não produzir (sem camisa)';
  return 'Tamanho não informado';
};

const athleteLookupKey = (name: unknown, divisionId: unknown) => {
  const normalizedName = typeof name === 'string' ? name.toLowerCase() : '';
  return normalizedName ? `${String(divisionId ?? '')}\u0000${normalizedName}` : '';
};

/**
 * Localiza o cadastro do atleta da inscrição: pelo athleteId e, sem ele (ou se
 * não for encontrado), pelo nome sem diferenciar maiúsculas dentro da mesma
 * categoria, como a planilha já fazia. Os índices evitam percorrer a lista de
 * atletas a cada inscrição.
 */
export const createRegistrationAthleteResolver = <A extends ShirtSummaryAthlete>(athletes: readonly A[]) => {
  const byId = new Map<string, A>();
  const byNameAndDivision = new Map<string, A>();

  for (const athlete of athletes) {
    if (athlete.id && !byId.has(athlete.id)) byId.set(athlete.id, athlete);
    const key = athleteLookupKey(athlete.name, athlete.divisionId);
    if (key && !byNameAndDivision.has(key)) byNameAndDivision.set(key, athlete);
  }

  return (registration: Pick<ShirtSummaryRegistration, 'athleteId' | 'athleteName' | 'divisionId'>): A | undefined => {
    const byAthleteId = registration.athleteId ? byId.get(registration.athleteId) : undefined;
    if (byAthleteId) return byAthleteId;
    const key = athleteLookupKey(registration.athleteName, registration.divisionId);
    return key ? byNameAndDivision.get(key) : undefined;
  };
};

// Pedido ao fornecedor: só inscrição paga. Pendente e em análise ficam à parte;
// cancelada, falha e reembolso (pendente ou feito) ficam de fora.
const getShirtOrderStage = (registration: ShirtSummaryRegistration): ShirtOrderStage => {
  if (registration.refundStatus === 'manual_pending' || registration.refundStatus === 'manual_refunded') return 'excluded';
  if (registration.paymentStatus === 'payment_approved') return 'paid';
  if (PENDING_PAYMENT_STATUSES.has(registration.paymentStatus)) return 'pending';
  return 'excluded';
};

export const buildShirtSummary = (
  registrations: readonly ShirtSummaryRegistration[],
  athletes: readonly ShirtSummaryAthlete[]
): ShirtSummary => {
  const resolveAthlete = createRegistrationAthleteResolver(athletes);
  const sizes = { P: 0, M: 0, G: 0, GG: 0 } satisfies Record<ShirtSizeCode, number>;
  const otherSizes = new Map<string, number>();
  let withoutShirt = 0;
  let missingSize = 0;
  let pendingShirts = 0;
  let paidRegistrations = 0;

  for (const registration of registrations) {
    const stage = getShirtOrderStage(registration);
    if (stage === 'excluded') continue;

    const shirts = listRegistrationShirts(registration, resolveAthlete(registration));
    if (stage === 'pending') {
      pendingShirts += shirts.filter(shirt => shirt.hasShirt).length;
      continue;
    }

    paidRegistrations += 1;
    for (const { size } of shirts) {
      if (!size) missingSize += 1;
      else if (size === SHIRT_NONE) withoutShirt += 1;
      else if (isCurrentShirtSize(size)) sizes[size] += 1;
      else otherSizes.set(size, (otherSizes.get(size) ?? 0) + 1);
    }
  }

  const otherSizeList = Array.from(otherSizes, ([size, count]) => ({ size, count }))
    .sort((a, b) => a.size.localeCompare(b.size, 'pt-BR'));
  const totalToProduce = SHIRT_SIZES.reduce((total, size) => total + sizes[size], 0)
    + otherSizeList.reduce((total, item) => total + item.count, 0);

  return {
    sizes,
    otherSizes: otherSizeList,
    totalToProduce,
    withoutShirt,
    missingSize,
    pendingShirts,
    paidRegistrations
  };
};

/** Linhas do bloco "Resumo do pedido" da planilha: as mesmas contagens do cartão. */
export const getShirtSummaryRows = (summary: ShirtSummary): [label: string, count: number][] => [
  ...SHIRT_SIZES.map((size): [string, number] => [size, summary.sizes[size]]),
  ...summary.otherSizes.map(({ size, count }): [string, number] => [`${size} (tamanho antigo)`, count]),
  ['Total a produzir', summary.totalToProduce],
  [SHIRT_NONE_LABEL, summary.withoutShirt],
  ['Sem tamanho informado', summary.missingSize],
  ['Camisas em inscrições pendentes (não incluídas)', summary.pendingShirts]
];
