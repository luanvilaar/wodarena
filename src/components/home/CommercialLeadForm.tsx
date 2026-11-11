'use client';

import React, { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { BRAZIL_UFS } from '@/lib/eventPlace';
import type { AppLocale, CommercialLeadCountry } from '@/types';

// Formulário de contato comercial (Story 1.14). Até a Story 1.132 abria num
// modal da home; agora fica inline na página /organizadores.

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

const inputClass =
  'h-12 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-base text-white placeholder:text-muted focus:border-primary focus:outline-none sm:text-sm';
const labelClass = 'mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted';

export function CommercialLeadForm() {
  const tLeadForm = useTranslations('Home.LeadForm');
  const tCommon = useTranslations('Common');
  const locale = useLocale() as AppLocale;
  const defaultLeadCountry = DEFAULT_COUNTRY_BY_LOCALE[locale] || 'BR';
  const [leadForm, setLeadForm] = useState<LeadFormState>(() => createEmptyLeadForm(defaultLeadCountry));
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadErrorMessage, setLeadErrorMessage] = useState('');
  const [leadSuccessMessage, setLeadSuccessMessage] = useState('');

  const handleLeadFieldChange = (field: keyof LeadFormState, value: string | boolean) => {
    setLeadForm((current) => ({ ...current, [field]: value }));
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadForm)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || tLeadForm('errorFallback'));
      }
      setLeadSuccessMessage(data.message || tLeadForm('successFallback'));
      setLeadForm(createEmptyLeadForm(defaultLeadCountry));
    } catch (err) {
      setLeadErrorMessage(err instanceof Error ? err.message : tLeadForm('errorFallback'));
    } finally {
      setLeadSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-card-border bg-card p-5 sm:p-8">
      <div className="border-b border-card-border pb-5">
        <h2 className="type-display text-2xl text-white sm:text-3xl">{tLeadForm('title')}</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{tLeadForm('description')}</p>
      </div>

      {leadSuccessMessage && (
        <div role="status" aria-live="polite" className="mt-5 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3">
          <p className="text-sm font-bold text-white">{tLeadForm('successTitle')}</p>
          <p className="mt-1 text-xs leading-6 text-primary">{leadSuccessMessage}</p>
        </div>
      )}

      {leadErrorMessage && (
        <div role="alert" className="mt-5 rounded-xl border border-trading-down/40 bg-trading-down/10 px-4 py-3 text-sm leading-6 text-white">
          {leadErrorMessage}
        </div>
      )}

      {!leadSuccessMessage && (
        <form onSubmit={handleLeadSubmit} className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="lead-manager-name" className={labelClass}>{tLeadForm('managerNameLabel')}</label>
              <input
                id="lead-manager-name"
                type="text"
                required
                autoComplete="name"
                value={leadForm.managerName}
                onChange={(e) => handleLeadFieldChange('managerName', e.target.value)}
                placeholder={tLeadForm('managerNamePlaceholder')}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="lead-phone" className={labelClass}>{tLeadForm('phoneLabel')}</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  id="lead-phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  value={leadForm.phone}
                  onChange={(e) => handleLeadFieldChange('phone', e.target.value)}
                  placeholder={tLeadForm('phonePlaceholder')}
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="lead-event-name" className={labelClass}>{tLeadForm('eventNameLabel')}</label>
              <input
                id="lead-event-name"
                type="text"
                required
                value={leadForm.eventName}
                onChange={(e) => handleLeadFieldChange('eventName', e.target.value)}
                placeholder={tLeadForm('eventNamePlaceholder')}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="lead-country" className={labelClass}>{tLeadForm('countryLabel')}</label>
              <select
                id="lead-country"
                required
                value={leadForm.country}
                onChange={(e) => handleLeadCountryChange(e.target.value as CommercialLeadCountry)}
                className={`${inputClass} font-semibold`}
              >
                <option value="BR">{tLeadForm('countryOptionBr')}</option>
                <option value="PT">{tLeadForm('countryOptionPt')}</option>
                <option value="GB">{tLeadForm('countryOptionGb')}</option>
                <option value="OTHER">{tLeadForm('countryOptionOther')}</option>
              </select>
            </div>

            <div>
              <label htmlFor="lead-city" className={labelClass}>{tLeadForm('cityLabel')}</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  id="lead-city"
                  type="text"
                  required
                  autoComplete="address-level2"
                  value={leadForm.city}
                  onChange={(e) => handleLeadFieldChange('city', e.target.value)}
                  placeholder={tLeadForm('cityPlaceholder')}
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            {leadForm.country === 'OTHER' && (
              <div className="sm:col-span-2">
                <label htmlFor="lead-country-other" className={labelClass}>{tLeadForm('countryOtherLabel')}</label>
                <input
                  id="lead-country-other"
                  type="text"
                  required
                  value={leadForm.countryOther}
                  onChange={(e) => handleLeadFieldChange('countryOther', e.target.value)}
                  placeholder={tLeadForm('countryOtherPlaceholder')}
                  className={inputClass}
                />
              </div>
            )}

            <div className="sm:col-span-2">
              <label htmlFor="lead-state" className={labelClass}>
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
                  className={`${inputClass} font-semibold`}
                >
                  <option value="">{tLeadForm('stateSelectPlaceholder')}</option>
                  {BRAZIL_UFS.map((uf) => (
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
                  className={inputClass}
                />
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-card-border bg-dark-gray/40 p-4 text-xs leading-6 text-muted">
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

          <label className="flex items-start gap-3 rounded-xl border border-card-border bg-dark-gray/40 p-4">
            <input
              type="checkbox"
              checked={leadForm.acceptedTerms}
              onChange={(e) => handleLeadFieldChange('acceptedTerms', e.target.checked)}
              className="mt-1 h-5 w-5 rounded border-card-border bg-dark-gray text-primary focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs leading-6 text-muted">{tLeadForm('acceptTermsLabel')}</span>
          </label>

          <button
            type="submit"
            disabled={leadSubmitting || !leadForm.acceptedTerms}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-bold text-ink transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary/50 disabled:text-ink/70"
          >
            {leadSubmitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" aria-hidden="true" />
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
  );
}
