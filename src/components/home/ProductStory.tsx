'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, MonitorPlay, ServerCog, Smartphone } from 'lucide-react';
import { Link } from '@/i18n/navigation';

// "O resultado nasce na quadra" em três passos (Story 1.132, P2 de
// docs/design/mobile-competitivo/). Os passos são uma sequência de verdade
// (súmula -> servidor -> ranking/telão), por isso numerados. Na home fecha a
// página e leva a /organizadores; lá aparece sem o botão.
const STEPS = [
  { key: 'step1', icon: Smartphone },
  { key: 'step2', icon: ServerCog },
  { key: 'step3', icon: MonitorPlay },
] as const;

export function ProductStory({ withCta = false }: { withCta?: boolean }) {
  const t = useTranslations('Organizers');

  return (
    <section aria-labelledby="product-story-title" className="border-t border-card-border">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="max-w-2xl">
            <h2 id="product-story-title" className="type-display text-balance text-[1.75rem] text-white sm:text-4xl">
              {t('storyTitle')}
            </h2>
            <p className="mt-3 text-base leading-7 text-muted">{t('storyLead')}</p>
          </div>
          {withCta && (
            <Link
              href="/organizadores"
              className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover lg:self-auto"
            >
              {t('organizeCardTitle')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>

        <ol className="mt-8 grid gap-px overflow-hidden rounded-xl border border-card-border bg-card-border md:grid-cols-3">
          {STEPS.map(({ key, icon: Icon }, index) => (
            <li key={key} className="flex flex-col gap-3 bg-background p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <span className="lane-label">{t('stepLabel', { number: index + 1 })}</span>
                <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold leading-snug text-white">{t(`${key}Title`)}</h3>
              <p className="text-sm leading-6 text-muted">{t(`${key}Body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
