'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { WorkoutType, Event, Athlete, Division, Score, CourseStage, Coupon, Registration, User, Workout, AthleteOverall, EventScheduleItem } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { supabase } from '../lib/supabase';
import { INITIAL_EVENTS, INITIAL_ATHLETES, INITIAL_SCORES, INITIAL_USERS } from '../data/mockData';
import { buildFitnessRacingCourse, buildFitnessRacingDefaults, normalizeInstagram } from '@/lib/fitnessRacing';

type RegistrationDraft = Omit<Registration, 'id' | 'createdAt'> & Partial<Pick<Registration, 'id' | 'createdAt'>>;
type AthleteProfileDraft = {
  id?: string;
  birthDate?: string;
  gender?: 'male' | 'female';
  city?: string;
  state?: string;
  instagram?: string;
  photoUrl?: string;
  email?: string;
  phone?: string;
  isTeam?: boolean;
  teamMembers?: { name: string; instagram: string; }[];
};

interface AppContextType {
  isLoading: boolean;
  events: Event[];
  athletes: Athlete[];
  scores: Score[];
  registrations: Registration[];
  users: User[];
  currentUser: User | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  createManagerAccount: (name: string, email: string, password: string, organization: string) => Promise<boolean>;
  addEvent: (event: Omit<Event, 'id' | 'organizerId' | 'sponsors' | 'format' | 'ticketPrice' | 'ticketSlots' | 'isTicketingActive'> & { format?: 'individual' | 'duo' | 'trio'; ticketPrice?: number; ticketSlots?: number; isTicketingActive?: boolean; eventType?: 'functional_fitness' | 'fitness_racing'; }) => void;
  addDivision: (eventId: string, division: Omit<Division, 'id'>) => void;
  updateDivision: (eventId: string, divisionId: string, updatedData: Partial<Division>) => Promise<void>;
  addWorkout: (eventId: string, workout: Omit<Workout, 'id'>) => void;
  deleteEvent: (eventId: string) => Promise<void>;
  deleteDivision: (eventId: string, divisionId: string) => Promise<void>;
  deleteWorkout: (eventId: string, workoutId: string) => Promise<void>;
  registerTicket: (registration: RegistrationDraft, athleteProfile?: AthleteProfileDraft) => Registration;
  refreshRegistrations: () => Promise<Registration[]>;
  submitScore: (score: Score) => void;
  submitScoresBulk: (newScores: Score[]) => Promise<void>;
  getLeaderboard: (eventId: string, divisionId: string) => AthleteOverall[];
  updateEventTicketing: (eventId: string, config: { format: 'individual' | 'duo' | 'trio'; ticketPrice: number; ticketSlots: number; isTicketingActive: boolean; }) => Promise<void>;
  updateEvent: (eventId: string, updatedData: Partial<Event>) => Promise<void>;
  saveCourseLayout: (divisionId: string, layout: CourseStage[]) => Promise<void>;
  updateWorkout: (eventId: string, workoutId: string, updatedData: Partial<Workout>) => Promise<void>;
  coupons: Coupon[];
  addCoupon: (coupon: Omit<Coupon, 'id' | 'usageCount' | 'createdAt'>) => Promise<void>;
  incrementCouponUsage: (eventId: string, code: string) => Promise<void>;
  changePassword: (userId: string, currentPassword: string, newPassword: string) => Promise<boolean>;
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

type RegistrationDbRow = Record<string, unknown>;

const optionalString = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : undefined;

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
  createdAt: String(r.created_at),
  couponCode: optionalString(r.coupon_code),
  paymentStatus: (r.payment_status || 'payment_approved') as Registration['paymentStatus'],
  paymentMethod: optionalString(r.payment_method),
  paymentId: optionalString(r.payment_id),
  paymentStatusDetail: optionalString(r.payment_status_detail),
  paymentErrorMessage: optionalString(r.payment_error_message),
  updatedAt: optionalString(r.updated_at)
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [currentUser, setCurrentUser] = useLocalStorage<User | null>('woda_current_user', null);

  const refreshRegistrations = useCallback(async () => {
    const { data, error } = await supabase.from('registrations').select('*');
    if (error) {
      console.error("Erro ao atualizar inscrições do Supabase:", error);
      throw error;
    }

    const mappedRegs = (data || []).map(mapRegistrationFromDb);
    setRegistrations(mappedRegs);
    return mappedRegs;
  }, []);

  // Carregar dados iniciais do Supabase
  useEffect(() => {
    const fetchAllData = async () => {
      try {
        setIsLoading(true);
        // 1. Carregar usuários
        const { data: dbUsers } = await supabase.from('users').select('*');
        if (dbUsers && dbUsers.length > 0) {
          setUsers(dbUsers);
        } else {
          setUsers(INITIAL_USERS);
        }

        // 2. Carregar atletas
        const { data: dbAthletes } = await supabase.from('athletes').select('*');
        if (dbAthletes && dbAthletes.length > 0) {
          const mappedAthletes: Athlete[] = dbAthletes.map(a => {
            let parsedTeamMembers: { name: string; instagram: string }[] = [];
            if (a.team_members) {
              try {
                parsedTeamMembers = typeof a.team_members === 'string' ? JSON.parse(a.team_members) : a.team_members;
              } catch (err) {
                console.error("Erro ao fazer parse dos teamMembers do atleta:", a.id, err);
              }
            }
            return {
              id: a.id,
              name: a.name,
              box: a.box,
              country: a.country,
              divisionId: a.division_id,
              birthDate: a.birth_date || undefined,
              gender: a.gender || undefined,
              city: a.city || undefined,
              state: a.state || undefined,
              instagram: a.instagram || undefined,
              photoUrl: a.photo_url || undefined,
              email: a.email || undefined,
              phone: a.phone || undefined,
              isTeam: a.is_team !== undefined ? Boolean(a.is_team) : false,
              teamMembers: Array.isArray(parsedTeamMembers) ? parsedTeamMembers : []
            };
          });
          setAthletes(mappedAthletes);
        } else {
          setAthletes(INITIAL_ATHLETES);
        }

        // 3. Carregar scores
        const { data: dbScores } = await supabase.from('scores').select('*');
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
          setScores(INITIAL_SCORES);
        }

        // 4. Carregar inscrições
        const { data: dbRegistrations } = await supabase.from('registrations').select('*');
        if (dbRegistrations && dbRegistrations.length > 0) {
          const mappedRegs: Registration[] = dbRegistrations.map(mapRegistrationFromDb);
          setRegistrations(mappedRegs);
        } else {
          setRegistrations([]);
        }

        // 4.1 Carregar cupons
        const { data: dbCoupons } = await supabase.from('coupons').select('*');
        if (dbCoupons && dbCoupons.length > 0) {
          const mappedCoupons: Coupon[] = dbCoupons.map(c => ({
            id: c.id,
            eventId: c.event_id,
            code: c.code,
            discountType: c.discount_type as 'percentage' | 'fixed',
            discountValue: Number(c.discount_value),
            usageLimit: c.usage_limit !== null ? Number(c.usage_limit) : 100,
            usageCount: c.usage_count !== null ? Number(c.usage_count) : 0,
            createdAt: c.created_at
          }));
          setCoupons(mappedCoupons);
        } else {
          setCoupons([]);
        }

        // 5. Carregar eventos (excluindo mp_access_token por segurança), divisões, workouts e credenciais Mercado Pago dos gestores
        const { data: dbEvents } = await supabase
          .from('events')
          .select('id, name, logo_url, banner_url, status, location, date, description, organizer_id, sponsors, format, ticket_price, ticket_slots, is_ticketing_active, time, city, state, rules, instagram, website, event_type, event_schedule, mp_public_key, marketplace_fee');
        const { data: dbDivisions } = await supabase.from('divisions').select('*');
        const { data: dbWorkouts } = await supabase.from('workouts').select('*');
        const { data: dbMpAccounts } = await supabase
          .from('mercadopago_accounts')
          .select('user_id, public_key')
          .eq('status', 'connected');

        if (dbEvents && dbEvents.length > 0 && dbDivisions && dbWorkouts) {
          const combinedEvents = dbEvents.map((evt): Event => {
            const evDivs: Division[] = dbDivisions
              .filter(d => d.event_id === evt.id)
              .map(d => ({
                id: d.id,
                name: d.name,
                category: d.category,
                type: d.type || 'individual',
                slotsLimit: d.slots_limit !== undefined && d.slots_limit !== null ? Number(d.slots_limit) : 100,
                price: d.price !== undefined && d.price !== null ? Number(d.price) : 150.00,
                isActive: d.is_active !== undefined && d.is_active !== null ? Boolean(d.is_active) : true,
                useAgeGroups: d.use_age_groups || false,
                ageGroups: d.age_groups ? (typeof d.age_groups === 'string' ? JSON.parse(d.age_groups) : d.age_groups) : [],
                courseLayout: d.course_layout ? (typeof d.course_layout === 'string' ? JSON.parse(d.course_layout) : d.course_layout) : [],
                isCoursePublished: d.is_course_published || false
              }));

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
              mpAccessToken: ''
            };
          });
          setEvents(combinedEvents);
        } else {
          setEvents(INITIAL_EVENTS);
        }
      } catch (err) {
        console.error("Erro ao carregar dados do Supabase, usando fallbacks:", err);
        setUsers(INITIAL_USERS);
        setAthletes(INITIAL_ATHLETES);
        setScores(INITIAL_SCORES);
        setEvents(INITIAL_EVENTS);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, []);

  // Rotina de reparo automático (Self-Healing) de dados legados do Fitness Racing
  useEffect(() => {
    if (events.length === 0) return;

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
        const { error } = await supabase.from('workouts').insert(dbWorkoutsToInsert);
        if (error) {
          console.error("[Self-Healing] Erro ao criar workouts virtuais ausentes:", error);
        } else {
          setEvents(updatedEvents);
        }
      }
    };

    repairLegacyEvents();
  }, [events]);

  // Lógica de Login
  const login = async (emailInput: string, passwordInput: string): Promise<boolean> => {
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
        return false;
      }

      setCurrentUser(data.user);
      return true;
    } catch (err) {
      console.error('Erro crítico no login:', err);
      return false;
    }
  };

  // Lógica de Logout
  const logout = () => {
    setCurrentUser(null);
  };

  // Lógica para Proprietário cadastrar Gestor
  const createManagerAccount = async (name: string, emailInput: string, passwordInput: string, organization: string): Promise<boolean> => {
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
          organization
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
  const addEvent = (eventData: Omit<Event, 'id' | 'organizerId' | 'sponsors' | 'format' | 'ticketPrice' | 'ticketSlots' | 'isTicketingActive'> & {
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
  }) => {
    if (!currentUser?.id) {
      alert('Sessão inválida ou expirada. Por favor, faça login novamente para criar o evento.');
      return;
    }

    const newId = eventData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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
      mpAccessToken: eventData.mpAccessToken || ''
    };

    // Salvar no Supabase em background
    supabase.from('events').insert({
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
      mp_public_key: newEvent.mpPublicKey || null,
      mp_access_token: newEvent.mpAccessToken || null
    }).then(({ error }) => {
      if (error) {
        console.error("Erro ao criar evento no Supabase:", error);
        return;
      }

      if (eventData.eventType === 'fitness_racing' && defaultFitnessRacing.divisions.length > 0) {
        supabase.from('divisions').insert(defaultFitnessRacing.divisions.map((division) => ({
          id: division.id,
          event_id: newEvent.id,
          name: division.name,
          category: division.category,
          type: division.type,
          slots_limit: division.slotsLimit,
          price: division.price,
          is_active: division.isActive,
          use_age_groups: division.useAgeGroups || false,
          age_groups: division.ageGroups || [],
          course_layout: division.courseLayout || []
        }))).then(({ error: divError }) => {
          if (divError) {
            console.error("Erro ao criar categorias padrão Fitness Racing:", divError);
            return;
          }

          supabase.from('workouts').insert(defaultFitnessRacing.workouts.map((workout) => ({
            id: workout.id,
            event_id: newEvent.id,
            name: workout.name,
            description: workout.description,
            type: workout.type,
            code: workout.code,
            order_index: workout.orderIndex,
            division_id: workout.divisionId || null,
            tie_breaker: workout.tieBreaker || ''
          }))).then(({ error: wodError }) => {
            if (wodError) console.error("Erro ao criar workouts padrão Fitness Racing:", wodError);
          });
        });
      }
    });

    setEvents([...events, newEvent]);
  };

  // Cadastrar Divisão
  const addDivision = (eventId: string, divisionData: Omit<Division, 'id'>) => {
    const divId = `div-${eventId}-${divisionData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const event = events.find(e => e.id === eventId);
    const newDivision: Division = {
      ...divisionData,
      id: divId,
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

    // Salvar no Supabase em background
    supabase.from('divisions').insert({
      id: newDivision.id,
      event_id: eventId,
      name: newDivision.name,
      category: newDivision.category,
      type: newDivision.type,
      slots_limit: newDivision.slotsLimit,
      price: newDivision.price,
      is_active: newDivision.isActive,
      use_age_groups: newDivision.useAgeGroups || false,
      age_groups: newDivision.ageGroups || [],
      course_layout: newDivision.courseLayout || []
    }).then(({ error }) => {
      if (error) {
        console.error("Erro ao criar divisão no Supabase:", error);
        return;
      }

      if (autoWorkout) {
        supabase.from('workouts').insert({
          id: autoWorkout.id,
          event_id: eventId,
          name: autoWorkout.name,
          description: autoWorkout.description,
          type: autoWorkout.type,
          code: autoWorkout.code,
          order_index: autoWorkout.orderIndex,
          division_id: divId,
          tie_breaker: ''
        }).then(({ error: wError }) => {
          if (wError) console.error("Erro ao criar workout virtual no Supabase:", wError);
        });
      }
    });

    setEvents(events.map(e => {
      if (e.id === eventId) {
        return {
          ...e,
          divisions: [...e.divisions, newDivision],
          workouts: autoWorkout ? [...e.workouts, autoWorkout] : e.workouts
         };
      }
      return e;
    }));
  };

  const updateDivision = async (eventId: string, divisionId: string, updatedData: Partial<Division>) => {
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
    if (updatedData.useAgeGroups !== undefined) dbPayload.use_age_groups = updatedData.useAgeGroups;
    if (updatedData.ageGroups !== undefined) dbPayload.age_groups = updatedData.ageGroups;
    if (updatedData.courseLayout !== undefined) dbPayload.course_layout = updatedData.courseLayout;
    if (updatedData.isCoursePublished !== undefined) dbPayload.is_course_published = updatedData.isCoursePublished;

    const { error } = await supabase
      .from('divisions')
      .update(dbPayload)
      .eq('id', divisionId);

    if (error) {
      console.error("Erro ao atualizar categoria no Supabase:", error);
    }
  };

  // Excluir Divisão/Categoria e limpar dados vinculados no estado local
  const deleteDivision = async (eventId: string, divisionId: string) => {
    const athleteIds = athletes.filter(a => a.divisionId === divisionId).map(a => a.id);
    const linkedWorkoutIds = events
      .find(e => e.id === eventId)
      ?.workouts.filter(w => w.divisionId === divisionId).map(w => w.id) || [];

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

    const { error } = await supabase
      .from('divisions')
      .delete()
      .eq('id', divisionId);

    if (error) {
      console.error("Erro ao excluir divisão no Supabase:", error);
    }
  };

  // Excluir Evento e limpar dados vinculados no estado local
  const deleteEvent = async (eventId: string) => {
    const eventToDelete = events.find(e => e.id === eventId);
    if (!eventToDelete) return;

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

    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId);

    if (error) {
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
    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      return {
        ...e,
        workouts: e.workouts.filter(w => w.id !== workoutId)
      };
    }));
    setScores(prev => prev.filter(s => s.workoutId !== workoutId));

    const { error } = await supabase
      .from('workouts')
      .delete()
      .eq('id', workoutId);

    if (error) {
      console.error("Erro ao excluir prova no Supabase:", error);
    }
  };

  // Cadastrar Prova (Workout)
  const addWorkout = (eventId: string, workoutData: Omit<Workout, 'id'>) => {
    const workoutId = `wod-${eventId}-${workoutData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const newWorkout: Workout = {
      ...workoutData,
      id: workoutId
    };

    // Salvar no Supabase em background
    supabase.from('workouts').insert({
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
    }).then(({ error }) => {
      if (error) console.error("Erro ao criar prova no Supabase:", error);
    });

    setEvents(events.map(e => {
      if (e.id === eventId) {
        return {
          ...e,
          workouts: [...e.workouts, newWorkout]
        };
      }
      return e;
    }));
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
        email: athleteProfile?.email || '',
        phone: athleteProfile?.phone || '',
        isTeam: athleteProfile?.isTeam || false,
        teamMembers: athleteProfile?.teamMembers?.map(m => ({
          name: m.name,
          instagram: normalizeInstagram(m.instagram)
        })) || []
      };
    }

    // Salvar no Supabase em background
    const savePromise = async () => {
      if (newAthlete) {
        await supabase.from('athletes').upsert({
          id: newAthlete.id,
          name: newAthlete.name,
          box: newAthlete.box,
          country: newAthlete.country,
          division_id: newAthlete.divisionId,
          birth_date: newAthlete.birthDate || null,
          gender: newAthlete.gender || null,
          city: newAthlete.city || null,
          state: newAthlete.state || null,
          instagram: newAthlete.instagram || null,
          photo_url: newAthlete.photoUrl || null,
          email: newAthlete.email || null,
          phone: newAthlete.phone || null,
          is_team: newAthlete.isTeam || false,
          team_members: newAthlete.teamMembers ? JSON.stringify(newAthlete.teamMembers) : '[]'
        }, { onConflict: 'id' });
      }

      await supabase.from('registrations').upsert({
        id: newRegistration.id,
        event_id: newRegistration.eventId,
        division_id: newRegistration.divisionId,
        user_id: newRegistration.userId || null,
        athlete_id: newRegistration.athleteId || newAthlete?.id || null,
        athlete_name: newRegistration.athleteName,
        athlete_email: newRegistration.athleteEmail,
        athlete_phone: newRegistration.athletePhone,
        box: newRegistration.box,
        gender: newRegistration.gender,
        ticket_type: newRegistration.ticketType,
        ticket_price: newRegistration.ticketPrice,
        quantity: newRegistration.quantity,
        total_paid: newRegistration.totalPaid,
        created_at: newRegistration.createdAt,
        coupon_code: newRegistration.couponCode || null,
        payment_status: newRegistration.paymentStatus || 'payment_approved',
        payment_method: newRegistration.paymentMethod || null,
        payment_id: newRegistration.paymentId || null,
        payment_status_detail: newRegistration.paymentStatusDetail || null,
        payment_error_message: newRegistration.paymentErrorMessage || null,
        updated_at: newRegistration.updatedAt || new Date().toISOString()
      }, { onConflict: 'id' });
    };

    savePromise().catch(err => console.error("Erro ao registrar ticket no Supabase:", err));

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

  // Cadastrar Cupom de Desconto
  const addCoupon = async (couponData: Omit<Coupon, 'id' | 'usageCount' | 'createdAt'>) => {
    const newCoupon: Coupon = {
      ...couponData,
      id: `coupon-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      usageCount: 0,
      createdAt: new Date().toISOString()
    };

    setCoupons(prev => [...prev, newCoupon]);

    const { error } = await supabase.from('coupons').insert({
      id: newCoupon.id,
      event_id: newCoupon.eventId,
      code: newCoupon.code,
      discount_type: newCoupon.discountType,
      discount_value: newCoupon.discountValue,
      usage_limit: newCoupon.usageLimit,
      usage_count: newCoupon.usageCount
    });

    if (error) {
      console.error("Erro ao adicionar cupom no Supabase:", error);
    }
  };

  // Incrementar o uso de um cupom
  const incrementCouponUsage = async (eventId: string, code: string) => {
    setCoupons(prev => prev.map(c =>
      (c.eventId === eventId && c.code.toLowerCase() === code.toLowerCase())
        ? { ...c, usageCount: c.usageCount + 1 }
        : c
    ));

    const { data: dbCoupons } = await supabase
      .from('coupons')
      .select('*')
      .eq('event_id', eventId)
      .ilike('code', code);

    if (dbCoupons && dbCoupons[0]) {
      const { error } = await supabase
        .from('coupons')
        .update({ usage_count: (dbCoupons[0].usage_count || 0) + 1 })
        .eq('id', dbCoupons[0].id);

      if (error) {
        console.error("Erro ao atualizar uso do cupom no Supabase:", error);
      }
    }
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
        const key = `${newScore.workoutId}|${athlete.divisionId}`;
        if (!affectedKeySet.has(key)) {
          affectedKeySet.add(key);
          affectedPairs.push({ workoutId: newScore.workoutId, divisionId: athlete.divisionId });
        }
      }
    });

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
      const { error } = await supabase
        .from('scores')
        .upsert(dbPayload, { onConflict: 'athlete_id,workout_id' });

      if (error) {
        console.error("Erro ao salvar scores em lote no Supabase:", error);
      }
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

    // 1. Filtrar atletas da divisão que possuem pagamento aprovado
    const approvedAthleteIds = new Set(
      registrations
        .filter(r => r.eventId === eventId && r.paymentStatus === 'payment_approved')
        .map(r => r.athleteId)
        .filter(Boolean)
    );
    const divisionAthletes = athletes.filter(a => a.divisionId === divisionId && approvedAthleteIds.has(a.id));

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

    // 2. Mapear workouts do evento (Functional Fitness)
    const workoutIds = event.workouts.map(w => w.id);

    // 3. Compilar scores para cada atleta da divisão com penalidade para não lançados
    const list: AthleteOverall[] = divisionAthletes.map(athlete => {
      const athleteScores: Record<string, Score> = {};
      let totalPoints = 0;

      workoutIds.forEach(wId => {
        const score = scores.find(s => s.athleteId === athlete.id && s.workoutId === wId);
        if (score) {
          athleteScores[wId] = score;
          totalPoints += score.points || 0;
        } else {
          // Score não lançado ou pendente: penalidade = número total de atletas da divisão + 1
          const penaltyPoints = divisionAthletes.length + 1;
          athleteScores[wId] = {
            athleteId: athlete.id,
            workoutId: wId,
            result: '-',
            value: 0,
            rank: 0,
            points: penaltyPoints
          };
          totalPoints += penaltyPoints;
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
    // 1. Atualizar estado local de forma síncrona
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...config } : e));

    // 2. Persistir no Supabase em background
    const { error } = await supabase
      .from('events')
      .update({
        format: config.format,
        ticket_price: config.ticketPrice,
        ticket_slots: config.ticketSlots,
        is_ticketing_active: config.isTicketingActive
      })
      .eq('id', eventId);

    if (error) {
      console.error("Erro ao atualizar bilheteria no Supabase:", error);
    }
  };

  // Atualizar dados gerais do evento
  const updateEvent = async (eventId: string, updatedData: Partial<Event>) => {
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
    if (updatedData.mpAccessToken !== undefined) dbPayload.mp_access_token = updatedData.mpAccessToken;

    const { error } = await supabase
      .from('events')
      .update(dbPayload)
      .eq('id', eventId);

    if (error) {
      console.error("Erro ao atualizar evento no Supabase:", error);
    }
  };

  // Salvar layout de percurso da divisão
  const saveCourseLayout = async (divisionId: string, layout: CourseStage[]) => {
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

    const { error } = await supabase
      .from('divisions')
      .update({ course_layout: layout })
      .eq('id', divisionId);

    if (error) {
      console.error("Erro ao salvar percurso no Supabase:", error);
    }
  };

  const updateWorkout = async (eventId: string, workoutId: string, updatedData: Partial<Workout>) => {
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

    const { error } = await supabase
      .from('workouts')
      .update(dbData)
      .eq('id', workoutId);

    if (error) {
      console.error("Erro ao atualizar prova no Supabase:", error);
      throw error;
    }
  };

  return (
    <AppContext.Provider
      value={{
        isLoading,
        events,
        athletes,
        scores,
        registrations,
        coupons,
        users,
        currentUser,
        login,
        logout,
        createManagerAccount,
        addEvent,
        addDivision,
        updateDivision,
        addWorkout,
        deleteEvent,
        deleteDivision,
        deleteWorkout,
        registerTicket,
        refreshRegistrations,
        submitScore,
        submitScoresBulk,
        getLeaderboard,
        updateEventTicketing,
        updateEvent,
        saveCourseLayout,
        updateWorkout,
        addCoupon,
        incrementCouponUsage,
        changePassword
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
