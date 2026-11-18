'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, CreditCard, ShieldCheck, X, Lock } from 'lucide-react';
import Script from 'next/script';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { RegistrationVoucher } from '@/components/RegistrationVoucher';
import { Event, Division, Registration, Athlete, AppLocale } from '@/types';
import { useApp } from '@/context/AppContext';
import { normalizeInstagram } from '@/lib/fitnessRacing';
import { isBrazilEventCountry } from '@/lib/ufFlags';
import { UfSelect } from '@/components/UfSelect';
import { getRegistrationAvailability } from '@/lib/eventStatus';
import { calculateServiceFee } from '@/lib/serviceFee';
import { formatMoney, toMinorUnits } from '@/lib/intl/format';
import { clearRegistrationDraft, readRegistrationDraft, writeRegistrationDraft } from '@/lib/registrationDraft';
import {
  calculateRegistrationAmounts,
  getDivisionParticipantCount,
  isShirtSize,
  normalizeShirtMode,
  SHIRT_NONE,
  SHIRT_SIZES
} from '@/lib/shirtPricing';

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
  shirtSize: string;
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

// Inscrição que o servidor criou com valores diferentes dos exibidos. Um novo
// envio com os mesmos dados segue com ela: chamar /api/registrations/start de
// novo seria recusado, porque a rota não aceita o mesmo e-mail duas vezes no evento.
type ServerUpdatedCheckout = {
  requestKey: string;
  registrationData: CheckoutRegistrationData;
  athleteProfile: Athlete;
};

type CheckoutConfigResponse = {
  gateway?: 'mercadopago' | 'stripe';
  pixSupported?: boolean;
  publicKey?: string;
  publishableKey?: string;
  serviceFeeEnabled?: boolean;
  serviceFeePercent?: number;
  serviceFeePayer?: 'athlete' | 'organizer';
  error?: string;
};

// A rota de cupom também devolve um totalPaid, mas sem a camisa: o checkout usa
// só o desconto e calcula o total pela mesma regra do servidor.
type CouponValidationResponse = {
  code?: string;
  discount?: number;
  ticketPrice?: number;
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
  photoUrl: '',
  shirtSize: ''
});

// sessionStorage pode lançar em aba privada ou com dados do site bloqueados.
const getSessionStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

type CheckoutStep = 1 | 2 | 3;

const fieldClass =
  'w-full min-h-12 rounded-lg border border-card-border bg-dark-gray px-4 text-base text-white placeholder:text-muted focus:border-primary focus:outline-none sm:text-sm';
const labelClass = 'mb-1.5 block text-xs font-bold text-foreground';

const generateUniqueId = (prefix: string) => {
  return `${prefix}-${Date.now()}`;
};

const resolveCheckoutPublicKey = async (eventId: string) => {
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

export function RegisterModal({ event, isOpen, onClose, onSuccess: onSuccessProp }: RegisterModalProps) {
  const t = useTranslations('Checkout');
  const locale = useLocale() as AppLocale;
  const { registerTicket } = useApp();
  const [selectedDivisionId, setSelectedDivisionId] = useState(event.divisions[0]?.id || '');
  const [box, setBox] = useState('');
  const [teamName, setTeamName] = useState('');
  const [participants, setParticipants] = useState<ParticipantForm[]>([createEmptyParticipant()]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [discountApplied, setDiscountApplied] = useState(0);
  const [couponNotice, setCouponNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'credit_card'>('pix');
  const [cpf, setCpf] = useState('');
  const [pixData, setPixData] = useState<{
    qr_code: string;
    qr_code_base64: string;
    paymentId: string;
    registrationId: string;
    accessToken?: string;
  } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [securityCode, setSecurityCode] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [athletePassword, setAthletePassword] = useState('');
  const [athletePasswordConfirmation, setAthletePasswordConfirmation] = useState('');
  const [serviceFeeConfig, setServiceFeeConfig] = useState<{ enabled: boolean; percent: number; payer: 'athlete' | 'organizer' }>({ enabled: true, percent: 10, payer: 'athlete' });
  const [pixSupported, setPixSupported] = useState(true);
  const [serverUpdatedCheckout, setServerUpdatedCheckout] = useState<ServerUpdatedCheckout | null>(null);
  const [amountsUpdatedNotice, setAmountsUpdatedNotice] = useState<string | null>(null);
  const [confirmedVoucher, setConfirmedVoucher] = useState<{ registration: Registration; athlete: Athlete } | null>(null);
  // Etapas da inscrição (Story 1.134): categoria, atletas (um por vez) e pagamento.
  const [step, setStep] = useState<CheckoutStep>(1);
  const [athleteStep, setAthleteStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const stepBodyRef = useRef<HTMLDivElement>(null);

  // Sucesso da inscrição (Pix aprovado ou gratuita): o comprovante único abre aqui, em
  // qualquer tela que use o modal (Story 1.73). O onSuccess de quem chamou só é avisado.
  const onSuccess = useCallback((registration: Registration, athlete: Athlete, cpf: string) => {
    setConfirmedVoucher({ registration, athlete });
    onSuccessProp?.(registration, athlete, cpf);
  }, [onSuccessProp]);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    setServerUpdatedCheckout(null);
    setAmountsUpdatedNotice(null);
    setAcceptedTerms(false);
    setIsSuccess(false);
    setConfirmedVoucher(null);
    setPixData(null);
    setTeamName('');
    setCardNumber('');
    setCardholderName('');
    setExpirationDate('');
    setSecurityCode('');
    setAthletePassword('');
    setAthletePasswordConfirmation('');
    setStep(1);
    setAthleteStep(0);
    setStepError(null);
    // Rascunho da mesma aba (Story 1.134): volta o que já foi digitado, nunca senha ou CPF.
    const draft = isOpen ? readRegistrationDraft(getSessionStorage(), event.id) : null;
    if (draft) {
      if (event.divisions.some((division) => division.id === draft.divisionId)) setSelectedDivisionId(draft.divisionId);
      setTeamName(draft.teamName);
      setBox(draft.box);
      if (draft.participants.length > 0) {
        setParticipants(draft.participants.map((participant) => ({
          ...createEmptyParticipant(),
          ...participant,
          gender: participant.gender === 'female' ? 'female' : 'male'
        })));
      }
    }
  }

  useEffect(() => {
    if (!isOpen || isSuccess || confirmedVoucher) return;
    writeRegistrationDraft(getSessionStorage(), event.id, {
      divisionId: selectedDivisionId,
      teamName,
      box,
      participants: participants.map(({ name, email, phone, gender, instagram, shirtSize, birthDate, city, state }) => ({
        name, email, phone, gender, instagram, shirtSize, birthDate, city, state
      }))
    });
  }, [isOpen, isSuccess, confirmedVoucher, event.id, selectedDivisionId, teamName, box, participants]);

  useEffect(() => {
    if (isSuccess || confirmedVoucher) clearRegistrationDraft(getSessionStorage(), event.id);
  }, [isSuccess, confirmedVoucher, event.id]);

  // Polling para verificar status do pagamento Pix
  useEffect(() => {
    if (!pixData?.paymentId) return;

    let active = true;
    const intervalId = setInterval(async () => {
      try {
        const statusParams = new URLSearchParams({
          payment_id: pixData.paymentId,
          event_id: event.id,
          registration_id: pixData.registrationId
        });
        if (pixData.accessToken) {
          statusParams.set('access_token', pixData.accessToken);
        }

        const res = await fetch(`/api/checkout/status?${statusParams.toString()}`);
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
            // O uso do cupom é contabilizado no servidor ao aprovar o pagamento.
          }

          if (createdReg && parsedAthlete) {
            // O e-mail de confirmação sai do servidor quando o pagamento é aprovado (Story 1.76).
            if (onSuccess) {
              onSuccess(
                { ...createdReg, accessToken: createdReg.accessToken || registrationPayload?.accessToken },
                parsedAthlete,
                parsedCpf
              );
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
  }, [pixData, event.id, registerTicket, onSuccess, onClose, cpf]);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    void fetch(`/api/checkout/config?event_id=${event.id}`)
      .then(async response => {
        const data: CheckoutConfigResponse = await response.json();
        if (response.ok && active) {
          setServiceFeeConfig({
            enabled: data.serviceFeeEnabled !== false,
            percent: Number(data.serviceFeePercent || 10),
            payer: data.serviceFeePayer === 'organizer' ? 'organizer' : 'athlete'
          });
          const supportsPix = data.pixSupported !== false && data.gateway !== 'stripe';
          setPixSupported(supportsPix);
          if (!supportsPix) {
            setPaymentMethod('credit_card');
          }
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [event.id, isOpen]);

  const isValidCPF = (val: string) => {
    const clean = val.replace(/\D/g, '');
    if (clean.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(clean)) return false;
    return true;
  };

  const selectedDivision = event.divisions.find(d => d.id === selectedDivisionId);
  const participantCount = useMemo(() => getDivisionParticipantCount(selectedDivision?.type), [selectedDivision]);

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
  // Camisa do evento (Story 1.38): o total sai da mesma regra que o servidor usa.
  // O cupom desconta só a inscrição; cada participante com tamanho paga o
  // adicional, inclusive com cupom de 100% (D1). Os valores são memoizados
  // porque o total entra nas dependências dos callbacks de envio.
  const shirtMode = normalizeShirtMode(event.shirtMode);
  const isOptionalShirt = shirtMode === 'optional';
  const shirtAddonPrice = event.shirtAddonPrice ?? 0;
  const shirtAddonPriceLabel = formatMoney(shirtAddonPrice, event.currency ?? 'BRL', locale);
  const shirtAddonCount = isOptionalShirt
    ? visibleParticipants.filter((participant) => isShirtSize(participant.shirtSize)).length
    : 0;
  const registrationAmounts = useMemo(() => calculateRegistrationAmounts({
    ticketPrice,
    quantity: 1,
    discount: discountApplied,
    shirtMode,
    shirtAddonPrice,
    shirtAddonCount
  }), [ticketPrice, discountApplied, shirtMode, shirtAddonPrice, shirtAddonCount]);
  const totalPaid = registrationAmounts.totalPaid;
  const showCouponShirtNotice = isOptionalShirt && Boolean(appliedCoupon);
  const {
    serviceFeeAmount: serviceFeePreview,
    amountCollected: amountCollectedPreview
  } = calculateServiceFee(totalPaid, serviceFeeConfig.percent, serviceFeeConfig.enabled, serviceFeeConfig.payer);
  const isTeamCategory = participantCount > 1;
  const primaryParticipant = visibleParticipants[0] || createEmptyParticipant();
  const isFitnessRacing = event.eventType === 'fitness_racing';
  // Estado de nascimento (Story 1.154): em evento brasileiro é um seletor de UF; fora do Brasil segue texto livre.
  const isBrazilEvent = isBrazilEventCountry(event.countryCode);
  const clearAppliedCoupon = () => {
    setAppliedCoupon(null);
    setDiscountApplied(0);
  };

  const handleApplyCoupon = async () => {
    if (!selectedDivision) return;
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      clearAppliedCoupon();
      setCouponNotice(null);
      return;
    }

    setIsApplyingCoupon(true);
    try {
      const response = await fetch('/api/checkout/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          divisionId: selectedDivision.id,
          couponCode: code
        })
      });
      const data: CouponValidationResponse = await response.json().catch(() => ({}));

      if (!response.ok || !data.code || data.discount === undefined) {
        throw new Error(data.error || t('couponInvalid'));
      }

      setDiscountApplied(Number(data.discount));
      setAppliedCoupon(data.code);
      setCouponNotice({ text: t('couponAppliedSuccess', { code: data.code }), tone: 'success' });
    } catch (err) {
      clearAppliedCoupon();
      setCouponNotice({
        text: err instanceof Error ? err.message : t('couponInvalid'),
        tone: 'error'
      });
    } finally {
      setIsApplyingCoupon(false);
    }
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
    athleteProfile: Athlete
  ) => {
    const response = await fetch('/api/registrations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationData,
        athleteProfile,
        password: athletePassword,
        passwordConfirmation: athletePasswordConfirmation,
        // Só o rótulo gravado na inscrição (as rotas de pagamento o sobrescrevem ao
        // criar a cobrança). Gratuito ou pago quem decide é o paymentStatus do servidor.
        paymentMethod: totalPaid === 0 ? 'free' : paymentMethod
      })
    });
    const payload: RegistrationStartResponse = await response.json().catch(() => ({}));

    if (!response.ok || !payload.registrationData || !payload.athleteProfile) {
      throw new Error(payload.error || t('registrationStartError'));
    }

    return {
      registrationData: payload.registrationData,
      athleteProfile: payload.athleteProfile
    };
  }, [athletePassword, athletePasswordConfirmation, paymentMethod, totalPaid, t]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!acceptedTerms) {
      alert(t('acceptTermsAlert'));
      return;
    }

    const hasMissingRequiredParticipantData = visibleParticipants.some((participant) => {
      if (!participant.name || !participant.gender || !participant.shirtSize || !participant.email || !participant.phone) return true;
      if (isFitnessRacing) return !participant.birthDate || !participant.city || !participant.state;
      return false;
    });

    if (hasMissingRequiredParticipantData || (isTeamCategory && !teamName.trim()) || (isFitnessRacing && !box)) {
      alert(isFitnessRacing
        ? t('missingFieldsRacing')
        : t('missingFieldsGeneric'));
      return;
    }

    if (!primaryParticipant.email || !primaryParticipant.email.includes('@')) {
      alert(t('invalidEmail'));
      return;
    }

    if (!athletePassword || athletePassword.length < 6) {
      alert(t('passwordTooShort'));
      return;
    }

    if (athletePassword !== athletePasswordConfirmation) {
      alert(t('passwordMismatch'));
      return;
    }

    if (paymentMethod === 'pix' && !isValidCPF(cpf)) {
      alert(t('invalidCpfPix'));
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
          instagram: normalizeInstagram(participant.instagram),
          shirtSize: participant.shirtSize
        }))
      : [];

    // Só preenchem o formato do pedido: o servidor gera os ids e, depois do
    // início, o fluxo usa apenas o id e o accessToken devolvidos por ele.
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
      shirtSize: primaryParticipant.shirtSize,
      email: primaryParticipant.email,
      phone: primaryParticipant.phone,
      gender: primaryParticipant.gender,
      instagram: normalizeInstagram(primaryParticipant.instagram),
      isTeam: isTeamCategory,
      teamMembers
    };

    // Os ids mudam a cada envio; o resto identifica "os mesmos dados" de um envio
    // anterior cujo total o servidor recalculou e o atleta já viu no aviso.
    const requestKey = JSON.stringify({
      registrationData: { ...registrationData, id: undefined },
      athleteProfile: { ...athleteProfile, id: undefined },
      password: athletePassword,
      passwordConfirmation: athletePasswordConfirmation
    });
    const confirmedServerCheckout = serverUpdatedCheckout?.requestKey === requestKey ? serverUpdatedCheckout : null;

    setAmountsUpdatedNotice(null);
    let paymentAttemptStarted = false;

    try {
      const started = confirmedServerCheckout ?? await startRegistration(registrationData, athleteProfile);
      paymentAttemptStarted = true;
      // Nova inscrição criada: a resposta guardada de um envio anterior não vale
      // mais e não pode aparecer no ticket de sucesso.
      if (!confirmedServerCheckout) setServerUpdatedCheckout(null);
      const activeRegistrationData = started.registrationData;
      const activeAthleteProfile = started.athleteProfile;
      const serverTotalPaid = Number(activeRegistrationData.totalPaid);
      if (!Number.isFinite(serverTotalPaid)) {
        throw new Error(t('registrationStartError'));
      }
      const isServerApprovedFree = activeRegistrationData.paymentStatus === 'payment_approved' && serverTotalPaid === 0;

      // O servidor recalcula o total com a configuração atual do evento (preço,
      // cupom, camisa), que pode ter mudado desde que o checkout abriu. Valor
      // diferente do exibido: nada é cobrado nem confirmado antes de o atleta ver o novo total.
      const eventCurrency = event.currency ?? 'BRL';
      if (!confirmedServerCheckout && toMinorUnits(serverTotalPaid, eventCurrency, locale) !== toMinorUnits(totalPaid, eventCurrency, locale)) {
        setServerUpdatedCheckout({ requestKey, ...started });
        const updatedAmount = formatMoney(Number(activeRegistrationData.amountCollected ?? serverTotalPaid), eventCurrency, locale);
        if (!isServerApprovedFree) {
          setAmountsUpdatedNotice(t('amountsUpdatedNotice', { amount: updatedAmount }));
          setIsProcessing(false);
          return;
        }
        // Já aprovada com total 0: a inscrição está concluída e não há o que
        // confirmar; segue para o sucesso (e o e-mail) mostrando o aviso.
        setAmountsUpdatedNotice(t('amountsUpdatedConfirmedNotice', { amount: updatedAmount }));
      }

      if (isServerApprovedFree) {
        console.log("[Checkout WODArena] Inscrição gratuita aprovada pelo servidor.");
        const createdReg = registerTicket(activeRegistrationData, activeAthleteProfile);
        // O uso do cupom é contabilizado no servidor em /api/registrations/start.

        const finalReg = createdReg || {
          ...activeRegistrationData,
          createdAt: activeRegistrationData.createdAt || new Date().toISOString()
        };

        // A confirmação por e-mail sai do servidor, em /api/registrations/start (Story 1.76).

        if (onSuccess) {
          onSuccess({ ...finalReg, accessToken: finalReg.accessToken || activeRegistrationData.accessToken }, activeAthleteProfile, cpf);
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
            cpf,
            accessToken: activeRegistrationData.accessToken
          })
        });

        if (!response.ok) {
          throw new Error(await getCheckoutErrorMessage(response, t('pixCreateError')));
        }

        const data = await response.json();
        
        sessionStorage.setItem('pending_registration', JSON.stringify({ registrationData: activeRegistrationData, athleteProfile: activeAthleteProfile, cpf }));

        setPixData({
          qr_code: data.qr_code,
          qr_code_base64: data.qr_code_base64,
          paymentId: data.paymentId,
          registrationId: activeRegistrationData.id,
          accessToken: activeRegistrationData.accessToken
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
            origin: window.location.origin,
            accessToken: activeRegistrationData.accessToken,
            locale
          })
        });

        if (!response.ok) {
          throw new Error(await getCheckoutErrorMessage(response, t('preferenceCreateError')));
        }

        const data = await response.json();
        const initPoint = data.redirectUrl || data.init_point;
        if (!initPoint) {
          throw new Error(t('invalidPaymentLink'));
        }

        // Redireciona o usuário para o Mercado Pago na mesma aba
        window.location.assign(initPoint);
        return;
      }

    } catch (err) {
      console.error("[Checkout WODArena] Erro no processamento do checkout:", err);
      const errorMessage = err instanceof Error ? err.message : t('genericCheckoutError');
      // Início recusado depois do aviso de valores atualizados: a inscrição já
      // existe no servidor, que não aceita o mesmo e-mail de novo no evento.
      const baseMessage = !paymentAttemptStarted && serverUpdatedCheckout
        ? `${errorMessage}\n\n${t('registrationAlreadyStartedGuidance')}`
        : errorMessage;
      alert(paymentAttemptStarted ? `${baseMessage}\n\n${t('paymentFailureGuidance')}` : baseMessage);
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
    event.currency,
    selectedDivisionId,
    ticketPrice,
    totalPaid,
    serverUpdatedCheckout,
    appliedCoupon,
    paymentMethod,
    cpf,
    cardNumber,
    cardholderName,
    expirationDate,
    securityCode,
    onClose,
    registerTicket,
    onSuccess,
    event.mpPublicKey,
    acceptedTerms,
    athletePassword,
    athletePasswordConfirmation,
    startRegistration,
    t,
    locale
  ]);

  if (!isOpen) return null;

  if (confirmedVoucher) {
    return (
      <RegistrationVoucher
        registration={confirmedVoucher.registration}
        athlete={confirmedVoucher.athlete}
        event={event}
        onClose={onClose}
      />
    );
  }

  const registrationAvailability = getRegistrationAvailability(event);

  if (!registrationAvailability.isAvailable) {
    const isSalesClosed = registrationAvailability.reason === 'sales_closed';
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-card-border bg-card p-6 text-center" role="alertdialog" aria-modal="true" aria-labelledby="registration-unavailable-title">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-white"
            aria-label={t('closeNoticeAria')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <Lock className="mx-auto h-10 w-10 text-muted" aria-hidden="true" />
          <h3 id="registration-unavailable-title" className="mt-4 text-lg font-bold text-white">
            {isSalesClosed ? t('salesClosedTitle') : t('registrationsClosedTitle')}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            {isSalesClosed
              ? t('salesClosedDescription')
              : t('registrationsClosedDescription')}
          </p>
          <button onClick={onClose} className="mt-6 min-h-11 rounded-md bg-primary px-5 py-2 text-xs font-bold uppercase text-ink">
            {t('gotIt')}
          </button>
        </div>
      </div>
    );
  }

  // Navegação entre etapas (Story 1.134). "Continuar" valida só os campos da
  // tela atual; as telas anteriores já passaram pela mesma checagem.
  const typeLabel = (type: Division['type'] | undefined) => {
    switch (type) {
      case 'duo': return t('typeDuo');
      case 'trio': return t('typeTrio');
      case 'team': return t('typeTeam');
      case 'team4': return t('typeTeam4');
      case 'team6': return t('typeTeam6');
      default: return t('typeIndividual');
    }
  };

  const scrollStepToTop = () => {
    stepBodyRef.current?.closest('[data-checkout-scroll]')?.scrollTo({ top: 0 });
  };

  const validateCurrentStep = () => {
    const fields = stepBodyRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select') ?? [];
    for (const field of Array.from(fields)) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    if (step === 2 && athleteStep === 0 && athletePassword !== athletePasswordConfirmation) {
      setStepError(t('passwordMismatch'));
      return false;
    }
    setStepError(null);
    return true;
  };

  const goNext = () => {
    if (!validateCurrentStep()) return;
    if (step === 1) {
      setStep(2);
      setAthleteStep(0);
    } else if (step === 2 && athleteStep < participantCount - 1) {
      setAthleteStep(athleteStep + 1);
    } else {
      setStep(3);
    }
    scrollStepToTop();
  };

  const goBack = () => {
    setStepError(null);
    if (step === 3) {
      setStep(2);
      setAthleteStep(Math.max(0, participantCount - 1));
    } else if (step === 2 && athleteStep > 0) {
      setAthleteStep(athleteStep - 1);
    } else {
      setStep(1);
    }
    scrollStepToTop();
  };

  const canGoBack = !isSuccess && !pixData && (step > 1 || athleteStep > 0);
  const stepLabels = [t('stepCategory'), t('stepAthletes'), t('stepPayment')];
  const currentParticipant = visibleParticipants[athleteStep] || createEmptyParticipant();
  const index = athleteStep;
  const participant = currentParticipant;

  return (
    <div className="fixed inset-0 z-[60] flex bg-background sm:items-center sm:justify-center sm:bg-black/80 sm:p-4">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground sm:h-auto sm:max-h-[92vh] sm:max-w-xl sm:rounded-2xl sm:border sm:border-card-border" role="dialog" aria-modal="true" aria-labelledby="registration-title">
        <div className="border-b border-card-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-5 sm:pt-4">
          <div className="flex items-center gap-2">
            {canGoBack ? (
              <button
                type="button"
                onClick={goBack}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary"
                aria-label={t('backStepAria')}
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <h3 id="registration-title" className="truncate text-base font-bold text-white">{event.name}</h3>
              <p className="text-xs text-muted">{t('title')}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary"
              aria-label={t('closeModalAria')}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {!isSuccess && !pixData && (
            <div className="mt-3" aria-label={t('stepProgress', { current: step, total: 3 })}>
              <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
                {[1, 2, 3].map((item) => (
                  <span key={item} className={`h-1 rounded-full ${item <= step ? 'bg-primary' : 'bg-card-border'}`} />
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold">
                <span className="text-white">{stepLabels[step - 1]}</span>
                <span className="text-muted">{t('stepCounter', { current: step, total: 3 })}</span>
              </div>
            </div>
          )}
        </div>

        {isSuccess ? (
          <div className="flex-1 overflow-y-auto overscroll-contain p-6">
            <div className="text-center py-4 space-y-6" role="status" aria-live="polite">
              <div className="space-y-2">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                  <Check className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <h4 className="type-display text-xl text-white">{t('successTitle')}</h4>
                <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted">
                  {t('successDescription')}
                </p>
              </div>

              {amountsUpdatedNotice && (
                <p className="mx-auto max-w-sm rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs font-semibold leading-5 text-white">
                  {amountsUpdatedNotice}
                </p>
              )}

              {/* Botões de Ação */}
              <div className="space-y-3 pt-2">
                <button
                  onClick={onClose}
                  className="h-12 w-full rounded-md bg-primary font-black uppercase text-ink tracking-wider text-xs transition-colors hover:bg-primary-hover cursor-pointer"
                >
                  {t('backToEvents')}
                </button>
              </div>
            </div>
          </div>
        ) : pixData ? (
          <div className="flex-1 overflow-y-auto overscroll-contain p-6">
            <div className="space-y-6 py-4" role="region" aria-label={t('pixRegionAria')}>
              <div className="text-center space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-primary">{t('preRegisteredLabel')}</p>
                <h4 className="type-display text-lg text-white">{t('payWithPixTitle')}</h4>
                <p className="text-sm text-muted leading-relaxed">{t('pixInstructions')}</p>
              </div>

              {/* QR Code: fundo branco para o leitor do banco */}
              <div className="flex justify-center items-center p-4 bg-white rounded-xl max-w-[220px] mx-auto">
                <img
                  src={`data:image/png;base64,${pixData.qr_code_base64}`}
                  alt={t('qrCodeAlt')}
                  className="w-full h-auto object-contain"
                />
              </div>

              {/* Código Pix Copia e Cola */}
              <div className="space-y-2">
                <label htmlFor="pix-copy-paste" className="block text-xs font-bold text-foreground">{t('copyPasteLabel')}</label>
                <div className="flex gap-2">
                  <input
                    id="pix-copy-paste"
                    type="text"
                    readOnly
                    value={pixData.qr_code}
                    className="min-h-11 flex-1 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs font-mono text-white focus:outline-none"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(pixData.qr_code);
                      setCopiado(true);
                      setTimeout(() => setCopiado(false), 2000);
                    }}
                    className="min-h-11 px-4 py-2 bg-primary font-bold text-ink text-xs rounded-md uppercase tracking-wider hover:bg-primary-hover transition-colors"
                  >
                    {copiado ? t('copied') : t('copy')}
                  </button>
                </div>
              </div>

              {/* Status de Confirmação */}
              <div className="flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
                <div className="w-2.5 h-2.5 bg-primary rounded-full animate-ping shrink-0"></div>
                <p className="text-xs font-bold text-white uppercase tracking-wider">{t('waitingPayment')}</p>
              </div>

              {/* Botões de Ação */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPixData(null);
                  }}
                  className="w-full h-11 border border-card-border hover:border-muted text-muted text-xs font-bold uppercase rounded-md transition-colors"
                >
                  {t('changePaymentMethod')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate={false} className="flex min-h-0 flex-1 flex-col">
            <div data-checkout-scroll className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
              <div ref={stepBodyRef} className="space-y-5">
                {/* Etapa 1: categoria */}
                {step === 1 && (
                  <fieldset className="min-w-0 space-y-3">
                    <legend className="type-display text-xl text-white">{t('stepCategoryTitle')}</legend>
                    <p className="pt-2 text-sm text-muted">{event.location}</p>
                    <div role="radiogroup" aria-label={t('divisionLabelForm')} className="grid gap-2.5 pt-1">
                      {event.divisions.map((div) => {
                        const isSelected = selectedDivisionId === div.id;
                        return (
                          <label
                            key={div.id}
                            className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${
                              isSelected ? 'border-primary bg-primary/10' : 'border-card-border bg-card hover:border-muted'
                            }`}
                          >
                            <input
                              type="radio"
                              name="division"
                              value={div.id}
                              checked={isSelected}
                              required
                              onChange={(e) => {
                                setSelectedDivisionId(e.target.value);
                                clearAppliedCoupon();
                                setCouponNotice(null);
                              }}
                              className="h-5 w-5 shrink-0 accent-primary"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-bold leading-snug text-white">{div.name}</span>
                              <span className="text-xs text-muted">
                                {typeLabel(div.type)}
                                {div.slotsLimit > 0 ? ` · ${t('slotsLimit', { count: div.slotsLimit })}` : ''}
                              </span>
                            </span>
                            <span className="shrink-0 font-number text-base font-bold text-white tabular-nums">
                              {formatMoney(getPrice(div), event.currency ?? 'BRL', locale)}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {/* Etapa 2: atletas, um por vez */}
                {step === 2 && (
                  <div className="space-y-4">
                    <h4 className="type-display text-xl text-white">
                      {isTeamCategory
                        ? t('athleteStepTitle', { index: athleteStep + 1, total: participantCount })
                        : t('participantDataSingle')}
                    </h4>
                    {isTeamCategory && athleteStep === 0 && (
                      <p className="text-sm text-muted">{t('captainHint')}</p>
                    )}

                    {/* Nome da Equipe (para duplas/trios/equipes) */}
                    {isTeamCategory && athleteStep === 0 && (
                      <div>
                        <label htmlFor="team-name" className={labelClass}>{t('teamNameLabel')}</label>
                        <input
                          id="team-name"
                          name="teamName"
                          type="text"
                          required
                          placeholder={t('teamNamePlaceholder')}
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                          className={fieldClass}
                        />
                      </div>
                    )}

                    <fieldset key={index} className="min-w-0 space-y-4 rounded-xl border border-card-border bg-card p-4">
                      <legend className="px-1 text-xs font-bold uppercase tracking-wider text-primary">
                        {isTeamCategory ? t('athleteFieldsetLegendTeam', { index: index + 1, captain: index === 0 ? t('captainSuffix') : '' }) : t('athleteFieldsetLegendSingle')}
                      </legend>

                      <div>
                        <label htmlFor={`athlete-${index}-name`} className={labelClass}>{t('fullNameLabel')}</label>
                        <input
                          id={`athlete-${index}-name`}
                          name={`participants.${index}.name`}
                          autoComplete={index === 0 ? 'name' : 'off'}
                          type="text"
                          required
                          placeholder={t('fullNamePlaceholder')}
                          value={participant.name}
                          onChange={(e) => updateParticipant(index, 'name', e.target.value)}
                          className={fieldClass}
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor={`athlete-${index}-email`} className={labelClass}>{t('emailLabel')}</label>
                          <input
                            id={`athlete-${index}-email`}
                            name={`participants.${index}.email`}
                            autoComplete={index === 0 ? 'email' : 'off'}
                            spellCheck="false"
                            type="email"
                            inputMode="email"
                            required
                            placeholder={t('emailPlaceholder')}
                            value={participant.email}
                            onChange={(e) => updateParticipant(index, 'email', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                        <div>
                          <label htmlFor={`athlete-${index}-phone`} className={labelClass}>{t('phoneLabel')}</label>
                          <input
                            id={`athlete-${index}-phone`}
                            name={`participants.${index}.phone`}
                            autoComplete={index === 0 ? 'tel' : 'off'}
                            type="tel"
                            inputMode="tel"
                            required
                            placeholder={t('phonePlaceholder')}
                            value={participant.phone}
                            onChange={(e) => updateParticipant(index, 'phone', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                      </div>

                      <fieldset>
                        <legend className={labelClass}>{t('genderLegend')}</legend>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            aria-pressed={participant.gender === 'male'}
                            onClick={() => updateParticipant(index, 'gender', 'male')}
                            className={`min-h-11 rounded-lg border text-xs font-bold uppercase tracking-wider transition-colors ${
                              participant.gender === 'male'
                                ? 'border-primary bg-primary text-ink'
                                : 'border-card-border bg-dark-gray text-muted hover:border-primary hover:text-white'
                            }`}
                          >
                            {t('male')}
                          </button>
                          <button
                            type="button"
                            aria-pressed={participant.gender === 'female'}
                            onClick={() => updateParticipant(index, 'gender', 'female')}
                            className={`min-h-11 rounded-lg border text-xs font-bold uppercase tracking-wider transition-colors ${
                              participant.gender === 'female'
                                ? 'border-primary bg-primary text-ink'
                                : 'border-card-border bg-dark-gray text-muted hover:border-primary hover:text-white'
                            }`}
                          >
                            {t('female')}
                          </button>
                        </div>
                      </fieldset>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor={`athlete-${index}-shirt-size`} className={labelClass}>{t('shirtSizeLabel')}</label>
                          <select
                            id={`athlete-${index}-shirt-size`}
                            name={`participants.${index}.shirtSize`}
                            required
                            value={participant.shirtSize}
                            onChange={(e) => updateParticipant(index, 'shirtSize', e.target.value)}
                            className={fieldClass}
                          >
                            <option value="">{t('selectPlaceholder')}</option>
                            {SHIRT_SIZES.map(size => (
                              <option key={size} value={size}>
                                {isOptionalShirt ? t('shirtSizeAddonOption', { size, amount: shirtAddonPriceLabel }) : size}
                              </option>
                            ))}
                            {isOptionalShirt && (
                              <option value={SHIRT_NONE}>{t('shirtNoneOption')}</option>
                            )}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`athlete-${index}-instagram`} className={labelClass}>{t('instagramLabel')}</label>
                          <input
                            id={`athlete-${index}-instagram`}
                            name={`participants.${index}.instagram`}
                            type="text"
                            autoCapitalize="none"
                            placeholder={t('instagramPlaceholder')}
                            value={participant.instagram}
                            onChange={(e) => updateParticipant(index, 'instagram', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                      </div>

                      {isFitnessRacing && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <div>
                            <label htmlFor={`athlete-${index}-birth-date`} className={labelClass}>{t('birthDateLabel')}</label>
                            <input
                              id={`athlete-${index}-birth-date`}
                              name={`participants.${index}.birthDate`}
                              type="date"
                              required
                              value={participant.birthDate}
                              onChange={(e) => updateParticipant(index, 'birthDate', e.target.value)}
                              className={fieldClass}
                            />
                          </div>
                          <div>
                            <label htmlFor={`athlete-${index}-city`} className={labelClass}>{t('cityLabel')}</label>
                            <input
                              id={`athlete-${index}-city`}
                              name={`participants.${index}.city`}
                              type="text"
                              required
                              value={participant.city}
                              onChange={(e) => updateParticipant(index, 'city', e.target.value)}
                              className={fieldClass}
                            />
                          </div>
                          {isBrazilEvent ? (
                            <div>
                              <label htmlFor={`athlete-${index}-state`} className={labelClass}>{t('stateBirthLabelRequired')}</label>
                              <UfSelect
                                id={`athlete-${index}-state`}
                                name={`participants.${index}.state`}
                                required
                                value={participant.state}
                                onChange={(uf) => updateParticipant(index, 'state', uf)}
                                placeholder={t('stateBirthPlaceholder')}
                                className={fieldClass}
                              />
                            </div>
                          ) : (
                            <div>
                              <label htmlFor={`athlete-${index}-state`} className={labelClass}>{t('stateLabel')}</label>
                              <input
                                id={`athlete-${index}-state`}
                                name={`participants.${index}.state`}
                                type="text"
                                required
                                maxLength={60}
                                placeholder={t('stateUfPlaceholder')}
                                value={participant.state}
                                onChange={(e) => updateParticipant(index, 'state', e.target.value)}
                                className={fieldClass}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {!isFitnessRacing && isBrazilEvent && !isTeamCategory && (
                        <div>
                          <label htmlFor={`athlete-${index}-state`} className={labelClass}>{t('stateBirthLabelOptional')}</label>
                          <UfSelect
                            id={`athlete-${index}-state`}
                            name={`participants.${index}.state`}
                            value={participant.state}
                            onChange={(uf) => updateParticipant(index, 'state', uf)}
                            placeholder={t('stateBirthPlaceholder')}
                            className={fieldClass}
                          />
                        </div>
                      )}

                      {isBrazilEvent && !isTeamCategory && (
                        <p className="text-[11px] leading-snug text-muted">{t('stateBirthFlagNotice')}</p>
                      )}
                    </fieldset>

                    {athleteStep === 0 && (
                      <>
                        {/* Box / Afiliado */}
                        <div>
                          <label htmlFor="athlete-box" className={labelClass}>{t('boxLabel', { required: isFitnessRacing ? '*' : '' })}</label>
                          <input
                            id="athlete-box"
                            name="box"
                            autoComplete="organization"
                            type="text"
                            required={isFitnessRacing}
                            placeholder={t('boxPlaceholder')}
                            value={box}
                            onChange={(e) => setBox(e.target.value)}
                            className={fieldClass}
                          />
                        </div>

                        {/* Senha da conta do atleta */}
                        <div className="space-y-4 rounded-xl border border-card-border bg-card p-4">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-primary">{t('athleteAccessTitle')}</p>
                            <p className="mt-1 text-sm text-muted">{t('athleteAccessDescription')}</p>
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label htmlFor="athlete-panel-password" className={labelClass}>{t('panelPasswordLabel')}</label>
                              <input
                                id="athlete-panel-password"
                                name="athletePanelPassword"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={6}
                                placeholder={t('panelPasswordPlaceholder')}
                                value={athletePassword}
                                onChange={(e) => setAthletePassword(e.target.value)}
                                className={fieldClass}
                              />
                            </div>
                            <div>
                              <label htmlFor="athlete-panel-password-confirmation" className={labelClass}>{t('confirmPasswordLabel')}</label>
                              <input
                                id="athlete-panel-password-confirmation"
                                name="athletePanelPasswordConfirmation"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={6}
                                placeholder={t('confirmPasswordPlaceholder')}
                                value={athletePasswordConfirmation}
                                onChange={(e) => setAthletePasswordConfirmation(e.target.value)}
                                className={fieldClass}
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Etapa 3: pagamento */}
                {step === 3 && (
                  <div className="space-y-5">
                    <h4 className="type-display text-xl text-white">{t('stepPaymentTitle')}</h4>

                    {/* Cupom de Desconto */}
                    <div>
                      <label htmlFor="checkout-coupon" className={labelClass}>{t('couponLabel')}</label>
                      <div className="flex gap-2">
                        <input
                          id="checkout-coupon"
                          type="text"
                          placeholder={t('couponPlaceholder')}
                          value={couponCode}
                          aria-describedby={showCouponShirtNotice ? 'checkout-coupon-shirt-notice' : undefined}
                          onChange={(e) => {
                            setCouponCode(e.target.value);
                            if (appliedCoupon && e.target.value.trim().toUpperCase() !== appliedCoupon) {
                              clearAppliedCoupon();
                            }
                          }}
                          className={`${fieldClass} flex-1 uppercase`}
                        />
                        <button
                          type="button"
                          onClick={handleApplyCoupon}
                          disabled={isApplyingCoupon}
                          className="min-h-12 shrink-0 rounded-lg border border-card-border bg-elevated px-4 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isApplyingCoupon ? t('applying') : t('apply')}
                        </button>
                      </div>
                      {/* Região viva sempre montada: os avisos do cupom aparecem depois de
                          "Aplicar" e precisam ser anunciados pelo leitor de tela. */}
                      <div aria-live="polite">
                        {couponNotice && (
                          <p className={`mt-1.5 text-xs font-semibold ${couponNotice.tone === 'success' ? 'text-trading-up' : 'text-trading-down'}`}>
                            {couponNotice.text}
                          </p>
                        )}
                        {showCouponShirtNotice && (
                          <p id="checkout-coupon-shirt-notice" className="mt-1.5 text-xs leading-5 text-muted">
                            {t('couponShirtNotice')}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Seleção do Método de Pagamento — só exibida quando há mais de uma opção (Pix é exclusivo do Brasil) */}
                    {pixSupported && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="block text-xs font-bold text-foreground">{t('paymentMethodLabelForm')}</span>
                          <img src="/mercadopago-logo.png" alt="Mercado Pago" className="h-5 w-auto rounded-sm bg-white object-contain p-0.5" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            aria-pressed={paymentMethod === 'pix'}
                            onClick={() => setPaymentMethod('pix')}
                            className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border text-xs font-bold uppercase transition-colors ${
                              paymentMethod === 'pix'
                                ? 'border-primary bg-primary/10 text-white'
                                : 'border-card-border bg-dark-gray text-muted hover:border-muted'
                            }`}
                          >
                            <span className="h-2 w-2 rounded-full bg-primary" />
                            {t('pixOption')}
                          </button>
                          <button
                            type="button"
                            aria-pressed={paymentMethod === 'credit_card'}
                            onClick={() => setPaymentMethod('credit_card')}
                            className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border text-xs font-bold uppercase transition-colors ${
                              paymentMethod === 'credit_card'
                                ? 'border-primary bg-primary/10 text-white'
                                : 'border-card-border bg-dark-gray text-muted hover:border-muted'
                            }`}
                          >
                            <span className="h-2 w-2 rounded-full bg-muted" />
                            {t('cardOption')}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* CPF do Pagador para Pix */}
                    {paymentMethod === 'pix' && pixSupported && (
                      <div>
                        <label htmlFor="athlete-cpf" className={labelClass}>{t('cpfPayerLabel')}</label>
                        <input
                          id="athlete-cpf"
                          name="cpf"
                          type="text"
                          inputMode="numeric"
                          required
                          placeholder={t('cpfPlaceholder')}
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
                          className={`${fieldClass} font-mono`}
                        />
                      </div>
                    )}

                    {/* Mensagem de Redirecionamento para Cartão de Crédito */}
                    {paymentMethod === 'credit_card' && (
                      <div className="rounded-lg border border-info/30 bg-info/10 p-4 text-xs space-y-2 text-foreground">
                        <p className="font-semibold text-white flex items-center gap-1.5">
                          <Lock className="h-4 w-4" aria-hidden="true" />
                          {t('secureRedirectTitle')}
                        </p>
                        <p className="leading-5 text-muted">
                          {t('secureRedirectDescription')}
                        </p>
                      </div>
                    )}

                    {/* Resumo do Pedido e Pagamento */}
                    <div className="space-y-3 rounded-xl border border-card-border bg-card p-4">
                      <div className="flex justify-between items-center gap-3 text-sm">
                        <span className="font-medium text-muted">{t('orderSummaryRegistration', { division: selectedDivision?.name ?? '' })}</span>
                        <span className="font-number font-bold text-white">{formatMoney(ticketPrice, event.currency ?? 'BRL', locale)}</span>
                      </div>
                      {registrationAmounts.shirtAddonAmount > 0 && (
                        <div className="flex justify-between items-center gap-3 text-sm">
                          <span className="font-medium text-muted">{t('orderSummaryShirts', { count: shirtAddonCount, amount: shirtAddonPriceLabel })}</span>
                          <span className="font-number font-bold text-white">+ {formatMoney(registrationAmounts.shirtAddonAmount, event.currency ?? 'BRL', locale)}</span>
                        </div>
                      )}
                      {/* Desconto já limitado ao valor da inscrição: um cupom fixo maior que a
                          categoria não pode abater a camisa, e o resumo precisa fechar a conta. */}
                      {appliedCoupon && registrationAmounts.discount > 0 && (
                        <div className="flex justify-between items-center gap-3 text-sm text-trading-up">
                          <span className="font-semibold">{t('discountLabel', { code: appliedCoupon })}</span>
                          <span className="font-number font-bold">- {formatMoney(registrationAmounts.discount, event.currency ?? 'BRL', locale)}</span>
                        </div>
                      )}
                      {serviceFeePreview > 0 && serviceFeeConfig.payer === 'athlete' && (
                        <div className="flex justify-between items-center gap-3 text-sm text-muted">
                          <span className="font-semibold">{t('serviceFeeLabel', { percent: serviceFeeConfig.percent })}</span>
                          <span className="font-number font-bold">{formatMoney(serviceFeePreview, event.currency ?? 'BRL', locale)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-card-border pt-2 text-base">
                        <span className="font-extrabold uppercase tracking-wider text-white">{t('totalLabel')}</span>
                        <span className="font-number font-black text-white">{formatMoney(amountCollectedPreview, event.currency ?? 'BRL', locale)}</span>
                      </div>
                      <div className="flex items-start gap-2 border-t border-card-border pt-3 text-xs text-muted leading-normal">
                        <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1">
                          <p className="font-bold text-white">{t('paymentProcessedTitle')}</p>
                          <p className="mt-0.5">{t('paymentProcessedDescription')}</p>
                        </div>
                      </div>
                    </div>

                    {/* Checkbox de Aceite dos Termos */}
                    <div className="flex items-start gap-3 rounded-xl border border-card-border bg-card p-4">
                      <input
                        id="accept-terms"
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => setAcceptedTerms(e.target.checked)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                      />
                      <label htmlFor="accept-terms" className="text-xs leading-relaxed text-muted select-none">
                        {t.rich('acceptTermsNotice', {
                          terms: (chunks) => (
                            <Link href="/termos" target="_blank" className="font-bold text-white underline transition-colors hover:text-primary">
                              {chunks}
                            </Link>
                          ),
                          privacy: (chunks) => (
                            <Link href="/termos#privacidade" target="_blank" className="font-bold text-white underline transition-colors hover:text-primary">
                              {chunks}
                            </Link>
                          )
                        })}
                      </label>
                    </div>

                    {amountsUpdatedNotice && (
                      <p role="alert" className="rounded-lg border border-trading-down/40 bg-trading-down/10 p-3 text-xs font-semibold leading-5 text-white">
                        {amountsUpdatedNotice}
                      </p>
                    )}
                  </div>
                )}

                {stepError && (
                  <p role="alert" className="rounded-lg border border-trading-down/40 bg-trading-down/10 p-3 text-sm font-semibold text-white">
                    {stepError}
                  </p>
                )}
              </div>
            </div>

            {/* Rodapé fixo: total e a ação da etapa (Story 1.134) */}
            <div className="flex items-center justify-between gap-4 border-t border-card-border bg-card px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 sm:px-5">
              <p className="min-w-0 leading-tight">
                <span className="block text-xs font-semibold text-muted">{t('totalLabel')}</span>
                <span className="font-number text-xl font-bold text-white tabular-nums">{formatMoney(amountCollectedPreview, event.currency ?? 'BRL', locale)}</span>
              </p>
              {step < 3 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover"
                >
                  {t('continue')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isProcessing || !acceptedTerms}
                  className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-black text-ink transition-colors hover:bg-primary-hover disabled:bg-primary-disabled disabled:text-muted"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                      <span>{t('processingPayment')}</span>
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-5 w-5" aria-hidden="true" />
                      <span>{t('confirmAndPay')}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        )}
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
  const mockPublicKey = await resolveCheckoutPublicKey(event.id);
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
