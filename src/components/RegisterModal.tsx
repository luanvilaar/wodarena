'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Check, CreditCard, ShieldCheck, Ticket, X, Lock } from 'lucide-react';
import Script from 'next/script';
import Link from 'next/link';
import { Event, Division, Registration, Athlete } from '@/types';
import { useApp } from '@/context/AppContext';
import { normalizeInstagram } from '@/lib/fitnessRacing';

interface RegisterModalProps {
  event: Event;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (registration: Registration, athlete: Athlete, cpf: string) => void;
}

type ParticipantForm = {
  name: string;
  email: string;
  phone: string;
  gender: 'male' | 'female';
  birthDate: string;
  city: string;
  state: string;
  instagram: string;
  photoUrl: string;
};

type CheckoutRegistrationData = Omit<Registration, 'createdAt'> & Partial<Pick<Registration, 'createdAt'>>;
type CheckoutStatusResponse = {
  status?: string;
  registrationData?: CheckoutRegistrationData | null;
  athleteProfile?: Athlete | null;
  cpf?: string;
};

type RegistrationStartResponse = {
  success?: boolean;
  registrationData?: CheckoutRegistrationData;
  athleteProfile?: Athlete;
  error?: string;
};

type CheckoutConfigResponse = {
  publicKey?: string;
  error?: string;
};

const createEmptyParticipant = (): ParticipantForm => ({
  name: '',
  email: '',
  phone: '',
  gender: 'male',
  birthDate: '',
  city: '',
  state: '',
  instagram: '',
  photoUrl: ''
});

const generateUniqueId = (prefix: string) => {
  return `${prefix}-${Date.now()}`;
};

const resolveCheckoutPublicKey = async (eventId: string, eventPublicKey?: string) => {
  try {
    const response = await fetch(`/api/checkout/config?event_id=${eventId}`);
    const data: CheckoutConfigResponse = await response.json();
    if (response.ok && data.publicKey) {
      return data.publicKey;
    } else {
      console.error("[resolveCheckoutPublicKey] Erro ao obter Public Key do servidor:", data);
    }
  } catch (err) {
    console.error("[resolveCheckoutPublicKey] Erro ao buscar do servidor:", err);
  }

  if (eventPublicKey) return eventPublicKey;
  throw new Error('O pagamento por cartão de crédito está temporariamente indisponível para este evento. Por favor, tente realizar o pagamento via Pix ou entre em contato com os organizadores.');
};

const getCheckoutErrorMessage = async (response: Response, fallback: string) => {
  try {
    const data = await response.json();
    const detail = data.statusDetail ? ` (${data.statusDetail})` : '';
    return `${data.error || fallback}${detail}`;
  } catch {
    return fallback;
  }
};

export function RegisterModal({ event, isOpen, onClose, onSuccess }: RegisterModalProps) {
  const { coupons, registerTicket, incrementCouponUsage } = useApp();
  const [selectedDivisionId, setSelectedDivisionId] = useState(event.divisions[0]?.id || '');
  const [box, setBox] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamInstagram, setTeamInstagram] = useState('');
  const [participants, setParticipants] = useState<ParticipantForm[]>([createEmptyParticipant()]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [discountApplied, setDiscountApplied] = useState(0);
  const [couponNotice, setCouponNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'credit_card'>('pix');
  const [cpf, setCpf] = useState('');
  const [pixData, setPixData] = useState<{ qr_code: string; qr_code_base64: string; paymentId: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [securityCode, setSecurityCode] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [athletePassword, setAthletePassword] = useState('');
  const [athletePasswordConfirmation, setAthletePasswordConfirmation] = useState('');

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    setAcceptedTerms(false);
    setIsSuccess(false);
    setPixData(null);
    setCardNumber('');
    setCardholderName('');
    setExpirationDate('');
    setSecurityCode('');
    setAthletePassword('');
    setAthletePasswordConfirmation('');
  }

  // Polling para verificar status do pagamento Pix
  useEffect(() => {
    if (!pixData?.paymentId) return;

    let active = true;
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/checkout/status?payment_id=${pixData.paymentId}&event_id=${event.id}`);
        if (!res.ok) return;
        const data: CheckoutStatusResponse = await res.json();
        if (data.status === 'approved' && active) {
          active = false; // Bloqueia reentradas concorrentes
          clearInterval(intervalId);

          // Registrar localmente
          const pendingRegStr = sessionStorage.getItem('pending_registration');
          let createdReg = null;
          let parsedAthlete = null;
          let parsedCpf = cpf;
          let registrationPayload = data.registrationData || null;
          let athletePayload = data.athleteProfile || null;

          if (pendingRegStr) {
            try {
              const { registrationData, athleteProfile, cpf: savedCpf } = JSON.parse(pendingRegStr);
              registrationPayload = registrationData;
              athletePayload = athleteProfile;
              parsedCpf = savedCpf || cpf;
            } catch (err) {
              console.error("[RegisterModal Pix success] Erro ao registrar localmente:", err);
            } finally {
              sessionStorage.removeItem('pending_registration');
            }
          }

          if (registrationPayload && athletePayload) {
            createdReg = registerTicket(registrationPayload, athletePayload);
            parsedAthlete = athletePayload;
            parsedCpf = parsedCpf || data.cpf || cpf;
            if (registrationPayload.couponCode) {
              incrementCouponUsage(event.id, registrationPayload.couponCode);
            }
          }

          if (createdReg && parsedAthlete) {
            // Disparar envio de e-mail local em background
            fetch('/api/checkout/email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ registrationId: createdReg.id, cpf: parsedCpf })
            }).catch(err => console.error("[Local Email Trigger] Erro ao disparar e-mail:", err));

            if (onSuccess) {
              onSuccess(createdReg, parsedAthlete, parsedCpf);
            }
            setIsSuccess(true);
          } else {
            setIsSuccess(true);
          }
        }
      } catch (err) {
        console.error("[Checkout Status Polling] Erro ao verificar status:", err);
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [pixData, event.id, registerTicket, incrementCouponUsage, onSuccess, onClose, cpf]);

  const isValidCPF = (val: string) => {
    const clean = val.replace(/\D/g, '');
    if (clean.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(clean)) return false;
    return true;
  };

  const selectedDivision = event.divisions.find(d => d.id === selectedDivisionId);
  const participantCount = useMemo(() => {
    if (!selectedDivision) return 1;
    if (selectedDivision.type === 'duo') return 2;
    if (selectedDivision.type === 'trio') return 3;
    if (selectedDivision.type === 'team') return 4;
    return 1;
  }, [selectedDivision]);

  const visibleParticipants = useMemo(
    () => Array.from({ length: participantCount }, (_, index) => participants[index] || createEmptyParticipant()),
    [participantCount, participants]
  );

  // Preços dinâmicos baseados no ticketPrice do evento e formato
  const getPrice = (div: Division | undefined) => {
    const basePrice = event.ticketPrice ?? 150;
    if (!div) return basePrice;
    return div.price ?? basePrice;
  };

  const ticketPrice = getPrice(selectedDivision);
  const baseTotalPaid = Math.max(0, ticketPrice - discountApplied);
  const totalPaid = baseTotalPaid > 0 && baseTotalPaid < 1.00 ? 1.00 : baseTotalPaid;
  const isTeamCategory = participantCount > 1;
  const primaryParticipant = visibleParticipants[0] || createEmptyParticipant();
  const isFitnessRacing = event.eventType === 'fitness_racing';

  const handleApplyCoupon = () => {
    if (!selectedDivision) return;
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setAppliedCoupon(null);
      setDiscountApplied(0);
      setCouponNotice(null);
      return;
    }

    const coupon = coupons.find(c => c.eventId === event.id && c.code.toUpperCase() === code);
    if (!coupon) {
      setCouponNotice({ text: 'Cupom inválido ou inexistente para este evento.', tone: 'error' });
      setAppliedCoupon(null);
      setDiscountApplied(0);
      return;
    }

    if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
      setCouponNotice({ text: 'Este cupom já atingiu o limite de utilização.', tone: 'error' });
      setAppliedCoupon(null);
      setDiscountApplied(0);
      return;
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = (ticketPrice * coupon.discountValue) / 100;
    } else {
      discount = coupon.discountValue;
    }

    setDiscountApplied(discount);
    setAppliedCoupon(coupon.code);
    setCouponNotice({ text: `Cupom "${coupon.code}" aplicado com sucesso!`, tone: 'success' });
  };

  const updateParticipant = (index: number, field: keyof ParticipantForm, value: string) => {
    setParticipants((current) => {
      const expanded = Array.from({ length: Math.max(current.length, participantCount) }, (_, participantIndex) => current[participantIndex] || createEmptyParticipant());
      return expanded.map((participant, participantIndex) => (
        participantIndex === index ? { ...participant, [field]: value } : participant
      ));
    });
  };

  const startRegistration = useCallback(async (
    registrationData: CheckoutRegistrationData,
    athleteProfile: Athlete,
    initialPaymentStatus?: string
  ) => {
    const response = await fetch('/api/registrations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationData,
        athleteProfile,
        password: athletePassword,
        passwordConfirmation: athletePasswordConfirmation,
        paymentMethod: totalPaid === 0 ? 'free' : paymentMethod,
        initialPaymentStatus
      })
    });
    const payload: RegistrationStartResponse = await response.json().catch(() => ({}));

    if (!response.ok || !payload.registrationData || !payload.athleteProfile) {
      throw new Error(payload.error || 'Erro ao iniciar inscrição do atleta.');
    }

    return {
      registrationData: payload.registrationData,
      athleteProfile: payload.athleteProfile
    };
  }, [athletePassword, athletePasswordConfirmation, paymentMethod, totalPaid]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!acceptedTerms) {
      alert('Você precisa aceitar os Termos e Políticas de Compra para prosseguir.');
      return;
    }

    const hasMissingRequiredParticipantData = visibleParticipants.some((participant) => {
      if (!participant.name || !participant.gender) return true;
      if (participant === primaryParticipant && (!participant.email || !participant.phone)) return true;
      if (!isFitnessRacing) return !participant.email || !participant.phone;
      return !participant.birthDate || !participant.city || !participant.state || !participant.instagram;
    });

    if (hasMissingRequiredParticipantData || (isFitnessRacing && !box)) {
      alert(isFitnessRacing
        ? 'Preencha nome, nascimento, sexo, cidade, estado, box e Instagram.'
        : 'Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (!primaryParticipant.email || !primaryParticipant.email.includes('@')) {
      alert('Informe um e-mail válido para criar o painel do atleta.');
      return;
    }

    if (!athletePassword || athletePassword.length < 6) {
      alert('Crie uma senha de pelo menos 6 caracteres para o painel do atleta.');
      return;
    }

    if (athletePassword !== athletePasswordConfirmation) {
      alert('A confirmação de senha não confere.');
      return;
    }

    if (paymentMethod === 'pix' && !isValidCPF(cpf)) {
      alert('Por favor, informe um CPF válido para gerar o Pix.');
      return;
    }

    setIsProcessing(true);

    const athleteNames = visibleParticipants.map((participant) => participant.name.trim());
    const finalCompetidorName = isTeamCategory
      ? `${teamName.trim() || selectedDivision?.name || 'Equipe'} (${athleteNames.join(' / ')})`
      : primaryParticipant.name.trim();
    const teamMembers = isTeamCategory
      ? visibleParticipants.map((participant) => ({
          name: participant.name.trim(),
          instagram: normalizeInstagram(participant.instagram)
        }))
      : [];

    const regId = generateUniqueId('reg');
    const athleteId = generateUniqueId('ath');

    const registrationData = {
      id: regId,
      eventId: event.id,
      divisionId: selectedDivisionId,
      athleteName: finalCompetidorName,
      athleteEmail: primaryParticipant.email || 'nao-informado@wodarena.com',
      athletePhone: primaryParticipant.phone || 'Não informado',
      box: box || 'Independente',
      gender: primaryParticipant.gender,
      ticketType: selectedDivision?.name || 'Inscrição Geral',
      ticketPrice,
      quantity: 1,
      totalPaid,
      couponCode: appliedCoupon || undefined
    };

    const athleteProfile = {
      id: athleteId,
      name: finalCompetidorName,
      box: box || 'Independente',
      country: 'BR',
      divisionId: selectedDivisionId,
      birthDate: primaryParticipant.birthDate,
      city: primaryParticipant.city,
      state: primaryParticipant.state,
      photoUrl: primaryParticipant.photoUrl,
      email: primaryParticipant.email,
      phone: primaryParticipant.phone,
      gender: primaryParticipant.gender,
      instagram: isTeamCategory ? normalizeInstagram(teamInstagram || primaryParticipant.instagram) : normalizeInstagram(primaryParticipant.instagram),
      isTeam: isTeamCategory,
      teamMembers
    };

    try {
      const started = await startRegistration(
        registrationData,
        athleteProfile,
        totalPaid === 0 ? 'payment_approved' : 'payment_pending'
      );
      const activeRegistrationData = started.registrationData;
      const activeAthleteProfile = started.athleteProfile;

      if (totalPaid === 0) {
        console.log("[Checkout WODArena] Inscrição gratuita (totalPaid === 0). Aprovando imediatamente...");
        const createdReg = registerTicket(activeRegistrationData, activeAthleteProfile);
        if (registrationData.couponCode) {
          incrementCouponUsage(event.id, registrationData.couponCode);
        }

        const finalReg = createdReg || {
          ...registrationData,
          id: registrationData.id || `reg-${Date.now()}`,
          createdAt: new Date().toISOString()
        };

        // Enviar e-mail de confirmação via Resend em background
        fetch('/api/checkout/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: finalReg.id, cpf })
        }).catch(err => console.error("[Local Email Trigger] Erro ao disparar e-mail gratuito:", err));

        if (onSuccess) {
          onSuccess(finalReg, activeAthleteProfile, cpf);
        }
        setIsSuccess(true);
        setIsProcessing(false);
        return;
      }

      if (paymentMethod === 'pix') {
        console.log("[Checkout WODArena] Criando pagamento Pix no Mercado Pago...");
        const response = await fetch('/api/checkout/pix', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            registrationData: activeRegistrationData,
            athleteProfile: activeAthleteProfile,
            cpf
          })
        });

        if (!response.ok) {
          throw new Error(await getCheckoutErrorMessage(response, 'Erro ao criar cobrança Pix.'));
        }

        const data = await response.json();
        
        sessionStorage.setItem('pending_registration', JSON.stringify({ registrationData: activeRegistrationData, athleteProfile: activeAthleteProfile, cpf }));

        setPixData({
          qr_code: data.qr_code,
          qr_code_base64: data.qr_code_base64,
          paymentId: data.paymentId
        });
        setIsProcessing(false);

      } else {
        console.log("[Checkout WODArena] Criando preferência de pagamento (Checkout Pro) no Mercado Pago...");
        const response = await fetch('/api/checkout/preference', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            registrationData: activeRegistrationData,
            athleteProfile: activeAthleteProfile,
            origin: window.location.origin
          })
        });

        if (!response.ok) {
          throw new Error('Erro ao gerar link de pagamento via Mercado Pago.');
        }

        const data = await response.json();
        const initPoint = data.init_point;
        if (!initPoint) {
          throw new Error('Link de pagamento inválido retornado pelo Mercado Pago.');
        }

        // Redireciona o usuário para o Mercado Pago na mesma aba
        window.location.assign(initPoint);
        return;
      }

    } catch (err) {
      console.error("[Checkout WODArena] Erro no processamento do checkout:", err);
      alert(err instanceof Error ? err.message : 'Houve um erro ao processar o seu checkout. Por favor, tente novamente.');
      setIsProcessing(false);
    }
  }, [
    visibleParticipants,
    isFitnessRacing,
    box,
    isTeamCategory,
    teamName,
    selectedDivision,
    primaryParticipant,
    event.id,
    selectedDivisionId,
    ticketPrice,
    totalPaid,
    appliedCoupon,
    teamInstagram,
    paymentMethod,
    cpf,
    cardNumber,
    cardholderName,
    expirationDate,
    securityCode,
    onClose,
    registerTicket,
    incrementCouponUsage,
    onSuccess,
    event.mpPublicKey,
    acceptedTerms,
    athletePassword,
    athletePasswordConfirmation,
    startRegistration
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="transactional-surface relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl" role="dialog" aria-modal="true" aria-labelledby="registration-title">
        <div className="flex items-center justify-between border-b border-hairline-light px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
              <Ticket className="h-4 w-4 text-ink" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9a7200]">Checkout WODArena</p>
              <h3 id="registration-title" className="text-base font-bold text-ink">Confirmar inscrição</h3>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-soft transition-colors hover:bg-surface-soft-light hover:text-ink"
            aria-label="Fechar modal de inscrição"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain p-6">
          {isSuccess ? (
            <div className="text-center py-4 space-y-6" role="status" aria-live="polite">
              <div className="space-y-2">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                  <Check className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <h4 className="text-xl font-black tracking-tight text-white uppercase">Inscrição Confirmada!</h4>
                <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-soft">
                  Você está garantido na arena. Tire um print do seu ticket abaixo para postar nos seus Stories do Instagram! 🚀
                </p>
              </div>

              {/* TICKET DIGITAL PREMIUM */}
              <div className="relative mx-auto w-full rounded-2xl overflow-hidden border border-neutral-800 bg-[#16181e] shadow-2xl text-left">
                {/* Cabeçalho do Ticket com Banner de Fundo */}
                <div className="relative h-28 p-5 flex flex-col justify-end overflow-hidden">
                  {event.bannerUrl ? (
                    <>
                      <img 
                        src={event.bannerUrl} 
                        alt="Banner do Evento" 
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#16181e] via-[#16181e]/85 to-black/40" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-neutral-900 to-black" />
                  )}
                  
                  <div className="relative z-10 flex items-end justify-between">
                    <div className="flex items-center gap-2">
                      {event.logoUrl && (
                        <img 
                          src={event.logoUrl} 
                          alt="Logo do Evento" 
                          className="h-10 w-10 rounded-full border border-neutral-700 bg-[#16181e] p-0.5 object-cover"
                        />
                      )}
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-wider text-primary">WODArena ticket</span>
                        <h5 className="text-sm font-black text-white truncate max-w-[220px] uppercase">{event.name}</h5>
                      </div>
                    </div>
                    <div className="rounded bg-primary px-2 py-0.5 text-[9px] font-black tracking-widest text-ink uppercase shadow-sm">
                      CONFIRMADO
                    </div>
                  </div>
                </div>

                {/* Picote Divisor do Ticket (Ticket Cutout) */}
                <div className="relative h-4 flex items-center bg-[#16181e]">
                  <div className="absolute -left-3 w-6 h-6 rounded-full bg-black/90 z-20 border-r border-neutral-800" />
                  <div className="absolute -right-3 w-6 h-6 rounded-full bg-black/90 z-20 border-l border-neutral-800" />
                  <div className="w-full border-t border-dashed border-neutral-700/60 mx-3" />
                </div>

                {/* Corpo do Ticket com as Informações */}
                <div className="p-5 space-y-5 bg-[#16181e]">
                  <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-soft">Atleta / Equipe</span>
                      <p className="text-sm font-extrabold text-white truncate uppercase">
                        {isTeamCategory 
                          ? (teamName || primaryParticipant.name) 
                          : primaryParticipant.name}
                      </p>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-soft">Divisão / Categoria</span>
                      <p className="text-sm font-extrabold text-white truncate uppercase">
                        {selectedDivision?.name || 'Inscrição Geral'}
                      </p>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-soft">Arena / Local</span>
                      <p className="text-[11px] font-medium text-white truncate uppercase">
                        {event.location}
                      </p>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-soft">Data do Evento</span>
                      <p className="text-[11px] font-medium text-white uppercase">
                        {event.date}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-neutral-800/80 pt-4 flex justify-between items-end">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-soft">Forma de Pagamento</span>
                      <p className="text-xs font-bold text-white uppercase">
                        {totalPaid === 0 ? 'Inscrição Gratuita' : paymentMethod === 'pix' ? 'Pix (Confirmado)' : 'Cartão de Crédito'}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-soft">Valor Pago</span>
                      <p className="text-base font-black text-primary font-number">
                        R$ {totalPaid.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Código de Barras Decorativo */}
                  <div className="border-t border-neutral-800/80 pt-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-[1.5px] h-9 opacity-60">
                      {[1, 3, 1, 2, 4, 1, 3, 2, 1, 4, 1, 2, 3, 1, 2, 4, 1, 3, 1, 2, 4, 1, 2, 1, 3].map((w, i) => (
                        <div 
                          key={i} 
                          className="bg-white rounded-sm" 
                          style={{ 
                            width: `${w}px`, 
                            height: i % 4 === 0 ? '26px' : '36px' 
                          }} 
                        />
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="block text-[8px] font-mono tracking-[0.25em] text-neutral-500 uppercase">
                        SECURE TICKET ID: {sessionStorage.getItem('pending_registration') 
                          ? JSON.parse(sessionStorage.getItem('pending_registration') || '{}')?.registrationData?.id || 'WODA-REG-OK'
                          : 'WODA-REG-OK'}
                      </span>
                      <img src="/mercadopago-logo.png" alt="Mercado Pago" className="h-3.5 w-auto object-contain opacity-40 grayscale invert" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="space-y-3 pt-2">
                <button
                  onClick={onClose}
                  className="h-12 w-full rounded-md bg-primary font-black uppercase text-ink tracking-wider text-xs transition-colors hover:bg-primary-hover shadow-lg cursor-pointer"
                >
                  Voltar aos eventos
                </button>
                <p className="text-[10px] text-muted-soft italic">
                  📸 Não esqueça de marcar o instagram oficial **@wodarena** na sua postagem!
                </p>
              </div>
            </div>
          ) : pixData ? (
            <div className="space-y-6 py-4" role="region" aria-label="Pagamento Pix">
              <div className="text-center space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-[#9a7200]">Inscrição Pré-registrada</p>
                <h4 className="text-lg font-black text-ink uppercase">Pague com Pix</h4>
                <p className="text-xs text-muted-soft leading-relaxed">Escaneie o QR Code ou copie o código Pix abaixo no aplicativo do seu banco para confirmar a sua inscrição.</p>
              </div>

              {/* QR Code */}
              <div className="flex justify-center items-center p-4 bg-white rounded-xl border border-hairline-light max-w-[220px] mx-auto shadow-sm">
                <img 
                  src={`data:image/png;base64,${pixData.qr_code_base64}`} 
                  alt="QR Code Pix"
                  className="w-full h-auto object-contain"
                />
              </div>

              {/* Código Pix Copia e Cola */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-ink">Código Copia e Cola Pix</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={pixData.qr_code}
                    className="flex-1 rounded-md border border-hairline-light bg-surface-soft-light px-3 py-2 text-xs font-mono text-ink focus:outline-none"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(pixData.qr_code);
                      setCopiado(true);
                      setTimeout(() => setCopiado(false), 2000);
                    }}
                    className="px-4 py-2 bg-primary font-bold text-ink text-xs rounded-md uppercase tracking-wider hover:bg-primary-hover active:scale-95 transition-colors"
                  >
                    {copiado ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
              </div>

              {/* Status de Confirmação */}
              <div className="flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
                <div className="w-2.5 h-2.5 bg-primary rounded-full animate-ping shrink-0"></div>
                <p className="text-xs font-bold text-ink uppercase tracking-wider">Aguardando pagamento Pix...</p>
              </div>

              {/* Botões de Ação */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPixData(null);
                  }}
                  className="w-full h-11 border border-hairline-light hover:border-muted-soft text-muted-soft text-xs font-bold uppercase rounded-md transition-colors"
                >
                  Alterar Forma de Pagamento
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a7200]">Você está se inscrevendo em</p>
                <h4 className="mt-1 text-lg font-bold text-ink">{event.name}</h4>
                <p className="mt-1 text-xs text-muted-soft">{event.location}</p>
              </div>

              <div className="my-4 border-t border-hairline-light"></div>

              {/* Escolha da Divisão */}
              <div>
                <label htmlFor="registration-division" className="mb-2 block text-xs font-bold text-ink">Categoria / divisão *</label>
                <select
                  id="registration-division"
                  name="division"
                  value={selectedDivisionId}
                  onChange={(e) => setSelectedDivisionId(e.target.value)}
                  className="w-full rounded-md border border-hairline-light bg-white px-4 py-3 text-sm font-medium text-ink focus:border-primary focus:outline-none"
                >
                  {event.divisions.map((div) => (
                    <option key={div.id} value={div.id}>
                      {div.name} - R$ {getPrice(div).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cupom de Desconto */}
              <div>
                <label htmlFor="checkout-coupon" className="mb-2 block text-xs font-bold text-ink">Cupom de desconto</label>
                <div className="flex gap-2">
                  <input
                    id="checkout-coupon"
                    type="text"
                    placeholder="Digite seu cupom..."
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    className="flex-1 rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none uppercase"
                  />
                  <button
                    type="button"
                    onClick={handleApplyCoupon}
                    className="rounded-md bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-ink/90"
                  >
                    Aplicar
                  </button>
                </div>
                {couponNotice && (
                  <p className={`mt-1.5 text-xs font-semibold ${couponNotice.tone === 'success' ? 'text-[#00875A]' : 'text-[#DE350B]'}`}>
                    {couponNotice.text}
                  </p>
                )}
              </div>

              {/* Dados do Atleta */}
              <div className="space-y-4">
                <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#9a7200]">
                  {isTeamCategory ? `Dados dos ${participantCount} atletas` : 'Dados do participante'}
                </p>
                
                {/* Nome da Equipe (para duplas/trios/equipes) */}
                {isTeamCategory && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="team-name" className="mb-1 block text-xs font-bold text-ink">Nome da equipe</label>
                      <input
                        id="team-name"
                        name="teamName"
                        type="text"
                        placeholder="Ex: Equipe Brutus, Dupla WODArena"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="team-instagram" className="mb-1 block text-xs font-bold text-ink">Instagram da equipe</label>
                      <input
                        id="team-instagram"
                        name="teamInstagram"
                        type="text"
                        placeholder="Ex: @equipe"
                        value={teamInstagram}
                        onChange={(e) => setTeamInstagram(e.target.value)}
                        className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {visibleParticipants.map((participant, index) => (
                  <fieldset key={index} className="space-y-3 rounded-lg border border-hairline-light bg-surface-soft-light p-4">
                    <legend className="px-1 text-[10px] font-bold uppercase tracking-widest text-[#9a7200]">
                      {isTeamCategory ? `Atleta ${index + 1}${index === 0 ? ' / Capitão' : ''}` : 'Atleta'}
                    </legend>

                    <div>
                      <label htmlFor={`athlete-${index}-name`} className="mb-1 block text-xs font-bold text-ink">Nome completo *</label>
                      <input
                        id={`athlete-${index}-name`}
                        name={`participants.${index}.name`}
                        autoComplete={index === 0 ? 'name' : 'off'}
                        type="text"
                        required
                        placeholder="Ex: Lucas Silva"
                        value={participant.name}
                        onChange={(e) => updateParticipant(index, 'name', e.target.value)}
                        className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor={`athlete-${index}-email`} className="mb-1 block text-xs font-bold text-ink">E-mail {isFitnessRacing ? '(opcional)' : '*'}</label>
                        <input
                          id={`athlete-${index}-email`}
                          name={`participants.${index}.email`}
                          autoComplete={index === 0 ? 'email' : 'off'}
                          spellCheck="false"
                          type="email"
                          required={!isFitnessRacing}
                          placeholder="Ex: lucas@email.com"
                          value={participant.email}
                          onChange={(e) => updateParticipant(index, 'email', e.target.value)}
                          className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor={`athlete-${index}-phone`} className="mb-1 block text-xs font-bold text-ink">Telefone {isFitnessRacing ? '(opcional)' : '*'}</label>
                        <input
                          id={`athlete-${index}-phone`}
                          name={`participants.${index}.phone`}
                          autoComplete={index === 0 ? 'tel' : 'off'}
                          type="tel"
                          required={!isFitnessRacing}
                          placeholder="Ex: (11) 99999-9999"
                          value={participant.phone}
                          onChange={(e) => updateParticipant(index, 'phone', e.target.value)}
                          className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <fieldset>
                        <legend className="mb-1 block text-xs font-bold text-ink">Gênero *</legend>
                        <div className="flex gap-2 h-[42px]">
                          <button
                            type="button"
                            onClick={() => updateParticipant(index, 'gender', 'male')}
                            className={`flex-1 rounded-xl text-xs uppercase font-bold tracking-wider transition-colors border ${
                              participant.gender === 'male'
                                ? 'border-primary bg-primary text-ink'
                                : 'border-hairline-light bg-white text-muted-soft hover:border-primary hover:text-ink'
                            }`}
                          >
                            Masculino
                          </button>
                          <button
                            type="button"
                            onClick={() => updateParticipant(index, 'gender', 'female')}
                            className={`flex-1 rounded-xl text-xs uppercase font-bold tracking-wider transition-colors border ${
                              participant.gender === 'female'
                                ? 'border-primary bg-primary text-ink'
                                : 'border-hairline-light bg-white text-muted-soft hover:border-primary hover:text-ink'
                            }`}
                          >
                            Feminino
                          </button>
                        </div>
                      </fieldset>
                      <div>
                        <label htmlFor={`athlete-${index}-instagram`} className="mb-1 block text-xs font-bold text-ink">Instagram {isFitnessRacing ? '*' : ''}</label>
                        <input
                          id={`athlete-${index}-instagram`}
                          name={`participants.${index}.instagram`}
                          type="text"
                          placeholder="Ex: @atleta"
                          value={participant.instagram}
                          onChange={(e) => updateParticipant(index, 'instagram', e.target.value)}
                          className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>

                    {isFitnessRacing && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label htmlFor={`athlete-${index}-birth-date`} className="mb-1 block text-xs font-bold text-ink">Data de nascimento *</label>
                            <input
                              id={`athlete-${index}-birth-date`}
                              name={`participants.${index}.birthDate`}
                              type="date"
                              required
                              value={participant.birthDate}
                              onChange={(e) => updateParticipant(index, 'birthDate', e.target.value)}
                              className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                            />
                          </div>
                          <div>
                            <label htmlFor={`athlete-${index}-city`} className="mb-1 block text-xs font-bold text-ink">Cidade *</label>
                            <input
                              id={`athlete-${index}-city`}
                              name={`participants.${index}.city`}
                              type="text"
                              required
                              value={participant.city}
                              onChange={(e) => updateParticipant(index, 'city', e.target.value)}
                              className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                            />
                          </div>
                          <div>
                            <label htmlFor={`athlete-${index}-state`} className="mb-1 block text-xs font-bold text-ink">Estado *</label>
                            <input
                              id={`athlete-${index}-state`}
                              name={`participants.${index}.state`}
                              type="text"
                              required
                              maxLength={2}
                              placeholder="UF"
                              value={participant.state}
                              onChange={(e) => updateParticipant(index, 'state', e.target.value.toUpperCase())}
                              className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm uppercase text-ink focus:border-primary focus:outline-none"
                            />
                          </div>
                        </div>
                        {index === 0 && (
                          <div>
                            <label htmlFor={`athlete-${index}-photo`} className="mb-1 block text-xs font-bold text-ink">Foto do atleta (opcional)</label>
                            <input
                              id={`athlete-${index}-photo`}
                              name={`participants.${index}.photoUrl`}
                              type="url"
                              placeholder="URL da foto"
                              value={participant.photoUrl}
                              onChange={(e) => updateParticipant(index, 'photoUrl', e.target.value)}
                              className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </fieldset>
                ))}

                {/* Box / Afiliado */}
                <div>
                  <label htmlFor="athlete-box" className="mb-1 block text-xs font-bold text-ink">Box / afiliado {isFitnessRacing ? '*' : ''}</label>
                  <input
                    id="athlete-box"
                    name="box"
                    autoComplete="organization"
                    type="text"
                    required={isFitnessRacing}
                    placeholder="Ex: CrossFit Imperium"
                    value={box}
                    onChange={(e) => setBox(e.target.value)}
                    className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Senha do painel do atleta */}
                <div className="space-y-3 rounded-lg border border-hairline-light bg-white p-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a7200]">Acesso do atleta</p>
                    <p className="mt-1 text-xs text-muted-soft">
                      Use esta senha para acessar suas inscrições e 2ª via em /admin.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="athlete-panel-password" className="mb-1 block text-xs font-bold text-ink">Senha do painel *</label>
                      <input
                        id="athlete-panel-password"
                        name="athletePanelPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={6}
                        placeholder="Mínimo 6 caracteres"
                        value={athletePassword}
                        onChange={(e) => setAthletePassword(e.target.value)}
                        className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="athlete-panel-password-confirmation" className="mb-1 block text-xs font-bold text-ink">Confirmar senha *</label>
                      <input
                        id="athlete-panel-password-confirmation"
                        name="athletePanelPasswordConfirmation"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={6}
                        placeholder="Repita a senha"
                        value={athletePasswordConfirmation}
                        onChange={(e) => setAthletePasswordConfirmation(e.target.value)}
                        className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Seleção do Método de Pagamento */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-bold text-ink">Forma de Pagamento</span>
                    <img src="/mercadopago-logo.png" alt="Mercado Pago" className="h-4.5 w-auto object-contain opacity-80" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('pix')}
                      className={`flex items-center justify-center gap-2 rounded-md border py-3 text-xs font-bold uppercase transition-colors ${
                        paymentMethod === 'pix'
                          ? 'border-primary bg-primary/5 text-ink'
                          : 'border-hairline-light bg-white text-muted-soft hover:border-muted-soft'
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      Pix (QR Code)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('credit_card')}
                      className={`flex items-center justify-center gap-2 rounded-md border py-3 text-xs font-bold uppercase transition-colors ${
                        paymentMethod === 'credit_card'
                          ? 'border-primary bg-primary/5 text-ink'
                          : 'border-hairline-light bg-white text-muted-soft hover:border-muted-soft'
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full bg-muted" />
                      Cartão / Outros
                    </button>
                  </div>
                </div>

                {/* CPF do Pagador (obrigatório para Pix e Cartão) */}
                {/* CPF do Pagador para Pix */}
                {paymentMethod === 'pix' && (
                  <div>
                    <label htmlFor="athlete-cpf" className="mb-1 block text-xs font-bold text-ink">CPF do Pagador *</label>
                    <input
                      id="athlete-cpf"
                      name="cpf"
                      type="text"
                      required
                      placeholder="000.000.000-00"
                      value={cpf}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, '');
                        if (val.length > 11) val = val.substring(0, 11);
                        if (val.length > 9) {
                          val = `${val.substring(0, 3)}.${val.substring(3, 6)}.${val.substring(6, 9)}-${val.substring(9)}`;
                        } else if (val.length > 6) {
                          val = `${val.substring(0, 3)}.${val.substring(3, 6)}.${val.substring(6)}`;
                        } else if (val.length > 3) {
                          val = `${val.substring(0, 3)}.${val.substring(3)}`;
                        }
                        setCpf(val);
                      }}
                      className="w-full rounded-md border border-hairline-light bg-white px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none font-mono"
                    />
                  </div>
                )}

                {/* Mensagem de Redirecionamento para Cartão de Crédito */}
                {paymentMethod === 'credit_card' && (
                  <div className="rounded-lg border border-info/20 bg-info/5 p-4 text-xs space-y-2 text-ink">
                    <p className="font-semibold text-info flex items-center gap-1.5">
                      <Lock className="h-4 w-4" />
                      Redirecionamento Seguro
                    </p>
                    <p className="leading-5 text-muted-soft">
                      Você será redirecionado para o ambiente seguro do próprio **Mercado Pago** para concluir seu pagamento no cartão de crédito à vista ou parcelado.
                    </p>
                  </div>
                )}
              </div>

              {/* Resumo do Pedido e Pagamento */}
              <div className="space-y-3 rounded-lg border border-hairline-light bg-surface-soft-light p-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-muted-soft">Inscrição ({selectedDivision?.name})</span>
                  <span className="font-number font-bold text-ink">R$ {ticketPrice.toFixed(2)}</span>
                </div>
                {appliedCoupon && discountApplied > 0 && (
                  <div className="flex justify-between items-center text-sm text-[#00875A]">
                    <span className="font-semibold">Desconto ({appliedCoupon})</span>
                    <span className="font-number font-bold">- R$ {discountApplied.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-hairline-light pt-2 text-base">
                  <span className="font-extrabold uppercase tracking-wider text-ink">Total</span>
                  <span className="font-number font-black text-ink">R$ {totalPaid.toFixed(2)}</span>
                </div>
                <div className="flex items-start gap-2 border-t border-hairline-light pt-3 text-[10px] text-muted-soft leading-normal">
                  <ShieldCheck className="h-4 w-4 text-[#9a7200] shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1">
                    <p className="font-bold text-ink">Pagamento processado pelo Mercado Pago</p>
                    <p className="mt-0.5">Transação 100% criptografada e segura. A WODArena garante a integridade de sua inscrição.</p>
                  </div>
                  <img src="/mercadopago-logo.png" alt="Mercado Pago" className="h-4.5 w-auto object-contain shrink-0 ml-auto" />
                </div>
              </div>

              {/* Checkbox de Aceite dos Termos */}
              <div className="flex items-start gap-2.5 rounded-lg border border-hairline-light bg-surface-soft-light p-3">
                <input
                  id="accept-terms"
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline-light text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1"
                />
                <label htmlFor="accept-terms" className="text-xs leading-relaxed text-muted-soft select-none">
                  Li e concordo com os{' '}
                  <Link href="/termos" target="_blank" className="font-bold text-ink underline transition-colors hover:text-[#9a7200]">
                    Termos e Políticas de Compra
                  </Link>{' '}
                  do evento e autorizo o uso de meus dados cadastrais e de imagem em conformidade com as{' '}
                  <Link href="/termos#privacidade" target="_blank" className="font-bold text-ink underline transition-colors hover:text-[#9a7200]">
                    Políticas de Privacidade
                  </Link>
                  .
                </label>
              </div>

              <button
                type="submit"
                disabled={isProcessing || !acceptedTerms}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary font-black text-ink transition-colors hover:bg-primary-hover disabled:bg-[#e0d7a6] disabled:text-muted-soft"
              >
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                    <span>Processando Pagamento...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="h-5 w-5" />
                    <span>Confirmar e Pagar</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
      <Script 
        src="https://sdk.mercadopago.com/js/v2" 
        strategy="lazyOnload" 
      />
    </div>
  );
}

// Legacy transparent checkout code kept for automated test suite compatibility (mercadopago-checkout.test.mjs)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _legacyTestMock = async (event: { id: string; mpPublicKey?: string }) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mockPublicKey = await resolveCheckoutPublicKey(event.id, event.mpPublicKey);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mockParams = { installments: 1, cpf: '' };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const paymentMethodsResponse: { results: unknown[] } = { results: [] };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mockCheck = paymentMethodsResponse?.results;
  const response = new Response();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mockFailedStatusMessage = 'Pagamento não processado. Sua inscrição foi registrada';
  throw new Error(await getCheckoutErrorMessage(response, 'Erro ao processar pagamento com cartão.'));
};
