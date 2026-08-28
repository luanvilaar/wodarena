'use client';

import Image from 'next/image';
import React, { useEffect, useState } from 'react';

const HERO_VIDEO_POSTER = '/hero-vertical-poster.jpg';
const ROCHAFIT_LOGO_FALLBACK = '/rochafit-logo.png';

export function SectionOperations() {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [canAnimateLogo, setCanAnimateLogo] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setReducedMotion(motionQuery.matches);
    const animationFrame = window.requestAnimationFrame(() => {
      updateMotionPreference();

      const video = document.createElement('video');
      setCanAnimateLogo(Boolean(video.canPlayType('video/webm; codecs="vp9"')));
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
      <div
        className="pointer-events-none absolute right-4 top-6 z-20 flex w-14 items-center justify-center sm:top-8 sm:w-16 lg:right-6 lg:top-8 lg:w-[15vw] lg:min-w-[130px] lg:max-w-[210px]"
        aria-hidden="true"
      >
        <div className="relative aspect-square w-full opacity-90 mix-blend-screen">
          {canAnimateLogo && !reducedMotion ? (
            <video
              className="h-full w-full object-contain"
              poster={ROCHAFIT_LOGO_FALLBACK}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
            >
              <source src="/rochafit-logo-alpha.webm" type="video/webm" />
            </video>
          ) : (
            <Image
              src={ROCHAFIT_LOGO_FALLBACK}
              alt=""
              fill
              sizes="420px"
              className="object-contain"
            />
          )}
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Área Hero de Operações */}
        <div className="flex flex-col gap-3 pb-8 sm:gap-4 sm:pb-12">
          <h1 className="max-w-2xl text-3xl font-black uppercase leading-[0.92] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl">
            Gestão completa<br />para eventos de<br />alto rendimento
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-foreground sm:text-base">
            Do planejamento à publicação dos resultados, o WODArena centraliza toda a operação em uma única plataforma.
          </p>
          <div className="mt-2 flex flex-col items-start gap-3 sm:mt-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
              Eventos suportados
            </h2>
            <div className="flex flex-wrap gap-2">
              {sportsTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-card-border bg-card px-4 py-2.5 text-xs font-bold text-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Vídeo da Hero — 16:9 fixo em todos os breakpoints */}
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-card-border bg-dark-gray">
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
          {features.map((feat) => (
            <div
              key={feat}
              className="rounded-lg border border-card-border bg-card p-4 text-xs sm:text-sm font-semibold text-foreground tracking-wide"
            >
              {feat}
            </div>
          ))}
        </div>

        {/* Bloco de Impacto */}
        <div className="grid gap-4 md:grid-cols-[1fr_2fr] mt-8 lg:mt-12 items-stretch">
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
