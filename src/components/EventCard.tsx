'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Calendar,
  MapPin,
  Trophy,
  ArrowRight,
  Sparkles,
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
      'inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider font-mono';

    if (event.status === 'live') {
      return (
        <span className={`${base} border-primary/30 bg-primary/10 text-primary`}>
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          Ao Vivo
        </span>
      );
    }

    if (event.status === 'upcoming') {
      if (lifecycle === 'finished') {
        return (
          <span className={`${base} border-card-border bg-dark-gray/30 text-muted`}>
            <Lock className="h-3 w-3" />
            Inscrições Encerradas
          </span>
        );
      }
      if (lifecycle === 'closing') {
        return (
          <span className={`${base} border-amber-500/40 bg-amber-600/10 text-amber-300`}>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Encerrando
          </span>
        );
      }
      return (
        <span className={`${base} border-primary/30 bg-primary/10 text-primary`}>
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Inscrições Abertas
        </span>
      );
    }

    return (
      <span className={`${base} border-card-border bg-dark-gray/30 text-muted`}>
        <span className="h-1.5 w-1.5 rounded-full bg-muted/40" />
        Encerrado
      </span>
    );
  };

  const topBorderStyle =
    lifecycle === 'finished'
      ? 'border-t-2 border-t-[#374151]'
      : lifecycle === 'closing'
        ? 'border-t-[3px] border-t-[#F59E0B]'
        : 'border-t-2 border-t-primary';

  // Countdown só em 'closing' — estado 'finished' já está no badge de status
  const lifecycleBadge =
    lifecycle === 'closing' && event.registrationDeadline ? (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-500 bg-amber-600/20 px-2 py-0.5 text-[10px] font-bold text-amber-300"
        aria-label="Período final de inscrições"
      >
        <Clock className="h-3 w-3" />
        {formatDeadlineCountdown(event.registrationDeadline)}
      </span>
    ) : null;

  const auxiliaryText =
    lifecycle === 'closing' && event.registrationDeadline ? (
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Inscrições encerram em {formatTimeUntilDeadline(event.registrationDeadline)}
      </p>
    ) : lifecycle === 'finished' && event.registrationDeadline ? (
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        Inscrições encerradas em {formatDeadlineDate(event.registrationDeadline)}
      </p>
    ) : null;

  return (
    <>
      <article
        className={[
          'group flex h-full flex-col overflow-hidden rounded-xl border border-card-border bg-card transition-colors duration-200 hover:border-primary/60',
          topBorderStyle,
          lifecycle === 'finished' ? 'opacity-70 grayscale-[30%]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Phase 2: aspect-video em vez de h-48 fixo */}
        <div className="relative aspect-video w-full overflow-hidden bg-dark-gray">
          {event.bannerUrl ? (
            <Image
              src={event.bannerUrl}
              alt={`${event.name} banner`}
              fill
              unoptimized
              priority={priority}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover opacity-75 transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-dark-gray to-card opacity-75" />
          )}

          <div className="absolute top-4 left-4">{getStatusBadge()}</div>

          {lifecycleBadge && (
            <div className="absolute top-4 right-4">{lifecycleBadge}</div>
          )}

          {/* Phase 3: logo maior com sombra */}
          <div className="absolute bottom-4 left-4">
            <div className="h-14 w-14 overflow-hidden rounded-lg border-2 border-card-border bg-background p-1 shadow-lg shadow-black/40">
              {event.logoUrl ? (
                <Image
                  src={event.logoUrl}
                  alt={`${event.name} logo`}
                  width={56}
                  height={56}
                  unoptimized
                  loading="lazy"
                  className="h-full w-full rounded-md object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-md bg-primary/10 text-xs font-black uppercase text-primary">
                  {event.name.substring(0, 2)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-grow flex-col justify-between space-y-4 p-5">
          <div className="space-y-2">
            <h3 className="line-clamp-1 text-lg font-extrabold tracking-wide text-white transition-colors group-hover:text-primary">
              {event.name}
            </h3>

            <div className="space-y-1.5">
              <p className="flex items-center gap-2 text-xs font-medium text-muted">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span className="text-white">{event.date}</span>
              </p>
              <p className="flex items-center gap-2 text-xs font-medium text-muted">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="line-clamp-1 text-white">{event.location}</span>
              </p>

              {/* Phase 1: preço */}
              {minPrice !== null && (
                <p className="flex items-center gap-2 text-xs font-medium">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-muted" />
                  {minPrice === 0 ? (
                    <span className="font-bold text-primary">Gratuito</span>
                  ) : (
                    <span className="text-white">
                      A partir de{' '}
                      <span className="font-bold">
                        R${' '}
                        {minPrice.toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* Phase 3: chip de divisões */}
            {divisionCount > 0 && (
              <div className="pt-0.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-card-border bg-dark-gray px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  <Layers className="h-3 w-3" />
                  {divisionCount} {divisionCount === 1 ? 'divisão' : 'divisões'}
                </span>
              </div>
            )}

            {/* Phase 2: descrição condicional */}
            {event.description?.trim() && (
              <p className="line-clamp-2 pt-1 text-xs font-normal leading-relaxed text-muted/80">
                {event.description}
              </p>
            )}

            {auxiliaryText && <div className="pt-1">{auxiliaryText}</div>}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-card-border pt-4">
            <Link
              href={`/event/${event.id}`}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 py-2.5 text-xs font-bold text-white transition-colors hover:border-primary hover:bg-elevated"
            >
              <span>Ver Evento</span>
              <ArrowRight className="h-3 w-3 text-primary" />
            </Link>

            {lifecycle === 'finished' ? (
              <button
                disabled
                aria-label="Inscrições encerradas"
                className="flex min-h-11 cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 py-2.5 text-xs font-bold text-muted"
              >
                <Lock className="h-3 w-3" />
                <span>Encerradas</span>
              </button>
            ) : event.status === 'upcoming' || lifecycle === 'closing' ? (
              <button
                onClick={() => setIsRegisterOpen(true)}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-xs font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <Sparkles className="h-3 w-3 fill-black text-black" />
                <span>Inscrever-se</span>
              </button>
            ) : event.status === 'live' ? (
              <Link
                href={`/event/${event.id}/leaderboard`}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-xs font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <Trophy className="h-3 w-3 text-black" />
                <span>Leaderboard</span>
              </Link>
            ) : (
              <Link
                href={`/event/${event.id}/leaderboard`}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 py-2.5 text-xs font-bold text-muted transition-colors hover:border-primary hover:text-white"
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
