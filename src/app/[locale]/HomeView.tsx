'use client';

import React, { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useApp } from '@/context/AppContext';
import { EventCard } from '@/components/EventCard';
import { SectionOperations } from '@/components/home/SectionOperations';
import { FeaturedEventBanner } from '@/components/home/FeaturedEventBanner';
import {
  ArrowRight,
  MapPin,
  Phone,
  Search,
  ShieldCheck
} from 'lucide-react';
import { AppLocale, CommercialLeadCountry, Event, EventStatus } from '@/types';
import { compareEventsByDateAsc, compareEventsByDateDesc, getEventStatus } from '@/lib/eventStatus';

type LeadFormState = {
  managerName: string;
  phone: string;
  eventName: string;
  city: string;
  state: string;
  country: CommercialLeadCountry;
  countryOther: string;
  acceptedTerms: boolean;
};

const UF_OPTIONS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO'
];

// Pre-seleciona o pais mais provavel a partir do idioma que a pessoa esta
// navegando; o campo continua editavel, ja que idioma do site e pais do
// gestor nao sao a mesma coisa (ex.: brasileiro navegando em en-gb).
const DEFAULT_COUNTRY_BY_LOCALE: Record<AppLocale, CommercialLeadCountry> = {
  'pt-br': 'BR',
  'pt-pt': 'PT',
  'en-gb': 'GB'
};

const createEmptyLeadForm = (country: CommercialLeadCountry): LeadFormState => ({
  managerName: '',
  phone: '',
  eventName: '',
  city: '',
  state: '',
  country,
  countryOther: '',
  acceptedTerms: false
});

export function HomeView() {
  const t = useTranslations('Home');
  const tLeadForm = useTranslations('Home.LeadForm');
  const tCommon = useTranslations('Common');
  const locale = useLocale() as AppLocale;
  const defaultLeadCountry = DEFAULT_COUNTRY_BY_LOCALE[locale] || 'BR';
  const { events } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EventStatus>('all');
  const [leadFormOpen, setLeadFormOpen] = useState(false);
  const [leadForm, setLeadForm] = useState<LeadFormState>(() => createEmptyLeadForm(defaultLeadCountry));
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadErrorMessage, setLeadErrorMessage] = useState('');
  const [leadSuccessMessage, setLeadSuccessMessage] = useState('');

  const statusTabs: { id: 'all' | EventStatus; label: string }[] = [
    { id: 'all', label: t('filters.all') },
    { id: 'live', label: t('filters.live') },
    { id: 'upcoming', label: t('filters.upcoming') },
    { id: 'finished', label: t('filters.finished') }
  ];

  // Eventos abertos ficam em ordem cronológica crescente (o próximo a acontecer primeiro)
  // e os já encerrados vão para a seção de histórico, do mais recente para o mais antigo.
  const { upcomingEvents, pastEvents } = useMemo(() => {
    const upcoming: Event[] = [];
    const past: Event[] = [];

    events.forEach((event) => {
      const matchesSearch = event.name.toLowerCase().includes(searchQuery.toLowerCase())
        || event.location.toLowerCase().includes(searchQuery.toLowerCase());
      const lifecycle = getEventStatus(event);
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'finished' && lifecycle === 'finished')
        || (statusFilter === 'upcoming' && event.status === 'upcoming' && lifecycle !== 'finished')
        || (statusFilter === 'live' && event.status === 'live' && lifecycle !== 'finished');

      if (!matchesSearch || !matchesStatus) return;

      if (lifecycle === 'finished') {
        past.push(event);
      } else {
        upcoming.push(event);
      }
    });

    return {
      upcomingEvents: upcoming.sort(compareEventsByDateAsc),
      pastEvents: past.sort(compareEventsByDateDesc)
    };
  }, [events, searchQuery, statusFilter]);

  const handleLeadFieldChange = (field: keyof LeadFormState, value: string | boolean) => {
    setLeadForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleLeadCountryChange = (country: CommercialLeadCountry) => {
    setLeadForm((current) => ({
      ...current,
      country,
      // "Estado" tem formatos incompatíveis entre países (UF vs texto livre);
      // troca de país limpa o campo para não persistir um valor sem sentido.
      state: '',
      countryOther: country === 'OTHER' ? current.countryOther : ''
    }));
  };

  const handleLeadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLeadErrorMessage('');
    setLeadSuccessMessage('');

    if (!leadForm.acceptedTerms) {
      setLeadErrorMessage(tCommon('acceptTerms'));
      return;
    }

    try {
      setLeadSubmitting(true);

      const response = await fetch('/api/commercial-leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(leadForm)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || tLeadForm('errorFallback'));
      }

      setLeadSuccessMessage(
        data.message || tLeadForm('successFallback')
      );
      setLeadForm(createEmptyLeadForm(defaultLeadCountry));
      setLeadFormOpen(true);
    } catch (err) {
      setLeadErrorMessage(
        err instanceof Error ? err.message : tLeadForm('errorFallback')
      );
    } finally {
      setLeadSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SectionOperations />

      <FeaturedEventBanner openLeadModal={() => setLeadFormOpen(true)} />

      <section id="eventos" className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-12 pt-8 sm:space-y-8 sm:px-6 sm:pt-12 lg:px-8">
        <div className="home-broadcast-section-header flex flex-col justify-between gap-3 sm:flex-row sm:items-end" style={{ '--motion-delay': '120ms' } as React.CSSProperties}>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{t('kicker')}</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('title')}</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted">{t('subtitle')}</p>
        </div>

        <div className="home-broadcast-filters flex flex-col gap-4 rounded-xl border border-card-border bg-card p-4 md:flex-row md:items-center md:justify-between" style={{ '--motion-delay': '190ms' } as React.CSSProperties}>
          <div className="flex flex-wrap gap-1.5">
            {statusTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`min-h-10 rounded-md border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                  statusFilter === tab.id
                    ? 'border-primary bg-primary text-ink'
                    : 'border-card-border bg-dark-gray text-muted hover:border-muted hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:max-w-xs">
            <label htmlFor="event-search" className="sr-only">{t('searchLabel')}</label>
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="event-search"
              name="event-search"
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-card-border bg-dark-gray pl-10 pr-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {upcomingEvents.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingEvents.map((event, index) => (
              <div
                key={event.id}
                className="home-broadcast-event-card h-full"
                style={{ '--motion-delay': `${260 + Math.min(index, 5) * 45}ms` } as React.CSSProperties}
              >
                <EventCard event={event} priority={index === 0} />
              </div>
            ))}
          </div>
        ) : pastEvents.length > 0 ? (
          <div className="home-broadcast-empty rounded-xl border border-dashed border-card-border bg-card py-10 text-center">
            <p className="text-sm text-muted">{t('emptyWithPast')}</p>
          </div>
        ) : (
          <div className="home-broadcast-empty space-y-4 rounded-xl border border-dashed border-card-border bg-card py-20 text-center">
            <Search className="mx-auto h-12 w-12 text-muted" />
            <div className="space-y-1">
              <h4 className="text-lg font-bold uppercase tracking-wider text-white">{t('emptyTitle')}</h4>
              <p className="text-sm text-muted">{t('emptySubtitle')}</p>
            </div>
          </div>
        )}
      </section>

      {pastEvents.length > 0 && (
        <section id="eventos-passados" className="mx-auto w-full max-w-7xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
          <div className="home-broadcast-section-header flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">{t('pastKicker')}</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">{t('pastTitle')}</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted">{t('pastSubtitle')}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pastEvents.map((event, index) => (
              <div
                key={event.id}
                className="home-broadcast-event-card h-full"
                style={{ '--motion-delay': `${120 + Math.min(index, 5) * 35}ms` } as React.CSSProperties}
              >
                <EventCard event={event} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modal de Conversão Comercial */}
      {leadFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4" role="dialog" aria-modal="true">
          {/* Overlay de fundo */}
          <div
            className="home-broadcast-modal-overlay fixed inset-0 bg-black/85 backdrop-blur-sm transition-opacity"
            onClick={() => {
              setLeadFormOpen(false);
              setLeadErrorMessage('');
              setLeadSuccessMessage('');
            }}
            aria-hidden="true"
          />

          {/* Container do Modal */}
          <div className="home-broadcast-modal-panel relative transform overflow-hidden rounded-2xl border border-card-border bg-card p-6 shadow-2xl transition duration-200 max-w-lg w-full z-10">
            {/* Botão de Fechar */}
            <button
              type="button"
              onClick={() => {
                setLeadFormOpen(false);
                setLeadErrorMessage('');
                setLeadSuccessMessage('');
              }}
              className="absolute right-4 top-4 text-muted hover:text-white transition-colors p-1 rounded-lg hover:bg-dark-gray/50"
              aria-label={tLeadForm('closeAria')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="border-b border-card-border pb-4 pr-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{tLeadForm('kicker')}</p>
              <h3 className="mt-2 text-xl font-bold uppercase tracking-tight text-white">
                {tLeadForm('title')}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                {tLeadForm('description')}
              </p>
            </div>

            {leadSuccessMessage && (
              <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3">
                <p className="text-sm font-bold text-white">{tLeadForm('successTitle')}</p>
                <p className="mt-1 text-xs leading-6 text-primary">{leadSuccessMessage}</p>
              </div>
            )}

            {leadErrorMessage && (
              <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs leading-6 text-red-300">
                {leadErrorMessage}
              </div>
            )}

            {!leadSuccessMessage && (
              <form onSubmit={handleLeadSubmit} className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="lead-manager-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      {tLeadForm('managerNameLabel')}
                    </label>
                    <input
                      id="lead-manager-name"
                      type="text"
                      required
                      value={leadForm.managerName}
                      onChange={(e) => handleLeadFieldChange('managerName', e.target.value)}
                      placeholder={tLeadForm('managerNamePlaceholder')}
                      className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-phone" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      {tLeadForm('phoneLabel')}
                    </label>
                    <div className="relative">
                      <PhoneInputIcon />
                      <input
                        id="lead-phone"
                        type="tel"
                        required
                        value={leadForm.phone}
                        onChange={(e) => handleLeadFieldChange('phone', e.target.value)}
                        placeholder={tLeadForm('phonePlaceholder')}
                        className="h-11 w-full rounded-lg border border-card-border bg-dark-gray pl-10 pr-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="lead-event-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      {tLeadForm('eventNameLabel')}
                    </label>
                    <input
                      id="lead-event-name"
                      type="text"
                      required
                      value={leadForm.eventName}
                      onChange={(e) => handleLeadFieldChange('eventName', e.target.value)}
                      placeholder={tLeadForm('eventNamePlaceholder')}
                      className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-country" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      {tLeadForm('countryLabel')}
                    </label>
                    <select
                      id="lead-country"
                      required
                      value={leadForm.country}
                      onChange={(e) => handleLeadCountryChange(e.target.value as CommercialLeadCountry)}
                      className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm font-semibold text-white focus:border-primary focus:outline-none"
                    >
                      <option value="BR">{tLeadForm('countryOptionBr')}</option>
                      <option value="PT">{tLeadForm('countryOptionPt')}</option>
                      <option value="GB">{tLeadForm('countryOptionGb')}</option>
                      <option value="OTHER">{tLeadForm('countryOptionOther')}</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="lead-city" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      {tLeadForm('cityLabel')}
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                      <input
                        id="lead-city"
                        type="text"
                        required
                        value={leadForm.city}
                        onChange={(e) => handleLeadFieldChange('city', e.target.value)}
                        placeholder={tLeadForm('cityPlaceholder')}
                        className="h-11 w-full rounded-lg border border-card-border bg-dark-gray pl-10 pr-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  {leadForm.country === 'OTHER' && (
                    <div className="sm:col-span-2">
                      <label htmlFor="lead-country-other" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                        {tLeadForm('countryOtherLabel')}
                      </label>
                      <input
                        id="lead-country-other"
                        type="text"
                        required
                        value={leadForm.countryOther}
                        onChange={(e) => handleLeadFieldChange('countryOther', e.target.value)}
                        placeholder={tLeadForm('countryOtherPlaceholder')}
                        className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <label htmlFor="lead-state" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      {leadForm.country === 'BR'
                        ? tLeadForm('stateLabel')
                        : leadForm.country === 'PT'
                          ? tLeadForm('stateLabelPt')
                          : leadForm.country === 'GB'
                            ? tLeadForm('stateLabelGb')
                            : tLeadForm('stateLabelOther')}
                    </label>
                    {leadForm.country === 'BR' ? (
                      <select
                        id="lead-state"
                        required
                        value={leadForm.state}
                        onChange={(e) => handleLeadFieldChange('state', e.target.value)}
                        className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm font-semibold text-white focus:border-primary focus:outline-none"
                      >
                        <option value="">{tLeadForm('stateSelectPlaceholder')}</option>
                        {UF_OPTIONS.map((uf) => (
                          <option key={uf} value={uf}>{uf}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="lead-state"
                        type="text"
                        required
                        value={leadForm.state}
                        onChange={(e) => handleLeadFieldChange('state', e.target.value)}
                        placeholder={
                          leadForm.country === 'PT'
                            ? tLeadForm('statePlaceholderPt')
                            : leadForm.country === 'GB'
                              ? tLeadForm('statePlaceholderGb')
                              : tLeadForm('statePlaceholderOther')
                        }
                        className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                      />
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-card-border bg-dark-gray/20 p-4 text-xs leading-6 text-muted">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <p>
                      {tLeadForm.rich('privacyNotice', {
                        terms: (chunks) => (
                          <Link href="/termos" target="_blank" className="font-bold text-white underline transition-colors hover:text-primary">
                            {chunks}
                          </Link>
                        ),
                        privacy: (chunks) => (
                          <Link href="/termos#privacidade" target="_blank" className="font-bold text-white underline transition-colors hover:text-primary">
                            {chunks}
                          </Link>
                        )
                      })}
                    </p>
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-card-border bg-dark-gray/20 p-4">
                  <input
                    type="checkbox"
                    checked={leadForm.acceptedTerms}
                    onChange={(e) => handleLeadFieldChange('acceptedTerms', e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-card-border bg-dark-gray text-primary focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs leading-6 text-muted">
                    {tLeadForm('acceptTermsLabel')}
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={leadSubmitting || !leadForm.acceptedTerms}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-bold text-ink transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary/50 disabled:text-ink/70"
                >
                  {leadSubmitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent"></span>
                      {tLeadForm('submitting')}
                    </>
                  ) : (
                    <>
                      {tLeadForm('submit')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneInputIcon() {
  return <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />;
}
