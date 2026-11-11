'use client';

import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ShieldAlert, Star } from 'lucide-react';
import type { Event } from '@/types';
import { compareEventsByDateAsc } from '@/lib/eventStatus';
import { findFeaturedHomeEventOffAir, isFeaturedHomeCandidate } from '@/lib/homeShowcase';

// Vitrine da home na seção Configurações do painel do proprietário (Story 1.126;
// mesma regra e mesmo controle da Story 1.24, só mudaram de lugar). O componente
// desmonta ao sair da seção: rascunho não salvo não sobrevive.

const listFeaturedHomeCandidates = (events: Event[]) => events.filter(isFeaturedHomeCandidate).sort(compareEventsByDateAsc);

/** Destaque salvo que saiu da home (encerrou ou deixou de ser candidato). */
export const isFeaturedHomeEventOffAir = (events: Event[]) => findFeaturedHomeEventOffAir(events) !== null;

type Props = {
  events: Event[];
  setFeaturedHomeEvent: (eventId: string | null) => Promise<void>;
  onSaved: () => void;
};

export function OwnerHomeShowcase({ events, setFeaturedHomeEvent, onSaved }: Props) {
  const [featuredHomeDraftId, setFeaturedHomeDraftId] = useState<string | null>(null);
  const [featuredHomeNotice, setFeaturedHomeNotice] = useState({ text: '', isError: false });
  const [savingFeaturedHomeEvent, setSavingFeaturedHomeEvent] = useState(false);
  const featuredHomeNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const featuredHomeEvent = useMemo(() => (
    events.find(event => event.isFeatured)
  ), [events]);

  const featuredHomeCandidates = useMemo(() => listFeaturedHomeCandidates(events), [events]);

  const selectableFeaturedHomeEventId = useMemo(() => {
    const currentFeaturedId = featuredHomeEvent?.id || '';
    return featuredHomeCandidates.some(event => event.id === currentFeaturedId) ? currentFeaturedId : '';
  }, [featuredHomeEvent?.id, featuredHomeCandidates]);

  // O rascunho só vale enquanto aponta para algo que o select realmente
  // oferece (seleção automática ou candidato ativo). Se o evento escolhido sai
  // da lista — encerrou com a aba aberta, por exemplo — o controle volta ao
  // estado publicado em vez de guardar um valor fantasma que trava o botão.
  const featuredHomeDraftIsSelectable = featuredHomeDraftId !== null && (
    featuredHomeDraftId === ''
    || featuredHomeCandidates.some(event => event.id === featuredHomeDraftId)
  );
  const selectedFeaturedHomeDraftId = featuredHomeDraftIsSelectable
    ? (featuredHomeDraftId as string)
    : selectableFeaturedHomeEventId;

  // Destaque salvo que já encerrou continua no banco, mas sai da home — o
  // painel precisa avisar em vez de apenas exibir o nome como "atual".
  const featuredHomeEventIsOffAir = Boolean(featuredHomeEvent)
    && !featuredHomeCandidates.some(event => event.id === featuredHomeEvent?.id);

  const featuredHomeHasPendingChange = selectedFeaturedHomeDraftId !== (featuredHomeEvent?.id || '');

  // Ordem real da lista de eventos da home (Story 1.132): o destaque abre a
  // lista no grupo "Em destaque" e os demais seguem por data, como em
  // HomeView, aplicada à seleção em tela para o owner ver o efeito antes de salvar.
  const homeEventOrder = useMemo(() => {
    const featured = featuredHomeCandidates.filter(event => event.id === selectedFeaturedHomeDraftId);
    const rest = featuredHomeCandidates.filter(event => event.id !== selectedFeaturedHomeDraftId);
    return [...featured, ...rest];
  }, [featuredHomeCandidates, selectedFeaturedHomeDraftId]);

  const handleSaveFeaturedHomeEvent = async () => {
    const targetEventId = selectedFeaturedHomeDraftId;
    setSavingFeaturedHomeEvent(true);
    setFeaturedHomeNotice({ text: '', isError: false });

    try {
      await setFeaturedHomeEvent(targetEventId || null);
      const eventName = featuredHomeCandidates.find(event => event.id === targetEventId)?.name;
      // Rascunho cumprido: o controle volta a seguir o estado publicado.
      setFeaturedHomeDraftId(null);
      onSaved();
      setFeaturedHomeNotice({
        text: eventName ? `Destaque da home atualizado para ${eventName}.` : 'A home ficou sem destaque: os eventos seguem por data.',
        isError: false
      });
    } catch (err) {
      setFeaturedHomeNotice({
        text: err instanceof Error ? err.message : 'Não foi possível atualizar o destaque da home.',
        isError: true
      });
    } finally {
      setSavingFeaturedHomeEvent(false);
      // Um save novo cancela o timer do anterior, senão a mensagem recém-exibida
      // é apagada pelo temporizador de uma tentativa antiga.
      if (featuredHomeNoticeTimerRef.current) clearTimeout(featuredHomeNoticeTimerRef.current);
      featuredHomeNoticeTimerRef.current = setTimeout(() => {
        featuredHomeNoticeTimerRef.current = null;
        setFeaturedHomeNotice({ text: '', isError: false });
      }, 5000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-xl border border-card-border bg-card p-4 sm:p-6">
        <h3 className="text-lg font-bold text-white uppercase tracking-wider border-b border-card-border pb-3">
          Vitrine da home
        </h3>

        <p className="max-w-2xl text-xs leading-5 text-muted">
          Selecione qual evento ativo abre a lista de eventos da home, no grupo Em destaque. Os demais eventos ativos seguem por ordem de data. Eventos encerrados ficam fora da lista de candidatos.
        </p>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-soft">
              Atual: <span className="font-bold text-white">{featuredHomeEvent?.name || 'Sem destaque'}</span>
            </p>
            {featuredHomeEventIsOffAir && (
              <p role="status" className="flex items-start gap-1.5 text-[11px] font-bold text-amber-300">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Este evento encerrou e não aparece mais na home. Escolha outro destaque ou salve sem destaque.</span>
              </p>
            )}
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
              <option value="">Sem destaque</option>
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
          <p role={featuredHomeNotice.isError ? 'alert' : 'status'} aria-live="polite" className={`text-xs font-bold uppercase ${featuredHomeNotice.isError ? 'text-red-400' : 'text-primary'}`}>
            {featuredHomeNotice.text}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-card-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-card-border pb-3">
          <h3 className="text-lg font-bold text-white uppercase tracking-wider">
            Ordem na home
          </h3>
          <span className="text-[11px] text-muted-soft">
            {homeEventOrder.length} {homeEventOrder.length === 1 ? 'evento ativo' : 'eventos ativos'}
          </span>
        </div>

        {featuredHomeHasPendingChange && (
          <p role="status" className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-primary">
            <Star className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Pré-visualização da alteração pendente. Clique em salvar destaque para publicar na home.</span>
          </p>
        )}

        <p className="text-[11px] text-muted-soft">
          Clique em um evento para escolhê-lo como destaque. Os demais seguem a ordem de data.
        </p>

        <ol className="space-y-2">
          {homeEventOrder.map((event, index) => {
            const isFeatured = event.id === selectedFeaturedHomeDraftId;
            return (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => setFeaturedHomeDraftId(event.id)}
                  aria-pressed={isFeatured}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    isFeatured
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-card-border bg-dark-gray/30 hover:border-primary/30 hover:bg-dark-gray/60'
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-card-border bg-dark-gray text-[11px] font-bold text-muted">
                    {index + 1}
                  </span>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-card-border bg-dark-gray p-0.5">
                    {event.logoUrl ? (
                      <Image src={event.logoUrl} alt="" width={32} height={32} unoptimized className="h-full w-full rounded object-cover" />
                    ) : (
                      <span className="text-[10px] font-black uppercase text-primary">{event.name.substring(0, 2)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold uppercase text-white">{event.name}</p>
                    <p className="text-[11px] text-muted-soft">{event.date}</p>
                  </div>
                  {isFeatured && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                      <Star className="h-3 w-3" aria-hidden="true" />
                      Destaque
                    </span>
                  )}
                </button>
              </li>
            );
          })}

          {homeEventOrder.length === 0 && (
            <li className="rounded-xl border border-dashed border-card-border p-4 text-xs text-muted-soft">
              Nenhum evento ativo disponível. A home mostra só os eventos realizados.
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
