'use client';

import Image from 'next/image';
import React, { useEffect, useState } from 'react';

const HERO_VIDEO_POSTER = '/hero-vertical-poster.jpg';

export function SectionOperations() {
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setReducedMotion(motionQuery.matches);
    const animationFrame = window.requestAnimationFrame(() => {
      updateMotionPreference();
    });

    motionQuery.addEventListener('change', updateMotionPreference);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      motionQuery.removeEventListener('change', updateMotionPreference);
    };
  }, []);

  const features = [
    'Inscrições Online',
    'Controle de Categorias',
    'Cronograma de Baterias',
    'Lançamento de Scores',
    'Leaderboard em Tempo Real',
    'Rankings Automáticos',
    'Contestação de Resultados',
    'Gestão de Equipes'
  ];

  const sportsTags = [
    'Functional Fitness',
    'Fitness Race',
    'Competições Individuais',
    'Competições por Equipes',
    'Ligas Estaduais',
    'Federações'
  ];

  return (
    <section className="relative overflow-hidden border-b border-card-border bg-background py-11 lg:py-14">
      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Área Hero de Operações */}
        <div className="flex flex-col gap-3 pb-8 sm:gap-4 sm:pb-12">
          <h1 className="home-broadcast-title max-w-2xl text-3xl font-black uppercase leading-[0.92] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl">
            Gestão completa<br />para eventos de<br />alto rendimento
          </h1>
          <p className="home-broadcast-support max-w-md text-sm leading-relaxed text-foreground sm:text-base">
            Do planejamento à publicação dos resultados, o WODArena centraliza toda a operação em uma única plataforma.
          </p>
          <div className="home-broadcast-tags mt-2 flex flex-col items-start gap-3 sm:mt-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
              Eventos suportados
            </h2>
            <div className="flex flex-wrap gap-2">
              {sportsTags.map((tag, index) => (
                <span
                  key={tag}
                  className="home-broadcast-chip rounded-full border border-card-border bg-card px-4 py-2.5 text-xs font-bold text-foreground"
                  style={{ '--motion-delay': `${260 + index * 35}ms` } as React.CSSProperties}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Vídeo da Hero — 16:9 fixo em todos os breakpoints */}
        <div className="home-broadcast-video relative aspect-video w-full overflow-hidden rounded-2xl border border-card-border bg-dark-gray">
          {reducedMotion ? (
            <Image
              src={HERO_VIDEO_POSTER}
              alt="Atletas competindo em um evento WODArena"
              fill
              sizes="(min-width: 1280px) 1216px, 100vw"
              className="object-cover"
              priority
            />
          ) : (
            <video
              className="h-full w-full object-cover"
              poster={HERO_VIDEO_POSTER}
              aria-label="Vídeo de atletas competindo em um evento WODArena"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
            >
              <source src="/hero-vertical.webm" type="video/webm" />
              <source src="/hero-vertical-h264.mp4" type="video/mp4" />
            </video>
          )}
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4 mt-8 sm:mt-12">
          {features.map((feat, index) => (
            <div
              key={feat}
              className="home-broadcast-tile rounded-lg border border-card-border bg-card p-4 text-xs sm:text-sm font-semibold text-foreground tracking-wide"
              style={{ '--motion-delay': `${520 + Math.min(index, 5) * 45}ms` } as React.CSSProperties}
            >
              {feat}
            </div>
          ))}
        </div>

        {/* Bloco de Impacto */}
        <div className="home-broadcast-panel grid gap-4 md:grid-cols-[1fr_2fr] mt-8 lg:mt-12 items-stretch" style={{ '--motion-delay': '680ms' } as React.CSSProperties}>
          <div className="rounded-2xl bg-primary p-6 sm:p-8 flex flex-col justify-center min-h-[8.75rem] sm:min-h-[10.625rem] text-ink">
            <strong className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-[-0.08em] leading-none">
              100%
            </strong>
            <span className="mt-3 text-xs sm:text-sm font-black uppercase tracking-[0.06em] leading-tight">
              da operação centralizada em um único sistema
            </span>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-6 sm:p-8 flex flex-col justify-center">
            <h3 className="text-xl sm:text-2xl lg:text-3xl font-black uppercase tracking-[-0.05em] text-white leading-tight">
              Uma plataforma para gerenciar toda a jornada do evento.
            </h3>
            <p className="mt-3 text-xs sm:text-sm leading-relaxed text-foreground">
              Organize inscrições, acompanhe atletas, controle baterias, publique scores e entregue uma experiência profissional para gestores, árbitros, atletas e público.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
