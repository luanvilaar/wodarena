'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

import { sponsorPages, sponsorsRotate } from '@/lib/eventMediaFields';

// Patrocinadores na página do evento (Story 1.152, docs/design/regulamento-patrocinadores/,
// D6 e D7): logos num cartão claro; com mais de duas marcas, carrossel de duas
// por vez que troca a cada 5 s, para quando o atleta toca, passa o mouse ou
// navega pelo teclado, e tem setas, pontos e pausa (WCAG 2.2.2). Com até duas
// marcas fica parado; quem pede menos movimento no aparelho não vê a troca
// automática. Páginas fora de vista ficam inertes (sem foco nem leitor de tela).

export type CarouselSponsor = { name: string; logoUrl: string; link: string };

type SponsorCarouselProps = {
  heading: string;
  sponsors: CarouselSponsor[];
  labels: {
    carousel: string;
    slide: string;
    previous: string;
    next: string;
    pause: string;
    play: string;
    goTo: (page: number) => string;
    page: (page: number, total: number) => string;
    opensNewTab: (name: string) => string;
  };
};

const ROTATE_MS = 5000;
const SWIPE_PX = 40;

function SponsorTile({ sponsor, label }: { sponsor: CarouselSponsor; label: (name: string) => string }) {
  const tileClass = 'flex h-20 items-center justify-center rounded-lg border border-sponsor-tile-border bg-sponsor-tile px-4 py-3';
  const logo = (
    <Image
      src={sponsor.logoUrl}
      alt={sponsor.link ? '' : sponsor.name}
      width={240}
      height={112}
      unoptimized
      className="h-full max-h-14 w-full object-contain"
    />
  );
  if (!sponsor.link) return <div className={tileClass}>{logo}</div>;
  return (
    <a
      href={sponsor.link}
      target="_blank"
      rel="sponsored noopener noreferrer"
      aria-label={label(sponsor.name)}
      className={`${tileClass} transition-shadow hover:shadow-[0_4px_14px_rgba(0,0,0,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
    >
      {logo}
    </a>
  );
}

export function SponsorCarousel({ heading, sponsors, labels }: SponsorCarouselProps) {
  const pages = sponsorPages(sponsors);
  const rotates = sponsorsRotate(sponsors.length);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStart = useRef<number | null>(null);
  const current = pages.length > 0 ? Math.min(page, pages.length - 1) : 0;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    const first = window.setTimeout(sync, 0);
    query.addEventListener('change', sync);
    return () => {
      window.clearTimeout(first);
      query.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (!rotates || paused || holding || reducedMotion) return;
    const timer = window.setTimeout(() => setPage((value) => (value + 1) % pages.length), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [rotates, paused, holding, reducedMotion, current, pages.length]);

  if (sponsors.length === 0) return null;

  const go = (next: number) => setPage(((next % pages.length) + pages.length) % pages.length);
  const onTouchStart = (event: TouchEvent) => {
    touchStart.current = event.touches[0]?.clientX ?? null;
    setHolding(true);
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current;
    const end = event.changedTouches[0]?.clientX;
    touchStart.current = null;
    setHolding(false);
    if (start === null || end === undefined || Math.abs(end - start) < SWIPE_PX) return;
    go(end < start ? current + 1 : current - 1);
  };
  const autoplayOn = !paused && !reducedMotion;

  return (
    <div className="space-y-4 rounded-xl border border-card-border bg-card p-6">
      <h4 id="event-sponsors-heading" className="border-b border-card-border pb-3 text-center text-xs font-bold uppercase tracking-widest text-white">
        {heading}
      </h4>

      {!rotates ? (
        <div className={`grid gap-3 ${pages[0].length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {pages[0].map((sponsor) => <SponsorTile key={`${sponsor.logoUrl}-${sponsor.name}`} sponsor={sponsor} label={labels.opensNewTab} />)}
        </div>
      ) : (
        <div
          role="region"
          aria-roledescription={labels.carousel}
          aria-labelledby="event-sponsors-heading"
          className="space-y-3"
          onMouseEnter={() => setHolding(true)}
          onMouseLeave={() => setHolding(false)}
          onFocus={() => setHolding(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHolding(false);
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="overflow-hidden rounded-lg">
            <div
              className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
              style={{ transform: `translateX(-${current * 100}%)` }}
            >
              {pages.map((items, index) => (
                <div
                  key={index}
                  role="group"
                  aria-roledescription={labels.slide}
                  aria-label={labels.page(index + 1, pages.length)}
                  aria-hidden={index !== current}
                  inert={index !== current}
                  className={`grid shrink-0 basis-full gap-3 ${items.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
                >
                  {items.map((sponsor) => <SponsorTile key={`${sponsor.logoUrl}-${sponsor.name}`} sponsor={sponsor} label={labels.opensNewTab} />)}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-0.5">
              {pages.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => go(index)}
                  aria-label={labels.goTo(index + 1)}
                  aria-current={index === current}
                  className="flex h-8 w-8 items-center justify-center"
                >
                  <span className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${index === current ? 'w-5 bg-primary' : 'w-2 bg-card-border'}`} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => setPaused((value) => !value)}
                disabled={reducedMotion}
                aria-label={autoplayOn ? labels.pause : labels.play}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary disabled:opacity-40"
              >
                {autoplayOn ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button type="button" onClick={() => go(current - 1)} aria-label={labels.previous} className="flex h-9 w-9 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => go(current + 1)} aria-label={labels.next} className="flex h-9 w-9 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
