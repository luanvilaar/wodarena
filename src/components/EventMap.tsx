'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

import type { EventMapViewLabels } from '@/components/EventMapView';
import type { EventCoordinates } from '@/lib/eventMap';
import { getMapboxPublicToken } from '@/lib/mapboxPublicToken';

// Mapa do local do evento (Story 1.42), usado no card público e na prévia do
// painel do gestor. O Mapbox GL JS só é baixado quando o bloco chega perto da
// área visível, e só com ponto válido e token; sem token, ou se o mapa falhar
// (sem WebGL, token recusado), o bloco some e o card segue só com os botões.
// Os textos chegam por props: a página pública traduz pelo i18n e o painel usa
// português fixo.

const EventMapView = dynamic(
  () => import('@/components/EventMapView').then((module) => module.EventMapView),
  { ssr: false }
);

// Começa a carregar um pouco antes de o bloco aparecer na tela.
const NEAR_VIEWPORT_MARGIN = '200px';

type EventMapProps = {
  coordinates: EventCoordinates;
  labels: EventMapViewLabels;
  className?: string;
};

export function EventMap({ coordinates, labels, className = '' }: EventMapProps) {
  const token = getMapboxPublicToken();
  const frameRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Navegador sem IntersectionObserver: carrega logo, fora do corpo do efeito.
      const timer = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: NEAR_VIEWPORT_MARGIN });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [near]);

  if (!token || unavailable) return null;

  return (
    <div
      ref={frameRef}
      data-event-map
      role="region"
      aria-label={labels.mapLabel}
      className={['relative h-64 w-full overflow-hidden rounded-lg border border-card-border bg-dark-gray sm:h-80', className].filter(Boolean).join(' ')}
    >
      {near && (
        <EventMapView
          coordinates={coordinates}
          token={token}
          labels={labels}
          onUnavailable={() => setUnavailable(true)}
        />
      )}
    </div>
  );
}
