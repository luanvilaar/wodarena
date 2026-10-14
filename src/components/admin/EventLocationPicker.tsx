'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';

import { EventMap } from '@/components/EventMap';
import type { EventMapViewLabels } from '@/components/EventMapView';
import {
  buildMapSearchText,
  formatCoordinates,
  parseCoordinatesInput,
  validateEventCoordinates,
  type EventCoordinates
} from '@/lib/eventMap';

// Ponto do local no mapa (Stories 1.41 e 1.42), nos formulários de criação e de
// edição do evento. O gestor cola as coordenadas do Google Maps ou escolhe um
// resultado de "Buscar pelo endereço"; a prévia do mapa do Mapbox mostra o
// ponto antes de salvar. A busca só sugere: nada é gravado até o gestor salvar o
// evento. Links de mapa não são aceitos (o servidor nunca os resolve).

type GeocodeCandidate = EventCoordinates & { label: string };

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'results'; candidates: GeocodeCandidate[] }
  | { status: 'error'; message: string };

const IDLE_SEARCH: SearchState = { status: 'idle' };

type EventLocationPickerProps = {
  /** Prefixo dos ids, para o campo aparecer em mais de um formulário. */
  idPrefix: string;
  /** Texto do campo "Coordenadas (lat, lng)"; vazio = sem ponto. */
  value: string;
  onChange: (value: string) => void;
  /** Local, Cidade e Estado do formulário, usados em "Buscar pelo endereço". */
  location: string;
  city?: string;
  state?: string;
  /** País do evento (BR, PT ou GB): limita "Buscar pelo endereço" a ele. */
  country?: string;
  inputRef?: React.Ref<HTMLInputElement>;
};

const MAX_CANDIDATES = 5;
// A prévia espera o gestor parar de digitar, para o mapa não pular a cada tecla.
const PREVIEW_DEBOUNCE_MS = 600;

// O painel usa português fixo (não passa pelo next-intl).
const PREVIEW_LABELS: EventMapViewLabels = {
  mapLabel: 'Prévia do mapa com o ponto do evento',
  markerLabel: 'Ponto do evento',
  scrollZoomCtrl: 'Use Ctrl + rolagem para ampliar o mapa',
  scrollZoomCmd: 'Use ⌘ + rolagem para ampliar o mapa',
  touchPan: 'Use dois dedos para mover o mapa'
};

const SEARCH_MESSAGES = {
  unavailable: 'Busca por endereço indisponível; cole as coordenadas.',
  rateLimited: 'Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo, ou cole as coordenadas.',
  providerFailure: 'Não foi possível consultar o endereço agora. Tente de novo em instantes ou cole as coordenadas.',
  empty: 'Nenhum resultado; ajuste o endereço ou cole as coordenadas.',
  network: 'Falha de conexão ao buscar o endereço. Verifique a internet e tente de novo, ou cole as coordenadas.',
  generic: 'Não foi possível buscar o endereço. Tente de novo ou cole as coordenadas.'
} as const;

/** Valor do campo a partir do ponto salvo; sem ponto válido, campo vazio. */
export const toCoordinatesInput = (latitude?: number | null, longitude?: number | null) => {
  if (latitude == null || longitude == null) return '';
  const result = validateEventCoordinates({ latitude, longitude });
  return result.ok && result.coordinates ? formatCoordinates(result.coordinates.latitude, result.coordinates.longitude) : '';
};

// Só rótulo e coordenadas validadas entram no estado; nada da resposta crua.
const readCandidates = (data: unknown): GeocodeCandidate[] => {
  const list = data && typeof data === 'object' && Array.isArray((data as { candidates?: unknown }).candidates)
    ? (data as { candidates: unknown[] }).candidates
    : [];
  const candidates: GeocodeCandidate[] = [];
  for (const item of list) {
    if (candidates.length >= MAX_CANDIDATES) break;
    if (!item || typeof item !== 'object') continue;
    const { label, latitude, longitude } = item as Record<string, unknown>;
    const point = validateEventCoordinates({ latitude, longitude });
    if (typeof label !== 'string' || !label.trim() || !point.ok || !point.coordinates) continue;
    candidates.push({ label: label.trim(), ...point.coordinates });
  }
  return candidates;
};

const searchErrorMessage = (status: number, data: unknown) => {
  if (status === 503) return SEARCH_MESSAGES.unavailable;
  if (status === 429) return SEARCH_MESSAGES.rateLimited;
  if (status === 502) return SEARCH_MESSAGES.providerFailure;
  const serverMessage = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  return typeof serverMessage === 'string' && serverMessage ? serverMessage : SEARCH_MESSAGES.generic;
};

export function EventLocationPicker({ idPrefix, value, onChange, location, city, state, country, inputRef }: EventLocationPickerProps) {
  const inputId = `${idPrefix}-coordinates`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const titleId = `${inputId}-title`;
  const resultsTitleId = `${inputId}-results-title`;

  const parsed = parseCoordinatesInput(value);
  const inputError = parsed.ok ? '' : parsed.error;
  // Chave estável do ponto digitado: '' sem ponto, null enquanto o texto é inválido.
  const pointKey = parsed.ok
    ? (parsed.coordinates ? formatCoordinates(parsed.coordinates.latitude, parsed.coordinates.longitude) : '')
    : null;

  const [previewKey, setPreviewKey] = useState(pointKey ?? '');
  useEffect(() => {
    // Texto inválido mantém a última prévia válida, sem mexer no mapa.
    if (pointKey === null) return;
    const timer = window.setTimeout(() => setPreviewKey(pointKey), pointKey ? PREVIEW_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [pointKey]);
  const preview = previewKey ? parseCoordinatesInput(previewKey) : null;
  const previewCoordinates = preview && preview.ok ? preview.coordinates : null;

  const [searchEntry, setSearchEntry] = useState<{ signature: string; current: SearchState }>({ signature: '', current: IDLE_SEARCH });
  const searchRequestRef = useRef(0);
  const query = buildMapSearchText({ location, city, state });
  // O resultado vale para o endereço e o país da consulta: se qualquer um mudar, a tela volta ao
  // estado inicial e uma resposta que chegar depois fica oculta (o setSearch de cada pedido leva a
  // assinatura de quando ele foi feito).
  const searchSignature = JSON.stringify([query, country ?? '']);
  const search: SearchState = searchEntry.signature === searchSignature ? searchEntry.current : IDLE_SEARCH;
  const setSearch = (next: SearchState) => setSearchEntry({ signature: searchSignature, current: next });
  const hasLocation = Boolean(location.trim());
  const isSearching = search.status === 'loading';

  const handleSearch = async () => {
    if (!query || isSearching) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearch({ status: 'loading' });

    try {
      const response = await fetch('/api/admin/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(country ? { query, country } : { query })
      });
      const data: unknown = await response.json().catch(() => null);
      if (requestId !== searchRequestRef.current) return;

      if (!response.ok) {
        setSearch({ status: 'error', message: searchErrorMessage(response.status, data) });
        return;
      }
      const candidates = readCandidates(data);
      setSearch(candidates.length > 0
        ? { status: 'results', candidates }
        : { status: 'error', message: SEARCH_MESSAGES.empty });
    } catch {
      if (requestId !== searchRequestRef.current) return;
      setSearch({ status: 'error', message: SEARCH_MESSAGES.network });
    }
  };

  const handlePickCandidate = (candidate: GeocodeCandidate) => {
    onChange(formatCoordinates(candidate.latitude, candidate.longitude));
    setSearch({ status: 'idle' });
  };

  const handleRemovePoint = () => {
    searchRequestRef.current += 1;
    onChange('');
    setSearch({ status: 'idle' });
  };

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border border-card-border bg-dark-gray/25 p-4">
      <div>
        <h4 id={titleId} className="flex items-center gap-1.5 text-sm font-bold text-white">
          <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
          Ponto do local no mapa
        </h4>
        <p className="mt-0.5 text-xs text-muted">O ponto aparece publicamente na página do evento.</p>
      </div>

      <div>
        <label htmlFor={inputId} className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
          Coordenadas (lat, lng)
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Ex: -7.1195, -34.8450"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(inputError)}
          aria-describedby={inputError ? `${errorId} ${hintId}` : hintId}
          className={`w-full rounded-md border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:outline-none font-number ${
            inputError ? 'border-trading-down focus:border-trading-down' : 'border-card-border focus:border-primary/50'
          }`}
        />
        {inputError && (
          <p id={errorId} className="mt-1 text-xs font-semibold text-trading-down">{inputError}</p>
        )}
        <p id={hintId} className="mt-1 text-xs leading-5 text-muted">
          No Google Maps, clique com o botão direito no local e copie as coordenadas. Campo vazio deixa o evento sem ponto.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSearch}
          disabled={!hasLocation || isSearching}
          aria-busy={isSearching}
          className="flex min-h-10 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-4 py-2 text-xs font-bold text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSearching
            ? <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            : <Search className="h-4 w-4" aria-hidden="true" />}
          {isSearching ? 'Buscando...' : 'Buscar pelo endereço'}
        </button>
        {value.trim() && (
          <button
            type="button"
            onClick={handleRemovePoint}
            className="flex min-h-10 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-4 py-2 text-xs font-bold text-white transition-colors hover:border-trading-down"
          >
            <X className="h-4 w-4 text-trading-down" aria-hidden="true" />
            Remover ponto
          </button>
        )}
        {!hasLocation && (
          <p className="text-xs text-muted">Preencha o Local para buscar pelo endereço.</p>
        )}
      </div>

      <div aria-live="polite">
        {search.status === 'error' && (
          <p className="rounded-md border border-trading-down/40 bg-trading-down/10 p-3 text-xs font-semibold leading-5 text-white">
            {search.message}
          </p>
        )}
        {search.status === 'results' && (
          <div>
            <p id={resultsTitleId} className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
              Escolha o resultado que corresponde ao local
            </p>
            <ul aria-labelledby={resultsTitleId} className="space-y-2">
              {search.candidates.map((candidate) => {
                const coordinatesText = formatCoordinates(candidate.latitude, candidate.longitude);
                return (
                  <li key={`${candidate.label}-${coordinatesText}`}>
                    <button
                      type="button"
                      onClick={() => handlePickCandidate(candidate)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-left transition-colors hover:border-primary"
                    >
                      <span className="text-xs font-semibold text-white">{candidate.label}</span>
                      <span className="text-[11px] text-muted font-number">{coordinatesText}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[11px] leading-5 text-muted">A busca só sugere: confira o ponto na prévia antes de salvar o evento.</p>
          </div>
        )}
      </div>

      {previewCoordinates && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Prévia do mapa</p>
          <EventMap coordinates={previewCoordinates} labels={PREVIEW_LABELS} />
          {pointKey === null && (
            <p className="text-[11px] leading-5 text-muted">A prévia mostra o último ponto válido. Corrija o campo para atualizar.</p>
          )}
        </div>
      )}
    </section>
  );
}
