'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { LoadingOverlay } from './LoadingOverlay';

interface AppLoadingWrapperProps {
  children: React.ReactNode;
}

export function AppLoadingWrapper({ children }: AppLoadingWrapperProps) {
  const { isLoading } = useApp();

  return (
    <>
      {isLoading && <LoadingOverlay />}
      {children}
    </>
  );
}
