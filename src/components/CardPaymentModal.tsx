'use client';

import React, { useState, useCallback } from 'react';
import { CreditCard, X, Lock, Check } from 'lucide-react';
import { Athlete, Event, Registration } from '@/types';

interface CardPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  registration: Registration;
  athlete: Athlete;
  event: Event;
  onSuccess: (status: string) => void;
}

const isValidCPF = (cpfStr: string) => {
  const clean = cpfStr.replace(/\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let soma = 0;
  let resto;
  for (let i = 1; i <= 9; i++) soma = soma + parseInt(clean.substring(i - 1, i)) * (11 - i);
  resto = (soma * 10) % 11;
  if ((resto === 10) || (resto === 11)) resto = 0;
  if (resto !== parseInt(clean.substring(9, 10))) return false;

  soma = 0;
  for (let i = 1; i <= 10; i++) soma = soma + parseInt(clean.substring(i - 1, i)) * (12 - i);
  resto = (soma * 10) % 11;
  if ((resto === 10) || (resto === 11)) resto = 0;
  if (resto !== parseInt(clean.substring(10, 11))) return false;

  return true;
};

export default function CardPaymentModal({
  isOpen,
  onClose,
  registration,
  athlete,
  event,
  onSuccess
}: CardPaymentModalProps) {
  const [cardNumber, setCardNumber] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [securityCode, setSecurityCode] = useState('');
  const [cpf, setCpf] = useState('');

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Formata número do cartão: 0000 0000 0000 0000
  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    const formatted = value.replace(/(\d{4})(?=\d)/g, '$1 ').substring(0, 19);
    setCardNumber(formatted);
  };

  // Formata validade: MM/AA
  const handleExpirationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    let formatted = value;
    if (value.length > 2) {
      formatted = `${value.substring(0, 2)}/${value.substring(2, 4)}`;
    }
    setExpirationDate(formatted.substring(0, 5));
  };

  // Formata CPF: 000.000.000-00
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    let formatted = value;
    if (value.length > 9) {
      formatted = `${value.substring(0, 3)}.${value.substring(3, 6)}.${value.substring(6, 9)}-${value.substring(9, 11)}`;
    } else if (value.length > 6) {
      formatted = `${value.substring(0, 3)}.${value.substring(3, 6)}.${value.substring(6, 9)}`;
    } else if (value.length > 3) {
      formatted = `${value.substring(0, 3)}.${value.substring(3, 6)}`;
    }
    setCpf(formatted.substring(0, 14));
  };

  const resolveCheckoutPublicKey = async (eventId: string, eventPublicKey?: string) => {
    try {
      const response = await fetch(`/api/checkout/config?event_id=${eventId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.publicKey) return data.publicKey;
      } else {
        const errData = await response.json().catch(() => ({}));
        console.error("[CardPaymentModal] Erro do servidor ao obter Public Key:", errData);
      }
    } catch (err) {
      console.error("[CardPaymentModal] Erro de rede ao buscar Public Key:", err);
    }
    if (eventPublicKey) return eventPublicKey;
    throw new Error('O pagamento por cartão de crédito está temporariamente indisponível para este evento. Por favor, tente realizar o pagamento via Pix ou entre em contato com os organizadores.');
  };

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validações
    if (!cardNumber || !cardholderName || !expirationDate || !securityCode || !cpf) {
      setErrorMessage('Por favor, preencha todos os campos do cartão.');
      return;
    }

    if (!/^\d{2}\/\d{2}$/.test(expirationDate)) {
      setErrorMessage('Informe a validade do cartão no formato MM/AA.');
      return;
    }

    if (!isValidCPF(cpf)) {
      setErrorMessage('Por favor, informe um CPF válido para processar o pagamento.');
      return;
    }

    setIsProcessing(true);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).MercadoPago) {
        throw new Error('O gateway de pagamento do Mercado Pago está carregando. Por favor, tente novamente em alguns segundos.');
      }

      // 1. Resolve a chave pública
      const publicKey = await resolveCheckoutPublicKey(event.id, event.mpPublicKey);

      // 2. Inicializa o Mercado Pago
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mp = new (window as any).MercadoPago(publicKey);

      // 3. Divide a validade
      const expirationParts = expirationDate.split('/');
      const month = expirationParts[0]?.trim();
      const year = '20' + expirationParts[1]?.trim();
      const monthNumber = Number(month);

      if (!month || !year || monthNumber < 1 || monthNumber > 12) {
        throw new Error('Validade do cartão inválida.');
      }

      // 4. Tokeniza o cartão no cliente
      let cardToken;
      try {
        cardToken = await mp.createCardToken({
          cardNumber: cardNumber.replace(/\s/g, ''),
          cardholderName: cardholderName,
          cardExpirationMonth: month,
          cardExpirationYear: year,
          securityCode: securityCode,
          identificationType: 'CPF',
          identificationNumber: cpf.replace(/\D/g, '')
        });
      } catch (tokenErr) {
        console.error("[CardPaymentModal Tokenizer] Erro:", tokenErr);
        throw new Error('Dados do cartão inválidos. Verifique os campos e tente novamente.');
      }

      if (!cardToken || !cardToken.id) {
        throw new Error('Não foi possível validar os dados do cartão. Verifique os números informados.');
      }

      // 5. Detecta o método de pagamento (bandeira)
      let paymentMethodId = 'visa';
      try {
        const bin = cardNumber.replace(/\s/g, '').substring(0, 6);
        const paymentMethodsResponse = await mp.getPaymentMethods({ bin });
        const paymentMethods = Array.isArray(paymentMethodsResponse)
          ? paymentMethodsResponse
          : paymentMethodsResponse?.results || [];
        paymentMethodId = paymentMethods[0]?.id || 'visa';
      } catch (binErr) {
        console.warn("[CardPaymentModal Method Detector] Erro ao detectar bandeira, usando visa fallback:", binErr);
      }

      // 6. Faz o POST para processar o pagamento com cartão
      const response = await fetch('/api/checkout/card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          registrationData: {
            id: registration.id,
            eventId: event.id,
            divisionId: registration.divisionId,
            athleteName: registration.athleteName,
            athleteEmail: registration.athleteEmail,
            athletePhone: registration.athletePhone,
            box: registration.box || 'Independente',
            gender: registration.gender,
            ticketType: registration.ticketType,
            ticketPrice: registration.ticketPrice,
            quantity: registration.quantity,
            totalPaid: registration.totalPaid,
            couponCode: registration.couponCode
          },
          athleteProfile: {
            id: athlete.id,
            name: athlete.name,
            box: athlete.box,
            country: athlete.country,
            divisionId: athlete.divisionId,
            birthDate: athlete.birthDate,
            city: athlete.city,
            state: athlete.state,
            photoUrl: athlete.photoUrl,
            email: athlete.email,
            phone: athlete.phone,
            gender: athlete.gender,
            instagram: athlete.instagram,
            isTeam: athlete.isTeam,
            teamMembers: athlete.teamMembers
          },
          token: cardToken.id,
          payment_method_id: paymentMethodId,
          installments: 1,
          cpf,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          deviceId: (window as any).MP_DEVICE_SESSION_ID || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const detail = data.statusDetail ? ` (${data.statusDetail})` : '';
        throw new Error(`${data.error || 'Erro ao processar pagamento com cartão.'}${detail}`);
      }

      if (data.status === 'approved') {
        setPaymentSuccess(true);
        setTimeout(() => {
          onSuccess(data.status);
        }, 1500);
      } else if (data.status === 'in_process') {
        alert('Seu pagamento está sendo analisado pelo Mercado Pago. Acompanhe a confirmação no painel.');
        onSuccess(data.status);
      } else {
        throw new Error(`Pagamento não processado. Status: ${data.status}. Motivo: ${data.statusDetail || 'Recusado pelo banco emissor.'}`);
      }

    } catch (err) {
      console.error("[CardPaymentModal Submit] Erro:", err);
      setErrorMessage(err instanceof Error ? err.message : 'Erro interno ao processar pagamento.');
    } finally {
      setIsProcessing(false);
    }
  }, [cardNumber, cardholderName, expirationDate, securityCode, cpf, event, registration, athlete, onSuccess]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4">
      <div className="relative w-full max-w-md rounded-xl border border-neutral-800 bg-[#16181e] p-6 shadow-2xl" role="dialog" aria-modal="true">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-black">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-wider text-primary">Regularizar Inscrição</p>
              <h3 className="text-base font-bold text-white uppercase tracking-tight">Pagar com Cartão</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors"
            aria-label="Fechar modal"
            disabled={isProcessing}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {paymentSuccess ? (
          /* Tela de Sucesso */
          <div className="py-8 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 border border-green-500/30">
              <Check className="h-7 w-7 text-green-500" />
            </div>
            <h4 className="text-lg font-bold text-white uppercase tracking-wide">PAGAMENTO APROVADO!</h4>
            <p className="text-xs text-neutral-400">Sua inscrição foi confirmada e sua vaga na arena está garantida.</p>
          </div>
        ) : (
          /* Formulário de Cartão */
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">

            {/* Informações da Inscrição */}
            <div className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-neutral-400">Competição:</span>
                <span className="font-bold text-white truncate max-w-[200px]">{event.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Categoria:</span>
                <span className="font-semibold text-white">{registration.ticketType}</span>
              </div>
              <div className="flex justify-between border-t border-neutral-800/80 pt-1.5">
                <span className="text-neutral-400">Total a pagar:</span>
                <span className="font-bold text-primary font-number">R$ {registration.totalPaid.toFixed(2)}</span>
              </div>
            </div>

            {errorMessage && (
              <div className="rounded-md border border-red-500/25 bg-red-500/10 p-3 text-xs font-semibold text-red-400" role="alert">
                {errorMessage}
              </div>
            )}

            {/* Número do Cartão */}
            <div className="space-y-1">
              <label htmlFor="modal-card-number" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">Número do Cartão *</label>
              <input
                id="modal-card-number"
                type="text"
                required
                placeholder="0000 0000 0000 0000"
                value={cardNumber}
                onChange={handleCardNumberChange}
                disabled={isProcessing}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
              />
            </div>

            {/* Nome do Titular */}
            <div className="space-y-1">
              <label htmlFor="modal-cardholder-name" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">Titular do Cartão (como no cartão) *</label>
              <input
                id="modal-cardholder-name"
                type="text"
                required
                placeholder="Ex: LUAS S SILVA"
                value={cardholderName}
                onChange={(e) => setCardholderName(e.target.value.toUpperCase())}
                disabled={isProcessing}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none uppercase"
              />
            </div>

            {/* Validade e CVV */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="modal-card-expiration" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">Validade (MM/AA) *</label>
                <input
                  id="modal-card-expiration"
                  type="text"
                  required
                  placeholder="MM/AA"
                  value={expirationDate}
                  onChange={handleExpirationChange}
                  disabled={isProcessing}
                  className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="modal-card-cvv" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">CVV *</label>
                <input
                  id="modal-card-cvv"
                  type="password"
                  required
                  placeholder="123"
                  maxLength={4}
                  value={securityCode}
                  onChange={(e) => setSecurityCode(e.target.value.replace(/\D/g, ''))}
                  disabled={isProcessing}
                  className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            {/* CPF do Pagador */}
            <div className="space-y-1">
              <label htmlFor="modal-card-cpf" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">CPF do Pagador *</label>
              <input
                id="modal-card-cpf"
                type="text"
                required
                placeholder="000.000.000-00"
                value={cpf}
                onChange={handleCpfChange}
                disabled={isProcessing}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isProcessing}
                className="flex w-full h-11 items-center justify-center gap-2 rounded-md bg-primary font-bold uppercase text-black tracking-wider text-xs transition-colors hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                    <span>Processando Pagamento...</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    <span>Pagar com Segurança</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-[10px] text-center text-neutral-500 flex items-center justify-center gap-1">
              <Lock className="h-3 w-3 text-neutral-600" />
              Seus dados de cartão não serão salvos no WODArena.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
