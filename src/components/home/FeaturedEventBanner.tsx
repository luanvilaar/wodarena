'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { useApp } from '@/context/AppContext';
import { RegisterModal } from '@/components/RegisterModal';
import { BrandLogo } from '@/components/BrandLogo';
import { ArrowRight, Calendar, ChevronLeft, ChevronRight, Lock, MapPin, Pause, Play } from 'lucide-react';
import { compareEventsByDateAsc, getEventStatus, getRegistrationAvailability } from '@/lib/eventStatus';
import { Event } from '@/types';

const MAX_EVENT_SLIDES = 4;
const AUTOPLAY_INTERVAL_MS = 6000;
const SWIPE_THRESHOLD_PX = 40;
const FALLBACK_SLIDE_IMAGE = '/hero-organize-banner.jpg';

const PRIMARY_CTA_CLASS =
  'inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover';
const SECONDARY_CTA_CLASS =
  'inline-flex h-11 items-center gap-2 rounded-md border border-card-border bg-card/75 px-6 text-sm font-bold text-white backdrop-blur-md transition-colors hover:bg-elevated/75';
const CONTROL_BUTTON_CLASS =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/30 bg-dark-gray/60 text-white transition-colors hover:border-primary hover:text-primary';

type CommercialSlide = { id: 'commercial'; kind: 'commercial' };
type EventSlideData = { id: string; kind: 'event'; event: Event };
type BannerSlide = CommercialSlide | EventSlideData;

// Preferência de movimento lida de forma reativa: alternar a opção no sistema
// operacional precisa parar o autoplay sem exigir reload da página.
function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return prefersReducedMotion;
}

const isKeyboardFocus = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    // Navegador sem :focus-visible: mantém a pausa, que é o lado seguro.
    return true;
  }
};

export function FeaturedEventBanner({ openLeadModal }: { openLeadModal: () => void }) {
  const t = useTranslations('FeaturedEventBanner');
  const { events } = useApp();
  const [activeIndex, setActiveIndex] = useState(0);
  const [pointerHold, setPointerHold] = useState(false);
  const [focusHold, setFocusHold] = useState(false);
  const [autoplayPaused, setAutoplayPaused] = useState(false);
  const [manualNavToken, setManualNavToken] = useState(0);
  const [registeringEvent, setRegisteringEvent] = useState<Event | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Cada motivo de pausa é rastreado separadamente e some sozinho quando a
  // interação termina (mouseleave, blur, modal fechado). Sem isso um único
  // booleano compartilhado obrigava um timeout de segurança que derrubava a
  // pausa por hover no meio da leitura.
  const isPaused = autoplayPaused || pointerHold || focusHold || registeringEvent !== null;

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
    { id: 'commercial', kind: 'commercial' },
    ...orderedEvents.map((event) => ({ id: event.id, kind: 'event' as const, event }))
  ], [orderedEvents]);

  const safeIndex = activeIndex < slides.length ? activeIndex : 0;
  const activeSlide = slides[safeIndex];
  const hasMultipleSlides = slides.length > 1;

  // Mantém o slide atual e os vizinhos prontos para a transição sem colocar
  // todas as artes remotas no DOM e na fila de download ao mesmo tempo.
  const renderedImageIndexes = new Set([
    safeIndex,
    (safeIndex + 1) % slides.length,
    (safeIndex - 1 + slides.length) % slides.length
  ]);

  const goToSlide = useCallback((index: number) => {
    setActiveIndex(((index % slides.length) + slides.length) % slides.length);
    // Quem navegou na mão ganha o intervalo inteiro para ler o slide escolhido.
    setManualNavToken(token => token + 1);
  }, [slides.length]);
  const goNext = useCallback(() => goToSlide(safeIndex + 1), [goToSlide, safeIndex]);
  const goPrev = useCallback(() => goToSlide(safeIndex - 1), [goToSlide, safeIndex]);

  // Auto-avanço: pausa no hover/foco e respeita quem pediu menos animação.
  useEffect(() => {
    if (!hasMultipleSlides || isPaused || prefersReducedMotion) return;

    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, AUTOPLAY_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [slides.length, hasMultipleSlides, isPaused, prefersReducedMotion, manualNavToken]);

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

  // Foco de teclado dentro do carrossel segura o autoplay. Foco vindo de clique
  // não: quem acabou de clicar em "retomar" quer que ele volte a andar, e o
  // navegador deixa o foco no próprio botão depois do clique.
  const handleControlsFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (isKeyboardFocus(event.target)) setFocusHold(true);
  };
  const handleControlsBlur = (event: React.FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocusHold(false);
  };
  // Hover segura o autoplay apenas sobre o texto do slide — quem está lendo não
  // quer que troque. A barra de controles fica de fora: ela existe para navegar,
  // e pausar ali deixaria o próprio botão de retomar sem efeito.
  const holdOnPointer = {
    onMouseEnter: () => setPointerHold(true),
    onMouseLeave: () => setPointerHold(false)
  };

  const activeEvent = activeSlide.kind === 'event' ? activeSlide.event : null;
  const activeAvailability = activeEvent ? getRegistrationAvailability(activeEvent) : null;
  const registrationsAvailable = activeAvailability?.isAvailable ?? false;
  const activeTitle = activeEvent ? activeEvent.name : t('organizeCardTitle');
  const activeLogoUrl = activeEvent?.logoUrl;
  const activePlace = activeEvent
    ? [activeEvent.city, activeEvent.state].filter(Boolean).join(', ') || activeEvent.location
    : null;

  const activeKicker = !activeAvailability
    ? t('commercialKicker')
    : !activeAvailability.isAvailable
      ? t('kickerClosed')
      : activeAvailability.lifecycle === 'closing'
        ? t('kickerClosing')
        : t('kickerOpen');

  return (
    <>
      <section
        className="wa-hero relative h-[420px] w-full overflow-hidden border-b border-card-border bg-dark-gray sm:h-[500px] lg:h-[560px]"
        role="region"
        aria-roledescription="carousel"
        aria-label={t('carouselAriaLabel')}
        tabIndex={0}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        onFocus={handleControlsFocus}
        onBlur={handleControlsBlur}
      >
        {/* Camada de mídia: apenas artes empilhadas em crossfade. Nenhum texto
            ou controle vive aqui, então um slide que não aparece não tem como
            interceptar leitura nem clique do slide ativo. */}
        <div className="absolute inset-0" aria-hidden="true">
          {slides.map((slide, index) => {
            if (!renderedImageIndexes.has(index)) return null;
            const imageUrl = (slide.kind === 'event' ? slide.event.bannerUrl : '') || FALLBACK_SLIDE_IMAGE;
            const isFirstSlide = index === 0;

            return (
              <div
                key={slide.id}
                className={`wa-hero__media absolute inset-0 transition-opacity duration-700 ease-out ${
                  index === safeIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <Image
                  src={imageUrl}
                  alt=""
                  fill
                  unoptimized
                  // A primeira arte é o elemento LCP da home: ela carrega com
                  // prioridade, as demais entram sob demanda.
                  priority={isFirstSlide}
                  loading={isFirstSlide ? undefined : 'lazy'}
                  sizes="100vw"
                  className="object-cover"
                />
              </div>
            );
          })}
          <div className="wa-hero__scrim absolute inset-0" />
        </div>

        <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pb-14 sm:px-6 sm:pb-16 lg:px-8">
          <div className="max-w-xl">
            <div {...holdOnPointer}>
              {/* Conteúdo do slide ativo, instância única no DOM. A key reinicia
                  a animação de entrada a cada troca sem remontar os handlers de
                  pausa, que vivem no wrapper estável acima. */}
              <div
                key={activeSlide.id}
                className="wa-hero__copy space-y-4"
                role="group"
                aria-roledescription="slide"
                aria-label={t('slideAriaLabel', { index: safeIndex + 1, total: slides.length })}
              >
                <p className="wa-hero__text text-xs font-bold uppercase tracking-[0.16em] text-primary">{activeKicker}</p>

                <h2 className="wa-hero__text line-clamp-2 text-3xl font-black uppercase leading-[0.95] tracking-[-0.04em] text-white text-balance sm:text-5xl lg:text-6xl">
                  {activeTitle}
                </h2>

                {activeEvent && (
                  <div className="wa-hero__text flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm font-medium text-white/90">
                    {activeEvent.date?.trim() && (
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        {activeEvent.date}
                      </span>
                    )}
                    {activePlace && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        {activePlace}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {!activeEvent ? (
                    <button
                      type="button"
                      onClick={openLeadModal}
                      aria-label={t('newManagerCta')}
                      className={PRIMARY_CTA_CLASS}
                    >
                      {t('newManagerCta')}
                    </button>
                  ) : registrationsAvailable ? (
                    <button
                      type="button"
                      onClick={() => setRegisteringEvent(activeEvent)}
                      aria-label={t('registerNowAria', { name: activeEvent.name })}
                      className={PRIMARY_CTA_CLASS}
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
                      <Link href={`/event/${activeEvent.id}`} className={SECONDARY_CTA_CLASS}>
                        {t('viewFullEvent')}
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>

            {hasMultipleSlides && (
              <div className="mt-5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAutoplayPaused((paused) => !paused)}
                  aria-pressed={autoplayPaused}
                  aria-label={autoplayPaused ? t('resumeAutoplay') : t('pauseAutoplay')}
                  className={CONTROL_BUTTON_CLASS}
                >
                  {autoplayPaused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label={t('previousSlide')}
                  className={`${CONTROL_BUTTON_CLASS} ml-1`}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                {slides.map((slide, index) => (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => goToSlide(index)}
                    aria-label={t('slideAriaLabel', { index: index + 1, total: slides.length })}
                    aria-current={index === safeIndex}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      index === safeIndex ? 'w-8 bg-primary' : 'w-4 bg-white/30 hover:bg-white/50'
                    }`}
                  />
                ))}
                <button
                  type="button"
                  onClick={goNext}
                  aria-label={t('nextSlide')}
                  className={`${CONTROL_BUTTON_CLASS} ml-1`}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Selo circular: logo do evento ativo, com fallback para a marca. */}
        <div className="absolute bottom-5 right-4 z-10 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-card-border bg-[#0b0e11]/85 backdrop-blur-md sm:bottom-6 sm:right-6 sm:h-16 sm:w-16">
          {activeLogoUrl ? (
            <Image
              key={activeLogoUrl}
              src={activeLogoUrl}
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

        {/* Anúncio para leitor de tela: silencioso durante o avanço automático,
            falante quando o próprio visitante controla o carrossel. */}
        <p className="sr-only" aria-live={isPaused ? 'polite' : 'off'}>
          {t('slideAnnouncement', { index: safeIndex + 1, total: slides.length, name: activeTitle })}
        </p>
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
