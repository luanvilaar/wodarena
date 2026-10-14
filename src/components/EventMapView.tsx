'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { EVENT_MAP_ZOOM, type EventCoordinates } from '@/lib/eventMap';

// Mapa interativo do Mapbox (Story 1.42) com o pino do local do evento. Este
// módulo importa o Mapbox GL JS, então só é carregado no navegador, sob
// demanda, por EventMap (next/dynamic com ssr: false). O logo e a atribuição
// do Mapbox e do OpenStreetMap ficam como o Mapbox os desenha.

export type EventMapViewLabels = {
  /** Nome acessível da região do mapa. */
  mapLabel: string;
  /** Nome acessível do marcador do local. */
  markerLabel: string;
  /** Aviso ao rolar a página sobre o mapa com o mouse (Windows e Linux). */
  scrollZoomCtrl: string;
  /** Aviso ao rolar a página sobre o mapa com o mouse (macOS). */
  scrollZoomCmd: string;
  /** Aviso ao arrastar o mapa com um dedo no celular. */
  touchPan: string;
};

type EventMapViewProps = {
  coordinates: EventCoordinates;
  token: string;
  labels: EventMapViewLabels;
  /** Chamado quando o mapa não pode ser exibido (sem WebGL, token recusado). */
  onUnavailable: () => void;
};

const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';
const MARKER_COLOR = '#fcd535';

export function EventMapView({ coordinates, token, labels, onUnavailable }: EventMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // O mapa é criado uma vez por token; ponto, textos e callback mais recentes
  // chegam por aqui sem recriar o mapa.
  const latest = useRef({ coordinates, labels, onUnavailable });
  useEffect(() => {
    latest.current = { coordinates, labels, onUnavailable };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { coordinates: point, labels: text } = latest.current;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        accessToken: token,
        container,
        style: MAP_STYLE,
        center: [point.longitude, point.latitude],
        zoom: EVENT_MAP_ZOOM,
        // Dois dedos no celular e Ctrl ou ⌘ com a rolagem no desktop: o mapa
        // não prende a rolagem da página.
        cooperativeGestures: true,
        locale: {
          'ScrollZoomBlocker.CtrlMessage': text.scrollZoomCtrl,
          'ScrollZoomBlocker.CmdMessage': text.scrollZoomCmd,
          'TouchPanBlocker.Message': text.touchPan
        }
      });
    } catch {
      // Sem WebGL ou navegador sem suporte: o card segue só com os botões.
      latest.current.onUnavailable();
      return;
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    const marker = new mapboxgl.Marker({ color: MARKER_COLOR })
      .setLngLat([point.longitude, point.latitude])
      .addTo(map);
    marker.getElement().setAttribute('aria-label', text.markerLabel);

    map.on('error', (event) => {
      const status = (event.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) latest.current.onUnavailable();
    });

    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      marker.remove();
      map.remove();
      // O Mapbox deixa os avisos dos gestos cooperativos no contêiner; sem limpar,
      // uma nova montagem (React em modo estrito, troca de token) avisa e duplica.
      container.replaceChildren();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [token]);

  // Prévia do admin: trocar o ponto move o marcador e o mapa, sem recriá-lo.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([coordinates.longitude, coordinates.latitude]);
    map.jumpTo({ center: [coordinates.longitude, coordinates.latitude] });
  }, [coordinates.latitude, coordinates.longitude]);

  return <div ref={containerRef} className="h-full w-full" />;
}
