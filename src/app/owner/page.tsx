'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { BrandLogo } from '@/components/BrandLogo';
import { Leaderboard } from '@/components/Leaderboard';
import { getManagerAccessStatus } from '@/lib/managerAccess';
import { OwnerConfirmDialog } from '@/components/owner/OwnerConfirmDialog';
import { OwnerShell, type OwnerSectionBadge } from '@/components/owner/OwnerShell';
import { isFeaturedHomeEventOffAir, OwnerHomeShowcase } from '@/components/owner/OwnerHomeShowcase';
import { OwnerCommercialSection } from '@/components/owner/OwnerCommercialSection';
import { OwnerManagersSection, type OwnerManagerFilter } from '@/components/owner/OwnerManagersSection';
import { OwnerEventsSection } from '@/components/owner/OwnerEventsSection';
import type { NewManagerInput } from '@/components/owner/OwnerNewManagerForm';
import { AdminLoginScreen } from '@/components/admin/AdminLoginScreen';
import { loginDisplayFont } from '@/components/admin/loginFont';
import {
  buildOwnerSectionSearch, OWNER_SECTION_PARAM, parseOwnerSection, type OwnerSectionId
} from '@/lib/ownerSections';
import { formatOwnerDate } from '@/lib/ownerFinance';
import { OwnerOverviewSection, OWNER_PERIOD_LABELS } from '@/components/owner/OwnerOverviewSection';
import type { OwnerAttentionAction, OwnerOverviewManager, OwnerOverviewPayload, OwnerPeriodKey } from '@/lib/ownerOverview';
import type { CommercialLead, CommercialLeadStatus } from '@/types';

export default function OwnerPage() {
  const {
    events, currentUser, login, logout, createManagerAccount, updateManagerServiceValidity, setFeaturedHomeEvent
  } = useApp();

  // Estados locais
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const loginPendingRef = useRef(false);

  // Seção aberta (Story 1.123): fica no endereço (?secao=), volta com o botão
  // voltar do navegador e sobrevive ao recarregar.
  const [activeSection, setActiveSection] = useState<OwnerSectionId>('visao-geral');

  useEffect(() => {
    const syncFromLocation = () => {
      setActiveSection(parseOwnerSection(new URLSearchParams(window.location.search).get(OWNER_SECTION_PARAM)));
    };
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  // Números da Visão geral vindos do servidor (Story 1.122/1.124, decisão D3).
  const [overviewPeriod, setOverviewPeriod] = useState<OwnerPeriodKey>('30d');
  const [overview, setOverview] = useState<OwnerOverviewPayload | null>(null);
  const [overviewStatus, setOverviewStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [overviewError, setOverviewError] = useState('');
  const [overviewReloadNonce, setOverviewReloadNonce] = useState(0);
  const reloadOverview = () => setOverviewReloadNonce(nonce => nonce + 1);
  // Busca do topo → cartão "Cadastros recentes" (decisão E2).
  const [signupsQuery, setSignupsQuery] = useState('');
  const [signupsQueryNonce, setSignupsQueryNonce] = useState(0);
  // Pedidos da fila de atenção para a seção Gestores (o painel lateral chega na Story 1.125).
  const [focusedManagerId, setFocusedManagerId] = useState<string | null>(null);
  const [managerFilter, setManagerFilter] = useState<OwnerManagerFilter>('all');

  const [managerNotice, setManagerNotice] = useState({ text: '', isError: false });
  const [savingManagerId, setSavingManagerId] = useState<string | null>(null);
  const [commercialLeads, setCommercialLeads] = useState<CommercialLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState('');
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [leadStatusError, setLeadStatusError] = useState('');
  const [serviceFeeConfig, setServiceFeeConfig] = useState({ enabled: true, percent: 10 });
  const [savingServiceFee, setSavingServiceFee] = useState(false);
  const [serviceFeeNotice, setServiceFeeNotice] = useState({ text: '', isError: false });
  // Ações que mudam a plataforma ou bloqueiam um gestor na hora pedem confirmação (Story 1.121).
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'service-fee'; enabled: boolean }
    | { kind: 'past-validity'; managerId: string; managerName: string; value: string }
    | null
  >(null);

  // 1. Validar se o usuário atual é o proprietário (role: 'owner')
  const isOwner = currentUser?.role === 'owner';

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    const loadOverview = async () => {
      setOverviewStatus(current => (current === 'ready' ? 'ready' : 'loading'));
      setOverviewError('');
      try {
        const response = await fetch(`/api/owner/overview?period=${overviewPeriod}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os números do painel.');
        if (!active) return;
        setOverview(data as OwnerOverviewPayload);
        setOverviewStatus('ready');
      } catch (error) {
        if (!active) return;
        setOverviewError(error instanceof Error ? error.message : 'Não foi possível carregar os números do painel.');
        setOverviewStatus('error');
      }
    };
    void loadOverview();
    return () => {
      active = false;
    };
  }, [isOwner, overviewPeriod, overviewReloadNonce]);

  // A vitrine da home (OwnerHomeShowcase) desmonta ao sair de Configurações: um
  // rascunho não salvo não sobrevive e, ao voltar, o controle mostra o publicado.
  const handleSectionChange = (section: OwnerSectionId) => {
    setActiveSection(section);
    const search = buildOwnerSectionSearch(window.location.search, section);
    if (search !== window.location.search) {
      window.history.pushState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
    }
    window.scrollTo({ top: 0 });
  };

  const handleAttentionAction = (action: OwnerAttentionAction) => {
    if (action.kind === 'manager') {
      setManagerFilter('all');
      setFocusedManagerId(action.managerId);
      handleSectionChange('gestores');
    } else if (action.kind === 'managers') {
      setFocusedManagerId(null);
      setManagerFilter(action.filter);
      handleSectionChange('gestores');
    } else {
      handleSectionChange(action.section);
    }
  };

  const handleTopSearch = (term: string) => {
    setSignupsQuery(term);
    setSignupsQueryNonce(nonce => nonce + 1);
    if (activeSection !== 'visao-geral') {
      setActiveSection('visao-geral');
      const search = buildOwnerSectionSearch(window.location.search, 'visao-geral');
      window.history.pushState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
    }
  };

  const featuredHomeEventIsOffAir = useMemo(() => isFeaturedHomeEventOffAir(events), [events]);

  const leadStats = useMemo(() => ({
    total: commercialLeads.length,
    newCount: commercialLeads.filter(lead => lead.leadStatus === 'new').length,
    sentCount: commercialLeads.filter(lead => lead.ownerEmailNotificationStatus === 'sent').length,
    failedCount: commercialLeads.filter(lead => lead.ownerEmailNotificationStatus === 'failed').length
  }), [commercialLeads]);

  // Contadores da barra de seções: o que pede ação em cada uma.
  const sectionBadges = useMemo((): Partial<Record<OwnerSectionId, OwnerSectionBadge>> => {
    const managersNeedingAction = (overview?.managers || [])
      .filter(manager => manager.accessStatus === 'expired' || manager.accessStatus === 'expiring_soon').length;
    return {
      gestores: { count: managersNeedingAction, tone: 'warn', label: `${managersNeedingAction} gestores expirados ou vencendo` },
      comercial: { count: leadStats.newCount, tone: 'neutral', label: `${leadStats.newCount} leads novos` },
      configuracoes: { count: featuredHomeEventIsOffAir ? 1 : 0, tone: 'warn', label: 'Destaque da home fora do carrossel' }
    };
  }, [overview, leadStats.newCount, featuredHomeEventIsOffAir]);

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
        if (active) {
          setServiceFeeConfig({ enabled: data.enabled !== false, percent: Number(data.percent || 10) });
        }
      })
      .catch(error => {
        if (active) setServiceFeeNotice({ text: error instanceof Error ? error.message : 'Erro ao carregar taxa de serviço.', isError: true });
      });

    return () => {
      active = false;
    };
  }, [isOwner]);

  // O botão só abre a confirmação; a troca vale para todos os pagamentos novos.
  const handleServiceFeeToggle = () => {
    setPendingConfirm({ kind: 'service-fee', enabled: !serviceFeeConfig.enabled });
  };

  // Chamado pela confirmação: erro do servidor sobe e aparece no diálogo.
  const saveServiceFee = async (enabled: boolean) => {
    setSavingServiceFee(true);
    setServiceFeeNotice({ text: '', isError: false });
    try {
      const response = await fetch('/api/owner/service-fee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao atualizar taxa de serviço.');
      setServiceFeeConfig({ enabled: data.enabled !== false, percent: Number(data.percent || 10) });
      setServiceFeeNotice({ text: data.enabled !== false ? 'Taxa de serviço ligada.' : 'Taxa de serviço desligada.', isError: false });
      reloadOverview();
    } finally {
      setSavingServiceFee(false);
    }
  };

  // Ação de Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginPendingRef.current) return;
    loginPendingRef.current = true;
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const result = await login(email, password, { ownerOnly: true });
      if (!result.success) setLoginError(result.error);
      else setPassword('');
    } finally {
      loginPendingRef.current = false;
      setIsLoggingIn(false);
    }
  };

  // Cadastro de gestor (painel lateral da seção Gestores): a lista volta da rota.
  const handleCreateManager = async (input: NewManagerInput) => {
    const result = await createManagerAccount(input.name, input.email, input.password, input.organization, input.serviceValidUntil);
    if (result.success) reloadOverview();
    return result;
  };

  const saveManagerValidity = async (managerId: string, value: string) => {
    setSavingManagerId(managerId);
    const updatedUser = await updateManagerServiceValidity(managerId, value || null);
    setSavingManagerId(null);

    if (!updatedUser) {
      setManagerNotice({ text: 'Não foi possível atualizar o prazo de uso do gestor.', isError: true });
      return false;
    }

    setManagerNotice({ text: `Prazo de uso atualizado para ${updatedUser.name}.`, isError: false });
    reloadOverview();
    setTimeout(() => setManagerNotice({ text: '', isError: false }), 4000);
    return true;
  };

  // Validade no passado bloqueia o painel e as vendas do gestor na hora: pede confirmação.
  const handleSaveManagerValidity = async (manager: OwnerOverviewManager, value: string) => {
    if (value === (manager.serviceValidUntil || '')) return;
    if (value && getManagerAccessStatus(value) === 'expired') {
      setPendingConfirm({ kind: 'past-validity', managerId: manager.id, managerName: manager.name, value });
      return;
    }
    await saveManagerValidity(manager.id, value);
  };

  // Status do lead na linha (Story 1.126, D5): troca na hora e volta atrás se o servidor recusar.
  const handleLeadStatusChange = async (lead: CommercialLead, leadStatus: CommercialLeadStatus) => {
    if (lead.leadStatus === leadStatus || savingLeadId) return;
    const previous = lead.leadStatus;
    setSavingLeadId(lead.id);
    setLeadStatusError('');
    setCommercialLeads(current => current.map(item => (item.id === lead.id ? { ...item, leadStatus } : item)));
    try {
      const response = await fetch('/api/commercial-leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lead.id, leadStatus })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.lead) throw new Error(data.error || 'Não foi possível atualizar o status do lead.');
      setCommercialLeads(current => current.map(item => (item.id === lead.id ? data.lead as CommercialLead : item)));
      reloadOverview();
    } catch (error) {
      setCommercialLeads(current => current.map(item => (item.id === lead.id ? { ...item, leadStatus: previous } : item)));
      setLeadStatusError(error instanceof Error ? error.message : 'Não foi possível atualizar o status do lead.');
    } finally {
      setSavingLeadId(null);
    }
  };

  if (!isOwner) {
    // Mesma tela de login do /admin (Story 1.92), variante do proprietário (Story 1.123, D6).
    return (
      <div className={`${loginDisplayFont.variable} relative min-h-screen bg-background text-foreground`}>
        <div className="absolute left-4 top-4 flex items-center gap-2.5 sm:left-6 sm:top-6">
          <BrandLogo className="h-10 w-10 rounded-sm border border-card-border" priority />
          <span className="text-sm font-bold text-white">WODArena</span>
        </div>
        <AdminLoginScreen
          variant="owner"
          mode="login"
          notice={loginError ? { text: loginError, tone: 'error' } : null}
          login={{
            email,
            password,
            submitting: isLoggingIn,
            onEmailChange: setEmail,
            onPasswordChange: setPassword,
            onSubmit: handleLogin
          }}
        />
      </div>
    );
  }

  return (
    <OwnerShell
      active={activeSection}
      onNavigate={handleSectionChange}
      badges={sectionBadges}
      userName={currentUser?.name || currentUser?.email || 'Proprietário'}
      onLogout={logout}
      onSearch={handleTopSearch}
      toolbar={activeSection === 'visao-geral' ? (
        <div className="inline-flex rounded-lg border border-card-border bg-dark-gray p-0.5" role="group" aria-label="Período dos números">
          {(['month', '30d', 'year', 'all'] as OwnerPeriodKey[]).map(period => (
            <button
              key={period}
              type="button"
              onClick={() => setOverviewPeriod(period)}
              aria-pressed={overviewPeriod === period}
              className={`min-h-10 rounded-md px-3 text-xs font-semibold transition-colors ${overviewPeriod === period ? 'bg-card text-white' : 'text-muted hover:text-white'}`}
            >
              {OWNER_PERIOD_LABELS(overview ? Number(overview.generatedAt.slice(0, 4)) : new Date().getFullYear())[period]}
            </button>
          ))}
        </div>
      ) : undefined}
    >
            {/* SEÇÃO: Visão geral (Story 1.124) */}
            {activeSection === 'visao-geral' && (
              <OwnerOverviewSection
                overview={overview}
                status={overviewStatus}
                error={overviewError}
                onRetry={reloadOverview}
                onAttentionAction={handleAttentionAction}
                onOpenEvents={() => handleSectionChange('eventos')}
                signupsQuery={signupsQuery}
                signupsQueryNonce={signupsQueryNonce}
                key={`overview-${signupsQueryNonce}`}
              />
            )}

            {/* SEÇÃO: Gestores (Story 1.125) */}
            {activeSection === 'gestores' && (
              <OwnerManagersSection
                managers={overview?.managers ?? null}
                events={overview?.events ?? []}
                filter={managerFilter}
                onFilterChange={setManagerFilter}
                focusedManagerId={focusedManagerId}
                onFocusManager={setFocusedManagerId}
                onSaveValidity={handleSaveManagerValidity}
                savingManagerId={savingManagerId}
                notice={managerNotice}
                onCreateManager={handleCreateManager}
              />
            )}

            {/* SEÇÃO: Comercial (Story 1.126) */}
            {activeSection === 'comercial' && (
              <OwnerCommercialSection
                leads={commercialLeads}
                loading={leadsLoading}
                error={leadsError}
                savingLeadId={savingLeadId}
                statusError={leadStatusError}
                onStatusChange={handleLeadStatusChange}
              />
            )}

            {/* SEÇÃO: Eventos (Story 1.125): tabela com filtro e busca; ranking no detalhe do evento */}
            {activeSection === 'eventos' && (
              <OwnerEventsSection
                events={overview?.events ?? null}
                renderRanking={eventId => {
                  const event = events.find(item => item.id === eventId);
                  return event ? <Leaderboard event={event} /> : null;
                }}
              />
            )}

            {/* SEÇÃO: Configurações (taxa de serviço e vitrine da home) */}
            {activeSection === 'configuracoes' && (
              <div className="space-y-6">
                <section aria-labelledby="owner-fee-title" className="space-y-4 rounded-xl border border-card-border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <p id="owner-fee-title" className="text-sm font-bold text-white">Taxa de serviço</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${serviceFeeConfig.enabled ? 'bg-primary/10 text-primary' : 'bg-dark-gray text-muted'}`}>
                        {serviceFeeConfig.enabled ? 'Ligada' : 'Desligada'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleServiceFeeToggle}
                      disabled={savingServiceFee}
                      className={`min-h-11 w-full rounded-md border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-60 sm:w-auto ${serviceFeeConfig.enabled ? 'border-red-500/50 bg-transparent text-red-300 hover:bg-red-950/30' : 'border-primary bg-primary text-black hover:bg-primary-hover'}`}
                    >
                      {savingServiceFee ? 'Salvando…' : serviceFeeConfig.enabled ? 'Desligar taxa' : 'Ligar taxa'}
                    </button>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                    <dt className="text-muted">Percentual</dt><dd className="font-semibold text-white">{serviceFeeConfig.percent}% de cada inscrição paga</dd>
                    <dt className="text-muted">Quem paga</dt><dd className="font-semibold text-white">Escolha de cada gestor (atleta paga ou gestor absorve)</dd>
                    <dt className="text-muted">Vale para</dt><dd className="font-semibold text-white">Pagamentos criados depois de salvar</dd>
                  </dl>
                  <p className="text-xs text-muted">Inscrições já pagas nunca mudam. A escolha de quem paga continua na aba Pagamentos de cada gestor. Contas conectadas manualmente precisam reconectar pelo Mercado Pago.</p>
                  {serviceFeeNotice.text && (
                    <p role={serviceFeeNotice.isError ? 'alert' : 'status'} className={`text-xs font-bold ${serviceFeeNotice.isError ? 'text-red-400' : 'text-primary'}`}>
                      {serviceFeeNotice.text}
                    </p>
                  )}
                </section>

                <OwnerHomeShowcase events={events} setFeaturedHomeEvent={setFeaturedHomeEvent} onSaved={reloadOverview} />
              </div>
            )}


      {pendingConfirm?.kind === 'service-fee' && (
        <OwnerConfirmDialog
          title={pendingConfirm.enabled ? 'Ligar a taxa de serviço?' : 'Desligar a taxa de serviço?'}
          confirmText={pendingConfirm.enabled ? 'Ligar taxa' : 'Desligar taxa'}
          danger={!pendingConfirm.enabled}
          onClose={() => setPendingConfirm(null)}
          onConfirm={async () => {
            await saveServiceFee(pendingConfirm.enabled);
            setPendingConfirm(null);
          }}
        >
          <p>
            {pendingConfirm.enabled
              ? `Os pagamentos criados a partir de agora, em todos os eventos, terão a taxa WODArena de ${serviceFeeConfig.percent}%.`
              : 'Os pagamentos criados a partir de agora, em todos os eventos, não terão a taxa WODArena.'}
          </p>
          <p>Inscrições já pagas não mudam.</p>
        </OwnerConfirmDialog>
      )}

      {pendingConfirm?.kind === 'past-validity' && (
        <OwnerConfirmDialog
          title="Salvar uma validade que já passou?"
          confirmText="Salvar e bloquear"
          danger
          onClose={() => setPendingConfirm(null)}
          onConfirm={async () => {
            const saved = await saveManagerValidity(pendingConfirm.managerId, pendingConfirm.value);
            if (!saved) throw new Error('Não foi possível atualizar o prazo de uso do gestor.');
            setPendingConfirm(null);
          }}
        >
          <p>
            {formatOwnerDate(pendingConfirm.value)} já passou: {pendingConfirm.managerName} fica bloqueado agora, sem acesso ao painel e com as vendas dos eventos paradas até uma nova renovação.
          </p>
        </OwnerConfirmDialog>
      )}
    </OwnerShell>
  );
}
