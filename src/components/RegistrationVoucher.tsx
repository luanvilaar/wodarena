'use client';

import React from 'react';
import Image from 'next/image';
import { Calendar, CheckCircle2, MapPin, Printer, ShieldCheck, TicketCheck, User, X } from 'lucide-react';
import { Registration, Athlete, Event } from '@/types';

interface RegistrationVoucherProps {
  registration: Registration;
  athlete: Athlete;
  event: Event;
  cpf?: string;
  onClose: () => void;
}

export function RegistrationVoucher({
  registration,
  athlete,
  event,
  cpf = '',
  onClose
}: RegistrationVoucherProps) {
  const getMaskedCPF = (rawCpf: string) => {
    const clean = rawCpf.replace(/\D/g, '');
    if (clean.length !== 11) return rawCpf;
    return `***.${clean.substring(3, 6)}.${clean.substring(6, 9)}-**`;
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const createdAtDate = registration.createdAt ? new Date(registration.createdAt) : new Date('2026-06-04T12:00:00.000Z');
  const formattedIssueDate = createdAtDate.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const formattedPrice = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(registration.totalPaid);

  const teamMembers = athlete.isTeam && athlete.teamMembers && athlete.teamMembers.length > 0
    ? athlete.teamMembers.map(member => member.name).join(' / ')
    : '';

  const hasBanner = Boolean(event.bannerUrl);
  const hasLogo = Boolean(event.logoUrl);

  return (
    <div
      id="print-voucher-overlay"
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[#0b0e11]/95 px-3 py-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Comprovante de inscrição"
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden !important;
          }
          #print-voucher-overlay, #print-voucher-overlay * {
            visibility: visible !important;
          }
          #print-voucher-overlay {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            min-height: 100% !important;
            background: #ffffff !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
          }
          .no-print {
            display: none !important;
          }
          .voucher-shell {
            width: 100% !important;
            max-width: 430px !important;
            margin: 0 auto !important;
            border: 0 !important;
            box-shadow: none !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}} />

      <div className="w-full max-w-[430px] space-y-3">
        <div className="no-print flex items-center justify-between rounded-lg border border-[#2b3139] bg-[#1e2329] px-3 py-2 text-white">
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0ecb81]" aria-hidden="true" />
            <span className="truncate text-xs font-bold uppercase">Inscrição confirmada</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#929aa5] transition-colors hover:bg-[#2b3139] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50"
            aria-label="Fechar comprovante"
            type="button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <article className="voucher-shell relative w-full min-h-[690px] overflow-hidden rounded-xl border border-[#2b3139] bg-[#0b0e11] text-white shadow-2xl">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-[#FCD535]" aria-hidden="true" />

          <div className="flex h-full flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-[#2b3139] bg-[#0b0e11] px-5 pb-4 pt-6">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase text-[#FCD535]">WODArena</p>
                <h2 className="mt-1 truncate text-base font-black uppercase text-white">{event.name}</h2>
              </div>
              {hasLogo ? (
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[#2b3139] bg-white p-1">
                  <Image
                    src={event.logoUrl}
                    alt={`${event.name} logo`}
                    width={48}
                    height={48}
                    unoptimized
                    className="h-full w-full rounded object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#2b3139] bg-[#1e2329] text-sm font-black text-[#FCD535]">
                  WA
                </div>
              )}
            </header>

            <section className="relative h-40 shrink-0 overflow-hidden bg-[#1e2329]">
              {hasBanner ? (
                <Image
                  src={event.bannerUrl}
                  alt={`${event.name} banner`}
                  width={430}
                  height={180}
                  unoptimized
                  priority
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <span className="text-lg font-black uppercase text-[#FCD535]">{event.name}</span>
                </div>
              )}
              <div className="absolute left-4 top-4 rounded-md border border-[#FCD535]/50 bg-[#0b0e11] px-3 py-1">
                <span className="text-[10px] font-black uppercase text-[#FCD535]">Comprovante oficial</span>
              </div>
            </section>

            <section className="bg-[#FCD535] px-5 py-5 text-[#181a20]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase text-[#181a20]/70">Participante</p>
                  <h1 className="mt-1 break-words text-2xl font-black uppercase leading-tight">{registration.athleteName}</h1>
                </div>
                <TicketCheck className="mt-1 h-8 w-8 shrink-0 text-[#181a20]" aria-hidden="true" />
              </div>
              {teamMembers && (
                <p className="mt-3 text-xs font-semibold leading-relaxed text-[#181a20]/80">
                  Integrantes: {teamMembers}
                </p>
              )}
            </section>

            <section className="grid grid-cols-2 gap-px bg-[#2b3139] text-[#eaecef]">
              <VoucherInfo label="Categoria" value={registration.ticketType} icon={<TicketCheck className="h-4 w-4" />} />
              <VoucherInfo label="Valor pago" value={formattedPrice} strong />
              <VoucherInfo label="Data" value={event.date} icon={<Calendar className="h-4 w-4" />} />
              <VoucherInfo label="Local" value={event.location} icon={<MapPin className="h-4 w-4" />} />
              <VoucherInfo label="Box" value={registration.box || 'Independente'} icon={<User className="h-4 w-4" />} />
              <VoucherInfo label="Emissão" value={formattedIssueDate} />
              {cpf && <VoucherInfo label="CPF" value={getMaskedCPF(cpf)} />}
              <VoucherInfo label="ID" value={registration.id} mono wide={!cpf} />
            </section>

            <footer className="mt-auto space-y-4 bg-[#0b0e11] px-5 py-5">
              <div className="rounded-lg border border-[#2b3139] bg-[#1e2329] p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0ecb81]" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-bold uppercase text-white">Inscrição validada</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[#929aa5]">
                      Este comprovante confirma a inscrição no evento e pode ser salvo ou compartilhado pelo atleta.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase text-[#707a8a]">
                <span>wodarena.com</span>
                <span>{registration.id}</span>
              </div>
            </footer>
          </div>
        </article>

        <div className="no-print grid grid-cols-2 gap-3">
          <button
            onClick={handlePrint}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#2b3139] bg-[#1e2329] px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:border-[#FCD535]/50 hover:text-[#FCD535] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50"
            type="button"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Imprimir
          </button>
          <button
            onClick={onClose}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#FCD535] px-4 py-2 text-xs font-bold uppercase text-[#181a20] transition-colors hover:bg-[#f0b90b] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50"
            type="button"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}

function VoucherInfo({
  label,
  value,
  icon,
  strong = false,
  mono = false,
  wide = false
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  strong?: boolean;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`min-h-[82px] bg-[#0b0e11] p-4 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-[10px] font-bold uppercase text-[#707a8a]">{label}</p>
      <div className="mt-2 flex items-start gap-2">
        {icon && <span className="mt-0.5 shrink-0 text-[#FCD535]">{icon}</span>}
        <p className={`break-words text-sm uppercase leading-snug text-white ${strong ? 'text-lg font-black text-[#FCD535]' : 'font-bold'} ${mono ? 'font-mono text-xs normal-case' : ''}`}>
          {value}
        </p>
      </div>
    </div>
  );
}
