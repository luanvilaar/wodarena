'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { useApp } from '@/context/AppContext';
import { RegisterModal } from '@/components/RegisterModal';
import { BrandLogo } from '@/components/BrandLogo';
import { ArrowRight, Lock } from 'lucide-react';
import { compareEventsByDateAsc, getEventStatus, getRegistrationAvailability } from '@/lib/eventStatus';
import { Event } from '@/types';

const MAX_EVENT_SLIDES = 4;
const AUTOPLAY_INTERVAL_MS = 6000;
const SWIPE_THRESHOLD_PX = 40;
const FALLBACK_SLIDE_IMAGE = '/hero-vertical-poster.jpg';

type CommercialSlide = { kind: 'commercial' };
type EventSlideData = { kind: 'event'; event: Event };
type BannerSlide = CommercialSlide | EventSlideData;

// Divide um texto no último termo para dar destaque em cor primária ao
// último termo, mesmo tratamento visual usado em todos os tipos de slide.
const splitLastWord = (text: string) => {
  const parts = text.trim().split(' ');
  return {
    main: parts.slice(0, -1).join(' '),
    highlight: parts.slice(-1).join('')
  };
};

export function FeaturedEventBanner({ openLeadModal }: { openLeadModal: () => void }) {
  const t = useTranslations('FeaturedEventBanner');
  const { events } = useApp();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [registeringEvent, setRegisteringEvent] = useState<Event | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Eventos elegíveis: ativos, não encerrados, em ordem cronológica — os
  // marcados como destaque pelo owner vêm primeiro, o resto completa a fila.
  const eligibleEvents = useMemo(() => events
    .filter((event) => (event.status === 'live' || event.status === 'upcoming') && getEventStatus(event) !== 'finished')
    .sort(compareEventsByDateAsc), [events]);

  const orderedEvents = useMemo(() => {
    const featured = eligibleEvents.filter((event) => event.isFeatured);
    const rest = eligibleEvents.filter((event) => !event.isFeatured);
    return [...featured, ...rest].slice(0, MAX_EVENT_SLIDES);
  }, [eligibleEvents]);

  // Slide comercial sempre vem primeiro, seguido pelos eventos elegíveis.
  const slides: BannerSlide[] = useMemo(() => [
    { kind: 'commercial' },
    ...orderedEvents.map((event) => ({ kind: 'event' as const, event }))
  ], [orderedEvents]);

  const safeIndex = activeIndex < slides.length ? activeIndex : 0;

  const goToSlide = (index: number) => {
    setActiveIndex(((index % slides.length) + slides.length) % slides.length);
  };
  const goNext = () => goToSlide(safeIndex + 1);
  const goPrev = () => goToSlide(safeIndex - 1);

  // Auto-avanço: pausa no hover/foco e respeita quem pediu menos animação.
  useEffect(() => {
    if (slides.length <= 1 || isPaused) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, AUTOPLAY_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [slides.length, isPaused]);

  const handleTouchStart = (event: React.TouchEvent) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (event: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const deltaX = (event.changedTouches[0]?.clientX ?? 0) - touchStartXRef.current;
    if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX) {
      if (deltaX > 0) goPrev(); else goNext();
    }
    touchStartXRef.current = null;
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); goNext(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); goPrev(); }
  };

  const commercialTitle = splitLastWord(t('organizeCardTitle'));

  return (
    <>
      <section
        className="home-broadcast-featured-backdrop relative h-[420px] w-full overflow-hidden border-b border-card-border bg-dark-gray sm:h-[500px] lg:h-[560px]"
        role="region"
        aria-roledescription="carousel"
        aria-label={t('carouselAriaLabel')}
        tabIndex={0}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocus={() => setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
      >
        {slides.map((slide, index) => {
          const isActive = index === safeIndex;
          const isEventSlide = slide.kind === 'event';
          const event = isEventSlide ? slide.event : null;
          const imageUrl = event?.bannerUrl || FALLBACK_SLIDE_IMAGE;
          const logoUrl = event?.logoUrl;
          const { main: titleMain, highlight: titleHighlight } = isEventSlide
            ? splitLastWord(event!.name)
            : commercialTitle;
          const registrationAvailability = event ? getRegistrationAvailability(event) : null;
          const registrationsAvailable = registrationAvailability?.isAvailable ?? false;

          return (
            <div
              key={isEventSlide ? event!.id : 'commercial'}
              aria-hidden={!isActive}
              className={`home-broadcast-featured-media absolute inset-0 transition-opacity duration-700 ease-out ${
                isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <Image
                src={imageUrl}
                alt=""
                fill
                unoptimized
                loading="lazy"
                sizes="100vw"
                className="object-cover"
              />
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `
                    linear-gradient(180deg,
                      rgba(11, 14, 17, 0.05) 0%,
                      rgba(11, 14, 17, 0.0) 32%,
                      rgba(11, 14, 17, 0.78) 68%,
                      rgba(11, 14, 17, 0.96) 100%
                    ),
                    linear-gradient(90deg,
                      rgba(11, 14, 17, 0.55) 0%,
                      rgba(11, 14, 17, 0.0) 55%
                    )
                  `
                }}
              />

              <div className="home-broadcast-featured-copy relative z-10 flex h-full max-w-7xl flex-col justify-end px-4 pb-14 sm:px-6 sm:pb-16 lg:px-8 mx-auto">
                <div className="max-w-xl space-y-5">
                  <h2 className="home-broadcast-featured-title text-3xl font-black uppercase leading-[0.95] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl text-balance">
                    {titleMain}{' '}
                    <span className="text-primary">{titleHighlight}</span>
                  </h2>

                  <div className="home-broadcast-actions flex flex-wrap items-center gap-3">
                    {!isEventSlide ? (
                      <button
                        type="button"
                        tabIndex={isActive ? 0 : -1}
                        onClick={openLeadModal}
                        aria-label={t('ctaUseWodarena')}
                        className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
                      >
                        {t('ctaUseWodarena')}
                      </button>
                    ) : registrationsAvailable ? (
                      <button
                        type="button"
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => setRegisteringEvent(event)}
                        aria-label={t('registerNowAria', { name: event!.name })}
                        className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
                      >
                        {t('registerNow')}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-dark-gray/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted backdrop-blur-md">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          {t('salesClosedBadge')}
                        </span>
                        <Link
                          href={`/event/${event!.id}`}
                          tabIndex={isActive ? 0 : -1}
                          className="inline-flex h-11 items-center gap-2 rounded-md border border-card-border bg-card/75 px-6 text-sm font-bold text-white backdrop-blur-md transition-colors hover:bg-elevated/75"
                        >
                          {t('viewFullEvent')}
                        </Link>
                      </>
                    )}
                  </div>

                  {slides.length > 1 && (
                    <div className="home-broadcast-panel flex items-center gap-1.5">
                      {slides.map((otherSlide, otherIndex) => (
                        <button
                          key={otherSlide.kind === 'event' ? otherSlide.event.id : 'commercial'}
                          type="button"
                          tabIndex={isActive ? 0 : -1}
                          onClick={() => goToSlide(otherIndex)}
                          aria-label={t('slideAriaLabel', { index: otherIndex + 1, total: slides.length })}
                          aria-current={otherIndex === safeIndex}
                          className={`h-1 rounded-full transition-all duration-300 ${
                            otherIndex === safeIndex ? 'w-8 bg-primary' : 'w-4 bg-white/30 hover:bg-white/50'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Selo circular: logo do evento, com fallback para a marca WODArena */}
              <div className="absolute bottom-5 right-4 z-10 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-card-border bg-[#0b0e11]/85 backdrop-blur-md sm:bottom-6 sm:right-6 sm:h-16 sm:w-16">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt=""
                    width={64}
                    height={64}
                    unoptimized
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <BrandLogo variant="mark" className="h-8 w-8 sm:h-9 sm:w-9" />
                )}
              </div>
            </div>
          );
        })}
      </section>

      {registeringEvent && (
        <RegisterModal
          event={registeringEvent}
          isOpen
          onClose={() => setRegisteringEvent(null)}
        />
      )}
    </>
  );
}
