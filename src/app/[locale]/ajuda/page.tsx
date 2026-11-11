import type { Metadata } from 'next';
import NextLink from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronDown, Mail, MessageCircle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { readCompanyInfo, whatsappHref } from '@/lib/companyInfo';

// Central de ajuda do atleta (Story 1.135, P8 de docs/design/mobile-competitivo/).
// As respostas descrevem só o que o produto já faz; o canal de suporte da
// plataforma aparece quando configurado por variável de ambiente.
export const metadata: Metadata = {
  title: 'Ajuda | WODArena',
  description: 'Dúvidas frequentes de atletas sobre inscrição, pagamento, comprovante e ranking na WODArena.'
};

const QUESTIONS = ['voucher', 'pixPending', 'changeDivision', 'refund', 'ranking', 'password', 'teamData'] as const;

export default async function HelpPage() {
  const t = await getTranslations('Help');
  const company = readCompanyInfo();
  const hasSupport = Boolean(company.supportEmail || company.supportWhatsapp);

  return (
    <div className="min-h-screen bg-background">
      <section className="border-b border-card-border">
        <div className="mx-auto max-w-3xl px-4 pb-8 pt-8 sm:px-6 sm:pb-12 sm:pt-12">
          <h1 className="type-display text-balance text-[1.75rem] text-white sm:text-5xl">{t('title')}</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted">{t('lead')}</p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
        <section aria-labelledby="help-faq">
          <h2 id="help-faq" className="text-base font-bold uppercase tracking-wide text-white">{t('faqTitle')}</h2>
          <div className="mt-4 divide-y divide-card-border overflow-hidden rounded-xl border border-card-border bg-card">
            {QUESTIONS.map((key) => (
              <details key={key} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-[15px] font-semibold text-white sm:px-5 [&::-webkit-details-marker]:hidden">
                  {t(`q.${key}`)}
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted sm:px-5">{t(`a.${key}`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="help-contact" className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
          <h2 id="help-contact" className="text-base font-bold uppercase tracking-wide text-white">{t('contactTitle')}</h2>
          {hasSupport ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm leading-6 text-muted">{t('contactLead')}</p>
              {company.supportEmail && (
                <a href={`mailto:${company.supportEmail}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary hover:underline">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  {company.supportEmail}
                </a>
              )}
              {company.supportWhatsapp && (
                <a href={whatsappHref(company.supportWhatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary hover:underline">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {t('whatsapp')}
                </a>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">{t('contactOrganizer')}</p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <NextLink href="/admin#inscricoes" className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-bold text-ink transition-colors hover:bg-primary-hover">
              {t('myRegistrations')}
            </NextLink>
            <Link href="/" className="inline-flex min-h-11 items-center rounded-md border border-card-border px-5 text-sm font-bold text-white transition-colors hover:border-primary">
              {t('seeEvents')}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
