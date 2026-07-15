'use client';

import React, { useEffect, useState } from 'react';

const loadingMessages = [
  'Conectando à arena...',
  'Buscando dados das competições...',
  'Preparando tabelas de classificação...',
  'Sincronizando placares em tempo real...',
  'Carregando perfis de atletas...'
];

export function LoadingOverlay() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-16 z-[9999] flex justify-center px-4 py-3"
      role="status"
      aria-live="polite"
      aria-label="Carregando dados da WODArena"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-primary/25 bg-[#0b0e11]/95 px-4 py-2.5 shadow-xl backdrop-blur-md">
        <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-hidden="true" />
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Carregando</span>
        <span className="hidden text-xs font-medium text-[#eaecef]/70 sm:inline">{loadingMessages[messageIndex]}</span>
      </div>
    </div>
  );
}
