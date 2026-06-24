'use client';

import React from 'react';

export function SectionOperations() {
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
    <section className="relative overflow-hidden border-t border-b border-card-border bg-background py-16 lg:py-20">
      {/* Vídeo cinemático de fundo */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <video 
          className="h-full w-full object-cover grayscale-[35%] contrast-[112%] brightness-[42%]"
          src="/hero-vertical.mp4" 
          autoPlay 
          loop 
          muted 
          playsInline 
        />
        {/* Gradiente de overlay */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              linear-gradient(180deg, 
                rgba(11, 14, 17, 0.08) 0%, 
                rgba(11, 14, 17, 0.0) 10%, 
                rgba(11, 14, 17, 0.5) 42%, 
                rgba(11, 14, 17, 0.96) 60%, 
                rgba(11, 14, 17, 1.0) 68%
              ),
              linear-gradient(90deg, 
                rgba(11, 14, 17, 0.55) 0%, 
                rgba(11, 14, 17, 0.0) 50%
              )
            `
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Área Hero de Operações */}
        <div className="min-h-[360px] sm:min-h-[460px] lg:min-h-[580px] flex items-end pb-8 sm:pb-12">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-end w-full">
            <div className="space-y-4">
              <span className="inline-flex text-xs font-black uppercase tracking-[0.18em] text-primary">
                Plataforma profissional
              </span>
              <h2 className="text-3xl font-black uppercase leading-[0.92] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
                Gestão completa<br />para eventos de<br />alto rendimento
              </h2>
              <p className="max-w-md text-sm sm:text-base leading-relaxed text-muted">
                Do planejamento à publicação dos resultados, o WODArena centraliza toda a operação em uma única plataforma.
              </p>
            </div>
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted/70">
                Eventos suportados
              </h3>
              <div className="flex flex-wrap gap-2">
                {sportsTags.map((tag) => (
                  <span 
                    key={tag} 
                    className="rounded-full border border-card-border/60 bg-card/70 px-4 py-2.5 text-xs font-bold text-foreground backdrop-blur-[4px]"
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
              className="rounded-lg border border-card-border bg-card/50 p-4 text-xs sm:text-sm font-semibold text-muted tracking-wide"
            >
              {feat}
            </div>
          ))}
        </div>

        {/* Bloco de Impacto */}
        <div className="grid gap-4 md:grid-cols-[1fr_2fr] mt-8 lg:mt-12 items-stretch">
          <div className="rounded-2xl bg-primary p-6 sm:p-8 flex flex-col justify-center min-h-[140px] sm:min-h-[170px] text-ink">
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
            <p className="mt-3 text-xs sm:text-sm leading-relaxed text-muted">
              Organize inscrições, acompanhe atletas, controle baterias, publique scores e entregue uma experiência profissional para gestores, árbitros, atletas e público.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
