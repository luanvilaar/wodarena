'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Calendar,
  MapPin,
  Trophy,
  ArrowRight,
  Clock,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AppLocale, Event, EventCurrency } from '@/types';
import { RegisterModal } from '@/components/RegisterModal';
import { formatMoney } from '@/lib/intl/format';
import { EVENT_CARD_MOTION } from '@/lib/eventCardMotion';
import { useCountUp } from '@/hooks/useCountUp';
import { useRevealOnView } from '@/hooks/useRevealOnView';
import { useShineOnView } from '@/hooks/useShineOnView';
import {
  getEventStatus,
  getEventDateRange,
  getEventTiming,
  getRegistrationAvailability,
  formatDeadlineCountdown,
  formatDeadlineDate,
  formatTimeUntilDeadline,
  hasRegistrationDeadlinePassed,
  type EventTiming,
} from '@/lib/eventStatus';
import { formatEventDateRange } from '@/lib/eventDates';
import { formatEventPlace } from '@/lib/eventPlace';

// Marcador "Em 5 dias" em amarelo quando o evento está perto e a inscrição aberta.
const HOT_TIMING_DAYS = 7;

interface EventCardProps {
  event: Event;
  priority?: boolean;
  /** Destaque escolhido pelo dono na vitrine da home (Story 1.132). */
  featured?: boolean;
  /** No computador, banner à esquerda e dados à direita (destaque da home, Story 1.133). */
  wide?: boolean;
}

export function EventCard({ event, priority = false, featured = false, wide = false }: EventCardProps) {
  const t = useTranslations('EventCard');
  const locale = useLocale() as AppLocale;
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  const lifecycle = getEventStatus(event);
  const registrationAvailability = getRegistrationAvailability(event);
  const isRegistrationAvailable = registrationAvailability.isAvailable;
  // Story 1.72: três estados. Realizado (o evento já aconteceu) é o único
  // apagado; inscrições encerradas com o evento por acontecer mantêm as cores.
  const isPast = lifecycle === 'finished';
  const isClosedUpcoming = !isRegistrationAvailable && !isPast;
  const isClosing = isRegistrationAvailable && lifecycle === 'closing';

  const dateRange = getEventDateRange(event);
  const dateLabel = dateRange ? formatEventDateRange(dateRange.start, dateRange.end, locale) : event.date;
  // Na frase "Aconteceu em …" o dia da semana sobra.
  const pastDateLabel = dateRange
    ? formatEventDateRange(dateRange.start, dateRange.end, locale, { withWeekday: false })
    : event.date;
  const timing = getEventTiming(event);
  // Evento marcado como finalizado pelo gestor antes da data não mostra contagem.
  const visibleTiming: EventTiming | null = isPast && timing?.kind !== 'ended' ? null : timing;
  const timingLabel = (() => {
    if (!visibleTiming) return null;
    switch (visibleTiming.kind) {
      case 'upcoming':
        return visibleTiming.days === 1 ? t('timingTomorrow') : t('timingInDays', { count: visibleTiming.days });
      case 'today':
        return t('timingToday');
      case 'ongoing':
        return t('timingOngoing');
      case 'ended':
        return visibleTiming.days === 1 ? t('timingYesterday') : t('timingDaysAgo', { count: visibleTiming.days });
    }
  })();
  const isHotTiming = isRegistrationAvailable && visibleTiming !== null && (
    visibleTiming.kind === 'today'
    || visibleTiming.kind === 'ongoing'
    || (visibleTiming.kind === 'upcoming' && visibleTiming.days <= HOT_TIMING_DAYS)
  );
  // Story 1.130: o card mostra o local curto ("Russas/CE"); o endereço completo
  // fica na página do evento.
  const locationLabel = formatEventPlace(event);

  // Phase 1: preço mínimo entre divisões ativas
  const activeDivisions = event.divisions?.filter((d) => d.isActive) ?? [];
  const minPrice =
    activeDivisions.length > 0
      ? Math.min(...activeDivisions.map((d) => d.price))
      : null;

  // Story 1.65: o card anima ao entrar na tela e o preço conta do zero. Card
  // realizado não conta (entra só com fade, via data-card-state). A contagem de
  // divisões saiu do card na Story 1.130 e fica na página do evento.
  const { ref: cardRef, phase } = useRevealOnView<HTMLElement>(event.id);
  const countPhase = isPast ? 'done' : phase;
  const animatedPrice = useCountUp(minPrice ?? 0, countPhase, EVENT_CARD_MOTION.priceCount);
  // Brilho único do Garantir Vaga em tela sem hover (o CSS decide pelo media query).
  const { ref: guaranteeRef, shineDelayMs } = useShineOnView<HTMLButtonElement>(phase);

  // Phase 1: badge de status agora reflete estado de inscrições
  const getStatusBadge = () => {
    const base =
      'inline-flex min-h-9 items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider';

    if (isPast) {
      return (
        <span className={`${base} border-card-border bg-transparent text-muted`}>
          <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t('realizedBadge')}
        </span>
      );
    }

    if (isClosedUpcoming) {
      return (
        <span className={`${base} border-foreground/45 bg-foreground/5 text-foreground`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full border-[1.5px] border-current" />
          {t('registrationClosedBadge')}
        </span>
      );
    }

    if (event.status === 'live') {
      return (
        <span className={`${base} border-primary/30 bg-primary/10 text-primary`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
          {t('liveBadge')}
        </span>
      );
    }

    if (isClosing) {
      return (
        <span className={`${base} border-primary-hover/60 bg-primary/10 text-primary`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-hover motion-safe:animate-pulse" />
          {t('closingBadge')}
        </span>
      );
    }

    return (
      <span className={`${base} border-primary/30 bg-primary/10 text-primary`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        {t('openBadge')}
      </span>
    );
  };

  const topBorderStyle =
    isPast
      ? 'border-t-2 border-t-card-border'
      : isClosedUpcoming
        ? 'border-t-2 border-t-foreground/50'
        : isClosing
          ? 'border-t-[3px] border-t-primary-hover'
          : 'border-t-2 border-t-primary';

  // No topo, à direita: a contagem do prazo em 'closing' (mais urgente) ou o
  // marcador de tempo do evento ("Em 5 dias", "Há 8 dias").
  const lifecycleBadge =
    isClosing && event.registrationDeadline ? (
      <span
        className="inline-flex min-h-9 items-center gap-1.5 rounded-[2px] border border-primary-hover/60 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary"
        aria-label={t('deadlinePeriodAriaLabel')}
      >
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        {formatDeadlineCountdown(event.registrationDeadline)}
      </span>
    ) : timingLabel ? (
      <span
        className={[
          'inline-flex min-h-9 items-center gap-1.5 rounded-[2px] border bg-transparent px-2.5 py-1 font-number text-[10px] font-bold uppercase tracking-wider tabular-nums',
          isHotTiming
            ? 'border-primary/30 text-primary'
            : isPast
              ? 'border-card-border text-muted'
              : 'border-card-border text-foreground',
        ].join(' ')}
      >
        {!isPast && <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />}
        {timingLabel}
      </span>
    ) : null;

  const auxiliaryText =
    isPast ? (
      <p className="text-xs font-medium leading-5 text-muted">
        {t('realizedAux', { date: pastDateLabel })}
      </p>
    ) : isClosedUpcoming ? (
      <p className="text-xs font-medium leading-5 text-foreground">
        {event.isTicketingActive !== false && event.registrationDeadline && hasRegistrationDeadlinePassed(event.registrationDeadline)
          ? t('upcomingDeadlineAux', { date: formatDeadlineDate(event.registrationDeadline) })
          : t('upcomingClosedAux')}
      </p>
    ) : isClosing && event.registrationDeadline ? (
      <p className="flex items-start gap-1.5 text-xs font-medium leading-5 text-primary">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('closingAux', { time: formatTimeUntilDeadline(event.registrationDeadline) })}
      </p>
    ) : null;

  const priceLabel =
    minPrice === null
      ? null
      : minPrice === 0
        ? t('free')
        : formatMoney(minPrice, (event.currency ?? 'BRL') as EventCurrency, locale);
  const pricePrefix = minPrice === 0 ? t('registrationPrefix') : t('from');
  // Texto final para leitor de tela; o visível acompanha a contagem.
  const priceDisplayLabel =
    minPrice !== null && minPrice > 0
      ? formatMoney(animatedPrice, (event.currency ?? 'BRL') as EventCurrency, locale)
      : priceLabel;

  const eventHref = `/event/${event.id}`;

  return (
    <>
      <article
        ref={cardRef}
        data-reveal={phase}
        data-card-state={isPast ? 'closed' : 'open'}
        data-shine={shineDelayMs === null ? undefined : 'on'}
        style={shineDelayMs === null ? undefined : ({ '--ec-shine-delay': `${shineDelayMs}ms` } as React.CSSProperties)}
        className={[
          'event-card group flex h-full flex-col overflow-hidden rounded-lg border border-card-border bg-card transition-colors duration-200 hover:border-primary/60 focus-within:border-primary',
          wide ? 'lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]' : '',
          topBorderStyle,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={`flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-card-border bg-dark-gray px-4 py-2 ec-block ec-i0 ${wide ? 'lg:col-start-2 lg:row-start-1' : ''}`}>
          <span className="flex flex-wrap items-center gap-2">
            {getStatusBadge()}
            {featured && (
              <span className="inline-flex min-h-9 items-center rounded-[2px] bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink">
                {t('featuredBadge')}
              </span>
            )}
          </span>
          {lifecycleBadge}
        </div>

        {/* Banner e nome levam à página do evento; o banner sai da ordem de foco
            para o leitor de tela não ouvir o mesmo link duas vezes. */}
        <Link href={eventHref} tabIndex={-1} aria-hidden="true" className={`relative block aspect-[5/2] w-full overflow-hidden bg-dark-gray ec-block ec-i1 ${wide ? 'lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:aspect-auto lg:h-full lg:min-h-72' : ''}`}>
          {event.bannerUrl ? (
            <Image
              src={event.bannerUrl}
              alt=""
              fill
              unoptimized
              priority={priority}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className={[
                'ec-banner-art object-cover transition-transform duration-500 ease-out',
                isPast ? 'opacity-60 grayscale' : 'opacity-80 group-hover:scale-[1.03]',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ) : (
            <div className="ec-banner-art flex h-full w-full items-center justify-center bg-dark-gray px-6 text-center">
              <span className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                {event.name.substring(0, 2)}
              </span>
            </div>
          )}
        </Link>

        <div className={`flex flex-grow flex-col gap-2.5 p-4 sm:p-5 ${wide ? 'lg:col-start-2 lg:row-start-2 lg:p-6' : ''}`}>
          <h3
            className={[
              'ec-block ec-i2 text-pretty text-xl font-bold leading-tight tracking-tight sm:text-2xl',
              isPast ? 'text-foreground' : 'text-white',
            ].join(' ')}
          >
            <Link href={eventHref} className="transition-colors hover:text-primary focus-visible:text-primary">
              {event.name}
            </Link>
          </h3>

          <div className="ec-block ec-i3 space-y-2">
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <div className="flex min-w-0 items-center gap-1.5">
                <Calendar className={`h-4 w-4 shrink-0 ${isPast ? 'text-muted' : 'text-primary'}`} aria-hidden="true" />
                <dt className="sr-only">{t('dateLabel')}</dt>
                <dd className={`font-medium text-white ${dateRange ? 'font-number tabular-nums' : ''}`}>{dateLabel}</dd>
              </div>
              {locationLabel && (
                <div className="flex min-w-0 items-center gap-1.5">
                  <MapPin className={`h-4 w-4 shrink-0 ${isPast ? 'text-muted' : 'text-primary'}`} aria-hidden="true" />
                  <dt className="sr-only">{t('locationLabel')}</dt>
                  <dd className="min-w-0 truncate font-medium text-white">{locationLabel}</dd>
                </div>
              )}
            </dl>
            {auxiliaryText}
          </div>

          <div className="ec-block ec-i4 mt-auto flex items-center justify-between gap-3 border-t border-card-border pt-3">
            {/* Realizado não vende mais: o preço sai do card. */}
            {priceLabel && !isPast && (
              <div className="min-w-0">
                <p className="text-[11px] font-semibold leading-4 text-muted">{pricePrefix}</p>
                <p className="text-lg font-semibold leading-6">
                  <span className="sr-only">{priceLabel}</span>
                  <span className="font-number text-primary tabular-nums" aria-hidden="true">{priceDisplayLabel}</span>
                </p>
              </div>
            )}

            {/* Um botão só, pelo estado do evento (Story 1.130). */}
            {isPast || isClosedUpcoming ? (
              <Link
                href={isPast ? `/event/${event.id}/leaderboard` : `/event/${event.id}`}
                className="event-cta col-span-2 flex min-h-12 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-primary/55 bg-dark-gray px-4 py-3 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:border-primary hover:bg-elevated"
              >
                {isPast && <Trophy className="h-4 w-4" aria-hidden="true" />}
                <span>{isPast ? t('viewResults') : t('viewSchedule')}</span>
                {!isPast && <ArrowRight className="event-cta-arrow h-3.5 w-3.5" aria-hidden="true" />}
              </Link>
            ) : event.status === 'upcoming' || isClosing ? (
              <button
                ref={guaranteeRef}
                type="button"
                onClick={() => setIsRegisterOpen(true)}
                className="event-cta event-cta-shine flex min-h-12 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  <span>{t('guaranteeSpot')}</span>
                  <ArrowRight className="event-cta-arrow h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            ) : (
              // Ao vivo com inscrição aberta (ex.: Qualifier na janela de envios).
              <Link
                href={`/event/${event.id}/leaderboard`}
                className="event-cta flex min-h-12 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <Trophy className="h-4 w-4 text-black" aria-hidden="true" />
                <span>{t('leaderboard')}</span>
              </Link>
            )}
          </div>
        </div>
      </article>

      <RegisterModal
        event={event}
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
      />
    </>
  );
}
