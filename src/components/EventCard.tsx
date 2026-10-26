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
  Tag,
  Layers,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AppLocale, Event, EventCurrency } from '@/types';
import { RegisterModal } from '@/components/RegisterModal';
import { formatMoney } from '@/lib/intl/format';
import { EVENT_CARD_MOTION, swapCountInText } from '@/lib/eventCardMotion';
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

// Marcador "Em 5 dias" em amarelo quando o evento está perto e a inscrição aberta.
const HOT_TIMING_DAYS = 7;

interface EventCardProps {
  event: Event;
  priority?: boolean;
}

export function EventCard({ event, priority = false }: EventCardProps) {
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
  // Realizado mostra a cidade, mais curta que o endereço completo.
  const locationLabel = isPast && event.city && event.state ? `${event.city}, ${event.state}` : event.location;

  // Phase 1: preço mínimo entre divisões ativas
  const activeDivisions = event.divisions?.filter((d) => d.isActive) ?? [];
  const minPrice =
    activeDivisions.length > 0
      ? Math.min(...activeDivisions.map((d) => d.price))
      : null;

  // Phase 3: contagem de divisões
  const divisionCount = activeDivisions.length;
  // "Divisões disponíveis" só faz sentido com a inscrição aberta; sem a linha,
  // o filete de baixo dos dados já separa os botões.
  const showDivisions = divisionCount > 0 && isRegistrationAvailable;

  // Story 1.65: o card anima ao entrar na tela e o preço e as divisões contam do
  // zero. Card realizado não conta (entra só com fade, via data-card-state).
  const { ref: cardRef, phase } = useRevealOnView<HTMLElement>(event.id);
  const countPhase = isPast ? 'done' : phase;
  const animatedPrice = useCountUp(minPrice ?? 0, countPhase, EVENT_CARD_MOTION.priceCount);
  const animatedDivisions = useCountUp(divisionCount, countPhase, EVENT_CARD_MOTION.divisionCount);
  // Brilho único do Garantir Vaga em tela sem hover (o CSS decide pelo media query).
  const { ref: guaranteeRef, shineDelayMs } = useShineOnView<HTMLButtonElement>(phase);
  const divisionsFinalText = t('divisionsAvailable', { count: divisionCount });

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
          topBorderStyle,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-card-border bg-dark-gray px-4 py-2 ec-block ec-i0">
          {getStatusBadge()}
          {lifecycleBadge}
        </div>

        <div className="relative aspect-[5/2] w-full overflow-hidden bg-dark-gray ec-block ec-i1">
          {event.bannerUrl ? (
            <Image
              src={event.bannerUrl}
              alt={`${event.name} banner`}
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
        </div>

        <div className="flex flex-grow flex-col p-4 sm:p-5">
          <div className="ec-block ec-i2 flex min-w-0 items-start gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-card-border bg-dark-gray p-1.5">
              {event.logoUrl ? (
                <Image
                  src={event.logoUrl}
                  alt={`${event.name} logo`}
                  width={56}
                  height={56}
                  unoptimized
                  loading="lazy"
                  className="h-full w-full rounded-sm object-contain"
                />
              ) : (
                <span className="text-sm font-bold tracking-tight text-primary">
                  {event.name.substring(0, 2)}
                </span>
              )}
            </div>

            <div className="min-w-0 space-y-2">
              {auxiliaryText || (
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
                  {t('nextArenaLabel')}
                </p>
              )}

              <h3
                className={[
                  'text-pretty text-xl font-bold leading-tight tracking-tight transition-colors group-hover:text-primary sm:text-2xl',
                  isPast ? 'text-foreground' : 'text-white',
                ].join(' ')}
              >
                {event.name}
              </h3>
            </div>
          </div>

          <div className="ec-block ec-i3 mt-4 space-y-4">
            {event.description?.trim() && (
              <p className="line-clamp-2 text-sm leading-6 text-muted">
                {event.description}
              </p>
            )}

            <dl className="grid gap-3 border-y border-card-border py-4 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <Calendar className={`mt-0.5 h-4 w-4 shrink-0 ${isPast ? 'text-muted' : 'text-primary'}`} aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="sr-only">{t('dateLabel')}</dt>
                  <dd className={`break-words font-medium text-white ${dateRange ? 'font-number tabular-nums' : ''}`}>{dateLabel}</dd>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-2">
                <MapPin className={`mt-0.5 h-4 w-4 shrink-0 ${isPast ? 'text-muted' : 'text-primary'}`} aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="sr-only">{t('locationLabel')}</dt>
                  <dd className="break-words font-medium text-white">{locationLabel}</dd>
                </div>
              </div>

              {/* Realizado não vende mais: o preço sai do card. */}
              {priceLabel && !isPast && (
                <div className="flex min-w-0 items-start gap-2">
                  <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="sr-only">{t('priceLabel')}</dt>
                    <dd className="break-words font-medium text-white">
                      <span className="text-muted">{pricePrefix} </span>
                      <span className="sr-only">{priceLabel}</span>
                      <span className="font-number text-primary tabular-nums" aria-hidden="true">{priceDisplayLabel}</span>
                    </dd>
                  </div>
                </div>
              )}
            </dl>

            {showDivisions && (
              <p className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted">
                <Layers className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="sr-only">{divisionsFinalText}</span>
                <span aria-hidden="true">{swapCountInText(divisionsFinalText, divisionCount, animatedDivisions)}</span>
              </p>
            )}
          </div>

          <div
            className={[
              'ec-block ec-i4 mt-5 grid grid-cols-2 gap-3',
              showDivisions ? 'border-t border-card-border pt-4' : '',
            ].join(' ')}
          >
            {/* Fechado (realizado ou sem inscrição): um só botão, na largura toda. */}
            {isPast || isClosedUpcoming ? (
              <Link
                href={isPast ? `/event/${event.id}/leaderboard` : `/event/${event.id}`}
                className="event-cta col-span-2 flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-primary/55 bg-dark-gray px-3 py-3 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:border-primary hover:bg-elevated"
              >
                {isPast && <Trophy className="h-4 w-4" aria-hidden="true" />}
                <span>{isPast ? t('viewResults') : t('viewSchedule')}</span>
                {!isPast && <ArrowRight className="event-cta-arrow h-3.5 w-3.5" aria-hidden="true" />}
              </Link>
            ) : (
              <>
                <Link
                  href={`/event/${event.id}`}
                  className="event-cta flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-card-border bg-dark-gray px-3 py-3 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-primary hover:bg-elevated"
                >
                  <span>{t('viewEvent')}</span>
                  <ArrowRight className="event-cta-arrow h-3.5 w-3.5 text-primary" aria-hidden="true" />
                </Link>

                {event.status === 'upcoming' || isClosing ? (
                  <button
                    ref={guaranteeRef}
                    type="button"
                    onClick={() => setIsRegisterOpen(true)}
                    className="event-cta event-cta-shine flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-3 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
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
                    className="event-cta flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-3 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
                  >
                    <Trophy className="h-4 w-4 text-black" aria-hidden="true" />
                    <span>{t('leaderboard')}</span>
                  </Link>
                )}
              </>
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
