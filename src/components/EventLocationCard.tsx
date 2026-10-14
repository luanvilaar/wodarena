'use client';

import { useState } from 'react';
import { Check, Copy, MapPin } from 'lucide-react';

import { EventMap } from '@/components/EventMap';
import type { EventMapViewLabels } from '@/components/EventMapView';
import {
  buildAppleMapsDirectionsUrl,
  buildGoogleMapsDirectionsUrl,
  buildMapSearchText,
  buildWazeDirectionsUrl,
  validateEventCoordinates
} from '@/lib/eventMap';

// Card "Local do evento" da aba Detalhes da página pública (Stories 1.41 e
// 1.42). Com ponto e token: mapa interativo do Mapbox e links de rota para o
// ponto. Sem ponto (ou sem mapa): só os links, que buscam pelo texto de Local
// + Cidade + Estado. Links externos abrem em nova aba; o Waze usa o link
// universal https://waze.com/ul, que abre o app quando instalado.

export type EventLocationCardLabels = EventMapViewLabels & {
  heading: string;
  directions: string;
  waze: string;
  googleMaps: string;
  appleMaps: string;
  copyAddress: string;
  copied: string;
};

type EventLocationCardProps = {
  location?: string;
  city?: string;
  state?: string;
  latitude?: number | null;
  longitude?: number | null;
  labels: EventLocationCardLabels;
};

const COPIED_FEEDBACK_MS = 2000;

const secondaryLinkClassName = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-card-border bg-dark-gray px-4 py-3 text-xs font-bold text-white transition-colors hover:border-primary';

export function EventLocationCard({ location, city, state, latitude, longitude, labels }: EventLocationCardProps) {
  const [copied, setCopied] = useState(false);

  const searchText = buildMapSearchText({ location, city, state });
  const point = validateEventCoordinates({ latitude: latitude ?? null, longitude: longitude ?? null });
  const coordinates = point.ok ? point.coordinates : null;
  if (!coordinates && !searchText) return null;

  const target = { coordinates, searchText };
  const wazeUrl = buildWazeDirectionsUrl(target);
  const googleMapsUrl = buildGoogleMapsDirectionsUrl(target);
  const appleMapsUrl = buildAppleMapsDirectionsUrl(target);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(searchText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Sem permissão para a área de transferência: o endereço segue visível no card.
    }
  };

  return (
    <section aria-labelledby="event-location-heading" className="space-y-4 rounded-xl border border-card-border bg-card p-6">
      <h3 id="event-location-heading" className="text-lg font-black text-white uppercase tracking-wider border-b border-card-border pb-3">
        {labels.heading}
      </h3>

      {searchText && (
        <p className="flex items-start gap-2 text-sm font-semibold text-white">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{searchText}</span>
        </p>
      )}

      {coordinates && <EventMap coordinates={coordinates} labels={labels} />}

      <div className="space-y-2 pt-1">
        <h4 className="text-xs font-bold text-primary uppercase tracking-wider">{labels.directions}</h4>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {wazeUrl && (
            <li className="sm:col-span-3">
              <a
                href={wazeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-primary bg-primary/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-primary/20"
              >
                <span>{labels.waze}</span>
              </a>
            </li>
          )}
          {googleMapsUrl && (
            <li>
              <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className={secondaryLinkClassName}>
                {labels.googleMaps}
              </a>
            </li>
          )}
          {appleMapsUrl && (
            <li>
              <a href={appleMapsUrl} target="_blank" rel="noopener noreferrer" className={secondaryLinkClassName}>
                {labels.appleMaps}
              </a>
            </li>
          )}
          {searchText && (
            <li>
              <button type="button" onClick={handleCopyAddress} className={secondaryLinkClassName}>
                {copied
                  ? <Check className="h-4 w-4 text-trading-up" aria-hidden="true" />
                  : <Copy className="h-4 w-4" aria-hidden="true" />}
                <span aria-live="polite">{copied ? labels.copied : labels.copyAddress}</span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
