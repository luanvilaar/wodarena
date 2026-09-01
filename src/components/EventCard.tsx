'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Calendar,
  MapPin,
  Trophy,
  ArrowRight,
  Clock,
  Lock,
  AlertTriangle,
  Tag,
  Layers,
} from 'lucide-react';
import { Event } from '@/types';
import { RegisterModal } from '@/components/RegisterModal';
import {
  getEventStatus,
  getRegistrationAvailability,
  formatDeadlineCountdown,
  formatDeadlineDate,
  formatTimeUntilDeadline,
} from '@/lib/eventStatus';

interface EventCardProps {
  event: Event;
  priority?: boolean;
}

export function EventCard({ event, priority = false }: EventCardProps) {
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  const lifecycle = getEventStatus(event);
  const registrationAvailability = getRegistrationAvailability(event);
  const isRegistrationAvailable = registrationAvailability.isAvailable;
  const isFinished = !registrationAvailability.isAvailable || lifecycle === 'finished';
  const isClosing = isRegistrationAvailable && lifecycle === 'closing';

  // Phase 1: preço mínimo entre divisões ativas
  const activeDivisions = event.divisions?.filter((d) => d.isActive) ?? [];
  const minPrice =
    activeDivisions.length > 0
      ? Math.min(...activeDivisions.map((d) => d.price))
      : null;

  // Phase 3: contagem de divisões
  const divisionCount = activeDivisions.length;

  // Phase 1: badge de status agora reflete estado de inscrições
  const getStatusBadge = () => {
    const base =
      'inline-flex min-h-9 items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider';

    if (!isRegistrationAvailable) {
      return (
        <span className={`${base} border-card-border bg-card text-muted`}>
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          {registrationAvailability.reason === 'sales_closed' ? 'Vendas Encerradas' : 'Evento Encerrado'}
        </span>
      );
    }

    if (event.status === 'live') {
      return (
        <span className={`${base} border-primary/30 bg-primary/10 text-primary`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
          Ao Vivo
        </span>
      );
    }

    if (event.status === 'upcoming') {
      if (isClosing) {
        return (
          <span className={`${base} border-primary-hover/60 bg-primary/10 text-primary`}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-hover motion-safe:animate-pulse" />
            Encerrando
          </span>
        );
      }
      return (
        <span className={`${base} border-primary/30 bg-primary/10 text-primary`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          Inscrições Abertas
        </span>
      );
    }

    return (
      <span className={`${base} border-card-border bg-card text-muted`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted/40" />
        Encerrado
      </span>
    );
  };

  const topBorderStyle =
    !isRegistrationAvailable
      ? 'border-t-2 border-t-card-border'
      : isClosing
        ? 'border-t-[3px] border-t-primary-hover'
        : 'border-t-2 border-t-primary';

  // Countdown só em 'closing' — estado 'finished' já está no badge de status
  const lifecycleBadge =
    lifecycle === 'closing' && event.registrationDeadline ? (
      <span
        className="inline-flex min-h-9 items-center gap-1.5 rounded-[2px] border border-primary-hover/60 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary"
        aria-label="Período final de inscrições"
      >
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        {formatDeadlineCountdown(event.registrationDeadline)}
      </span>
    ) : null;

  const auxiliaryText =
    registrationAvailability.reason === 'sales_closed' ? (
      <p className="flex items-start gap-1.5 text-xs font-medium leading-5 text-muted">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Vendas online encerradas pelo organizador.
      </p>
    ) : lifecycle === 'closing' && event.registrationDeadline ? (
      <p className="flex items-start gap-1.5 text-xs font-medium leading-5 text-primary">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Inscrições encerram em {formatTimeUntilDeadline(event.registrationDeadline)}
      </p>
    ) : lifecycle === 'finished' && event.registrationDeadline ? (
      <p className="flex items-start gap-1.5 text-xs font-medium leading-5 text-muted">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Inscrições encerradas em {formatDeadlineDate(event.registrationDeadline)}
      </p>
    ) : lifecycle === 'finished' ? (
      <p className="flex items-start gap-1.5 text-xs font-medium leading-5 text-muted">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Este evento não está mais disponível para inscrição.
      </p>
    ) : null;

  const priceLabel =
    minPrice === null
      ? null
      : minPrice === 0
        ? 'Gratuito'
        : `R$ ${minPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const pricePrefix = minPrice === 0 ? 'Inscrição' : 'A partir de';

  return (
    <>
      <article
        className={[
          'group flex h-full flex-col overflow-hidden rounded-lg border border-card-border bg-card transition-colors duration-200 hover:border-primary/60 focus-within:border-primary',
          topBorderStyle,
          isFinished ? 'opacity-70 grayscale-[30%]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-card-border bg-dark-gray px-4 py-2">
          {getStatusBadge()}
          {lifecycleBadge}
        </div>

        <div className="relative aspect-[5/2] w-full overflow-hidden bg-dark-gray">
          {event.bannerUrl ? (
            <Image
              src={event.bannerUrl}
              alt={`${event.name} banner`}
              fill
              unoptimized
              priority={priority}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover opacity-80 transition-transform duration-200 group-hover:scale-[1.01]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-dark-gray px-6 text-center">
              <span className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                {event.name.substring(0, 2)}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-grow flex-col p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
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
                  Próxima arena disponível
                </p>
              )}

              <h3 className="text-pretty text-xl font-bold leading-tight tracking-tight text-white transition-colors group-hover:text-primary sm:text-2xl">
                {event.name}
              </h3>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {event.description?.trim() && (
              <p className="line-clamp-2 text-sm leading-6 text-muted">
                {event.description}
              </p>
            )}

            <dl className="grid gap-3 border-y border-card-border py-4 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="sr-only">Data</dt>
                  <dd className="break-words font-medium text-white">{event.date}</dd>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="sr-only">Local</dt>
                  <dd className="break-words font-medium text-white">{event.location}</dd>
                </div>
              </div>

              {priceLabel && (
                <div className="flex min-w-0 items-start gap-2">
                  <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="sr-only">Preço</dt>
                    <dd className="break-words font-medium text-white">
                      <span className="text-muted">{pricePrefix} </span>
                      <span className="font-number text-primary">{priceLabel}</span>
                    </dd>
                  </div>
                </div>
              )}
            </dl>

            {divisionCount > 0 && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <Layers className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                {divisionCount} {divisionCount === 1 ? 'divisão disponível' : 'divisões disponíveis'}
              </p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-card-border pt-4">
            <Link
              href={`/event/${event.id}`}
              className="flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-card-border bg-dark-gray px-3 py-3 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-primary hover:bg-elevated"
            >
              <span>Ver Evento</span>
              <ArrowRight className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            </Link>

            {!isRegistrationAvailable ? (
              <button
                type="button"
                disabled
                aria-label={registrationAvailability.reason === 'sales_closed' ? 'Vendas encerradas' : 'Inscrições encerradas'}
                className="flex min-h-12 cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-card-border bg-dark-gray px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted"
              >
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{registrationAvailability.reason === 'sales_closed' ? 'Vendas encerradas' : 'Encerradas'}</span>
              </button>
            ) : event.status === 'upcoming' || isClosing ? (
              <button
                type="button"
                onClick={() => setIsRegisterOpen(true)}
                className="flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-3 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <span>Garantir Vaga</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : event.status === 'live' ? (
              <Link
                href={`/event/${event.id}/leaderboard`}
                className="flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-3 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <Trophy className="h-4 w-4 text-black" aria-hidden="true" />
                <span>Leaderboard</span>
              </Link>
            ) : (
              <Link
                href={`/event/${event.id}/leaderboard`}
                className="flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-card-border bg-dark-gray px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted transition-colors hover:border-primary hover:text-white"
              >
                <span>Resultados</span>
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
