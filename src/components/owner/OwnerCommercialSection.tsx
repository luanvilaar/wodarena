'use client';

import { useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { CommercialLead, CommercialLeadStatus } from '@/types';
import {
  buildCommercialLeadWhatsAppUrl,
  getCommercialLeadCountryLabel,
  getCommercialLeadEmailStatusLabel,
  getCommercialLeadStatusLabel
} from '@/lib/commercialLeads';
import { formatOwnerDateTime } from '@/components/owner/ownerUi';

// Seção Comercial (Story 1.126, decisão D5 de docs/design/painel-proprietario/):
// interessados da campanha da home com o status editável na linha (Novo,
// Contatado, Qualificado, Descartado), filtro por status, aviso por e-mail e o
// botão de conversa no WhatsApp.

export const COMMERCIAL_LEAD_STATUS_OPTIONS: CommercialLeadStatus[] = ['new', 'contacted', 'qualified', 'discarded'];

type Props = {
  leads: CommercialLead[];
  loading: boolean;
  error: string;
  savingLeadId: string | null;
  statusError: string;
  onStatusChange: (lead: CommercialLead, status: CommercialLeadStatus) => void;
};

const EMAIL_TONES: Record<string, string> = {
  sent: 'bg-primary/10 text-primary',
  failed: 'bg-red-950/30 text-red-300',
  pending: 'bg-dark-gray text-muted',
  skipped: 'bg-dark-gray text-muted'
};

function StatusSelect({ lead, saving, onChange }: { lead: CommercialLead; saving: boolean; onChange: Props['onStatusChange'] }) {
  return (
    <>
      <label htmlFor={`lead-status-${lead.id}`} className="sr-only">Status de {lead.managerName}</label>
      <select
        id={`lead-status-${lead.id}`}
        value={lead.leadStatus}
        disabled={saving}
        aria-busy={saving}
        onChange={event => onChange(lead, event.target.value as CommercialLeadStatus)}
        className="min-h-10 rounded-md border border-card-border bg-background px-2 text-xs font-semibold text-white focus:border-primary/50 focus:outline-none disabled:opacity-60"
      >
        {COMMERCIAL_LEAD_STATUS_OPTIONS.map(status => (
          <option key={status} value={status}>{getCommercialLeadStatusLabel(status)}</option>
        ))}
      </select>
    </>
  );
}

function WhatsAppButton({ lead }: { lead: CommercialLead }) {
  const url = buildCommercialLeadWhatsAppUrl(lead);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Conversar com ${lead.managerName} no WhatsApp`}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-card-border px-2.5 text-xs font-bold text-white transition-colors hover:border-primary/50"
    >
      <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Conversar
    </a>
  );
}

export function OwnerCommercialSection({ leads, loading, error, savingLeadId, statusError, onStatusChange }: Props) {
  const [filter, setFilter] = useState<CommercialLeadStatus | 'all'>('all');

  const counts = useMemo(() => ({
    total: leads.length,
    new: leads.filter(lead => lead.leadStatus === 'new').length,
    contacted: leads.filter(lead => lead.leadStatus === 'contacted').length,
    qualified: leads.filter(lead => lead.leadStatus === 'qualified').length,
    discarded: leads.filter(lead => lead.leadStatus === 'discarded').length,
    emailFailed: leads.filter(lead => lead.ownerEmailNotificationStatus === 'failed').length
  }), [leads]);

  const visible = filter === 'all' ? leads : leads.filter(lead => lead.leadStatus === filter);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ['Total de leads', counts.total, 'text-white'],
          ['Novos', counts.new, 'text-primary'],
          ['Em conversa', counts.contacted + counts.qualified, 'text-white'],
          ['Aviso por e-mail falhou', counts.emailFailed, counts.emailFailed > 0 ? 'text-red-300' : 'text-white']
        ] as const).map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-card-border bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
            <p className={`mt-1 font-number text-2xl font-bold ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar leads por status">
        {(['all', ...COMMERCIAL_LEAD_STATUS_OPTIONS] as const).map(status => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            aria-pressed={filter === status}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
              filter === status ? 'border-primary/50 bg-primary/10 text-white' : 'border-card-border bg-card text-muted hover:text-white'
            }`}
          >
            {status === 'all' ? 'Todos' : getCommercialLeadStatusLabel(status)}
            <span className={`font-number ${filter === status ? 'text-primary' : 'text-muted'}`}>{status === 'all' ? counts.total : counts[status]}</span>
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-300">{error}</p>}
      {statusError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-300">{statusError}</p>}

      {loading ? (
        <p className="rounded-xl border border-card-border bg-card px-4 py-10 text-center text-sm text-muted">Carregando leads comerciais…</p>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border bg-card px-4 py-10 text-center">
          <p className="text-sm font-bold text-white">Nenhum lead capturado ainda</p>
          <p className="mt-2 text-xs text-muted">Os interessados enviados pela homepage aparecerão aqui automaticamente.</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-card-border bg-card px-4 py-10 text-center text-sm text-muted">Nenhum lead com esse status.</p>
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {visible.map(lead => (
              <li key={lead.id} className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{lead.managerName}</p>
                    <p className="text-xs text-muted">{lead.phone}</p>
                  </div>
                  <StatusSelect lead={lead} saving={savingLeadId === lead.id} onChange={onStatusChange} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-card-border pt-3 text-xs">
                  <div className="col-span-2"><dt className="text-[10px] uppercase tracking-wider text-muted">Evento</dt><dd className="text-white">{lead.eventName}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-muted">Cidade</dt><dd className="text-white">{lead.city} / {lead.state} · {getCommercialLeadCountryLabel(lead.country, lead.countryOther)}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-muted">Recebido</dt><dd className="text-white">{formatOwnerDateTime(lead.submittedAt)}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-muted">Notificação</dt><dd><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${EMAIL_TONES[lead.ownerEmailNotificationStatus] || EMAIL_TONES.pending}`}>{getCommercialLeadEmailStatusLabel(lead.ownerEmailNotificationStatus)}</span></dd></div>
                  <div className="text-right"><WhatsAppButton lead={lead} /></div>
                </dl>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-card-border bg-card lg:block">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-card-border text-[10.5px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-bold">Interessado</th>
                  <th className="px-3 py-3 font-bold">Evento que quer fazer</th>
                  <th className="px-3 py-3 font-bold">Cidade</th>
                  <th className="px-3 py-3 font-bold">Recebido</th>
                  <th className="px-3 py-3 font-bold">Notificação</th>
                  <th className="px-3 py-3 font-bold">Status</th>
                  <th className="px-4 py-3"><span className="sr-only">Conversa</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(lead => (
                  <tr key={lead.id} className="border-b border-card-border/60 align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-white">{lead.managerName}</span>
                      <span className="block text-[11.5px] text-muted">{lead.phone}</span>
                    </td>
                    <td className="px-3 py-3 text-white">{lead.eventName}</td>
                    <td className="px-3 py-3 text-muted">{lead.city} / {lead.state}<span className="block text-[11.5px]">{getCommercialLeadCountryLabel(lead.country, lead.countryOther)}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">{formatOwnerDateTime(lead.submittedAt)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${EMAIL_TONES[lead.ownerEmailNotificationStatus] || EMAIL_TONES.pending}`}>
                        {getCommercialLeadEmailStatusLabel(lead.ownerEmailNotificationStatus)}
                      </span>
                      {lead.ownerEmailError && lead.ownerEmailNotificationStatus === 'failed' && (
                        <span className="mt-1 block text-[11px] text-red-300">{lead.ownerEmailError}</span>
                      )}
                    </td>
                    <td className="px-3 py-3"><StatusSelect lead={lead} saving={savingLeadId === lead.id} onChange={onStatusChange} /></td>
                    <td className="px-4 py-3 text-right"><WhatsAppButton lead={lead} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
