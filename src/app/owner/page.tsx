'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useApp } from '@/context/AppContext';
import { Leaderboard } from '@/components/Leaderboard';
import { BrandLogo } from '@/components/BrandLogo';
import { getEventStatus } from '@/lib/eventStatus';
import { getManagerAccessStatus, getManagerAccessStatusLabel } from '@/lib/managerAccess';
import { CommercialLead } from '@/types';
import { getCommercialLeadEmailStatusLabel, getCommercialLeadStatusLabel } from '@/lib/commercialLeads';
import {
  Shield, LayoutDashboard, Users, Trophy, DollarSign,
  UserPlus, Calendar, Medal, LogOut, KeyRound, Building, ShieldCheck, ShieldAlert, Clock3, Star
} from 'lucide-react';

const formatDateTime = (value?: string) => {
  if (!value) return '-';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export default function OwnerPage() {
  const {
    events, registrations, users, currentUser, login, logout, createManagerAccount, updateManagerServiceValidity, setFeaturedHomeEvent
  } = useApp();

  // Estados locais
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Abas do Painel
  const [activeTab, setActiveTab] = useState<'dashboard' | 'managers' | 'events' | 'leaderboards' | 'leads'>('dashboard');

  // Formulário de Cadastro de Gestor
  const [newManagerName, setNewManagerName] = useState('');
  const [newManagerEmail, setNewManagerEmail] = useState('');
  const [newManagerPassword, setNewManagerPassword] = useState('');
  const [newManagerOrg, setNewManagerOrg] = useState('');
  const [newManagerServiceValidUntil, setNewManagerServiceValidUntil] = useState('');
  const [createMsg, setCreateMsg] = useState({ text: '', isError: false });
  const [managerNotice, setManagerNotice] = useState({ text: '', isError: false });
  const [managerValidityDrafts, setManagerValidityDrafts] = useState<Record<string, string>>({});
  const [savingManagerId, setSavingManagerId] = useState<string | null>(null);
  const [commercialLeads, setCommercialLeads] = useState<CommercialLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState('');
  const [featuredHomeDraftId, setFeaturedHomeDraftId] = useState<string | null>(null);
  const [featuredHomeNotice, setFeaturedHomeNotice] = useState({ text: '', isError: false });
  const [savingFeaturedHomeEvent, setSavingFeaturedHomeEvent] = useState(false);
  const [serviceFeeConfig, setServiceFeeConfig] = useState({ enabled: true, percent: 10 });
  const [savingServiceFee, setSavingServiceFee] = useState(false);
  const [serviceFeeNotice, setServiceFeeNotice] = useState('');

  // 1. Validar se o usuário atual é o proprietário (role: 'owner')
  const isOwner = currentUser?.role === 'owner';

  // 2. Estatísticas Consolidadas (Taxa Dinâmica por Evento - Apenas Inscrições Pagas)
  const stats = useMemo(() => {
    const approvedRegistrations = registrations.filter(r => r.paymentStatus === 'payment_approved');
    const totalVolume = approvedRegistrations.reduce((sum, r) => sum + (r.amountCollected ?? r.totalPaid), 0);

    const platformRevenue = approvedRegistrations.reduce((sum, r) => {
      const confirmedFee = Number(r.applicationFeeCharged || 0);
      return sum + (confirmedFee > 0 ? confirmedFee : Number(r.serviceFeeAmount || 0));
    }, 0);

    const managersCount = users.filter(u => u.role === 'manager').length;
    const eventsCount = events.length;

    return {
      totalVolume,
      platformRevenue,
      managersCount,
      eventsCount
    };
  }, [registrations, users, events]);

  // 3. Compilar faturamento e dados por Gestor (Apenas Inscrições Pagas)
  const managersList = useMemo(() => {
    const managers = users.filter(u => u.role === 'manager');

    return managers.map(m => {
      // Eventos desse gestor
      const managerEvents = events.filter(e => e.organizerId === m.id);
      const eventIds = managerEvents.map(e => e.id);

      // Inscrições dos eventos desse gestor
      const managerRegistrations = registrations.filter(r => eventIds.includes(r.eventId));
      const approvedRegs = managerRegistrations.filter(r => r.paymentStatus === 'payment_approved');
      const pendingRegs = managerRegistrations.filter(r => r.paymentStatus !== 'payment_approved');

      // Faturamento Bruto (Aprovado)
      const grossRevenue = approvedRegs.reduce((sum, r) => sum + r.totalPaid, 0);

    const platformFee = approvedRegs.reduce((sum, r) => {
        const confirmedFee = Number(r.applicationFeeCharged || 0);
        return sum + (confirmedFee > 0 ? confirmedFee : Number(r.serviceFeeAmount || 0));
      }, 0);

      const netRevenue = grossRevenue;
      const accessStatus = m.managerAccessStatus || getManagerAccessStatus(m.serviceValidUntil);

      return {
        manager: m,
        accessStatus,
        serviceValidUntil: m.serviceValidUntil || '',
        eventsCount: managerEvents.length,
        grossRevenue,
        netRevenue,
        platformFee,
        paidCount: approvedRegs.length,
        unpaidCount: pendingRegs.length
      };
    });
  }, [users, events, registrations]);

  const managerAccessOverview = useMemo(() => ({
    active: managersList.filter(item => item.accessStatus === 'active').length,
    expiringSoon: managersList.filter(item => item.accessStatus === 'expiring_soon').length,
    expired: managersList.filter(item => item.accessStatus === 'expired').length,
    unconfigured: managersList.filter(item => item.accessStatus === 'unconfigured').length
  }), [managersList]);

  // 4. Detalhamento financeiro por evento com taxa real da plataforma.
  const eventsFinanceList = useMemo(() => {
    return events.map(event => {
      // Filtra inscrições deste evento
      const eventRegs = registrations.filter(r => r.eventId === event.id);
      const approvedRegs = eventRegs.filter(r => r.paymentStatus === 'payment_approved');
      const unpaidRegs = eventRegs.filter(r => r.paymentStatus !== 'payment_approved');

      const grossRevenue = approvedRegs.reduce((sum, r) => sum + r.totalPaid, 0);

      const totalFeeToCollect = approvedRegs.reduce((sum, registration) => {
        const confirmedFee = Number(registration.applicationFeeCharged || 0);
        return sum + (confirmedFee > 0 ? confirmedFee : Number(registration.serviceFeeAmount || 0));
      }, 0);

      // Encontra o gestor do evento
      const manager = users.find(u => u.id === event.organizerId);

      return {
        event,
        managerName: manager?.name || 'Gestor não encontrado',
        paidCount: approvedRegs.length,
        unpaidCount: unpaidRegs.length,
        grossRevenue,
        totalFeeToCollect
      };
    });
  }, [events, registrations, users]);

  const featuredHomeEvent = useMemo(() => (
    events.find(event => event.isFeatured)
  ), [events]);

  const featuredHomeCandidates = useMemo(() => (
    events.filter(event => (
      (event.status === 'live' || event.status === 'upcoming')
      && getEventStatus(event) !== 'finished'
    ))
  ), [events]);

  const selectableFeaturedHomeEventId = useMemo(() => {
    const currentFeaturedId = featuredHomeEvent?.id || '';
    return featuredHomeCandidates.some(event => event.id === currentFeaturedId) ? currentFeaturedId : '';
  }, [featuredHomeEvent?.id, featuredHomeCandidates]);

  const selectedFeaturedHomeDraftId = featuredHomeDraftId ?? selectableFeaturedHomeEventId;

  // Seletor de Evento para Leaderboard
  const [selectedEventIdLead, setSelectedEventIdLead] = useState(events[0]?.id || '');
  const selectedEventForLead = useMemo(() => {
    return events.find(e => e.id === selectedEventIdLead);
  }, [events, selectedEventIdLead]);

  const leadStats = useMemo(() => ({
    total: commercialLeads.length,
    newCount: commercialLeads.filter(lead => lead.leadStatus === 'new').length,
    sentCount: commercialLeads.filter(lead => lead.ownerEmailNotificationStatus === 'sent').length,
    failedCount: commercialLeads.filter(lead => lead.ownerEmailNotificationStatus === 'failed').length
  }), [commercialLeads]);

  useEffect(() => {
    if (!isOwner) return;

    let isMounted = true;

    const fetchCommercialLeads = async () => {
      try {
        setLeadsLoading(true);
        setLeadsError('');
        const response = await fetch('/api/commercial-leads');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Erro ao carregar leads comerciais.');
        }

        if (isMounted) {
          setCommercialLeads(data.leads || []);
        }
      } catch (err) {
        if (isMounted) {
          setLeadsError(err instanceof Error ? err.message : 'Erro ao carregar leads comerciais.');
        }
      } finally {
        if (isMounted) {
          setLeadsLoading(false);
        }
      }
    };

    void fetchCommercialLeads();

    return () => {
      isMounted = false;
    };
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner) return;

    let active = true;
    void fetch('/api/owner/service-fee')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar taxa de serviço.');
        if (active) setServiceFeeConfig({ enabled: data.enabled !== false, percent: Number(data.percent || 10) });
      })
      .catch(error => {
        if (active) setServiceFeeNotice(error instanceof Error ? error.message : 'Erro ao carregar taxa de serviço.');
      });

    return () => {
      active = false;
    };
  }, [isOwner]);

  const handleServiceFeeToggle = async () => {
    const enabled = !serviceFeeConfig.enabled;
    setSavingServiceFee(true);
    setServiceFeeNotice('');
    try {
      const response = await fetch('/api/owner/service-fee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao atualizar taxa de serviço.');
      setServiceFeeConfig({ enabled: data.enabled, percent: Number(data.percent || 10) });
      setServiceFeeNotice(enabled ? 'Taxa de serviço ativada.' : 'Taxa de serviço desativada.');
    } catch (error) {
      setServiceFeeNotice(error instanceof Error ? error.message : 'Erro ao atualizar taxa de serviço.');
    } finally {
      setSavingServiceFee(false);
    }
  };

  // Ação de Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = await login(email, password);
    if (user?.role === 'owner') {
      setLoginError('');
    } else if (user) {
      logout();
      setLoginError('Acesso negado. Esta conta não possui privilégios de proprietário do site.');
    } else {
      setLoginError('E-mail ou senha incorretos.');
    }
  };

  // Ação de Cadastrar Gestor
  const handleCreateManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newManagerName || !newManagerEmail || !newManagerPassword || !newManagerOrg) {
      setCreateMsg({ text: 'Por favor, preencha todos os campos do gestor.', isError: true });
      return;
    }

    const success = await createManagerAccount(
      newManagerName,
      newManagerEmail,
      newManagerPassword,
      newManagerOrg,
      newManagerServiceValidUntil || undefined
    );

    if (success) {
      setCreateMsg({ text: `Conta de Gestor para "${newManagerName}" criada com sucesso!`, isError: false });
      setNewManagerName('');
      setNewManagerEmail('');
      setNewManagerPassword('');
      setNewManagerOrg('');
      setNewManagerServiceValidUntil('');

      // Limpar mensagem após 4 segundos
      setTimeout(() => setCreateMsg({ text: '', isError: false }), 4000);
    } else {
      setCreateMsg({ text: 'Erro ao cadastrar gestor. O e-mail já existe ou houve um problema.', isError: true });
    }
  };

  const handleSaveManagerValidity = async (managerId: string) => {
    const draftValue = managerValidityDrafts[managerId] ?? managersList.find(item => item.manager.id === managerId)?.serviceValidUntil ?? '';
    setSavingManagerId(managerId);
    const updatedUser = await updateManagerServiceValidity(managerId, draftValue || null);
    setSavingManagerId(null);

    if (!updatedUser) {
      setManagerNotice({ text: 'Nao foi possivel atualizar o prazo de uso do gestor.', isError: true });
      return;
    }

    setManagerValidityDrafts(prev => ({ ...prev, [managerId]: updatedUser.serviceValidUntil || '' }));
    setManagerNotice({ text: `Prazo de uso atualizado para ${updatedUser.name}.`, isError: false });
    setTimeout(() => setManagerNotice({ text: '', isError: false }), 4000);
  };

  const handleSaveFeaturedHomeEvent = async () => {
    setSavingFeaturedHomeEvent(true);
    setFeaturedHomeNotice({ text: '', isError: false });

    try {
      await setFeaturedHomeEvent(selectedFeaturedHomeDraftId || null);
      const eventName = featuredHomeCandidates.find(event => event.id === selectedFeaturedHomeDraftId)?.name;
      setFeaturedHomeNotice({
        text: eventName ? `Banner da home atualizado para ${eventName}.` : 'Banner da home voltou para selecao automatica.',
        isError: false
      });
    } catch (err) {
      setFeaturedHomeNotice({
        text: err instanceof Error ? err.message : 'Nao foi possivel atualizar o destaque da home.',
        isError: true
      });
    } finally {
      setSavingFeaturedHomeEvent(false);
      setTimeout(() => setFeaturedHomeNotice({ text: '', isError: false }), 5000);
    }
  };

  const getManagerStatusClasses = (status: string) => {
    if (status === 'active') return 'border-primary/20 bg-primary/10 text-primary';
    if (status === 'expiring_soon') return 'border-amber-400/25 bg-amber-400/10 text-amber-300';
    if (status === 'expired') return 'border-red-500/30 bg-red-950/20 text-red-300';
    return 'border-card-border bg-dark-gray text-muted';
  };

  if (!isOwner) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4 bg-background">
        <div className="w-full max-w-md bg-card border border-card-border rounded-xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <BrandLogo variant="full" className="mx-auto h-28 w-28 rounded-sm" priority />
            <span className="px-3 py-1 bg-primary/10 border border-primary/25 text-primary text-[10px] uppercase font-bold tracking-widest rounded-full flex items-center gap-1.5 justify-center w-fit mx-auto">
              <Shield className="h-3.5 w-3.5" /> Super Admin
            </span>
            <h2 className="text-2xl font-bold text-white uppercase tracking-wider">Painel do Proprietário</h2>
            <p className="text-xs text-muted">Controle e faturamento central de serviços da WODArena.</p>
          </div>

          {loginError && (
            <div role="alert" className="p-3 bg-red-950/40 border border-red-500/30 text-red-400 text-xs rounded-xl font-medium">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="owner-email" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">E-mail do Proprietário</label>
              <div className="relative">
                <input
                  id="owner-email"
                  name="email"
                  autoComplete="email"
                  type="email"
                  required
              placeholder="Ex: l.vilaar@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="owner-password" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">Senha Mestra</label>
              <input
                id="owner-password"
                name="password"
                autoComplete="current-password"
                type="password"
                required
                placeholder="Ex: owner"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-primary hover:bg-primary-hover text-black font-bold uppercase tracking-wider rounded-md transition-colors flex items-center justify-center gap-1.5 active:scale-95"
            >
              <span>Autenticar Proprietário</span>
              <ShieldCheck className="h-4 w-4" />
            </button>
          </form>

        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header Admin Proprietário */}
      <section className="bg-card border-b border-card-border py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-12 w-12 rounded-sm border border-card-border" priority />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white uppercase tracking-wider">Painel do Proprietário</h2>
                <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded text-[9px] uppercase font-bold tracking-wider">Root Access</span>
              </div>
              <p className="text-xs text-muted font-medium">Controle de faturamento, comissões de SaaS e cadastro de organizadores.</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-dark-gray border border-card-border text-xs font-bold text-muted hover:text-white hover:border-red-500/40 hover:bg-red-950/10 transition-colors"
          >
            <span>Desconectar Root</span>
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      {/* Conteúdo Principal do Painel */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

          {/* Menu Lateral de Admin */}
          <aside className="flex flex-row overflow-x-auto gap-2 pb-2 scrollbar-none lg:flex-col lg:overflow-x-visible lg:pb-0 lg:col-span-1 lg:space-y-2 w-full">
            {[
              { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
              { id: 'managers', label: 'Gestores & Vendas', icon: Users },
              { id: 'leads', label: 'Leads Comerciais', icon: UserPlus },
              { id: 'events', label: 'Eventos Globais', icon: Calendar },
              { id: 'leaderboards', label: 'Leaderboards', icon: Medal }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-xs uppercase font-bold tracking-wider transition-colors border whitespace-nowrap shrink-0 lg:w-full lg:py-3 lg:text-left ${
                    activeTab === tab.id
                      ? 'bg-primary/10 border-primary text-primary font-bold shadow-md'
                      : 'bg-card border-transparent text-muted hover:text-white hover:border-card-border'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Área de Ação Admin */}
          <div className="lg:col-span-3 space-y-6">

            {/* ABA: Dashboard */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-white uppercase tracking-wider border-b border-card-border pb-3">
                  Resumo Financeiro e Operacional
                </h3>

                {/* Grid de Métricas Consolidadas */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

                  {/* Faturamento de Taxas do Site */}
                  <div className="bg-card border border-primary/20 rounded-xl p-5 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-primary tracking-wider">Receita Real de Taxas</p>
                      <h4 className="text-2xl font-bold font-number text-primary">R$ {stats.platformRevenue.toFixed(2)}</h4>
                    </div>
                    <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-primary">
                      <DollarSign className="h-5 w-5" />
                    </div>
                  </div>

                  {/* Volume Bruto Processado */}
                  <div className="bg-card border border-card-border rounded-xl p-5 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Volume Total Pago</p>
                      <h4 className="text-2xl font-bold font-number text-white">R$ {stats.totalVolume.toFixed(2)}</h4>
                    </div>
                    <div className="p-3 bg-dark-gray border border-card-border rounded-lg text-white">
                      <DollarSign className="h-5 w-5" />
                    </div>
                  </div>

                  {/* Total de Gestores */}
                  <div className="bg-card border border-card-border rounded-xl p-5 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Gestores de Eventos</p>
                      <h4 className="text-2xl font-bold font-number text-white">{stats.managersCount}</h4>
                    </div>
                    <div className="p-3 bg-dark-gray border border-card-border rounded-lg text-white">
                      <Users className="h-5 w-5" />
                    </div>
                  </div>

                  {/* Total de Eventos */}
                  <div className="bg-card border border-card-border rounded-xl p-5 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Eventos Criados</p>
                      <h4 className="text-2xl font-bold font-number text-white">{stats.eventsCount}</h4>
                    </div>
                    <div className="p-3 bg-dark-gray border border-card-border rounded-lg text-white">
                      <Trophy className="h-5 w-5" />
                    </div>
                  </div>

                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-card p-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-white">Taxa de serviço WODArena</p>
                    <p className="mt-1 text-xs text-muted">{serviceFeeConfig.percent}% sobre o valor final da inscrição. Contas manuais precisam reconectar via OAuth.</p>
                    {serviceFeeNotice && <p className="mt-2 text-xs text-primary">{serviceFeeNotice}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={handleServiceFeeToggle}
                    disabled={savingServiceFee}
                    className={`rounded-md border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-60 ${serviceFeeConfig.enabled ? 'border-primary bg-primary text-black' : 'border-card-border bg-dark-gray text-muted'}`}
                  >
                    {savingServiceFee ? 'Salvando...' : serviceFeeConfig.enabled ? 'Taxa ativa' : 'Taxa inativa'}
                  </button>
                </div>

                {/* Detalhamento por Evento */}
                <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
                  <div className="border-b border-card-border pb-3">
                    <h4 className="text-sm font-bold text-white uppercase tracking-wider">Detalhamento Financeiro por Evento</h4>
                    <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mt-1">Valores confirmados nas inscrições aprovadas</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead>
                        <tr className="border-b border-card-border text-[9px] uppercase tracking-widest text-muted">
                          <th className="py-3 px-3">Evento</th>
                          <th className="py-3 px-3">Organizador / Gestor</th>
                          <th className="py-3 px-3 text-center">Status</th>
                          <th className="py-3 px-3 text-center">Inscritos Pagos</th>
                          <th className="py-3 px-3 text-center">Não Pagos</th>
                          <th className="py-3 px-3 text-right">Faturamento Evento</th>
                          <th className="py-3 px-3 text-right text-primary">Taxa WODArena</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eventsFinanceList.map(({ event, managerName, paidCount, unpaidCount, grossRevenue, totalFeeToCollect }) => (
                          <tr key={event.id} className="border-b border-card-border/50 text-xs hover:bg-dark-gray/10">
                            <td className="py-3 px-3 flex items-center gap-3">
                              <div className="w-8 h-8 rounded bg-dark-gray border border-card-border p-0.5 overflow-hidden flex items-center justify-center shrink-0">
                                {event.logoUrl ? (
                                  <Image src={event.logoUrl} alt={`Logo do evento ${event.name}`} width={32} height={32} unoptimized className="w-full h-full object-cover rounded" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-primary/10 text-[10px] font-black uppercase text-primary">
                                    {event.name.substring(0, 2)}
                                  </div>
                                )}
                              </div>
                              <span className="font-bold text-white uppercase">{event.name}</span>
                            </td>
                            <td className="py-3 px-3 text-muted font-medium">{managerName}</td>
                            <td className="py-3 px-3 text-center">
                              {event.status === 'live' ? (
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-bold uppercase rounded">Live</span>
                              ) : event.status === 'upcoming' ? (
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-bold uppercase rounded">Upcoming</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-dark-gray text-muted text-[9px] font-bold uppercase rounded">Finished</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-white font-number">{paidCount}</td>
                            <td className="py-3 px-3 text-center font-semibold text-red-400 font-number">{unpaidCount}</td>
                            <td className="py-3 px-3 text-right font-bold text-white font-number">R$ {grossRevenue.toFixed(2)}</td>
                            <td className="py-3 px-3 text-right font-bold text-primary font-number">R$ {totalFeeToCollect.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ABA: Gestores e Vendas */}
            {activeTab === 'managers' && (
              <div className="space-y-6">
                <div className="bg-card border border-card-border rounded-xl p-6 space-y-6">
                  <div className="border-b border-card-border pb-3">
                    <h3 className="text-lg font-bold text-white uppercase tracking-wider">Gestores e Vendas</h3>
                    <p className="mt-1 text-xs text-muted">Cadastre gestores, acompanhe o prazo de uso da plataforma e renove o acesso quando necessario.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Ativos</p>
                      <p className="mt-2 font-number text-2xl font-bold text-primary">{managerAccessOverview.active}</p>
                    </div>
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-amber-300 font-bold">Vencendo</p>
                      <p className="mt-2 font-number text-2xl font-bold text-amber-300">{managerAccessOverview.expiringSoon}</p>
                    </div>
                    <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-red-300 font-bold">Expirados</p>
                      <p className="mt-2 font-number text-2xl font-bold text-red-300">{managerAccessOverview.expired}</p>
                    </div>
                    <div className="rounded-xl border border-card-border bg-dark-gray/40 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-muted font-bold">Sem Prazo</p>
                      <p className="mt-2 font-number text-2xl font-bold text-white">{managerAccessOverview.unconfigured}</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleCreateManager} className="bg-card border border-card-border rounded-xl p-6 space-y-4">
                  <div className="border-b border-card-border pb-3 flex justify-between items-center">
                    <div>
                      <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <UserPlus className="h-5 w-5 text-primary" /> Credenciais e Prazo de Uso
                      </h3>
                      <p className="mt-1 text-[11px] text-muted">O prazo e opcional no cadastro, mas pode ser definido agora ou renovado depois.</p>
                    </div>
                    {createMsg.text && (
                      <span role={createMsg.isError ? 'alert' : 'status'} aria-live="polite" className={`text-xs font-bold uppercase ${createMsg.isError ? 'text-red-400' : 'text-primary animate-pulse'}`}>
                        {createMsg.text}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="manager-name" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">Nome do Gestor *</label>
                      <input
                        id="manager-name"
                        name="manager-name"
                        autoComplete="name"
                        type="text"
                        required
                        placeholder="Ex: Carlos Roberto"
                        value={newManagerName}
                        onChange={(e) => setNewManagerName(e.target.value)}
                        className="w-full px-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="manager-organization" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">Organização / Box de Origem *</label>
                      <div className="relative">
                        <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                        <input
                          id="manager-organization"
                          name="manager-organization"
                          autoComplete="organization"
                          type="text"
                          required
                          placeholder="Ex: CrossFit Imperium II"
                          value={newManagerOrg}
                          onChange={(e) => setNewManagerOrg(e.target.value)}
                          className="w-full pl-9 pr-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="manager-email" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">E-mail de Login *</label>
                      <input
                        id="manager-email"
                        name="manager-email"
                        autoComplete="email"
                        type="email"
                        required
                        placeholder="Ex: gestor@email.com"
                        value={newManagerEmail}
                        onChange={(e) => setNewManagerEmail(e.target.value)}
                        className="w-full px-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="manager-password" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">Senha Temporária *</label>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                        <input
                          id="manager-password"
                          name="manager-password"
                          autoComplete="new-password"
                          type="password"
                          required
                          placeholder="Senha de acesso"
                          value={newManagerPassword}
                          onChange={(e) => setNewManagerPassword(e.target.value)}
                          className="w-full pl-9 pr-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="manager-service-valid-until" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">Validade de Uso</label>
                      <input
                        id="manager-service-valid-until"
                        name="manager-service-valid-until"
                        type="date"
                        value={newManagerServiceValidUntil}
                        onChange={(e) => setNewManagerServiceValidUntil(e.target.value)}
                        className="w-full px-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-primary hover:bg-primary-hover text-black font-bold uppercase tracking-wider rounded-md text-xs transition-colors active:scale-95"
                  >
                    Emitir Credenciais de Gestor
                  </button>
                </form>

                <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
                  <div className="border-b border-card-border pb-3 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold text-white uppercase tracking-wider">Carteira de Gestores</h3>
                      <p className="mt-1 text-[11px] text-muted">Edite o prazo de uso do gestor para renovar ou bloquear a operacao da plataforma.</p>
                    </div>
                    {managerNotice.text && (
                      <span role={managerNotice.isError ? 'alert' : 'status'} aria-live="polite" className={`text-xs font-bold uppercase ${managerNotice.isError ? 'text-red-400' : 'text-primary'}`}>
                        {managerNotice.text}
                      </span>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[1060px]">
                      <thead>
                        <tr className="border-b border-card-border text-[9px] uppercase tracking-widest text-muted">
                          <th className="py-3 px-3">Gestor</th>
                          <th className="py-3 px-3">Status de Uso</th>
                          <th className="py-3 px-3">Validade</th>
                          <th className="py-3 px-3 text-center">Eventos</th>
                          <th className="py-3 px-3 text-center">Inscritos</th>
                          <th className="py-3 px-3 text-right">Volume Pago</th>
                          <th className="py-3 px-3 text-right text-primary">Taxa Devida</th>
                          <th className="py-3 px-3 text-right text-primary">Saldo Gestor</th>
                          <th className="py-3 px-3">Renovar / Ajustar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managersList.map(item => (
                          <tr key={item.manager.id} className="border-b border-card-border/50 text-xs hover:bg-dark-gray/10 align-top">
                            <td className="py-3 px-3">
                              <p className="font-bold text-white">{item.manager.name}</p>
                              <p className="text-[10px] text-muted">{item.manager.email}</p>
                              <p className="mt-1 text-[10px] text-muted">{item.manager.organization || 'Organização não informada'}</p>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${getManagerStatusClasses(item.accessStatus)}`}>
                                {getManagerAccessStatusLabel(item.accessStatus)}
                              </span>
                              {item.accessStatus === 'expired' && (
                                <p className="mt-2 flex items-center gap-1 text-[10px] text-red-300">
                                  <ShieldAlert className="h-3.5 w-3.5" /> Painel e vendas bloqueados
                                </p>
                              )}
                              {item.accessStatus === 'expiring_soon' && (
                                <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-300">
                                  <Clock3 className="h-3.5 w-3.5" /> Renovar em breve
                                </p>
                              )}
                            </td>
                            <td className="py-3 px-3 text-muted font-medium">
                              {item.serviceValidUntil || 'Nao definido'}
                            </td>
                            <td className="py-3 px-3 text-center font-bold font-number text-white">{item.eventsCount}</td>
                            <td className="py-3 px-3 text-center font-bold font-number text-white">
                              <span className="text-primary">{item.paidCount}</span>
                              <span className="text-muted mx-1">/</span>
                              <span className="text-red-400">{item.unpaidCount}</span>
                            </td>
                            <td className="py-3 px-3 text-right font-bold font-number text-white">R$ {item.grossRevenue.toFixed(2)}</td>
                            <td className="py-3 px-3 text-right font-bold font-number text-primary">R$ {item.platformFee.toFixed(2)}</td>
                            <td className="py-3 px-3 text-right font-bold font-number text-primary">R$ {item.netRevenue.toFixed(2)}</td>
                            <td className="py-3 px-3">
                              <div className="flex min-w-[220px] items-center gap-2">
                                <input
                                  type="date"
                                  value={managerValidityDrafts[item.manager.id] ?? item.serviceValidUntil ?? ''}
                                  onChange={(e) => setManagerValidityDrafts(prev => ({ ...prev, [item.manager.id]: e.target.value }))}
                                  className="w-full rounded-lg border border-card-border bg-dark-gray px-3 py-2 text-[11px] text-white focus:outline-none focus:border-primary/50"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveManagerValidity(item.manager.id)}
                                  disabled={savingManagerId === item.manager.id}
                                  className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {savingManagerId === item.manager.id ? 'Salvando' : 'Salvar'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ABA: Leads Comerciais */}
            {activeTab === 'leads' && (
              <div className="space-y-6">
                <div className="bg-card border border-card-border rounded-xl p-6 space-y-6">
                  <div className="border-b border-card-border pb-3">
                    <h3 className="text-lg font-bold text-white uppercase tracking-wider">
                      Leads Comerciais da Homepage
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      Interessados capturados na campanha comercial da home, com registro do status de notificacao por e-mail.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-card-border bg-dark-gray/40 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-muted font-bold">Total de Leads</p>
                      <p className="mt-2 font-number text-2xl font-bold text-white">{leadStats.total}</p>
                    </div>
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Novos</p>
                      <p className="mt-2 font-number text-2xl font-bold text-primary">{leadStats.newCount}</p>
                    </div>
                    <div className="rounded-xl border border-card-border bg-dark-gray/40 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-muted font-bold">E-mail Enviado</p>
                      <p className="mt-2 font-number text-2xl font-bold text-white">{leadStats.sentCount}</p>
                    </div>
                    <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-red-300 font-bold">Falhas de E-mail</p>
                      <p className="mt-2 font-number text-2xl font-bold text-red-300">{leadStats.failedCount}</p>
                    </div>
                  </div>

                  {leadsError && (
                    <div role="alert" className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-300">
                      {leadsError}
                    </div>
                  )}

                  {leadsLoading ? (
                    <div className="rounded-xl border border-card-border bg-dark-gray/20 px-4 py-10 text-center text-sm text-muted">
                      Carregando leads comerciais...
                    </div>
                  ) : commercialLeads.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-card-border bg-dark-gray/20 px-4 py-10 text-center">
                      <p className="text-sm font-bold uppercase tracking-wider text-white">Nenhum lead capturado ainda</p>
                      <p className="mt-2 text-xs text-muted">Os interessados enviados pela homepage aparecerao aqui automaticamente.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[980px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-card-border text-[9px] uppercase tracking-widest text-muted">
                            <th className="px-3 py-3">Gestor</th>
                            <th className="px-3 py-3">Evento</th>
                            <th className="px-3 py-3">Cidade / UF</th>
                            <th className="px-3 py-3">Origem</th>
                            <th className="px-3 py-3">Status</th>
                            <th className="px-3 py-3">Notificacao</th>
                            <th className="px-3 py-3">Cadastro</th>
                            <th className="px-3 py-3">Aceite</th>
                          </tr>
                        </thead>
                        <tbody>
                          {commercialLeads.map((lead) => (
                            <tr key={lead.id} className="border-b border-card-border/50 text-xs hover:bg-dark-gray/10">
                              <td className="px-3 py-3 align-top">
                                <p className="font-bold text-white">{lead.managerName}</p>
                                <p className="mt-1 text-[10px] text-muted">{lead.phone}</p>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <p className="font-bold text-white">{lead.eventName}</p>
                              </td>
                              <td className="px-3 py-3 align-top text-muted">
                                {lead.city} / {lead.state}
                              </td>
                              <td className="px-3 py-3 align-top text-muted">
                                {lead.source}
                              </td>
                              <td className="px-3 py-3 align-top">
                                <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                                  {getCommercialLeadStatusLabel(lead.leadStatus)}
                                </span>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                  lead.ownerEmailNotificationStatus === 'sent'
                                    ? 'border border-primary/20 bg-primary/10 text-primary'
                                    : lead.ownerEmailNotificationStatus === 'failed'
                                      ? 'border border-red-500/30 bg-red-950/20 text-red-300'
                                      : 'border border-card-border bg-dark-gray text-muted'
                                }`}>
                                  {getCommercialLeadEmailStatusLabel(lead.ownerEmailNotificationStatus)}
                                </span>
                                <p className="mt-1 text-[10px] text-muted">
                                  {formatDateTime(lead.ownerEmailNotifiedAt)}
                                </p>
                                {lead.ownerEmailRecipient && (
                                  <p className="text-[10px] text-muted">{lead.ownerEmailRecipient}</p>
                                )}
                                {lead.ownerEmailError && lead.ownerEmailNotificationStatus === 'failed' && (
                                  <p className="mt-1 text-[10px] text-red-300">{lead.ownerEmailError}</p>
                                )}
                              </td>
                              <td className="px-3 py-3 align-top text-muted">
                                {formatDateTime(lead.submittedAt)}
                              </td>
                              <td className="px-3 py-3 align-top text-muted">
                                {formatDateTime(lead.acceptedAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ABA: Eventos Globais */}
            {activeTab === 'events' && (
              <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
                <h3 className="text-lg font-bold text-white uppercase tracking-wider border-b border-card-border pb-3">
                  Eventos Ativos na Plataforma
                </h3>

                <div className="border-b border-card-border pb-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                        <Star className="h-4 w-4" aria-hidden="true" />
                        Banner da home
                      </div>
                      <p className="max-w-2xl text-xs leading-5 text-muted">
                        Selecione qual evento ativo sera priorizado no banner principal. Eventos encerrados ficam fora da lista de candidatos.
                      </p>
                      <p className="text-[11px] text-muted-soft">
                        Atual: <span className="font-bold text-white">{featuredHomeEvent?.name || 'Selecao automatica'}</span>
                      </p>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
                      <label htmlFor="owner-featured-home-event" className="sr-only">Evento em destaque na home</label>
                      <select
                        id="owner-featured-home-event"
                        name="owner-featured-home-event"
                        value={selectedFeaturedHomeDraftId}
                        onChange={(e) => setFeaturedHomeDraftId(e.target.value)}
                        className="min-h-11 flex-1 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                      >
                        <option value="">Selecao automatica</option>
                        {featuredHomeCandidates.map(event => (
                          <option key={event.id} value={event.id}>
                            {event.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleSaveFeaturedHomeEvent}
                        disabled={savingFeaturedHomeEvent || selectedFeaturedHomeDraftId === (featuredHomeEvent?.id || '')}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 py-2 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-muted"
                      >
                        <Star className="h-4 w-4" aria-hidden="true" />
                        {savingFeaturedHomeEvent ? 'Salvando' : 'Salvar destaque'}
                      </button>
                    </div>
                  </div>

                  {featuredHomeNotice.text && (
                    <p role={featuredHomeNotice.isError ? 'alert' : 'status'} aria-live="polite" className={`mt-3 text-xs font-bold uppercase ${featuredHomeNotice.isError ? 'text-red-400' : 'text-primary'}`}>
                      {featuredHomeNotice.text}
                    </p>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="border-b border-card-border text-[9px] uppercase tracking-widest text-muted">
                        <th className="py-3 px-3">Logo / Evento</th>
                        <th className="py-3 px-3">Organizador ID</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Data</th>
                        <th className="py-3 px-3 text-right">Taxa Split</th>
                        <th className="py-3 px-3 text-right">Inscrições</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map(event => {
                        const eventRegs = registrations.filter(r => r.eventId === event.id);
                        const eventRevenue = eventRegs.reduce((sum, r) => sum + r.totalPaid, 0);

                        return (
                          <tr key={event.id} className="border-b border-card-border/50 text-xs hover:bg-dark-gray/10">
                            <td className="py-3 px-3 flex items-center gap-3">
                              <div className="w-8 h-8 rounded bg-dark-gray border border-card-border p-0.5 overflow-hidden flex items-center justify-center">
                                {event.logoUrl ? (
                                  <Image src={event.logoUrl} alt={`Logo do evento ${event.name}`} width={32} height={32} unoptimized className="w-full h-full object-cover rounded" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-primary/10 text-[10px] font-black uppercase text-primary">
                                    {event.name.substring(0, 2)}
                                  </div>
                                )}
                              </div>
                              <span className="font-bold text-white uppercase">{event.name}</span>
                            </td>
                            <td className="py-3 px-3 text-muted font-mono">{event.organizerId}</td>
                            <td className="py-3 px-3">
                              {event.status === 'live' ? (
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-bold uppercase rounded">Live</span>
                              ) : event.status === 'upcoming' ? (
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-bold uppercase rounded">Upcoming</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-dark-gray text-muted text-[9px] font-bold uppercase rounded">Finished</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-muted">{event.date}</td>
                            <td className="py-3 px-3 text-right font-bold text-primary font-number">
                              R$ {(event.marketplace_fee !== undefined && event.marketplace_fee !== null ? event.marketplace_fee : 10).toFixed(2)}
                            </td>
                            <td className="py-3 px-3 text-right font-bold font-number text-white">R$ {eventRevenue.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ABA: Leaderboards Globais */}
            {activeTab === 'leaderboards' && (
              <div className="bg-card border border-card-border rounded-xl p-6 space-y-6">
                <h3 className="text-lg font-bold text-white uppercase tracking-wider border-b border-card-border pb-3">
                  Auditar Leaderboard da Plataforma
                </h3>

                <div>
                  <label htmlFor="owner-leaderboard-event" className="block text-xs font-bold text-muted uppercase tracking-wider mb-1">Selecione o Evento para Audit</label>
                  <select
                    id="owner-leaderboard-event"
                    name="owner-leaderboard-event"
                    value={selectedEventIdLead}
                    onChange={(e) => setSelectedEventIdLead(e.target.value)}
                    className="w-full px-4 py-2.5 bg-dark-gray border border-card-border rounded-lg text-white focus:outline-none focus:border-primary/50 text-xs font-semibold uppercase tracking-wider"
                  >
                    {events.map(event => (
                      <option key={event.id} value={event.id}>{event.name}</option>
                    ))}
                  </select>
                </div>

                {selectedEventForLead && (
                  <div className="pt-4 border-t border-card-border/50">
                    <Leaderboard event={selectedEventForLead} />
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
