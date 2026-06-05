'use client';

import React, { useState, use, useEffect } from 'react';
import Image from 'next/image';
import { useApp } from '@/context/AppContext';
import { Leaderboard } from '@/components/Leaderboard';
import { RegisterModal } from '@/components/RegisterModal';
import { RegistrationVoucher } from '@/components/RegistrationVoucher';
import { 
  Calendar, MapPin, Trophy, Share2, Ticket, Clock, 
  Dumbbell, AlignLeft, ShieldCheck, ChevronRight, UserCheck, Medal
} from 'lucide-react';
import Link from 'next/link';
import { Registration, Athlete } from '@/types';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EventPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const eventId = resolvedParams.id;
  
  const { events, athletes, registerTicket, incrementCouponUsage } = useApp();
  const [activeTab, setActiveTab] = useState<'details' | 'divisions' | 'schedule' | 'workouts' | 'leaderboard'>('details');
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [shareFeedback, setShareFeedback] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [confirmedVoucher, setConfirmedVoucher] = useState<{ registration: Registration; athlete: Athlete; cpf?: string } | null>(null);

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

  // Permitir trocar aba via query parameter se fornecido (ex: ?tab=leaderboard)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const tabParam = searchParams.get('tab');
      if (tabParam && ['details', 'divisions', 'schedule', 'workouts', 'leaderboard'].includes(tabParam)) {
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
            
            const createdReg = registerTicket(registrationData, athleteProfile);
            
            if (registrationData.couponCode && event) {
              incrementCouponUsage(event.id, registrationData.couponCode);
            }

            setTimeout(() => {
              setConfirmedVoucher({
                registration: createdReg || {
                  ...registrationData,
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
  }, [event, registerTicket, incrementCouponUsage]);

  if (!event) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
        <Trophy className="h-16 w-16 text-muted animate-bounce" />
        <h2 className="text-xl font-bold text-white uppercase tracking-wider">Evento não encontrado</h2>
        <Link href="/" className="text-sm text-primary hover:underline uppercase font-extrabold tracking-widest">
          Voltar para Home
        </Link>
      </div>
    );
  }

  // Copiar link para compartilhar
  const handleShare = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setShareFeedback(true);
      setTimeout(() => setShareFeedback(false), 2000);
    }
  };

  const scheduleItems = [...(event.scheduleItems || [])]
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const getScheduleKindLabel = (kind: string) => {
    if (kind === 'briefing') return 'Briefing';
    if (kind === 'kit_delivery') return 'Entrega de kits';
    return 'Cronograma do evento';
  };

  const getScheduleModeLabel = (mode?: string) => {
    if (mode === 'online') return 'Online';
    if (mode === 'presential') return 'Presencial';
    return 'Evento';
  };

  const handleTabChange = (tabId: typeof activeTab) => {
    setActiveTab(tabId);
    window.history.replaceState(null, '', `${window.location.pathname}?tab=${tabId}`);
  };

  const getStatusLabel = (status: typeof event.status) => {
    switch (status) {
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
                  {getStatusLabel(event.status)}
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
                  disabled={!event.isTicketingActive}
                  onClick={() => setIsRegisterOpen(true)}
                  className={`flex flex-1 sm:flex-initial min-h-11 items-center justify-center gap-1.5 rounded-md px-6 py-3 text-xs font-bold uppercase transition-colors ${
                    event.isTicketingActive
                      ? 'bg-primary text-ink hover:bg-primary-hover active:scale-95'
                      : 'bg-muted/10 text-muted border border-card-border cursor-not-allowed'
                  }`}
                >
                  <Ticket className="h-4 w-4" />
                  <span>{event.isTicketingActive ? 'Comprar Ingresso' : 'Inscrições Encerradas'}</span>
                </button>
              )}
            </div>

          </div>
        </div>
      </section>

      {/* Navegação por Abas Rápidas */}
      <section className="sticky top-16 z-40 border-b border-card-border bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex overflow-x-auto gap-2 py-3 scrollbar-none">
            {[
              { id: 'details', label: 'Detalhes', icon: AlignLeft },
              { id: 'divisions', label: 'Divisões', icon: Trophy },
              { id: 'schedule', label: 'Horário', icon: Clock },
              { id: 'workouts', label: 'Exercícios', icon: Dumbbell },
              { id: 'leaderboard', label: 'Leaderboard', icon: Medal }
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id as typeof activeTab)}
                  className={`flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-4 py-2 text-xs font-extrabold uppercase tracking-wider transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary/10 border-primary text-primary font-black'
                      : 'bg-transparent text-muted border-transparent hover:text-white hover:border-card-border'
                  }`}
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
                    <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Local das Baterias</h4>
                    <p className="text-sm text-white font-semibold mt-1">{event.location}</p>
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
                      {event.status === 'upcoming' && (
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
              <div className="space-y-6 rounded-xl border border-card-border bg-card p-6">
                <h3 className="text-lg font-black text-white uppercase tracking-wider border-b border-card-border pb-3">
                  Cronograma Oficial
                </h3>
                
                <div className="space-y-6 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-card-border">
                  {scheduleItems.length > 0 ? (
                    scheduleItems.map((item, index) => {
                      const isHeat = item.kind === 'heat';
                      return (
                        <div key={item.id} className="flex gap-4 relative">
                          <div className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-dark-gray ${
                            index === scheduleItems.length - 1 ? 'border-card-border' : 'border-primary'
                          }`}>
                            <span className={`h-2.5 w-2.5 rounded-full ${index === scheduleItems.length - 1 ? 'bg-muted' : 'bg-primary'}`}></span>
                          </div>
                          {isHeat ? (
                            <div className="space-y-2 w-full bg-dark-gray/25 p-4 rounded-xl border border-card-border/60 hover:border-primary/20 transition-colors text-white">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                                  Bateria de Prova
                                </span>
                                <span className="text-[9px] font-black uppercase tracking-wider text-muted-soft">{item.date}</span>
                              </div>
                              <h4 className="text-sm font-extrabold text-white uppercase">{item.title}</h4>
                              <div className="grid grid-cols-4 gap-2 pt-2 text-center text-[10px] font-bold uppercase tracking-wider">
                                <div className="bg-dark-gray/50 p-2 rounded border border-card-border/30">
                                  <span className="text-muted block text-[8px] mb-1 font-sans">Aquecimento</span>
                                  <span className="text-white text-xs font-number font-bold">{item.warmupTime}</span>
                                </div>
                                <div className="bg-dark-gray/50 p-2 rounded border border-card-border/30">
                                  <span className="text-muted block text-[8px] mb-1 font-sans">Fila</span>
                                  <span className="text-white text-xs font-number font-bold">{item.checkinTime}</span>
                                </div>
                                <div className="bg-primary/20 p-2 rounded border border-primary/30">
                                  <span className="text-primary block text-[8px] mb-1 font-sans">Início</span>
                                  <span className="text-primary text-xs font-number font-bold">{item.time}</span>
                                </div>
                                <div className="bg-dark-gray/50 p-2 rounded border border-card-border/30">
                                  <span className="text-muted block text-[8px] mb-1 font-sans">Final</span>
                                  <span className="text-white text-xs font-number font-bold">{item.endTime}</span>
                                </div>
                              </div>
                              {item.athleteIds && item.athleteIds.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-card-border/40 space-y-2 text-left">
                                  <span className="text-[9px] font-black text-muted-soft uppercase tracking-wider block">Atletas / Equipes</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {item.athleteIds.map(athId => {
                                      const ath = athletes.find(a => a.id === athId);
                                      if (!ath) return null;
                                      return (
                                        <span 
                                          key={athId} 
                                          className="inline-flex items-center gap-1 rounded bg-black/40 border border-card-border/60 px-2.5 py-1 text-[10px] font-bold text-white transition-colors hover:border-primary/30"
                                        >
                                          {ath.isTeam && (
                                            <span className="text-[8px] bg-primary/20 text-primary px-1 rounded font-black">EQ</span>
                                          )}
                                          {ath.name}
                                          {ath.box && <span className="text-muted-soft text-[9px] font-normal">({ath.box})</span>}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">
                                  {getScheduleKindLabel(item.kind)}
                                </span>
                                <span className="rounded border border-card-border bg-dark-gray px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-muted">
                                  {getScheduleModeLabel(item.mode)}
                                </span>
                                <span className="text-[10px] font-black uppercase tracking-wider text-white">{item.date} às {item.time}</span>
                              </div>
                              <h4 className="text-sm font-extrabold text-white">{item.title}</h4>
                              <p className="text-xs text-muted">{item.description}</p>
                              {item.location && (
                                <p className="text-xs text-muted">Local/link: {item.location}</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
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
              </div>
            )}

            {/* Aba 4: Exercícios / Provas */}
            {activeTab === 'workouts' && (
              <div className="space-y-4">
                <h3 className="text-lg font-black text-white uppercase tracking-wider border-b border-card-border pb-3 mb-2">
                  Provas Anunciadas
                </h3>
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
              </div>
            )}

            {/* Aba 5: Leaderboard */}
            {activeTab === 'leaderboard' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-card-border pb-3 mb-2">
                  <h3 className="text-lg font-black text-white uppercase tracking-wider">
                    Placar de Líderes
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary"></span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">Atualizado em tempo real</span>
                  </div>
                </div>
                <Leaderboard event={event} />
              </div>
            )}

          </div>

          {/* Direita: Sidebar Lateral de Detalhes Rápidos */}
          <div className="space-y-6">
            
            {/* Card de Inscrição na Lateral */}
            {event.status === 'upcoming' && (
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
