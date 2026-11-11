// Dados públicos da empresa e do suporte da plataforma (Story 1.135, P8 de
// docs/design/mobile-competitivo/). Vêm de variáveis de ambiente públicas e só
// aparecem quando configuradas: o site não inventa razão social, CNPJ ou canal.

export type CompanyInfo = {
  legalName: string | null;
  cnpj: string | null;
  supportEmail: string | null;
  supportWhatsapp: string | null;
};

const clean = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
};

export function readCompanyInfo(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_COMPANY_LEGAL_NAME: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME,
  NEXT_PUBLIC_COMPANY_CNPJ: process.env.NEXT_PUBLIC_COMPANY_CNPJ,
  NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_SUPPORT_WHATSAPP: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP,
}): CompanyInfo {
  const whatsappDigits = (env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');
  return {
    legalName: clean(env.NEXT_PUBLIC_COMPANY_LEGAL_NAME),
    cnpj: clean(env.NEXT_PUBLIC_COMPANY_CNPJ),
    supportEmail: clean(env.NEXT_PUBLIC_SUPPORT_EMAIL),
    supportWhatsapp: whatsappDigits.length >= 10 ? whatsappDigits : null,
  };
}

// Link do WhatsApp só com dígitos (wa.me exige o número com DDI).
export const whatsappHref = (digits: string) => `https://wa.me/${digits}`;
