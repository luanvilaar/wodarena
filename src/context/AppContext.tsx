'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { WorkoutType, Event, Athlete, Division, Score, CourseStage, Coupon, Registration, User, Workout, AthleteOverall, EventScheduleItem, Contestation } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { buildFitnessRacingCourse, buildFitnessRacingDefaults, normalizeInstagram } from '@/lib/fitnessRacing';
import { mapContestationFromDb } from '@/lib/contestations';
import { getNextDivisionOrderIndex, sortDivisions } from '@/lib/divisionOrder';
import { getManagerAccessStatus, normalizeServiceValidUntil } from '@/lib/managerAccess';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeaderboardEntry = Record<string, any>;

const MAX_PUBLIC_EVENT_DATA_ATTEMPTS = 2;

type RegistrationDraft = Omit<Registration, 'id' | 'createdAt'> & Partial<Pick<Registration, 'id' | 'createdAt'>>;

export type BootstrapStatus = 'loading' | 'ready' | 'degraded' | 'error';
type PublicEventDataStatus = 'loading' | 'ready' | 'error';

export type RegistrationEditInput = {
  athleteName: string;
  box: string;
  divisionId: string;
  ticketType: string;
  gender?: 'male' | 'female';
  athleteEmail: string;
  athletePhone: string;
  instagram: string;
  shirtSize: string;
  isTeam: boolean;
  teamMembers: { name: string; instagram: string; shirtSize: string }[];
};

export type RegistrationCancellationInput = {
  reason: string;
  refundAmount?: number;
  refundMethod?: string;
  refundNote?: string;
};

export type RegistrationRefundInput = {
  refundAmount: number;
  refundMethod: string;
  refundNote?: string;
};

export type AthleteProfileUpdateInput = {
  fullName: string;
  birthDate: string;
};

type AthleteProfileDraft = {
  id?: string;
  birthDate?: string;
  gender?: 'male' | 'female';
  city?: string;
  state?: string;
  instagram?: string;
  photoUrl?: string;
  shirtSize?: string;
  email?: string;
  phone?: string;
  isTeam?: boolean;
  teamMembers?: { name: string; instagram: string; shirtSize?: string; }[];
};

interface AppContextType {
  isLoading: boolean;
  isSessionHydrated: boolean;
  bootstrapStatus: BootstrapStatus;
  bootstrapError: string | null;
  retryBootstrap: () => void;
  publicEventDataStatus: Record<string, PublicEventDataStatus>;
  loadPublicEventData: (eventId: string) => Promise<void>;
  events: Event[];
  athletes: Athlete[];
  scores: Score[];
  registrations: Registration[];
  registrationsCount: number | null;
  contestations: Contestation[];
  users: User[];
  currentUser: User | null;
  login: (email: string, password: string) => Promise<User | null>;
  logout: () => void;
  createManagerAccount: (name: string, email: string, password: string, organization: string, serviceValidUntil?: string) => Promise<boolean>;
  updateManagerServiceValidity: (userId: string, serviceValidUntil?: string | null) => Promise<User | null>;
  setFeaturedHomeEvent: (eventId: string | null) => Promise<void>;
  addEvent: (event: Omit<Event, 'id' | 'organizerId' | 'sponsors' | 'format' | 'ticketPrice' | 'ticketSlots' | 'isTicketingActive'> & { format?: 'individual' | 'duo' | 'trio'; ticketPrice?: number; ticketSlots?: number; isTicketingActive?: boolean; eventType?: 'functional_fitness' | 'fitness_racing'; }) => Promise<Event>;
  addDivision: (eventId: string, division: Omit<Division, 'id'>) => Promise<{ division: Division; autoWorkout: Workout | null }>;
  updateDivision: (eventId: string, divisionId: string, updatedData: Partial<Division>) => Promise<void>;
  reorderDivisions: (eventId: string, orderedIds: string[]) => Promise<void>;
  addWorkout: (eventId: string, workout: Omit<Workout, 'id'>) => Promise<Workout>;
  deleteEvent: (eventId: string) => Promise<void>;
  deleteDivision: (eventId: string, divisionId: string) => Promise<void>;
  deleteWorkout: (eventId: string, workoutId: string) => Promise<void>;
  registerTicket: (registration: RegistrationDraft, athleteProfile?: AthleteProfileDraft) => Registration;
  updateRegistrationDetails: (registrationId: string, eventId: string, data: RegistrationEditInput) => Promise<void>;
  cancelRegistration: (registrationId: string, eventId: string, data: RegistrationCancellationInput) => Promise<void>;
  markRegistrationRefunded: (registrationId: string, eventId: string, data: RegistrationRefundInput) => Promise<void>;
  refreshRegistrations: () => Promise<Registration[]>;
  submitScore: (score: Score) => void;
  submitScoresBulk: (newScores: Score[]) => Promise<void>;
  getLeaderboard: (eventId: string, divisionId: string) => AthleteOverall[];
  updateEventTicketing: (eventId: string, config: { format: 'individual' | 'duo' | 'trio'; ticketPrice: number; ticketSlots: number; isTicketingActive: boolean; }) => Promise<void>;
  updateEvent: (eventId: string, updatedData: Partial<Event>) => Promise<void>;
  saveCourseLayout: (divisionId: string, layout: CourseStage[]) => Promise<void>;
  updateWorkout: (eventId: string, workoutId: string, updatedData: Partial<Workout>) => Promise<void>;
  coupons: Coupon[];
  addCoupon: (coupon: Omit<Coupon, 'id' | 'usageCount' | 'createdAt' | 'isActive'>) => Promise<void>;
  updateCoupon: (couponId: string, data: Partial<Pick<Coupon, 'code' | 'discountType' | 'discountValue' | 'usageLimit'>>) => Promise<void>;
  toggleCouponActive: (couponId: string, isActive: boolean) => Promise<void>;
  incrementCouponUsage: (eventId: string, code: string) => Promise<void>;
  changePassword: (userId: string, currentPassword: string, newPassword: string) => Promise<boolean>;
  updateAthleteProfile: (data: AthleteProfileUpdateInput) => Promise<boolean>;
}

type WorkoutDbUpdate = Partial<{
  name: string;
  description: string;
  type: WorkoutType;
  time_cap: string;
  code: string;
  order_index: number;
  division_id: string;
  tie_breaker: string;
}>;

const AppContext = createContext<AppContextType | undefined>(undefined);
const PRIVATE_BOOTSTRAP_ENDPOINT = '/api/app/bootstrap';
const PUBLIC_BOOTSTRAP_ENDPOINT = '/api/app/bootstrap/public';
const PUBLIC_EVENT_BOOTSTRAP_ENDPOINT = '/api/app/bootstrap/public/event';
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 12000;
const configuredBootstrapTimeout = Number(process.env.NEXT_PUBLIC_BOOTSTRAP_TIMEOUT_MS);
export const BOOTSTRAP_TIMEOUT_MS = Number.isFinite(configuredBootstrapTimeout) && configuredBootstrapTimeout >= 3000
  ? configuredBootstrapTimeout
  : DEFAULT_BOOTSTRAP_TIMEOUT_MS;

type RegistrationDbRow = Record<string, unknown>;
type AthleteDbRow = Record<string, unknown>;
type BootstrapPayload = {
  currentUser?: User | null;
  // Supabase rows are normalized immediately below; keeping this flexible avoids duplicating DB row types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  users: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  athletes: any[];
  registrations: RegistrationDbRow[];
  registrationsCount?: number | null;
  contestations: Record<string, unknown>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scores: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coupons: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leaderboardEntries?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  divisions: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workouts: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mercadopagoAccounts: any[];
};

type BootstrapFetchResult = {
  payload: BootstrapPayload;
  authLost: boolean;
};

const optionalString = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : undefined;

const slugify = (value: string) => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const createScopedId = (prefix: string, scope: string, name: string) => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${scope}-${slugify(name) || 'item'}-${Date.now().toString(36)}-${suffix}`;
};

const mapRegistrationFromDb = (r: RegistrationDbRow): Registration => ({
  id: String(r.id),
  eventId: String(r.event_id),
  divisionId: String(r.division_id),
  userId: optionalString(r.user_id),
  athleteId: optionalString(r.athlete_id),
  athleteName: String(r.athlete_name),
  athleteEmail: String(r.athlete_email),
  athletePhone: String(r.athlete_phone),
  box: String(r.box),
  gender: r.gender as Registration['gender'],
  ticketType: String(r.ticket_type),
  ticketPrice: Number(r.ticket_price),
  quantity: Number(r.quantity),
  totalPaid: Number(r.total_paid),
  serviceFeePercent: r.service_fee_percent !== null && r.service_fee_percent !== undefined ? Number(r.service_fee_percent) : undefined,
  serviceFeeAmount: r.service_fee_amount !== null && r.service_fee_amount !== undefined ? Number(r.service_fee_amount) : undefined,
  amountCollected: r.amount_collected !== null && r.amount_collected !== undefined ? Number(r.amount_collected) : undefined,
  applicationFeeCharged: r.application_fee_charged !== null && r.application_fee_charged !== undefined ? Number(r.application_fee_charged) : undefined,
  createdAt: String(r.created_at),
  couponCode: optionalString(r.coupon_code),
  paymentStatus: (r.payment_status || 'payment_approved') as Registration['paymentStatus'],
  paymentMethod: optionalString(r.payment_method),
  paymentId: optionalString(r.payment_id),
  paymentStatusDetail: optionalString(r.payment_status_detail),
  paymentErrorMessage: optionalString(r.payment_error_message),
  cancellationReason: optionalString(r.cancellation_reason),
  cancelledAt: optionalString(r.cancelled_at),
  cancelledBy: optionalString(r.cancelled_by),
  refundStatus: (optionalString(r.refund_status) as Registration['refundStatus']) || 'not_requested',
  refundAmount: r.refund_amount !== null && r.refund_amount !== undefined ? Number(r.refund_amount) : undefined,
  refundMethod: optionalString(r.refund_method),
  refundNote: optionalString(r.refund_note),
  refundProcessedAt: optionalString(r.refund_processed_at),
  refundProcessedBy: optionalString(r.refund_processed_by),
  updatedAt: optionalString(r.updated_at)
});

const mapAthleteFromDb = (a: AthleteDbRow): Athlete => {
  let parsedTeamMembers: { name: string; instagram: string; shirtSize?: string }[] = [];
  if (a.team_members) {
    try {
      parsedTeamMembers = typeof a.team_members === 'string' ? JSON.parse(a.team_members) : a.team_members as { name: string; instagram: string; shirtSize?: string }[];
    } catch (err) {
      console.error("Erro ao fazer parse dos teamMembers do atleta:", a.id, err);
    }
  }

  return {
    id: String(a.id),
    name: String(a.name),
    box: String(a.box),
    country: String(a.country),
    divisionId: String(a.division_id),
    birthDate: optionalString(a.birth_date),
    gender: (optionalString(a.gender) as Athlete['gender']),
    city: optionalString(a.city),
    state: optionalString(a.state),
    instagram: optionalString(a.instagram),
    photoUrl: optionalString(a.photo_url),
    shirtSize: a.shirt_size ? String(a.shirt_size) : undefined,
    email: optionalString(a.email),
    phone: optionalString(a.phone),
    isTeam: a.is_team !== undefined ? Boolean(a.is_team) : false,
    teamMembers: Array.isArray(parsedTeamMembers) ? parsedTeamMembers : []
  };
};

const mapUserFromDb = (user: Record<string, unknown>): User => {
  const serviceValidUntil = normalizeServiceValidUntil(user.service_valid_until || user.serviceValidUntil);
  const role = String(user.role || 'athlete') as User['role'];

  return {
    id: String(user.id),
    name: String(user.name || ''),
    email: String(user.email || ''),
    role,
    organization: optionalString(user.organization),
    serviceValidUntil,
    managerAccessStatus: role === 'manager' ? getManagerAccessStatus(serviceValidUntil) : undefined
  };
};

const adminPersist = async (action: string, payload: Record<string, unknown>) => {
  const response = await fetch('/api/admin/persistence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Erro ao persistir dados administrativos.');
  }
  return data;
};

type BootstrapHttpResponse = {
  response: Response;
  payload: unknown;
};

const fetchWithTimeout = async (endpoint: string, signal: AbortSignal): Promise<BootstrapHttpResponse> => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), BOOTSTRAP_TIMEOUT_MS);
  const propagateAbort = () => timeoutController.abort();
  signal.addEventListener('abort', propagateAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: timeoutController.signal
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch (error) {
      if (!signal.aborted && timeoutController.signal.aborted) {
        throw new Error(`O carregamento excedeu o limite de ${Math.round(BOOTSTRAP_TIMEOUT_MS / 1000)} segundos.`);
      }
      if (signal.aborted) throw error;
    }
    return { response, payload };
  } catch (error) {
    if (!signal.aborted && timeoutController.signal.aborted) {
      throw new Error(`O carregamento excedeu o limite de ${Math.round(BOOTSTRAP_TIMEOUT_MS / 1000)} segundos.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', propagateAbort);
  }
};

const readBootstrapResponse = (response: Response, payload: unknown): BootstrapPayload => {
  const typedPayload = payload as BootstrapPayload | { error?: string } | null;
  if (!response.ok) {
    throw new Error(typedPayload && 'error' in typedPayload && typedPayload.error ? typedPayload.error : 'Erro ao carregar dados iniciais.');
  }
  if (!typedPayload || typeof typedPayload !== 'object' || !('events' in typedPayload)) {
    throw new Error('Resposta inválida do bootstrap.');
  }
  return typedPayload as BootstrapPayload;
};

const getBootstrapErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível carregar os dados iniciais. Tente novamente.';
};

const readBootstrapResponseWithTelemetry = (response: Response, payload: unknown, endpoint: string) => {
  try {
    return readBootstrapResponse(response, payload);
  } catch (error) {
    console.error('[Bootstrap Client] Falha:', JSON.stringify({
      endpoint,
      status: response.status,
      message: getBootstrapErrorMessage(error)
    }));
    throw error;
  }
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>('loading');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [publicEventDataStatus, setPublicEventDataStatus] = useState<Record<string, PublicEventDataStatus>>({});
  const [events, setEvents] = useState<Event[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  // Contagem agregada de inscricoes para clientes anonimos, que nao recebem os
  // registros individuais. Fica null quando o ator autenticado ja recebe a lista.
  const [registrationsCount, setRegistrationsCount] = useState<number | null>(null);
  const [contestations, setContestations] = useState<Contestation[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser, isSessionHydrated] = useLocalStorage<User | null>('woda_current_user', null);
  const currentUserId = currentUser?.id || null;
  const bootstrapAbortRef = useRef<AbortController | null>(null);
  const bootstrapRequestIdRef = useRef(0);
  const skipNextPublicBootstrapRef = useRef(false);
  const hasLoadedBootstrapRef = useRef(false);
  const publicEventRequestsRef = useRef(new Map<string, Promise<void>>());
  const publicEventLoadAttemptsRef = useRef(new Map<string, number>());

  const retryBootstrap = useCallback(() => {
    setBootstrapError(null);
    setRetryNonce(previous => previous + 1);
  }, []);

  const fetchBootstrapPayload = useCallback(async (preferPrivate: boolean, signal: AbortSignal): Promise<BootstrapFetchResult> => {
    const initialEndpoint = preferPrivate ? PRIVATE_BOOTSTRAP_ENDPOINT : PUBLIC_BOOTSTRAP_ENDPOINT;
    let httpResponse = await fetchWithTimeout(initialEndpoint, signal);

    if (preferPrivate && httpResponse.response.status === 401) {
      console.info('[Bootstrap Client] Sessão expirada; migrando para o endpoint público:', JSON.stringify({
        endpoint: initialEndpoint,
        status: httpResponse.response.status
      }));
      httpResponse = await fetchWithTimeout(PUBLIC_BOOTSTRAP_ENDPOINT, signal);
      return {
        payload: readBootstrapResponseWithTelemetry(httpResponse.response, httpResponse.payload, PUBLIC_BOOTSTRAP_ENDPOINT),
        authLost: true
      };
    }

    return {
      payload: readBootstrapResponseWithTelemetry(httpResponse.response, httpResponse.payload, initialEndpoint),
      authLost: false
    };
  }, []);

  const refreshRegistrations = useCallback(async () => {
    const response = await fetch(PRIVATE_BOOTSTRAP_ENDPOINT);
    const payload: BootstrapPayload = await response.json();
    if (!response.ok) {
      throw new Error('Erro ao atualizar inscrições.');
    }

    const mappedRegs = (payload.registrations || []).map(mapRegistrationFromDb);
    setRegistrations(mappedRegs);
    setRegistrationsCount(typeof payload.registrationsCount === 'number' ? payload.registrationsCount : null);
    return mappedRegs;
  }, []);

  const loadPublicEventData = useCallback(async (eventId: string) => {
    // A pagina publica do evento tambem pode ser aberta pelo gestor/proprietario.
    // Nessa situacao o bootstrap privado nao e uma fonte confiavel para a lista
    // publicada da bateria (por exemplo, apos uma inscricao ou troca de aba).
    // Sempre hidratamos os perfis publicos do evento e os mesclamos ao contexto.
    if (!eventId) return;
    const previousAttempts = publicEventLoadAttemptsRef.current.get(eventId) || 0;
    if (previousAttempts >= MAX_PUBLIC_EVENT_DATA_ATTEMPTS) return;

    const existingRequest = publicEventRequestsRef.current.get(eventId);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      setPublicEventDataStatus(previous => ({ ...previous, [eventId]: 'loading' }));
      const controller = new AbortController();

      try {
        const endpoint = `${PUBLIC_EVENT_BOOTSTRAP_ENDPOINT}/${encodeURIComponent(eventId)}`;
        let attemptCount = previousAttempts;
        let mappedAthletes: Athlete[] = [];
        let mappedScores: Score[] = [];
        let mappedLeaderboardEntries: LeaderboardEntry[] = [];

        do {
          attemptCount += 1;
          publicEventLoadAttemptsRef.current.set(eventId, attemptCount);

          const httpResponse = await fetchWithTimeout(endpoint, controller.signal);
          const payload = readBootstrapResponseWithTelemetry(httpResponse.response, httpResponse.payload, endpoint);
          mappedAthletes = (payload.athletes || []).map(mapAthleteFromDb);
          mappedScores = (payload.scores || []).map((score) => {
            let parsedSplits: Record<string, string> = {};
            if (score.splits) {
              try {
                parsedSplits = typeof score.splits === 'string' ? JSON.parse(score.splits) : score.splits;
              } catch (err) {
                console.error('Erro ao fazer parse dos splits do score público:', score.athlete_id, score.workout_id, err);
              }
            }
            return {
              athleteId: score.athlete_id,
              workoutId: score.workout_id,
              result: score.result,
              value: Number(score.value),
              rank: score.rank || undefined,
              points: score.points || undefined,
              splits: parsedSplits || {}
            } as Score;
          });
          mappedLeaderboardEntries = payload.leaderboardEntries || [];
        } while (mappedAthletes.length === 0 && attemptCount < MAX_PUBLIC_EVENT_DATA_ATTEMPTS);

        setAthletes(previous => [
          ...previous.filter(athlete => !mappedAthletes.some(incoming => incoming.id === athlete.id)),
          ...mappedAthletes
        ]);
        setScores(previous => [
          ...previous.filter(score => !mappedScores.some(incoming => incoming.athleteId === score.athleteId && incoming.workoutId === score.workoutId)),
          ...mappedScores
        ]);
        setLeaderboardEntries(previous => [
          ...previous.filter(entry => entry.event_id !== eventId),
          ...mappedLeaderboardEntries
        ]);

        // Uma resposta com atletas encerra o carregamento para esta sessão. Uma
        // resposta vazia só é considerada concluída depois das duas tentativas,
        // evitando tanto o cache prematuro quanto um loop de requests.
        if (mappedAthletes.length > 0) {
          publicEventLoadAttemptsRef.current.set(eventId, MAX_PUBLIC_EVENT_DATA_ATTEMPTS);
        }

        // Este status fica por último para que a UI só deixe o estado de
        // carregamento depois de atletas, scores e leaderboard serem mesclados.
        setPublicEventDataStatus(previous => ({ ...previous, [eventId]: 'ready' }));
      } catch (error) {
        setPublicEventDataStatus(previous => ({ ...previous, [eventId]: 'error' }));
        throw error;
      } finally {
        publicEventRequestsRef.current.delete(eventId);
      }
    })();

    publicEventRequestsRef.current.set(eventId, request);
    return request;
  }, []);

  // Carregar dados iniciais do Supabase
  useEffect(() => {
    if (!isSessionHydrated) return;
    if (!currentUserId && skipNextPublicBootstrapRef.current) {
      skipNextPublicBootstrapRef.current = false;
      return;
    }

    bootstrapAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++bootstrapRequestIdRef.current;
    bootstrapAbortRef.current = controller;

    const fetchAllData = async () => {
      try {
        setIsLoading(true);
        setBootstrapStatus('loading');
        setBootstrapError(null);
        const startedAt = Date.now();
        const { payload, authLost } = await fetchBootstrapPayload(Boolean(currentUserId), controller.signal);

        if (controller.signal.aborted || requestId !== bootstrapRequestIdRef.current) return;

        const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
        console.info('[Bootstrap Client] Concluído:', JSON.stringify({
          endpoint: currentUserId ? PRIVATE_BOOTSTRAP_ENDPOINT : PUBLIC_BOOTSTRAP_ENDPOINT,
          durationMs: Date.now() - startedAt,
          payloadBytes,
          events: payload.events?.length || 0
        }));

        // 1. Carregar usuários e sincronizar sessão
        const dbUsers = payload.users;
        if (dbUsers && dbUsers.length > 0) {
          setUsers(dbUsers.map(mapUserFromDb));
        } else {
          setUsers([]);
        }

        if (payload.currentUser !== undefined) {
          setCurrentUser(payload.currentUser ? mapUserFromDb(payload.currentUser as unknown as Record<string, unknown>) : null);
        } else {
          if (currentUserId && dbUsers && !dbUsers.some(u => u.id === currentUserId)) {
            setCurrentUser(null);
          }
        }

        // 2. Carregar atletas
        const dbAthletes = payload.athletes;
        if (dbAthletes && dbAthletes.length > 0) {
          const mappedAthletes: Athlete[] = dbAthletes.map(mapAthleteFromDb);
          setAthletes(mappedAthletes);
        } else {
          setAthletes([]);
        }

        // 3. Carregar scores
        const dbScores = payload.scores;
        if (dbScores && dbScores.length > 0) {
          const mappedScores: Score[] = dbScores.map(s => {
            let parsedSplits: Record<string, string> = {};
            if (s.splits) {
              try {
                parsedSplits = typeof s.splits === 'string' ? JSON.parse(s.splits) : s.splits;
              } catch (err) {
                console.error("Erro ao fazer parse dos splits do score:", s.athlete_id, s.workout_id, err);
              }
            }
            return {
              athleteId: s.athlete_id,
              workoutId: s.workout_id,
              result: s.result,
              value: Number(s.value),
              rank: s.rank || undefined,
              points: s.points || undefined,
              splits: parsedSplits || {}
            };
          });
          setScores(mappedScores);
        } else {
          setScores([]);
        }

        // 4. Carregar inscrições
        const dbRegistrations = payload.registrations;
        if (dbRegistrations && dbRegistrations.length > 0) {
          const mappedRegs: Registration[] = dbRegistrations.map(mapRegistrationFromDb);
          setRegistrations(mappedRegs);
        } else {
          setRegistrations([]);
        }
        setRegistrationsCount(typeof payload.registrationsCount === 'number' ? payload.registrationsCount : null);

        const dbContestations = payload.contestations;
        if (dbContestations && dbContestations.length > 0) {
          setContestations(dbContestations.map(mapContestationFromDb));
        } else {
          setContestations([]);
        }

        // 4.1 Carregar cupons
        const dbCoupons = payload.coupons;
        if (dbCoupons && dbCoupons.length > 0) {
          const mappedCoupons: Coupon[] = dbCoupons.map(c => ({
            id: c.id,
            eventId: c.event_id,
            code: c.code,
            discountType: c.discount_type as 'percentage' | 'fixed',
            discountValue: Number(c.discount_value),
            usageLimit: c.usage_limit !== null ? Number(c.usage_limit) : 100,
            usageCount: c.usage_count !== null ? Number(c.usage_count) : 0,
            createdAt: c.created_at,
            isActive: c.is_active !== false
          }));
          setCoupons(mappedCoupons);
        } else {
          setCoupons([]);
        }

        // 4.2 Carregar leaderboard_entries (Fase 2 - Dados públicos desnormalizados)
        const dbLeaderboardEntries = payload.leaderboardEntries;
        if (dbLeaderboardEntries && Array.isArray(dbLeaderboardEntries) && dbLeaderboardEntries.length > 0) {
          setLeaderboardEntries(dbLeaderboardEntries);
        } else {
          setLeaderboardEntries([]);
        }

        // 5. Carregar eventos, divisões, workouts e credenciais públicas do Mercado Pago dos gestores
        const dbEvents = payload.events;
        const dbDivisions = payload.divisions;
        const dbWorkouts = payload.workouts;
        const dbMpAccounts = payload.mercadopagoAccounts;

        if (dbEvents && dbEvents.length > 0 && dbDivisions && dbWorkouts) {
          const combinedEvents = dbEvents.map((evt): Event => {
            const evDivs: Division[] = sortDivisions(dbDivisions
              .filter(d => d.event_id === evt.id)
              .map(d => ({
                id: d.id,
                name: d.name,
                category: d.category,
                type: d.type || 'individual',
                slotsLimit: d.slots_limit !== undefined && d.slots_limit !== null ? Number(d.slots_limit) : 100,
                price: d.price !== undefined && d.price !== null ? Number(d.price) : 150.00,
                isActive: d.is_active !== undefined && d.is_active !== null ? Boolean(d.is_active) : true,
                orderIndex: d.order_index !== undefined && d.order_index !== null ? Number(d.order_index) : undefined,
                useAgeGroups: d.use_age_groups || false,
                ageGroups: d.age_groups ? (typeof d.age_groups === 'string' ? JSON.parse(d.age_groups) : d.age_groups) : [],
                courseLayout: d.course_layout ? (typeof d.course_layout === 'string' ? JSON.parse(d.course_layout) : d.course_layout) : [],
                isCoursePublished: d.is_course_published || false
              })));

            const evWods: Workout[] = dbWorkouts
              .filter(w => w.event_id === evt.id)
              .map(w => ({
                id: w.id,
                name: w.name,
                description: w.description,
                type: w.type,
                timeCap: w.time_cap || undefined,
                code: w.code || '',
                orderIndex: w.order_index !== undefined && w.order_index !== null ? Number(w.order_index) : 1,
                divisionId: w.division_id || undefined,
                tieBreaker: w.tie_breaker || ''
              }));

            const organizerMp = dbMpAccounts?.find(acc => acc.user_id === evt.organizer_id);

            return {
              id: evt.id,
              name: evt.name,
              logoUrl: evt.logo_url,
              bannerUrl: evt.banner_url,
              status: evt.status,
              location: evt.location,
              date: evt.date,
              description: evt.description,
              organizerId: evt.organizer_id,
              sponsors: evt.sponsors || [],
              divisions: evDivs,
              workouts: evWods,
              format: evt.format || 'individual',
              ticketPrice: evt.ticket_price !== undefined && evt.ticket_price !== null ? Number(evt.ticket_price) : 150.00,
              ticketSlots: evt.ticket_slots !== undefined && evt.ticket_slots !== null ? Number(evt.ticket_slots) : 100,
              isTicketingActive: evt.is_ticketing_active !== undefined && evt.is_ticketing_active !== null ? Boolean(evt.is_ticketing_active) : true,
              isFeatured: evt.is_featured !== undefined && evt.is_featured !== null ? Boolean(evt.is_featured) : false,
              time: evt.time || '',
              city: evt.city || '',
              state: evt.state || '',
              rules: evt.rules || '',
              instagram: evt.instagram || '',
              website: evt.website || '',
              eventType: evt.event_type || 'functional_fitness',
              scheduleItems: evt.event_schedule
                ? (typeof evt.event_schedule === 'string' ? JSON.parse(evt.event_schedule) : evt.event_schedule)
                : [],
              mpPublicKey: evt.mp_public_key || organizerMp?.public_key || '',
              registrationDeadline: evt.registration_deadline || undefined
            };
          });
          setEvents(combinedEvents);
        } else {
          setEvents([]);
        }

        if (authLost) {
          skipNextPublicBootstrapRef.current = true;
          setCurrentUser(null);
        }
        hasLoadedBootstrapRef.current = true;
        setBootstrapStatus('ready');
      } catch (err) {
        if (controller.signal.aborted || requestId !== bootstrapRequestIdRef.current) return;
        const message = getBootstrapErrorMessage(err);
        console.error('Erro ao carregar dados do bootstrap:', err);
        setBootstrapError(message);
        setBootstrapStatus(hasLoadedBootstrapRef.current ? 'degraded' : 'error');

        if (!hasLoadedBootstrapRef.current) {
          setUsers([]);
          setAthletes([]);
          setScores([]);
          setRegistrations([]);
          setContestations([]);
          setCoupons([]);
          setLeaderboardEntries([]);
          setEvents([]);
        }
      } finally {
        if (!controller.signal.aborted && requestId === bootstrapRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    void fetchAllData();
    return () => controller.abort();
  }, [currentUserId, fetchBootstrapPayload, isSessionHydrated, retryNonce, setCurrentUser]);

  // Rotina de reparo automático (Self-Healing) de dados legados do Fitness Racing
  useEffect(() => {
    if (events.length === 0 || !currentUser || (currentUser.role !== 'owner' && currentUser.role !== 'manager')) return;

    const repairLegacyEvents = async () => {
      const dbWorkoutsToInsert: {
        id: string;
        event_id: string;
        name: string;
        description: string;
        type: WorkoutType;
        code: string;
        order_index: number;
        division_id: string;
        tie_breaker: string;
      }[] = [];

      const updatedEvents = events.map(evt => {
        if (evt.eventType !== 'fitness_racing') return evt;

        let eventWorkoutsChanged = false;
        const currentWods = [...evt.workouts];

        evt.divisions.forEach(division => {
          const hasTotal = currentWods.some(w => w.divisionId === division.id && w.code === 'TOTAL');

          if (!hasTotal) {
            const workoutId = `wod-${division.id}-total`;
            const autoWorkout: Workout = {
              id: workoutId,
              name: 'Percurso Completo',
              description: 'Tempo oficial total do percurso de Fitness Racing.',
              type: 'fortime',
              code: 'TOTAL',
              orderIndex: 1,
              divisionId: division.id,
              tieBreaker: ''
            };

            currentWods.push(autoWorkout);
            eventWorkoutsChanged = true;

            dbWorkoutsToInsert.push({
              id: workoutId,
              event_id: evt.id,
              name: autoWorkout.name,
              description: autoWorkout.description,
              type: autoWorkout.type,
              code: autoWorkout.code,
              order_index: autoWorkout.orderIndex,
              division_id: division.id,
              tie_breaker: ''
            });
          }
        });

        if (eventWorkoutsChanged) {
          return {
            ...evt,
            workouts: currentWods
          };
        }
        return evt;
      });

      if (dbWorkoutsToInsert.length > 0) {
        console.log(`[Self-Healing] Reparando ${dbWorkoutsToInsert.length} workouts virtuais de Fitness Racing ausentes no Supabase...`);
        try {
          await adminPersist('repairWorkouts', { workouts: dbWorkoutsToInsert });
          setEvents(updatedEvents);
        } catch (error) {
          console.error("[Self-Healing] Erro ao criar workouts virtuais ausentes:", error);
        }
      }
    };

    repairLegacyEvents();
  }, [events, currentUser]);

  // Lógica de Login
  const login = async (emailInput: string, passwordInput: string): Promise<User | null> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: emailInput,
          password: passwordInput
        })
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Erro de login:', data.error);
        return null;
      }

      setCurrentUser(data.user);
      return data.user as User;
    } catch (err) {
      console.error('Erro crítico no login:', err);
      return null;
    }
  };

  // Lógica de Logout
  const logout = () => {
    setCurrentUser(null);
    fetch('/api/auth/logout', { method: 'POST' }).catch(err => {
      console.warn('Erro ao encerrar sessão no servidor:', err);
    });
  };

  // Lógica para Proprietário cadastrar Gestor
  const createManagerAccount = async (
    name: string,
    emailInput: string,
    passwordInput: string,
    organization: string,
    serviceValidUntil?: string
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          email: emailInput,
          password: passwordInput,
          organization,
          serviceValidUntil
        })
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Erro ao cadastrar gestor:', data.error);
        return false;
      }

      setUsers(prev => [...prev, data.user]);
      return true;
    } catch (err) {
      console.error('Erro crítico ao cadastrar gestor:', err);
      return false;
    }
  };

  const updateManagerServiceValidity = async (userId: string, serviceValidUntil?: string | null): Promise<User | null> => {
    try {
      const response = await fetch('/api/admin/create-user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          serviceValidUntil: serviceValidUntil || null
        })
      });

      const data = await response.json();
      if (!response.ok || !data.user) {
        throw new Error(data.error || 'Erro ao atualizar validade do gestor.');
      }

      setUsers(prev => prev.map(user => user.id === userId ? data.user as User : user));
      return data.user as User;
    } catch (err) {
      console.error('Erro ao atualizar validade do gestor:', err);
      return null;
    }
  };

  const setFeaturedHomeEvent = async (eventId: string | null) => {
    if (currentUser?.role !== 'owner') {
      throw new Error('Apenas o owner pode alterar o destaque da home.');
    }

    if (eventId && !events.some(event => event.id === eventId)) {
      throw new Error('Evento nao encontrado para destaque.');
    }

    const previousEvents = events;
    setEvents(prev => prev.map(event => ({ ...event, isFeatured: event.id === eventId })));

    try {
      await adminPersist('setFeaturedHomeEvent', { eventId });
    } catch (error) {
      setEvents(previousEvents);
      console.error('Erro ao atualizar destaque da home:', error);
      throw error;
    }
  };

  // Recalcular posições e pontos para um determinado workout quando scores mudam
  const recalculateWorkoutScores = (workoutId: string, divisionId: string, currentScores: Score[]) => {
    // 1. Achar todos os atletas dessa divisão
    const divisionAthletes = athletes.filter(a => a.divisionId === divisionId);
    const athleteIds = divisionAthletes.map(a => a.id);

    // 2. Achar o workout para saber o tipo (fortime, amrap, etc.)
    let workoutType: WorkoutType = 'fortime';
    for (const e of events) {
      const w = e.workouts.find(work => work.id === workoutId);
      if (w) {
        workoutType = w.type;
        break;
      }
    }

    // 3. Pegar os scores do workout para esses atletas
    const workoutScores = currentScores.filter(
      s => s.workoutId === workoutId && athleteIds.includes(s.athleteId)
    );

    // 4. Ordenar scores baseados no tipo do workout, jogando pendentes ('-') para o final
    const sortedScores = [...workoutScores].sort((a, b) => {
      const aPending = !a.result || a.result === '-' || a.result === '';
      const bPending = !b.result || b.result === '-' || b.result === '';
      if (aPending && !bPending) return 1;
      if (!aPending && bPending) return -1;
      if (aPending && bPending) return 0;

      if (workoutType === 'fortime') {
        return a.value - b.value;
      } else {
        return b.value - a.value;
      }
    });

    // 5. Atribuir Ranks e Pontos com regras de empates do Low-Point
    const updatedScoresMap = new Map<string, Score>();

    sortedScores.forEach((score, index) => {
      const isPending = !score.result || score.result === '-' || score.result === '';
      let rank = 0;
      let points = 0;

      if (!isPending) {
        if (index > 0) {
          const prevScore = sortedScores[index - 1];
          const prevPending = !prevScore.result || prevScore.result === '-' || prevScore.result === '';
          if (!prevPending && score.value === prevScore.value) {
            // Empate: compartilha a mesma colocação do competidor anterior
            rank = updatedScoresMap.get(prevScore.athleteId)?.rank || (index + 1);
          } else {
            // Não empatou: a colocação pula para o índice atual + 1
            rank = index + 1;
          }
        } else {
          rank = 1;
        }
        points = rank; // Em Low-Point, os pontos de colocação são iguais à classificação
      } else {
        // Penalidade para competidores sem resultado: número de atletas da divisão + 1
        rank = 0;
        points = athleteIds.length + 1;
      }

      updatedScoresMap.set(score.athleteId, {
        ...score,
        rank,
        points
      });
    });

    // 6. Retornar nova lista de scores mesclando os alterados
    return currentScores.map(score => {
      if (score.workoutId === workoutId && athleteIds.includes(score.athleteId)) {
        return updatedScoresMap.get(score.athleteId) || score;
      }
      return score;
    });
  };

  // Cadastrar Evento
  const addEvent = async (eventData: Omit<Event, 'id' | 'organizerId' | 'sponsors' | 'format' | 'ticketPrice' | 'ticketSlots' | 'isTicketingActive'> & {
    format?: 'individual' | 'duo' | 'trio';
    ticketPrice?: number;
    ticketSlots?: number;
    isTicketingActive?: boolean;
    time?: string;
    city?: string;
    state?: string;
    rules?: string;
    instagram?: string;
    website?: string;
    eventType?: 'functional_fitness' | 'fitness_racing';
  }): Promise<Event> => {
    if (!currentUser?.id) {
      throw new Error('Sessão inválida ou expirada. Por favor, faça login novamente para criar o evento.');
    }

    const newId = createScopedId('evt', currentUser.id, eventData.name);
    const defaultFitnessRacing = eventData.eventType === 'fitness_racing'
      ? buildFitnessRacingDefaults(newId, eventData.ticketPrice ?? 150.00, eventData.ticketSlots ?? 100)
      : { divisions: eventData.divisions || [], workouts: eventData.workouts || [] };

    const newEvent: Event = {
      ...eventData,
      id: newId,
      organizerId: currentUser.id,
      sponsors: ['Bull Fit', 'WOD Gear', 'Strong Nutrition'],
      format: eventData.format || 'individual',
      ticketPrice: eventData.ticketPrice ?? 150.00,
      ticketSlots: eventData.ticketSlots ?? 100,
      isTicketingActive: eventData.isTicketingActive ?? true,
      time: eventData.time || '',
      city: eventData.city || '',
      state: eventData.state || '',
      rules: eventData.rules || '',
      instagram: eventData.instagram || '',
      website: eventData.website || '',
      eventType: eventData.eventType || 'functional_fitness',
      divisions: defaultFitnessRacing.divisions,
      workouts: defaultFitnessRacing.workouts,
      scheduleItems: eventData.scheduleItems || [],
      mpPublicKey: eventData.mpPublicKey || '',
    };

    const eventRow = {
      id: newEvent.id,
      name: newEvent.name,
      logo_url: newEvent.logoUrl,
      banner_url: newEvent.bannerUrl,
      status: newEvent.status,
      location: newEvent.location,
      date: newEvent.date,
      description: newEvent.description,
      organizer_id: newEvent.organizerId,
      sponsors: newEvent.sponsors,
      format: newEvent.format,
      ticket_price: newEvent.ticketPrice,
      ticket_slots: newEvent.ticketSlots,
      is_ticketing_active: newEvent.isTicketingActive,
      time: newEvent.time,
      city: newEvent.city,
      state: newEvent.state,
      rules: newEvent.rules,
      instagram: newEvent.instagram,
      website: newEvent.website,
      event_type: newEvent.eventType,
      event_schedule: newEvent.scheduleItems,
      mp_public_key: newEvent.mpPublicKey || null
    };

    const divisionRows = eventData.eventType === 'fitness_racing'
      ? defaultFitnessRacing.divisions.map((division) => ({
        id: division.id,
        event_id: newEvent.id,
        name: division.name,
        category: division.category,
        type: division.type,
        slots_limit: division.slotsLimit,
        price: division.price,
        is_active: division.isActive,
        order_index: division.orderIndex,
        use_age_groups: division.useAgeGroups || false,
        age_groups: division.ageGroups || [],
        course_layout: division.courseLayout || []
      }))
      : [];

    const workoutRows = eventData.eventType === 'fitness_racing'
      ? defaultFitnessRacing.workouts.map((workout) => ({
        id: workout.id,
        event_id: newEvent.id,
        name: workout.name,
        description: workout.description,
        type: workout.type,
        code: workout.code,
        order_index: workout.orderIndex,
        division_id: workout.divisionId || null,
        tie_breaker: workout.tieBreaker || ''
      }))
      : [];

    await adminPersist('createEvent', {
      event: eventRow,
      divisions: divisionRows,
      workouts: workoutRows
    });

    setEvents(prev => [...prev, newEvent]);
    return newEvent;
  };

  // Cadastrar Divisão
  const addDivision = async (eventId: string, divisionData: Omit<Division, 'id'>): Promise<{ division: Division; autoWorkout: Workout | null }> => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const divId = createScopedId('div', eventId, divisionData.name);
    const newDivision: Division = {
      ...divisionData,
      id: divId,
      // Categoria nova (ou duplicada) sempre entra no fim da ordem do evento
      orderIndex: getNextDivisionOrderIndex(event.divisions),
      courseLayout: event?.eventType === 'fitness_racing'
        ? (divisionData.courseLayout && divisionData.courseLayout.length > 0 ? divisionData.courseLayout : buildFitnessRacingCourse(divisionData.name))
        : []
    };

    // Se for Fitness Racing, criar automaticamente o workout virtual do percurso
    let autoWorkout: Workout | null = null;
    if (event && event.eventType === 'fitness_racing') {
      const workoutId = `wod-${divId}-total`;
      autoWorkout = {
        id: workoutId,
        name: 'Percurso Completo',
        description: 'Tempo total de realização do percurso de Fitness Racing.',
        type: 'fortime',
        code: 'TOTAL',
        orderIndex: 1,
        divisionId: divId,
        tieBreaker: ''
      };
    }

    const divisionRow = {
      id: newDivision.id,
      event_id: eventId,
      name: newDivision.name,
      category: newDivision.category,
      type: newDivision.type,
      slots_limit: newDivision.slotsLimit,
      price: newDivision.price,
      is_active: newDivision.isActive,
      order_index: newDivision.orderIndex,
      use_age_groups: newDivision.useAgeGroups || false,
      age_groups: newDivision.ageGroups || [],
      course_layout: newDivision.courseLayout || []
    };

    const autoWorkoutRow = autoWorkout ? {
        id: autoWorkout.id,
        event_id: eventId,
        name: autoWorkout.name,
        description: autoWorkout.description,
        type: autoWorkout.type,
        code: autoWorkout.code,
        order_index: autoWorkout.orderIndex,
        division_id: divId,
        tie_breaker: ''
      } : null;

    await adminPersist('createDivision', {
      division: divisionRow,
      autoWorkout: autoWorkoutRow
    });

    setEvents(prev => prev.map(e => {
      if (e.id === eventId) {
        return {
          ...e,
          divisions: [...e.divisions, newDivision],
          workouts: autoWorkout ? [...e.workouts, autoWorkout] : e.workouts
         };
      }
      return e;
    }));
    return { division: newDivision, autoWorkout };
  };

  const updateDivision = async (eventId: string, divisionId: string, updatedData: Partial<Division>) => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id || !event.divisions.some(d => d.id === divisionId)) {
      throw new Error('Categoria não encontrada para este gestor.');
    }

    const previousEvents = events;
    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      return {
        ...e,
        divisions: e.divisions.map(d => d.id === divisionId ? { ...d, ...updatedData } : d)
      };
    }));

    const dbPayload: Record<string, unknown> = {};
    if (updatedData.name !== undefined) dbPayload.name = updatedData.name;
    if (updatedData.category !== undefined) dbPayload.category = updatedData.category;
    if (updatedData.type !== undefined) dbPayload.type = updatedData.type;
    if (updatedData.slotsLimit !== undefined) dbPayload.slots_limit = updatedData.slotsLimit;
    if (updatedData.price !== undefined) dbPayload.price = updatedData.price;
    if (updatedData.isActive !== undefined) dbPayload.is_active = updatedData.isActive;
    if (updatedData.orderIndex !== undefined) dbPayload.order_index = updatedData.orderIndex;
    if (updatedData.useAgeGroups !== undefined) dbPayload.use_age_groups = updatedData.useAgeGroups;
    if (updatedData.ageGroups !== undefined) dbPayload.age_groups = updatedData.ageGroups;
    if (updatedData.courseLayout !== undefined) dbPayload.course_layout = updatedData.courseLayout;
    if (updatedData.isCoursePublished !== undefined) dbPayload.is_course_published = updatedData.isCoursePublished;

    try {
      await adminPersist('updateDivision', { eventId, divisionId, data: dbPayload });
    } catch (error) {
      setEvents(previousEvents);
      console.error("Erro ao atualizar categoria no Supabase:", error);
      throw error;
    }
  };

  // Reordenar categorias do evento (arrastar e soltar / botões de mover no painel)
  const reorderDivisions = async (eventId: string, orderedIds: string[]) => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const currentIds = event.divisions.map(d => d.id);
    const isSameSet = orderedIds.length === currentIds.length
      && new Set(orderedIds).size === orderedIds.length
      && orderedIds.every(id => currentIds.includes(id));
    if (!isSameSet) {
      throw new Error('Ordem de categorias inválida para este evento.');
    }

    const previousEvents = events;
    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      return {
        ...e,
        divisions: orderedIds.map((divisionId, index) => {
          const division = e.divisions.find(d => d.id === divisionId)!;
          return { ...division, orderIndex: index + 1 };
        })
      };
    }));

    try {
      await adminPersist('reorderDivisions', { eventId, orderedIds });
    } catch (error) {
      setEvents(previousEvents);
      console.error("Erro ao reordenar categorias no Supabase:", error);
      throw error;
    }
  };

  // Excluir Divisão/Categoria e limpar dados vinculados no estado local
  const deleteDivision = async (eventId: string, divisionId: string) => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id || !event.divisions.some(d => d.id === divisionId)) {
      throw new Error('Categoria não encontrada para este gestor.');
    }

    const athleteIds = athletes.filter(a => a.divisionId === divisionId).map(a => a.id);
    const linkedWorkoutIds = event.workouts.filter(w => w.divisionId === divisionId).map(w => w.id);

    const previousEvents = events;
    const previousAthletes = athletes;
    const previousScores = scores;
    const previousRegistrations = registrations;

    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      return {
        ...e,
        divisions: e.divisions.filter(d => d.id !== divisionId),
        workouts: e.workouts.filter(w => w.divisionId !== divisionId)
      };
    }));
    setAthletes(prev => prev.filter(a => a.divisionId !== divisionId));
    setRegistrations(prev => prev.filter(r => r.divisionId !== divisionId));
    setScores(prev => prev.filter(s => !athleteIds.includes(s.athleteId) && !linkedWorkoutIds.includes(s.workoutId)));

    try {
      await adminPersist('deleteDivision', { eventId, divisionId });
    } catch (error) {
      setEvents(previousEvents);
      setAthletes(previousAthletes);
      setScores(previousScores);
      setRegistrations(previousRegistrations);
      console.error("Erro ao excluir divisão no Supabase:", error);
      throw error;
    }
  };

  // Excluir Evento e limpar dados vinculados no estado local
  const deleteEvent = async (eventId: string) => {
    const eventToDelete = events.find(e => e.id === eventId);
    if (!eventToDelete) return;
    if (eventToDelete.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const divisionIds = eventToDelete.divisions.map(d => d.id);
    const workoutIds = eventToDelete.workouts.map(w => w.id);
    const athleteIds = athletes.filter(a => divisionIds.includes(a.divisionId)).map(a => a.id);

    const previousEvents = events;
    const previousAthletes = athletes;
    const previousScores = scores;
    const previousRegistrations = registrations;
    const previousCoupons = coupons;

    setEvents(prev => prev.filter(e => e.id !== eventId));
    setAthletes(prev => prev.filter(a => !divisionIds.includes(a.divisionId)));
    setRegistrations(prev => prev.filter(r => r.eventId !== eventId));
    setCoupons(prev => prev.filter(c => c.eventId !== eventId));
    setScores(prev => prev.filter(s => !athleteIds.includes(s.athleteId) && !workoutIds.includes(s.workoutId)));

    try {
      await adminPersist('deleteEvent', { eventId });
    } catch (error) {
      setEvents(previousEvents);
      setAthletes(previousAthletes);
      setScores(previousScores);
      setRegistrations(previousRegistrations);
      setCoupons(previousCoupons);
      console.error("Erro ao excluir evento no Supabase:", error);
      throw error;
    }
  };

  // Excluir Prova/WOD e limpar resultados vinculados no estado local
  const deleteWorkout = async (eventId: string, workoutId: string) => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id || !event.workouts.some(w => w.id === workoutId)) {
      throw new Error('Prova não encontrada para este gestor.');
    }

    const previousEvents = events;
    const previousScores = scores;

    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      return {
        ...e,
        workouts: e.workouts.filter(w => w.id !== workoutId)
      };
    }));
    setScores(prev => prev.filter(s => s.workoutId !== workoutId));

    try {
      await adminPersist('deleteWorkout', { eventId, workoutId });
    } catch (error) {
      setEvents(previousEvents);
      setScores(previousScores);
      console.error("Erro ao excluir prova no Supabase:", error);
      throw error;
    }
  };

  // Cadastrar Prova (Workout)
  const addWorkout = async (eventId: string, workoutData: Omit<Workout, 'id'>): Promise<Workout> => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const workoutId = createScopedId('wod', eventId, workoutData.name);
    const newWorkout: Workout = {
      ...workoutData,
      id: workoutId
    };

    await adminPersist('createWorkout', {
      workout: {
      id: newWorkout.id,
      event_id: eventId,
      name: newWorkout.name,
      description: newWorkout.description,
      type: newWorkout.type,
      time_cap: newWorkout.timeCap || null,
      code: newWorkout.code,
      order_index: newWorkout.orderIndex,
      division_id: newWorkout.divisionId || null,
      tie_breaker: newWorkout.tieBreaker || ''
      }
    });

    setEvents(prev => prev.map(e => {
      if (e.id === eventId) {
        return {
          ...e,
          workouts: [...e.workouts, newWorkout]
        };
      }
      return e;
    }));
    return newWorkout;
  };

  // Comprar Ingresso / Inscrição
  const registerTicket = (
    registrationData: RegistrationDraft,
    athleteProfile?: AthleteProfileDraft
  ) => {
    const regId = registrationData.id || `reg-${Date.now()}`;
    const newRegistration: Registration = {
      ...registrationData,
      id: regId,
      createdAt: registrationData.createdAt || new Date().toISOString()
    };

    // Adicionar atleta ao evento se ainda não cadastrado para fins de simulação
    const exists = athletes.some(
      a => a.name.toLowerCase() === registrationData.athleteName.toLowerCase() &&
      a.divisionId === registrationData.divisionId
    );

    const newAthleteId = athleteProfile?.id || `ath-${Date.now()}`;
    let newAthlete: Athlete | null = null;

    if (!exists) {
      newAthlete = {
        id: newAthleteId,
        name: registrationData.athleteName,
        box: registrationData.box || 'Independente',
        country: 'BR',
        divisionId: registrationData.divisionId,
        birthDate: athleteProfile?.birthDate || '',
        gender: athleteProfile?.gender || undefined,
        city: athleteProfile?.city || '',
        state: athleteProfile?.state || '',
        instagram: normalizeInstagram(athleteProfile?.instagram),
        photoUrl: athleteProfile?.photoUrl || '',
        shirtSize: athleteProfile?.shirtSize || '',
        email: athleteProfile?.email || '',
        phone: athleteProfile?.phone || '',
        isTeam: athleteProfile?.isTeam || false,
        teamMembers: athleteProfile?.teamMembers?.map(m => ({
          name: m.name,
          instagram: normalizeInstagram(m.instagram),
          shirtSize: m.shirtSize || ''
        })) || []
      };
    }

    if (newAthlete) {
      setAthletes(prev => [...prev, newAthlete as Athlete]);
    }
    setRegistrations(prev => {
      const existsInState = prev.some(r => r.id === newRegistration.id);
      return existsInState
        ? prev.map(r => r.id === newRegistration.id ? newRegistration : r)
        : [...prev, newRegistration];
    });
    return newRegistration;
  };

  // Editar uma inscrição existente (correção de cadastro pelo gestor).
  // Persiste no banco (registrations + athletes) e sincroniza o estado local
  // com os dados normalizados retornados pelo servidor.
  const updateRegistrationDetails = async (
    registrationId: string,
    eventId: string,
    data: RegistrationEditInput
  ) => {
    const previousRegistration = registrations.find(r => r.id === registrationId && r.eventId === eventId);
    const result = await adminPersist('updateRegistration', { registrationId, eventId, data });
    const updatedReg = result.registration as Registration | undefined;
    const updatedAthlete = result.athlete as Athlete | null | undefined;
    const updatedLeaderboardEntry = result.leaderboardEntry as LeaderboardEntry | null | undefined;

    if (updatedReg) {
      setRegistrations(prev => prev.map(r => (r.id === registrationId ? { ...r, ...updatedReg } : r)));
    }

    if (updatedAthlete) {
      setAthletes(prev => {
        const exists = prev.some(a => a.id === updatedAthlete.id);
        return exists
          ? prev.map(a => (a.id === updatedAthlete.id ? updatedAthlete : a))
          : [...prev, updatedAthlete];
      });
    }

    const affectedAthleteIds = new Set(
      [previousRegistration?.athleteId, updatedReg?.athleteId, updatedAthlete?.id, updatedLeaderboardEntry?.athlete_id]
        .filter(Boolean)
        .map(String)
    );
    const affectedDivisionIds = new Set(
      [previousRegistration?.divisionId, updatedReg?.divisionId, updatedLeaderboardEntry?.division_id]
        .filter(Boolean)
        .map(String)
    );

    if (affectedAthleteIds.size > 0 && affectedDivisionIds.size > 0) {
      setLeaderboardEntries(prev => {
        const withoutRelocatedEntry = prev.filter(entry => {
          const sameEvent = String(entry.event_id) === eventId;
          const sameAthlete = affectedAthleteIds.has(String(entry.athlete_id));
          const sameDivision = affectedDivisionIds.has(String(entry.division_id));
          return !(sameEvent && sameAthlete && sameDivision);
        });

        return updatedLeaderboardEntry
          ? [...withoutRelocatedEntry, updatedLeaderboardEntry]
          : withoutRelocatedEntry;
      });
    }
  };

  const removeRegistrationFromLeaderboardState = (registration: Registration) => {
    if (!registration.athleteId) return;

    setLeaderboardEntries(prev => prev.filter(entry => !(
      String(entry.event_id) === registration.eventId
      && String(entry.division_id) === registration.divisionId
      && String(entry.athlete_id) === registration.athleteId
    )));
  };

  const syncCancelledRegistrationState = (registrationId: string, updatedReg?: Registration) => {
    if (!updatedReg) return;

    setRegistrations(prev => prev.map(r => (r.id === registrationId ? { ...r, ...updatedReg } : r)));
    if (updatedReg.paymentStatus === 'payment_cancelled') {
      removeRegistrationFromLeaderboardState(updatedReg);
    }
  };

  const cancelRegistration = async (
    registrationId: string,
    eventId: string,
    data: RegistrationCancellationInput
  ) => {
    const result = await adminPersist('cancelRegistration', { registrationId, eventId, data });
    syncCancelledRegistrationState(registrationId, result.registration as Registration | undefined);
  };

  const markRegistrationRefunded = async (
    registrationId: string,
    eventId: string,
    data: RegistrationRefundInput
  ) => {
    const result = await adminPersist('markRegistrationRefunded', { registrationId, eventId, data });
    syncCancelledRegistrationState(registrationId, result.registration as Registration | undefined);
  };

  // Cadastrar Cupom de Desconto
  const addCoupon = async (couponData: Omit<Coupon, 'id' | 'usageCount' | 'createdAt' | 'isActive'>) => {
    const event = events.find(e => e.id === couponData.eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const newCoupon: Coupon = {
      ...couponData,
      id: `coupon-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      isActive: true
    };

    await adminPersist('createCoupon', {
      coupon: {
        id: newCoupon.id,
        event_id: newCoupon.eventId,
        code: newCoupon.code,
        discount_type: newCoupon.discountType,
        discount_value: newCoupon.discountValue,
        usage_limit: newCoupon.usageLimit,
        usage_count: newCoupon.usageCount,
        is_active: true
      }
    });

    setCoupons(prev => [...prev, newCoupon]);
  };

  // Editar Cupom de Desconto
  const updateCoupon = async (couponId: string, data: Partial<Pick<Coupon, 'code' | 'discountType' | 'discountValue' | 'usageLimit'>>) => {
    const coupon = coupons.find(c => c.id === couponId);
    if (!coupon) throw new Error('Cupom não encontrado.');

    const event = events.find(e => e.id === coupon.eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const previousCoupons = coupons;
    setCoupons(prev => prev.map(c => c.id === couponId ? { ...c, ...data } : c));

    const dbPayload: Record<string, unknown> = {};
    if (data.code !== undefined) dbPayload.code = data.code;
    if (data.discountType !== undefined) dbPayload.discount_type = data.discountType;
    if (data.discountValue !== undefined) dbPayload.discount_value = data.discountValue;
    if (data.usageLimit !== undefined) dbPayload.usage_limit = data.usageLimit;

    try {
      await adminPersist('updateCoupon', { couponId, eventId: coupon.eventId, data: dbPayload });
    } catch (error) {
      setCoupons(previousCoupons);
      console.error("Erro ao atualizar cupom no Supabase:", error);
      throw error;
    }
  };

  // Ativar/Desativar Cupom de Desconto
  const toggleCouponActive = async (couponId: string, isActive: boolean) => {
    const coupon = coupons.find(c => c.id === couponId);
    if (!coupon) throw new Error('Cupom não encontrado.');

    const event = events.find(e => e.id === coupon.eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const previousCoupons = coupons;
    setCoupons(prev => prev.map(c => c.id === couponId ? { ...c, isActive } : c));

    try {
      await adminPersist('updateCoupon', { couponId, eventId: coupon.eventId, data: { is_active: isActive } });
    } catch (error) {
      setCoupons(previousCoupons);
      console.error("Erro ao alterar status do cupom no Supabase:", error);
      throw error;
    }
  };

  // Incrementar o uso de um cupom
  const incrementCouponUsage = async (eventId: string, code: string) => {
    setCoupons(prev => prev.map(c =>
      (c.eventId === eventId && c.code.toLowerCase() === code.toLowerCase())
        ? { ...c, usageCount: c.usageCount + 1 }
        : c
    ));

    adminPersist('incrementCouponUsage', { eventId, code })
      .catch(error => console.error("Erro ao atualizar uso do cupom no Supabase:", error));
  };

  // Alterar senha do usuário
  const changePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          currentPassword,
          newPassword
        })
      });

      const data = await response.json();
      if (!response.ok) {
        console.error("Erro ao atualizar senha:", data.error);
        return false;
      }

      return true;
    } catch (err) {
      console.error("Erro inesperado ao alterar senha:", err);
      return false;
    }
  };

  const updateAthleteProfile = async ({ fullName, birthDate }: AthleteProfileUpdateInput): Promise<boolean> => {
    try {
      const response = await fetch('/api/athlete/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fullName,
          birthDate
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        console.error('Erro ao atualizar perfil do atleta:', payload.error || 'Erro desconhecido.');
        return false;
      }

      if (payload.user) {
        setCurrentUser(payload.user as User);
      }

      if (Array.isArray(payload.athletes)) {
        const updatedAthletes = (payload.athletes as AthleteDbRow[]).map(mapAthleteFromDb);
        setAthletes(prev => {
          const next = new Map(prev.map(athlete => [athlete.id, athlete]));
          updatedAthletes.forEach(athlete => {
            next.set(athlete.id, athlete);
          });
          return Array.from(next.values());
        });
      }

      if (Array.isArray(payload.registrations)) {
        const updatedRegistrations = (payload.registrations as RegistrationDbRow[]).map(mapRegistrationFromDb);
        setRegistrations(prev => {
          const next = new Map(prev.map(registration => [registration.id, registration]));
          updatedRegistrations.forEach(registration => {
            next.set(registration.id, registration);
          });
          return Array.from(next.values());
        });
      }

      return true;
    } catch (err) {
      console.error('Erro inesperado ao atualizar perfil do atleta:', err);
      return false;
    }
  };

  // Lançar múltiplos scores em lote (bulk) e recalcular rankings
  const submitScoresBulk = async (newScores: Score[]) => {
    if (newScores.length === 0) return;

    // 1. Atualizar o estado local de forma síncrona/pura primeiro para evitar race conditions na UI
    let tempScores = [...scores];
    newScores.forEach(newScore => {
      const index = tempScores.findIndex(
        s => s.athleteId === newScore.athleteId && s.workoutId === newScore.workoutId
      );
      if (index > -1) {
        tempScores[index] = {
          ...tempScores[index],
          ...newScore,
          splits: newScore.splits || tempScores[index].splits || {}
        };
      } else {
        tempScores.push(newScore);
      }
    });

    // 2. Determinar quais divisões e workouts foram afetados para fazer o recálculo
    const affectedKeySet = new Set<string>();
    const affectedPairs: { workoutId: string; divisionId: string }[] = [];

    newScores.forEach(newScore => {
      const athlete = athletes.find(a => a.id === newScore.athleteId);
      if (athlete) {
        const event = events.find(e =>
          e.organizerId === currentUser?.id &&
          e.divisions.some(d => d.id === athlete.divisionId) &&
          e.workouts.some(w => w.id === newScore.workoutId)
        );
        if (!event) return;

        const key = `${newScore.workoutId}|${athlete.divisionId}`;
        if (!affectedKeySet.has(key)) {
          affectedKeySet.add(key);
          affectedPairs.push({ workoutId: newScore.workoutId, divisionId: athlete.divisionId });
        }
      }
    });

    if (affectedPairs.length === 0) {
      console.error("Nenhum score pertence a eventos deste gestor.");
      return;
    }

    // 3. Recalcular rankings e pontos para as divisões/workouts afetados
    affectedPairs.forEach(({ workoutId, divisionId }) => {
      const athlete = athletes.find(a => a.divisionId === divisionId);
      if (!athlete) return;

      const event = events.find(e => e.divisions.some(d => d.id === divisionId));
      if (event && event.eventType === 'fitness_racing') {
        const divisionAthletes = athletes.filter(a => a.divisionId === divisionId);
        const athleteIds = divisionAthletes.map(a => a.id);
        const workoutScores = tempScores.filter(
          s => s.workoutId === workoutId && athleteIds.includes(s.athleteId) && s.result !== '-'
        );

        // Menor tempo (value) é melhor
        const sortedScores = [...workoutScores].sort((a, b) => a.value - b.value);
        const updatedScoresMap = new Map<string, Score>();

        sortedScores.forEach((score, idx) => {
          updatedScoresMap.set(score.athleteId, {
            ...score,
            rank: idx + 1,
            points: 0
          });
        });

        tempScores = tempScores.map(score => {
          if (score.workoutId === workoutId && athleteIds.includes(score.athleteId)) {
            return updatedScoresMap.get(score.athleteId) || { ...score, rank: undefined, points: 0 };
          }
          return score;
        });
      } else {
        // Lógica padrão do CrossFit (Functional Fitness)
        tempScores = recalculateWorkoutScores(workoutId, divisionId, tempScores);
      }
    });

    // 4. Salvar o estado local do React de forma atômica
    setScores(tempScores);

    // 5. Salvar todos os scores das divisões e workouts afetados de forma recalculada no Supabase
    const dbPayload: {
      athlete_id: string;
      workout_id: string;
      result: string;
      value: number;
      rank: number | null;
      points: number | null;
      splits: Record<string, string>;
    }[] = [];
    affectedPairs.forEach(({ workoutId, divisionId }) => {
      const divisionAthletes = athletes.filter(a => a.divisionId === divisionId);
      const athleteIds = divisionAthletes.map(a => a.id);

      const divisionScores = tempScores.filter(
        s => s.workoutId === workoutId && athleteIds.includes(s.athleteId)
      );

      divisionScores.forEach(s => {
        dbPayload.push({
          athlete_id: s.athleteId,
          workout_id: s.workoutId,
          result: s.result,
          value: Number(s.value),
          rank: s.rank || null,
          points: s.points !== undefined && s.points !== null ? Number(s.points) : null,
          splits: s.splits || {}
        });
      });
    });

    if (dbPayload.length > 0) {
      const eventIds = [...new Set(affectedPairs
        .map(({ divisionId }) => events.find(event => event.divisions.some(division => division.id === divisionId))?.id)
        .filter(Boolean))];
      await adminPersist('upsertScores', { eventIds, scores: dbPayload })
        .catch(error => console.error("Erro ao salvar scores em lote no Supabase:", error));
    }
  };

  // Lançar Score manual (refatorado para chamar submitScoresBulk)
  const submitScore = (newScore: Score) => {
    submitScoresBulk([newScore]);
  };

  // Gerar Leaderboard Consolidado
  const getLeaderboard = (eventId: string, divisionId: string): AthleteOverall[] => {
    const event = events.find(e => e.id === eventId);
    if (!event) return [];

    // 1. Filtrar atletas usando leaderboard_entries (Fase 2 - dados já sincronizados por trigger)
    // leaderboard_entries contém apenas atletas com payment_status = 'payment_approved'.
    //
    // IMPORTANTE: leaderboard_entries é populada por um trigger que dispara apenas em
    // AFTER UPDATE de registrations (e por um backfill único na migration). Inscrições
    // criadas já aprovadas (ex.: cadastro manual via bilheteria) ou adicionadas após a
    // migration podem não ter entrada correspondente. Para que scores lançados nunca
    // desapareçam do leaderboard público por causa de uma lacuna de sincronização,
    // aplicamos um fallback: se NÃO houver nenhuma entrada para este evento/divisão,
    // usamos todos os atletas da divisão (comportamento pré-Fase 2).
    const leaderboardAthleteIds = new Set(
      leaderboardEntries
        .filter(le => le.event_id === eventId && le.division_id === divisionId)
        .map(le => le.athlete_id)
    );
    const hasLeaderboardEntries = leaderboardAthleteIds.size > 0;
    const divisionAthletes = athletes.filter(
      a => a.divisionId === divisionId && (!hasLeaderboardEntries || leaderboardAthleteIds.has(a.id))
    );

    // Se for Fitness Racing, o leaderboard é baseado estritamente no tempo do workout TOTAL (Percurso Completo)
    if (event.eventType === 'fitness_racing') {
      const totalWorkout = event.workouts.find(w => w.divisionId === divisionId && w.code === 'TOTAL');
      const workoutId = totalWorkout?.id || `wod-${divisionId}-total`;

      const list: AthleteOverall[] = divisionAthletes.map(athlete => {
        const athleteScores: Record<string, Score> = {};
        const score = scores.find(s => s.athleteId === athlete.id && s.workoutId === workoutId);

        if (score) {
          athleteScores[workoutId] = score;
        } else {
          athleteScores[workoutId] = {
            athleteId: athlete.id,
            workoutId,
            result: '-',
            value: 999999, // Alto valor para ordenação
            rank: 0,
            points: 0,
            splits: {}
          };
        }

        return {
          athlete,
          scores: athleteScores,
          totalPoints: athleteScores[workoutId].value, // totalPoints serve temporariamente como o tempo em segundos para ordenação
          rank: 0
        };
      });

      // Ordenar: tempos válidos (menor valor) primeiro, seguidos pelos inválidos (999999)
      const sortedList = [...list].sort((a, b) => a.totalPoints - b.totalPoints);

      let currentRank = 1;
      return sortedList.map((item, index) => {
        const hasResult = item.totalPoints < 999999;
        let rankVal = 0;
        if (hasResult) {
          if (index > 0 && item.totalPoints > sortedList[index - 1].totalPoints) {
            currentRank = index + 1;
          }
          rankVal = currentRank;
        }
        return {
          ...item,
          rank: rankVal
        };
      });
    }

    // 2. Mapear workouts do evento (Functional Fitness) filtrados pela divisão
    const divisionWorkouts = event.workouts.filter(w => !w.divisionId || w.divisionId === divisionId);
    const workoutIds = divisionWorkouts.map(w => w.id);

    // 3. Compilar scores para cada atleta da divisão somando apenas as provas já lançadas.
    //    Provas ainda sem resultado NÃO geram penalidade automática nem score falso: o evento
    //    segue em andamento. Em caso de ausência real, o organizador lança manualmente a
    //    pontuação máxima, que já entra como score normal e atua como penalidade.
    const list: AthleteOverall[] = divisionAthletes.map(athlete => {
      const athleteScores: Record<string, Score> = {};
      let totalPoints = 0;

      workoutIds.forEach(wId => {
        const score = scores.find(s => s.athleteId === athlete.id && s.workoutId === wId);
        if (score && score.result !== '-' && score.result !== '') {
          athleteScores[wId] = score;
          totalPoints += score.points || 0;
        } else {
          // Prova ainda não lançada/pendente: placeholder visual ('-'), sem somar ao total
          athleteScores[wId] = {
            athleteId: athlete.id,
            workoutId: wId,
            result: '-',
            value: 0,
            rank: 0,
            points: 0
          };
        }
      });

      return {
        athlete,
        scores: athleteScores,
        totalPoints,
        rank: 0 // Será calculado após ordenação global
      };
    });

    // Função auxiliar para resolver empates no confronto direto
    const getDirectWins = (a: AthleteOverall, b: AthleteOverall) => {
      let aWins = 0;
      let bWins = 0;
      workoutIds.forEach(wId => {
        const scoreA = a.scores[wId];
        const scoreB = b.scores[wId];
        const aPending = !scoreA || scoreA.result === '-' || scoreA.result === '';
        const bPending = !scoreB || scoreB.result === '-' || scoreB.result === '';

        if (!aPending && !bPending) {
          // Rank menor (melhor colocação na prova) é vitória
          const rA = scoreA.rank || 999999;
          const rB = scoreB.rank || 999999;
          if (rA < rB) aWins++;
          else if (rB < rA) bWins++;
        } else if (!aPending && bPending) {
          aWins++;
        } else if (aPending && !bPending) {
          bWins++;
        }
      });
      return { aWins, bWins };
    };

    // 4. Ordenar os atletas pelo total de pontos crescente (Low-Point) e aplicar critérios de desempate
    const sortedList = [...list].sort((a, b) => {
      if (a.totalPoints !== b.totalPoints) {
        return a.totalPoints - b.totalPoints; // Menos pontos é melhor
      }

      // Empate: Critério 1 - Confronto Direto
      const { aWins, bWins } = getDirectWins(a, b);
      if (aWins !== bWins) {
        return bWins - aWins; // Quem venceu mais provas contra o oponente fica na frente (menor index)
      }

      // Empate persistiu: Critério 2 - Colocação no WOD 1
      const firstWorkout = [...event.workouts].sort((x, y) => x.orderIndex - y.orderIndex)[0];
      if (firstWorkout) {
        const rA = a.scores[firstWorkout.id]?.rank || 999999;
        const rB = b.scores[firstWorkout.id]?.rank || 999999;
        return rA - rB; // Menor rank (melhor colocação) na primeira prova vence
      }

      return 0;
    });

    // 5. Aplicar o Rank geral final consolidado lidando com empates absolutos
    let currentRank = 1;
    return sortedList.map((item, index) => {
      if (index > 0) {
        const prevItem = sortedList[index - 1];
        let isEqual = item.totalPoints === prevItem.totalPoints;

        if (isEqual) {
          // Confronto direto
          const { aWins, bWins } = getDirectWins(item, prevItem);
          if (aWins === bWins) {
            // WOD 1
            const firstWorkout = [...event.workouts].sort((x, y) => x.orderIndex - y.orderIndex)[0];
            if (firstWorkout) {
              const rA = item.scores[firstWorkout.id]?.rank || 999999;
              const rB = prevItem.scores[firstWorkout.id]?.rank || 999999;
              if (rA !== rB) {
                isEqual = false;
              }
            }
          } else {
            isEqual = false;
          }
        }

        if (!isEqual) {
          currentRank = index + 1;
        }
      }
      return {
        ...item,
        rank: currentRank
      };
    });
  };

  // Atualizar configurações de bilheteria e formato do evento
  const updateEventTicketing = async (
    eventId: string,
    config: { format: 'individual' | 'duo' | 'trio'; ticketPrice: number; ticketSlots: number; isTicketingActive: boolean; }
  ) => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const previousEvents = events;
    // 1. Atualizar estado local de forma síncrona
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...config } : e));

    // 2. Persistir no Supabase em background
    try {
      await adminPersist('updateEvent', {
        eventId,
        data: {
        format: config.format,
        ticket_price: config.ticketPrice,
        ticket_slots: config.ticketSlots,
        is_ticketing_active: config.isTicketingActive
        }
      });
    } catch (error) {
      setEvents(previousEvents);
      console.error("Erro ao atualizar bilheteria no Supabase:", error);
      throw error;
    }
  };

  // Atualizar dados gerais do evento
  const updateEvent = async (eventId: string, updatedData: Partial<Event>) => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Evento não encontrado para este gestor.');
    }

    const previousEvents = events;
    // 1. Atualizar estado local de forma síncrona
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...updatedData } : e));

    // 2. Persistir no Supabase
    const dbPayload: Record<string, unknown> = {};
    if (updatedData.name !== undefined) dbPayload.name = updatedData.name;
    if (updatedData.logoUrl !== undefined) dbPayload.logo_url = updatedData.logoUrl;
    if (updatedData.bannerUrl !== undefined) dbPayload.banner_url = updatedData.bannerUrl;
    if (updatedData.status !== undefined) dbPayload.status = updatedData.status;
    if (updatedData.location !== undefined) dbPayload.location = updatedData.location;
    if (updatedData.date !== undefined) dbPayload.date = updatedData.date;
    if (updatedData.description !== undefined) dbPayload.description = updatedData.description;
    if (updatedData.format !== undefined) dbPayload.format = updatedData.format;
    if (updatedData.ticketPrice !== undefined) dbPayload.ticket_price = updatedData.ticketPrice;
    if (updatedData.ticketSlots !== undefined) dbPayload.ticket_slots = updatedData.ticketSlots;
    if (updatedData.isTicketingActive !== undefined) dbPayload.is_ticketing_active = updatedData.isTicketingActive;
    if (updatedData.time !== undefined) dbPayload.time = updatedData.time;
    if (updatedData.city !== undefined) dbPayload.city = updatedData.city;
    if (updatedData.state !== undefined) dbPayload.state = updatedData.state;
    if (updatedData.rules !== undefined) dbPayload.rules = updatedData.rules;
    if (updatedData.instagram !== undefined) dbPayload.instagram = updatedData.instagram;
    if (updatedData.website !== undefined) dbPayload.website = updatedData.website;
    if (updatedData.eventType !== undefined) dbPayload.event_type = updatedData.eventType;
    if (updatedData.scheduleItems !== undefined) dbPayload.event_schedule = updatedData.scheduleItems as EventScheduleItem[];
    if (updatedData.mpPublicKey !== undefined) dbPayload.mp_public_key = updatedData.mpPublicKey;

    try {
      await adminPersist('updateEvent', { eventId, data: dbPayload });
    } catch (error) {
      setEvents(previousEvents);
      console.error("Erro ao atualizar evento no Supabase:", error);
      throw error;
    }
  };

  // Salvar layout de percurso da divisão
  const saveCourseLayout = async (divisionId: string, layout: CourseStage[]) => {
    const event = events.find(evt => evt.divisions.some(d => d.id === divisionId));
    if (!event || event.organizerId !== currentUser?.id) {
      throw new Error('Categoria não encontrada para este gestor.');
    }

    const previousEvents = events;
    setEvents(prevEvents => prevEvents.map(evt => {
      const hasDiv = evt.divisions.some(d => d.id === divisionId);
      if (hasDiv) {
        return {
          ...evt,
          divisions: evt.divisions.map(d => d.id === divisionId ? { ...d, courseLayout: layout } : d)
        };
      }
      return evt;
    }));

    try {
      await adminPersist('updateDivision', {
        eventId: event.id,
        divisionId,
        data: { course_layout: layout }
      });
    } catch (error) {
      setEvents(previousEvents);
      console.error("Erro ao salvar percurso no Supabase:", error);
      throw error;
    }
  };

  const updateWorkout = async (eventId: string, workoutId: string, updatedData: Partial<Workout>) => {
    const event = events.find(e => e.id === eventId);
    if (!event || event.organizerId !== currentUser?.id || !event.workouts.some(w => w.id === workoutId)) {
      throw new Error('Prova não encontrada para este gestor.');
    }

    const previousEvents = events;
    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      return {
        ...e,
        workouts: e.workouts.map(w => w.id === workoutId ? { ...w, ...updatedData } : w)
      };
    }));

    const dbData: WorkoutDbUpdate = {};
    if (updatedData.name !== undefined) dbData.name = updatedData.name;
    if (updatedData.description !== undefined) dbData.description = updatedData.description;
    if (updatedData.type !== undefined) dbData.type = updatedData.type;
    if (updatedData.timeCap !== undefined) dbData.time_cap = updatedData.timeCap;
    if (updatedData.code !== undefined) dbData.code = updatedData.code;
    if (updatedData.orderIndex !== undefined) dbData.order_index = updatedData.orderIndex;
    if (updatedData.divisionId !== undefined) dbData.division_id = updatedData.divisionId;
    if (updatedData.tieBreaker !== undefined) dbData.tie_breaker = updatedData.tieBreaker;

    try {
      await adminPersist('updateWorkout', { eventId, workoutId, data: dbData });
    } catch (error) {
      setEvents(previousEvents);
      console.error("Erro ao atualizar prova no Supabase:", error);
      throw error;
    }
  };

  return (
    <AppContext.Provider
      value={{
        isLoading,
        isSessionHydrated,
        bootstrapStatus,
        bootstrapError,
        retryBootstrap,
        publicEventDataStatus,
        loadPublicEventData,
        events,
        athletes,
        scores,
        registrations,
        registrationsCount,
        contestations,
        coupons,
        users,
        currentUser,
        login,
        logout,
        createManagerAccount,
        updateManagerServiceValidity,
        setFeaturedHomeEvent,
        addEvent,
        addDivision,
        updateDivision,
        reorderDivisions,
        addWorkout,
        deleteEvent,
        deleteDivision,
        deleteWorkout,
        registerTicket,
        updateRegistrationDetails,
        cancelRegistration,
        markRegistrationRefunded,
        refreshRegistrations,
        submitScore,
        submitScoresBulk,
        getLeaderboard,
        updateEventTicketing,
        updateEvent,
        saveCourseLayout,
        updateWorkout,
        addCoupon,
        updateCoupon,
        toggleCouponActive,
        incrementCouponUsage,
        changePassword,
        updateAthleteProfile
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp deve ser usado dentro de um AppProvider');
  }
  return context;
}
