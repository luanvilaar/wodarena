'use client';

import Image from 'next/image';
import React, { useEffect, useState } from 'react';

const ROCHAFIT_HERO_POSTER = '/rochafit-hero-poster.jpg';
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
        className="absolute inset-0 z-0 pointer-events-none bg-cover bg-center"
        style={{ backgroundImage: `url(${ROCHAFIT_HERO_POSTER})` }}
        aria-hidden="true"
      >
        {!reducedMotion && (
          <video
            className="h-full w-full object-cover object-center contrast-[110%] brightness-[58%] saturate-[112%]"
            poster={ROCHAFIT_HERO_POSTER}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          >
            <source src="/rochafit-hero.webm" type="video/webm" />
            <source src="/rochafit-hero.mp4" type="video/mp4" />
          </video>
        )}
        <div className="absolute inset-0 bg-background/10" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              linear-gradient(180deg,
                rgba(11, 14, 17, 0.16) 0%,
                rgba(11, 14, 17, 0.14) 18%,
                rgba(11, 14, 17, 0.38) 55%,
                rgba(11, 14, 17, 0.54) 82%,
                rgba(11, 14, 17, 0.56) 100%
              ),
              linear-gradient(90deg,
                rgba(11, 14, 17, 0.44) 0%,
                rgba(11, 14, 17, 0.28) 42%,
                rgba(11, 14, 17, 0.13) 100%
              )
            `
          }}
        />
      </div>

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
        <div className="min-h-[15.75rem] sm:min-h-[20.125rem] lg:min-h-[25.375rem] flex items-end pb-8 sm:pb-12">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-end w-full">
            <div className="relative inline-flex max-w-xl flex-col items-start gap-3 sm:gap-4">
              <h1 className="text-3xl font-black uppercase leading-[0.92] tracking-[-0.04em] text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.85)] sm:text-5xl lg:text-6xl">
                Gestão completa<br />para eventos de<br />alto rendimento
              </h1>
              <p className="max-w-md text-sm sm:text-base leading-relaxed text-foreground drop-shadow-[0_1px_8px_rgba(0,0,0,0.8)]">
                Do planejamento à publicação dos resultados, o WODArena centraliza toda a operação em uma única plataforma.
              </p>
            </div>
            <div className="inline-flex flex-col items-start gap-3">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground drop-shadow-[0_1px_8px_rgba(0,0,0,0.8)]">
                Eventos suportados
              </h2>
              <div className="flex flex-wrap gap-2">
                {sportsTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-card-border bg-card/85 px-4 py-2.5 text-xs font-bold text-foreground backdrop-blur-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
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
