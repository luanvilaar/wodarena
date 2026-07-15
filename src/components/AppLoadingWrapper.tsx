'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { LoadingOverlay } from './LoadingOverlay';

interface AppLoadingWrapperProps {
  children: React.ReactNode;
}

export function AppLoadingWrapper({ children }: AppLoadingWrapperProps) {
  const { isLoading, bootstrapStatus, bootstrapError, retryBootstrap } = useApp();

  return (
    <>
      {isLoading && <LoadingOverlay />}
      {(bootstrapStatus === 'error' || bootstrapStatus === 'degraded') && (
        <div
          className="fixed inset-x-4 top-20 z-[9998] mx-auto flex max-w-xl items-center justify-between gap-4 rounded-lg border border-red-500/30 bg-[#17191d]/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-md"
          role="alert"
        >
          <p className="leading-5 text-red-200">
            {bootstrapError || 'Alguns dados ainda não foram carregados.'}
          </p>
          <button
            type="button"
            onClick={retryBootstrap}
            className="shrink-0 rounded-md border border-primary/60 px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary hover:text-ink"
          >
            Tentar novamente
          </button>
        </div>
      )}
      {children}
    </>
  );
}
