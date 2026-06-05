'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Calendar, MapPin, Trophy, ArrowRight, Sparkles } from 'lucide-react';
import { Event } from '@/types';
import { RegisterModal } from '@/components/RegisterModal';

interface EventCardProps {
  event: Event;
  priority?: boolean;
}

export function EventCard({ event, priority = false }: EventCardProps) {
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  const getStatusBadge = (status: Event['status']) => {
    switch (status) {
      case 'live':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Ao Vivo
          </span>
        );
      case 'upcoming':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Em Breve
          </span>
        );
      case 'finished':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-card-border bg-dark-gray/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-muted/40" />
            Finalizado
          </span>
        );
    }
  };

  return (
    <>
      <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-card-border bg-card transition-colors duration-200 hover:border-primary/60">
        <div className="relative h-48 w-full overflow-hidden bg-dark-gray">
          {event.bannerUrl ? (
            <Image
              src={event.bannerUrl} 
              alt={`${event.name} banner`} 
              width="1200"
              height="480"
              unoptimized
              priority={priority}
              className="h-full w-full object-cover opacity-75 transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-dark-gray to-card opacity-75" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-black/40"></div>
          
          {/* Status Badge */}
          <div className="absolute top-4 left-4">
            {getStatusBadge(event.status)}
          </div>

          {/* Logo do Evento */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-lg border border-card-border bg-background p-1">
              {event.logoUrl ? (
                <Image
                  src={event.logoUrl} 
                  alt={`${event.name} logo`} 
                  width="48"
                  height="48"
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
              <p className="flex items-center gap-2 text-xs text-muted font-medium">
                <Calendar className="h-3.5 w-3.5 text-muted shrink-0" />
                <span className="text-white">{event.date}</span>
              </p>
              <p className="flex items-center gap-2 text-xs text-muted font-medium">
                <MapPin className="h-3.5 w-3.5 text-muted shrink-0" />
                <span className="line-clamp-1 text-white">{event.location}</span>
              </p>
            </div>

            <p className="text-xs text-muted/80 line-clamp-2 leading-relaxed font-normal pt-1">
              {event.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-card-border pt-4">
            <Link 
              href={`/event/${event.id}`}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 py-2.5 text-xs font-bold text-white transition-colors hover:border-primary hover:bg-elevated"
            >
              <span>Ver Evento</span>
              <ArrowRight className="h-3 w-3 text-primary" />
            </Link>

            {event.status === 'upcoming' ? (
              <button 
                onClick={() => setIsRegisterOpen(true)}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-xs font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <Sparkles className="h-3 w-3 fill-black text-black" />
                <span>Inscrever-se</span>
              </button>
            ) : event.status === 'live' ? (
              <Link 
                href={`/event/${event.id}?tab=leaderboard`}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-xs font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                <Trophy className="h-3 w-3 text-black" />
                <span>Leaderboard</span>
              </Link>
            ) : (
              <Link 
                href={`/event/${event.id}?tab=leaderboard`}
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
