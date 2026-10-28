import type { ShirtMode } from '@/lib/shirtPricing';
import type { WorkoutStructure } from '@/lib/workoutStructure';

export type { ShirtMode };

export type EventStatus = 'upcoming' | 'live' | 'finished';
export type EventType = 'functional_fitness' | 'fitness_racing' | 'functional_fitness_qualifier';
export type WorkoutType = 'fortime' | 'amrap' | 'maxweight' | 'reps' | 'points' | 'distance' | 'tonnage';
export type CategoryType = 'male' | 'female' | 'team';
export type ShirtSize = 'PP' | 'P' | 'M' | 'G' | 'GG' | 'XG' | 'XXG';
export type ManagerAccessStatus = 'active' | 'expired' | 'expiring_soon' | 'unconfigured';

export type AppLocale = 'pt-br' | 'pt-pt' | 'en-gb';
export type EventCountryCode = 'BR' | 'PT' | 'GB';
export type EventCurrency = 'BRL' | 'EUR' | 'GBP';
export type PaymentGateway = 'mercadopago' | 'stripe';
export type CommercialLeadCountry = 'BR' | 'PT' | 'GB' | 'OTHER';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string; // Opcional no client-side por segurança conceitual
  role: 'owner' | 'manager' | 'athlete' | 'judge';
  organization?: string;
  parentManagerId?: string;
  serviceValidUntil?: string;
  managerAccessStatus?: ManagerAccessStatus;
  locale?: AppLocale;
}

export type RegistrationPaymentStatus =
  | 'payment_pending'
  | 'payment_approved'
  | 'payment_failed'
  | 'payment_in_review'
  | 'payment_cancelled';

export type RegistrationRefundStatus = 'not_requested' | 'manual_pending' | 'manual_refunded';

export type ContestationStatus = 'under_review' | 'approved' | 'rejected';
export type CommercialLeadStatus = 'new' | 'contacted' | 'qualified' | 'discarded';
export type CommercialLeadEmailNotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface CourseStage {
  id: string;
  name: string;
  type: 'run' | 'station';
  orderIndex: number;
  distance?: string;
  reps?: number;
  maleWeight?: string;
  femaleWeight?: string;
}

export interface Division {
  id: string;
  name: string;      // Ex: "RX", "Scale", "Intermediário", "Master 35+"
  category: CategoryType;
  type: 'individual' | 'duo' | 'trio' | 'team' | 'team4' | 'team6';
  slotsLimit: number;
  price: number;
  isActive: boolean;
  orderIndex?: number; // Ordem de exibição definida pelo gestor (arrastar e soltar)
  useAgeGroups?: boolean;
  ageGroups?: string[];
  courseLayout?: CourseStage[];
  isCoursePublished?: boolean;
}

export interface Workout {
  id: string;
  name: string;        // Ex: "WOD 1 - DT Speed"
  description: string; // Ex: "5 Rounds: 12 Deadlifts, 9 Hang Power Cleans, 6 Push Jerks"
  type: WorkoutType;
  timeCap?: string;    // Ex: "10:00" ou null se for carga máxima
  code: string;        // Ex: "WOD 1" ou "WOD 2A"
  orderIndex: number;
  divisionId?: string; // Categoria vinculada
  tieBreaker?: string; // Critério de desempate
  /** Estrutura da prova para a súmula digital (Story 1.43). Ausente ou null = prova só com texto. */
  structure?: WorkoutStructure | null;
  submissionOpensAt?: string;
  submissionClosesAt?: string;
}

export type EventScheduleItemKind = 'briefing' | 'kit_delivery' | 'event' | 'heat' | 'deadline';
export type EventScheduleMode = 'online' | 'presential';

export interface EventScheduleItem {
  id: string;
  kind: EventScheduleItemKind;
  mode?: EventScheduleMode;
  date: string;
  time: string;
  title: string;
  description: string;
  location?: string;
  workoutId?: string;
  heatNumber?: number;
  warmupTime?: string;
  checkinTime?: string;
  endTime?: string;
  athleteIds?: string[];
  capacity?: number;
  isPublished?: boolean;
  isCallReleased?: boolean;
  // Bateria por prova do evento (Story 1.87): aceita atletas de qualquer categoria.
  // Bateria antiga (por categoria) só tem `workoutId` e continua valendo.
  stageNumber?: number;
  stageTitle?: string;
  // Prova de cada categoria nesta prova do evento: { [divisionId]: workoutId } ('' = sem prova).
  stageWorkouts?: Record<string, string>;
  // Prova de cada raia, alinhada com `athleteIds` ('' = raia livre).
  laneWorkoutIds?: string[];
}

export interface Athlete {
  id: string;
  name: string;
  box: string;         // Box / Afiliado
  country: string;     // Ex: "BR" ou "US"
  divisionId: string;  // Vinculado a uma Division
  birthDate?: string;
  gender?: 'male' | 'female';
  city?: string;
  state?: string;
  instagram?: string;
  photoUrl?: string;
  shirtSize?: ShirtSize | string;
  email?: string;
  phone?: string;
  isTeam?: boolean;
  teamMembers?: { name: string; instagram: string; shirtSize?: ShirtSize | string; }[];
}

export interface Score {
  athleteId: string;
  workoutId: string;
  result: string;      // Representação textual (ex: "08:14", "125 reps", "110 kg")
  value: number;       // Valor numérico para comparação/ordenação (ex: segundos, repetições, quilos)
  rank?: number;       // Colocação na prova
  points?: number;     // Pontos ganhos na prova (ex: 100, 95, 90...)
  splits?: Record<string, string>;
  resultStatus?: 'validated' | 'penalized' | 'rejected' | 'manual' | 'absent';
  penaltyPercent?: number;
  /** Qualifier: envio feito e ainda sem revisão do judge (só nos scores sintéticos do ranking). */
  awaitingReview?: boolean;
}

export interface AthleteOverall {
  athlete: Athlete;
  scores: Record<string, Score>; // workoutId -> Score
  totalPoints: number;
  rank: number;
}

export interface Event {
  id: string;
  name: string;
  logoUrl: string;
  bannerUrl: string;
  status: EventStatus;
  location: string;
  // Rótulo da data como o gestor quer exibir ("17 e 18 de outubro"). Quem
  // decide se o evento já aconteceu são startDate/endDate (Story 1.71).
  date: string;
  // Primeiro e último dia do evento (YYYY-MM-DD). Ausentes em evento antigo
  // ou em banco sem a migration: aí vale a leitura do texto de `date`.
  startDate?: string;
  endDate?: string;
  description: string;
  organizerId: string;
  sponsors: string[];
  divisions: Division[];
  workouts: Workout[];
  format: 'individual' | 'duo' | 'trio';
  ticketPrice: number;
  ticketSlots: number;
  isTicketingActive: boolean;
  time?: string;
  city?: string;
  state?: string;
  rules?: string;
  instagram?: string;
  website?: string;
  eventType?: EventType;
  scheduleItems?: EventScheduleItem[];
  mpPublicKey?: string;
  marketplace_fee?: number;
  registrationDeadline?: string;
  isFeatured?: boolean;
  countryCode?: EventCountryCode;
  currency?: EventCurrency;
  timeZone?: string;
  paymentGateway?: PaymentGateway;
  defaultLocale?: AppLocale;
  shirtMode?: ShirtMode;
  shirtAddonPrice?: number;
  // Ponto do local no mapa (Story 1.41). O mapper do banco devolve undefined
  // quando não há ponto; null existe para o updateEvent poder remover o ponto.
  latitude?: number | null;
  longitude?: number | null;
}

export interface Registration {
  id: string;
  eventId: string;
  divisionId: string;
  userId?: string;
  athleteId?: string;
  athleteName: string;
  athleteEmail: string;
  athletePhone: string;
  box: string;
  gender: 'male' | 'female';
  ticketType: string;
  ticketPrice: number;
  quantity: number;
  totalPaid: number;
  serviceFeePercent?: number;
  serviceFeeAmount?: number;
  // Quem pagou a taxa nesta inscrição: 'athlete' | 'organizer'. Vazio = anterior à
  // escolha do gestor; vale o padrão do gateway (ver resolveServiceFeePayer).
  serviceFeePayer?: 'athlete' | 'organizer';
  amountCollected?: number;
  applicationFeeCharged?: number;
  shirtAddonCount?: number;
  shirtAddonAmount?: number;
  createdAt: string;
  accessToken?: string;
  couponCode?: string;
  paymentStatus?: RegistrationPaymentStatus;
  paymentMethod?: string;
  paymentId?: string;
  paymentStatusDetail?: string;
  paymentErrorMessage?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  refundStatus?: RegistrationRefundStatus;
  refundAmount?: number;
  refundMethod?: string;
  refundNote?: string;
  refundProcessedAt?: string;
  refundProcessedBy?: string;
  updatedAt?: string;
  currency?: EventCurrency;
  paymentGateway?: PaymentGateway;
  locale?: AppLocale;
}

export interface Contestation {
  id: string;
  eventId: string;
  registrationId: string;
  userId: string;
  athleteId?: string;
  workoutId: string;
  heatId?: string;
  heatNumber?: number;
  lane?: string;
  submissionId?: string;
  description: string;
  status: ContestationStatus;
  creditConsumed: boolean;
  creditRefunded: boolean;
  managerNote?: string;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string;
}

export type ScoreSubmissionStatus = 'pending_review' | 'validated' | 'penalized' | 'rejected' | 'awaiting_resubmission';
export type ScoreSubmissionEntrySource = 'athlete' | 'manager';
export type ScoreSubmissionDecision = 'validated' | 'penalized' | 'rejected' | 'manual_adjustment' | 'reopened' | 'resubmission_requested';

export interface ScoreSubmission {
  id: string;
  eventId: string;
  workoutId: string;
  divisionId: string;
  registrationId: string;
  userId: string;
  athleteId?: string;
  submittedResult: string;
  submittedValue: number;
  // Vazios quando o resultado foi lançado pela organização (entrySource 'manager'), sem vídeo.
  videoUrl: string;
  videoId: string;
  athleteNote?: string;
  entrySource: ScoreSubmissionEntrySource;
  status: ScoreSubmissionStatus;
  finalResult?: string;
  finalValue?: number;
  penaltyPercent?: number;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreSubmissionReview {
  id: string;
  submissionId: string;
  submissionVersion: number;
  eventId: string;
  judgeUserId?: string;
  judgeName: string;
  judgeRole: 'judge' | 'manager' | 'owner';
  decision: ScoreSubmissionDecision;
  penaltyPercent?: number;
  previousResult?: string;
  previousValue?: number;
  appliedResult?: string;
  appliedValue?: number;
  justification?: string;
  reviewedAt: string;
}

export interface Coupon {
  id: string;
  eventId: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  usageLimit: number;
  usageCount: number;
  createdAt: string;
  isActive: boolean;
}

export interface CommercialLead {
  id: string;
  managerName: string;
  phone: string;
  phoneNormalized: string;
  eventName: string;
  city: string;
  state: string;
  country: CommercialLeadCountry;
  countryOther?: string;
  leadStatus: CommercialLeadStatus;
  acceptedTerms: boolean;
  acceptedAt: string;
  termsVersion: string;
  source: string;
  ownerEmailNotificationStatus: CommercialLeadEmailNotificationStatus;
  ownerEmailNotifiedAt?: string;
  ownerEmailRecipient?: string;
  ownerEmailMessageId?: string;
  ownerEmailError?: string;
  submittedAt: string;
  updatedAt?: string;
}
