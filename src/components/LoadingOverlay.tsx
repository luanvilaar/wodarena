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
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0b0e11]/95 backdrop-blur-md transition-opacity duration-300">
      {/* Container Principal com Efeito de Glow */}
      <div className="relative flex flex-col items-center justify-center">
        {/* Glow Dourado de Fundo */}
        <div className="absolute w-48 h-48 rounded-full bg-[#fcd535]/5 blur-3xl animate-pulse" />

        {/* Spinner e Logo Wrapper */}
        <div className="relative flex items-center justify-center w-36 h-36 mb-6">
          {/* Anel de Loading Externo Giratório */}
          <div className="absolute inset-0 rounded-full border-2 border-t-2 border-t-[#fcd535] border-r-transparent border-b-[#fcd535]/20 border-l-transparent animate-spin" style={{ animationDuration: '1.2s' }} />
          
          {/* Anel Secundário Oposto para dar profundidade */}
          <div className="absolute inset-2 rounded-full border border-b-2 border-b-[#fcd535]/80 border-t-transparent border-l-[#fcd535]/10 border-r-transparent animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />

          {/* Logo Central */}
          <img
            src="/Ativo_1.svg"
            alt="WODArena Logo"
            className="w-16 h-16 object-contain animate-pulse z-10"
          />
        </div>

        {/* Texto do Loading */}
        <div className="flex flex-col items-center space-y-1.5 text-center px-4">
          <span className="text-[#fcd535] font-bold text-xs uppercase tracking-widest animate-pulse">
            Carregando
          </span>
          <span className="text-[#eaecef]/70 text-sm font-medium transition-all duration-500 h-5">
            {loadingMessages[messageIndex]}
          </span>
        </div>
      </div>
    </div>
  );
}
