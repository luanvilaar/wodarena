'use client';

import Image from 'next/image';
import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

// Vídeo institucional da WODArena (arena, barras e Fitness Race em meio-tom).
// Fundo do topo da home (Story 1.136) e quadro 16:9 de /organizadores.
// Com "reduzir movimento" ligado no aparelho mostra só a imagem de capa.
export const HERO_VIDEO_POSTER = '/hero-vertical-poster.jpg';
// Até 767 px o navegador baixa a versão leve (960 × 540, sem áudio); acima, a
// de 1920 × 1080 (D2 de docs/design/mobile-competitivo/README.md).
export const HERO_VIDEO_MOBILE_MEDIA = '(max-width: 767px)';

type HeroVideoProps = {
  alt: string;
  ariaLabel: string;
  sizes: string;
  // Classes extras da mídia (vídeo ou imagem de capa), como posição e recorte.
  mediaClassName?: string;
  priority?: boolean;
  // Botão de pausar/retomar; quem usa decide a posição pelo className.
  toggle?: { pauseLabel: string; playLabel: string; className?: string };
};

export function HeroVideo({ alt, ariaLabel, sizes, mediaClassName = '', priority = false, toggle }: HeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [paused, setPaused] = useState(false);

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

  if (reducedMotion) {
    return (
      <Image
        src={HERO_VIDEO_POSTER}
        alt={alt}
        fill
        sizes={sizes}
        className={`object-cover ${mediaClassName}`}
        priority={priority}
      />
    );
  }

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => setPaused(true));
    } else {
      video.pause();
    }
  };

  return (
    <>
      <video
        ref={videoRef}
        className={`h-full w-full object-cover ${mediaClassName}`}
        poster={HERO_VIDEO_POSTER}
        aria-label={ariaLabel}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
      >
        <source src="/hero-vertical-960.mp4" type="video/mp4" media={HERO_VIDEO_MOBILE_MEDIA} />
        <source src="/hero-vertical.webm" type="video/webm" />
        <source src="/hero-vertical-h264.mp4" type="video/mp4" />
      </video>
      {toggle && (
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={paused ? toggle.playLabel : toggle.pauseLabel}
          className={`absolute z-10 grid h-10 w-10 place-items-center rounded-full border border-white/30 bg-background/65 text-white transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:h-11 sm:w-11 ${toggle.className ?? ''}`}
        >
          {paused
            ? <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            : <Pause className="h-4 w-4 fill-current" aria-hidden="true" />}
        </button>
      )}
    </>
  );
}
