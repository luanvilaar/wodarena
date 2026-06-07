'use client';

import React, { useState, useEffect } from 'react';
import { QrCode, X, Copy, Check, Lock, ShieldCheck } from 'lucide-react';
import { Athlete, Event, Registration } from '@/types';

interface PixPaymentModalProps {
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

export default function PixPaymentModal({
  isOpen,
  onClose,
  registration,
  athlete,
  event,
  onSuccess
}: PixPaymentModalProps) {
  const [cpf, setCpf] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const [pixData, setPixData] = useState<{
    qr_code: string;
    qr_code_base64: string;
    paymentId: string;
  } | null>(null);

  const activeTotalPaid = registration.totalPaid > 0 && registration.totalPaid < 1.00 ? 1.00 : registration.totalPaid;

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

  // Polling para verificar o status do pagamento Pix
  useEffect(() => {
    if (!pixData?.paymentId || !isOpen) return;

    let active = true;
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/checkout/status?payment_id=${pixData.paymentId}&event_id=${event.id}`);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.status === 'approved' && active) {
          active = false;
          clearInterval(intervalId);
          setPaymentSuccess(true);
          
          // Dispara e-mail local em background para notificar confirmação
          fetch('/api/checkout/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId: registration.id, cpf: cpf.replace(/\D/g, '') })
          }).catch(err => console.error("[PixPaymentModal Email Trigger] Erro ao disparar e-mail:", err));

          setTimeout(() => {
            onSuccess(data.status);
          }, 1500);
        }
      } catch (err) {
        console.error("[PixPaymentModal Polling] Erro:", err);
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [pixData, event.id, registration.id, cpf, isOpen, onSuccess]);

  const handleCopyPix = () => {
    if (!pixData?.qr_code) return;
    navigator.clipboard.writeText(pixData.qr_code);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const handleSubmitCpf = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isValidCPF(cpf)) {
      setErrorMessage('Por favor, informe um CPF válido para gerar o Pix.');
      return;
    }

    setIsProcessing(true);

    try {
      const response = await fetch('/api/checkout/pix', {
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
            totalPaid: activeTotalPaid,
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
          cpf
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao gerar pagamento via Pix.');
      }

      setPixData({
        qr_code: data.qr_code,
        qr_code_base64: data.qr_code_base64,
        paymentId: String(data.paymentId)
      });
    } catch (err) {
      console.error("[PixPaymentModal Submit CPF] Erro:", err);
      setErrorMessage(err instanceof Error ? err.message : 'Erro interno ao processar Pix.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4">
      <div className="relative w-full max-w-md rounded-xl border border-neutral-800 bg-[#16181e] p-6 shadow-2xl" role="dialog" aria-modal="true">
        
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-black">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-wider text-primary">Regularizar Inscrição</p>
              <h3 className="text-base font-bold text-white uppercase tracking-tight">Pagar com Pix</h3>
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
        ) : !pixData ? (
          /* Solicitação de CPF */
          <form onSubmit={handleSubmitCpf} className="mt-4 space-y-4">
            
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
                <span className="font-bold text-primary font-number">R$ {activeTotalPaid.toFixed(2)}</span>
              </div>
            </div>

            {errorMessage && (
              <div className="rounded-md border border-red-500/25 bg-red-500/10 p-3 text-xs font-semibold text-red-400" role="alert">
                {errorMessage}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="modal-pix-cpf" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">CPF do Pagador *</label>
              <input
                id="modal-pix-cpf"
                type="text"
                required
                placeholder="000.000.000-00"
                value={cpf}
                onChange={handleCpfChange}
                disabled={isProcessing}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
              />
              <p className="text-[9px] text-neutral-500">Exigido para a emissão do Pix seguro do Banco Central via Mercado Pago.</p>
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
                    <span>Gerando Pix...</span>
                  </>
                ) : (
                  <>
                    <span>Gerar QR Code Pix</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-[10px] text-center text-neutral-500 flex items-center justify-center gap-1">
              <Lock className="h-3 w-3 text-neutral-600" />
              Sua transação é protegida e processada via Mercado Pago.
            </p>
          </form>
        ) : (
          /* QR Code Pix e Copia e Cola */
          <div className="mt-4 space-y-4 text-center">
            <div className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-xs text-left space-y-1">
              <div className="flex justify-between">
                <span className="text-neutral-400">Total a pagar:</span>
                <span className="font-bold text-primary font-number">R$ {activeTotalPaid.toFixed(2)}</span>
              </div>
            </div>

            {/* QR Code */}
            <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-lg bg-white p-2">
              <img
                src={`data:image/jpeg;base64,${pixData.qr_code_base64}`}
                alt="QR Code Pix"
                className="h-full w-full object-contain"
              />
            </div>

            <p className="text-xs text-neutral-300">Escaneie o código acima com o aplicativo do seu banco.</p>

            {/* Divisor */}
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-neutral-800"></div>
              <span className="flex-shrink mx-4 text-[10px] text-neutral-500 font-bold uppercase tracking-widest">ou copie o código</span>
              <div className="flex-grow border-t border-neutral-800"></div>
            </div>

            {/* Copia e Cola */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={pixData.qr_code}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400 focus:outline-none truncate"
              />
              <button
                onClick={handleCopyPix}
                className="flex h-9 w-10 items-center justify-center rounded-md bg-primary text-black transition-colors hover:bg-primary/90 cursor-pointer"
                title="Copiar chave Pix"
              >
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>

            {copiado && (
              <p className="text-xs font-semibold text-green-400 animate-fade-in">Código copiado com sucesso!</p>
            )}

            {/* Polling status */}
            <div className="rounded-md border border-primary/10 bg-primary/5 p-3 flex items-center justify-center gap-3">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs text-neutral-400 text-left font-medium">Aguardando pagamento... A confirmação ocorrerá em instantes nesta tela.</p>
            </div>
            
            <p className="text-[10px] text-neutral-500 flex items-center justify-center gap-1 mt-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Sua vaga será garantida imediatamente após o pagamento.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
