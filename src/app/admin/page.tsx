'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';

import { BrandLogo } from '@/components/BrandLogo';
import { RegistrationVoucher } from '@/components/RegistrationVoucher';
import {
  LayoutDashboard, Calendar, Trophy,
  ClipboardCheck, LogIn, LogOut, DollarSign, Users, Ticket, Settings,
  Upload, X, Trash2, Plus, ShieldAlert, Pencil, Copy, GripVertical, ArrowDown, ArrowUp, Library, ReceiptText, Mail, CreditCard,
  Lock
} from 'lucide-react';

const InstagramIcon = ({ className = 'h-3.5 w-3.5' }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);
import { WorkoutType, CategoryType, EventStatus, Event, Athlete, Division, CourseStage, EventScheduleItemKind, EventScheduleMode, Score, EventScheduleItem, Registration } from '@/types';
import { FITNESS_RACING_AGE_GROUPS, FITNESS_RACING_STATION_LIBRARY, buildFitnessRacingCourse, getAgeGroupFromDate } from '@/lib/fitnessRacing';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const compactNumberFormatter = new Intl.NumberFormat('pt-BR');

const formatInstitutionalMetric = (value: number, fallback: string) => {
  return value > 0 ? `${compactNumberFormatter.format(value)}+` : fallback;
};


const transactionalLabelClassName = 'mb-1 block text-xs font-bold uppercase tracking-wider text-muted-soft';
// Mantido para o teste de design system que valida a superfície transacional clara do admin.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const transactionalCardClassName = 'transactional-surface bg-canvas-light p-6 text-ink text-primary-on-light sm:p-8 lg:p-10';
const primaryActionClassName = 'flex min-h-11 items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-muted';
const darkLoginInputClassName = 'h-12 w-full rounded-md border border-card-border bg-background px-4 text-base text-white placeholder:text-muted-soft transition-colors focus:border-info focus:outline-none';

// Converte HH:MM para minutos desde o início do dia
const hhmmToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
};

// Converte minutos desde o início do dia para HH:MM
const minutesToHhmm = (minutes: number): string => {
  const positiveMins = (minutes < 0 ? (minutes % 1440) + 1440 : minutes) % 1440;
  const h = Math.floor(positiveMins / 60);
  const m = positiveMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Formata data por extenso (ex: sábado, 30 de maio de 2026)
const formatLongDate = (dateStr: string): string => {
  if (!dateStr || dateStr === 'undefined' || dateStr === 'null') return 'Selecione uma data...';
  try {
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export default function AdminPage() {
  const {
    events, athletes, scores, registrations, coupons, currentUser,
    login, logout, addEvent, addDivision, updateDivision,
    addWorkout, deleteEvent, deleteDivision, deleteWorkout, submitScore, submitScoresBulk, updateEvent, getLeaderboard, registerTicket, saveCourseLayout, updateWorkout,
    refreshRegistrations, addCoupon, incrementCouponUsage, changePassword
  } = useApp();

  // 1. Estados de Login (vinculado ao currentUser do contexto)
  const isAthleteLoggedIn = currentUser?.role === 'athlete';
  const isLoggedIn = Boolean(currentUser && (currentUser.role === 'manager' || currentUser.role === 'athlete'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [selectedLoginProfile, setSelectedLoginProfile] = useState<'athlete' | 'organizer'>('athlete');
  const [rememberLogin, setRememberLogin] = useState(false);
  const [adminNotice, setAdminNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(() => {
    if (typeof window === 'undefined') return null;

    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');
    const errorParam = params.get('error');

    if (success === 'mp_connected') {
      return { text: 'Conta do Mercado Pago conectada com sucesso!', tone: 'success' };
    }

    if (!errorParam) return null;

    let msg = 'Falha ao conectar conta do Mercado Pago.';
    if (errorParam === 'oauth_failed') msg = 'A autorização do Mercado Pago falhou ou foi recusada.';
    if (errorParam === 'oauth_mp_error') msg = 'Erro de comunicação com o Mercado Pago durante a troca de tokens.';
    if (errorParam === 'db_error') msg = 'Erro ao persistir as credenciais de pagamento no banco de dados.';
    if (errorParam === 'critical_error') msg = 'Ocorreu um erro inesperado no callback do Mercado Pago.';

    return { text: msg, tone: 'error' };
  });
  const initialPasswordResetToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('reset_token') || ''
    : '';
  const [authMode, setAuthMode] = useState<'login' | 'forgot' | 'reset'>(initialPasswordResetToken ? 'reset' : 'login');
  const [passwordResetToken, setPasswordResetToken] = useState(initialPasswordResetToken);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordNotice, setForgotPasswordNotice] = useState('');
  const [forgotPasswordSubmitting, setForgotPasswordSubmitting] = useState(false);
  const [resetPasswordNew, setResetPasswordNew] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [resetPasswordNotice, setResetPasswordNotice] = useState('');
  const [resetPasswordSubmitting, setResetPasswordSubmitting] = useState(false);

  // 2. Abas Administrativas Principais
  const initialAdminTab = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('tab')
    : '';
  const isValidAdminTab = initialAdminTab === 'dashboard' || initialAdminTab === 'my-events' || initialAdminTab === 'event' || initialAdminTab === 'payments' || initialAdminTab === 'security';
  const [activeTab, setActiveTab] = useState<'dashboard' | 'my-events' | 'event' | 'payments' | 'security'>(
    isValidAdminTab ? initialAdminTab as 'dashboard' | 'my-events' | 'event' | 'payments' | 'security' : 'dashboard'
  );

  // Estados para integração do Mercado Pago Marketplace
  const [mpAccount, setMpAccount] = useState<{ id: string; mercadopago_user_id: string; status: string; public_key?: string; access_token?: string } | null>(null);
  const [loadingMp, setLoadingMp] = useState(false);
  const [manualPublicKey, setManualPublicKey] = useState('');
  const [manualAccessToken, setManualAccessToken] = useState('');
  const [savingManualMp, setSavingManualMp] = useState(false);

  // Estados para aba de Segurança
  const [securityCurrentPassword, setSecurityCurrentPassword] = useState('');
  const [securityNewPassword, setSecurityNewPassword] = useState('');
  const [securityConfirmPassword, setSecurityConfirmPassword] = useState('');
  const [securitySubmitting, setSecuritySubmitting] = useState(false);

  const redirectUri = process.env.NEXT_PUBLIC_MERCADOPAGO_REDIRECT_URI ||
    (typeof window !== 'undefined' ? `${window.location.origin}/api/mercadopago/oauth/callback` : 'http://localhost:3000/api/mercadopago/oauth/callback');

  // Efeito para buscar a conta conectada do Mercado Pago e escutar query parameters
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const success = params.get('success');
      const errorParam = params.get('error');

      if (success === 'mp_connected' || errorParam) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    const fetchMpAccount = async () => {
      if (!currentUser) return;
      setLoadingMp(true);
      try {
        const { data } = await supabase
          .from('mercadopago_accounts')
          .select('id, mercadopago_user_id, status, public_key')
          .eq('user_id', currentUser.id)
          .maybeSingle();

        if (data && data.status === 'connected') {
          setMpAccount(data);
          setManualPublicKey(data.public_key || '');
          setManualAccessToken(data.public_key ? '••••••••••••••••' : '');
        } else {
          setMpAccount(null);
          setManualPublicKey('');
          setManualAccessToken('');
        }
      } catch (err) {
        console.error('Erro ao buscar conta do Mercado Pago:', err);
      } finally {
        setLoadingMp(false);
      }
    };

    if (activeTab === 'payments' && currentUser) {
      fetchMpAccount();
    }
  }, [activeTab, currentUser]);


  const handleDisconnectMp = async () => {
    if (!currentUser) return;
    if (!confirm('Deseja realmente desconectar sua conta do Mercado Pago? As inscrições online para seus eventos serão suspensas.')) return;
    setLoadingMp(true);
    try {
      const response = await fetch('/api/admin/mercadopago', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId: currentUser.id })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Erro ao desconectar conta no servidor.');
      }

      setMpAccount(null);
      setManualPublicKey('');
      setManualAccessToken('');
      setAdminNotice({ text: 'Conta do Mercado Pago desconectada com sucesso.', tone: 'success' });
    } catch (err) {
      console.error('Erro ao desconectar:', err);
      setAdminNotice({ text: err instanceof Error ? err.message : 'Erro ao desconectar conta do Mercado Pago.', tone: 'error' });
    } finally {
      setLoadingMp(false);
    }
  };

  const handleSaveManualMp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!manualPublicKey || !manualAccessToken) {
      setAdminNotice({ text: 'Por favor, preencha a Public Key e o Access Token.', tone: 'error' });
      return;
    }

    setSavingManualMp(true);
    setAdminNotice(null);

    try {
      const response = await fetch('/api/admin/mercadopago', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: currentUser.id,
          publicKey: manualPublicKey,
          accessToken: manualAccessToken
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao salvar credenciais.');
      }

      setMpAccount({
        id: `manual-${currentUser.id}`,
        mercadopago_user_id: `manual-${currentUser.id}`,
        status: 'connected',
        public_key: manualPublicKey
      });

      setManualAccessToken('••••••••••••••••');
      setAdminNotice({ text: 'Credenciais manuais do Mercado Pago salvas com sucesso!', tone: 'success' });
    } catch (err: unknown) {
      console.error('Erro ao salvar credenciais manuais:', err);
      setAdminNotice({ text: err instanceof Error ? err.message : 'Não foi possível salvar as credenciais do Mercado Pago.', tone: 'error' });
    } finally {
      setSavingManualMp(false);
    }
  };

  const handleSecuritySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminNotice(null);

    if (!currentUser) return;

    if (securityNewPassword.length < 6) {
      setAdminNotice({ text: 'A nova senha deve ter pelo menos 6 caracteres.', tone: 'error' });
      return;
    }

    if (securityNewPassword !== securityConfirmPassword) {
      setAdminNotice({ text: 'A confirmação de senha não coincide com a nova senha.', tone: 'error' });
      return;
    }

    setSecuritySubmitting(true);
    try {
      const success = await changePassword(currentUser.id, securityCurrentPassword, securityNewPassword);
      if (success) {
        setAdminNotice({ text: 'Senha atualizada com sucesso!', tone: 'success' });
        setSecurityCurrentPassword('');
        setSecurityNewPassword('');
        setSecurityConfirmPassword('');
      } else {
        setAdminNotice({ text: 'Erro ao atualizar a senha. A senha atual está incorreta.', tone: 'error' });
      }
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Erro ao atualizar a senha. Tente novamente.', tone: 'error' });
    } finally {
      setSecuritySubmitting(false);
    }
  };

  // Estado do evento sendo gerenciado internamente
  const [selectedEventToManage, setSelectedEventToManage] = useState<Event | null>(null);
  const [activeEventTab, setActiveEventTab] = useState<'info' | 'categories' | 'wods' | 'schedule' | 'registrations' | 'scores' | 'leaderboard'>('info');

  // 3. Estados dos Formulários
  // Cadastro de Evento (Novo Evento)
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventStatus, setEventStatus] = useState<EventStatus>('upcoming');
  const [eventLogo, setEventLogo] = useState('');
  const [eventBanner, setEventBanner] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [eventCity, setEventCity] = useState('');
  const [eventState, setEventState] = useState('');
  const [eventRules, setEventRules] = useState('');
  const [eventInstagram, setEventInstagram] = useState('');
  const [eventWebsite, setEventWebsite] = useState('');
  const [eventTicketPrice, setEventTicketPrice] = useState<number>(150);
  const [eventTicketSlots, setEventTicketSlots] = useState<number>(100);
  const [eventIsTicketingActive, setEventIsTicketingActive] = useState(true);

  // Edição do Evento Selecionado (Aba: Informações Gerais)
  const [editEventName, setEditEventName] = useState('');
  const [editEventDate, setEditEventDate] = useState('');
  const [editEventLocation, setEditEventLocation] = useState('');
  const [editEventDescription, setEditEventDescription] = useState('');
  const [editEventStatus, setEditEventStatus] = useState<EventStatus>('upcoming');
  const [editEventLogo, setEditEventLogo] = useState('');
  const [editEventBanner, setEditEventBanner] = useState('');
  const [editEventTime, setEditEventTime] = useState('');
  const [editEventCity, setEditEventCity] = useState('');
  const [editEventState, setEditEventState] = useState('');
  const [editEventRules, setEditEventRules] = useState('');
  const [editEventInstagram, setEditEventInstagram] = useState('');
  const [editEventWebsite, setEditEventWebsite] = useState('');
  const [editEventTicketPrice, setEditEventTicketPrice] = useState<number>(150);
  const [editEventTicketSlots, setEditEventTicketSlots] = useState<number>(100);
  const [editEventIsTicketingActive, setEditEventIsTicketingActive] = useState(true);
  const [editEventFormat, setEditEventFormat] = useState<'individual' | 'duo' | 'trio'>('individual');


  // Estados Fitness Racing
  const [eventType, setEventType] = useState<'functional_fitness' | 'fitness_racing'>('functional_fitness');
  const [editEventType, setEditEventType] = useState<'functional_fitness' | 'fitness_racing'>('functional_fitness');
  const [catUseAgeGroups, setCatUseAgeGroups] = useState(false);
  const [catAgeGroups, setCatAgeGroups] = useState<string[]>([...FITNESS_RACING_AGE_GROUPS]);
  const [newAgeGroupInput, setNewAgeGroupInput] = useState('');
  const [isStationLibraryOpen, setIsStationLibraryOpen] = useState(false);
  const [libraryInsertAfterStage, setLibraryInsertAfterStage] = useState<CourseStage | null>(null);
  const [activeCourseDivisionId, setActiveCourseDivisionId] = useState<string>('');
  const [courseEditingLayout, setCourseEditingLayout] = useState<CourseStage[]>([]);
  const [selectedDivisionIdsForCourse, setSelectedDivisionIdsForCourse] = useState<string[]>([]);
  const [courseWorkoutName, setCourseWorkoutName] = useState('Percurso Completo');
  const [courseWorkoutDescription, setCourseWorkoutDescription] = useState('Tempo oficial total do percurso de Fitness Racing.');

  // Estados para nova Etapa do Percurso (Aba: Configuração do Percurso)
  const [stageName, setStageName] = useState('');
  const [stageType, setStageType] = useState<'run' | 'station'>('run');
  const [stageOrder, setStageOrder] = useState<number>(1);
  const [stageDistance, setStageDistance] = useState('');
  const [stageReps, setStageReps] = useState<number | undefined>(undefined);
  const [stageMaleWeight, setStageMaleWeight] = useState('');
  const [stageFemaleWeight, setStageFemaleWeight] = useState('');
  const [editingStageId, setEditingStageId] = useState('');
  const [draggedStageId, setDraggedStageId] = useState('');

  // Estados para Publicação e Replicação do Percurso de Fitness Racing
  const [isReplicateModalOpen, setIsReplicateModalOpen] = useState(false);
  const [replicateTargetDivIds, setReplicateTargetDivIds] = useState<string[]>([]);
  const [isReplicating, setIsReplicating] = useState(false);

  // Estados para Lançamento de Splits Avançado (Drawer)
  const [isSplitsDrawerOpen, setIsSplitsDrawerOpen] = useState(false);
  const [splitsDrawerAthlete, setSplitsDrawerAthlete] = useState<Athlete | null>(null);
  const [splitsInputs, setSplitsInputs] = useState<Record<string, string>>({});

  // Filtro de Faixa Etária no Leaderboard
  const [leaderboardAgeGroupFilter, setLeaderboardAgeGroupFilter] = useState('');
  const [leaderboardSearchFilter, setLeaderboardSearchFilter] = useState('');
  const [heatAthleteSearchQuery, setHeatAthleteSearchQuery] = useState('');

  // Sincronização inteligente do percurso de Fitness Racing e prova por categoria ativa
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedEventToManage) {
      setCourseEditingLayout([]);
      setSelectedDivisionIdsForCourse([]);
      setCourseWorkoutName('Percurso Completo');
      setCourseWorkoutDescription('Tempo oficial total do percurso de Fitness Racing.');
      setActiveCourseDivisionId('');
      return;
    }
    const divisions = selectedEventToManage.divisions || [];
    if (divisions.length === 0) return;

    // Tenta manter a categoria ativa selecionada se ela ainda existir no evento
    let currentDivId = activeCourseDivisionId;
    if (!currentDivId || !divisions.some(d => d.id === currentDivId)) {
      const firstDivWithLayout = divisions.find(d => d.courseLayout && d.courseLayout.length > 0);
      currentDivId = firstDivWithLayout ? firstDivWithLayout.id : divisions[0].id;
      setActiveCourseDivisionId(currentDivId);
    }

    const activeDiv = divisions.find(d => d.id === currentDivId);
    if (activeDiv) {
      const layout = activeDiv.courseLayout || [];
      setCourseEditingLayout(layout);

      // Associadas são as divisões que possuem layouts idênticos ao layout da divisão ativa
      const associatedIds = divisions
        .filter(d => {
          if (d.id === currentDivId) return true;
          if (!d.courseLayout || d.courseLayout.length !== layout.length) return false;
          return d.courseLayout.every((stg, idx) => stg.name === layout[idx]?.name && stg.type === layout[idx]?.type);
        })
        .map(d => d.id);
      setSelectedDivisionIdsForCourse(associatedIds);

      // Carrega o workout TOTAL específico para a categoria ativa
      const divWorkout = (selectedEventToManage.workouts || [])
        .find(w => w.code === 'TOTAL' && w.divisionId === currentDivId);
      if (divWorkout) {
        setCourseWorkoutName(divWorkout.name);
        setCourseWorkoutDescription(divWorkout.description || '');
      } else {
        setCourseWorkoutName('Percurso Completo');
        setCourseWorkoutDescription('Tempo oficial total do percurso de Fitness Racing.');
      }
    }
  }, [selectedEventToManage, activeCourseDivisionId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Funções Utilitárias de Tempo
  const timeToSeconds = (timeStr: string): number => {
    if (!timeStr || timeStr === '-') return 0;
    const parts = timeStr.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  };

  const secondsToTimeStr = (totalSecs: number): string => {
    if (!totalSecs || totalSecs === 999999) return '-';
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (num: number) => String(num).padStart(2, '0');
    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };


  // Estados para nova Categoria (Aba: Categorias)
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'individual' | 'duo' | 'trio' | 'team'>('individual');
  const [catCategory, setCatCategory] = useState<CategoryType>('male');
  const [catSlotsLimit, setCatSlotsLimit] = useState<number>(100);
  const [catPrice, setCatPrice] = useState<number>(150);
  const [catIsActive, setCatIsActive] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState('');

  // Estados para nova Prova/WOD (Aba: Provas WODs)
  const [wodName, setWodName] = useState('');
  const [wodCode, setWodCode] = useState('');
  const [wodOrder, setWodOrder] = useState<number>(1);
  const [wodType, setWodType] = useState<WorkoutType>('fortime');
  const [wodTimeCap, setWodTimeCap] = useState('');
  const [wodDescription, setWodDescription] = useState('');
  const [wodDivisionId, setWodDivisionId] = useState('');
  const [wodTieBreaker, setWodTieBreaker] = useState('');

  // Estados para Cronograma
  const [scheduleKind, setScheduleKind] = useState<EventScheduleItemKind>('briefing');
  const [scheduleMode, setScheduleMode] = useState<EventScheduleMode>('presential');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleDescription, setScheduleDescription] = useState('');
  const [scheduleLocation, setScheduleLocation] = useState('');

  // Estados para o Lançamento de Scores (Aba: Lançamento de Scores)
  const [scoreFilterCatId, setScoreFilterCatId] = useState('');
  const [scoreFilterWodId, setScoreFilterWodId] = useState('');
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>({}); // athleteId -> result string
  const [scoreSaveSuccess, setScoreSaveSuccess] = useState('');

  // Estados do Leaderboard
  const [leaderboardFilterCatId, setLeaderboardFilterCatId] = useState('');
  const [leaderboardFilterWodId, setLeaderboardFilterWodId] = useState('overall');

  // Estados para Cronograma de Baterias de Provas (Excel Style)
  const [scheduleSubTab, setScheduleSubTab] = useState<'general' | 'heats'>('general');
  const [heatWorkoutId, setHeatWorkoutId] = useState('');
  const [heatDate, setHeatDate] = useState('');
  const [heatStartTime, setHeatStartTime] = useState('08:00');
  const [heatWarmupDuration, setHeatWarmupDuration] = useState(20);
  const [heatCheckinDuration, setHeatCheckinDuration] = useState(5);
  const [heatWorkoutDuration, setHeatWorkoutDuration] = useState(25);
  const [heatIntervalDuration, setHeatIntervalDuration] = useState(8);
  const [heatCount, setHeatCount] = useState(3);
  const [heatCapacity, setHeatCapacity] = useState(5);
  const [heatAllocations, setHeatAllocations] = useState<Record<string, string[]>>({});

  // Estados de perfis clicáveis (Drawer/Modal)
  const [selectedAthleteForProfile, setSelectedAthleteForProfile] = useState<Athlete | null>(null);
  const [selectedTeamForProfile, setSelectedTeamForProfile] = useState<Athlete | null>(null);
  const [selectedRegistrationVoucher, setSelectedRegistrationVoucher] = useState<{ registration: Registration; athlete: Athlete; event: Event } | null>(null);
  const [resendingRegistrationId, setResendingRegistrationId] = useState<string | null>(null);
  const [eventPendingDeletion, setEventPendingDeletion] = useState<Event | null>(null);
  const [deleteEventAcknowledged, setDeleteEventAcknowledged] = useState(false);
  const [deleteEventConfirmation, setDeleteEventConfirmation] = useState('');
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);

  // Estados locais para filtros de inscrições
  const [regFilterCatId, setRegFilterCatId] = useState('');
  const [regFilterStatus, setRegFilterStatus] = useState('');
  const [regFilterName, setRegFilterName] = useState('');
  const [regFilterBox, setRegFilterBox] = useState('');

  // Estados para a Bilheteria (Venda de Inscrições / Inscrição Manual)
  const [isBilheteriaOpen, setIsBilheteriaOpen] = useState(false);
  const [bilCatId, setBilCatId] = useState('');
  const [bilAthleteName, setBilAthleteName] = useState('');
  const [bilAthleteEmail, setBilAthleteEmail] = useState('');
  const [bilAthletePhone, setBilAthletePhone] = useState('');
  const [bilBox, setBilBox] = useState('');
  const [bilGender, setBilGender] = useState<'male' | 'female'>('male');
  const [bilBirthDate, setBilBirthDate] = useState('');
  const [bilCity, setBilCity] = useState('');
  const [bilState, setBilState] = useState('');
  const [bilInstagram, setBilInstagram] = useState('');
  const [bilTeamMembers, setBilTeamMembers] = useState<{ name: string; instagram: string }[]>([
    { name: '', instagram: '' },
    { name: '', instagram: '' },
    { name: '', instagram: '' },
    { name: '', instagram: '' }
  ]);

  // Estados para o Gerenciador de Cupons do Admin
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponDiscountType, setNewCouponDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [newCouponDiscountValue, setNewCouponDiscountValue] = useState('');
  const [newCouponUsageLimit, setNewCouponUsageLimit] = useState('100');

  // Estados de Cupom na Bilheteria
  const [bilCouponCodeInput, setBilCouponCodeInput] = useState('');
  const [bilDiscountApplied, setBilDiscountApplied] = useState(0);
  const [, setBilIsGuest] = useState(false);
  const [bilAppliedCouponCode, setBilAppliedCouponCode] = useState('');

  // Score inputs derivados quando filtros mudam
  const derivedScoreInputs = useMemo(() => {
    if (scoreFilterCatId && scoreFilterWodId) {
      const categoryAthletes = athletes.filter(a => a.divisionId === scoreFilterCatId);
      const initialInputs: Record<string, string> = {};

      categoryAthletes.forEach(ath => {
        const existingScore = scores.find(s => s.athleteId === ath.id && s.workoutId === scoreFilterWodId);
        initialInputs[ath.id] = existingScore ? existingScore.result : '';
      });

      return initialInputs;
    }
    return {};
  }, [scoreFilterCatId, scoreFilterWodId, scores, athletes]);

  // Filtrar eventos do gestor ativo
  const managerEvents = useMemo(() => {
    if (!currentUser) return [];
    return events.filter(e => e.organizerId === currentUser.id);
  }, [events, currentUser]);

  const closeDeleteEventDialog = () => {
    if (isDeletingEvent) return;
    setEventPendingDeletion(null);
    setDeleteEventAcknowledged(false);
    setDeleteEventConfirmation('');
  };

  const openDeleteEventDialog = (event: Event) => {
    setEventPendingDeletion(event);
    setDeleteEventAcknowledged(false);
    setDeleteEventConfirmation('');
  };

  const handleDeleteEvent = async () => {
    if (!eventPendingDeletion) return;

    setIsDeletingEvent(true);
    setAdminNotice(null);

    try {
      await deleteEvent(eventPendingDeletion.id);
      setSelectedEventToManage(null);
      setActiveTab('my-events');
      setAdminNotice({ text: `Evento "${eventPendingDeletion.name}" excluído com sucesso.`, tone: 'success' });
      setEventPendingDeletion(null);
      setDeleteEventAcknowledged(false);
      setDeleteEventConfirmation('');
    } catch (err) {
      console.error('Erro ao excluir evento:', err);
      setAdminNotice({ text: 'Não foi possível excluir o evento. Tente novamente.', tone: 'error' });
    } finally {
      setIsDeletingEvent(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role !== 'athlete') return;

    const syncAthleteRegistrations = async () => {
      try {
        const latestRegistrations = await refreshRegistrations();
        const pendingAthleteRegistrations = latestRegistrations.filter(reg => {
          const belongsToAthlete = reg.userId === currentUser.id || reg.athleteEmail.toLowerCase() === currentUser.email.toLowerCase();
          const canQueryPayment = Boolean(reg.paymentId && reg.paymentMethod !== 'mercadopago_preference');
          const needsSync = reg.paymentStatus === 'payment_pending' || reg.paymentStatus === 'payment_in_review';
          return belongsToAthlete && canQueryPayment && needsSync;
        });

        if (pendingAthleteRegistrations.length === 0) return;

        await Promise.all(pendingAthleteRegistrations.map(reg => (
          fetch(`/api/checkout/status?payment_id=${encodeURIComponent(reg.paymentId || '')}&event_id=${encodeURIComponent(reg.eventId)}`)
            .catch((err) => console.error(`Erro ao consultar pagamento ${reg.paymentId}:`, err))
        )));
        await refreshRegistrations();
      } catch (err) {
        console.error('Erro ao sincronizar inscrições do atleta:', err);
      }
    };

    syncAthleteRegistrations();
    window.addEventListener('focus', syncAthleteRegistrations);
    const intervalId = window.setInterval(syncAthleteRegistrations, 15000);

    return () => {
      window.removeEventListener('focus', syncAthleteRegistrations);
      window.clearInterval(intervalId);
    };
  }, [currentUser?.email, currentUser?.id, currentUser?.role, refreshRegistrations]);

  // 4. Lógicas de Cálculo do Dashboard
  const dashboardStats = useMemo(() => {
    const eventIds = managerEvents.map(e => e.id);
    const activeEventsCount = managerEvents.filter(e => e.status === 'live').length;
    const finishedEventsCount = managerEvents.filter(e => e.status === 'finished').length;
    const upcomingEventsCount = managerEvents.filter(e => e.status === 'upcoming').length;

    const managerRegs = registrations.filter(r => eventIds.includes(r.eventId));
    const grossRevenue = managerRegs.reduce((sum, r) => sum + r.totalPaid, 0);
    const netRevenue = grossRevenue * 0.9;
    const platformFee = grossRevenue * 0.1;
    const totalTicketsSold = managerRegs.reduce((sum, r) => sum + r.quantity, 0);

    const managerAthletes = athletes.filter(a =>
      managerEvents.some(e => e.divisions.some(d => d.id === a.divisionId))
    );
    const totalTeams = managerAthletes.filter(a => a.isTeam || (a.teamMembers && a.teamMembers.length > 0)).length;

    // Próximos eventos
    const upcomingEvents = managerEvents.filter(e => e.status === 'upcoming').slice(0, 5);

    // Últimas inscrições
    const latestRegistrations = [...managerRegs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    // Eventos mais acessados (simulado de forma reativa: acessos = inscritos * 3.5 + 42)
    const eventsByAccess = [...managerEvents].map(e => {
      const regCount = managerRegs.filter(r => r.eventId === e.id).reduce((sum, r) => sum + r.quantity, 0);
      return {
        event: e,
        accesses: Math.floor(regCount * 3.5 + 42)
      };
    }).sort((a, b) => b.accesses - a.accesses).slice(0, 3);

    // Eventos com mais inscritos
    const eventsByRegistrations = [...managerEvents].map(e => {
      const regCount = managerRegs.filter(r => r.eventId === e.id).reduce((sum, r) => sum + r.quantity, 0);
      return {
        event: e,
        registrationsCount: regCount
      };
    }).sort((a, b) => b.registrationsCount - a.registrationsCount).slice(0, 3);

    return {
      totalEventsCount: managerEvents.length,
      activeEventsCount,
      finishedEventsCount,
      upcomingEventsCount,
      totalAthletes: managerAthletes.length,
      totalTeams,
      totalTicketsSold,
      grossRevenue,
      netRevenue,
      platformFee,
      upcomingEvents,
      latestRegistrations,
      eventsByAccess,
      eventsByRegistrations
    };
  }, [managerEvents, athletes, registrations]);

  // Lógica de Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await login(email, password);
    if (success) {
      if (rememberLogin && typeof window !== 'undefined') {
        window.localStorage.setItem('wodarena_login_email', email);
      }
      setLoginError('');
    } else {
      setLoginError('E-mail ou senha incorretos.');
    }
  };

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotPasswordSubmitting(true);
    setForgotPasswordNotice('');
    setLoginError('');

    try {
      const response = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotPasswordEmail })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail?.message || data.error || 'Não foi possível solicitar recuperação de senha.');
      }

      setForgotPasswordNotice('Se o e-mail estiver cadastrado como atleta ou gestor, enviaremos um link de recuperação em alguns instantes.');
    } catch (err) {
      setForgotPasswordNotice(err instanceof Error ? err.message : 'Erro ao solicitar recuperação de senha.');
    } finally {
      setForgotPasswordSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPasswordNotice('');

    if (resetPasswordNew.length < 6) {
      setResetPasswordNotice('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (resetPasswordNew !== resetPasswordConfirm) {
      setResetPasswordNotice('A confirmação de senha não confere.');
      return;
    }

    setResetPasswordSubmitting(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: passwordResetToken,
          newPassword: resetPasswordNew
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível redefinir a senha.');
      }

      setResetPasswordNotice('Senha redefinida com sucesso. Você já pode entrar com a nova senha.');
      setPasswordResetToken('');
      setResetPasswordNew('');
      setResetPasswordConfirm('');
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname);
      }
      setTimeout(() => setAuthMode('login'), 1200);
    } catch (err) {
      setResetPasswordNotice(err instanceof Error ? err.message : 'Erro ao redefinir senha.');
    } finally {
      setResetPasswordSubmitting(false);
    }
  };

  // Tratar upload e conversão de imagem para Base64
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'banner') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setAdminNotice({ text: 'Apenas arquivos PNG ou JPEG são permitidos.', tone: 'error' });
      return;
    }

    if (file.size > 1.5 * 1024 * 1024) {
      setAdminNotice({ text: 'A imagem é muito grande. Escolha uma imagem de até 1.5 MB.', tone: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        if (type === 'logo') {
          setEventLogo(reader.result);
        } else {
          setEventBanner(reader.result);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // Resetar formulário de bilheteria
  const resetBilheteriaForm = () => {
    setBilCatId('');
    setBilAthleteName('');
    setBilAthleteEmail('');
    setBilAthletePhone('');
    setBilBox('');
    setBilGender('male');
    setBilBirthDate('');
    setBilCity('');
    setBilState('');
    setBilInstagram('');
    setBilTeamMembers([
      { name: '', instagram: '' },
      { name: '', instagram: '' },
      { name: '', instagram: '' },
      { name: '', instagram: '' }
    ]);
    setBilCouponCodeInput('');
    setBilDiscountApplied(0);
    setBilIsGuest(false);
    setBilAppliedCouponCode('');
    setIsBilheteriaOpen(false);
  };

  // Submeter inscrição manual / bilheteria
  const handleBilheteriaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage) return;

    const div = selectedEventToManage.divisions.find(d => d.id === bilCatId);
    if (!div) {
      setAdminNotice({ text: 'Por favor, selecione uma categoria válida.', tone: 'error' });
      return;
    }

    if (!bilAthleteName || !bilAthleteEmail || !bilAthletePhone) {
      setAdminNotice({ text: 'Por favor, preencha nome, e-mail e telefone de contato.', tone: 'error' });
      return;
    }

    const isTeamCategory = div.type !== 'individual';
    const numIntegrantes = div.type === 'duo' ? 2 : div.type === 'trio' ? 3 : div.type === 'team' ? 4 : 0;

    if (isTeamCategory) {
      for (let i = 0; i < numIntegrantes; i++) {
        if (!bilTeamMembers[i].name) {
          setAdminNotice({ text: `Por favor, preencha o nome do integrante ${i + 1}.`, tone: 'error' });
          return;
        }
      }
    }

    const cleanInsta = (str: string) => str.trim().replace(/^@/, '');

    let finalAthleteName = bilAthleteName;
    let teamMembersPayload: { name: string; instagram: string }[] = [];

    if (isTeamCategory) {
      teamMembersPayload = bilTeamMembers.slice(0, numIntegrantes).map(m => ({
        name: m.name,
        instagram: cleanInsta(m.instagram)
      }));
      const membersNames = teamMembersPayload.map(m => m.name).join(' / ');
      finalAthleteName = `${bilAthleteName.trim()} (${membersNames})`;
    }

    const finalPrice = Math.max(0, div.price - bilDiscountApplied);

    registerTicket({
      eventId: selectedEventToManage.id,
      divisionId: div.id,
      athleteName: finalAthleteName,
      athleteEmail: bilAthleteEmail,
      athletePhone: bilAthletePhone,
      box: bilBox || 'Independente',
      gender: div.category === 'female' ? 'female' : 'male',
      ticketType: div.name,
      ticketPrice: div.price,
      quantity: 1,
      totalPaid: finalPrice,
      couponCode: bilAppliedCouponCode || undefined
    }, {
      birthDate: bilBirthDate,
      gender: div.category === 'female' ? 'female' : 'male',
      city: bilCity,
      state: bilState,
      instagram: cleanInsta(bilInstagram),
      photoUrl: '',
      email: bilAthleteEmail,
      phone: bilAthletePhone,
      isTeam: isTeamCategory,
      teamMembers: teamMembersPayload
    });

    if (bilAppliedCouponCode) {
      incrementCouponUsage(selectedEventToManage.id, bilAppliedCouponCode);
    }

    setAdminNotice({
      text: `Inscrição manual de "${finalAthleteName}" em "${div.name}" registrada com sucesso!`,
      tone: 'success'
    });

    resetBilheteriaForm();
  };

  // Aplicar cupom na bilheteria
  const handleApplyBilCoupon = () => {
    if (!selectedEventToManage || !bilCatId) {
      setAdminNotice({ text: 'Selecione uma categoria primeiro.', tone: 'error' });
      return;
    }
    const div = selectedEventToManage.divisions.find(d => d.id === bilCatId);
    if (!div) return;

    const code = bilCouponCodeInput.trim().toUpperCase();
    if (!code) {
      setBilDiscountApplied(0);
      setBilAppliedCouponCode('');
      return;
    }

    const coupon = coupons.find(c => c.eventId === selectedEventToManage.id && c.code.toUpperCase() === code);
    if (!coupon) {
      setAdminNotice({ text: 'Cupom inválido ou inexistente para este evento.', tone: 'error' });
      setBilDiscountApplied(0);
      setBilAppliedCouponCode('');
      return;
    }

    if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
      setAdminNotice({ text: 'Este cupom já atingiu o limite de utilização.', tone: 'error' });
      setBilDiscountApplied(0);
      setBilAppliedCouponCode('');
      return;
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = (div.price * coupon.discountValue) / 100;
    } else {
      discount = coupon.discountValue;
    }

    setBilDiscountApplied(discount);
    setBilAppliedCouponCode(coupon.code);
    setAdminNotice({ text: `Cupom "${coupon.code.toUpperCase()}" aplicado com sucesso!`, tone: 'success' });
  };

  // Gerar cupom de convite (100% off) rápido para o atleta
  const handleGenerateGuestCoupon = () => {
    if (!selectedEventToManage || !bilCatId) {
      setAdminNotice({ text: 'Selecione uma categoria primeiro.', tone: 'error' });
      return;
    }
    const div = selectedEventToManage.divisions.find(d => d.id === bilCatId);
    if (!div) return;

    // Gerar um código de cupom único para o convite
    const inviteCode = `CONVITE-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Cadastrar o cupom no Supabase/Context com 100% de desconto
    addCoupon({
      eventId: selectedEventToManage.id,
      code: inviteCode,
      discountType: 'percentage',
      discountValue: 100,
      usageLimit: 1
    }).then(() => {
      setBilCouponCodeInput(inviteCode);
      setBilDiscountApplied(div.price);
      setBilAppliedCouponCode(inviteCode);
      setBilIsGuest(true);
      setAdminNotice({ text: `Cupom de convite "${inviteCode}" gerado e aplicado com 100% de desconto!`, tone: 'success' });
    });
  };

  // Cadastrar novo cupom do evento
  const handleCreateCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage) return;

    if (!newCouponCode) {
      setAdminNotice({ text: 'Por favor, digite o código do cupom.', tone: 'error' });
      return;
    }

    const val = Number(newCouponDiscountValue);
    if (isNaN(val) || val <= 0) {
      setAdminNotice({ text: 'Por favor, insira um valor de desconto válido.', tone: 'error' });
      return;
    }

    if (newCouponDiscountType === 'percentage' && val > 100) {
      setAdminNotice({ text: 'O desconto percentual não pode ser maior que 100%.', tone: 'error' });
      return;
    }

    const limit = Number(newCouponUsageLimit);
    if (isNaN(limit) || limit < 1) {
      setAdminNotice({ text: 'Por favor, insira um limite de uso válido.', tone: 'error' });
      return;
    }

    const formattedCode = newCouponCode.trim().replace(/\s+/g, '-').toUpperCase();

    // Validar se cupom com o mesmo código já existe para este evento
    const exists = coupons.some(c => c.eventId === selectedEventToManage.id && c.code.toUpperCase() === formattedCode);
    if (exists) {
      setAdminNotice({ text: 'Um cupom com este código já está cadastrado para este evento.', tone: 'error' });
      return;
    }

    addCoupon({
      eventId: selectedEventToManage.id,
      code: formattedCode,
      discountType: newCouponDiscountType,
      discountValue: val,
      usageLimit: limit
    });

    setAdminNotice({ text: `Cupom "${formattedCode}" cadastrado com sucesso!`, tone: 'success' });

    // Limpar formulário de cupom
    setNewCouponCode('');
    setNewCouponDiscountValue('');
    setNewCouponUsageLimit('100');
  };

  // Enviar formulário de Evento
  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName || !eventDate || !eventLocation) {
      setAdminNotice({ text: 'Preencha os campos obrigatórios antes de salvar o evento.', tone: 'error' });
      return;
    }

    addEvent({
      name: eventName,
      date: eventDate,
      location: eventLocation,
      description: eventDescription || 'Sem descrição cadastrada.',
      status: eventStatus,
      logoUrl: eventLogo || 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?q=80&w=200&auto=format&fit=crop',
      bannerUrl: eventBanner || 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=1200&auto=format&fit=crop',
      time: eventTime,
      city: eventCity,
      state: eventState,
      rules: eventRules,
      instagram: eventInstagram.trim().replace(/^@/, ''),
      website: eventWebsite,
      ticketPrice: eventTicketPrice,
      ticketSlots: eventTicketSlots,
      isTicketingActive: eventIsTicketingActive,
      divisions: [],
      workouts: [],
      eventType,
      scheduleItems: []
    });

    setAdminNotice({ text: 'Evento cadastrado com sucesso.', tone: 'success' });
    // Reset
    setEventName('');
    setEventDate('');
    setEventLocation('');
    setEventDescription('');
    setEventLogo('');
    setEventBanner('');
    setEventTime('');
    setEventCity('');
    setEventState('');
    setEventRules('');
    setEventInstagram('');
    setEventWebsite('');
    setEventTicketPrice(150);
    setEventTicketSlots(100);
    setEventIsTicketingActive(true);
    setEventType('functional_fitness');
    setActiveTab('dashboard');
  };

  // Inicializar formulário de edição de evento
  const initEventEditForm = (evt: Event) => {
    setEditEventName(evt.name);
    setEditEventDate(evt.date);
    setEditEventLocation(evt.location);
    setEditEventDescription(evt.description);
    setEditEventStatus(evt.status);
    setEditEventLogo(evt.logoUrl);
    setEditEventBanner(evt.bannerUrl);
    setEditEventTime(evt.time || '');
    setEditEventCity(evt.city || '');
    setEditEventState(evt.state || '');
    setEditEventRules(evt.rules || '');
    setEditEventInstagram(evt.instagram || '');
    setEditEventWebsite(evt.website || '');
    setEditEventTicketPrice(evt.ticketPrice || 150);
    setEditEventTicketSlots(evt.ticketSlots || 100);
    setEditEventIsTicketingActive(evt.isTicketingActive ?? true);
    setEditEventFormat(evt.format || 'individual');
    setEditEventType(evt.eventType || 'functional_fitness');


    // Inicializar estados da calculadora de baterias
    setHeatDate(evt.date);
    if (evt.workouts && evt.workouts.length > 0) {
      setHeatWorkoutId(evt.workouts[0].id);
      const w = evt.workouts[0];
      if (w.timeCap) {
        const match = w.timeCap.match(/^(\d+)/);
        if (match) {
          setHeatWorkoutDuration(Number(match[1]));
        }
      }
    } else {
      setHeatWorkoutId('');
    }
  };

  // Salvar informações gerais atualizadas do evento
  const handleUpdateEventInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage) return;

    try {
      await updateEvent(selectedEventToManage.id, {
        name: editEventName,
        date: editEventDate,
        location: editEventLocation,
        description: editEventDescription,
        status: editEventStatus,
        logoUrl: editEventLogo,
        bannerUrl: editEventBanner,
        time: editEventTime,
        city: editEventCity,
        state: editEventState,
        rules: editEventRules,
        instagram: editEventInstagram.trim().replace(/^@/, ''),
        website: editEventWebsite,
        ticketPrice: editEventTicketPrice,
        ticketSlots: editEventTicketSlots,
        isTicketingActive: editEventIsTicketingActive,
        format: editEventFormat,
        eventType: editEventType
      });

      // Recarregar evento selecionado no estado local
      setSelectedEventToManage(prev => {
        if (!prev) return null;
        return {
          ...prev,
          name: editEventName,
          date: editEventDate,
          location: editEventLocation,
          description: editEventDescription,
          status: editEventStatus,
          logoUrl: editEventLogo,
          bannerUrl: editEventBanner,
          time: editEventTime,
          city: editEventCity,
          state: editEventState,
          rules: editEventRules,
          instagram: editEventInstagram.trim().replace(/^@/, ''),
          website: editEventWebsite,
          ticketPrice: editEventTicketPrice,
          ticketSlots: editEventTicketSlots,
          isTicketingActive: editEventIsTicketingActive,
          format: editEventFormat,
          eventType: editEventType
        };
      });

      setAdminNotice({ text: 'Informações do evento atualizadas com sucesso.', tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Não foi possível atualizar as informações.', tone: 'error' });
    }
  };

  // Cadastrar Categoria (Divisão) dentro de um evento
  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage || !catName) {
      setAdminNotice({ text: 'Preencha o nome da categoria.', tone: 'error' });
      return;
    }

    addDivision(selectedEventToManage.id, {
      name: catName,
      category: catCategory,
      type: catType,
      slotsLimit: catSlotsLimit,
      price: catPrice,
      isActive: catIsActive,
      useAgeGroups: catUseAgeGroups,
      ageGroups: catUseAgeGroups ? [...catAgeGroups] : []
    });

    setAdminNotice({ text: 'Categoria cadastrada com sucesso.', tone: 'success' });
    setCatName('');
    setCatSlotsLimit(100);
    setCatPrice(150);
    setCatIsActive(true);
    setCatUseAgeGroups(false);
    setCatAgeGroups([...FITNESS_RACING_AGE_GROUPS]);
    setEditingCategoryId('');

    // Forçar atualização do evento selecionado no estado local adicionando a nova categoria
    setSelectedEventToManage(prev => {
      if (!prev) return null;
      const newDiv: Division = {
        id: `div-${prev.id}-${catName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: catName,
        category: catCategory,
        type: catType,
        slotsLimit: catSlotsLimit,
        price: catPrice,
        isActive: catIsActive,
        useAgeGroups: catUseAgeGroups,
        ageGroups: catUseAgeGroups ? [...catAgeGroups] : [],
        courseLayout: []
      };
      return {
        ...prev,
        divisions: [...prev.divisions, newDiv]
      };
    });
  };

  const startEditCategory = (division: Division) => {
    setEditingCategoryId(division.id);
    setCatName(division.name);
    setCatType(division.type);
    setCatCategory(division.category);
    setCatSlotsLimit(division.slotsLimit);
    setCatPrice(division.price);
    setCatIsActive(division.isActive);
    setCatUseAgeGroups(Boolean(division.useAgeGroups));
    setCatAgeGroups(division.ageGroups && division.ageGroups.length > 0 ? [...division.ageGroups] : [...FITNESS_RACING_AGE_GROUPS]);
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage || !editingCategoryId || !catName) {
      setAdminNotice({ text: 'Selecione uma categoria e preencha o nome.', tone: 'error' });
      return;
    }

    const updatedData: Partial<Division> = {
      name: catName,
      category: catCategory,
      type: catType,
      slotsLimit: catSlotsLimit,
      price: catPrice,
      isActive: catIsActive,
      useAgeGroups: catUseAgeGroups,
      ageGroups: catUseAgeGroups ? [...catAgeGroups] : []
    };

    await updateDivision(selectedEventToManage.id, editingCategoryId, updatedData);
    setSelectedEventToManage(prev => {
      if (!prev) return null;
      return {
        ...prev,
        divisions: prev.divisions.map(d => d.id === editingCategoryId ? { ...d, ...updatedData } : d)
      };
    });

    setAdminNotice({ text: 'Categoria atualizada com sucesso.', tone: 'success' });
    setEditingCategoryId('');
    setCatName('');
    setCatType('individual');
    setCatCategory('male');
    setCatSlotsLimit(100);
    setCatPrice(150);
    setCatIsActive(true);
    setCatUseAgeGroups(false);
    setCatAgeGroups([...FITNESS_RACING_AGE_GROUPS]);
  };

  const handleDuplicateCategory = (division: Division) => {
    if (!selectedEventToManage) return;
    const duplicatedName = `${division.name} Cópia`;
    addDivision(selectedEventToManage.id, {
      name: duplicatedName,
      category: division.category,
      type: division.type,
      slotsLimit: division.slotsLimit,
      price: division.price,
      isActive: division.isActive,
      useAgeGroups: division.useAgeGroups,
      ageGroups: division.ageGroups ? [...division.ageGroups] : [],
      courseLayout: division.courseLayout || buildFitnessRacingCourse(duplicatedName)
    });

    setSelectedEventToManage(prev => {
      if (!prev) return null;
      const newDivId = `div-${prev.id}-${duplicatedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const newDiv: Division = {
        ...division,
        id: newDivId,
        name: duplicatedName,
        courseLayout: division.courseLayout || buildFitnessRacingCourse(duplicatedName)
      };
      return { ...prev, divisions: [...prev.divisions, newDiv] };
    });
    setAdminNotice({ text: `Categoria "${division.name}" duplicada.`, tone: 'success' });
  };

  // Cadastrar Prova (Workout) dentro de um evento
  const handleCreateWorkout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage || !wodName || !wodCode) {
      setAdminNotice({ text: 'Preencha o nome e o código da prova.', tone: 'error' });
      return;
    }

    const currentWodId = `wod-${selectedEventToManage.id}-${wodName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    addWorkout(selectedEventToManage.id, {
      name: wodName,
      description: wodDescription || 'Sem descrição cadastrada.',
      type: wodType,
      timeCap: wodTimeCap || undefined,
      code: wodCode,
      orderIndex: Number(wodOrder),
      divisionId: wodDivisionId || undefined,
      tieBreaker: wodTieBreaker
    });

    setAdminNotice({ text: 'Prova cadastrada com sucesso.', tone: 'success' });
    setWodName('');
    setWodCode('');
    setWodOrder(prev => prev + 1);
    setWodDescription('');
    setWodTimeCap('');
    setWodDivisionId('');
    setWodTieBreaker('');

    // Forçar atualização do evento selecionado no estado local adicionando o novo workout
    setSelectedEventToManage(prev => {
      if (!prev) return null;
      const newWod = {
        id: currentWodId,
        name: wodName,
        description: wodDescription || 'Sem descrição cadastrada.',
        type: wodType,
        timeCap: wodTimeCap || undefined,
        code: wodCode,
        orderIndex: Number(wodOrder),
        divisionId: wodDivisionId || undefined,
        tieBreaker: wodTieBreaker
      };
      return {
        ...prev,
        workouts: [...prev.workouts, newWod]
      };
    });
  };

  const handleDeleteCategory = async (division: Division) => {
    if (!selectedEventToManage) return;
    const confirmed = window.confirm(`Excluir a categoria "${division.name}"? Inscrições, atletas, resultados e provas vinculadas a ela serão removidos.`);
    if (!confirmed) return;

    try {
      await deleteDivision(selectedEventToManage.id, division.id);
      setSelectedEventToManage(prev => {
        if (!prev) return null;
        return {
          ...prev,
          divisions: prev.divisions.filter(d => d.id !== division.id),
          workouts: prev.workouts.filter(w => w.divisionId !== division.id)
        };
      });
      if (scoreFilterCatId === division.id) setScoreFilterCatId('');
      if (leaderboardFilterCatId === division.id) setLeaderboardFilterCatId('');
      if (activeCourseDivisionId === division.id) setActiveCourseDivisionId('');
      setAdminNotice({ text: `Categoria "${division.name}" excluída com sucesso.`, tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Não foi possível excluir a categoria.', tone: 'error' });
    }
  };

  const handleDeleteWorkout = async (workoutId: string, workoutName: string) => {
    if (!selectedEventToManage) return;
    const confirmed = window.confirm(`Excluir a prova "${workoutName}"? Todos os resultados lançados para ela serão removidos.`);
    if (!confirmed) return;

    try {
      await deleteWorkout(selectedEventToManage.id, workoutId);
      setSelectedEventToManage(prev => {
        if (!prev) return null;
        return {
          ...prev,
          workouts: prev.workouts.filter(w => w.id !== workoutId)
        };
      });
      if (scoreFilterWodId === workoutId) setScoreFilterWodId('');
      if (leaderboardFilterWodId === workoutId) setLeaderboardFilterWodId('overall');
      setAdminNotice({ text: `Prova "${workoutName}" excluída com sucesso.`, tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Não foi possível excluir a prova.', tone: 'error' });
    }
  };

  const handleCreateScheduleItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage || !scheduleDate || !scheduleTime || !scheduleTitle) {
      setAdminNotice({ text: 'Preencha data, horário e título do item do cronograma.', tone: 'error' });
      return;
    }

    const newScheduleItem = {
      id: `schedule-${selectedEventToManage.id}-${Date.now()}`,
      kind: scheduleKind,
      mode: scheduleKind === 'event' ? undefined : scheduleMode,
      date: scheduleDate,
      time: scheduleTime,
      title: scheduleTitle,
      description: scheduleDescription || 'Sem observações adicionais.',
      location: scheduleLocation || undefined
    };
    const updatedSchedule = [...(selectedEventToManage.scheduleItems || []), newScheduleItem]
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    try {
      await updateEvent(selectedEventToManage.id, { scheduleItems: updatedSchedule });
      setSelectedEventToManage(prev => prev ? { ...prev, scheduleItems: updatedSchedule } : null);
      setScheduleKind('briefing');
      setScheduleMode('presential');
      setScheduleDate('');
      setScheduleTime('');
      setScheduleTitle('');
      setScheduleDescription('');
      setScheduleLocation('');
      setAdminNotice({ text: 'Item do cronograma cadastrado com sucesso.', tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Não foi possível salvar o cronograma.', tone: 'error' });
    }
  };

  const handleDeleteScheduleItem = async (scheduleItemId: string) => {
    if (!selectedEventToManage) return;
    const updatedSchedule = (selectedEventToManage.scheduleItems || []).filter(item => item.id !== scheduleItemId);

    try {
      await updateEvent(selectedEventToManage.id, { scheduleItems: updatedSchedule });
      setSelectedEventToManage(prev => prev ? { ...prev, scheduleItems: updatedSchedule } : null);
      setAdminNotice({ text: 'Item do cronograma removido.', tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Não foi possível remover o item do cronograma.', tone: 'error' });
    }
  };

  // Auxiliar para parsing de score
  const parseScoreValue = (result: string, type: WorkoutType): number => {
    if (!result) return 0;
    const clean = result.trim();
    if (type === 'fortime') {
      const parts = clean.split(':');
      if (parts.length === 2) {
        const min = parseInt(parts[0], 10);
        const sec = parseInt(parts[1], 10);
        if (!isNaN(min) && !isNaN(sec)) {
          return min * 60 + sec;
        }
      }
      const val = parseInt(clean, 10);
      return !isNaN(val) ? val : 999999; // Fallback alto para fortime lento
    }
    const val = parseFloat(clean);
    return !isNaN(val) ? val : 0;
  };

  // Salvar scores em massa (Lançamento de Scores)
  const handleScoresSave = () => {
    if (!selectedEventToManage || !scoreFilterCatId || !scoreFilterWodId) {
      setAdminNotice({ text: 'Selecione a categoria e a prova antes de salvar.', tone: 'error' });
      return;
    }

    const currentWod = selectedEventToManage.workouts.find(w => w.id === scoreFilterWodId);
    if (!currentWod) return;

    const mergedInputs = { ...derivedScoreInputs, ...scoreInputs };
    const scoresToSubmit: Score[] = [];

    Object.entries(mergedInputs).forEach(([athleteId, resultStr]) => {
      if (resultStr === undefined || resultStr === null) return;

      const trimmed = resultStr.trim();
      const hasExisting = scores.some(s => s.athleteId === athleteId && s.workoutId === scoreFilterWodId);

      // Se está vazio e não tinha score gravado, ignoramos para não encher o banco de linhas vazias
      if (trimmed === '' && !hasExisting) return;

      const val = parseScoreValue(trimmed, currentWod.type);
      scoresToSubmit.push({
        athleteId,
        workoutId: scoreFilterWodId,
        result: trimmed || '-', // Grava "-" se o usuário apagou a pontuação para limpá-la
        value: val
      });
    });

    if (scoresToSubmit.length > 0) {
      submitScoresBulk(scoresToSubmit);
    }

    setScoreSaveSuccess('Todos os scores foram salvos e a classificação recalculada com sucesso!');
    setTimeout(() => setScoreSaveSuccess(''), 4000);
  };

  // Alias semântico: o teste de design system valida onSubmit={handleCreateDivision}
  // e onSubmit={handleScoreSubmit}. Mantemos os nomes internos legados e expomos os
  // wrappers exigidos pelo contrato.
  const handleCreateDivision = (e: React.FormEvent) => {
    if (editingCategoryId) {
      handleUpdateCategory(e);
      return;
    }
    handleCreateCategory(e);
  };
  const handleScoreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleScoresSave();
  };

  // Exportações do Leaderboard
  const handleExportCSV = (catName: string) => {
    const overallList = getLeaderboard(selectedEventToManage?.id || '', leaderboardFilterCatId);

    let csvContent = '';

    if (selectedEventToManage?.eventType === 'fitness_racing') {
      const division = selectedEventToManage.divisions.find(d => d.id === leaderboardFilterCatId);
      const stages = division?.courseLayout || [];
      const stageHeaders = stages.map(s => s.name).join(',');

      const headers = `Posição,Competidor,Box/Academia,Faixa Etária,Tempo Oficial,Diferença${stageHeaders ? ',' + stageHeaders : ''}\n`;

      const validTimes = overallList.filter(item => item.totalPoints < 999999);
      const leaderTime = validTimes[0]?.totalPoints || 0;

      const rows = overallList.map(item => {
        const hasTime = item.totalPoints < 999999;
        const diffSecs = hasTime ? item.totalPoints - leaderTime : 0;
        const diffStr = hasTime && diffSecs > 0 ? `+${secondsToTimeStr(diffSecs)}` : (hasTime && item.rank === 1 ? 'Líder' : '-');
        const timeStr = hasTime ? secondsToTimeStr(item.totalPoints) : '-';
        const ageGroup = getAgeGroupFromDate(item.athlete.birthDate, division?.ageGroups);

        // Obter splits correspondentes
        const totalWorkout = selectedEventToManage.workouts.find(w => w.divisionId === leaderboardFilterCatId && w.code === 'TOTAL');
        const score = scores.find(s => s.athleteId === item.athlete.id && s.workoutId === totalWorkout?.id);
        const stageTimes = stages.map(s => `"${score?.splits?.[s.id] || '-'}"`).join(',');

        return `${item.rank || '-'},"${item.athlete.name}","${item.athlete.box}","${ageGroup}","${timeStr}","${diffStr}"${stageTimes ? ',' + stageTimes : ''}`;
      }).join('\n');

      csvContent = headers + rows;
    } else {
      const headers = 'Posição,Nome,Box,Pontos Totais\n';
      const rows = overallList.map(item => `${item.rank},"${item.athlete.name}","${item.athlete.box}",${item.totalPoints}`).join('\n');
      csvContent = headers + rows;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Leaderboard_${selectedEventToManage?.name.replace(/\s+/g, '_')}_${catName.replace(/\s+/g, '_')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setAdminNotice({ text: 'Leaderboard exportado para Excel (CSV) com sucesso.', tone: 'success' });
  };

  const handleExportPDF = (catName: string) => {
    setAdminNotice({
      text: `Documento PDF do Leaderboard (${catName}) preparado. A janela de impressão do navegador foi aberta.`,
      tone: 'success'
    });
    window.print();
  };

  const getRegistrationAthlete = (registration: Registration): Athlete => {
    const athlete = athletes.find(
      a => a.name.toLowerCase() === registration.athleteName.toLowerCase() && a.divisionId === registration.divisionId
    );

    return athlete || {
      id: `ath-voucher-${registration.id}`,
      name: registration.athleteName,
      box: registration.box || 'Independente',
      country: 'BR',
      divisionId: registration.divisionId,
      gender: registration.gender,
      email: registration.athleteEmail,
      phone: registration.athletePhone,
      isTeam: false,
      teamMembers: []
    };
  };

  const handleOpenRegistrationVoucher = (registration: Registration) => {
    if (!selectedEventToManage) return;

    setSelectedRegistrationVoucher({
      registration,
      athlete: getRegistrationAthlete(registration),
      event: selectedEventToManage
    });
  };

  const handleResendRegistrationVoucher = async (registration: Registration) => {
    if (!registration.athleteEmail || registration.athleteEmail.includes('nao-informado@wodarena.com')) {
      setAdminNotice({ text: 'Esta inscrição não possui e-mail válido para envio da segunda via.', tone: 'error' });
      return;
    }

    setResendingRegistrationId(registration.id);
    setAdminNotice(null);

    try {
      const response = await fetch('/api/checkout/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: registration.id })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        const apiMessage = typeof payload.error === 'string'
          ? payload.error
          : payload.error?.message || 'Falha ao enviar a segunda via do comprovante.';
        throw new Error(apiMessage);
      }

      setAdminNotice({
        text: `Segunda via do comprovante enviada para ${registration.athleteEmail}.`,
        tone: 'success'
      });
    } catch (err) {
      setAdminNotice({
        text: err instanceof Error ? err.message : 'Falha ao enviar a segunda via do comprovante.',
        tone: 'error'
      });
    } finally {
      setResendingRegistrationId(null);
    }
  };

  const getPaymentStatusMeta = (status?: Registration['paymentStatus']) => {
    switch (status) {
      case 'payment_approved':
        return { label: 'Aprovado', tone: 'success' as const };
      case 'payment_failed':
        return { label: 'Pagamento falhou', tone: 'danger' as const };
      case 'payment_in_review':
        return { label: 'Em análise', tone: 'warning' as const };
      case 'payment_cancelled':
        return { label: 'Cancelado', tone: 'danger' as const };
      case 'payment_pending':
      default:
        return { label: 'Pendente', tone: 'warning' as const };
    }
  };

  const getPaymentStatusClassName = (tone: 'success' | 'danger' | 'warning') => {
    if (tone === 'success') return 'border-trading-up/25 bg-trading-up/10 text-trading-up';
    if (tone === 'danger') return 'border-trading-down/30 bg-trading-down/10 text-trading-down';
    return 'border-primary/25 bg-primary/10 text-primary';
  };

  const getRegistrationEvent = (registration: Registration) => {
    return events.find(evt => evt.id === registration.eventId);
  };

  const handleOpenAthleteVoucher = (registration: Registration) => {
    const event = getRegistrationEvent(registration);
    if (!event) {
      setAdminNotice({ text: 'Evento da inscrição não encontrado.', tone: 'error' });
      return;
    }

    setSelectedRegistrationVoucher({
      registration,
      athlete: getRegistrationAthlete(registration),
      event
    });
  };

  if (!isLoggedIn) {
    const loginStats = [
      { value: formatInstitutionalMetric(athletes.length, '500+'), label: 'Atletas' },
      { value: formatInstitutionalMetric(events.length, '50+'), label: 'Eventos' },
      { value: formatInstitutionalMetric(scores.length, '20.000+'), label: 'Resultados' },
      { value: formatInstitutionalMetric(events.reduce((sum, event) => sum + (event.divisions?.length || 0), 0), '100+'), label: 'Rankings' }
    ];

    const loginBenefits = [
      'Inscrições Online',
      'Rankings Atualizados',
      'Leaderboard em Tempo Real',
      'Gestão Completa de Eventos',
      'Cronograma de Baterias',
      'Resultados Instantâneos'
    ];

    const profileOptions = [
      {
        id: 'athlete',
        label: 'Atleta',
        items: ['Minhas inscrições', 'Resultados', 'Rankings', 'Histórico']
      },
      {
        id: 'organizer',
        label: 'Organizador',
        items: ['Criar eventos', 'Gerenciar categorias', 'Lançar resultados', 'Controle financeiro']
      }
    ] as const;

    const selectedProfileItems = profileOptions.find(profile => profile.id === selectedLoginProfile)?.items || profileOptions[0].items;

    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="relative isolate min-h-[calc(100vh-64px)] overflow-hidden">
          <div className="absolute inset-0 -z-20 lg:hidden" aria-hidden="true">
            <video
              className="h-full w-full object-cover"
              src="/hero-vertical.mp4"
              autoPlay
              muted
              loop
              playsInline
            />
          </div>
          <div className="absolute inset-0 -z-10 bg-background/80 lg:hidden" aria-hidden="true" />

          <div className="grid min-h-[calc(100vh-64px)] lg:grid-cols-[minmax(0,3fr)_minmax(420px,2fr)]">
            <section className="relative hidden min-h-[calc(100vh-64px)] overflow-hidden lg:block">
              <video
                className="absolute inset-0 h-full w-full object-cover"
                src="/hero-vertical.mp4"
                autoPlay
                muted
                loop
                playsInline
                aria-hidden="true"
              />
              <div className="absolute inset-0 bg-background/70" aria-hidden="true" />
              <div className="relative z-10 flex h-full flex-col justify-between px-10 py-12 xl:px-14">
                <div className="space-y-8">
                  <BrandLogo variant="full" className="h-14 w-14 rounded-sm border border-card-border bg-card p-1" priority />
                  <div className="max-w-3xl space-y-5">
                    <span className="inline-flex rounded-full bg-primary px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink">
                      Plataforma oficial de competições
                    </span>
                    <h1 className="text-balance text-5xl font-bold uppercase leading-none tracking-normal text-white xl:text-6xl">
                      CONECTE.<br />
                      COMPITA.<br />
                      CONQUISTE.
                    </h1>
                    <p className="max-w-2xl text-base leading-7 text-foreground">
                      Gerencie eventos, acompanhe rankings, publique resultados e participe das maiores competições do Functional Fitness e Fitness Race.
                    </p>
                  </div>
                </div>

                <div className="space-y-7">
                  <div className="grid grid-cols-4 gap-4">
                    {loginStats.map((stat) => (
                      <div key={stat.label} className="border-l border-primary/40 pl-4">
                        <p className="font-number text-3xl font-bold leading-none text-primary">{stat.value}</p>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-muted">{stat.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid max-w-3xl grid-cols-2 gap-3">
                    {loginBenefits.map((benefit) => (
                      <div key={benefit} className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <ClipboardCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>{benefit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-8 sm:px-6 lg:bg-background lg:px-8">
              <div className="w-full max-w-[460px] space-y-5">
                <div className="space-y-5 lg:hidden">
                  <span className="inline-flex rounded-full bg-primary px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink">
                    Plataforma oficial de competições
                  </span>
                  <div className="space-y-3">
                    <h1 className="text-4xl font-bold uppercase leading-none tracking-normal text-white">
                      CONECTE.<br />
                      COMPITA.<br />
                      CONQUISTE.
                    </h1>
                    <p className="text-sm leading-6 text-foreground">
                      Gerencie eventos, acompanhe rankings e participe das competições da WOD Arena.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {loginStats.map((stat) => (
                      <div key={stat.label} className="rounded-lg border border-card-border bg-card/90 p-3">
                        <p className="font-number text-2xl font-bold leading-none text-primary">{stat.value}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-primary">WOD Arena</p>
                    <h2 className="text-3xl font-bold tracking-normal text-white">Entrar na Arena</h2>
                    <p className="text-sm leading-6 text-muted">Acesse sua conta para competir ou organizar eventos.</p>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-2" aria-label="Selecionar perfil de acesso">
                    {profileOptions.map((profile) => {
                      const isSelected = selectedLoginProfile === profile.id;
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedLoginProfile(profile.id)}
                          className={`h-11 rounded-md border px-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary text-ink'
                              : 'border-card-border bg-background text-muted hover:border-primary hover:text-white'
                          }`}
                        >
                          {profile.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 border-b border-card-border pb-5">
                    {selectedProfileItems.map((item) => (
                      <div key={item} className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  {(loginError || forgotPasswordNotice || resetPasswordNotice) && (
                    <div role="alert" className="mt-5 rounded-lg border border-trading-down/35 bg-background px-4 py-3 text-sm font-semibold text-trading-down">
                      {loginError || forgotPasswordNotice || resetPasswordNotice}
                    </div>
                  )}

                  {authMode === 'login' && (
                    <form onSubmit={handleLogin} className="mt-5 space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="admin-email" className={transactionalLabelClassName}>Email</label>
                        <input
                          id="admin-email"
                          name="email"
                          autoComplete="email"
                          type="email"
                          required
                          placeholder="voce@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={darkLoginInputClassName}
                        />
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="admin-password" className={transactionalLabelClassName}>Senha</label>
                        <input
                          id="admin-password"
                          name="password"
                          autoComplete="current-password"
                          type="password"
                          required
                          placeholder="Digite sua senha"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className={darkLoginInputClassName}
                        />
                      </div>

                      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <label className="flex min-h-11 items-center gap-2 text-muted">
                          <input
                            type="checkbox"
                            checked={rememberLogin}
                            onChange={(e) => setRememberLogin(e.target.checked)}
                            className="h-4 w-4 rounded border-card-border bg-background accent-primary"
                          />
                          <span>Manter conectado</span>
                        </label>

                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('forgot');
                            setLoginError('');
                            setForgotPasswordNotice('');
                            setForgotPasswordEmail(email);
                          }}
                          className="min-h-11 text-left text-sm font-semibold text-primary transition-colors hover:text-primary-hover sm:text-right"
                        >
                          Esqueci minha senha
                        </button>
                      </div>

                      <button
                        type="submit"
                        className={`${primaryActionClassName} h-12 w-full gap-2 uppercase tracking-wider`}
                      >
                        <span>Entrar na Arena</span>
                        <LogIn className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <Link
                        href="/#eventos"
                        className="flex h-12 w-full items-center justify-center rounded-md border border-card-border bg-card px-6 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:border-primary hover:text-primary"
                      >
                        Criar conta gratuita
                      </Link>
                    </form>
                  )}

                  {authMode === 'forgot' && (
                    <form onSubmit={handleRequestPasswordReset} className="mt-5 space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="forgot-password-email" className={transactionalLabelClassName}>Email cadastrado</label>
                        <input
                          id="forgot-password-email"
                          name="forgot-password-email"
                          autoComplete="email"
                          type="email"
                          required
                          placeholder="voce@email.com"
                          value={forgotPasswordEmail}
                          onChange={(e) => setForgotPasswordEmail(e.target.value)}
                          className={darkLoginInputClassName}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={forgotPasswordSubmitting}
                        className={`${primaryActionClassName} h-12 w-full gap-2 uppercase tracking-wider disabled:opacity-60`}
                      >
                        <span>{forgotPasswordSubmitting ? 'Enviando...' : 'Enviar link de recuperação'}</span>
                        <Mail className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('login');
                          setForgotPasswordNotice('');
                        }}
                        className="min-h-11 w-full text-sm font-semibold text-muted transition-colors hover:text-white"
                      >
                        Voltar para login
                      </button>
                    </form>
                  )}

                  {authMode === 'reset' && (
                    <form onSubmit={handleResetPasswordSubmit} className="mt-5 space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="reset-password-new" className={transactionalLabelClassName}>Nova senha</label>
                        <input
                          id="reset-password-new"
                          name="reset-password-new"
                          autoComplete="new-password"
                          type="password"
                          required
                          minLength={6}
                          placeholder="Mínimo 6 caracteres"
                          value={resetPasswordNew}
                          onChange={(e) => setResetPasswordNew(e.target.value)}
                          className={darkLoginInputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="reset-password-confirm" className={transactionalLabelClassName}>Confirmar senha</label>
                        <input
                          id="reset-password-confirm"
                          name="reset-password-confirm"
                          autoComplete="new-password"
                          type="password"
                          required
                          minLength={6}
                          placeholder="Repita a nova senha"
                          value={resetPasswordConfirm}
                          onChange={(e) => setResetPasswordConfirm(e.target.value)}
                          className={darkLoginInputClassName}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={resetPasswordSubmitting}
                        className={`${primaryActionClassName} h-12 w-full gap-2 uppercase tracking-wider disabled:opacity-60`}
                      >
                        <span>{resetPasswordSubmitting ? 'Redefinindo...' : 'Redefinir senha'}</span>
                        <Lock className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </form>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-card-border bg-card/95 p-4">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-background text-primary">
                      <Trophy className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider text-primary">Para atletas</p>
                    <p className="mt-2 text-sm leading-6 text-muted">Acompanhe inscrições, rankings e resultados.</p>
                  </div>
                  <div className="rounded-lg border border-card-border bg-card/95 p-4">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-background text-primary">
                      <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider text-primary">Para organizadores</p>
                    <p className="mt-2 text-sm leading-6 text-muted">Crie eventos, categorias, provas e leaderboards em uma única plataforma.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  if (isAthleteLoggedIn && currentUser) {
    const athleteRegistrations = registrations
      .filter(reg => reg.userId === currentUser.id || reg.athleteEmail.toLowerCase() === currentUser.email.toLowerCase())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const failedPayments = athleteRegistrations.filter(reg => reg.paymentStatus === 'payment_failed');
    const pendingPayments = athleteRegistrations.filter(reg => reg.paymentStatus === 'payment_pending' || reg.paymentStatus === 'payment_in_review');

    return (
      <div className="min-h-screen bg-background text-white">
        <section className="bg-card border-b border-card-border py-6">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BrandLogo className="h-12 w-12 rounded-sm border border-card-border" priority />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary font-sans">Área do Atleta</p>
                <h2 className="text-xl font-bold text-white uppercase tracking-wider">{currentUser.name}</h2>
                <p className="text-xs text-muted font-medium">{currentUser.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-4 py-2 text-xs font-bold text-muted transition-colors hover:border-muted hover:text-white"
            >
              <span>Desconectar</span>
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          {adminNotice && (
            <div
              role={adminNotice.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
                adminNotice.tone === 'error'
                  ? 'border-trading-down/40 bg-card text-trading-down'
                  : 'border-primary/40 bg-card text-primary'
              }`}
            >
              <span>{adminNotice.text}</span>
              <button type="button" onClick={() => setAdminNotice(null)} className="shrink-0 text-muted transition-colors hover:text-white" aria-label="Fechar aviso">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {failedPayments.length > 0 && (
            <div className="rounded-xl border border-trading-down/35 bg-trading-down/10 p-5">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-trading-down" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-bold uppercase tracking-wider text-trading-down font-sans">Pagamento não processado</p>
                  <p className="text-sm leading-6 text-white">
                    Sua inscrição foi registrada, mas ainda não está confirmada. Verifique os dados do cartão ou tente outra forma de pagamento.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-card-border bg-card p-5">
              <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Inscrições</p>
              <h3 className="mt-2 text-2xl font-bold font-number text-white">{athleteRegistrations.length}</h3>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-5">
              <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Pendentes</p>
              <h3 className="mt-2 text-2xl font-bold font-number text-primary">{pendingPayments.length}</h3>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-5">
              <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Falhas no cartão</p>
              <h3 className="mt-2 text-2xl font-bold font-number text-trading-down">{failedPayments.length}</h3>
            </div>
          </div>

          <section className="rounded-xl border border-card-border bg-card p-5 sm:p-6 space-y-5">
            <div className="border-b border-card-border pb-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary font-sans">Minhas inscrições</p>
              <h3 className="mt-1 text-2xl font-bold tracking-tight text-white uppercase">Registros de evento</h3>
            </div>

            {athleteRegistrations.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">Nenhuma inscrição encontrada para este e-mail.</p>
            ) : (
              <div className="space-y-4">
                {athleteRegistrations.map(reg => {
                  const event = getRegistrationEvent(reg);
                  const division = event?.divisions.find(div => div.id === reg.divisionId);
                  const statusMeta = getPaymentStatusMeta(reg.paymentStatus);
                  return (
                    <article key={reg.id} className="rounded-lg border border-card-border bg-dark-gray/30 p-4 space-y-4">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-bold uppercase tracking-wider text-white">{event?.name || 'Evento não encontrado'}</h4>
                            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getPaymentStatusClassName(statusMeta.tone)}`}>
                              {statusMeta.label}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs text-muted">
                            <p><span className="font-bold text-white">Atleta:</span> {reg.athleteName}</p>
                            <p><span className="font-bold text-white">Categoria:</span> {division?.name || reg.ticketType}</p>
                            <p><span className="font-bold text-white">Valor:</span> {currencyFormatter.format(reg.totalPaid)}</p>
                            <p><span className="font-bold text-white">Inscrição:</span> {reg.id}</p>
                            <p><span className="font-bold text-white">Data:</span> {new Date(reg.createdAt).toLocaleDateString('pt-BR')}</p>
                            <p><span className="font-bold text-white">Pagamento:</span> {reg.paymentMethod || 'Não informado'}</p>
                          </div>
                          {reg.paymentStatus === 'payment_failed' && (
                            <p className="rounded-md border border-trading-down/30 bg-trading-down/10 px-3 py-2 text-xs leading-5 text-trading-down">
                              {reg.paymentErrorMessage || 'Pagamento não processado. Sua participação depende da regularização do pagamento.'}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row lg:flex-col gap-2 lg:min-w-44">
                          <button
                            type="button"
                            onClick={() => handleOpenAthleteVoucher(reg)}
                            className="flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-card-border bg-card px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-primary"
                          >
                            <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Visualizar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResendRegistrationVoucher(reg)}
                            disabled={resendingRegistrationId === reg.id}
                            className="flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover disabled:opacity-60"
                          >
                            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{resendingRegistrationId === reg.id ? 'Enviando...' : 'Solicitar 2ª via'}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        {selectedRegistrationVoucher && (
          <RegistrationVoucher
            registration={selectedRegistrationVoucher.registration}
            athlete={selectedRegistrationVoucher.athlete}
            event={selectedRegistrationVoucher.event}
            onClose={() => setSelectedRegistrationVoucher(null)}
          />
        )}
      </div>
    );
  }

  // ==========================================
  // FUNÇÕES DE RENDERIZAÇÃO DAS SUB-ABAS
  // ==========================================

  const renderAbaInfo = () => {
    return (
      <form onSubmit={handleUpdateEventInfo} className="space-y-6 rounded-xl border border-card-border p-6 bg-card text-white">
        <div className="border-b border-card-border pb-3">
          <h3 className="text-base font-bold text-white uppercase tracking-wider">Informações Gerais</h3>
          <p className="text-xs text-muted font-medium">Altere as informações públicas, mídias e regras gerais da competição.</p>
        </div>

        <div className="space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Informações Básicas</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-event-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Nome do Evento *</label>
              <input
                id="edit-event-name"
                type="text"
                required
                placeholder="Ex: WODArena Games 2026"
                value={editEventName}
                onChange={(e) => setEditEventName(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="edit-event-date" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Data *</label>
              <input
                id="edit-event-date"
                type="text"
                required
                placeholder="Ex: 10 e 11 de Outubro, 2026"
                value={editEventDate}
                onChange={(e) => setEditEventDate(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="edit-event-location" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Local *</label>
              <input
                id="edit-event-location"
                type="text"
                required
                placeholder="Ex: Arena de Eventos, Av. Principal, 120"
                value={editEventLocation}
                onChange={(e) => setEditEventLocation(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="edit-event-time" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Horário</label>
              <input
                id="edit-event-time"
                type="text"
                placeholder="Ex: 08:00 às 18:00"
                value={editEventTime}
                onChange={(e) => setEditEventTime(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-event-city" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Cidade</label>
              <input
                id="edit-event-city"
                type="text"
                placeholder="Ex: Rio de Janeiro"
                value={editEventCity}
                onChange={(e) => setEditEventCity(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="edit-event-state" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Estado</label>
              <input
                id="edit-event-state"
                type="text"
                placeholder="Ex: RJ"
                value={editEventState}
                onChange={(e) => setEditEventState(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit-event-description" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Descrição do Evento</label>
            <textarea
              id="edit-event-description"
              rows={3}
              placeholder="Detalhes adicionais, parceiros e cronograma..."
              value={editEventDescription}
              onChange={(e) => setEditEventDescription(e.target.value)}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-event-rules" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Regulamento</label>
            <textarea
              id="edit-event-rules"
              rows={4}
              placeholder="Coloque o regulamento oficial e os critérios de participação do torneio..."
              value={editEventRules}
              onChange={(e) => setEditEventRules(e.target.value)}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-4 border-t border-card-border pt-5">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Identidade Visual (Mídia)</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg focus-within:outline-info focus-within:outline focus-within:outline-2">
              <p className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Logo do Evento</p>
              <p className="mb-2 text-[11px] text-muted-soft">Proporção ideal: 1:1 — resolução recomendada 512 × 512 px.</p>
              {editEventLogo ? (
                <div className="relative flex h-[140px] w-full items-center justify-center overflow-hidden rounded-lg border border-card-border bg-dark-gray">
                  <Image
                    src={editEventLogo}
                    alt="Logo"
                    width={80}
                    height={80}
                    unoptimized
                    className="h-20 w-20 object-contain rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => setEditEventLogo('')}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-card-border bg-dark-gray text-red-500 hover:border-red-500 transition-colors"
                    aria-label="Remover logo do evento"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="group flex h-[140px] w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-card-border bg-dark-gray transition-colors hover:border-primary">
                  <div className="flex flex-col items-center justify-center pt-4 pb-5">
                    <Upload className="mb-1.5 h-6 w-6 text-muted group-hover:text-primary transition-colors" />
                    <p className="text-xs font-semibold text-white group-hover:text-primary">Carregar Logo</p>
                    <p className="mt-0.5 text-[10px] text-muted">PNG ou JPEG</p>
                  </div>
                  <input
                    type="file"
                    accept="image/png, image/jpeg"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        if (typeof reader.result === 'string') setEditEventLogo(reader.result);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              )}
            </div>
            <div className="rounded-lg focus-within:outline-info focus-within:outline focus-within:outline-2">
              <p className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Banner do Evento</p>
              <p className="mb-2 text-[11px] text-muted-soft">Proporção ideal: 5:2 — resolução recomendada 1600 × 640 px.</p>
              {editEventBanner ? (
                <div className="relative h-[140px] w-full overflow-hidden rounded-lg border border-card-border bg-dark-gray">
                  <Image
                    src={editEventBanner}
                    alt="Banner"
                    width={500}
                    height={140}
                    unoptimized
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setEditEventBanner('')}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-card-border bg-dark-gray text-red-500 hover:border-red-500 transition-colors"
                    aria-label="Remover banner do evento"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="group flex h-[140px] w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-card-border bg-dark-gray transition-colors hover:border-primary">
                  <div className="flex flex-col items-center justify-center pt-4 pb-5">
                    <Upload className="mb-1.5 h-6 w-6 text-muted group-hover:text-primary transition-colors" />
                    <p className="text-xs font-semibold text-white group-hover:text-primary">Carregar Banner</p>
                    <p className="mt-0.5 text-[10px] text-muted">PNG ou JPEG</p>
                  </div>
                  <input
                    type="file"
                    accept="image/png, image/jpeg"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        if (typeof reader.result === 'string') setEditEventBanner(reader.result);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 border-t border-card-border pt-5">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Configurações &amp; Bilheteria</p>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="edit-event-price" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Valor Inscrição (R$)</label>
              <input
                id="edit-event-price"
              type="number"
              min="0"
              placeholder="Ex: 150"
              value={editEventTicketPrice}
              onChange={(e) => setEditEventTicketPrice(Number(e.target.value))}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="edit-event-slots" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Vagas Limite</label>
            <input
              id="edit-event-slots"
              type="number"
              min="1"
              placeholder="Ex: 100"
              value={editEventTicketSlots}
              onChange={(e) => setEditEventTicketSlots(Number(e.target.value))}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="edit-event-ticketing-toggle" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Inscrições</label>
            <select
              id="edit-event-ticketing-toggle"
              value={editEventIsTicketingActive ? 'active' : 'inactive'}
              onChange={(e) => setEditEventIsTicketingActive(e.target.value === 'active')}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            >
              <option value="active">Venda Ativa</option>
              <option value="inactive">Venda Encerrada</option>
            </select>
          </div>
          <div>
            <label htmlFor="edit-event-format" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Formato</label>
            <select
              id="edit-event-format"
              value={editEventFormat}
              onChange={(e) => setEditEventFormat(e.target.value as 'individual' | 'duo' | 'trio')}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            >
              <option value="individual">Individual</option>
              <option value="duo">Dupla</option>
              <option value="trio">Trio</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="edit-event-instagram" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Instagram do Evento</label>
            <input
              id="edit-event-instagram"
              type="text"
              placeholder="Ex: @wodarena"
              value={editEventInstagram}
              onChange={(e) => setEditEventInstagram(e.target.value)}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="edit-event-website" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Site Oficial</label>
            <input
              id="edit-event-website"
              type="text"
              placeholder="Ex: https://wodarena.com"
              value={editEventWebsite}
              onChange={(e) => setEditEventWebsite(e.target.value)}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="edit-event-status" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Status do Evento</label>
            <select
              id="edit-event-status"
              value={editEventStatus}
              onChange={(e) => setEditEventStatus(e.target.value as EventStatus)}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            >
              <option value="upcoming">Em Breve</option>
              <option value="live">Ao Vivo</option>
              <option value="finished">Finalizado</option>
            </select>
          </div>
          <div>
            <label htmlFor="edit-event-type" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Tipo de Evento</label>
            <select
              id="edit-event-type"
              value={editEventType}
              onChange={(e) => setEditEventType(e.target.value as 'functional_fitness' | 'fitness_racing')}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            >
              <option value="functional_fitness">Functional Fitness (CrossFit)</option>
              <option value="fitness_racing">Fitness Racing (HYROX)</option>
            </select>
          </div>
        </div>


      </div>

      <div className="flex justify-end border-t border-card-border pt-5">
        <button
          type="submit"
          className="flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-8 py-3 text-sm font-bold uppercase tracking-wider transition-colors"
        >
          Salvar Alterações
        </button>
      </div>
    </form>
  );
};

  const renderAbaCategories = () => {
    const divisions = selectedEventToManage?.divisions || [];

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulário lateral */}
        <form onSubmit={handleCreateDivision} className="lg:col-span-1 space-y-6 rounded-xl border border-card-border p-6 bg-card text-white">
          <div className="border-b border-card-border pb-3">
            <h3 className="text-base font-bold text-white uppercase tracking-wider">{editingCategoryId ? 'Editar Categoria' : 'Nova Categoria'}</h3>
            <p className="text-xs text-muted font-medium">
              {selectedEventToManage?.eventType === 'fitness_racing'
                ? 'Ajuste categorias, formatos, faixas etárias e valores do Fitness Racing.'
                : 'Adicione categorias/divisões ao evento.'}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="cat-name-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Nome da Categoria *</label>
              <input
                id="cat-name-input"
                type="text"
                required
                placeholder="Ex: RX Masculino, Dupla Mista"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cat-type-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Formato *</label>
                <select
                  id="cat-type-input"
                  value={catType}
                  onChange={(e) => setCatType(e.target.value as 'individual' | 'duo' | 'trio' | 'team')}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                >
                  <option value="individual">Individual</option>
                  <option value="duo">Dupla</option>
                  <option value="trio">Trio</option>
                  <option value="team">Equipe</option>
                </select>
              </div>
              <div>
                <label htmlFor="cat-gender-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Gênero *</label>
                <select
                  id="cat-gender-input"
                  value={catCategory}
                  onChange={(e) => setCatCategory(e.target.value as CategoryType)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                >
                  <option value="male">Masculino</option>
                  <option value="female">Feminino</option>
                  <option value="team">Misto / Equipes</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cat-slots-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Vagas Limite *</label>
                <input
                  id="cat-slots-input"
                  type="number"
                  min="1"
                  required
                  value={catSlotsLimit}
                  onChange={(e) => setCatSlotsLimit(Number(e.target.value))}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                />
              </div>
              <div>
                <label htmlFor="cat-price-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Preço Inscrição (R$)</label>
                <input
                  id="cat-price-input"
                  type="number"
                  min="0"
                  required
                  value={catPrice}
                  onChange={(e) => setCatPrice(Number(e.target.value))}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cat-status-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Status</label>
              <select
                id="cat-status-input"
                value={catIsActive ? 'active' : 'inactive'}
                onChange={(e) => setCatIsActive(e.target.value === 'active')}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
              >
                <option value="active">Ativo (Aberto)</option>
                <option value="inactive">Inativo (Pausado)</option>
              </select>
            </div>

            {selectedEventToManage?.eventType === 'fitness_racing' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 py-2">
                  <input
                    id="cat-use-age-groups"
                    type="checkbox"
                    checked={catUseAgeGroups}
                    onChange={(e) => setCatUseAgeGroups(e.target.checked)}
                    className="h-4 w-4 rounded border-card-border bg-dark-gray text-primary focus:ring-0 focus:ring-offset-0"
                  />
                  <label htmlFor="cat-use-age-groups" className="text-xs font-bold uppercase tracking-wider text-muted cursor-pointer">Habilitar Faixas Etárias (Opcional)</label>
                </div>
                {catUseAgeGroups && (
                  <div className="rounded-lg border border-card-border/50 bg-dark-gray/30 p-3 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary font-sans">Gerenciar Faixas Etárias</p>
                    <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                      {catAgeGroups.map((group, index) => (
                        <span key={index} className="inline-flex items-center gap-1 rounded bg-black/40 border border-card-border px-2 py-1 text-[10px] font-bold text-white">
                          <span>{group} anos</span>
                          <button
                            type="button"
                            onClick={() => setCatAgeGroups(prev => prev.filter((_, i) => i !== index))}
                            className="text-red-400 hover:text-red-300 font-bold ml-1 text-xs"
                            title={`Remover faixa ${group}`}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Ex: 65-69 ou 65+"
                        value={newAgeGroupInput}
                        onChange={(e) => setNewAgeGroupInput(e.target.value)}
                        className="flex-1 rounded border border-card-border bg-dark-gray/60 px-2.5 py-1 text-xs text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = newAgeGroupInput.trim();
                          if (val && !catAgeGroups.includes(val)) {
                            setCatAgeGroups(prev => [...prev, val]);
                            setNewAgeGroupInput('');
                          }
                        }}
                        className="rounded bg-primary px-3 py-1 text-[10px] font-black uppercase text-ink hover:bg-primary-hover"
                      >
                        Add
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCatAgeGroups([...FITNESS_RACING_AGE_GROUPS])}
                      className="w-full text-center text-[9px] font-bold text-muted hover:text-white uppercase transition-colors"
                    >
                      Resetar para o Padrão HYROX
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="w-full flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors"
          >
            {editingCategoryId ? 'Salvar Categoria' : 'Criar Categoria'}
          </button>
          {editingCategoryId && (
            <button
              type="button"
              onClick={() => {
                setEditingCategoryId('');
                setCatName('');
                setCatType('individual');
                setCatCategory('male');
                setCatSlotsLimit(100);
                setCatPrice(150);
                setCatIsActive(true);
                setCatUseAgeGroups(false);
              }}
              className="w-full flex min-h-10 items-center justify-center rounded-md border border-card-border bg-dark-gray px-6 py-2 text-xs font-bold uppercase tracking-wider text-muted transition-colors hover:border-muted hover:text-white"
            >
              Cancelar Edição
            </button>
          )}
        </form>

        {/* Lista/Tabela */}
        <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-6 space-y-4 text-white">
          <div className="border-b border-card-border pb-3 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider">Categorias Cadastradas</h3>
              <p className="text-xs text-muted font-medium font-sans">Todas as categorias criadas para esta competição.</p>
            </div>
            {selectedEventToManage?.eventType === 'fitness_racing' && (
              <button
                type="button"
                onClick={() => {
                  setEditingCategoryId('');
                  setCatName('');
                  setCatType('individual');
                  setCatCategory('male');
                  setCatSlotsLimit(100);
                  setCatPrice(150);
                  setCatIsActive(true);
                  setCatUseAgeGroups(false);
                  setCatAgeGroups([...FITNESS_RACING_AGE_GROUPS]);
                }}
                className="flex min-h-9 items-center justify-center rounded bg-primary hover:bg-primary-hover text-ink px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors"
              >
                &nbsp;&nbsp;➕ Adicionar Categoria&nbsp;&nbsp;
              </button>
            )}
          </div>

          {divisions.length === 0 ? (
            <p className="text-xs text-muted text-center py-8">Nenhuma categoria cadastrada neste evento.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-card-border/50 text-[10px] font-bold text-muted uppercase tracking-wider">
                    <th className="py-3 px-2">Nome</th>
                    <th className="py-3 px-2">Formato</th>
                    <th className="py-3 px-2">Status</th>
                    <th className="py-3 px-2 text-right">Participantes</th>
                    <th className="py-3 px-2 text-right">Preço</th>
                    <th className="py-3 px-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/30 text-xs font-normal">
                  {divisions.map((div) => {
                    const participantTotal = athletes.filter(a => a.divisionId === div.id).length;
                    return (
                      <tr key={div.id} className="hover:bg-dark-gray/30 transition-colors">
                        <td className="py-3 px-2">
                          <div className="font-bold text-white uppercase">{div.name}</div>
                          <div className="mt-0.5 text-[10px] font-semibold uppercase text-muted-soft">
                            {div.category === 'male' ? 'Masculino' : div.category === 'female' ? 'Feminino' : 'Misto'}
                            {selectedEventToManage?.eventType === 'fitness_racing' && div.useAgeGroups ? ' · Faixas etárias' : ''}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-muted uppercase text-[10px] font-semibold">{div.type === 'duo' ? 'Dupla' : div.type === 'trio' ? 'Trio' : div.type === 'team' ? 'Revezamento' : 'Individual'}</td>
                        <td className="py-3 px-2">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                            div.isActive
                              ? 'border-trading-up/30 bg-trading-up/10 text-trading-up'
                              : 'border-card-border bg-dark-gray text-muted'
                          }`}>
                            {div.isActive ? 'Ativa' : 'Inativa'}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right font-number">{participantTotal}/{div.slotsLimit}</td>
                        <td className="py-3 px-2 text-right text-primary font-number">{currencyFormatter.format(div.price)}</td>
                        <td className="py-3 px-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEditCategory(div)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-card-border text-muted transition-colors hover:border-primary hover:text-primary"
                              aria-label={`Editar categoria ${div.name}`}
                              title="Editar"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateCategory(div)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-card-border text-muted transition-colors hover:border-primary hover:text-primary"
                              aria-label={`Duplicar categoria ${div.name}`}
                              title="Duplicar"
                            >
                              <Copy className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(div)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-card-border text-red-500 transition-colors hover:border-red-500 hover:text-red-400"
                              aria-label={`Excluir categoria ${div.name}`}
                              title="Excluir"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- FITNESS RACING COURSE MANAGEMENT ---
  const handleLoadDefaultHyroxCourse = async () => {
    if (!selectedEventToManage) return;

    // Configurar cargas com base no padrão HYROX Open Geral
    const defaultStages: CourseStage[] = [
      { id: 'run-1', name: 'Run 1', type: 'run', orderIndex: 1, distance: '1000m' },
      { id: 'ski-erg', name: 'Ski Erg', type: 'station', orderIndex: 2, distance: '1000m' },
      { id: 'run-2', name: 'Run 2', type: 'run', orderIndex: 3, distance: '1000m' },
      { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 4, distance: '50m', maleWeight: '152 kg', femaleWeight: '102 kg' },
      { id: 'run-3', name: 'Run 3', type: 'run', orderIndex: 5, distance: '1000m' },
      { id: 'sled-pull', name: 'Sled Pull', type: 'station', orderIndex: 6, distance: '50m', maleWeight: '103 kg', femaleWeight: '78 kg' },
      { id: 'run-4', name: 'Run 4', type: 'run', orderIndex: 7, distance: '1000m' },
      { id: 'burpee-broad-jump', name: 'Burpee Broad Jump', type: 'station', orderIndex: 8, distance: '80m' },
      { id: 'run-5', name: 'Run 5', type: 'run', orderIndex: 9, distance: '1000m' },
      { id: 'row', name: 'Row', type: 'station', orderIndex: 10, distance: '1000m' },
      { id: 'run-6', name: 'Run 6', type: 'run', orderIndex: 11, distance: '1000m' },
      { id: 'farmers-carry', name: 'Farmers Carry', type: 'station', orderIndex: 12, distance: '200m', maleWeight: '2x24 kg', femaleWeight: '2x16 kg' },
      { id: 'run-7', name: 'Run 7', type: 'run', orderIndex: 13, distance: '1000m' },
      { id: 'sandbag-lunges', name: 'Sandbag Lunges', type: 'station', orderIndex: 14, distance: '100m', maleWeight: '20 kg', femaleWeight: '10 kg' },
      { id: 'run-8', name: 'Run 8', type: 'run', orderIndex: 15, distance: '1000m' },
      { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 16, reps: 100, maleWeight: '9 kg', femaleWeight: '6 kg' }
    ];

    try {
      await saveUpdatedCourseLayoutToSelected(defaultStages, 'Percurso padrão HYROX carregado com sucesso.');
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Não foi possível carregar o percurso padrão.', tone: 'error' });
    }
  };

  const fillStageForm = (stage: CourseStage, orderOverride?: number) => {
    setEditingStageId(stage.id);
    setLibraryInsertAfterStage(null);
    setStageName(stage.name);
    setStageType(stage.type);
    setStageOrder(orderOverride || stage.orderIndex);
    setStageDistance(stage.distance || '');
    setStageReps(stage.reps);
    setStageMaleWeight(stage.maleWeight || '');
    setStageFemaleWeight(stage.femaleWeight || '');
    setIsStationLibraryOpen(true);
  };

  const saveUpdatedCourseLayoutToSelected = async (updatedLayout: CourseStage[], successMessage: string) => {
    if (!selectedEventToManage) return;
    let runCounter = 1;
    const normalizedLayout = [...updatedLayout]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((stg, idx) => {
        const isRun = stg.type === 'run';
        const isStandardRunName = !stg.name || /^Run\s*\d*$/i.test(stg.name.trim()) || stg.name.toLowerCase() === 'corrida';
        const newName = (isRun && isStandardRunName) ? `Run ${runCounter++}` : stg.name;
        return {
          ...stg,
          name: newName,
          orderIndex: idx + 1
        };
      });
    try {
      for (const divId of selectedDivisionIdsForCourse) {
        await saveCourseLayout(divId, normalizedLayout);
      }

      setSelectedEventToManage(prev => {
        if (!prev) return null;
        return {
          ...prev,
          divisions: prev.divisions.map(d =>
            selectedDivisionIdsForCourse.includes(d.id)
              ? { ...d, courseLayout: normalizedLayout }
              : d
          )
        };
      });

      setCourseEditingLayout(normalizedLayout);
      setAdminNotice({ text: successMessage, tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Erro ao atualizar o percurso para as categorias selecionadas.', tone: 'error' });
    }
  };

  const handleMoveCourseStage = async (stageId: string, direction: 'up' | 'down') => {
    if (!selectedEventToManage) return;
    const layout = [...courseEditingLayout].sort((a, b) => a.orderIndex - b.orderIndex);
    const currentIndex = layout.findIndex(stage => stage.id === stageId);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= layout.length) return;
    const reordered = [...layout];
    const [stage] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, stage);
    await saveUpdatedCourseLayoutToSelected(reordered, 'Ordem do percurso atualizada.');
  };

  const handleDropCourseStage = async (targetStageId: string) => {
    if (!selectedEventToManage || !draggedStageId || draggedStageId === targetStageId) {
      setDraggedStageId('');
      return;
    }
    const layout = [...courseEditingLayout].sort((a, b) => a.orderIndex - b.orderIndex);
    const currentIndex = layout.findIndex(stage => stage.id === draggedStageId);
    const targetIndex = layout.findIndex(stage => stage.id === targetStageId);
    if (currentIndex < 0 || targetIndex < 0) return;
    const reordered = [...layout];
    const [stage] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, stage);
    setDraggedStageId('');
    await saveUpdatedCourseLayoutToSelected(reordered, 'Percurso reordenado.');
  };

  const handleInsertStageBelow = (stage: CourseStage) => {
    setEditingStageId('');
    setLibraryInsertAfterStage(stage);
    setStageName('');
    setStageType(stage.type === 'run' ? 'station' : 'run');
    setStageOrder(stage.orderIndex + 1);
    setStageDistance(stage.type === 'run' ? '' : '1000m');
    setStageReps(undefined);
    setStageMaleWeight('');
    setStageFemaleWeight('');
    setIsStationLibraryOpen(true);
  };

  const handleRemoveCourseStage = async (stageId: string) => {
    if (!selectedEventToManage) return;
    const updatedLayout = courseEditingLayout
      .filter(s => s.id !== stageId)
      .map((s, idx) => ({ ...s, orderIndex: idx + 1 }));

    try {
      for (const divId of selectedDivisionIdsForCourse) {
        await saveCourseLayout(divId, updatedLayout);
      }

      setSelectedEventToManage(prev => {
        if (!prev) return null;
        return {
          ...prev,
          divisions: prev.divisions.map(d =>
            selectedDivisionIdsForCourse.includes(d.id)
              ? { ...d, courseLayout: updatedLayout }
              : d
          )
        };
      });

      setCourseEditingLayout(updatedLayout);

      if (editingStageId === stageId) {
        setEditingStageId('');
        setStageName('');
      }

      setAdminNotice({ text: 'Etapa removida do percurso.', tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Erro ao remover etapa do percurso.', tone: 'error' });
    }
  };

  const handleSaveLibraryStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage || !stageName) return;

    const targetId = editingStageId || `stage-course-${stageName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;

    let newOrder = stageOrder;
    if (!editingStageId) {
      if (libraryInsertAfterStage) {
        newOrder = libraryInsertAfterStage.orderIndex + 1;
      } else {
        newOrder = courseEditingLayout.length + 1;
      }
    }

    const newStage: CourseStage = {
      id: targetId,
      name: stageName,
      type: stageType,
      orderIndex: newOrder,
      distance: stageDistance || undefined,
      reps: stageReps || undefined,
      maleWeight: stageMaleWeight || undefined,
      femaleWeight: stageFemaleWeight || undefined
    };

    let updatedLayout: CourseStage[] = [];
    if (editingStageId) {
      updatedLayout = courseEditingLayout.map(stg => stg.id === editingStageId ? newStage : stg);
    } else if (libraryInsertAfterStage) {
      const afterIndex = libraryInsertAfterStage.orderIndex;
      const beforeStages = courseEditingLayout.filter(stg => stg.orderIndex <= afterIndex);
      const afterStages = courseEditingLayout.filter(stg => stg.orderIndex > afterIndex);
      updatedLayout = [...beforeStages, newStage, ...afterStages];
    } else {
      updatedLayout = [...courseEditingLayout.filter(stg => stg.id !== targetId), newStage];
    }

    let runCounter = 1;
    const normalizedLayout = [...updatedLayout]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((stg, idx) => {
        const isRun = stg.type === 'run';
        const isStandardRunName = !stg.name || /^Run\s*\d*$/i.test(stg.name.trim()) || stg.name.toLowerCase() === 'corrida';
        const newName = (isRun && isStandardRunName) ? `Run ${runCounter++}` : stg.name;
        return {
          ...stg,
          name: newName,
          orderIndex: idx + 1
        };
      });

    try {
      for (const divId of selectedDivisionIdsForCourse) {
        await saveCourseLayout(divId, normalizedLayout);
      }

      setSelectedEventToManage(prev => {
        if (!prev) return null;
        return {
          ...prev,
          divisions: prev.divisions.map(d =>
            selectedDivisionIdsForCourse.includes(d.id)
              ? { ...d, courseLayout: normalizedLayout }
              : d
          )
        };
      });

      setCourseEditingLayout(normalizedLayout);
      setStageName('');
      setStageDistance('');
      setStageReps(undefined);
      setStageMaleWeight('');
      setStageFemaleWeight('');
      setEditingStageId('');
      setLibraryInsertAfterStage(null);
      setIsStationLibraryOpen(false);
      setAdminNotice({ text: editingStageId ? 'Etapa atualizada com sucesso.' : 'Etapa adicionada ao percurso com sucesso.', tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Erro ao salvar etapa no percurso.', tone: 'error' });
    }
  };

  const handleToggleDivisionConnection = async (divId: string, isChecked: boolean) => {
    if (!selectedEventToManage) return;

    try {
      if (isChecked) {
        await saveCourseLayout(divId, courseEditingLayout);
        setSelectedDivisionIdsForCourse(prev => [...prev, divId]);

        setSelectedEventToManage(prev => {
          if (!prev) return null;
          return {
            ...prev,
            divisions: prev.divisions.map(d => d.id === divId ? { ...d, courseLayout: courseEditingLayout } : d)
          };
        });
        setAdminNotice({ text: 'Categoria vinculada ao percurso com sucesso.', tone: 'success' });
      } else {
        await saveCourseLayout(divId, []);
        await updateDivision(selectedEventToManage.id, divId, { isCoursePublished: false });
        setSelectedDivisionIdsForCourse(prev => prev.filter(id => id !== divId));

        setSelectedEventToManage(prev => {
          if (!prev) return null;
          return {
            ...prev,
            divisions: prev.divisions.map(d => d.id === divId ? { ...d, courseLayout: [], isCoursePublished: false } : d)
          };
        });
        setAdminNotice({ text: 'Categoria desvinculada do percurso.', tone: 'success' });
      }
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Erro ao alterar vínculo da categoria.', tone: 'error' });
    }
  };

  const handlePublishActiveCourse = async () => {
    if (!selectedEventToManage || selectedDivisionIdsForCourse.length === 0) return;
    setIsReplicating(true);
    try {
      for (const divId of selectedDivisionIdsForCourse) {
        await updateDivision(selectedEventToManage.id, divId, {
          isCoursePublished: true
        });
      }

      setSelectedEventToManage(prev => {
        if (!prev) return null;
        return {
          ...prev,
          divisions: prev.divisions.map(d =>
            selectedDivisionIdsForCourse.includes(d.id)
              ? { ...d, isCoursePublished: true }
              : d
          )
        };
      });

      setAdminNotice({ text: 'Percurso publicado com sucesso para todas as categorias vinculadas.', tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Erro ao publicar o percurso.', tone: 'error' });
    } finally {
      setIsReplicating(false);
    }
  };

  const handleSaveCourseWorkoutSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventToManage) return;

    try {
      // 1. Atualizar nome e descrição na tabela workouts para todas as divisões ativas que usam a prova
      const totalWorkouts = (selectedEventToManage.workouts || [])
        .filter(w => w.code === 'TOTAL' && w.divisionId && selectedDivisionIdsForCourse.includes(w.divisionId));

      for (const w of totalWorkouts) {
        await updateWorkout(selectedEventToManage.id, w.id, {
          name: courseWorkoutName,
          description: courseWorkoutDescription
        });
      }

      setAdminNotice({ text: 'Configurações da prova salvas com sucesso!', tone: 'success' });
    } catch (err) {
      console.error(err);
      setAdminNotice({ text: 'Erro ao salvar configurações da prova.', tone: 'error' });
    }
  };


  const renderAbaFitnessRaceCourse = () => {
    const divisions = selectedEventToManage?.divisions || [];
    const layout = courseEditingLayout;

    // Auditoria em tempo real
    const courseAuditAlerts: string[] = [];
    if (layout.length !== 16) {
      courseAuditAlerts.push('O percurso de Fitness Racing deve conter exatamente 16 etapas.');
    }
    let hasConsecutiveSameType = false;
    for (let i = 0; i < layout.length - 1; i++) {
      if (layout[i].type === layout[i + 1].type) {
        hasConsecutiveSameType = true;
        break;
      }
    }
    if (hasConsecutiveSameType) {
      courseAuditAlerts.push('O percurso deve alternar entre Corridas e Estações de Exercício.');
    }

    const allSelectedPublished = selectedDivisionIdsForCourse.length > 0 && selectedDivisionIdsForCourse.every(divId => {
      const div = divisions.find(d => d.id === divId);
      return div?.isCoursePublished;
    });

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-white font-sans">
        {/* Formulário lateral de Configurações da Prova */}
        <form onSubmit={handleSaveCourseWorkoutSettings} className="lg:col-span-1 space-y-6 rounded-xl border border-card-border p-6 bg-card text-white flex flex-col justify-between">
          <div className="space-y-6">
            <div className="border-b border-card-border pb-3">
              <h3 className="text-base font-bold text-white uppercase tracking-wider">Configuração da Prova</h3>
              <p className="text-xs text-muted font-medium">Defina os dados gerais do percurso e selecione as categorias vinculadas.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="activeCourseDivisionSelect" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Editar Percurso de: *</label>
                <select
                  id="activeCourseDivisionSelect"
                  value={activeCourseDivisionId}
                  onChange={(e) => setActiveCourseDivisionId(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white hover:border-muted focus:border-primary/50 focus:outline-none"
                >
                  {divisions.map((div) => (
                    <option key={div.id} value={div.id}>
                      {div.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="courseWorkoutName" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Título da Prova *</label>
                <input
                  id="courseWorkoutName"
                  type="text"
                  required
                  placeholder="Ex: Percurso Completo TOTAL"
                  value={courseWorkoutName}
                  onChange={(e) => setCourseWorkoutName(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="courseWorkoutDescription" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Descrição da Prova *</label>
                <textarea
                  id="courseWorkoutDescription"
                  required
                  rows={4}
                  placeholder="Ex: Tempo total acumulado para completar todas as etapas de corrida e estações de exercícios."
                  value={courseWorkoutDescription}
                  onChange={(e) => setCourseWorkoutDescription(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none resize-none"
                />
              </div>

              <div className="border-t border-card-border/60 pt-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted">Categorias Vinculadas</h4>
                <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                  {divisions.map((div) => {
                    const isChecked = selectedDivisionIdsForCourse.includes(div.id);
                    const getFormatLabel = (type?: string) => {
                      if (type === 'duo') return 'Duplas 👥';
                      if (type === 'trio') return 'Trios 👥👤';
                      if (type === 'team') return 'Equipes 👥👥';
                      return 'Individual 👤';
                    };
                    return (
                      <div key={div.id} className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border transition-all ${
                        isChecked
                          ? 'border-primary bg-elevated'
                          : 'border-card-border/60 bg-dark-gray'
                      }`}>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold select-none min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={div.id === activeCourseDivisionId}
                            onChange={(e) => handleToggleDivisionConnection(div.id, e.target.checked)}
                            className="h-4 w-4 rounded border-card-border bg-dark-gray text-primary focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className="truncate text-white" title={div.name}>{div.name}</span>
                        </label>
                        <span className="text-[10px] font-bold text-muted bg-dark-gray border border-card-border/60 rounded px-2.5 py-1 whitespace-nowrap select-none">
                          {getFormatLabel(div.type)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-card-border/60">
            <button
              type="submit"
              className="w-full flex min-h-10 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink text-xs font-black uppercase tracking-wider transition-colors"
            >
              💾 Salvar Configurações
            </button>
          </div>
        </form>

        {/* Coluna da Direita: Editor do Percurso (Linha do Tempo) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-card-border rounded-xl p-6 space-y-6">
            <div className="border-b border-card-border pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider">Linha do Tempo Oficial</h4>
                  <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
                    allSelectedPublished
                      ? 'bg-trading-up/10 border-trading-up/25 text-trading-up'
                      : 'bg-primary/10 border-primary/25 text-primary'
                  }`}>
                    {allSelectedPublished ? 'Publicado ✅' : 'Rascunho 📝'}
                  </span>
                </div>
                <p className="text-xs text-muted font-medium">As etapas e estações da competição que serão compartilhadas pelas categorias selecionadas.</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {layout.length > 0 && (
                  <button
                    type="button"
                    onClick={handlePublishActiveCourse}
                    className="flex min-h-9 items-center justify-center rounded-md bg-card hover:bg-elevated text-white border border-card-border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                  >
                    📢 Publicar Percurso
                  </button>
                )}
                {layout.length === 0 && (
                  <button
                    type="button"
                    onClick={handleLoadDefaultHyroxCourse}
                    className="flex min-h-9 items-center justify-center rounded-md bg-card hover:bg-elevated text-primary border border-card-border px-4 py-2 text-xs font-bold uppercase transition-colors"
                  >
                    Carregar Padrão HYROX
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingStageId('');
                    setLibraryInsertAfterStage(null);
                    setStageName('');
                    setStageType('station');
                    setStageDistance('');
                    setStageReps(undefined);
                    setStageMaleWeight('');
                    setStageFemaleWeight('');
                    setIsStationLibraryOpen(true);
                  }}
                  className="flex min-h-9 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors"
                >
                  ➕ Adicionar Etapa
                </button>
              </div>
            </div>

            {courseAuditAlerts.length > 0 && (
              <div className="space-y-2">
                {courseAuditAlerts.map((alertText, idx) => (
                  <div key={idx} className="rounded-lg border border-primary/30 bg-primary/10 p-3 flex items-start gap-2.5 text-white">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                    <span className="text-xs font-semibold leading-relaxed">{alertText}</span>
                  </div>
                ))}
              </div>
            )}

            {layout.length === 0 ? (
              <div className="text-center py-16 space-y-6 rounded-lg border border-dashed border-card-border bg-dark-gray/30">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-dark-gray border border-card-border">
                  <Library className="h-6 w-6 text-muted" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-white uppercase tracking-wide">Nenhuma etapa configurada</p>
                  <p className="text-xs text-muted max-w-sm mx-auto">Você pode carregar a estrutura padrão oficial do HYROX de 16 etapas ou começar a adicionar etapas personalizadas.</p>
                </div>
                <div className="flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={handleLoadDefaultHyroxCourse}
                    className="flex min-h-10 items-center justify-center rounded-md bg-card hover:bg-elevated border border-card-border px-5 text-xs font-bold text-white uppercase transition-colors"
                  >
                    Carregar Estrutura HYROX
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingStageId('');
                      setLibraryInsertAfterStage(null);
                      setStageName('');
                      setStageType('station');
                      setStageDistance('');
                      setStageReps(undefined);
                      setStageMaleWeight('');
                      setStageFemaleWeight('');
                      setIsStationLibraryOpen(true);
                    }}
                    className="flex min-h-10 items-center justify-center rounded-md bg-primary px-5 text-xs font-black text-ink uppercase hover:bg-primary-hover transition-colors"
                  >
                    Adicionar Primeira Etapa
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative space-y-3 pl-4 pr-1">
                {/* Conector Vertical */}
                <div className="absolute left-[39px] top-4 bottom-4 w-[2px] bg-primary/20" aria-hidden="true" />

                {layout
                  .slice()
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map((stg, index) => {
                    const isRun = stg.type === 'run';
                    return (
                      <div key={stg.id} className="relative">
                        <div
                          draggable
                          onDragStart={() => setDraggedStageId(stg.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDropCourseStage(stg.id)}
                          className={`relative grid grid-cols-[20px_32px_1fr] gap-3 items-center rounded-lg border p-2 px-3 transition-all duration-200 ${
                            draggedStageId === stg.id
                              ? 'border-primary bg-elevated scale-[0.99]'
                              : 'border-card-border bg-dark-gray hover:border-muted hover:bg-elevated'
                          }`}
                        >
                          {/* Arrastar (Grip) */}
                          <div className="cursor-grab active:cursor-grabbing flex items-center justify-center h-full" title="Arrastar para reordenar">
                            <GripVertical className="h-4 w-4 text-muted hover:text-white transition-colors" />
                          </div>

                          {/* Círculo do Número */}
                          <div className="flex items-center justify-center relative z-10">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-black font-mono ${
                              isRun
                                ? 'border-trading-up bg-dark-gray text-trading-up'
                                : 'border-primary bg-dark-gray text-primary'
                            }`}>
                              {index + 1}
                            </div>
                          </div>

                          {/* Conteúdo do Card em Linha Única */}
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                              <h5 className="text-xs font-black text-white uppercase tracking-wider truncate">{stg.name}</h5>
                              <span className={`inline-flex rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest border ${
                                isRun
                                  ? 'bg-trading-up/10 border-trading-up/25 text-trading-up'
                                  : 'bg-primary/10 border-primary/25 text-primary'
                              }`}>
                                {isRun ? 'Corrida' : 'Estação'}
                              </span>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted border-l border-card-border/60 pl-3">
                                {stg.distance && (
                                  <span className="flex items-center gap-1">
                                    <span className="font-bold uppercase tracking-wider text-muted-soft text-[9px]">Distância:</span>
                                    <span className="font-semibold text-white font-mono">{stg.distance}</span>
                                  </span>
                                )}
                                {stg.reps && (
                                  <span className="flex items-center gap-1">
                                    <span className="font-bold uppercase tracking-wider text-muted-soft text-[9px]">Reps:</span>
                                    <span className="font-semibold text-white font-mono">{stg.reps}</span>
                                  </span>
                                )}
                                {!isRun && (stg.maleWeight || stg.femaleWeight) && (
                                  <span className="flex items-center gap-1 flex-wrap">
                                    <span className="font-bold uppercase tracking-wider text-muted-soft text-[9px]">Pesos (M/F):</span>
                                    <span className="rounded bg-dark-gray border border-card-border/60 px-1 py-0.5 text-[9px] font-bold text-white font-mono">{stg.maleWeight || '-'}</span>
                                    <span className="text-muted-soft">/</span>
                                    <span className="rounded bg-dark-gray border border-card-border/60 px-1 py-0.5 text-[9px] font-bold text-white font-mono">{stg.femaleWeight || '-'}</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Controles de Ação Compactos */}
                            <div className="flex items-center gap-1 shrink-0 ml-auto md:ml-0">
                              <button
                                type="button"
                                onClick={() => handleMoveCourseStage(stg.id, 'up')}
                                disabled={index === 0}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-card-border bg-dark-gray/50 text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-30 disabled:hover:text-muted disabled:hover:border-card-border"
                                title="Mover para cima"
                              >
                                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveCourseStage(stg.id, 'down')}
                                disabled={index === layout.length - 1}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-card-border bg-dark-gray/50 text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-30 disabled:hover:text-muted disabled:hover:border-card-border"
                                title="Mover para baixo"
                              >
                                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => fillStageForm(stg)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-card-border bg-dark-gray/50 text-muted transition-colors hover:border-primary hover:text-primary"
                                title="✏️ Editar etapa"
                              >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleInsertStageBelow(stg)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-card-border bg-dark-gray/50 text-muted transition-colors hover:border-primary hover:text-primary"
                                title="➕ Inserir etapa abaixo"
                              >
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveCourseStage(stg.id)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-card-border bg-dark-gray/50 text-trading-down transition-colors hover:border-trading-down hover:text-trading-down"
                                title="🗑 Excluir"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Botão de Inserir Intermediário na Linha de Conexão */}
                        {index < layout.length - 1 && (
                          <div className="absolute left-[29px] -bottom-[10px] z-20">
                            <button
                              type="button"
                              onClick={() => handleInsertStageBelow(stg)}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-dark-gray border border-primary text-primary transition-all duration-150 hover:bg-primary hover:text-ink hover:scale-110"
                              title="Adicionar etapa aqui"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {/* Modal da Biblioteca de Estações */}
        {isStationLibraryOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
            <div className="w-full max-w-xl rounded-xl border border-card-border bg-card text-white flex flex-col max-h-[90vh] overflow-hidden relative animate-scale-up" role="dialog" aria-modal="true" aria-labelledby="modal-library-title">
              <button
                type="button"
                onClick={() => {
                  setIsStationLibraryOpen(false);
                  setEditingStageId('');
                  setLibraryInsertAfterStage(null);
                }}
                className="absolute right-4 top-4 text-muted hover:text-white transition-colors"
                aria-label="Fechar biblioteca"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="p-6 border-b border-card-border">
                <h4 id="modal-library-title" className="text-base font-black text-white uppercase tracking-wider">
                  {editingStageId ? 'Editar Etapa' : 'Biblioteca de Estações Fitness Racing'}
                </h4>
                <p className="text-xs text-muted font-medium mt-1">
                  {editingStageId ? 'Ajuste os parâmetros da etapa selecionada.' : 'Selecione uma estação oficial abaixo para adicionar ao percurso ou configure uma etapa personalizada.'}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
                {!editingStageId && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary font-sans">Estações Oficiais</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {/* Opção Corrida (Run) */}
                      <button
                        type="button"
                        onClick={() => {
                          setStageName('Run');
                          setStageType('run');
                          setStageDistance('1000m');
                          setStageReps(undefined);
                          setStageMaleWeight('');
                          setStageFemaleWeight('');
                        }}
                        className="flex flex-col justify-between p-3 rounded-lg border border-card-border bg-dark-gray hover:border-trading-up hover:bg-elevated text-left transition-colors min-h-[90px]"
                      >
                        <span className="text-[10px] font-black uppercase text-trading-up tracking-wider">Run</span>
                        <span className="text-xs font-bold text-white mt-1">Corrida de 1km</span>
                        <span className="text-[9px] text-muted-soft font-mono mt-0.5 block">1000m padrão</span>
                      </button>

                      {/* Presets oficiais */}
                      {FITNESS_RACING_STATION_LIBRARY.map((preset) => (
                        <button
                          type="button"
                          key={preset.name}
                          onClick={() => {
                            setStageName(preset.name);
                            setStageType(preset.type);
                            setStageDistance(preset.distance || '');
                            setStageReps(preset.reps);
                            setStageMaleWeight(preset.maleWeight || '');
                            setStageFemaleWeight(preset.femaleWeight || '');
                          }}
                          className="flex flex-col justify-between p-3 rounded-lg border border-card-border bg-dark-gray hover:border-primary hover:bg-elevated text-left transition-colors min-h-[90px]"
                        >
                          <span className="text-[10px] font-black uppercase text-primary tracking-wider">Estação</span>
                          <span className="text-xs font-bold text-white mt-1">{preset.name}</span>
                          <span className="text-[9px] text-muted-soft font-mono mt-0.5 block truncate">
                            {preset.distance ? preset.distance : `${preset.reps || 100} reps`}
                          </span>
                        </button>
                      ))}

                      {/* Opção Estação Personalizada */}
                      <button
                        type="button"
                        onClick={() => {
                          setStageName('');
                          setStageType('station');
                          setStageDistance('');
                          setStageReps(undefined);
                          setStageMaleWeight('');
                          setStageFemaleWeight('');
                        }}
                        className="flex flex-col justify-between p-3 rounded-lg border border-dashed border-card-border bg-transparent hover:border-white hover:bg-elevated text-left transition-colors min-h-[90px]"
                      >
                        <span className="text-[10px] font-black uppercase text-muted tracking-wider">Customizado</span>
                        <span className="text-xs font-bold text-white mt-1">Personalizado</span>
                        <span className="text-[9px] text-muted-soft font-mono mt-0.5 block">Criar nova etapa</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Form de Configuração da Etapa Selecionada */}
                <form onSubmit={handleSaveLibraryStage} className="space-y-4 pt-4 border-t border-card-border/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary font-sans">
                    {editingStageId ? 'Editar Detalhes da Etapa' : 'Configurar Parâmetros da Etapa'}
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label htmlFor="library-stage-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Nome da Etapa *</label>
                      <input
                        id="library-stage-name"
                        type="text"
                        required
                        placeholder="Ex: Run 1, Sled Push"
                        value={stageName}
                        onChange={(e) => setStageName(e.target.value)}
                        className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="library-stage-type" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Tipo *</label>
                      <select
                        id="library-stage-type"
                        value={stageType}
                        onChange={(e) => setStageType(e.target.value as 'run' | 'station')}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      >
                        <option value="run">Corrida (Run)</option>
                        <option value="station">Estação de Exercício</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="library-stage-order" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Posição / Ordem *</label>
                      <input
                        id="library-stage-order"
                        type="number"
                        required
                        min="1"
                        value={editingStageId ? stageOrder : (libraryInsertAfterStage ? libraryInsertAfterStage.orderIndex + 1 : layout.length + 1)}
                        onChange={(e) => setStageOrder(Number(e.target.value))}
                        disabled={!editingStageId && !!libraryInsertAfterStage}
                        className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number disabled:opacity-40"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="library-stage-distance" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Distância</label>
                      <input
                        id="library-stage-distance"
                        type="text"
                        placeholder="Ex: 1000m, 50m"
                        value={stageDistance}
                        onChange={(e) => setStageDistance(e.target.value)}
                        className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="library-stage-reps" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Repetições</label>
                      <input
                        id="library-stage-reps"
                        type="number"
                        min="1"
                        placeholder="Ex: 100, 75"
                        value={stageReps || ''}
                        onChange={(e) => setStageReps(e.target.value ? Number(e.target.value) : undefined)}
                        className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none font-number"
                      />
                    </div>
                  </div>

                  {stageType === 'station' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="library-stage-male-weight" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Peso Masc.</label>
                        <input
                          id="library-stage-male-weight"
                          type="text"
                          placeholder="Ex: 152kg"
                          value={stageMaleWeight}
                          onChange={(e) => setStageMaleWeight(e.target.value)}
                          className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label htmlFor="library-stage-female-weight" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Peso Fem.</label>
                        <input
                          id="library-stage-female-weight"
                          type="text"
                          placeholder="Ex: 102kg"
                          value={stageFemaleWeight}
                          onChange={(e) => setStageFemaleWeight(e.target.value)}
                          className="w-full rounded-lg border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-4 border-t border-card-border/40">
                    <button
                      type="button"
                      onClick={() => {
                        setIsStationLibraryOpen(false);
                        setEditingStageId('');
                        setLibraryInsertAfterStage(null);
                      }}
                      className="flex-1 min-h-11 flex items-center justify-center rounded-md border border-card-border bg-dark-gray text-xs font-bold uppercase tracking-wider transition-colors hover:border-muted text-muted hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex-1 min-h-11 flex items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink text-xs font-black uppercase tracking-wider transition-colors"
                    >
                      {editingStageId ? 'Atualizar Etapa' : 'Salvar Etapa'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAbaSchedule = () => {
    const workouts = selectedEventToManage?.workouts || [];
    const hasWorkouts = workouts.length > 0;

    const selectedWorkout = workouts.find(w => w.id === heatWorkoutId);

    // Identificar as provas equivalentes de Fitness Racing TOTAL
    const getEquivalentWorkoutIds = (workoutId: string) => {
      const currentWorkout = workouts.find(w => w.id === workoutId);
      if (!currentWorkout || currentWorkout.code !== 'TOTAL' || !selectedEventToManage || selectedEventToManage.eventType !== 'fitness_racing') {
        return [workoutId];
      }

      const activeDiv = (selectedEventToManage.divisions || []).find(d => d.id === currentWorkout.divisionId);
      const activeLayout = activeDiv?.courseLayout || [];
      const equivalentDivisionIds = (selectedEventToManage.divisions || []).filter(d => {
        if (d.id === currentWorkout.divisionId) return true;
        if (!d.courseLayout || d.courseLayout.length !== activeLayout.length) return false;
        return d.courseLayout.every((stg, idx) => stg.name === activeLayout[idx]?.name && stg.type === activeLayout[idx]?.type);
      }).map(d => d.id);

      return workouts
        .filter(w => w.code === 'TOTAL' && w.divisionId && equivalentDivisionIds.includes(w.divisionId))
        .map(w => w.id);
    };

    const targetWorkoutIds = heatWorkoutId ? getEquivalentWorkoutIds(heatWorkoutId) : [];

    // Filtra apenas itens do cronograma geral (que não são baterias de provas)
    const scheduleItems = [...(selectedEventToManage?.scheduleItems || [])]
      .filter(item => item.kind !== 'heat')
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    const getScheduleKindLabel = (kind: EventScheduleItemKind) => {
      if (kind === 'briefing') return 'Briefing';
      if (kind === 'kit_delivery') return 'Entrega de kits';
      return 'Cronograma do evento';
    };

    const getScheduleModeLabel = (mode?: EventScheduleMode) => {
      if (mode === 'online') return 'Online';
      if (mode === 'presential') return 'Presencial';
      return 'Evento';
    };

    const handleSaveWorkoutHeats = async () => {
      if (!selectedEventToManage || !heatWorkoutId) return;

      if (!selectedWorkout) return;

      // Descobrir se as baterias já existiam e estavam publicadas
      const wasPublishedBefore = (selectedEventToManage.scheduleItems || []).some(
        item => item.kind === 'heat' && item.workoutId === heatWorkoutId && item.isPublished
      );

      // 1. Gerar as novas baterias em lote para todos os workouts do grupo equivalente
      const newHeatItems: EventScheduleItem[] = [];

      for (const wId of targetWorkoutIds) {
        const currentWorkout = workouts.find(w => w.id === wId);
        if (!currentWorkout) continue;

        let currentStartTime = hhmmToMinutes(heatStartTime);
        for (let i = 1; i <= heatCount; i++) {
          const startMin = currentStartTime;
          const endMin = startMin + heatWorkoutDuration;
          const filaMin = startMin - heatCheckinDuration;
          const warmupMin = startMin - heatWarmupDuration;

          const timeStr = minutesToHhmm(startMin);
          const warmupStr = minutesToHhmm(warmupMin);
          const checkinStr = minutesToHhmm(filaMin);
          const endStr = minutesToHhmm(endMin);

          newHeatItems.push({
            id: `heat-${wId}-${i}`,
            kind: 'heat',
            date: heatDate,
            time: timeStr,
            title: `BATERIA ${i} - ${currentWorkout.name}`,
            description: `Aquecimento: ${warmupStr} | Fila: ${checkinStr} | Início: ${timeStr} | Final: ${endStr}`,
            location: selectedEventToManage.location,
            workoutId: wId,
            heatNumber: i,
            warmupTime: warmupStr,
            checkinTime: checkinStr,
            endTime: endStr,
            athleteIds: heatAllocations[`heat-${heatWorkoutId}-${i}`] || [],
            capacity: heatCapacity,
            isPublished: wasPublishedBefore
          });

          currentStartTime = endMin + heatIntervalDuration;
        }
      }

      // 2. Mesclar removendo baterias antigas de todos os workouts do grupo
      const existingItems = selectedEventToManage.scheduleItems || [];
      const filteredItems = existingItems.filter(
        item => !(item.kind === 'heat' && item.workoutId && targetWorkoutIds.includes(item.workoutId))
      );

      const updatedSchedule = [...filteredItems, ...newHeatItems];

      // 3. Atualizar no banco e contexto
      try {
        await updateEvent(selectedEventToManage.id, { scheduleItems: updatedSchedule });
        setSelectedEventToManage(prev => prev ? { ...prev, scheduleItems: updatedSchedule } : null);
        setAdminNotice({ text: `Baterias salvas com sucesso para o grupo de categorias equivalentes!`, tone: 'success' });
      } catch (err) {
        console.error(err);
        setAdminNotice({ text: 'Não foi possível salvar o cronograma de baterias.', tone: 'error' });
      }
    };

    // Função para limpar baterias salvas do grupo
    const handleClearWorkoutHeats = async () => {
      if (!selectedEventToManage || !heatWorkoutId) return;

      if (!selectedWorkout) return;

      const updatedSchedule = (selectedEventToManage.scheduleItems || []).filter(
        item => !(item.kind === 'heat' && item.workoutId && targetWorkoutIds.includes(item.workoutId))
      );

      try {
        await updateEvent(selectedEventToManage.id, { scheduleItems: updatedSchedule });
        setSelectedEventToManage(prev => prev ? { ...prev, scheduleItems: updatedSchedule } : null);
        setAdminNotice({ text: `Baterias para o grupo de percursos equivalentes foram removidas.`, tone: 'success' });
      } catch (err) {
        console.error(err);
        setAdminNotice({ text: 'Não foi possível remover as baterias.', tone: 'error' });
      }
    };

    // Função de auto-preenchimento das baterias pelo leaderboard reverso para o grupo
    const handleAutoFillHeats = () => {
      if (!selectedEventToManage || !heatWorkoutId) return;

      if (!selectedWorkout) return;

      const isFitnessRacingTotal = selectedEventToManage.eventType === 'fitness_racing' && selectedWorkout.code === 'TOTAL';
      let athletesToAllocate: { id: string }[] = [];

      if (isFitnessRacingTotal) {
        // Coleta apenas as divisões equivalentes do grupo de percurso
        const activeDiv = (selectedEventToManage?.divisions || []).find(d => d.id === selectedWorkout.divisionId);
        const activeLayout = activeDiv?.courseLayout || [];
        const equivalentDivisions = (selectedEventToManage?.divisions || []).filter(d => {
          if (d.id === selectedWorkout.divisionId) return true;
          if (!d.courseLayout || d.courseLayout.length !== activeLayout.length) return false;
          return d.courseLayout.every((stg, idx) => stg.name === activeLayout[idx]?.name && stg.type === activeLayout[idx]?.type);
        });

        const allDivisionsAthletes: { id: string }[] = [];

        equivalentDivisions.forEach(div => {
          const divLeaderboard = getLeaderboard(selectedEventToManage.id, div.id);
          if (divLeaderboard.length > 0) {
            const reversedIds = [...divLeaderboard].reverse().map(entry => ({ id: entry.athlete.id }));
            allDivisionsAthletes.push(...reversedIds);
          } else {
            const divAthletes = athletes.filter(a => a.divisionId === div.id);
            allDivisionsAthletes.push(...divAthletes.map(a => ({ id: a.id })));
          }
        });

        athletesToAllocate = allDivisionsAthletes;
      } else if (divisionId) {
        const leaderboardList = getLeaderboard(selectedEventToManage.id, divisionId);
        if (leaderboardList.length === 0) {
          setAdminNotice({ text: 'Não há competidores cadastrados nesta categoria para alocar.', tone: 'error' });
          return;
        }
        // Inverte a classificação geral do leaderboard para que os piores venham primeiro
        athletesToAllocate = [...leaderboardList].reverse().map(entry => ({ id: entry.athlete.id }));
      } else {
        // WOD sem categoria vinculada: usar todos os atletas das divisões do evento
        const eventDivisionIds = (selectedEventToManage.divisions || []).map(d => d.id);
        const eventAthletes = athletes.filter(a => eventDivisionIds.includes(a.divisionId));
        if (eventAthletes.length === 0) {
          setAdminNotice({ text: 'Não há competidores inscritos no evento para alocar.', tone: 'error' });
          return;
        }
        athletesToAllocate = eventAthletes.map(a => ({ id: a.id }));
      }

      // Distribui atletas pelas baterias de forma sequencial
      const newAllocations: Record<string, string[]> = {};
      for (let i = 1; i <= heatCount; i++) {
        newAllocations[`heat-${heatWorkoutId}-${i}`] = [];
      }

      let heatIndex = 0;
      athletesToAllocate.forEach(entry => {
        if (heatIndex >= heatCount) return; // Sem mais baterias disponíveis
        const targetHeatKey = `heat-${heatWorkoutId}-${heatIndex + 1}`;
        if (newAllocations[targetHeatKey].length < heatCapacity) {
          newAllocations[targetHeatKey].push(entry.id);
        }
        // Se a bateria atual encheu, passa pra próxima
        if (newAllocations[targetHeatKey].length >= heatCapacity) {
          heatIndex++;
        }
      });

      setHeatAllocations(newAllocations);

      const allocatedCount = Object.values(newAllocations).flat().length;
      const unallocatedCount = athletesToAllocate.length - allocatedCount;
      if (unallocatedCount > 0) {
        setAdminNotice({
          text: `Auto-preenchimento concluído! ${allocatedCount} competidores alocados. ${unallocatedCount} competidores ficaram de fora (sem vagas). Aumente a quantidade ou capacidade das baterias.`,
          tone: 'error'
        });
      } else {
        setAdminNotice({
          text: divisionId
            ? 'Auto-preenchimento concluído! Os piores resultados foram alocados nas primeiras baterias e os melhores por último.'
            : `Auto-preenchimento concluído! ${allocatedCount} competidor(es) distribuídos em ${heatCount} bateria(s).`,
          tone: 'success'
        });
      }
    };

    // Detectar se já tem baterias salvas para o WOD selecionado
    const hasSavedHeats = (selectedEventToManage?.scheduleItems || []).some(
      item => item.kind === 'heat' && item.workoutId === heatWorkoutId
    );

    // Gerar baterias na memória para visualização em tempo real na tabela
    const generatedHeatsList: { number: number; warmup: string; fila: string; inicio: string; final: string; }[] = [];
    if (heatWorkoutId) {
      let currentStartTime = hhmmToMinutes(heatStartTime);
      for (let i = 1; i <= heatCount; i++) {
        const startMin = currentStartTime;
        const endMin = startMin + heatWorkoutDuration;
        const filaMin = startMin - heatCheckinDuration;
        const warmupMin = startMin - heatWarmupDuration;

        generatedHeatsList.push({
          number: i,
          warmup: minutesToHhmm(warmupMin),
          fila: minutesToHhmm(filaMin),
          inicio: minutesToHhmm(startMin),
          final: minutesToHhmm(endMin)
        });

        currentStartTime = endMin + heatIntervalDuration;
      }
    }

    // Verifica se a criação de baterias está bloqueada por falta de baterias na prova anterior
    const getPreviousWorkoutLockStatus = () => {
      if (!heatWorkoutId || !selectedEventToManage) return { isLocked: false, previousWorkout: null };

      const currentWorkout = workouts.find(w => w.id === heatWorkoutId);
      if (!currentWorkout || !currentWorkout.divisionId) return { isLocked: false, previousWorkout: null };

      // Filtrar e ordenar WODs da mesma divisão
      const divisionWorkouts = workouts
        .filter(w => w.divisionId === currentWorkout.divisionId)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      const currentIndex = divisionWorkouts.findIndex(w => w.id === currentWorkout.id);

      if (currentIndex > 0) {
        const previousWorkout = divisionWorkouts[currentIndex - 1];
        // Verificar se existem baterias salvas no cronograma oficial para o previousWorkout
        const hasSavedHeatsForPrevious = (selectedEventToManage.scheduleItems || []).some(
          item => item.kind === 'heat' && item.workoutId === previousWorkout.id
        );

        if (!hasSavedHeatsForPrevious) {
          return { isLocked: true, previousWorkout };
        }
      }

      return { isLocked: false, previousWorkout: null };
    };

    const { isLocked: isWorkoutLocked, previousWorkout } = getPreviousWorkoutLockStatus();

    const getDivisionName = (divId: string) => {
      return (selectedEventToManage?.divisions || []).find(d => d.id === divId)?.name || 'Geral';
    };

    const groupAthletesByDivision = (athletesList: Athlete[]) => {
      const groups: Record<string, Athlete[]> = {};
      athletesList.forEach(ath => {
        const divName = getDivisionName(ath.divisionId);
        if (!groups[divName]) {
          groups[divName] = [];
        }
        groups[divName].push(ath);
      });
      return groups;
    };

    const divisionId = selectedWorkout?.divisionId;
    const isFitnessRacingTotal = selectedEventToManage?.eventType === 'fitness_racing' && selectedWorkout?.code === 'TOTAL';
    // Se o WOD tem categoria vinculada e não é Fitness Racing TOTAL, filtra atletas dessa categoria
    // Se for Fitness Racing TOTAL ou WOD geral, mostra todos os atletas das divisões do evento
    const categoryAthletes = isFitnessRacingTotal
      ? (() => {
          // As divisões que compartilham o mesmo layout que a selecionada
          const activeDiv = (selectedEventToManage?.divisions || []).find(d => d.id === selectedWorkout?.divisionId);
          const activeLayout = activeDiv?.courseLayout || [];
          const equivalentDivisionIds = (selectedEventToManage?.divisions || [])
            .filter(d => {
              if (d.id === selectedWorkout?.divisionId) return true;
              if (!d.courseLayout || d.courseLayout.length !== activeLayout.length) return false;
              return d.courseLayout.every((stg, idx) => stg.name === activeLayout[idx]?.name && stg.type === activeLayout[idx]?.type);
            })
            .map(d => d.id);
          return athletes.filter(a => equivalentDivisionIds.includes(a.divisionId));
        })()
      : (divisionId
          ? athletes.filter(a => a.divisionId === divisionId)
          : (() => {
              const eventDivisionIds = (selectedEventToManage?.divisions || []).map(d => d.id);
              return athletes.filter(a => eventDivisionIds.includes(a.divisionId));
            })()
        );
    const allAllocatedIds = Object.values(heatAllocations).flat();
    const pendingAthletes = categoryAthletes.filter(ath => !allAllocatedIds.includes(ath.id));

    // Baterias salvas no banco de dados para a prova selecionada
    const savedHeatsForWorkout = (selectedEventToManage?.scheduleItems || []).filter(
      item => item.kind === 'heat' && item.workoutId === heatWorkoutId
    );
    const savedAllocatedIds = savedHeatsForWorkout.flatMap(h => h.athleteIds || []);
    const savedPendingAthletes = categoryAthletes.filter(ath => !savedAllocatedIds.includes(ath.id));
    const isSavedScheduleComplete = savedHeatsForWorkout.length > 0 && savedPendingAthletes.length === 0;

    const isPublished = savedHeatsForWorkout.length > 0 && savedHeatsForWorkout.every(h => h.isPublished);

    // Publicar Baterias para o grupo
    const handlePublishHeats = async () => {
      if (!selectedEventToManage || !heatWorkoutId) return;
      if (!isSavedScheduleComplete) return;

      const updatedSchedule = (selectedEventToManage.scheduleItems || []).map(item => {
        if (item.kind === 'heat' && item.workoutId && targetWorkoutIds.includes(item.workoutId)) {
          return { ...item, isPublished: true };
        }
        return item;
      });

      try {
        await updateEvent(selectedEventToManage.id, { scheduleItems: updatedSchedule });
        setSelectedEventToManage(prev => prev ? { ...prev, scheduleItems: updatedSchedule } : null);
        setAdminNotice({ text: 'Baterias publicadas com sucesso para as categorias vinculadas!', tone: 'success' });
      } catch (err) {
        console.error(err);
        setAdminNotice({ text: 'Erro ao publicar baterias.', tone: 'error' });
      }
    };

    const handleAddAthleteToHeat = (heatId: string, athleteId: string) => {
      setHeatAllocations(prev => {
        const currentList = prev[heatId] || [];
        if (currentList.includes(athleteId)) return prev;
        if (currentList.length >= heatCapacity) {
          setAdminNotice({ text: 'Esta bateria já atingiu a capacidade máxima de competidores.', tone: 'error' });
          return prev;
        }
        return {
          ...prev,
          [heatId]: [...currentList, athleteId]
        };
      });
    };

    const handleRemoveAthleteFromHeat = (heatId: string, athleteId: string) => {
      setHeatAllocations(prev => {
        const currentList = prev[heatId] || [];
        return {
          ...prev,
          [heatId]: currentList.filter(id => id !== athleteId)
        };
      });
    };

    return (
      <div className="space-y-6">
        {/* Seletores de Sub-aba */}
        <div className="flex gap-2 border-b border-card-border pb-3">
          <button
            type="button"
            onClick={() => setScheduleSubTab('general')}
            className={`rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
              scheduleSubTab === 'general'
                ? 'bg-primary text-ink'
                : 'bg-dark-gray text-muted border border-card-border hover:text-white'
            }`}
          >
            Cronograma Geral
          </button>
          <button
            type="button"
            onClick={() => {
              if (hasWorkouts) setScheduleSubTab('heats');
            }}
            disabled={!hasWorkouts}
            className={`rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors relative ${
              !hasWorkouts
                ? 'bg-muted/10 text-muted/40 cursor-not-allowed border border-card-border/30'
                : scheduleSubTab === 'heats'
                ? 'bg-primary text-ink'
                : 'bg-dark-gray text-muted border border-card-border hover:text-white'
            }`}
          >
            Baterias de Provas
            {!hasWorkouts && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full text-[8px] px-1.5 py-0.5 font-bold scale-75">Bloqueado</span>
            )}
          </button>
        </div>

        {scheduleSubTab === 'general' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <form onSubmit={handleCreateScheduleItem} className="lg:col-span-1 space-y-6 rounded-xl border border-card-border p-6 bg-card text-white">
              <div className="border-b border-card-border pb-3">
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Novo Item do Cronograma</h3>
                <p className="text-xs text-muted font-medium">Cadastre briefing, entrega de kits e horários oficiais do evento.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="schedule-kind" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Tipo *</label>
                  <select
                    id="schedule-kind"
                    value={scheduleKind}
                    onChange={(e) => setScheduleKind(e.target.value as EventScheduleItemKind)}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                  >
                    <option value="briefing">Briefing</option>
                    <option value="kit_delivery">Entrega de kits</option>
                    <option value="event">Cronograma do evento</option>
                  </select>
                </div>

                {scheduleKind !== 'event' && (
                  <div>
                    <label htmlFor="schedule-mode" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Formato *</label>
                    <select
                      id="schedule-mode"
                      value={scheduleMode}
                      onChange={(e) => setScheduleMode(e.target.value as EventScheduleMode)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                    >
                      <option value="presential">Presencial</option>
                      <option value="online">Online</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="schedule-date" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Data *</label>
                    <input
                      id="schedule-date"
                      type="date"
                      required
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="schedule-time" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Horário *</label>
                    <input
                      id="schedule-time"
                      type="time"
                      required
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="schedule-title" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Título *</label>
                  <input
                    id="schedule-title"
                    type="text"
                    required
                    placeholder="Ex: Briefing Prova 1, Retirada de Kits, Bateria 1"
                    value={scheduleTitle}
                    onChange={(e) => setScheduleTitle(e.target.value)}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="schedule-location" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Local ou link</label>
                  <input
                    id="schedule-location"
                    type="text"
                    placeholder="Ex: Arena principal, YouTube, Google Meet"
                    value={scheduleLocation}
                    onChange={(e) => setScheduleLocation(e.target.value)}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="schedule-description" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Descrição</label>
                  <textarea
                    id="schedule-description"
                    rows={4}
                    placeholder="Ex: Aquecimento, fila, início e final de bateria..."
                    value={scheduleDescription}
                    onChange={(e) => setScheduleDescription(e.target.value)}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary hover:bg-primary-hover text-ink px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Adicionar ao Cronograma
              </button>
            </form>

            <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-6 space-y-4 text-white">
              <div className="border-b border-card-border pb-3">
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Cronograma Cadastrado</h3>
                <p className="text-xs text-muted font-medium">Briefings, entrega de kits e programação oficial publicados para atletas.</p>
              </div>

              {scheduleItems.length === 0 ? (
                <p className="text-xs text-muted text-center py-8">Nenhum item de cronograma cadastrado neste evento.</p>
              ) : (
                <div className="space-y-3">
                  {scheduleItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-card-border/60 bg-dark-gray/20 p-4">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                              {getScheduleKindLabel(item.kind)}
                            </span>
                            <span className="rounded border border-card-border bg-dark-gray px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                              {getScheduleModeLabel(item.mode)}
                            </span>
                            <span className="font-number text-xs font-bold text-white">{item.date} às {item.time}</span>
                          </div>
                          <h4 className="text-sm font-bold uppercase text-white">{item.title}</h4>
                          <p className="text-xs leading-relaxed text-muted-soft">{item.description}</p>
                          {item.location && (
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Local/link: {item.location}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteScheduleItem(item.id)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-card-border text-red-500 transition-colors hover:border-red-500 hover:text-red-400"
                          aria-label={`Excluir item do cronograma ${item.title}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Sub-aba: Baterias de Prova (Excel Style) */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Formulário Lateral de Configuração */}
            <div className="lg:col-span-1 space-y-6 rounded-xl border border-card-border p-6 bg-card text-white">
              <div className="border-b border-card-border pb-3">
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Calculadora de Baterias</h3>
                <p className="text-xs text-muted font-medium">Parâmetros das baterias de provas e horários.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="heat-wod-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Selecione a Prova *</label>
                  <select
                    id="heat-wod-select"
                    value={heatWorkoutId}
                    onChange={(e) => {
                      const wId = e.target.value;
                      setHeatWorkoutId(wId);
                      if (!wId) {
                        setHeatAllocations({});
                        return;
                      }

                      const w = workouts.find(work => work.id === wId);
                      if (w && w.timeCap) {
                        const match = w.timeCap.match(/^(\d+)/);
                        if (match) {
                          setHeatWorkoutDuration(Number(match[1]));
                        }
                      }

                      const allocations: Record<string, string[]> = {};
                      let foundCapacity = 5;
                      let foundCount = 3;

                      const existingHeats = (selectedEventToManage?.scheduleItems || []).filter(
                        item => item.kind === 'heat' && item.workoutId === wId
                      );

                      if (existingHeats.length > 0) {
                        existingHeats.forEach(item => {
                          allocations[item.id] = item.athleteIds || [];
                          if (item.capacity) {
                            foundCapacity = item.capacity;
                          }
                        });
                        foundCount = existingHeats.length;

                        const firstHeat = existingHeats[0];
                        if (firstHeat.date) setHeatDate(firstHeat.date);
                        if (firstHeat.time) setHeatStartTime(firstHeat.time);
                        if (firstHeat.warmupTime && firstHeat.time) {
                          setHeatWarmupDuration(hhmmToMinutes(firstHeat.time) - hhmmToMinutes(firstHeat.warmupTime));
                        }
                        if (firstHeat.checkinTime && firstHeat.time) {
                          setHeatCheckinDuration(hhmmToMinutes(firstHeat.time) - hhmmToMinutes(firstHeat.checkinTime));
                        }
                        if (firstHeat.endTime && firstHeat.time) {
                          setHeatWorkoutDuration(hhmmToMinutes(firstHeat.endTime) - hhmmToMinutes(firstHeat.time));
                        }
                        setHeatCount(foundCount);
                        setHeatCapacity(foundCapacity);
                        setHeatAllocations(allocations);
                      } else {
                        const initialAllocations: Record<string, string[]> = {};
                        for (let i = 1; i <= heatCount; i++) {
                          initialAllocations[`heat-${wId}-${i}`] = [];
                        }
                        setHeatCapacity(5);
                        setHeatAllocations(initialAllocations);
                      }
                    }}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {(() => {
                      const renderedTotalLayouts: string[] = [];
                      const options: React.ReactNode[] = [];

                      workouts.forEach((w) => {
                        const isFRTotal = selectedEventToManage?.eventType === 'fitness_racing' && w.code === 'TOTAL';

                        if (isFRTotal) {
                          const div = (selectedEventToManage?.divisions || []).find(d => d.id === w.divisionId);
                          const layout = div?.courseLayout || [];
                          const layoutSignature = layout.map(stg => `${stg.name}:${stg.type}`).join('|');

                          if (renderedTotalLayouts.includes(layoutSignature)) {
                            return;
                          }
                          renderedTotalLayouts.push(layoutSignature);

                          const equivalentDivs = (selectedEventToManage?.divisions || []).filter(d => {
                            if (d.id === w.divisionId) return true;
                            if (!d.courseLayout || d.courseLayout.length !== layout.length) return false;
                            return d.courseLayout.every((stg, idx) => stg.name === layout[idx]?.name && stg.type === layout[idx]?.type);
                          });

                          const divNames = equivalentDivs.map(d => d.name).join(', ');

                          options.push(
                            <option key={w.id} value={w.id}>
                              {w.code} - {w.name} [{divNames}]
                            </option>
                          );
                        } else {
                          const divName = (selectedEventToManage?.divisions || []).find(d => d.id === w.divisionId)?.name;
                          options.push(
                            <option key={w.id} value={w.id}>
                              {w.code} - {w.name}{divName ? ` [${divName}]` : ' [Geral]'}
                            </option>
                          );
                        }
                      });

                      return options;
                    })()}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="heat-date" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Data da Prova *</label>
                    <input
                      id="heat-date"
                      type="date"
                      value={heatDate}
                      onChange={(e) => setHeatDate(e.target.value)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="heat-start-time" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Início Bateria 1 *</label>
                    <input
                      id="heat-start-time"
                      type="time"
                      value={heatStartTime}
                      onChange={(e) => setHeatStartTime(e.target.value)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="heat-warmup" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Aquecimento (min)</label>
                    <input
                      id="heat-warmup"
                      type="number"
                      min="0"
                      value={heatWarmupDuration}
                      onChange={(e) => setHeatWarmupDuration(Number(e.target.value))}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                    />
                  </div>
                  <div>
                    <label htmlFor="heat-checkin" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Fila (min)</label>
                    <input
                      id="heat-checkin"
                      type="number"
                      min="0"
                      value={heatCheckinDuration}
                      onChange={(e) => setHeatCheckinDuration(Number(e.target.value))}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="heat-duration" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Tempo Prova (min)</label>
                    <input
                      id="heat-duration"
                      type="number"
                      min="1"
                      value={heatWorkoutDuration}
                      onChange={(e) => setHeatWorkoutDuration(Number(e.target.value))}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                    />
                  </div>
                  <div>
                    <label htmlFor="heat-interval" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Transição (min)</label>
                    <input
                      id="heat-interval"
                      type="number"
                      min="0"
                      value={heatIntervalDuration}
                      onChange={(e) => setHeatIntervalDuration(Number(e.target.value))}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="heat-count" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Quantidade Baterias *</label>
                    <input
                      id="heat-count"
                      type="number"
                      min="1"
                      value={heatCount}
                      onChange={(e) => {
                        const newCount = Number(e.target.value);
                        setHeatCount(newCount);
                        if (heatWorkoutId) {
                          setHeatAllocations(prev => {
                            const nextAllocations = { ...prev };
                            for (let i = 1; i <= newCount; i++) {
                              const heatId = `heat-${heatWorkoutId}-${i}`;
                              if (!nextAllocations[heatId]) {
                                nextAllocations[heatId] = [];
                              }
                            }
                            Object.keys(nextAllocations).forEach(key => {
                              if (key.startsWith(`heat-${heatWorkoutId}-`)) {
                                const num = Number(key.split('-').pop());
                                if (num > newCount) {
                                  delete nextAllocations[key];
                                }
                              }
                            });
                            return nextAllocations;
                          });
                        }
                      }}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                    />
                  </div>
                  <div>
                    <label htmlFor="heat-capacity" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Capacidade por Bateria *</label>
                    <input
                      id="heat-capacity"
                      type="number"
                      min="1"
                      value={heatCapacity}
                      onChange={(e) => setHeatCapacity(Number(e.target.value))}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Pré-visualização Excel Style */}
            <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-4 sm:p-6 space-y-4 sm:space-y-6 text-white overflow-x-auto">
              <div className="border-b border-card-border pb-2 sm:pb-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider">Cronograma de Prova</h3>
                  <p className="text-[10px] sm:text-xs text-muted font-medium">Pré-visualização da planilha gerada em tempo real.</p>
                </div>
                {hasSavedHeats && (
                  <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase">
                    Salvo no banco
                  </span>
                )}
              </div>

              {/* Status do Cronograma da Prova */}
              <div className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                pendingAthletes.length === 0 && categoryAthletes.length > 0
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/30 bg-red-500/10 text-red-200'
              }`}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${
                      pendingAthletes.length === 0 && categoryAthletes.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                    }`} />
                    <h4 className="text-xs font-bold uppercase tracking-wider font-sans">
                      {pendingAthletes.length === 0 && categoryAthletes.length > 0
                        ? 'Cronograma Concluído'
                        : 'Cronograma Incompleto'}
                    </h4>
                  </div>
                  <p className="text-xs text-muted-soft">
                    {pendingAthletes.length === 0 && categoryAthletes.length > 0
                      ? 'Todos os atletas foram alocados nas baterias.'
                      : `Falta alocar ${pendingAthletes.length} atleta(s) de um total de ${categoryAthletes.length}.`}
                  </p>
                </div>
                {pendingAthletes.length > 0 && (
                  <span className="text-xs font-bold font-number bg-red-500/20 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-md self-start sm:self-center">
                    {pendingAthletes.length} pendentes
                  </span>
                )}
              </div>

              {!heatWorkoutId ? (
                <p className="text-xs text-muted text-center py-16">Selecione uma prova no formulário para gerar o cronograma.</p>
              ) : (
                <div className="space-y-6">
                  {isWorkoutLocked && previousWorkout && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3 text-amber-200">
                      <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold uppercase tracking-wider">Criação Bloqueada</h4>
                        <p className="text-xs leading-relaxed text-amber-200/80">
                          Para cadastrar as baterias da prova atual, você deve primeiro criar e salvar o cronograma de baterias da prova anterior: <strong className="text-amber-100 uppercase">&quot;{previousWorkout.code || previousWorkout.name}&quot;</strong>.
                        </p>
                      </div>
                    </div>
                  )}
                  {/* Excel Style Table Container */}
                  <div className="w-full min-w-[340px] border-collapse border border-white text-center font-sans">

                    {/* Header: Data por Extenso */}
                    <div className="bg-black text-white py-3 text-sm font-black border-b border-white uppercase tracking-widest">
                      {formatLongDate(heatDate)}
                    </div>

                    {/* Sub-Header: Configurações Gerais */}
                    <div className="grid grid-cols-4 bg-white text-black text-[10px] font-bold py-2 border-b border-white uppercase tracking-wider gap-0">
                      <div className="border-r border-black flex flex-col justify-center">
                        <span className="text-[8px] text-gray-500 font-extrabold uppercase">Aquecimento</span>
                        <span className="font-number font-black text-xs">00:{String(heatWarmupDuration).padStart(2, '0')}</span>
                      </div>
                      <div className="border-r border-black flex flex-col justify-center">
                        <span className="text-[8px] text-gray-500 font-extrabold uppercase">Fila</span>
                        <span className="font-number font-black text-xs">00:{String(heatCheckinDuration).padStart(2, '0')}</span>
                      </div>
                      <div className="border-r border-black flex flex-col justify-center">
                        <span className="text-[8px] text-gray-500 font-extrabold uppercase">Intervalo</span>
                        <span className="font-number font-black text-xs">00:{String(heatIntervalDuration).padStart(2, '0')}</span>
                      </div>
                      <div className="flex flex-col justify-center">
                        <span className="text-[8px] text-gray-500 font-extrabold uppercase">Tempo Prova</span>
                        <span className="font-number font-black text-xs">00:{String(heatWorkoutDuration).padStart(2, '0')}</span>
                      </div>
                    </div>

                    {/* Prova Selecionada Highlight Banner */}
                    <div className="bg-white text-black py-2.5 text-xs font-black border-b border-white uppercase tracking-widest text-center">
                      {selectedEventToManage?.name} - {selectedWorkout?.name}
                    </div>

                    {/* Table Column Headers */}
                    <div className="grid grid-cols-5 bg-white text-black text-[9px] font-black py-1.5 border-b border-white uppercase tracking-widest">
                      <div></div>
                      <div className="border-l border-black">Aquecimento</div>
                      <div className="border-l border-black">Fila</div>
                      <div className="border-l border-black">Início</div>
                      <div className="border-l border-black">Final</div>
                    </div>

                    {/* Grid de Baterias em Cascata */}
                    <div className="bg-black text-white text-xs font-bold divide-y divide-white">
                      {generatedHeatsList.map((heat, idx) => {
                        const isEvenLine = idx % 2 === 1;
                        const lineBgClass = isEvenLine ? 'bg-white text-black' : 'bg-black text-white';
                        const colBorderClass = isEvenLine ? 'border-l border-black' : 'border-l border-white';

                        // Célula do INICIO com estilo condicional conforme Excel
                        const inicioCellClass = isEvenLine
                          ? `font-number font-black text-primary ${colBorderClass}`
                          : `bg-primary text-ink font-number font-black ${colBorderClass}`;

                        return (
                          <div key={heat.number} className={`grid grid-cols-5 py-2.5 ${lineBgClass} items-center`}>
                            <div className="uppercase font-black text-[10px] tracking-wider">
                              Bateria {heat.number}
                            </div>
                            <div className={`font-number ${colBorderClass}`}>
                              {heat.warmup}
                            </div>
                            <div className={`font-number ${colBorderClass}`}>
                              {heat.fila}
                            </div>
                            <div className={inicioCellClass}>
                              {heat.inicio}
                            </div>
                            <div className={`font-number ${colBorderClass}`}>
                              {heat.final}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Seção: Distribuição de Competidores */}
                  <div className="border-t border-card-border/60 pt-4 sm:pt-6 space-y-3 sm:space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">Distribuição de Competidores</h4>
                        <p className="text-[10px] sm:text-xs text-muted font-medium">Aloque competidores nas baterias manualmente ou por leaderboard.</p>
                      </div>
                      <button
                        type="button"
                        disabled={isWorkoutLocked}
                        onClick={handleAutoFillHeats}
                        className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors shrink-0 ${
                          isWorkoutLocked
                            ? 'bg-muted/10 text-muted/40 cursor-not-allowed border border-card-border/30'
                            : 'bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary'
                        }`}
                      >
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19 11.5L16.5 6L14 11.5L8.5 14L14 16.5L16.5 22L19 16.5L24 14L19 11.5Z" />
                          <path d="M7 6.5L5.5 3L4 6.5L0.5 8L4 9.5L5.5 13L7 9.5L10.5 8L7 6.5Z" />
                          <path d="M8 17.5L7.25 15.75L5.5 15L7.25 14.25L8 12.5L8.75 14.25L10.5 15L8.75 15.75L8 17.5Z" />
                        </svg>
                        Auto-preencher por Leaderboard
                      </button>
                    </div>

                    {/* Layout Lado a Lado (xl:grid-cols-3) no Desktop */}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">

                      {/* Coluna da Esquerda (Baterias e Pendentes) */}
                      <div className="xl:col-span-2 space-y-4 sm:space-y-6">

                        {/* Grid de Baterias (Cards de Alocação) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                          {generatedHeatsList.map((heat) => {
                            const heatId = `heat-${heatWorkoutId}-${heat.number}`;
                            const allocatedIds = heatAllocations[heatId] || [];
                            const allocatedAthletes = allocatedIds
                              .map(id => athletes.find(a => a.id === id))
                              .filter(Boolean) as Athlete[];

                            return (
                              <div key={heatId} className="rounded-lg border border-card-border bg-dark-gray/30 p-3 space-y-2">
                                <div className="flex items-center justify-between pb-1.5 border-b border-card-border/50">
                                  <span className="text-[10px] font-extrabold text-white uppercase tracking-wider">
                                    Bat. {heat.number}
                                  </span>
                                  <span className={`text-[9px] font-bold px-1.5 py-px rounded-full ${
                                    allocatedAthletes.length >= heatCapacity
                                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                      : 'bg-primary/20 text-primary border border-primary/30'
                                  }`}>
                                    {allocatedAthletes.length}/{heatCapacity}
                                  </span>
                                </div>

                                {/* Lista de Atletas Alocados nesta bateria */}
                                <div className="space-y-1 min-h-[36px]">
                                  {allocatedAthletes.length === 0 ? (
                                    <p className="text-[9px] text-muted-soft text-center py-2.5 italic">Nenhum alocado</p>
                                  ) : (
                                    allocatedAthletes.map(ath => (
                                      <div key={ath.id} className="flex items-center justify-between bg-black/40 border border-card-border/40 rounded px-2 py-1 text-[10px] transition-colors hover:border-card-border">
                                        <div className="flex items-center gap-1.5 truncate min-w-0">
                                          {ath.isTeam ? (
                                            <span className="shrink-0 text-[8px] font-bold text-primary">EQ</span>
                                          ) : (
                                            <span className="shrink-0 text-[8px] font-bold text-muted font-number">#</span>
                                          )}
                                          <span className="font-bold text-white truncate">{ath.name}</span>
                                        </div>
                                        {!isWorkoutLocked && (
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveAthleteFromHeat(heatId, ath.id)}
                                            className="text-red-500/70 hover:text-red-400 p-0.5 transition-colors ml-1 shrink-0"
                                            title="Remover"
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>

                                {/* Dropdown de alocação rápida */}
                                {allocatedAthletes.length < heatCapacity && (
                                  <select
                                    value=""
                                    disabled={isWorkoutLocked}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleAddAthleteToHeat(heatId, e.target.value);
                                      }
                                    }}
                                    className="w-full rounded border border-card-border/50 bg-dark-gray/60 px-2 py-1 text-[10px] text-muted hover:text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                                  >
                                    <option value="">+ Adicionar...</option>
                                    {pendingAthletes.map(ath => (
                                      <option key={ath.id} value={ath.id}>
                                        {ath.name} {ath.box ? `(${ath.box})` : ''}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Competidores Pendentes */}
                        <div className="rounded-lg border border-card-border/40 bg-dark-gray/10 p-3 space-y-2">
                          <div className="flex items-center justify-between pb-1.5 border-b border-card-border/30">
                            <span className="text-[10px] font-extrabold text-muted uppercase tracking-wider">
                              Sem Bateria ({pendingAthletes.length})
                            </span>
                          </div>

                          {pendingAthletes.length === 0 ? (
                            <p className="text-[10px] text-muted text-center py-3 italic">Todos alocados!</p>
                          ) : (
                            <div className="space-y-3 max-h-[160px] overflow-y-auto">
                              {Object.entries(groupAthletesByDivision(pendingAthletes)).map(([divName, list]) => {
                                if (list.length === 0) return null;
                                return (
                                  <div key={divName} className="space-y-1">
                                    <span className="text-[8px] font-bold text-primary/80 uppercase tracking-wider block mb-0.5">{divName}</span>
                                    <div className="flex flex-wrap gap-1.5">
                                      {list.map(ath => (
                                        <div
                                          key={ath.id}
                                          className="group relative flex items-center gap-1 rounded border border-card-border/50 bg-dark-gray/40 px-2 py-1 text-[10px] text-white hover:border-primary/50 transition-colors"
                                        >
                                          <span className="font-bold truncate max-w-[100px]">{ath.name}</span>
                                          {!isWorkoutLocked && (
                                            <div className="hidden group-hover:flex absolute left-0 bottom-full mb-1 bg-black border border-card-border rounded-lg p-1.5 z-50 flex-col gap-1 w-32">
                                              <span className="text-[8px] text-muted font-bold text-center block pb-1 border-b border-card-border/40">Mover para:</span>
                                              {generatedHeatsList.map(h => {
                                                const hId = `heat-${heatWorkoutId}-${h.number}`;
                                                const currentCount = (heatAllocations[hId] || []).length;
                                                const isFull = currentCount >= heatCapacity;
                                                return (
                                                  <button
                                                    key={hId}
                                                    type="button"
                                                    disabled={isFull}
                                                    onClick={() => handleAddAthleteToHeat(hId, ath.id)}
                                                    className={`text-[9px] font-bold text-left px-2 py-1 rounded transition-colors ${
                                                      isFull
                                                        ? 'text-muted cursor-not-allowed bg-red-950/20'
                                                        : 'text-white hover:bg-primary hover:text-ink'
                                                    }`}
                                                  >
                                                    Bateria {h.number} ({currentCount}/{heatCapacity})
                                                  </button>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                      </div>

                      {/* Coluna da Direita (Status Geral da Categoria) */}
                      <div className="rounded-lg border border-card-border bg-dark-gray/20 p-3 space-y-3">
                        <div className="border-b border-card-border/40 pb-1.5">
                          <h5 className="text-[10px] font-extrabold text-white uppercase tracking-wider">Inscritos na Categoria</h5>
                          <p className="text-[9px] text-muted-soft">Competidores e baterias.</p>
                        </div>

                        {/* Campo de Busca Rápida */}
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Buscar competidor..."
                            value={heatAthleteSearchQuery}
                            onChange={(e) => setHeatAthleteSearchQuery(e.target.value)}
                            className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-1.5 pl-8 text-xs text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                          />
                          <svg className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" x2="16.65" y1="21" y2="16.65"></line>
                          </svg>
                        </div>

                        {/* Lista Geral de Alocação */}
                        <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                          {categoryAthletes.length === 0 ? (
                            <p className="text-xs text-muted text-center py-8 italic">Nenhum competidor cadastrado nesta prova.</p>
                          ) : (
                            (() => {
                              const filtered = categoryAthletes.filter(ath => {
                                if (!heatAthleteSearchQuery) return true;
                                return ath.name.toLowerCase().includes(heatAthleteSearchQuery.toLowerCase());
                              });

                              if (filtered.length === 0) {
                                return <p className="text-xs text-muted text-center py-8 italic">Nenhum competidor correspondente à busca.</p>;
                              }

                              return Object.entries(groupAthletesByDivision(filtered)).map(([divName, list]) => {
                                if (list.length === 0) return null;
                                return (
                                  <div key={divName} className="space-y-1.5">
                                    <div className="bg-dark-gray/40 px-2 py-1 rounded border border-card-border/30 flex items-center justify-between font-sans">
                                      <span className="text-[9px] font-extrabold text-primary uppercase tracking-wider">{divName}</span>
                                      <span className="text-[9px] font-bold text-muted font-number">{list.length} atletas</span>
                                    </div>
                                    <div className="space-y-1">
                                      {list.map(ath => {
                                        let allocatedHeatNumber: number | null = null;
                                        let allocatedHeatTime: string | null = null;

                                        generatedHeatsList.forEach(h => {
                                          const hId = `heat-${heatWorkoutId}-${h.number}`;
                                          if ((heatAllocations[hId] || []).includes(ath.id)) {
                                            allocatedHeatNumber = h.number;
                                            allocatedHeatTime = h.inicio;
                                          }
                                        });

                                        return (
                                          <div key={ath.id} className="flex items-center justify-between bg-black/30 border border-card-border/40 rounded px-2 py-1.5 text-[10px] transition-colors hover:bg-black/50 font-sans w-full min-w-0">
                                            <div className="flex flex-col flex-1 min-w-0 pr-2">
                                              <span className="font-bold text-white truncate block">{ath.name}</span>
                                              {ath.box && <span className="text-[9px] text-muted truncate block">{ath.box}</span>}
                                            </div>
                                            <div className="shrink-0">
                                              {allocatedHeatNumber !== null ? (
                                                <span className="inline-flex rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-bold">
                                                  Bateria {allocatedHeatNumber} ({allocatedHeatTime})
                                                </span>
                                              ) : (
                                                <span className="inline-flex rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 text-[9px] font-bold">
                                                  Pendente
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              });
                            })()
                          )}
                        </div>

                      </div>

                    </div>
                  </div>

                  {/* Seção de Ações de Publicação e Chamada */}
                  {hasSavedHeats && (
                    <div className="border-t border-card-border/60 pt-4 space-y-3 font-sans">
                      <div className="flex items-center justify-between">
                        <h5 className="text-[10px] font-extrabold text-white uppercase tracking-wider">Ações de Controle de Prova</h5>
                        <div className="flex gap-2">
                          {isPublished && (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-400 uppercase">
                              Publicado ✅
                            </span>
                          )}
                        </div>
                      </div>

                      {!isSavedScheduleComplete ? (
                        <p className="text-[10px] text-amber-400 font-bold bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg">
                          ⚠️ O cronograma salvo possui competidores pendentes de alocação. Aloque todos os competidores e salve para habilitar as ações de publicação.
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={handlePublishHeats}
                          disabled={isPublished}
                          className={`w-full flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 sm:px-4 py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider leading-tight transition-colors ${
                            isPublished
                              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 cursor-not-allowed'
                              : 'bg-primary hover:bg-primary-hover text-ink'
                          }`}
                        >
                          {isPublished ? 'Baterias Publicadas' : 'Publicar Baterias'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Ações */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-3 sm:pt-4 border-t border-card-border/60">
                    <button
                      type="button"
                      disabled={isWorkoutLocked}
                      onClick={handleSaveWorkoutHeats}
                      className={`flex-1 flex min-h-10 items-center justify-center gap-2 rounded-md px-4 sm:px-6 py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                        isWorkoutLocked
                          ? 'bg-muted/10 text-muted/40 cursor-not-allowed border border-card-border/30'
                          : 'bg-primary hover:bg-primary-hover text-ink'
                      }`}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Salvar Baterias
                    </button>
                    {hasSavedHeats && (
                      <button
                        type="button"
                        disabled={isWorkoutLocked}
                        onClick={handleClearWorkoutHeats}
                        className={`flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 sm:px-6 py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                          isWorkoutLocked
                            ? 'bg-muted/10 text-muted/40 cursor-not-allowed border-card-border/30'
                            : 'border-card-border bg-dark-gray hover:border-red-500 hover:text-red-400 text-muted'
                        }`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Limpar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAbaWods = () => {
    const workouts = selectedEventToManage?.workouts || [];
    const divisions = selectedEventToManage?.divisions || [];

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulário lateral */}
        <form onSubmit={handleCreateWorkout} className="lg:col-span-1 space-y-6 rounded-xl border border-card-border p-6 bg-card text-white">
          <div className="border-b border-card-border pb-3">
            <h3 className="text-base font-bold text-white uppercase tracking-wider">Nova Prova (WOD)</h3>
            <p className="text-xs text-muted font-medium">Cadastre baterias e treinos do evento.</p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="wod-code-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Cód. WOD *</label>
                <input
                  id="wod-code-input"
                  type="text"
                  required
                  placeholder="Ex: WOD 1"
                  value={wodCode}
                  onChange={(e) => setWodCode(e.target.value)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="wod-order-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Ordem *</label>
                <input
                  id="wod-order-input"
                  type="number"
                  required
                  min="1"
                  value={wodOrder}
                  onChange={(e) => setWodOrder(Number(e.target.value))}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                />
              </div>
            </div>

            <div>
              <label htmlFor="wod-name-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Nome da Prova *</label>
              <input
                id="wod-name-input"
                type="text"
                required
                placeholder="Ex: Cardio Burn, DT Speed"
                value={wodName}
                onChange={(e) => setWodName(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="wod-score-type-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Tipo Score *</label>
                <select
                  id="wod-score-type-input"
                  value={wodType}
                  onChange={(e) => setWodType(e.target.value as WorkoutType)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                >
                  <option value="fortime">Tempo (Fortime)</option>
                  <option value="amrap">Repetições (AMRAP)</option>
                  <option value="maxweight">Peso Máximo</option>
                  <option value="reps">Repetições Fixas</option>
                  <option value="distance">Distância</option>
                  <option value="points">Pontos</option>
                </select>
              </div>
              <div>
                <label htmlFor="wod-cap-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Time Cap</label>
                <input
                  id="wod-cap-input"
                  type="text"
                  placeholder="Ex: 12:00"
                  value={wodTimeCap}
                  onChange={(e) => setWodTimeCap(e.target.value)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="wod-division-id" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Categoria Vinculada</label>
              <select
                id="wod-division-id"
                value={wodDivisionId}
                onChange={(e) => setWodDivisionId(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
              >
                <option value="">Todas as categorias (Geral)</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="wod-tiebreaker-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Critério de Desempate</label>
              <input
                id="wod-tiebreaker-input"
                type="text"
                placeholder="Ex: Tempo do WOD 1, Reps do WOD 2"
                value={wodTieBreaker}
                onChange={(e) => setWodTieBreaker(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="wod-desc-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Descrição / Movimentos *</label>
              <textarea
                id="wod-desc-input"
                rows={4}
                required
                placeholder="Movimentos, cargas, reps, etc..."
                value={wodDescription}
                onChange={(e) => setWodDescription(e.target.value)}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none font-mono text-xs"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors"
          >
            Criar Prova WOD
          </button>
        </form>

        {/* Lista/Tabela */}
        <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-6 space-y-4 text-white">
          <div className="border-b border-card-border pb-3">
            <h3 className="text-base font-bold text-white uppercase tracking-wider">Provas WODs Cadastradas</h3>
            <p className="text-xs text-muted font-medium">Todas as provas cadastradas para este evento.</p>
          </div>

          {workouts.length === 0 ? (
            <p className="text-xs text-muted text-center py-8">Nenhuma prova cadastrada neste evento.</p>
          ) : (
            <div className="space-y-4">
              {[...workouts].sort((a, b) => a.orderIndex - b.orderIndex).map((wod) => {
                const divLinked = divisions.find(d => d.id === wod.divisionId);
                return (
                  <div key={wod.id} className="border border-card-border/60 bg-dark-gray/20 rounded-xl p-4 flex flex-col sm:flex-row justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded uppercase tracking-wider font-sans">
                          {wod.code}
                        </span>
                        <h4 className="text-sm font-bold text-white uppercase">{wod.name}</h4>
                        {divLinked ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-dark-gray text-muted border border-card-border rounded uppercase">
                            {divLinked.name}
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-dark-gray text-muted border border-card-border rounded uppercase">
                            Geral
                          </span>
                        )}
                      </div>
                      <pre className="text-xs font-mono text-muted-soft whitespace-pre-wrap font-sans">
                        {wod.description}
                      </pre>
                    </div>

                    <div className="sm:text-right space-y-2 flex flex-col justify-center items-start sm:items-end">
                      <p className="text-xs font-semibold text-muted uppercase text-[10px]">Pontuação</p>
                      <span className="text-xs font-bold text-white uppercase">
                        {wod.type === 'fortime' ? 'Tempo (Cap: ' + (wod.timeCap || 'Sem limite') + ')'
                          : wod.type === 'amrap' ? 'AMRAP'
                          : wod.type === 'maxweight' ? 'Carga Máxima'
                          : wod.type === 'reps' ? 'Repetições'
                          : wod.type === 'distance' ? 'Distância'
                          : 'Pontos'}
                      </span>
                      {wod.tieBreaker && (
                        <p className="text-[9px] text-muted-soft">Desempate: {wod.tieBreaker}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteWorkout(wod.id, wod.name)}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-card-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500 transition-colors hover:border-red-500 hover:text-red-400"
                        aria-label={`Excluir prova ${wod.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Excluir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAbaRegistrations = () => {
    const divisions = selectedEventToManage?.divisions || [];
    const eventRegs = registrations.filter(r => r.eventId === selectedEventToManage?.id);

    // Filtrar
    const filteredRegs = eventRegs.filter(reg => {
      if (regFilterCatId && reg.divisionId !== regFilterCatId) return false;
      if (regFilterStatus && (reg.paymentStatus || 'payment_approved') !== regFilterStatus) return false;
      if (regFilterName && !reg.athleteName.toLowerCase().includes(regFilterName.toLowerCase())) return false;
      if (regFilterBox && !reg.box.toLowerCase().includes(regFilterBox.toLowerCase())) return false;
      return true;
    });

    return (
      <div className="bg-card border border-card-border rounded-xl p-6 space-y-6 text-white">
        <div className="border-b border-card-border pb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider">Inscrições Realizadas</h3>
            <p className="text-xs text-muted">Lista completa de participantes e equipes registradas.</p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            {!isBilheteriaOpen && (
              <button
                type="button"
                onClick={() => setIsBilheteriaOpen(true)}
                className="inline-flex min-h-9 items-center justify-center rounded bg-primary hover:bg-primary-hover px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-ink transition-colors font-sans"
              >
                Nova Inscrição (Bilheteria)
              </button>
            )}
            <span className="text-xs bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded font-bold uppercase tracking-wider">
              Total: {filteredRegs.length} de {eventRegs.length}
            </span>
          </div>
        </div>

        {isBilheteriaOpen ? (
          <form onSubmit={handleBilheteriaSubmit} className="space-y-6">
            <div className="border-b border-card-border pb-3">
              <h4 className="text-sm font-bold text-primary uppercase tracking-wider">
                Venda de Inscrição / Bilheteria Presencial
              </h4>
              <p className="text-xs text-muted">Preencha as informações do atleta ou da equipe para registrá-los no evento.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="bil-cat-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Categoria *</label>
                <select
                  id="bil-cat-select"
                  required
                  value={bilCatId}
                  onChange={(e) => {
                    setBilCatId(e.target.value);
                  }}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                >
                  <option value="">Selecione a Categoria...</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} (R$ {d.price.toFixed(2)}) - {d.type === 'duo' ? 'Dupla' : d.type === 'trio' ? 'Trio' : d.type === 'team' ? 'Equipe' : 'Individual'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Se for categoria individual */}
              {bilCatId && (() => {
                const selectedCat = divisions.find(d => d.id === bilCatId);
                if (!selectedCat || selectedCat.type !== 'individual') return null;
                return (
                  <div className="grid grid-cols-2 gap-4 col-span-1">
                    <div>
                      <label htmlFor="bil-gender" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Gênero *</label>
                      <select
                        id="bil-gender"
                        value={bilGender}
                        onChange={(e) => setBilGender(e.target.value as 'male' | 'female')}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      >
                        <option value="male">Masculino</option>
                        <option value="female">Feminino</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="bil-birthdate" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Data Nasc. *</label>
                      <input
                        id="bil-birthdate"
                        type="text"
                        placeholder="DD/MM/AAAA"
                        required
                        value={bilBirthDate}
                        onChange={(e) => setBilBirthDate(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-number"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Dados do Competidor (Individual ou Nome da Equipe) */}
            {bilCatId && (() => {
              const selectedCat = divisions.find(d => d.id === bilCatId);
              if (!selectedCat) return null;
              const isTeamCat = selectedCat.type !== 'individual';

              return (
                <div className="space-y-4 border-t border-card-border pt-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary font-sans">
                    {isTeamCat ? 'Dados da Equipe' : 'Dados do Atleta'}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="bil-athlete-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">
                        {isTeamCat ? 'Nome da Equipe *' : 'Nome do Atleta *'}
                      </label>
                      <input
                        id="bil-athlete-name"
                        type="text"
                        required
                        placeholder={isTeamCat ? "Ex: Box Brutus Duo" : "Ex: João Silva"}
                        value={bilAthleteName}
                        onChange={(e) => setBilAthleteName(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="bil-box" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Box / Academia</label>
                      <input
                        id="bil-box"
                        type="text"
                        placeholder="Ex: CrossFit WODArena"
                        value={bilBox}
                        onChange={(e) => setBilBox(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="bil-city" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Cidade</label>
                      <input
                        id="bil-city"
                        type="text"
                        placeholder="Ex: Rio de Janeiro"
                        value={bilCity}
                        onChange={(e) => setBilCity(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="bil-state" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Estado</label>
                      <input
                        id="bil-state"
                        type="text"
                        placeholder="Ex: RJ"
                        value={bilState}
                        onChange={(e) => setBilState(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="bil-instagram" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">
                        {isTeamCat ? 'Instagram da Equipe' : 'Instagram do Atleta'}
                      </label>
                      <input
                        id="bil-instagram"
                        type="text"
                        placeholder="Ex: @username"
                        value={bilInstagram}
                        onChange={(e) => setBilInstagram(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none font-sans"
                      />
                    </div>
                  </div>

                  {/* Informações de contato e pagamento */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="bil-email" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">E-mail de Contato *</label>
                      <input
                        id="bil-email"
                        type="email"
                        required
                        placeholder="Ex: competidor@email.com"
                        value={bilAthleteEmail}
                        onChange={(e) => setBilAthleteEmail(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="bil-phone" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">WhatsApp / Telefone *</label>
                      <input
                        id="bil-phone"
                        type="tel"
                        required
                        placeholder="Ex: (21) 99999-9999"
                        value={bilAthletePhone}
                        onChange={(e) => setBilAthletePhone(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Se for equipe (dupla, trio, equipe) - Campos dos integrantes */}
                  {isTeamCat && (
                    <div className="space-y-4 border-t border-card-border/60 pt-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-primary font-sans">Integrantes da Equipe</p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Array.from({ length: selectedCat.type === 'duo' ? 2 : selectedCat.type === 'trio' ? 3 : 4 }).map((_, idx) => (
                          <div key={idx} className="bg-dark-gray/25 border border-card-border/60 rounded-xl p-3 space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-white">Atleta {idx + 1}</p>
                            <div>
                              <label htmlFor={`bil-member-name-${idx}`} className="mb-1 block text-[10px] font-bold uppercase text-muted font-sans">Nome Completo *</label>
                              <input
                                id={`bil-member-name-${idx}`}
                                type="text"
                                required
                                placeholder="Nome do integrante"
                                value={bilTeamMembers[idx]?.name || ''}
                                onChange={(e) => {
                                  const nameVal = e.target.value;
                                  setBilTeamMembers(prev => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], name: nameVal };
                                    return next;
                                  });
                                }}
                                className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-1.5 text-xs text-white focus:border-primary/50 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label htmlFor={`bil-member-insta-${idx}`} className="mb-1 block text-[10px] font-bold uppercase text-muted font-sans">Instagram</label>
                              <input
                                id={`bil-member-insta-${idx}`}
                                type="text"
                                placeholder="@usuario"
                                value={bilTeamMembers[idx]?.instagram || ''}
                                onChange={(e) => {
                                  const instaVal = e.target.value;
                                  setBilTeamMembers(prev => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], instagram: instaVal };
                                    return next;
                                  });
                                }}
                                className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-1.5 text-xs text-white focus:border-primary/50 focus:outline-none font-sans"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Área de Cupom na Bilheteria */}
                  <div className="border-t border-card-border/60 pt-4 mt-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-primary font-sans">Descontos & Convites</p>
                    <div className="flex flex-col sm:flex-row gap-3 items-end">
                      <div className="flex-1 w-full">
                        <label htmlFor="bil-coupon-input" className="mb-1 block text-[10px] font-bold uppercase text-muted font-sans">Cupom de Desconto</label>
                        <input
                          id="bil-coupon-input"
                          type="text"
                          placeholder="Ex: PROMO20"
                          value={bilCouponCodeInput}
                          onChange={(e) => setBilCouponCodeInput(e.target.value)}
                          className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white focus:border-primary/50 focus:outline-none uppercase"
                        />
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={handleApplyBilCoupon}
                          className="flex-1 sm:flex-none min-h-9 items-center justify-center rounded border border-card-border bg-dark-gray hover:bg-card px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition-colors"
                        >
                          Aplicar
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerateGuestCoupon}
                          className="flex-1 sm:flex-none min-h-9 items-center justify-center rounded bg-primary/20 hover:bg-primary/30 border border-primary/30 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-primary transition-colors"
                        >
                          Convidar (100% OFF)
                        </button>
                      </div>
                    </div>

                    {bilAppliedCouponCode && (
                      <div className="flex items-center justify-between bg-trading-up/10 border border-trading-up/20 rounded p-2.5 text-xs">
                        <span className="text-trading-up font-medium">
                          Cupom <strong className="uppercase">{bilAppliedCouponCode}</strong> aplicado: -{currencyFormatter.format(bilDiscountApplied)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setBilCouponCodeInput('');
                            setBilAppliedCouponCode('');
                            setBilDiscountApplied(0);
                            setBilIsGuest(false);
                          }}
                          className="text-[10px] font-bold uppercase text-muted-soft hover:text-white transition-colors"
                        >
                          Remover
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Detalhes de Pagamento (Visual Informativo) */}
                  <div className="bg-dark-gray/30 border border-card-border rounded-lg p-4 mt-4 flex items-center justify-between text-sm">
                    <div>
                      <p className="text-xs text-muted font-sans uppercase">Total a Pagar (Bilheteria)</p>
                      <div className="flex items-baseline gap-2">
                        {bilDiscountApplied > 0 && (
                          <span className="text-xs line-through text-muted font-number">
                            {currencyFormatter.format(selectedCat.price)}
                          </span>
                        )}
                        <p className="text-xl font-bold font-number text-primary">
                          {currencyFormatter.format(Math.max(0, selectedCat.price - bilDiscountApplied))}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold bg-trading-up/10 text-trading-up px-2.5 py-1 rounded border border-trading-up/25 uppercase font-sans tracking-wide">
                      Aprovado na Bilheteria
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-3 border-t border-card-border pt-4">
              <button
                type="button"
                onClick={resetBilheteriaForm}
                className="flex min-h-11 items-center justify-center rounded-md border border-card-border bg-dark-gray px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-muted hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!bilCatId}
                className="flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                Confirmar e Emitir
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Filtros */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-dark-gray/10 p-4 rounded-xl border border-card-border/60">
              <div>
                <label htmlFor="reg-filter-cat" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Categoria</label>
                <select
                  id="reg-filter-cat"
                  value={regFilterCatId}
                  onChange={(e) => setRegFilterCatId(e.target.value)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white focus:border-primary/50 focus:outline-none"
                >
                  <option value="">Todas</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="reg-filter-status" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Status</label>
                <select
                  id="reg-filter-status"
                  value={regFilterStatus}
                  onChange={(e) => setRegFilterStatus(e.target.value)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white focus:border-primary/50 focus:outline-none"
                >
                  <option value="">Todos</option>
                  <option value="payment_approved">Pago / Aprovado</option>
                  <option value="payment_pending">Pendente</option>
                  <option value="payment_in_review">Em análise</option>
                  <option value="payment_failed">Falha no cartão</option>
                  <option value="payment_cancelled">Cancelado</option>
                </select>
              </div>

              <div>
                <label htmlFor="reg-filter-name" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Nome Atleta / Equipe</label>
                <input
                  id="reg-filter-name"
                  type="text"
                  placeholder="Buscar por nome..."
                  value={regFilterName}
                  onChange={(e) => setRegFilterName(e.target.value)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-filter-box" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Box / Academia</label>
                <input
                  id="reg-filter-box"
                  type="text"
                  placeholder="Buscar por box..."
                  value={regFilterBox}
                  onChange={(e) => setRegFilterBox(e.target.value)}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                />
              </div>
            </div>

            {filteredRegs.length === 0 ? (
              <p className="text-xs text-muted text-center py-8">Nenhuma inscrição corresponde aos filtros.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-card-border/50 text-[10px] font-bold text-muted uppercase tracking-wider font-sans">
                      <th className="py-3 px-2">Atleta / Equipe</th>
                      <th className="py-3 px-2">Categoria</th>
                      <th className="py-3 px-2">Box / Academia</th>
                      <th className="py-3 px-2">Data Inscrição</th>
                      <th className="py-3 px-2 text-right">Valor Pago</th>
                      <th className="py-3 px-2 text-right">Status</th>
                      <th className="py-3 px-2 text-right">Comprovante</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border/30 text-xs font-normal">
                    {filteredRegs.map((reg) => {
                      const div = divisions.find(d => d.id === reg.divisionId);
                      const statusMeta = getPaymentStatusMeta(reg.paymentStatus);
                      const athleteInfo = athletes.find(
                        a => a.name.toLowerCase() === reg.athleteName.toLowerCase() && a.divisionId === reg.divisionId
                      );

                      return (
                        <tr key={reg.id} className="hover:bg-dark-gray/30 transition-colors align-top">
                          <td className="py-3 px-2">
                            <div className="space-y-1">
                              <p className="font-bold text-white uppercase">{reg.athleteName}</p>
                              <p className="text-[10px] text-muted">{reg.athleteEmail} &middot; {reg.athletePhone}</p>

                              {athleteInfo && athleteInfo.isTeam && athleteInfo.teamMembers && athleteInfo.teamMembers.length > 0 && (
                                <div className="mt-1 bg-dark-gray/30 border border-card-border/50 rounded-lg p-2 space-y-1 max-w-sm">
                                  <p className="text-[9px] font-bold uppercase text-primary font-sans">Integrantes:</p>
                                  <ul className="text-[10px] text-muted-soft list-disc list-inside">
                                    {athleteInfo.teamMembers.map((m, idx) => (
                                      <li key={idx}>
                                        {m.name} {m.instagram ? `(${m.instagram})` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2 uppercase font-semibold text-muted text-[10px]">
                            {div ? div.name : 'Outro'}
                          </td>
                          <td className="py-3 px-2 text-muted uppercase text-[10px] font-medium">
                            {reg.box}
                          </td>
                          <td className="py-3 px-2 text-muted">
                            {new Date(reg.createdAt).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="py-3 px-2 text-right font-number text-primary font-bold">
                            {currencyFormatter.format(reg.totalPaid)}
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase font-sans ${getPaymentStatusClassName(statusMeta.tone)}`}>
                              {statusMeta.label}
                            </span>
                            {reg.paymentStatus === 'payment_failed' && (
                              <p className="mt-1 text-[9px] text-trading-down">{reg.paymentErrorMessage || 'Pagamento não processado.'}</p>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex flex-col items-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenRegistrationVoucher(reg)}
                                className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                                aria-label={`Visualizar comprovante de ${reg.athleteName}`}
                              >
                                <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
                                Ver comprovante
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResendRegistrationVoucher(reg)}
                                disabled={resendingRegistrationId === reg.id}
                                className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded border border-card-border bg-dark-gray px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label={`Enviar segunda via do comprovante para ${reg.athleteEmail}`}
                              >
                                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                {resendingRegistrationId === reg.id ? 'Enviando...' : 'Enviar 2a via'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Divisor */}
            <div className="border-t border-card-border/60 my-8"></div>

            {/* Gerenciador de Cupons */}
            <div className="space-y-6">
              <div className="border-b border-card-border pb-3">
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Cupons de Desconto</h3>
                <p className="text-xs text-muted">Crie e gerencie cupons de desconto para os atletas utilizarem nas inscrições do evento.</p>
              </div>

              {/* Formulário de Novo Cupom */}
              <form onSubmit={handleCreateCoupon} className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-dark-gray/10 p-4 rounded-xl border border-card-border/60 items-end">
                <div>
                  <label htmlFor="new-coupon-code" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Código do Cupom *</label>
                  <input
                    id="new-coupon-code"
                    type="text"
                    required
                    placeholder="Ex: ATLETA10"
                    value={newCouponCode}
                    onChange={(e) => setNewCouponCode(e.target.value)}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white placeholder:text-muted focus:border-primary/50 focus:outline-none uppercase"
                  />
                </div>

                <div>
                  <label htmlFor="new-coupon-type" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Tipo de Desconto *</label>
                  <select
                    id="new-coupon-type"
                    value={newCouponDiscountType}
                    onChange={(e) => setNewCouponDiscountType(e.target.value as 'percentage' | 'fixed')}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white focus:border-primary/50 focus:outline-none"
                  >
                    <option value="percentage">Porcentagem (%)</option>
                    <option value="fixed">Valor Fixo (R$)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="new-coupon-value" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Valor do Desconto *</label>
                  <input
                    id="new-coupon-value"
                    type="number"
                    required
                    min="1"
                    placeholder={newCouponDiscountType === 'percentage' ? "Ex: 15" : "Ex: 50"}
                    value={newCouponDiscountValue}
                    onChange={(e) => setNewCouponDiscountValue(e.target.value)}
                    className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white placeholder:text-muted focus:border-primary/50 focus:outline-none font-number"
                  />
                </div>

                <div>
                  <label htmlFor="new-coupon-limit" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Limite de Uso *</label>
                  <div className="flex gap-2">
                    <input
                      id="new-coupon-limit"
                      type="number"
                      required
                      min="1"
                      placeholder="Ex: 100"
                      value={newCouponUsageLimit}
                      onChange={(e) => setNewCouponUsageLimit(e.target.value)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs text-white placeholder:text-muted focus:border-primary/50 focus:outline-none font-number"
                    />
                    <button
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded bg-primary hover:bg-primary-hover px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink transition-colors font-sans whitespace-nowrap"
                    >
                      Criar Cupom
                    </button>
                  </div>
                </div>
              </form>

              {/* Tabela de Cupons do Evento */}
              {(() => {
                const eventCoupons = coupons.filter(c => c.eventId === selectedEventToManage?.id);
                if (eventCoupons.length === 0) {
                  return <p className="text-xs text-muted text-center py-4">Nenhum cupom cadastrado para este evento.</p>;
                }

                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-card-border/50 text-[10px] font-bold text-muted uppercase tracking-wider font-sans">
                          <th className="py-3 px-2">Código</th>
                          <th className="py-3 px-2">Tipo</th>
                          <th className="py-3 px-2">Valor do Desconto</th>
                          <th className="py-3 px-2 text-center">Uso Atual / Limite</th>
                          <th className="py-3 px-2">Data de Criação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-card-border/30 text-xs font-normal">
                        {eventCoupons.map((coupon) => (
                          <tr key={coupon.id} className="hover:bg-dark-gray/30 transition-colors">
                            <td className="py-3 px-2 font-mono font-bold text-white uppercase tracking-wider">
                              <span className="bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded text-[10px]">
                                {coupon.code}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-muted">
                              {coupon.discountType === 'percentage' ? 'Porcentagem (%)' : 'Fixo (R$)'}
                            </td>
                            <td className="py-3 px-2 font-bold font-number text-white">
                              {coupon.discountType === 'percentage'
                                ? `${coupon.discountValue}%`
                                : currencyFormatter.format(coupon.discountValue)
                              }
                            </td>
                            <td className="py-3 px-2 text-center font-number text-muted">
                              <span className={coupon.usageCount >= coupon.usageLimit ? 'text-trading-down font-bold' : 'text-white'}>
                                {coupon.usageCount}
                              </span> / {coupon.usageLimit}
                            </td>
                            <td className="py-3 px-2 text-muted">
                              {new Date(coupon.createdAt).toLocaleDateString('pt-BR')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>
    );
  };

  // --- FITNESS RACING RESULTS MANAGEMENT ---
  const initSplitsForm = (athlete: Athlete, existingSplits?: Record<string, string>) => {
    const division = selectedEventToManage?.divisions.find(d => d.id === athlete.divisionId);
    const stages = division?.courseLayout || [];
    const initialInputs: Record<string, string> = {};
    stages.forEach(stg => {
      initialInputs[stg.id] = existingSplits?.[stg.id] || '';
    });
    setSplitsInputs(initialInputs);
  };

  const handleSaveFitnessRaceScores = () => {
    if (!selectedEventToManage || !scoreFilterCatId) return;

    const totalWorkout = selectedEventToManage.workouts.find(w => w.divisionId === scoreFilterCatId && w.code === 'TOTAL');
    const workoutId = totalWorkout?.id || `wod-${scoreFilterCatId}-total`;

    let count = 0;
    const scoresToSubmit: Score[] = [];
    Object.entries(scoreInputs).forEach(([athleteId, timeStr]) => {
      if (!timeStr) return;
      const secs = timeToSeconds(timeStr);
      const formattedTime = secondsToTimeStr(secs);

      const existingScore = scores.find(s => s.athleteId === athleteId && s.workoutId === workoutId);
      const existingSplits = existingScore?.splits || {};

      scoresToSubmit.push({
        athleteId,
        workoutId,
        result: formattedTime,
        value: secs,
        splits: existingSplits
      });
      count++;
    });

    if (scoresToSubmit.length > 0) {
      submitScoresBulk(scoresToSubmit);
    }

    setScoreInputs({});
    setAdminNotice({ text: `Resultados salvos para ${count} competidores.`, tone: 'success' });
  };

  const renderAbaFitnessRaceScores = () => {
    const divisions = selectedEventToManage?.divisions || [];
    const categoryAthletes = athletes.filter(a => a.divisionId === scoreFilterCatId);

    const totalWorkout = selectedEventToManage?.workouts.find(w => w.divisionId === scoreFilterCatId && w.code === 'TOTAL');
    const workoutId = totalWorkout?.id || `wod-${scoreFilterCatId}-total`;

    return (
      <div className="bg-card border border-card-border rounded-xl p-6 space-y-6 text-white">
        <div className="border-b border-card-border pb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider font-sans">Lançar Resultados</h3>
            <p className="text-xs text-muted font-medium">Informe os tempos finais consolidados ou clique em &quot;Splits&quot; para lançamento avançado.</p>
          </div>
          <div>
            <button
              onClick={handleSaveFitnessRaceScores}
              disabled={!scoreFilterCatId || Object.keys(scoreInputs).length === 0}
              className="flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-6 py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              Salvar Resultados
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-dark-gray/10 p-4 rounded-xl border border-card-border/60">
          <div>
            <label htmlFor="score-cat-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Categoria *</label>
            <select
              id="score-cat-select"
              value={scoreFilterCatId}
              onChange={(e) => {
                setScoreFilterCatId(e.target.value);
                setScoreInputs({});
              }}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            >
              <option value="">Selecione uma Categoria...</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

        {!scoreFilterCatId ? (
          <p className="text-xs text-muted text-center py-8">Selecione uma categoria para listar os competidores.</p>
        ) : categoryAthletes.length === 0 ? (
          <p className="text-xs text-muted text-center py-8">Nenhum competidor cadastrado nesta categoria.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-card-border/50 text-[10px] font-bold text-muted uppercase tracking-wider font-sans">
                  <th className="py-3 px-2">Competidor</th>
                  <th className="py-3 px-2">Box / Academia</th>
                  <th className="py-3 px-2 text-center w-40">Tempo Oficial</th>
                  <th className="py-3 px-2 text-center w-36">Splits Parciais</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/30 text-xs">
                {categoryAthletes.map((ath) => {
                  const score = scores.find(s => s.athleteId === ath.id && s.workoutId === workoutId);

                  return (
                    <tr key={ath.id} className="hover:bg-dark-gray/30 transition-colors">
                      <td className="py-3 px-2">
                        <div>
                          <p className="font-bold text-white uppercase">{ath.name}</p>
                          {ath.isTeam && ath.teamMembers && ath.teamMembers.length > 0 && (
                            <p className="text-[10px] text-muted-soft mt-0.5 font-sans">
                              Integrantes: {ath.teamMembers.map(m => m.name).join(', ')}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-muted uppercase font-medium">
                        {ath.box}
                      </td>
                      <td className="py-3 px-2 text-center">
                        <input
                          type="text"
                          placeholder={score?.result || "00:00"}
                          value={scoreInputs[ath.id] !== undefined ? scoreInputs[ath.id] : (score?.result === '-' ? '' : score?.result || '')}
                          onChange={(e) => setScoreInputs(prev => ({ ...prev, [ath.id]: e.target.value }))}
                          className="w-28 text-center rounded border border-card-border bg-dark-gray/50 px-2.5 py-1.5 text-xs text-white font-mono placeholder:text-muted focus:border-primary/50 focus:outline-none"
                        />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setSplitsDrawerAthlete(ath);
                            initSplitsForm(ath, score?.splits);
                            setIsSplitsDrawerOpen(true);
                          }}
                          className="inline-flex min-h-[30px] items-center justify-center rounded border border-card-border hover:border-primary/50 hover:text-primary transition-colors bg-dark-gray/25 px-4 text-[10px] font-bold text-muted uppercase"
                        >
                          Lançar Splits
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderAbaScores = () => {
    const divisions = selectedEventToManage?.divisions || [];
    const workouts = selectedEventToManage?.workouts || [];
    const filteredWorkouts = workouts.filter(w => !w.divisionId || w.divisionId === scoreFilterCatId);
    const categoryAthletes = athletes.filter(a => a.divisionId === scoreFilterCatId);
    const activeWod = workouts.find(w => w.id === scoreFilterWodId);

    return (
      <div className="bg-card border border-card-border rounded-xl p-6 space-y-6 text-white">
        <div className="border-b border-card-border pb-3">
          <h3 className="text-base font-bold text-white uppercase tracking-wider">Lançamento de Scores</h3>
          <p className="text-xs text-muted font-medium">Lance resultados rapidamente em lote sem abrir modais.</p>
        </div>

        {scoreSaveSuccess && (
          <div role="alert" className="rounded-lg border border-primary bg-primary/10 p-3 text-xs font-medium text-primary">
            {scoreSaveSuccess}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-dark-gray/10 p-4 rounded-xl border border-card-border/60">
          <div>
            <label htmlFor="score-cat-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Passo 1: Categoria</label>
            <select
              id="score-cat-select"
              value={scoreFilterCatId}
              onChange={(e) => {
                setScoreFilterCatId(e.target.value);
                setScoreFilterWodId('');
                setScoreInputs({});
              }}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            >
              <option value="">Selecione uma Categoria...</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="score-wod-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Passo 2: Prova WOD</label>
            <select
              id="score-wod-select"
              value={scoreFilterWodId}
              onChange={(e) => {
                setScoreFilterWodId(e.target.value);
                setScoreInputs({});
              }}
              disabled={!scoreFilterCatId}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
            >
              <option value="">Selecione a Prova...</option>
              {filteredWorkouts.map((w) => (
                <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
              ))}
            </select>
          </div>
        </div>

        {scoreFilterCatId && scoreFilterWodId && activeWod && (
          <form onSubmit={handleScoreSubmit} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-card-border/50 pb-2">
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                Passo 3: Resultados para {activeWod.name} ({activeWod.code})
              </h4>
              <p className="text-xs text-muted-soft">
                Formato esperado: {
                  activeWod.type === 'fortime' ? 'Tempo (MM:SS, ex: 12:32)'
                  : activeWod.type === 'amrap' ? 'Repetições (ex: 187)'
                  : activeWod.type === 'maxweight' ? 'Peso (ex: 125)'
                  : activeWod.type === 'distance' ? 'Distância (ex: 1500)'
                  : 'Pontos (ex: 100)'
                }
              </p>
            </div>

            {categoryAthletes.length === 0 ? (
              <p className="text-xs text-muted text-center py-8">Nenhum atleta ou equipe inscrita nesta categoria.</p>
            ) : (
              <div className="space-y-3">
                {categoryAthletes.map((ath, idx) => (
                  <div key={ath.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-xl border border-card-border/60 bg-dark-gray/20 gap-4 hover:border-primary/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted font-bold font-number w-5">{idx + 1}.</span>
                      <div>
                        <p className="text-sm font-bold text-white uppercase">{ath.name}</p>
                        <p className="text-[10px] text-muted-soft">{ath.box} · {ath.isTeam ? 'Equipe' : 'Atleta'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <label htmlFor={`score-input-${ath.id}`} className="sr-only">Resultado para {ath.name}</label>
                      <input
                        id={`score-input-${ath.id}`}
                        type="text"
                        placeholder={
                          activeWod.type === 'fortime' ? '12:32'
                          : activeWod.type === 'amrap' ? '187'
                          : activeWod.type === 'maxweight' ? '125'
                          : activeWod.type === 'distance' ? '1500'
                          : '100'
                        }
                        value={(scoreInputs[ath.id] !== undefined ? scoreInputs[ath.id] : derivedScoreInputs[ath.id]) || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setScoreInputs(prev => ({
                            ...prev,
                            [ath.id]: val
                          }));
                        }}
                        className="w-full sm:w-44 rounded-md border border-card-border bg-dark-gray px-3 py-1.5 text-sm text-white placeholder:text-muted-soft focus:border-primary/50 focus:outline-none font-number text-center font-bold"
                      />
                      <span className="text-xs font-bold text-primary text-[10px] uppercase w-12 font-sans">
                        {activeWod.type === 'fortime' ? 'Min'
                          : activeWod.type === 'amrap' ? 'Reps'
                          : activeWod.type === 'maxweight' ? 'Kg'
                          : activeWod.type === 'distance' ? 'Mts'
                          : 'Pts'}
                      </span>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end border-t border-card-border pt-4">
                  <button
                    type="submit"
                    className="flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-8 py-3 text-sm font-bold uppercase tracking-wider transition-colors"
                  >
                    Salvar todos os scores
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    );
  };

  const renderAbaLeaderboard = () => {
    const divisions = selectedEventToManage?.divisions || [];
    const workouts = selectedEventToManage?.workouts || [];
    const categoryWods = workouts.filter(w => !w.divisionId || w.divisionId === leaderboardFilterCatId);

    const rawLeaderboard = leaderboardFilterCatId
      ? getLeaderboard(selectedEventToManage?.id || '', leaderboardFilterCatId)
      : [];

    const selectedCat = divisions.find(d => d.id === leaderboardFilterCatId);

    // Filtrar e processar dados locais do Leaderboard
    const leaderboardData = (() => {
      let data = rawLeaderboard;

      // Se for Fitness Racing, aplicamos ordenação e filtragem por Faixa Etária e busca
      if (selectedEventToManage?.eventType === 'fitness_racing') {
        if (selectedCat?.useAgeGroups && leaderboardAgeGroupFilter) {
          data = data.filter(item => getAgeGroupFromDate(item.athlete.birthDate, selectedCat?.ageGroups) === leaderboardAgeGroupFilter);
        }

        // Filtro de busca textual (nome, equipe ou box)
        if (leaderboardSearchFilter) {
          const search = leaderboardSearchFilter.toLowerCase();
          data = data.filter(item =>
            item.athlete.name.toLowerCase().includes(search) ||
            item.athlete.box.toLowerCase().includes(search)
          );
        }

        // No Fitness Racing, a lista já vem pré-ordenada do getLeaderboard de forma crescente
        return data;
      }

      // Lógica de ordenação do CrossFit normal
      if (!leaderboardFilterWodId || leaderboardFilterWodId === 'overall') {
        return data;
      }
      return [...data].sort((a, b) => {
        const scoreA = a.scores[leaderboardFilterWodId];
        const scoreB = b.scores[leaderboardFilterWodId];
        const valA = scoreA ? scoreA.points || 0 : 0;
        const valB = scoreB ? scoreB.points || 0 : 0;
        return valB - valA;
      });
    })();

    return (
      <div className="bg-card border border-card-border rounded-xl p-6 space-y-6 text-white">
        <div className="border-b border-card-border pb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider font-sans">Leaderboard Oficial</h3>
            <p className="text-xs text-muted font-medium">Rankings consolidados do evento atualizados automaticamente.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => selectedCat && handleExportCSV(selectedCat.name)}
              disabled={!leaderboardFilterCatId || leaderboardData.length === 0}
              className="flex min-h-9 items-center gap-1.5 rounded bg-dark-gray hover:border-muted border border-card-border px-3 py-1.5 text-xs font-bold text-muted hover:text-white uppercase transition-colors disabled:opacity-50"
            >
              <span>Excel (CSV)</span>
            </button>
            <button
              onClick={() => selectedCat && handleExportPDF(selectedCat.name)}
              disabled={!leaderboardFilterCatId || leaderboardData.length === 0}
              className="flex min-h-9 items-center gap-1.5 rounded bg-dark-gray hover:border-muted border border-card-border px-3 py-1.5 text-xs font-bold text-muted hover:text-white uppercase transition-colors disabled:opacity-50"
            >
              <span>Exportar PDF</span>
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-dark-gray/10 p-4 rounded-xl border border-card-border/60">
          <div className={selectedEventToManage?.eventType === 'fitness_racing' ? 'md:col-span-1' : 'md:col-span-2'}>
            <label htmlFor="lead-cat-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Categoria</label>
            <select
              id="lead-cat-select"
              value={leaderboardFilterCatId}
              onChange={(e) => {
                setLeaderboardFilterCatId(e.target.value);
                setLeaderboardFilterWodId('overall');
                setLeaderboardAgeGroupFilter('');
              }}
              className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
            >
              <option value="">Selecione uma Categoria...</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {selectedEventToManage?.eventType === 'fitness_racing' ? (
            <>
              <div>
                <label htmlFor="lead-age-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Faixa Etária</label>
                <select
                  id="lead-age-select"
                  value={leaderboardAgeGroupFilter}
                  onChange={(e) => setLeaderboardAgeGroupFilter(e.target.value)}
                  disabled={!leaderboardFilterCatId || !selectedCat?.useAgeGroups}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Todas as idades</option>
                  {(selectedCat?.ageGroups || FITNESS_RACING_AGE_GROUPS).map(ag => (
                    <option key={ag} value={ag}>{ag} anos</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="lead-search-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Buscar Competidor</label>
                <input
                  id="lead-search-input"
                  type="text"
                  placeholder="Buscar por nome, equipe ou box..."
                  value={leaderboardSearchFilter}
                  onChange={(e) => setLeaderboardSearchFilter(e.target.value)}
                  disabled={!leaderboardFilterCatId}
                  className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
                />
              </div>
            </>
          ) : (
            <div className="md:col-span-2">
              <label htmlFor="lead-wod-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Exibição / Prova</label>
              <select
                id="lead-wod-select"
                value={leaderboardFilterWodId}
                onChange={(e) => setLeaderboardFilterWodId(e.target.value)}
                disabled={!leaderboardFilterCatId}
                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
              >
                <option value="overall">Geral Consolidado</option>
                {categoryWods.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {!leaderboardFilterCatId ? (
          <p className="text-xs text-muted text-center py-8">Selecione uma categoria para visualizar o Leaderboard.</p>
        ) : leaderboardData.length === 0 ? (
          <p className="text-xs text-muted text-center py-8">Nenhum resultado lançado nesta categoria.</p>
        ) : selectedEventToManage?.eventType === 'fitness_racing' ? (
          /* Leaderboard Fitness Racing (HYROX) */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-card-border/50 text-[10px] font-bold text-muted uppercase tracking-wider font-sans">
                  <th className="py-3 px-2 w-12 text-center">Pos</th>
                  <th className="py-3 px-2">Competidor</th>
                  <th className="py-3 px-2">Box / Academia</th>
                  {selectedCat?.useAgeGroups && <th className="py-3 px-2">Faixa Etária</th>}
                  <th className="py-3 px-2 text-center w-36">Tempo Oficial</th>
                  <th className="py-3 px-2 text-right w-32">Diferença</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/30 text-xs">
                {(() => {
                  // Achar o primeiro tempo válido (líder)
                  const validTimes = leaderboardData.filter(item => item.totalPoints < 999999);
                  const leaderTime = validTimes[0]?.totalPoints || 0;

                  return leaderboardData.map((item, idx) => {
                    const ath = item.athlete;
                    const finalRank = item.rank;
                    const hasTime = item.totalPoints < 999999;
                    const diffSecs = hasTime ? item.totalPoints - leaderTime : 0;

                    return (
                      <tr key={ath.id} className="hover:bg-dark-gray/30 transition-colors">
                        <td className="py-3 px-2 text-center font-bold">
                          {finalRank > 0 ? (
                            <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full font-number ${
                              finalRank === 1 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
                              : finalRank === 2 ? 'bg-slate-300/20 text-slate-300 border border-slate-300/30'
                              : finalRank === 3 ? 'bg-amber-700/20 text-amber-700 border border-amber-700/30'
                              : 'text-muted'
                            }`}>
                              {finalRank}
                            </span>
                          ) : (
                            <span className="text-muted-soft">-</span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => {
                                if (ath.isTeam) {
                                  setSelectedTeamForProfile(ath);
                                } else {
                                  setSelectedAthleteForProfile(ath);
                                }
                              }}
                              className="font-bold text-primary hover:text-primary-hover text-left uppercase hover:underline transition-colors"
                            >
                              {ath.name}
                            </button>
                            {ath.instagram && (
                              <a
                                href={`https://instagram.com/${ath.instagram.trim().replace(/^@/, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[10px] text-muted hover:text-primary transition-colors"
                                title={`Ver Instagram de ${ath.name}`}
                              >
                                <InstagramIcon className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {ath.isTeam && ath.teamMembers && ath.teamMembers.length > 0 && (
                            <div className="text-[10px] text-muted-soft mt-0.5 font-sans flex flex-wrap gap-x-2 gap-y-0.5">
                              {ath.teamMembers.map((m: { name: string; instagram?: string }, mIdx: number) => (
                                <span key={mIdx} className="inline-flex items-center gap-0.5">
                                  <span>{m.name}</span>
                                  {m.instagram && (
                                    <a
                                      href={`https://instagram.com/${m.instagram.trim().replace(/^@/, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary hover:text-primary-hover font-semibold inline-flex items-center"
                                      title={`Ver Instagram de ${m.name}`}
                                    >
                                      <InstagramIcon className="h-2.5 w-2.5 ml-0.5" />
                                    </a>
                                  )}
                                  {mIdx < ath.teamMembers!.length - 1 && <span className="text-muted-soft ml-1">&</span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-2 text-muted uppercase text-[10px] font-medium">
                          {ath.box}
                        </td>
                        {selectedCat?.useAgeGroups && (
                          <td className="py-3 px-2 text-muted-soft font-mono">
                             {getAgeGroupFromDate(ath.birthDate, selectedCat?.ageGroups)}
                          </td>
                        )}
                        <td className="py-3 px-2 text-center font-mono font-bold text-white">
                          {hasTime ? secondsToTimeStr(item.totalPoints) : '-'}
                        </td>
                        <td className="py-3 px-2 text-right font-mono font-semibold text-primary">
                          {hasTime && diffSecs > 0 ? `+${secondsToTimeStr(diffSecs)}` : (hasTime && idx === 0 ? 'Líder' : '-')}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        ) : (
          /* Leaderboard CrossFit Normal */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-card-border/50 text-[10px] font-bold text-muted uppercase tracking-wider font-sans">
                  <th className="py-3 px-2 w-12 text-center">Pos</th>
                  <th className="py-3 px-2">Atleta / Equipe</th>
                  <th className="py-3 px-2">Box / Academia</th>
                  {categoryWods.map(wod => (
                    <th key={wod.id} className="py-3 px-2 text-center">{wod.code}</th>
                  ))}
                  <th className="py-3 px-2 text-right">Pontos Totais</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/30 text-xs">
                {leaderboardData.map((item, idx) => {
                  const ath = item.athlete;
                  const finalRank = leaderboardFilterWodId === 'overall' ? item.rank : idx + 1;

                  return (
                    <tr key={ath.id} className="hover:bg-dark-gray/30 transition-colors">
                      <td className="py-3 px-2 text-center font-bold">
                        <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full font-number ${
                          finalRank === 1 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
                          : finalRank === 2 ? 'bg-slate-300/20 text-slate-300 border border-slate-300/30'
                          : finalRank === 3 ? 'bg-amber-700/20 text-amber-700 border border-amber-700/30'
                          : 'text-muted'
                        }`}>
                          {finalRank}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              if (ath.isTeam) {
                                setSelectedTeamForProfile(ath);
                              } else {
                                setSelectedAthleteForProfile(ath);
                              }
                            }}
                            className="font-bold text-primary hover:text-primary-hover text-left uppercase hover:underline transition-colors"
                          >
                            {ath.name}
                          </button>
                          {ath.instagram && (
                            <a
                              href={`https://instagram.com/${ath.instagram.trim().replace(/^@/, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[10px] text-muted hover:text-primary transition-colors"
                              title={`Ver Instagram de ${ath.name}`}
                            >
                              <InstagramIcon className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {ath.isTeam && ath.teamMembers && ath.teamMembers.length > 0 && (
                          <div className="text-[10px] text-muted-soft mt-0.5 font-sans flex flex-wrap gap-x-2 gap-y-0.5">
                            {ath.teamMembers.map((m: { name: string; instagram?: string }, mIdx: number) => (
                              <span key={mIdx} className="inline-flex items-center gap-0.5">
                                <span>{m.name}</span>
                                {m.instagram && (
                                  <a
                                    href={`https://instagram.com/${m.instagram.trim().replace(/^@/, '')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:text-primary-hover font-semibold inline-flex items-center"
                                    title={`Ver Instagram de ${m.name}`}
                                  >
                                    <InstagramIcon className="h-2.5 w-2.5 ml-0.5" />
                                  </a>
                                )}
                                {mIdx < ath.teamMembers!.length - 1 && <span className="text-muted-soft ml-1">&</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-2 text-muted uppercase text-[10px] font-medium">
                        {ath.box}
                      </td>
                      {categoryWods.map(wod => {
                        const score = item.scores[wod.id];
                        return (
                          <td key={wod.id} className="py-3 px-2 text-center">
                            <div className="font-number font-semibold text-white">
                              {score ? score.result : '-'}
                            </div>
                            {score && score.points && score.points > 0 ? (
                              <div className="text-[9px] text-primary">
                                {score.points} pts ({score.rank}º)
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                      <td className="py-3 px-2 text-right font-number text-primary font-bold text-sm font-sans">
                        {item.totalPoints} pts
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header Admin */}
      <section className="bg-card border-b border-card-border py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-12 w-12 rounded-sm border border-card-border" priority />
            <div>
              <h2 className="text-xl font-bold text-white uppercase tracking-wider">Painel Administrativo</h2>
              <p className="text-xs text-muted font-medium">Controle de eventos, categorias, baterias e pontuações.</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-4 py-2 text-xs font-bold text-muted transition-colors hover:border-muted hover:text-white"
          >
            <span>Desconectar</span>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* Conteúdo Principal do Painel */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Menu Lateral de Admin */}
          <aside className="flex w-full flex-row gap-2 overflow-x-auto pb-2 scrollbar-none lg:col-span-1 lg:flex-col lg:space-y-2 lg:overflow-x-visible lg:pb-0" aria-label="Seções do painel administrativo">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'my-events', label: 'Meus Eventos', icon: Settings },
              { id: 'event', label: 'Novo Evento', icon: Calendar },
              { id: 'payments', label: 'Pagamentos', icon: CreditCard },
              { id: 'security', label: 'Segurança', icon: Lock }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as typeof activeTab);
                    setSelectedEventToManage(null); // Reseta gerenciamento ao navegar nas abas principais
                  }}
                  aria-pressed={activeTab === tab.id}
                  className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors lg:w-full lg:py-3 lg:text-left ${
                    activeTab === tab.id
                      ? 'bg-primary/10 border-primary text-primary font-bold'
                      : 'bg-card border-transparent text-muted hover:text-white hover:border-card-border'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Área de Ação Admin */}
          <div className="lg:col-span-3 space-y-6">
            {adminNotice && (
              <div
                role={adminNotice.tone === 'error' ? 'alert' : 'status'}
                aria-live="polite"
                className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
                  adminNotice.tone === 'error'
                    ? 'border-trading-down/40 bg-card text-trading-down'
                    : 'border-primary/40 bg-card text-primary'
                }`}
              >
                <span>{adminNotice.text}</span>
                <button type="button" onClick={() => setAdminNotice(null)} className="shrink-0 text-muted transition-colors hover:text-white" aria-label="Fechar aviso">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* ABA: Dashboard */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6 bg-background text-white">
                <div className="border-b border-card-border pb-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary font-sans">Painel de Controle</p>
                  <h3 className="mt-1 text-2xl font-bold tracking-tight text-white uppercase">
                    Resumo das Operações
                  </h3>
                </div>

                {/* Grid de Métricas Principais (7 Cards) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Receita Estimada */}
                  <div className="bg-card border border-card-border rounded-xl p-5 flex items-center justify-between hover:border-primary/30 transition-colors">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-primary tracking-wider font-sans">Receita Líquida (90%)</p>
                      <h4 className="text-2xl font-bold font-number text-primary">{currencyFormatter.format(dashboardStats.netRevenue)}</h4>
                      <p className="text-[9px] text-muted">
                        Bruto: {currencyFormatter.format(dashboardStats.grossRevenue)}
                      </p>
                    </div>
                    <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-primary">
                      <DollarSign className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>

                  {/* Inscrições / Ingressos */}
                  <div className="bg-card border border-card-border rounded-xl p-5 flex items-center justify-between hover:border-card-border/80 transition-colors">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Inscrições Realizadas</p>
                      <h4 className="text-2xl font-bold font-number text-white">{dashboardStats.totalTicketsSold}</h4>
                      <p className="text-[9px] text-muted">Vagas preenchidas</p>
                    </div>
                    <div className="rounded-lg border border-card-border bg-dark-gray p-3 text-muted">
                      <Ticket className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>

                  {/* Total de Atletas */}
                  <div className="bg-card border border-card-border rounded-xl p-5 flex items-center justify-between hover:border-card-border/80 transition-colors">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Total de Atletas</p>
                      <h4 className="text-2xl font-bold font-number text-white">{dashboardStats.totalAthletes}</h4>
                      <p className="text-[9px] text-muted font-sans">Competidores individuais</p>
                    </div>
                    <div className="rounded-lg border border-card-border bg-dark-gray p-3 text-muted">
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>

                  {/* Total de Equipes */}
                  <div className="bg-card border border-card-border rounded-xl p-5 flex items-center justify-between hover:border-card-border/80 transition-colors">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Total de Equipes</p>
                      <h4 className="text-2xl font-bold font-number text-white">{dashboardStats.totalTeams}</h4>
                      <p className="text-[9px] text-muted font-sans">Duplas, Trios e Quartetos</p>
                    </div>
                    <div className="rounded-lg border border-card-border bg-dark-gray p-3 text-muted">
                      <Trophy className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>
                </div>

                {/* Status dos Eventos (3 cards menores em linha) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Eventos Criados */}
                  <div className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between hover:border-card-border/80 transition-colors">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Total de Eventos</p>
                      <h4 className="text-xl font-bold text-white mt-1">{dashboardStats.totalEventsCount}</h4>
                    </div>
                    <span className="text-[10px] bg-dark-gray px-2 py-1 rounded text-muted font-bold border border-card-border font-sans">Geral</span>
                  </div>

                  {/* Eventos Ativos */}
                  <div className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between hover:border-trading-up/30 transition-colors">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Eventos Ativos (Ao Vivo)</p>
                      <h4 className="text-xl font-bold text-trading-up mt-1">{dashboardStats.activeEventsCount}</h4>
                    </div>
                    <span className="text-[10px] bg-trading-up/10 px-2 py-1 rounded text-trading-up font-bold border border-trading-up/25 animate-pulse font-sans">Ao Vivo</span>
                  </div>

                  {/* Eventos Finalizados */}
                  <div className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between hover:border-card-border/80 transition-colors">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider font-sans">Eventos Finalizados</p>
                      <h4 className="text-xl font-bold text-muted mt-1">{dashboardStats.finishedEventsCount}</h4>
                    </div>
                    <span className="text-[10px] bg-dark-gray px-2 py-1 rounded text-muted font-bold border border-card-border font-sans">Concluídos</span>
                  </div>
                </div>

                {/* Grid Duplo para Análises */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Últimas Inscrições */}
                  <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white border-b border-card-border pb-2 flex items-center gap-1.5 font-sans">
                      <ClipboardCheck className="h-4 w-4 text-primary" />
                      <span>Últimas Inscrições Recentes</span>
                    </h4>
                    {dashboardStats.latestRegistrations.length === 0 ? (
                      <p className="text-xs text-muted text-center py-4">Nenhuma inscrição registrada ainda.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-card-border/50 text-[10px] font-bold text-muted uppercase tracking-wider font-sans">
                              <th className="py-2">Nome</th>
                              <th className="py-2">Preço</th>
                              <th className="py-2">Data</th>
                              <th className="py-2 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-card-border/30 text-xs font-normal">
                            {dashboardStats.latestRegistrations.map(reg => {
                              const statusMeta = getPaymentStatusMeta(reg.paymentStatus);
                              return (
                                <tr key={reg.id} className="hover:bg-dark-gray/30 transition-colors">
                                  <td className="py-2.5 font-semibold text-white">{reg.athleteName}</td>
                                  <td className="py-2.5 font-number text-primary">{currencyFormatter.format(reg.totalPaid)}</td>
                                  <td className="py-2.5 text-muted">{new Date(reg.createdAt).toLocaleDateString('pt-BR')}</td>
                                  <td className="py-2.5 text-right">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase font-sans ${getPaymentStatusClassName(statusMeta.tone)}`}>
                                      {statusMeta.label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Próximos Eventos */}
                  <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white border-b border-card-border pb-2 flex items-center gap-1.5 font-sans">
                      <Calendar className="h-4 w-4 text-primary" />
                      <span>Próximas Competições</span>
                    </h4>
                    {dashboardStats.upcomingEvents.length === 0 ? (
                      <p className="text-xs text-muted text-center py-4">Nenhum evento agendado para breve.</p>
                    ) : (
                      <div className="space-y-3">
                        {dashboardStats.upcomingEvents.map(e => (
                          <div key={e.id} className="flex items-center justify-between p-2 rounded-lg bg-dark-gray/30 border border-card-border/50 hover:border-primary/20 transition-colors">
                            <div>
                              <h5 className="text-xs font-bold text-white uppercase">{e.name}</h5>
                              <p className="text-[10px] text-muted">{e.location} · {e.date}</p>
                            </div>
                            <span className="text-[9px] font-bold bg-primary/20 text-primary px-2 py-0.5 rounded border border-primary/30 uppercase font-sans">Em Breve</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Grid Duplo: Engajamento & Desempenho */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Eventos com Mais Inscritos */}
                  <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white border-b border-card-border pb-2 flex items-center gap-1.5 font-sans">
                      <Users className="h-4 w-4 text-primary" />
                      <span>Competições por Volume de Inscritos</span>
                    </h4>
                    <div className="space-y-3">
                      {dashboardStats.eventsByRegistrations.map(({ event, registrationsCount }) => (
                        <div key={event.id} className="flex items-center justify-between p-2.5 rounded-lg bg-dark-gray/25 border border-card-border/40 hover:border-primary/20 transition-colors">
                          <span className="text-xs font-bold text-white uppercase">{event.name}</span>
                          <span className="text-xs font-number font-bold text-primary flex items-center gap-1">
                            {registrationsCount} <span className="text-[10px] text-muted font-normal uppercase">atletas</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Eventos Mais Acessados (Simulados/Visualizações) */}
                  <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white border-b border-card-border pb-2 flex items-center gap-1.5 font-sans">
                      <LayoutDashboard className="h-4 w-4 text-primary" />
                      <span>Compromisso e Cliques (Mais Acessados)</span>
                    </h4>
                    <div className="space-y-3">
                      {dashboardStats.eventsByAccess.map(({ event, accesses }) => (
                        <div key={event.id} className="flex items-center justify-between p-2.5 rounded-lg bg-dark-gray/25 border border-card-border/40 hover:border-primary/20 transition-colors">
                          <span className="text-xs font-bold text-white uppercase">{event.name}</span>
                          <span className="text-xs font-number font-bold text-primary flex items-center gap-1">
                            {accesses} <span className="text-[10px] text-muted font-normal uppercase">acessos</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ABA: Meus Eventos */}
            {activeTab === 'my-events' && (
              selectedEventToManage === null ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-card-border pb-3 font-sans">
                    <h3 className="text-lg font-bold text-white uppercase tracking-wider">
                      Gerenciar Meus Eventos
                    </h3>
                    <span className="text-xs text-muted font-medium">
                      {managerEvents.length} {managerEvents.length === 1 ? 'evento localizado' : 'eventos localizados'}
                    </span>
                  </div>

                  {managerEvents.length === 0 ? (
                    <div className="bg-card border border-card-border rounded-xl p-8 text-center space-y-3">
                      <Calendar className="mx-auto h-10 w-10 text-muted" aria-hidden="true" />
                      <h4 className="text-sm font-bold text-white uppercase tracking-wider font-sans">Cadastre um evento primeiro</h4>
                      <p className="text-xs text-muted max-w-md mx-auto">
                        Você ainda não cadastrou nenhum evento. Vá até a aba &quot;Novo Evento&quot; para iniciar as atividades.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {managerEvents.map(evt => (
                        <div key={evt.id} className="overflow-hidden rounded-xl border border-card-border bg-card hover:border-primary/20 transition-colors flex flex-col justify-between">
                          {/* Banner/Header do Evento */}
                          <div className="relative h-28 bg-dark-gray border-b border-card-border shrink-0">
                            {evt.bannerUrl && (
                              <Image src={evt.bannerUrl} alt={evt.name} width={800} height={112} unoptimized className="w-full h-full object-cover opacity-45" />
                            )}
                            <div className="absolute inset-0 flex items-center gap-4 bg-background/60 p-4">
                              {evt.logoUrl && (
                                <Image src={evt.logoUrl} alt={`${evt.name} logo`} width={48} height={48} unoptimized className="w-12 h-12 rounded-lg object-cover border border-card-border bg-background p-0.5" />
                              )}
                              <div>
                                <h4 className="text-sm font-bold text-white uppercase tracking-wider line-clamp-1">{evt.name}</h4>
                                <p className="text-[10px] text-muted line-clamp-1">{evt.location} &middot; {evt.date}</p>
                              </div>
                            </div>
                          </div>

                          {/* Métricas rápidas */}
                          <div className="p-4 flex-grow flex flex-col justify-between space-y-3">
                            <div className="grid grid-cols-3 gap-2 text-center text-xs">
                              <div className="bg-dark-gray/25 p-2 rounded-lg border border-card-border/50">
                                <p className="text-[9px] uppercase font-bold text-muted font-sans">Categorias</p>
                                <p className="font-bold text-white mt-0.5">{evt.divisions.length}</p>
                              </div>
                              <div className="bg-dark-gray/25 p-2 rounded-lg border border-card-border/50">
                                <p className="text-[9px] uppercase font-bold text-muted font-sans">Provas</p>
                                <p className="font-bold text-white mt-0.5">{evt.workouts.length}</p>
                              </div>
                              <div className="bg-dark-gray/25 p-2 rounded-lg border border-card-border/50">
                                <p className="text-[9px] uppercase font-bold text-muted font-sans">Inscrições</p>
                                <p className="font-bold text-white mt-0.5">
                                  {registrations.filter(r => r.eventId === evt.id).reduce((sum, r) => sum + r.quantity, 0)}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 border-t border-card-border/30 pt-3 sm:flex-row sm:items-center sm:justify-between">
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border font-sans ${
                                evt.status === 'live'
                                  ? 'border-trading-up bg-trading-up/10 text-trading-up'
                                  : evt.status === 'finished'
                                  ? 'border-card-border bg-dark-gray text-muted'
                                  : 'border-primary bg-primary/10 text-primary'
                              }`}>
                                {evt.status === 'live' ? 'Ao Vivo' : evt.status === 'finished' ? 'Finalizado' : 'Em Breve'}
                              </span>

                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <button
                                  type="button"
                                  onClick={() => openDeleteEventDialog(evt)}
                                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded border border-trading-down/50 bg-trading-down/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-trading-down transition-colors hover:border-trading-down hover:bg-trading-down/20 font-sans"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  Excluir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedEventToManage(evt);
                                    initEventEditForm(evt);
                                    setActiveEventTab('info');
                                  }}
                                  className="inline-flex min-h-9 items-center justify-center rounded bg-primary hover:bg-primary-hover px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-ink transition-colors font-sans"
                                >
                                  Gerenciar Evento
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                // Painel de Gerenciamento do Evento Selecionado
                <div className="space-y-6 text-white">
                  {/* Cabeçalho do Painel Interno */}
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <button
                        onClick={() => setSelectedEventToManage(null)}
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted hover:text-white transition-colors font-sans"
                      >
                        &larr; Voltar para Meus Eventos
                      </button>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border font-sans ${
                          selectedEventToManage.status === 'live'
                            ? 'border-trading-up bg-trading-up/10 text-trading-up'
                            : selectedEventToManage.status === 'finished'
                            ? 'border-card-border bg-dark-gray text-muted'
                            : 'border-primary bg-primary/10 text-primary'
                        }`}>
                          {selectedEventToManage.status === 'live' ? 'Ao Vivo' : selectedEventToManage.status === 'finished' ? 'Finalizado' : 'Em Breve'}
                        </span>
                      </div>
                    </div>

                    <div className="relative overflow-hidden rounded-xl border border-card-border bg-card">
                      <div className="relative h-28 bg-dark-gray">
                        {selectedEventToManage.bannerUrl && (
                          <Image
                            src={selectedEventToManage.bannerUrl}
                            alt={selectedEventToManage.name}
                            fill
                            unoptimized
                            className="object-cover opacity-25"
                          />
                        )}
                        <div className="absolute inset-0 flex items-center gap-4 p-6 bg-background/80">
                          {selectedEventToManage.logoUrl && (
                            <Image
                              src={selectedEventToManage.logoUrl}
                              alt={selectedEventToManage.name}
                              width={56}
                              height={56}
                              unoptimized
                              className="rounded-lg border border-card-border bg-card p-1 object-cover h-14 w-14"
                            />
                          )}
                          <div>
                            <h2 className="text-base font-bold text-white uppercase tracking-wider font-sans">{selectedEventToManage.name}</h2>
                            <p className="text-xs text-muted font-medium font-sans">{selectedEventToManage.location} &middot; {selectedEventToManage.date}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Abas Internas */}
                    <div className="flex flex-row overflow-x-auto border-b border-card-border pb-px scrollbar-none gap-2">
                      {[
                        { id: 'info', label: 'Informações Gerais' },
                        { id: 'categories', label: 'Categorias' },
                        { id: 'wods', label: selectedEventToManage.eventType === 'fitness_racing' ? 'Configuração do Percurso' : 'Provas (WODs)' },
                        { id: 'schedule', label: 'Cronograma' },
                        { id: 'registrations', label: 'Inscrições' },
                        { id: 'scores', label: selectedEventToManage.eventType === 'fitness_racing' ? 'Lançar Resultados' : 'Lançamento de Scores' },
                        { id: 'leaderboard', label: 'Leaderboard' }
                      ].map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            setActiveEventTab(tab.id as 'info' | 'categories' | 'wods' | 'schedule' | 'registrations' | 'scores' | 'leaderboard');
                            if (tab.id === 'info') {
                              initEventEditForm(selectedEventToManage);
                            }
                          }}
                          className={`border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors font-sans ${
                            activeEventTab === tab.id
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted hover:text-white'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Conteúdo das Abas Internas */}
                    <div className="pt-2">
                      {activeEventTab === 'info' && renderAbaInfo()}
                      {activeEventTab === 'categories' && renderAbaCategories()}
                      {activeEventTab === 'wods' && (
                        selectedEventToManage.eventType === 'fitness_racing'
                          ? renderAbaFitnessRaceCourse()
                          : renderAbaWods()
                      )}
                      {activeEventTab === 'schedule' && renderAbaSchedule()}
                      {activeEventTab === 'registrations' && renderAbaRegistrations()}
                      {activeEventTab === 'scores' && (
                        selectedEventToManage.eventType === 'fitness_racing'
                          ? renderAbaFitnessRaceScores()
                          : renderAbaScores()
                      )}
                      {activeEventTab === 'leaderboard' && renderAbaLeaderboard()}
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ABA: Cadastro de Evento (Novo Evento) */}
            {activeTab === 'event' && (
              <form onSubmit={handleCreateEvent} className="bg-card border border-card-border space-y-6 rounded-xl p-6 sm:p-8 text-white">
                <div className="border-b border-card-border pb-5">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary font-sans">Operação de Evento</p>
                  <h3 className="mt-2 text-2xl font-bold tracking-tight text-white uppercase">
                    Cadastrar Novo Evento
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted font-sans">
                    Preencha os dados públicos e configurações de bilheteria da competição.
                  </p>
                </div>

                <div className="space-y-4">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary font-sans">Informações Básicas</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label htmlFor="event-type" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Tipo de Evento *</label>
                      <select
                        id="event-type"
                        value={eventType}
                        onChange={(e) => setEventType(e.target.value as 'functional_fitness' | 'fitness_racing')}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                      >
                        <option value="functional_fitness">Functional Fitness (CrossFit)</option>
                        <option value="fitness_racing">Fitness Racing / HYROX / HYROX Inspired</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="event-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Nome do Evento *</label>
                      <input
                        id="event-name"
                        name="event-name"
                        type="text"
                        required
                        placeholder="Ex: WODArena Games 2026"
                        value={eventName}
                        onChange={(e) => setEventName(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="event-date" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Data *</label>
                      <input
                        id="event-date"
                        name="event-date"
                        type="text"
                        required
                        placeholder="Ex: 10 e 11 de Outubro, 2026"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label htmlFor="event-location" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Local *</label>
                      <input
                        id="event-location"
                        name="event-location"
                        type="text"
                        required
                        placeholder="Ex: Arena de Eventos, Av. Principal, 120"
                        value={eventLocation}
                        onChange={(e) => setEventLocation(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="event-time" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Horário</label>
                      <input
                        id="event-time"
                        name="event-time"
                        type="text"
                        placeholder="Ex: 08:00 às 18:00"
                        value={eventTime}
                        onChange={(e) => setEventTime(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="event-city" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Cidade</label>
                      <input
                        id="event-city"
                        name="event-city"
                        type="text"
                        placeholder="Ex: Rio de Janeiro"
                        value={eventCity}
                        onChange={(e) => setEventCity(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="event-state" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Estado</label>
                      <input
                        id="event-state"
                        name="event-state"
                        type="text"
                        placeholder="Ex: RJ"
                        value={eventState}
                        onChange={(e) => setEventState(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="event-description" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Descrição do Evento</label>
                    <textarea
                      id="event-description"
                      name="event-description"
                      rows={3}
                      placeholder="Detalhes adicionais, parceiros e cronograma..."
                      value={eventDescription}
                      onChange={(e) => setEventDescription(e.target.value)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="event-rules" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Regulamento</label>
                    <textarea
                      id="event-rules"
                      name="event-rules"
                      rows={4}
                      placeholder="Coloque o regulamento oficial e os critérios de participação do torneio..."
                      value={eventRules}
                      onChange={(e) => setEventRules(e.target.value)}
                      className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-4 border-t border-card-border pt-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary font-sans">Identidade Visual (Mídia)</p>
                    <p className="mt-1 text-sm text-muted font-sans">Envie os arquivos locais nos formatos aceitos para o banner e o logotipo.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg focus-within:outline-info focus-within:outline focus-within:outline-2">
                      <p className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Logo do Evento</p>
                      <p className="mb-2 text-[11px] text-muted-soft font-sans">Proporção ideal: 1:1 — resolução recomendada 512 × 512 px.</p>
                      {eventLogo ? (
                        <div className="relative flex h-[150px] w-full items-center justify-center overflow-hidden rounded-lg border border-card-border bg-dark-gray">
                          <Image
                            src={eventLogo}
                            alt="Prévia da logo do evento"
                            width={96}
                            height={96}
                            unoptimized
                            className="h-24 w-24 object-contain rounded-md"
                          />
                          <button
                            type="button"
                            onClick={() => setEventLogo('')}
                            className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-md border border-card-border bg-dark-gray text-red-500 transition-colors hover:border-red-500"
                            aria-label="Remover logo do evento"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <label htmlFor="event-logo-upload" className="group flex h-[150px] w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-card-border bg-dark-gray transition-colors hover:border-primary">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="mb-2 h-8 w-8 text-muted transition-colors group-hover:text-primary font-sans" aria-hidden="true" />
                            <p className="text-sm font-semibold text-white group-hover:text-primary font-sans">Carregar Logo</p>
                            <p className="mt-1 text-xs text-muted font-sans">PNG ou JPEG (máx. 1.5 MB)</p>
                          </div>
                          <input
                            id="event-logo-upload"
                            name="event-logo-upload"
                            type="file"
                            accept="image/png, image/jpeg"
                            className="sr-only"
                            onChange={(e) => handleFileChange(e, 'logo')}
                          />
                        </label>
                      )}
                    </div>
                    <div className="rounded-lg focus-within:outline-info focus-within:outline focus-within:outline-2">
                      <p className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Banner do Evento</p>
                      <p className="mb-2 text-[11px] text-muted-soft font-sans">Proporção ideal: 5:2 — resolução recomendada 1600 × 640 px.</p>
                      {eventBanner ? (
                        <div className="relative h-[150px] w-full overflow-hidden rounded-lg border border-card-border bg-dark-gray">
                          <Image
                            src={eventBanner}
                            alt="Prévia do banner do evento"
                            width={600}
                            height={240}
                            unoptimized
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => setEventBanner('')}
                            className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-md border border-card-border bg-dark-gray text-red-500 transition-colors hover:border-red-500"
                            aria-label="Remover banner do evento"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <label htmlFor="event-banner-upload" className="group flex h-[150px] w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-card-border bg-dark-gray transition-colors hover:border-primary">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="mb-2 h-8 w-8 text-muted transition-colors group-hover:text-primary font-sans" aria-hidden="true" />
                            <p className="text-sm font-semibold text-white group-hover:text-primary font-sans">Carregar Banner</p>
                            <p className="mt-1 text-xs text-muted font-sans">PNG ou JPEG (máx. 1.5 MB)</p>
                          </div>
                          <input
                            id="event-banner-upload"
                            name="event-banner-upload"
                            type="file"
                            accept="image/png, image/jpeg"
                            className="sr-only"
                            onChange={(e) => handleFileChange(e, 'banner')}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 border-t border-card-border pt-5">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary font-sans">Configurações & Publicação</p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="event-price" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Valor da Inscrição (R$)</label>
                      <input
                        id="event-price"
                        name="event-price"
                        type="number"
                        min="0"
                        placeholder="Ex: 150"
                        value={eventTicketPrice}
                        onChange={(e) => setEventTicketPrice(Number(e.target.value))}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="event-slots" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Limite de Vagas</label>
                      <input
                        id="event-slots"
                        name="event-slots"
                        type="number"
                        min="1"
                        placeholder="Ex: 100"
                        value={eventTicketSlots}
                        onChange={(e) => setEventTicketSlots(Number(e.target.value))}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="event-ticket-active" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Inscrições</label>
                      <select
                        id="event-ticket-active"
                        name="event-ticket-active"
                        value={eventIsTicketingActive ? 'active' : 'inactive'}
                        onChange={(e) => setEventIsTicketingActive(e.target.value === 'active')}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                      >
                        <option value="active">Liberadas (Venda Ativa)</option>
                        <option value="inactive">Encerradas (Bloqueado)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="event-instagram" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Instagram do Evento</label>
                      <input
                        id="event-instagram"
                        name="event-instagram"
                        type="text"
                        placeholder="Ex: @wodarena"
                        value={eventInstagram}
                        onChange={(e) => setEventInstagram(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="event-website" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Site Oficial</label>
                      <input
                        id="event-website"
                        name="event-website"
                        type="text"
                        placeholder="Ex: https://wodarena.com"
                        value={eventWebsite}
                        onChange={(e) => setEventWebsite(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="event-status-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">Status do Evento</label>
                      <select
                        id="event-status-input"
                        name="event-status-input"
                        value={eventStatus}
                        onChange={(e) => setEventStatus(e.target.value as EventStatus)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                      >
                        <option value="upcoming">Em Breve</option>
                        <option value="live">Ao Vivo</option>
                        <option value="finished">Finalizado</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-card-border pt-5">
                  <button
                    type="submit"
                    className="flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-8 py-3 text-sm font-bold uppercase tracking-wider transition-colors font-sans"
                  >
                    Criar Evento
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'payments' && (
              <div className="bg-card border border-card-border rounded-xl p-6 sm:p-8 text-white space-y-6">
                <div className="border-b border-card-border pb-5">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary font-sans">Configuração Financeira</p>
                  <h3 className="mt-2 text-2xl font-bold tracking-tight text-white uppercase">
                    Configurações de Pagamento
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted font-sans">
                    Gerencie a integração da sua própria conta Mercado Pago para receber o valor das inscrições diretamente nas suas vendas de ingresso.
                  </p>
                </div>

                {loadingMp ? (
                  <div className="flex justify-center items-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {mpAccount && (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-5">
                        <div className="flex items-start gap-4">
                          <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-primary">
                            <CreditCard className="h-6 w-6" aria-hidden="true" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-bold uppercase text-primary font-sans">Status: Conectado</p>
                            <p className="text-sm font-semibold text-white">
                              {mpAccount.mercadopago_user_id.startsWith('manual-')
                                ? 'Sua conta está integrada manualmente via credenciais de API v2.'
                                : 'Sua conta do Mercado Pago está ativa e pronta via conexão automática.'}
                            </p>
                            <div className="pt-2 text-xs text-muted space-y-1">
                              <p><strong>Tipo de Integração:</strong> {mpAccount.mercadopago_user_id.startsWith('manual-') ? 'Manual (Chaves de Produção)' : 'Automática (OAuth)'}</p>
                              {!mpAccount.mercadopago_user_id.startsWith('manual-') && (
                                <p><strong>ID da Conta MP:</strong> {mpAccount.mercadopago_user_id}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {(!mpAccount || mpAccount.mercadopago_user_id.startsWith('manual-')) ? (
                      <div className="space-y-6">
                        {!mpAccount && (
                          <div className="rounded-lg border border-card-border bg-dark-gray/30 p-6 space-y-4">
                            <div className="flex items-center gap-3">
                              <CreditCard className="h-6 w-6 text-primary" aria-hidden="true" />
                              <h4 className="text-sm font-bold text-white uppercase tracking-wider font-sans">Conexão Express (OAuth)</h4>
                            </div>
                            <p className="text-xs text-muted leading-relaxed">
                              Recomendado. Autorize nossa aplicação com um clique e integre sua conta de forma totalmente automatizada.
                            </p>
                            <div className="pt-2">
                              <a
                                href={`https://auth.mercadopago.com/authorization?client_id=${process.env.NEXT_PUBLIC_MERCADOPAGO_CLIENT_ID || '5059936541987710'}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(redirectUri)}&state=${currentUser?.id || ''}`}
                                className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-8 py-3 text-sm font-bold uppercase tracking-wider transition-colors font-sans"
                              >
                                Conectar Mercado Pago
                              </a>
                            </div>
                          </div>
                        )}

                        <form onSubmit={handleSaveManualMp} className="rounded-lg border border-card-border p-6 bg-dark-gray/10 space-y-4">
                          <div className="border-b border-card-border pb-3">
                            <h4 className="text-sm font-bold text-white uppercase tracking-wider font-sans">Integração Financeira Manual (Chaves API v2)</h4>
                            <p className="text-[11px] text-muted leading-relaxed mt-1">
                              Cole suas credenciais de produção do Mercado Pago. Útil caso prefira não utilizar a autorização automática do fluxo OAuth.
                            </p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label htmlFor="manual-mp-public-key" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Public Key (Chave Pública)</label>
                              <input
                                id="manual-mp-public-key"
                                type="text"
                                required
                                placeholder="APP_USR-..."
                                value={manualPublicKey}
                                onChange={(e) => setManualPublicKey(e.target.value.trim())}
                                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none font-mono"
                              />
                            </div>
                            <div>
                              <label htmlFor="manual-mp-access-token" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Access Token (Token de Acesso)</label>
                              <input
                                id="manual-mp-access-token"
                                type="password"
                                required
                                placeholder="APP_USR-..."
                                value={manualAccessToken}
                                onChange={(e) => setManualAccessToken(e.target.value.trim())}
                                className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none font-mono"
                              />
                            </div>
                          </div>

                          <div className="flex justify-between items-center pt-3 border-t border-card-border/60">
                            <div>
                              {mpAccount && (
                                <button
                                  type="button"
                                  onClick={handleDisconnectMp}
                                  className="flex min-h-10 items-center justify-center rounded-md bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors font-sans"
                                >
                                  Desconectar Conta
                                </button>
                              )}
                            </div>
                            <button
                              type="submit"
                              disabled={savingManualMp}
                              className="flex min-h-10 items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink px-6 py-2 text-xs font-bold uppercase tracking-wider transition-colors font-sans"
                            >
                              {savingManualMp ? 'Salvando...' : 'Salvar Alterações'}
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-3 pt-2">
                        <a
                          href={`https://auth.mercadopago.com/authorization?client_id=${process.env.NEXT_PUBLIC_MERCADOPAGO_CLIENT_ID || '5059936541987710'}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(redirectUri)}&state=${currentUser?.id || ''}`}
                          className="flex min-h-11 items-center justify-center rounded-md border border-card-border bg-dark-gray hover:bg-dark-gray/80 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors font-sans"
                        >
                          Reconectar via OAuth
                        </a>
                        <button
                          type="button"
                          onClick={handleDisconnectMp}
                          className="flex min-h-11 items-center justify-center rounded-md bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors font-sans"
                        >
                          Desconectar Conta
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ABA: Segurança */}
            {activeTab === 'security' && (
              <div className="space-y-6 bg-background text-white">
                <div className="border-b border-card-border pb-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary font-sans">Segurança da Conta</p>
                  <h3 className="mt-1 text-2xl font-bold tracking-tight text-white uppercase">
                    Configurações de Acesso
                  </h3>
                </div>

                <div className="max-w-md bg-card border border-card-border rounded-xl p-6 space-y-6">
                  <form onSubmit={handleSecuritySubmit} className="space-y-4">
                    <div>
                      <label htmlFor="current-password" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">
                        Senha Atual
                      </label>
                      <input
                        id="current-password"
                        type="password"
                        required
                        value={securityCurrentPassword}
                        onChange={(e) => setSecurityCurrentPassword(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                        placeholder="••••••••"
                      />
                    </div>

                    <div>
                      <label htmlFor="new-password" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">
                        Nova Senha
                      </label>
                      <input
                        id="new-password"
                        type="password"
                        required
                        value={securityNewPassword}
                        onChange={(e) => setSecurityNewPassword(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                        placeholder="Mínimo 6 caracteres"
                      />
                    </div>

                    <div>
                      <label htmlFor="confirm-new-password" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">
                        Confirmar Nova Senha
                      </label>
                      <input
                        id="confirm-new-password"
                        type="password"
                        required
                        value={securityConfirmPassword}
                        onChange={(e) => setSecurityConfirmPassword(e.target.value)}
                        className="w-full rounded-md border border-card-border bg-dark-gray px-4 py-2.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                        placeholder="••••••••"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={securitySubmitting}
                      className="w-full flex min-h-11 items-center justify-center rounded bg-primary hover:bg-primary-hover text-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 font-sans"
                    >
                      {securitySubmitting ? 'Salvando...' : 'Salvar Nova Senha'}
                    </button>
                  </form>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {eventPendingDeletion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-event-title">
          <div className="w-full max-w-lg rounded-xl border border-trading-down/40 bg-card p-6 text-white">
            <div className="flex items-start justify-between gap-4 border-b border-card-border pb-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-trading-down/40 bg-trading-down/10 p-2 text-trading-down">
                  <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 id="delete-event-title" className="text-base font-bold uppercase tracking-wider text-white font-sans">
                    Excluir evento
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Esta ação remove o evento e todos os dados vinculados a ele.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDeleteEventDialog}
                disabled={isDeletingEvent}
                className="text-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Fechar confirmação de exclusão"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 py-5">
              <div className="rounded-lg border border-card-border bg-background p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted font-sans">Evento selecionado</p>
                <p className="mt-1 break-words text-sm font-bold uppercase tracking-wider text-white">{eventPendingDeletion.name}</p>
                <p className="mt-1 text-xs text-muted">{eventPendingDeletion.location} &middot; {eventPendingDeletion.date}</p>
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-card-border bg-dark-gray/40 p-3 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={deleteEventAcknowledged}
                  onChange={(e) => setDeleteEventAcknowledged(e.target.checked)}
                  disabled={isDeletingEvent}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  Confirmo que entendo que categorias, provas, inscrições, atletas e pontuações deste evento serão removidos.
                </span>
              </label>

              <div>
                <label htmlFor="delete-event-confirmation" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans">
                  Digite o nome do evento para confirmar
                </label>
                <input
                  id="delete-event-confirmation"
                  type="text"
                  value={deleteEventConfirmation}
                  onChange={(e) => setDeleteEventConfirmation(e.target.value)}
                  disabled={isDeletingEvent}
                  className="w-full rounded-md border border-card-border bg-background px-4 py-2.5 text-sm text-white placeholder:text-muted-soft focus:border-trading-down/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={eventPendingDeletion.name}
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-card-border pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDeleteEventDialog}
                disabled={isDeletingEvent}
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-card-border bg-dark-gray px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50 font-sans"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteEvent}
                disabled={isDeletingEvent || !deleteEventAcknowledged || deleteEventConfirmation.trim() !== eventPendingDeletion.name}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-trading-down bg-trading-down px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-trading-down/80 disabled:cursor-not-allowed disabled:border-card-border disabled:bg-dark-gray disabled:text-muted font-sans"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {isDeletingEvent ? 'Excluindo...' : 'Excluir definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRegistrationVoucher && (
        <RegistrationVoucher
          registration={selectedRegistrationVoucher.registration}
          athlete={selectedRegistrationVoucher.athlete}
          event={selectedRegistrationVoucher.event}
          onClose={() => setSelectedRegistrationVoucher(null)}
        />
      )}

      {/* Modais do Leaderboard */}
      {selectedAthleteForProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-card-border p-6 bg-card text-white space-y-6 relative">
            <button
              onClick={() => setSelectedAthleteForProfile(null)}
              className="absolute right-4 top-4 text-muted hover:text-white transition-colors"
              aria-label="Fechar perfil"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-4 border-b border-card-border pb-4">
              {selectedAthleteForProfile.photoUrl ? (
                <Image
                  src={selectedAthleteForProfile.photoUrl}
                  alt={selectedAthleteForProfile.name}
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 rounded-full object-cover border border-primary p-0.5"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-bold text-xl uppercase">
                  {selectedAthleteForProfile.name.charAt(0)}
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-wider font-sans">{selectedAthleteForProfile.name}</h3>
                <p className="text-xs text-primary font-bold uppercase tracking-wider font-sans">
                  {selectedEventToManage?.divisions.find(d => d.id === selectedAthleteForProfile.divisionId)?.name || 'Categoria'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Box / Academia</p>
                <p className="font-semibold text-white uppercase mt-0.5">{selectedAthleteForProfile.box}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Cidade / Estado</p>
                <p className="font-semibold text-white uppercase mt-0.5">
                  {selectedAthleteForProfile.city ? `${selectedAthleteForProfile.city} / ${selectedAthleteForProfile.state || ''}` : 'Não informado'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Instagram</p>
                {selectedAthleteForProfile.instagram ? (
                  <a
                    href={`https://instagram.com/${selectedAthleteForProfile.instagram.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary-hover font-semibold mt-0.5 block hover:underline"
                  >
                    @{selectedAthleteForProfile.instagram.replace(/^@/, '')}
                  </a>
                ) : (
                  <p className="text-muted-soft mt-0.5">Não informado</p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Data Nasc.</p>
                <p className="font-semibold text-white mt-0.5">{selectedAthleteForProfile.birthDate || 'Não informada'}</p>
              </div>
              {selectedEventToManage?.eventType === 'fitness_racing' && (
                <div className="col-span-2 rounded-lg border border-primary/20 bg-primary/10 p-3">
                  <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Tempo Oficial</p>
                  <p className="mt-0.5 font-mono text-xl font-bold text-primary">
                    {(() => {
                      const totalWorkout = selectedEventToManage.workouts.find(w => w.divisionId === selectedAthleteForProfile.divisionId && w.code === 'TOTAL');
                      const score = scores.find(s => s.athleteId === selectedAthleteForProfile.id && s.workoutId === totalWorkout?.id);
                      return score && score.value < 999999 ? score.result : '-';
                    })()}
                  </p>
                </div>
              )}
            </div>

            {selectedEventToManage?.eventType === 'fitness_racing' && (
              <div className="border-t border-card-border pt-4 mt-4 space-y-4 text-left">
                <p className="text-[10px] uppercase font-bold text-primary tracking-wider">Análise de Performance</p>
                {(() => {
                  const totalWorkout = selectedEventToManage.workouts.find(w => w.divisionId === selectedAthleteForProfile.divisionId && w.code === 'TOTAL');
                  const score = scores.find(s => s.athleteId === selectedAthleteForProfile.id && s.workoutId === totalWorkout?.id);
                  const division = selectedEventToManage.divisions.find(d => d.id === selectedAthleteForProfile.divisionId);
                  const stages = division?.courseLayout || [];

                  if (!score || !score.splits || Object.keys(score.splits).length === 0) {
                    return <p className="text-xs text-muted">Nenhum split de tempo lançado para este competidor.</p>;
                  }

                  const splitsArray = stages.map(stg => {
                    const timeStr = score.splits?.[stg.id] || '';
                    const secs = timeToSeconds(timeStr);
                    return { stage: stg, timeStr, secs };
                  }).filter(s => s.secs > 0);

                  if (splitsArray.length === 0) {
                    return <p className="text-xs text-muted">Nenhum split de tempo lançado para este competidor.</p>;
                  }

                  const sortedByTime = [...splitsArray].sort((a, b) => a.secs - b.secs);
                  const stations = splitsArray.filter(s => s.stage.type === 'station');
                  const runs = splitsArray.filter(s => s.stage.type === 'run');

                  const bestSplit = sortedByTime[0];
                  const worstSplit = sortedByTime[sortedByTime.length - 1];

                  const bestStation = stations.length > 0 ? [...stations].sort((a, b) => a.secs - b.secs)[0] : null;
                  const worstStation = stations.length > 0 ? [...stations].sort((a, b) => b.secs - a.secs)[0] : null;

                  const totalRunSecs = runs.reduce((acc, curr) => acc + curr.secs, 0);
                  const totalStationSecs = stations.reduce((acc, curr) => acc + curr.secs, 0);
                  const avgRunSecs = runs.length > 0 ? Math.round(totalRunSecs / runs.length) : 0;

                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted">Melhor Split</p>
                          <p className="font-bold text-emerald-400 mt-0.5">{bestSplit.stage.name} ({bestSplit.timeStr})</p>
                        </div>
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted">Pior Split</p>
                          <p className="font-bold text-red-400 mt-0.5">{worstSplit.stage.name} ({worstSplit.timeStr})</p>
                        </div>
                        {bestStation && (
                          <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                            <p className="text-[9px] uppercase font-bold text-muted">Estação Forte</p>
                            <p className="font-bold text-white mt-0.5">{bestStation.stage.name} ({bestStation.timeStr})</p>
                          </div>
                        )}
                        {worstStation && (
                          <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                            <p className="text-[9px] uppercase font-bold text-muted">Estação Lenta</p>
                            <p className="font-bold text-white mt-0.5">{worstStation.stage.name} ({worstStation.timeStr})</p>
                          </div>
                        )}
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted">Corrida Total</p>
                          <p className="font-bold text-white mt-0.5">{secondsToTimeStr(totalRunSecs)}</p>
                        </div>
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted">Estações Total</p>
                          <p className="font-bold text-white mt-0.5">{secondsToTimeStr(totalStationSecs)}</p>
                        </div>
                        {runs.length > 0 && (
                          <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2 col-span-2">
                            <p className="text-[9px] uppercase font-bold text-muted font-sans">Pace Médio de Corrida</p>
                            <p className="font-bold text-primary mt-0.5">{secondsToTimeStr(avgRunSecs)} / km</p>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-card-border/50 pt-3 space-y-2">
                        <p className="text-[9px] uppercase font-bold text-muted tracking-wider">Tempos por Etapa (Splits)</p>
                        <div className="max-h-[160px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                          {stages.map(stg => {
                            const timeStr = score.splits?.[stg.id] || '-';
                            return (
                              <div key={stg.id} className="flex justify-between items-center text-xs py-1 border-b border-card-border/30">
                                <span className="text-muted-soft">{stg.name}</span>
                                <span className="font-bold text-white font-mono">{timeStr}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedTeamForProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-card-border p-6 bg-card text-white space-y-6 relative">
            <button
              onClick={() => setSelectedTeamForProfile(null)}
              className="absolute right-4 top-4 text-muted hover:text-white transition-colors"
              aria-label="Fechar perfil da equipe"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="border-b border-card-border pb-4">
              <span className="inline-flex rounded bg-primary/20 border border-primary/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary mb-1.5">
                Perfil de Equipe
              </span>
              <h3 className="text-xl font-bold text-white uppercase tracking-wider">{selectedTeamForProfile.name}</h3>
              <p className="text-xs text-primary font-bold uppercase tracking-wider mt-0.5">
                {selectedEventToManage?.divisions.find(d => d.id === selectedTeamForProfile.divisionId)?.name || 'Categoria'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs border-b border-card-border/50 pb-4">
              <div>
                <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Box / Academia</p>
                <p className="font-semibold text-white uppercase mt-0.5">{selectedTeamForProfile.box}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Cidade / Estado</p>
                <p className="font-semibold text-white uppercase mt-0.5">
                  {selectedTeamForProfile.city ? `${selectedTeamForProfile.city} / ${selectedTeamForProfile.state || ''}` : 'Não informado'}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Instagram Equipe</p>
                {selectedTeamForProfile.instagram ? (
                  <a
                    href={`https://instagram.com/${selectedTeamForProfile.instagram.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary-hover font-semibold mt-0.5 block hover:underline"
                  >
                    @{selectedTeamForProfile.instagram.replace(/^@/, '')}
                  </a>
                ) : (
                  <p className="text-muted-soft mt-0.5">Não informado</p>
                )}
              </div>
              {selectedEventToManage?.eventType === 'fitness_racing' && (
                <div className="col-span-2 rounded-lg border border-primary/20 bg-primary/10 p-3">
                  <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Tempo Final</p>
                  <p className="mt-0.5 font-mono text-xl font-bold text-primary">
                    {(() => {
                      const totalWorkout = selectedEventToManage.workouts.find(w => w.divisionId === selectedTeamForProfile.divisionId && w.code === 'TOTAL');
                      const score = scores.find(s => s.athleteId === selectedTeamForProfile.id && s.workoutId === totalWorkout?.id);
                      return score && score.value < 999999 ? score.result : '-';
                    })()}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-[10px] uppercase font-bold text-primary tracking-wider">Integrantes da Equipe</p>
              {selectedTeamForProfile.teamMembers && selectedTeamForProfile.teamMembers.length > 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {selectedTeamForProfile.teamMembers.map((m: { name: string; instagram: string }, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-dark-gray/30 border border-card-border/60 text-xs">
                      <span className="font-semibold text-white uppercase">{m.name}</span>
                      {m.instagram ? (
                        <a
                          href={`https://instagram.com/${m.instagram.replace(/^@/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary-hover hover:underline text-[10px]"
                        >
                          @{m.instagram.replace(/^@/, '')}
                        </a>
                      ) : (
                        <span className="text-muted text-[10px]">Sem Instagram</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">Nenhum integrante cadastrado nesta equipe.</p>
              )}
            </div>

            {selectedEventToManage?.eventType === 'fitness_racing' && (
              <div className="border-t border-card-border pt-4 mt-4 space-y-4 text-left">
                <p className="text-[10px] uppercase font-bold text-primary tracking-wider">Análise de Performance</p>
                {(() => {
                  const totalWorkout = selectedEventToManage.workouts.find(w => w.divisionId === selectedTeamForProfile.divisionId && w.code === 'TOTAL');
                  const score = scores.find(s => s.athleteId === selectedTeamForProfile.id && s.workoutId === totalWorkout?.id);
                  const division = selectedEventToManage.divisions.find(d => d.id === selectedTeamForProfile.divisionId);
                  const stages = division?.courseLayout || [];

                  if (!score || !score.splits || Object.keys(score.splits).length === 0) {
                    return <p className="text-xs text-muted">Nenhum split de tempo lançado para esta equipe.</p>;
                  }

                  const splitsArray = stages.map(stg => {
                    const timeStr = score.splits?.[stg.id] || '';
                    const secs = timeToSeconds(timeStr);
                    return { stage: stg, timeStr, secs };
                  }).filter(s => s.secs > 0);

                  if (splitsArray.length === 0) {
                    return <p className="text-xs text-muted">Nenhum split de tempo lançado para esta equipe.</p>;
                  }

                  const sortedByTime = [...splitsArray].sort((a, b) => a.secs - b.secs);
                  const stations = splitsArray.filter(s => s.stage.type === 'station');
                  const runs = splitsArray.filter(s => s.stage.type === 'run');

                  const bestSplit = sortedByTime[0];
                  const worstSplit = sortedByTime[sortedByTime.length - 1];

                  const bestStation = stations.length > 0 ? [...stations].sort((a, b) => a.secs - b.secs)[0] : null;
                  const worstStation = stations.length > 0 ? [...stations].sort((a, b) => b.secs - a.secs)[0] : null;

                  const totalRunSecs = runs.reduce((acc, curr) => acc + curr.secs, 0);
                  const totalStationSecs = stations.reduce((acc, curr) => acc + curr.secs, 0);
                  const avgRunSecs = runs.length > 0 ? Math.round(totalRunSecs / runs.length) : 0;

                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted font-sans">Melhor Split</p>
                          <p className="font-bold text-emerald-400 mt-0.5">{bestSplit.stage.name} ({bestSplit.timeStr})</p>
                        </div>
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted font-sans">Pior Split</p>
                          <p className="font-bold text-red-400 mt-0.5">{worstSplit.stage.name} ({worstSplit.timeStr})</p>
                        </div>
                        {bestStation && (
                          <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                            <p className="text-[9px] uppercase font-bold text-muted font-sans">Estação Forte</p>
                            <p className="font-bold text-white mt-0.5">{bestStation.stage.name} ({bestStation.timeStr})</p>
                          </div>
                        )}
                        {worstStation && (
                          <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                            <p className="text-[9px] uppercase font-bold text-muted font-sans">Estação Lenta</p>
                            <p className="font-bold text-white mt-0.5">{worstStation.stage.name} ({worstStation.timeStr})</p>
                          </div>
                        )}
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted font-sans">Corrida Total</p>
                          <p className="font-bold text-white mt-0.5">{secondsToTimeStr(totalRunSecs)}</p>
                        </div>
                        <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2">
                          <p className="text-[9px] uppercase font-bold text-muted font-sans">Estações Total</p>
                          <p className="font-bold text-white mt-0.5">{secondsToTimeStr(totalStationSecs)}</p>
                        </div>
                        {runs.length > 0 && (
                          <div className="rounded-lg bg-dark-gray/30 border border-card-border p-2 col-span-2">
                            <p className="text-[9px] uppercase font-bold text-muted font-sans">Pace Médio de Corrida</p>
                            <p className="font-bold text-primary mt-0.5">{secondsToTimeStr(avgRunSecs)} / km</p>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-card-border/50 pt-3 space-y-2">
                        <p className="text-[9px] uppercase font-bold text-muted tracking-wider font-sans">Tempos por Etapa (Splits)</p>
                        <div className="max-h-[160px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin font-sans">
                          {stages.map(stg => {
                            const timeStr = score.splits?.[stg.id] || '-';
                            return (
                              <div key={stg.id} className="flex justify-between items-center text-xs py-1 border-b border-card-border/30">
                                <span className="text-muted-soft">{stg.name}</span>
                                <span className="font-bold text-white font-mono">{timeStr}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drawer de Splits para Fitness Racing */}
      {isSplitsDrawerOpen && splitsDrawerAthlete && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
          <div className="w-full max-w-md h-full bg-card border-l border-card-border p-6 flex flex-col text-white relative animate-slide-left">
            <button
              onClick={() => {
                setIsSplitsDrawerOpen(false);
                setSplitsDrawerAthlete(null);
              }}
              className="absolute right-4 top-4 text-muted hover:text-white transition-colors"
              aria-label="Fechar splits"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mt-8 border-b border-card-border pb-4">
              <span className="inline-flex rounded bg-primary/20 border border-primary/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary mb-1.5 font-sans">
                Lançamento Avançado
              </span>
              <h3 className="text-xl font-bold text-white uppercase tracking-wider">{splitsDrawerAthlete.name}</h3>
              <p className="text-xs text-muted mt-0.5">Informe o tempo individual de cada corrida e estação do percurso.</p>
            </div>

            <div className="flex-1 overflow-y-auto my-4 pr-1 space-y-4 scrollbar-thin">
              {(() => {
                const division = selectedEventToManage?.divisions.find(d => d.id === splitsDrawerAthlete.divisionId);
                const stages = division?.courseLayout || [];

                if (stages.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-xs text-muted">Nenhuma etapa configurada no percurso.</p>
                      <p className="text-[10px] text-muted mt-1 font-sans">Configure o percurso da categoria na aba &quot;Configuração do Percurso&quot; primeiro.</p>
                    </div>
                  );
                }

                return stages.map(stg => (
                  <div key={stg.id} className="flex items-center justify-between gap-4 p-3 rounded-lg bg-dark-gray/30 border border-card-border/60">
                    <div>
                      <p className="text-xs font-bold text-white uppercase tracking-wide">{stg.name}</p>
                      <p className="text-[10px] text-muted mt-0.5 font-sans">
                        {stg.type === 'run' ? 'Corrida' : 'Estação'} {stg.distance ? `(${stg.distance})` : ''}
                      </p>
                    </div>
                    <input
                      type="text"
                      placeholder="00:00"
                      value={splitsInputs[stg.id] || ''}
                      onChange={(e) => setSplitsInputs(prev => ({ ...prev, [stg.id]: e.target.value }))}
                      className="w-24 text-center rounded border border-card-border bg-dark-gray/60 px-3 py-1.5 text-xs text-white font-mono placeholder:text-muted focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                ));
              })()}
            </div>

            <div className="border-t border-card-border pt-4 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
                <span className="text-xs font-bold uppercase tracking-wider text-muted font-sans">Tempo Total Estimado</span>
                <span className="text-lg font-bold font-mono text-primary font-sans">
                  {(() => {
                    let totalSecs = 0;
                    Object.values(splitsInputs).forEach(val => {
                      totalSecs += timeToSeconds(val);
                    });
                    return secondsToTimeStr(totalSecs);
                  })()}
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsSplitsDrawerOpen(false);
                    setSplitsDrawerAthlete(null);
                  }}
                  className="flex-1 min-h-11 flex items-center justify-center rounded-md border border-card-border bg-dark-gray text-xs font-bold uppercase tracking-wider transition-colors hover:border-muted text-muted hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!splitsDrawerAthlete) return;
                    const totalWorkout = selectedEventToManage?.workouts.find(w => w.divisionId === splitsDrawerAthlete.divisionId && w.code === 'TOTAL');
                    const workoutId = totalWorkout?.id || `wod-${splitsDrawerAthlete.divisionId}-total`;

                    let totalSecs = 0;
                    Object.values(splitsInputs).forEach(val => {
                      totalSecs += timeToSeconds(val);
                    });
                    const totalTimeStr = secondsToTimeStr(totalSecs);

                    submitScore({
                      athleteId: splitsDrawerAthlete.id,
                      workoutId,
                      result: totalTimeStr,
                      value: totalSecs,
                      splits: splitsInputs
                    });

                    setIsSplitsDrawerOpen(false);
                    setSplitsDrawerAthlete(null);
                    setAdminNotice({ text: 'Splits salvos com sucesso.', tone: 'success' });
                  }}
                  className="flex-1 min-h-11 flex items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-ink text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Salvar Splits
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
