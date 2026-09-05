'use client';

import React, { useState, use, useEffect } from 'react';
import Image from 'next/image';
import { useApp } from '@/context/AppContext';
import { RegisterModal } from '@/components/RegisterModal';
import { RegistrationVoucher } from '@/components/RegistrationVoucher';
import { 
  Calendar, MapPin, Trophy, Share2, Ticket, Clock, 
  Dumbbell, AlignLeft, ShieldCheck, ChevronRight, UserCheck, Medal,
  Sparkles, Footprints, Lock, ChevronDown
} from 'lucide-react';
import Link from 'next/link';
import { Registration, Athlete, EventScheduleItem, Workout } from '@/types';
import { getEventStatus, getRegistrationAvailability } from '@/lib/eventStatus';
import { getHeatSlotLabel, resolveHeatParticipantSlots } from '@/lib/scheduleParticipants';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ScheduleHeatGroup {
  id: string;
  title: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  heatCount: number;
  participantCount: number;
  items: EventScheduleItem[];
}

type ScheduleBlock =
  | { id: string; type: 'general'; item: EventScheduleItem }
  | { id: string; type: 'heatGroup'; group: ScheduleHeatGroup };

// Eventos WODArena rodam no horário de Brasília/Fortaleza (UTC-03:00, sem horário de verão desde 2019);
// fixar o offset garante que o status "ao vivo" não dependa do fuso do dispositivo de quem acessa.
const EVENT_UTC_OFFSET = '-03:00';

const parseScheduleClock = (dateValue?: string, timeValue?: string): number | null => {
  if (!dateValue || !timeValue) return null;
  const date = dateValue.includes('/')
    ? dateValue.split('/').reverse().join('-')
    : dateValue;
  const timestamp = Date.parse(`${date}T${timeValue}:00${EVENT_UTC_OFFSET}`);
  return Number.isNaN(timestamp) ? null : timestamp;
};

const parseScheduleTimestamp = (item: EventScheduleItem) => parseScheduleClock(item.date, item.time) ?? 0;

type HeatLiveStatus = 'live' | 'next' | 'upcoming' | 'done';

const HEAT_STATUS_META: Record<HeatLiveStatus, { dotClass: string; label: string; badge?: string }> = {
  live: { dotClass: 'bg-trading-up ring-4 ring-trading-up/30 animate-pulse', label: 'Em andamento', badge: 'Ao vivo' },
  next: { dotClass: 'bg-primary ring-4 ring-primary/25', label: 'Próxima bateria', badge: 'Próxima' },
  upcoming: { dotClass: 'bg-muted-soft', label: 'Bateria agendada' },
  done: { dotClass: 'bg-transparent ring-2 ring-muted-soft', label: 'Bateria encerrada', badge: 'Encerrada' },
};

const formatScheduleDate = (value?: string) => {
  if (!value) return 'Data a confirmar';

  if (value.includes('/')) return value;

  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    weekday: 'short'
  }).format(new Date(year, month - 1, day));
};

const getHeatGroupFallbackTitle = (item: EventScheduleItem) => {
  const match = item.title.match(/-\s*(.+)$/);
  return match?.[1]?.trim() || 'Baterias do evento';
};

const getWorkoutScheduleTitle = (workouts: Workout[], item: EventScheduleItem) => {
  const workout = workouts.find(candidate => candidate.id === item.workoutId);
  if (!workout) return getHeatGroupFallbackTitle(item);

  return workout.code
    ? `${workout.code} · ${workout.name}`
    : workout.name;
};

const buildScheduleHeatGroups = (
  items: EventScheduleItem[],
  workouts: Workout[]
): ScheduleHeatGroup[] => {
  const groupMap = new Map<string, ScheduleHeatGroup>();

  items
    .filter(item => item.kind === 'heat')
    .forEach((item) => {
      const id = item.workoutId || getHeatGroupFallbackTitle(item);
      const existing = groupMap.get(id);
      const participantCount = (item.athleteIds || []).filter(Boolean).length;

      if (existing) {
        existing.items.push(item);
        existing.heatCount += 1;
        existing.participantCount += participantCount;
        return;
      }

      groupMap.set(id, {
        id,
        title: getWorkoutScheduleTitle(workouts, item),
        dateLabel: formatScheduleDate(item.date),
        startTime: item.time || 'A confirmar',
        endTime: item.endTime || item.time || 'A confirmar',
        heatCount: 1,
        participantCount,
        items: [item]
      });
    });

  return Array.from(groupMap.values()).map(group => {
    const sortedItems = [...group.items].sort((a, b) => parseScheduleTimestamp(a) - parseScheduleTimestamp(b));
    return {
      ...group,
      startTime: sortedItems[0]?.time || group.startTime,
      endTime: sortedItems[sortedItems.length - 1]?.endTime || sortedItems[sortedItems.length - 1]?.time || group.endTime,
      items: sortedItems
    };
  });
};

export default function EventPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const eventId = resolvedParams.id;
  
  const {
    events,
    athletes,
    isSessionHydrated,
    publicEventDataStatus,
    loadPublicEventData,
    registerTicket,
    refreshRegistrations,
    isLoading,
    bootstrapStatus
  } = useApp();
  const [activeTab, setActiveTab] = useState<'details' | 'divisions' | 'schedule' | 'workouts'>('details');
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [shareFeedback, setShareFeedback] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [confirmedVoucher, setConfirmedVoucher] = useState<{ registration: Registration; athlete: Athlete; cpf?: string } | null>(null);
  const [selectedDivisionForCourseId, setSelectedDivisionForCourseId] = useState<string>('');
  const [expandedHeatIds, setExpandedHeatIds] = useState<Set<string>>(new Set());
  const [scheduleNowTs, setScheduleNowTs] = useState(() => Date.now());

  useEffect(() => {
    if (activeTab !== 'schedule') return;
    // Defer o refresh imediato para o próximo macrotask: evita setState síncrono dentro do
    // efeito (cascata de render) e ainda assim atualiza o relógio assim que a aba abre,
    // sem esperar os 30s do próximo tick do interval.
    const refreshId = setTimeout(() => setScheduleNowTs(Date.now()), 0);
    const intervalId = setInterval(() => setScheduleNowTs(Date.now()), 30000);
    return () => {
      clearTimeout(refreshId);
      clearInterval(intervalId);
    };
  }, [activeTab]);

  useEffect(() => {
    if (!isSessionHydrated) return;
    void loadPublicEventData(eventId).catch((error) => {
      console.error('[EventPage] Erro ao carregar dados públicos do evento:', error);
    });
  }, [eventId, isSessionHydrated, loadPublicEventData]);

  // Procurar evento correspondente
  const event = events.find(e => e.id === eventId);

  // Calcular menor preço de inscrição das categorias reais
  const minPrice = React.useMemo(() => {
    if (!event) return 0;
    if (!event.divisions || event.divisions.length === 0) return event.ticketPrice || 0;
    const activeDivs = event.divisions.filter(d => d.isActive !== false);
    if (activeDivs.length === 0) return event.ticketPrice || 0;
    return Math.min(...activeDivs.map(d => d.price));
  }, [event]);

  const formattedMinPrice = React.useMemo(() => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minPrice);
  }, [minPrice]);

  // Permitir trocar aba via query parameter se fornecido.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const tabParam = searchParams.get('tab');
      if (tabParam && ['details', 'divisions', 'schedule', 'workouts'].includes(tabParam)) {
        // Sync the initial tab from the external URL after mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab(tabParam as typeof activeTab);
      }
    }
  }, []);

  // Monitorar retorno de pagamento do Mercado Pago
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const paymentStatus = searchParams.get('payment');

      if (paymentStatus === 'success') {
        const pendingRegStr = sessionStorage.getItem('pending_registration');
        if (pendingRegStr) {
          try {
            const { registrationData, athleteProfile, cpf } = JSON.parse(pendingRegStr);
            console.log("[WODArena Checkout] Pagamento aprovado! Sincronizando inscrição localmente...");
            const paymentId = searchParams.get('payment_id') || searchParams.get('collection_id') || undefined;
            const approvedRegistrationData = {
              ...registrationData,
              paymentStatus: 'payment_approved' as const,
              paymentMethod: searchParams.get('payment_type') || 'mercadopago_preference',
              paymentId,
              paymentStatusDetail: searchParams.get('status') || 'approved'
            };

            const createdReg = registerTicket(approvedRegistrationData, athleteProfile);
            // O uso do cupom é contabilizado no servidor ao confirmar o pagamento.

            setTimeout(() => {
              setConfirmedVoucher({
                registration: createdReg || {
                  ...approvedRegistrationData,
                  id: registrationData.id || `reg-${Date.now()}`,
                  createdAt: new Date().toISOString()
                },
                athlete: athleteProfile,
                cpf: cpf || ''
              });
              setPaymentNotice({
                text: 'Sua inscrição foi confirmada e paga com sucesso via Mercado Pago! Seus dados já estão sincronizados.',
                tone: 'success'
              });
            }, 0);

          } catch (e) {
            console.error("[WODArena Checkout] Erro no processamento local de contingência:", e);
          } finally {
            sessionStorage.removeItem('pending_registration');
          }
        } else {
          refreshRegistrations().catch((err) => {
            console.error("[WODArena Checkout] Erro ao atualizar inscrições após retorno aprovado:", err);
          });
          setTimeout(() => {
            setPaymentNotice({
              text: 'Pagamento confirmado! Sua inscrição foi processada.',
              tone: 'success'
            });
          }, 0);
        }

        // Limpar parâmetros de pagamento da URL
        const cleanParams = new URLSearchParams(window.location.search);
        cleanParams.delete('payment');
        cleanParams.delete('payment_id');
        cleanParams.delete('status');
        const paramsStr = cleanParams.toString();
        const newUrl = window.location.pathname + (paramsStr ? `?${paramsStr}` : '');
        window.history.replaceState(null, '', newUrl);

      } else if (paymentStatus === 'failure') {
        setTimeout(() => {
          setPaymentNotice({
            text: 'O pagamento não pôde ser concluído no Mercado Pago. Por favor, tente novamente.',
            tone: 'error'
          });
        }, 0);
        sessionStorage.removeItem('pending_registration');
        
        const cleanParams = new URLSearchParams(window.location.search);
        cleanParams.delete('payment');
        cleanParams.delete('payment_id');
        cleanParams.delete('status');
        const paramsStr = cleanParams.toString();
        const newUrl = window.location.pathname + (paramsStr ? `?${paramsStr}` : '');
        window.history.replaceState(null, '', newUrl);
      }
    }
  }, [event, registerTicket, refreshRegistrations]);

  // Inicializar a categoria selecionada para o percurso
  useEffect(() => {
    if (event && event.eventType === 'fitness_racing' && event.divisions) {
      const firstPub = event.divisions.find(d => d.isCoursePublished);
      if (firstPub) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedDivisionForCourseId(firstPub.id);
      }
    }
  }, [event]);

  const scheduleItems = React.useMemo(() => {
    const seenHeatKeys = new Set<string>();
    const qualifierDeadlines: EventScheduleItem[] = event?.eventType === 'functional_fitness_qualifier'
      ? (event.workouts || []).flatMap<EventScheduleItem>(workout => {
        if (!workout.submissionClosesAt) return [];
        const closesAt = new Date(workout.submissionClosesAt);
        if (Number.isNaN(closesAt.getTime())) return [];
        return [{
          id: `workout-deadline-${workout.id}`,
          kind: 'deadline' as const,
          mode: 'online' as const,
          date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza' }).format(closesAt),
          time: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', hour12: false }).format(closesAt),
          title: `Encerramento: ${workout.code} · ${workout.name}`,
          description: 'Prazo final para envio do score e vídeo de comprovação (horário de Fortaleza).'
        }];
      })
      : [];

    const currentWorkoutIds = new Set((event?.workouts || []).map(workout => workout.id));

    return [...(event?.scheduleItems || []), ...qualifierDeadlines]
      .filter(item => event?.eventType !== 'functional_fitness_qualifier' || item.kind !== 'heat')
      .filter(item => item.kind !== 'heat' || item.isPublished)
      .filter(item => {
        // Baterias orfas: apontam para um workoutId que nao existe mais na prova atual
        // do evento (a prova foi excluida/recriada e o cronograma nao foi limpo). Sem
        // esse filtro elas continuam aparecendo como um grupo "fantasma" duplicado.
        if (item.kind !== 'heat' || !item.workoutId) return true;
        return currentWorkoutIds.has(item.workoutId);
      })
      .filter(item => {
        if (item.kind !== 'heat') return true;

        const athleteKey = [...(item.athleteIds || [])].sort().join(',');
        const heatKey = [
          item.date,
          item.time,
          item.warmupTime || '',
          item.checkinTime || '',
          item.endTime || '',
          item.heatNumber || '',
          item.title,
          athleteKey
        ].join('|');

        if (seenHeatKeys.has(heatKey)) return false;
        seenHeatKeys.add(heatKey);
        return true;
      })
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }, [event]);

  const eventDivisionIds = React.useMemo(
    () => new Set((event?.divisions || []).map(division => division.id)),
    [event?.divisions]
  );
  const hasPublicEventAthletes = React.useMemo(
    () => athletes.some(athlete => eventDivisionIds.has(athlete.divisionId)),
    [athletes, eventDivisionIds]
  );
  const scheduleHeatGroups = React.useMemo(
    () => buildScheduleHeatGroups(scheduleItems, event?.workouts || []),
    [scheduleItems, event?.workouts]
  );
  const scheduleBlocks = React.useMemo<ScheduleBlock[]>(() => {
    const groupsById = new Map(scheduleHeatGroups.map(group => [group.id, group]));
    const renderedGroupIds = new Set<string>();
    const blocks: ScheduleBlock[] = [];

    scheduleItems.forEach((item) => {
      if (item.kind !== 'heat') {
        blocks.push({ id: item.id, type: 'general', item });
        return;
      }

      const groupId = item.workoutId || getHeatGroupFallbackTitle(item);
      if (renderedGroupIds.has(groupId)) return;

      renderedGroupIds.add(groupId);
      const group = groupsById.get(groupId);
      if (group) {
        blocks.push({ id: group.id, type: 'heatGroup', group });
      }
    });

    return blocks;
  }, [scheduleHeatGroups, scheduleItems]);
  const scheduleSummary = React.useMemo(() => {
    const heatCount = scheduleHeatGroups.reduce((total, group) => total + group.heatCount, 0);
    const participantCount = scheduleHeatGroups.reduce((total, group) => total + group.participantCount, 0);
    const firstGroup = scheduleHeatGroups[0];
    const lastGroup = scheduleHeatGroups[scheduleHeatGroups.length - 1];

    return {
      heatCount,
      participantCount,
      groupCount: scheduleHeatGroups.length,
      dateLabel: firstGroup?.dateLabel || formatScheduleDate(scheduleItems[0]?.date),
      timeRange: firstGroup && lastGroup ? `${firstGroup.startTime} - ${lastGroup.endTime}` : 'A confirmar'
    };
  }, [scheduleHeatGroups, scheduleItems]);
  const heatStatusById = React.useMemo(() => {
    const statuses = new Map<string, HeatLiveStatus>();
    const FALLBACK_DURATION_MS = 15 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;

    const allHeats = scheduleHeatGroups.flatMap(group => group.items.map(item => ({ item, groupId: group.id })));

    // Baterias sem data/horário utilizável ficam de fora do cálculo de "ao vivo"/"próxima"
    // (tratadas como agendadas ao final) em vez de caírem erradamente em "encerrada".
    const scheduled = allHeats
      .map(({ item, groupId }) => ({ item, groupId, start: parseScheduleClock(item.date, item.time) }))
      .filter((entry): entry is { item: EventScheduleItem; groupId: string; start: number } => entry.start !== null)
      .sort((a, b) => a.start - b.start);

    scheduled.forEach(({ item, groupId, start }, index) => {
      const explicitEnd = item.endTime ? parseScheduleClock(item.date, item.endTime) : null;
      // Só conta como "Final" explícito se for diferente do "Início" — "08:00–08:00" é dado
      // incompleto, não uma bateria de 24h, então cai no mesmo fallback de quem não tem Final.
      let end: number | null = null;
      if (explicitEnd !== null && explicitEnd !== start) {
        // "Final" já passou da meia-noite em relação ao "Início" (ex.: 23:30 -> 00:15): soma um dia.
        end = explicitEnd > start ? explicitEnd : explicitEnd + DAY_MS;
      }
      if (end === null) {
        // Sem "Final" definido: a bateria termina quando a próxima **da mesma prova** começa
        // (baterias paralelas de outra prova, ou empatadas no mesmo horário, não contam) —
        // a última bateria da prova usa um teto padrão.
        const nextInGroup = scheduled.find((candidate, candidateIndex) => (
          candidateIndex > index && candidate.groupId === groupId && candidate.start > start
        ));
        end = nextInGroup ? nextInGroup.start : start + FALLBACK_DURATION_MS;
      }

      if (scheduleNowTs >= start && scheduleNowTs < end) {
        statuses.set(item.id, 'live');
      } else if (scheduleNowTs >= end) {
        statuses.set(item.id, 'done');
      }
    });

    // "Próxima" é o(s) horário(s) de início mais próximo(s) no futuro — todas as baterias
    // empatadas nesse horário (ex.: raias/lanes paralelas) recebem o mesmo destaque.
    const nextStart = scheduled.find(({ start }) => scheduleNowTs < start)?.start;
    scheduled.forEach(({ item, start }) => {
      if (statuses.has(item.id)) return;
      statuses.set(item.id, nextStart !== undefined && start === nextStart ? 'next' : 'upcoming');
    });

    allHeats.forEach(({ item }) => {
      if (!statuses.has(item.id)) statuses.set(item.id, 'upcoming');
    });

    return statuses;
  }, [scheduleHeatGroups, scheduleNowTs]);
  const isEventLoading = !isSessionHydrated
    || isLoading
    || (bootstrapStatus !== 'ready' && bootstrapStatus !== 'degraded')
    || publicEventDataStatus[eventId] === 'loading'
    || publicEventDataStatus[eventId] === undefined;

  if (!event) {
    if (isEventLoading) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
          <Trophy className="h-16 w-16 text-muted animate-pulse" />
          <h2 className="text-xl font-bold text-white uppercase tracking-wider">Carregando evento</h2>
          <p className="max-w-sm text-center text-xs font-semibold uppercase tracking-wider text-muted">
            Buscando cronograma, atletas e informações públicas.
          </p>
        </div>
      );
    }

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
        <Trophy className="h-16 w-16 text-muted" />
        <h2 className="text-xl font-bold text-white uppercase tracking-wider">Evento não encontrado</h2>
        <Link href="/" className="text-sm text-primary hover:underline uppercase font-extrabold tracking-widest">
          Voltar para Home
        </Link>
      </div>
    );
  }

  const lifecycle = getEventStatus(event);
  const registrationAvailability = getRegistrationAvailability(event);
  const registrationsAvailable = event.status === 'upcoming'
    && registrationAvailability.isAvailable;

  // Copiar link para compartilhar
  const handleShare = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setShareFeedback(true);
      setTimeout(() => setShareFeedback(false), 2000);
    }
  };

  const toggleHeatDetails = (heatId: string) => {
    setExpandedHeatIds(previous => {
      const next = new Set(previous);
      if (next.has(heatId)) {
        next.delete(heatId);
      } else {
        next.add(heatId);
      }
      return next;
    });
  };

  const getScheduleKindLabel = (kind: string) => {
    if (kind === 'briefing') return 'Briefing';
    if (kind === 'kit_delivery') return 'Entrega de kits';
    if (kind === 'deadline') return 'Prazo importante';
    return 'Cronograma do evento';
  };

  const getScheduleModeLabel = (mode?: string) => {
    if (mode === 'online') return 'Online';
    if (mode === 'presential') return 'Presencial';
    return 'Evento';
  };

  const getDivisionName = (divisionId?: string) => {
    if (!divisionId) return 'Categoria geral';
    return event.divisions?.find(division => division.id === divisionId)?.name || 'Categoria geral';
  };

  const handleTabChange = (tabId: typeof activeTab) => {
    setActiveTab(tabId);
    window.history.replaceState(null, '', `${window.location.pathname}?tab=${tabId}`);
  };

  const getStatusLabel = () => {
    if (registrationAvailability.reason === 'sales_closed') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-card-border bg-dark-gray/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted font-mono">
          <Lock className="h-3 w-3" />
          Vendas Encerradas
        </span>
      );
    }

    if (lifecycle === 'finished') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-card-border bg-dark-gray/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted font-mono">
          <Lock className="h-3 w-3" />
          Evento Encerrado
        </span>
      );
    }

    switch (event.status) {
      case 'live':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Ao Vivo
          </span>
        );
      case 'upcoming':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Inscrições Abertas
          </span>
        );
      case 'finished':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-card-border bg-dark-gray/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-muted/40" />
            Finalizado
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      
      {/* Hero Banner */}
      <section className="relative h-[390px] w-full overflow-hidden border-b border-card-border bg-dark-gray md:h-[470px]">
        {event.bannerUrl ? (
          <Image
            src={event.bannerUrl} 
            alt={`${event.name} banner`} 
            width="1600"
            height="640"
            unoptimized
            priority
            className="h-full w-full object-cover opacity-55"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-dark-gray to-background opacity-55" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/45 to-black/50"></div>
        
        {/* Informações Sobrepostas no Banner */}
        <div className="absolute bottom-0 left-0 right-0 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
            
            {/* Esquerda: Logo e Infos Básicas */}
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 text-center sm:text-left">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-card-border bg-background p-2 md:h-32 md:w-32">
                {event.logoUrl ? (
                  <Image
                    src={event.logoUrl} 
                    alt={`${event.name} logo`} 
                    width="128"
                    height="128"
                    unoptimized
                    className="h-full w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-lg bg-primary/10 text-2xl font-black uppercase text-primary">
                    {event.name.substring(0, 2)}
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  {getStatusLabel()}
                </div>
                <h1 className="text-balance text-3xl font-extrabold uppercase tracking-tight text-white sm:text-5xl">
                  {event.name}
                </h1>
                
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1.5 text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted shrink-0" />
                    <span className="font-semibold text-white">{event.date}</span>
                  </span>
                  <span className="text-card-border/60 hidden sm:inline">•</span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted shrink-0" />
                    <span className="font-semibold text-white">{event.location}</span>
                  </span>
                  <span className="text-card-border/60 hidden sm:inline">•</span>
                  <span className="flex items-center gap-1.5 capitalize">
                    <Dumbbell className="h-3.5 w-3.5 text-muted shrink-0" />
                    <span className="font-semibold text-white">Formato: {event.format || 'individual'}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Direita: Botões Rápidos */}
            <div className="flex flex-row justify-center md:justify-end gap-3 w-full md:w-auto">
              <button 
                onClick={handleShare}
                className="flex flex-1 sm:flex-initial min-h-11 items-center justify-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-5 py-3 text-xs font-bold text-white transition-colors hover:border-primary"
              >
                <Share2 className="h-4 w-4 text-white" />
                <span>{shareFeedback ? 'Copiado!' : 'Compartilhar'}</span>
              </button>

              {event.status === 'upcoming' && (
                <button 
                  disabled={!registrationsAvailable}
                  onClick={() => {
                    if (registrationsAvailable) setIsRegisterOpen(true);
                  }}
                  className={`flex flex-1 sm:flex-initial min-h-11 items-center justify-center gap-1.5 rounded-md px-6 py-3 text-xs font-bold uppercase transition-colors ${
                    registrationsAvailable
                      ? 'bg-primary text-ink hover:bg-primary-hover active:scale-95'
                      : 'bg-muted/10 text-muted border border-card-border cursor-not-allowed'
                  }`}
                >
                  <Ticket className="h-4 w-4" />
                  <span>{registrationsAvailable ? 'Comprar Ingresso' : registrationAvailability.reason === 'sales_closed' ? 'Vendas Encerradas' : 'Inscrições Encerradas'}</span>
                </button>
              )}
            </div>

            {registrationAvailability.reason === 'sales_closed' && event.status === 'upcoming' && (
              <p role="status" className="text-center text-xs font-semibold text-gray-300 md:text-right">
                As vendas online foram encerradas pelo organizador.
              </p>
            )}

          </div>
        </div>
      </section>

      {/* Navegação por Abas Rápidas */}
      <section className="sticky top-16 z-40 border-b border-card-border bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex overflow-x-auto gap-1.5 py-3 scrollbar-none sm:gap-2">
            {[
              { id: 'details', label: 'Detalhes', icon: AlignLeft, isLink: false },
              { id: 'divisions', label: 'Divisões', icon: Trophy, isLink: false },
              { id: 'schedule', label: 'Horário', icon: Clock, isLink: false },
              { id: 'workouts', label: 'Exercícios', icon: Dumbbell, isLink: false },
              { id: 'leaderboard', label: 'Leaderboard', icon: Medal, isLink: true }
            ].map((tab) => {
              const Icon = tab.icon;
              const classes = `flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-extrabold uppercase tracking-wider transition-colors sm:px-4 ${
                activeTab === tab.id
                  ? 'bg-primary/10 border-primary text-primary font-black'
                  : 'bg-transparent text-muted border-transparent hover:text-white hover:border-card-border'
              }`;

              if (tab.isLink) {
                return (
                  <a
                    key={tab.id}
                    href={`/event/${event.id}/leaderboard`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={classes}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tab.label}</span>
                  </a>
                );
              }

              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id as typeof activeTab)}
                  className={classes}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Seção das Abas */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {paymentNotice && (
          <div className={`mb-6 rounded-lg border p-4 text-xs font-bold uppercase tracking-wider ${
            paymentNotice.tone === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          }`}>
            <div className="flex justify-between items-center">
              <span>{paymentNotice.text}</span>
              <button onClick={() => setPaymentNotice(null)} className="ml-4 text-white hover:opacity-80 font-sans text-sm">✕</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Esquerda/Centro: Conteúdo Principal das Abas */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Aba 1: Detalhes */}
            {activeTab === 'details' && (
              <div className="space-y-4 rounded-xl border border-card-border bg-card p-6">
                <h3 className="text-lg font-black text-white uppercase tracking-wider border-b border-card-border pb-3">
                  Sobre o Evento
                </h3>
                <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap font-normal">
                  {event.description}
                </p>
                <div className="pt-4 border-t border-card-border/50 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Cronograma de Datas</h4>
                    <p className="text-sm text-white font-semibold mt-1">{event.date}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-primary uppercase tracking-wider">
                      {event.eventType === 'functional_fitness_qualifier' ? 'Modalidade' : 'Local das Baterias'}
                    </h4>
                    <p className="text-sm text-white font-semibold mt-1">
                      {event.eventType === 'functional_fitness_qualifier' ? 'Qualifier online' : event.location}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Aba 2: Divisões */}
            {activeTab === 'divisions' && (
              <div className="space-y-4">
                <h3 className="text-lg font-black text-white uppercase tracking-wider border-b border-card-border pb-3 mb-2">
                  Categorias e Divisões
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {event.divisions.map((div) => (
                    <div key={div.id} className="flex flex-col justify-between rounded-xl border border-card-border bg-card p-5 transition-colors hover:border-primary/60">
                      <div className="space-y-2">
                        <span className="px-2.5 py-0.5 bg-dark-gray border border-card-border text-[9px] font-black uppercase tracking-widest text-primary rounded-full">
                          {div.category === 'male' ? 'Masculino' : div.category === 'female' ? 'Feminino' : 'Equipes'}
                        </span>
                        <h4 className="text-lg font-black text-white uppercase">{div.name}</h4>
                        <p className="text-xs text-muted font-normal leading-relaxed">
                          Ideal para atletas que buscam competir dentro das cargas oficiais e movimentos propostos na categoria {div.name}.
                        </p>
                      </div>
                      {registrationsAvailable && (
                        <button
                          onClick={() => setIsRegisterOpen(true)}
                          className="mt-4 flex items-center justify-between text-xs font-extrabold uppercase text-primary hover:text-white transition-colors"
                        >
                          <span>Inscrever-se na categoria</span>
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Aba 3: Horários / Cronograma */}
            {activeTab === 'schedule' && (
              <div className="min-w-0 space-y-6 overflow-hidden rounded-xl border border-card-border bg-card p-4 sm:p-6">
                <div className="flex flex-col gap-2 border-b border-card-border pb-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-primary">Cronograma agrupado por prova</p>
                    <h3 className="mt-1 text-lg font-black uppercase tracking-wider text-white">
                      Cronograma Oficial
                    </h3>
                  </div>
                  {scheduleItems.length > 0 && (
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                      {scheduleSummary.dateLabel} · {scheduleSummary.timeRange}
                    </p>
                  )}
                </div>

                {scheduleItems.length > 0 ? (
                  <div className="space-y-5">
                    {scheduleHeatGroups.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-card-border/60 bg-dark-gray/30 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                        <span><strong className="font-number text-white">{scheduleSummary.groupCount}</strong> provas</span>
                        <span className="h-1 w-1 shrink-0 rounded-full bg-muted-soft" aria-hidden="true" />
                        <span><strong className="font-number text-white">{scheduleSummary.heatCount}</strong> baterias</span>
                        <span className="h-1 w-1 shrink-0 rounded-full bg-muted-soft" aria-hidden="true" />
                        <span><strong className="font-number text-white">{scheduleSummary.participantCount}</strong> atletas</span>
                        <span className="h-1 w-1 shrink-0 rounded-full bg-muted-soft" aria-hidden="true" />
                        <span className="text-primary">Janela <strong className="font-number">{scheduleSummary.timeRange}</strong></span>
                      </div>
                    )}

                    {scheduleBlocks.map((block) => {
                      if (block.type === 'general') {
                        const item = block.item;
                        return (
                          <article key={block.id} className="rounded-lg border border-card-border/70 bg-dark-gray/20 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">
                                {getScheduleKindLabel(item.kind)}
                              </span>
                              <span className="rounded border border-card-border bg-dark-gray px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-muted">
                                {getScheduleModeLabel(item.mode)}
                              </span>
                              <span className="text-[10px] font-black uppercase tracking-wider text-white">
                                {formatScheduleDate(item.date)} às {item.time}
                              </span>
                            </div>
                            <h4 className="mt-2 text-sm font-extrabold text-white">{item.title}</h4>
                            <p className="mt-1 text-xs leading-relaxed text-muted">{item.description}</p>
                            {item.location && (
                              <p className="mt-1 text-xs text-muted">Local/link: {item.location}</p>
                            )}
                          </article>
                        );
                      }

                      const group = block.group;
                      const groupIndex = scheduleHeatGroups.findIndex(candidate => candidate.id === group.id);
                      // group.items já vem ordenado cronologicamente por buildScheduleHeatGroups.
                      const groupItemsByTime = group.items;
                      const groupFirstDateLabel = formatScheduleDate(groupItemsByTime[0]?.date);
                      const groupLastDateLabel = formatScheduleDate(groupItemsByTime[groupItemsByTime.length - 1]?.date);
                      // Prova que atravessa a virada do dia: o cabeçalho declara as duas datas em vez de
                      // afirmar (incorretamente) que tudo acontece na data da primeira bateria cadastrada.
                      const groupDateHeading = groupFirstDateLabel !== groupLastDateLabel
                        ? `${groupFirstDateLabel} ${group.startTime} – ${groupLastDateLabel} ${group.endTime}`
                        : `${group.dateLabel} · ${group.startTime}–${group.endTime}`;

                      return (
                        <section key={block.id} className="min-w-0 overflow-hidden rounded-lg border border-card-border/70">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-card-border/70 bg-dark-gray/40 px-4 py-2.5">
                            <div className="flex min-w-0 items-baseline gap-2">
                              <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-primary">
                                Prova {groupIndex + 1}
                              </span>
                              <h4 className="truncate text-xs font-bold uppercase tracking-wider text-white">
                                {group.title}
                              </h4>
                            </div>
                            <span className="shrink-0 font-number text-[10px] font-bold text-muted">
                              {groupDateHeading}
                            </span>
                          </div>

                          <div className="divide-y divide-card-border/50" role="list">
                            {group.items.map((item) => {
                              const heatParticipants = resolveHeatParticipantSlots(item.athleteIds, athletes);
                              const heatSlotLabel = getHeatSlotLabel(event.eventType);
                              const isPublicEventLoading = publicEventDataStatus[eventId] === 'loading'
                                || (publicEventDataStatus[eventId] === undefined && !hasPublicEventAthletes);
                              const isExpanded = expandedHeatIds.has(item.id);
                              const panelId = `heat-participants-${item.id}`;
                              const status = heatStatusById.get(item.id) ?? 'upcoming';
                              const statusMeta = HEAT_STATUS_META[status];
                              const itemDateLabel = formatScheduleDate(item.date);
                              const showItemDate = itemDateLabel !== groupFirstDateLabel;

                              return (
                                <div key={item.id} role="listitem">
                                  <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    aria-controls={panelId}
                                    onClick={() => toggleHeatDetails(item.id)}
                                    className="flex w-full min-w-0 flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-primary/5 sm:flex-row sm:items-center sm:gap-3"
                                  >
                                    <span className="flex min-w-0 items-center gap-2 sm:w-[38%] sm:shrink-0">
                                      <span className={`h-2 w-2 shrink-0 rounded-full ${statusMeta.dotClass}`} aria-hidden="true" />
                                      <span className="sr-only">{statusMeta.label}. </span>
                                      {statusMeta.badge && (
                                        <span className={`shrink-0 text-[10px] font-black uppercase tracking-wider ${status === 'live' ? 'text-trading-up' : status === 'done' ? 'text-muted' : 'text-primary'}`} aria-hidden="true">
                                          {statusMeta.badge}
                                        </span>
                                      )}
                                      <span title={item.title} className="truncate text-xs font-extrabold uppercase text-white">{item.title}</span>
                                      {showItemDate && (
                                        <span className="shrink-0 text-[9px] font-bold uppercase text-muted">{itemDateLabel}</span>
                                      )}
                                    </span>

                                    <span className="flex flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 font-number text-[11px] font-medium text-muted">
                                      <span className="whitespace-nowrap">Aquec. <b className="font-semibold text-white">{item.warmupTime || '-'}</b></span>
                                      <span className="whitespace-nowrap">Fila <b className="font-semibold text-white">{item.checkinTime || '-'}</b></span>
                                      <span className="whitespace-nowrap text-[12px] text-primary/80">Início <b className="text-base font-extrabold text-primary">{item.time || '-'}</b></span>
                                      <span className="whitespace-nowrap">Final <b className="font-semibold text-white">{item.endTime || '-'}</b></span>
                                    </span>

                                    <span className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                                      <span className="rounded border border-card-border bg-dark-gray px-2 py-1 font-number text-[10px] font-bold text-muted">
                                        {heatParticipants.totalCount > 0
                                          ? `${heatParticipants.resolvedCount}/${heatParticipants.totalCount}`
                                          : '0'} atletas
                                      </span>
                                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-soft transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                                    </span>
                                  </button>

                                  <div id={panelId} hidden={!isExpanded} className="space-y-2 bg-black/20 px-4 pb-4 pt-1 sm:pl-9">
                                    {heatParticipants.resolvedParticipants.length > 0 ? (
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {heatParticipants.resolvedParticipants.map(({ athlete, athleteId, displayIndex }) => {
                                          const safeBox = athlete.box && athlete.box !== 'undefined' ? athlete.box : '';
                                          return (
                                            <div
                                              key={`${item.id}-${athleteId}-${displayIndex}`}
                                              className="flex min-w-0 items-center gap-2 rounded border border-card-border/60 bg-black/40 px-2.5 py-2 text-[10px] text-white transition-colors hover:border-primary/30"
                                            >
                                              <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-primary">
                                                {heatSlotLabel} {displayIndex}
                                              </span>
                                              {athlete.isTeam && (
                                                <span className="shrink-0 rounded bg-primary/20 px-1 text-[8px] font-black text-primary">EQ</span>
                                              )}
                                              <div className="min-w-0 flex-1">
                                                <p className="truncate font-bold uppercase tracking-wider">{athlete.name}</p>
                                                <p className="truncate text-[9px] font-medium text-muted-soft">
                                                  {getDivisionName(athlete.divisionId)}{safeBox ? ` - ${safeBox}` : ''}
                                                </p>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : heatParticipants.totalCount > 0 ? (
                                      <p className="rounded border border-card-border/50 bg-black/20 px-3 py-2 text-[10px] font-semibold text-muted-soft">
                                        {isPublicEventLoading
                                          ? 'Participantes em carregamento...'
                                          : 'Participantes vinculados, mas os perfis públicos ainda não foram encontrados.'}
                                      </p>
                                    ) : (
                                      <p className="rounded border border-card-border/50 bg-black/20 px-3 py-2 text-[10px] font-semibold text-muted-soft">
                                        Nenhum participante publicado nesta bateria.
                                      </p>
                                    )}

                                    {heatParticipants.unresolvedCount > 0 && heatParticipants.resolvedCount > 0 && (
                                      <p className="text-[9px] font-semibold text-muted-soft">
                                        {heatParticipants.unresolvedCount} participante(s) ainda sem dados públicos carregados.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                ) : (
                    <>
                      <div className="flex gap-4 relative">
                        <div className="w-7 h-7 rounded-full bg-dark-gray border border-primary flex items-center justify-center shrink-0 z-10">
                          <span className="w-2.5 h-2.5 rounded-full bg-primary"></span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-primary uppercase tracking-wider bg-primary/10 px-2 py-0.5 rounded border border-primary/20">Dia 1 - Abertura</span>
                          <h4 className="text-sm font-extrabold text-white">Credenciamento & Briefing Geral</h4>
                          <p className="text-xs text-muted">14:00 - Retirada de kits de atletas e checagem de documentos.</p>
                          <p className="text-xs text-muted">17:00 - Briefing obrigatório explicando todas as provas (WODs).</p>
                        </div>
                      </div>

                      <div className="flex gap-4 relative">
                        <div className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary bg-dark-gray">
                          <span className="h-2.5 w-2.5 rounded-full bg-primary"></span>
                        </div>
                        <div className="space-y-1">
                          <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">Dia 2 - Baterias</span>
                          <h4 className="text-sm font-extrabold text-white">WOD 1 e WOD 2 (Todas as divisões)</h4>
                          <p className="text-xs text-muted">08:00 - Início das baterias da categoria Scale (WOD 1).</p>
                          <p className="text-xs text-muted">11:00 - Início das baterias da categoria RX (WOD 1).</p>
                          <p className="text-xs text-muted">14:00 - WOD 2 (DT Speed & Heavy Grace combinados).</p>
                        </div>
                      </div>

                      <div className="flex gap-4 relative">
                        <div className="w-7 h-7 rounded-full bg-dark-gray border border-card-border flex items-center justify-center shrink-0 z-10">
                          <span className="w-2.5 h-2.5 rounded-full bg-muted"></span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-muted uppercase tracking-wider bg-dark-gray px-2 py-0.5 rounded border border-card-border">Dia 3 - Decisão</span>
                          <h4 className="text-sm font-extrabold text-white">WOD 3, Finais & Premiação</h4>
                          <p className="text-xs text-muted">08:30 - WOD 3 (Gymnastic Burner).</p>
                          <p className="text-xs text-muted">12:30 - Baterias Finais (Top 5 de cada divisão).</p>
                          <p className="text-xs text-muted">15:30 - Cerimônia de Premiação e Encerramento.</p>
                        </div>
                      </div>
                    </>
                )}
              </div>
            )}

            {/* Aba 4: Exercícios / Provas */}
            {activeTab === 'workouts' && (
              <div className="space-y-4">
                <h3 className="text-lg font-black text-white uppercase tracking-wider border-b border-card-border pb-3 mb-2">
                  {event.eventType === 'fitness_racing' ? 'Percurso Oficial' : event.eventType === 'functional_fitness_qualifier' ? 'Provas e prazos de envio' : 'Provas Anunciadas'}
                </h3>
                
                {event.eventType === 'fitness_racing' ? (
                  (() => {
                    const publishedDivs = event.divisions.filter(d => d.isCoursePublished);
                    
                    if (publishedDivs.length === 0) {
                      return (
                        <div className="text-center py-16 space-y-4 rounded-xl border border-dashed border-card-border bg-card">
                          <Trophy className="h-12 w-12 text-muted mx-auto animate-pulse" />
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-white uppercase tracking-wider">Percurso em Preparação</p>
                            <p className="text-xs text-muted max-w-md mx-auto leading-relaxed">
                              O organizador está definindo os detalhes oficiais das etapas e estações deste percurso. Fique atento, as informações serão publicadas em breve!
                            </p>
                          </div>
                        </div>
                      );
                    }

                    const activeDivId = selectedDivisionForCourseId || publishedDivs[0].id;
                    const activeDiv = publishedDivs.find(d => d.id === activeDivId) || publishedDivs[0];
                    const layout = activeDiv?.courseLayout || [];

                    return (
                      <div className="space-y-6">
                        {/* Seletor de Categoria/Divisão */}
                        <div className="flex flex-col space-y-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted">
                            Selecione a Categoria para ver o Percurso:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {publishedDivs.map((div) => (
                              <button
                                key={div.id}
                                onClick={() => setSelectedDivisionForCourseId(div.id)}
                                className={`flex min-h-10 items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase transition-colors ${
                                  activeDiv.id === div.id
                                    ? 'bg-primary/15 border-primary text-primary font-black scale-105'
                                    : 'bg-card border-card-border text-muted hover:text-white hover:border-muted'
                                }`}
                              >
                                <Trophy className="h-3.5 w-3.5" />
                                <span>{div.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Informações da Prova Virtual */}
                        {(() => {
                          const totalWorkout = event.workouts.find(w => w.divisionId === activeDiv.id && w.code === 'TOTAL');
                          if (!totalWorkout) return null;
                          return (
                            <div className="rounded-xl border border-card-border bg-card p-5 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border/50 pb-2">
                                <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                                  <Sparkles className="h-4 w-4 text-primary" />
                                  {totalWorkout.name}
                                </h4>
                                <span className="rounded-md border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
                                  Formato: {activeDiv.type === 'duo' ? 'Duplas' : activeDiv.type === 'trio' ? 'Trios' : (activeDiv.type === 'team' || activeDiv.type === 'team4' || activeDiv.type === 'team6') ? 'Equipes' : 'Individual'}
                                </span>
                              </div>
                              <p className="text-xs text-muted leading-relaxed whitespace-pre-line font-medium">
                                {totalWorkout.description}
                              </p>
                            </div>
                          );
                        })()}

                        {/* Linha do Tempo do Percurso */}
                        {layout.length === 0 ? (
                          <div className="text-center py-12 rounded-xl border border-dashed border-card-border bg-card">
                            <p className="text-xs text-muted">Nenhuma etapa configurada para esta categoria.</p>
                          </div>
                        ) : (
                          <div className="relative space-y-4 pl-4 pr-1 bg-card border border-card-border rounded-xl p-6">
                            <div className="border-b border-card-border pb-3 mb-4">
                              <h4 className="text-sm font-black text-white uppercase tracking-wider">Estações & Corridas</h4>
                              <p className="text-xs text-muted font-medium">Confira abaixo a ordem oficial de execução de cada etapa do percurso.</p>
                            </div>

                            {/* Linha Vertical Conectora */}
                            <div className="absolute left-[39px] top-20 bottom-10 w-[2px] bg-primary/20" aria-hidden="true" />

                            <div className="space-y-3 relative">
                              {layout
                                .slice()
                                .sort((a, b) => a.orderIndex - b.orderIndex)
                                .map((stg, index) => {
                                  const isRun = stg.type === 'run';
                                  return (
                                    <div
                                      key={stg.id}
                                      className="relative grid grid-cols-[36px_1fr] gap-3 items-center rounded-lg border border-card-border bg-dark-gray/30 p-3 hover:border-primary/40 transition-colors duration-200"
                                    >
                                      {/* Círculo do Número */}
                                      <div className="flex items-center justify-center relative z-10">
                                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-black font-mono ${
                                          isRun
                                            ? 'border-emerald-500 bg-background text-emerald-400'
                                            : 'border-primary bg-background text-primary'
                                        }`}>
                                          {index + 1}
                                        </div>
                                      </div>

                                      {/* Informações da Etapa */}
                                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 min-w-0">
                                        <div className="space-y-1 min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <h5 className="text-xs font-black text-white uppercase tracking-wider truncate">{stg.name}</h5>
                                            <span className={`inline-flex rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest border ${
                                              isRun
                                                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                                                : 'bg-primary/10 border-primary/25 text-primary'
                                            }`}>
                                              {isRun ? 'Corrida' : 'Estação'}
                                            </span>
                                          </div>
                                          
                                          {/* Especificações da Estação */}
                                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-soft font-medium">
                                            {stg.distance && (
                                              <span className="flex items-center gap-1">
                                                <Footprints className="h-3 w-3 text-muted shrink-0" />
                                                <span className="font-bold uppercase tracking-wider text-[9px]">Distância:</span>
                                                <span className="font-semibold text-white font-mono">{stg.distance}</span>
                                              </span>
                                            )}
                                            {stg.reps && (
                                              <span className="flex items-center gap-1">
                                                <span className="font-bold uppercase tracking-wider text-[9px]">Repetições:</span>
                                                <span className="font-semibold text-white font-mono">{stg.reps}</span>
                                              </span>
                                            )}
                                            {!isRun && (stg.maleWeight || stg.femaleWeight) && (
                                              <span className="flex items-center gap-1.5">
                                                <span className="font-bold uppercase tracking-wider text-[9px]">Pesos (M/F):</span>
                                                <span className="rounded bg-dark-gray border border-card-border/60 px-1 py-0.5 text-[9px] font-bold text-white font-mono">{stg.maleWeight || '-'}</span>
                                                <span className="text-muted-soft">/</span>
                                                <span className="rounded bg-dark-gray border border-card-border/60 px-1 py-0.5 text-[9px] font-bold text-white font-mono">{stg.femaleWeight || '-'}</span>
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="space-y-4">
                    {event.workouts.map((wod) => (
                      <div key={wod.id} className="space-y-3 rounded-xl border border-card-border bg-card p-6 transition-colors hover:border-primary/60">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-card-border/50 pb-2">
                          <h4 className="text-base font-extrabold text-white uppercase">{wod.name}</h4>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 bg-dark-gray border border-card-border text-[9px] font-black uppercase text-primary tracking-widest rounded-md">
                              Tipo: {wod.type === 'fortime' ? 'For Time' : wod.type === 'amrap' ? 'AMRAP' : wod.type === 'maxweight' ? 'Carga Máxima' : 'Reps'}
                            </span>
                            {wod.timeCap && (
                              <span className="rounded-md border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
                                Cap: {wod.timeCap}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted leading-relaxed whitespace-pre-line font-medium">
                          {wod.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Direita: Sidebar Lateral de Detalhes Rápidos */}
          <div className="space-y-6">
            
            {/* Card de Inscrição na Lateral */}
            {registrationsAvailable && (
              <div className="space-y-4 rounded-xl border border-card-border bg-card p-6 transition-colors hover:border-primary">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Inscrições Disponíveis</h4>
                <p className="text-xs text-muted font-normal leading-relaxed">
                  Garanta sua vaga na arena. Selecione sua categoria, preencha seus dados de participante e sincronize instantaneamente com a plataforma.
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs text-muted">
                    <span>Valores a partir de</span>
                    <span className="text-white font-bold text-sm font-mono">{formattedMinPrice}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-muted">
                    <span>Gateway seguro</span>
                    <span className="text-white font-semibold flex items-center gap-1">
                      <ShieldCheck className="h-4 w-4 text-muted" /> Sandbox
                    </span>
                  </div>
                </div>
                <button 
                  onClick={() => setIsRegisterOpen(true)}
                  className="min-h-11 w-full rounded-md bg-primary py-3 font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover"
                >
                  Inscrever-se Agora
                </button>
              </div>
            )}

            {/* Área de Patrocinadores do Evento */}
            {event.sponsors && event.sponsors.length > 0 && (
              <div className="space-y-4 rounded-xl border border-card-border bg-card p-6">
                <h4 className="text-xs font-bold text-white uppercase tracking-widest text-center border-b border-card-border pb-3">
                  Patrocinadores do Evento
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  {event.sponsors.map((sponsor, i) => {
                    const isLastOdd = event.sponsors.length % 2 !== 0 && i === event.sponsors.length - 1;
                    return (
                      <div 
                        key={i} 
                        className={`group flex h-14 items-center justify-center rounded-lg border border-card-border bg-dark-gray p-3 text-center transition-colors hover:border-primary/60 ${
                          isLastOdd ? 'col-span-2' : ''
                        }`}
                      >
                        <span className="text-xs font-bold text-muted group-hover:text-white transition-colors uppercase tracking-wider italic">
                          {sponsor}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Suporte Técnico / Dúvidas */}
            <div className="space-y-2 rounded-xl border border-card-border bg-card p-5 text-center">
              <UserCheck className="h-5 w-5 text-muted mx-auto" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Dúvidas sobre o Evento?</h4>
              <p className="text-[10px] text-muted leading-relaxed">
                Entre em contato com o comitê organizador oficial para esclarecimentos.
              </p>
              {(event.instagram || event.website) && (
                <div className="pt-2 flex flex-col gap-1.5 items-center">
                  {event.instagram && (
                    <a
                      href={`https://instagram.com/${event.instagram.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-primary hover:underline uppercase tracking-wider"
                    >
                      Instagram Oficial
                    </a>
                  )}
                  {event.website && (
                    <a
                      href={event.website.startsWith('http') ? event.website : `https://${event.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-primary hover:underline uppercase tracking-wider"
                    >
                      Visitar Website
                    </a>
                  )}
                </div>
              )}
            </div>

          </div>

        </div>
      </section>

      <RegisterModal 
        event={event} 
        isOpen={isRegisterOpen} 
        onClose={() => setIsRegisterOpen(false)} 
        onSuccess={(registration, athlete, cpf) => {
          setConfirmedVoucher({ registration, athlete, cpf });
        }}
      />

      {confirmedVoucher && (
        <RegistrationVoucher
          registration={confirmedVoucher.registration}
          athlete={confirmedVoucher.athlete}
          event={event}
          cpf={confirmedVoucher.cpf}
          onClose={() => setConfirmedVoucher(null)}
        />
      )}

    </div>
  );
}
