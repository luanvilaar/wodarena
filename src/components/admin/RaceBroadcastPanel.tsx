'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Link2, Tv } from 'lucide-react';

import type { BroadcastMode } from '@/lib/broadcastMode';
import type { RaceBroadcastPayload } from '@/lib/raceBroadcastPayload';
import { describeRacePanelPreview } from '@/lib/raceBroadcastScreens';
import type { Event } from '@/types';

// Aba "Telão" do evento Fitness Race (Story 1.115): só o link da TV, o modo e a
// prévia (README do telão, "Como entra no sistema"). Segue o padrão visual da aba de
// Functional Fitness (BroadcastPanel.tsx). Não tem botão de largada, de "Encerrar
// bateria" nem de "Reabrir" (D45): a largada é só do gesto do gestor na seção Ondas
// da aba Súmula Fitness Race, e o telão apenas lê o que a súmula registrou.

const REFRESH_MS = 5_000;

type Control = {
  link: { active: boolean; createdAt: string | null };
  mode: BroadcastMode;
  pinnedHeatId: string | null;
  pinnedDivisionId: string | null;
  heats: { id: string; label: string }[];
  divisions: { id: string; name: string }[];
  preview: RaceBroadcastPayload;
};

const smallButton = 'inline-flex min-h-10 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50';
const selectClass = 'w-full min-h-10 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none';

const formatWhen = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const control = async (body: Record<string, unknown>) => {
  const response = await fetch('/api/telao/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
};

/** Os quatro modos, cada um com o seu texto; o do Automático descreve a regra de escolha de tela do telão. */
const MODE_OPTIONS: { value: BroadcastMode; title: string; text: string }[] = [
  {
    value: 'auto',
    title: 'Automático',
    text: 'Ao vivo enquanto há onda na pista: o ranking da prova, uma torre por categoria com todas as ondas que já largaram. Entre as ondas, o grid da próxima; com resultado publicado, a classificação alternando com o grid. A espera só aparece sem próxima onda e sem resultado.'
  },
  { value: 'pin_heat', title: 'Fixar uma onda', text: 'Só a onda escolhida: o grid antes da largada e, depois, a torre só dela, com o relógio da onda, até você voltar ao automático.' },
  { value: 'pin_standings', title: 'Fixar uma categoria', text: 'O ranking ao vivo da categoria escolhida enquanto alguém dela está na pista; depois, a classificação dela. Fica até você voltar ao automático.' },
  { value: 'standby', title: 'Espera', text: 'A marca do evento e as próximas ondas do cronograma.' }
];

export function RaceBroadcastPanel({ event }: { event: Event }) {
  const [state, setState] = useState<Control | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [freshLink, setFreshLink] = useState('');
  const [heatChoice, setHeatChoice] = useState('');
  const [divisionChoice, setDivisionChoice] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`/api/telao/control?eventId=${encodeURIComponent(event.id)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar o telão.');
    setState(data as Control);
  }, [event.id]);

  useEffect(() => {
    const refresh = () => void load().catch((error) => setNotice(error instanceof Error ? error.message : 'Erro ao carregar o telão.'));
    const first = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  const run = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true);
    try {
      const data = await control({ eventId: event.id, ...body });
      if (body.action === 'generate_link') {
        setFreshLink(`${window.location.origin}/pt-br/telao/${data.token}`);
        await load();
      } else {
        setState(data as Control);
      }
      setNotice(done ?? '');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(freshLink);
      setNotice('Link copiado. Abra no navegador da TV.');
    } catch {
      setNotice('Não foi possível copiar. Selecione o link e copie.');
    }
  };

  const preview = state ? describeRacePanelPreview(state.preview) : null;
  const selectedHeat = heatChoice || state?.pinnedHeatId || state?.heats[0]?.id || '';
  const selectedDivision = divisionChoice || state?.pinnedDivisionId || state?.divisions[0]?.id || '';

  return (
    <div className="space-y-6 text-white">
      {notice && <p role="status" aria-live="polite" className="rounded-md border border-card-border bg-dark-gray/40 px-3 py-2 text-xs text-white">{notice}</p>}

      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="race-broadcast-link-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Telão ao vivo</p>
            <h3 id="race-broadcast-link-title" className="mt-1 text-lg font-bold uppercase">Link da TV</h3>
          </div>
          <p className="text-[11px] text-muted">O link abre o placar sem login. Gere um novo para desativar o anterior.</p>
        </div>
        {state === null ? (
          <p className="text-sm text-muted" role="status">Carregando…</p>
        ) : (
          <>
            {freshLink ? (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <label htmlFor="race-broadcast-link" className="block text-[10px] font-bold uppercase tracking-wider text-primary">Copie agora: por segurança, o link completo não fica salvo</label>
                <input id="race-broadcast-link" readOnly value={freshLink} onFocus={(focusEvent) => focusEvent.currentTarget.select()} className={`${selectClass} font-number`} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copyLink()} className={smallButton}><Copy className="h-3.5 w-3.5" aria-hidden="true" />Copiar link</button>
                  <a href={freshLink} target="_blank" rel="noreferrer" className={smallButton}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />Abrir o telão</a>
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <Link2 className="h-4 w-4 text-muted" aria-hidden="true" />
                {state.link.active ? `Link ativo, gerado em ${formatWhen(state.link.createdAt)}.` : 'Nenhum link ativo.'}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void run({ action: 'generate_link' }, state.link.active ? 'Link novo gerado. O anterior parou de funcionar.' : 'Link gerado.')} className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50">
                <Tv className="h-4 w-4" aria-hidden="true" />{state.link.active ? 'Gerar novo link' : 'Gerar link'}
              </button>
              {state.link.active && (
                <button type="button" disabled={busy} onClick={() => { setFreshLink(''); void run({ action: 'revoke_link' }, 'Link revogado. O telão mostra que o link foi desativado.'); }} className={`${smallButton} text-trading-down`}>Revogar</button>
              )}
            </div>
          </>
        )}
      </section>

      {state && preview && (
        <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="race-broadcast-mode-title">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">No ar agora</p>
              <h3 id="race-broadcast-mode-title" className="mt-1 text-lg font-bold uppercase">
                {preview.screenLabel}
                {preview.context ? <span className="ml-2 text-sm font-semibold normal-case text-muted">{preview.context}</span> : null}
              </h3>
            </div>
            <p className="text-[11px] text-muted">Atualiza a cada 5 s.</p>
          </div>

          <p className="rounded-lg border border-card-border bg-dark-gray/30 px-3 py-2 text-xs text-muted">
            A largada é feita na seção Ondas da aba Súmula Fitness Race. O telão só mostra o que as súmulas registram.
          </p>

          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">O que o telão mostra</legend>
            {MODE_OPTIONS.map((option) => (
              <label key={option.value} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 ${state.mode === option.value ? 'border-primary/60 bg-primary/5' : 'border-card-border bg-dark-gray/30 hover:border-primary/40'}`}>
                <input
                  type="radio"
                  name={`race-broadcast-mode-${event.id}`}
                  value={option.value}
                  checked={state.mode === option.value}
                  disabled={busy || (option.value === 'pin_heat' && state.heats.length === 0) || (option.value === 'pin_standings' && state.divisions.length === 0)}
                  onChange={() => void run({ action: 'set_mode', mode: option.value, heatId: selectedHeat, divisionId: selectedDivision })}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block text-sm font-bold">{option.title}</span>
                  <span className="block text-xs text-muted">{option.text}</span>
                  {option.value === 'pin_heat' && state.heats.length > 0 && (
                    <select aria-label="Onda fixada" value={selectedHeat} disabled={busy} onChange={(changeEvent) => { setHeatChoice(changeEvent.target.value); if (state.mode === 'pin_heat') void run({ action: 'set_mode', mode: 'pin_heat', heatId: changeEvent.target.value }); }} className={selectClass}>
                      {state.heats.map((heat) => <option key={heat.id} value={heat.id}>{heat.label}</option>)}
                    </select>
                  )}
                  {option.value === 'pin_standings' && state.divisions.length > 0 && (
                    <select aria-label="Categoria fixada" value={selectedDivision} disabled={busy} onChange={(changeEvent) => { setDivisionChoice(changeEvent.target.value); if (state.mode === 'pin_standings') void run({ action: 'set_mode', mode: 'pin_standings', divisionId: changeEvent.target.value }); }} className={selectClass}>
                      {state.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
                    </select>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          {preview.rows.length > 0 && (
            <div className="space-y-2 border-t border-card-border pt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Torre no telão</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {preview.rows.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-2 rounded-md border border-card-border bg-dark-gray/30 px-3 py-2 text-xs">
                    <span className="min-w-0 truncate"><span className="mr-2 font-number text-muted">{row.position}</span>{row.name}</span>
                    <span className="max-w-[55%] shrink-0 truncate text-muted">{row.where}</span>
                  </li>
                ))}
              </ul>
              {preview.hiddenCount > 0 && <p className="text-[11px] text-muted">+{preview.hiddenCount} {preview.hiddenCount === 1 ? 'atleta' : 'atletas'} na torre.</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
