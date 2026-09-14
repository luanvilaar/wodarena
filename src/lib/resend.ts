import { Registration, Athlete, Event, ContestationStatus, AppLocale } from '@/types';
import { getContestationStatusLabel } from '@/lib/contestations';
import { toBcp47 } from '@/i18n/locales';

// Locale das inscrições/usuários é opcional em pontos legados do banco; todo
// disparo de e-mail cai em pt-br quando ausente, mesmo default do resto do app.
const resolveLocale = (locale?: AppLocale | null): AppLocale =>
  locale === 'pt-pt' || locale === 'en-gb' ? locale : 'pt-br';

type ResendApiError = {
  status: number;
  body: unknown;
  message: string;
};

const getResendApiKey = () => process.env.RESEND_API_KEY || process.env.RESENDAPI_KEY;
const getResendFrom = () => process.env.RESEND_FROM_EMAIL || 'WODArena <noreply@wodarena.com.br>';

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const parseResendError = async (res: Response): Promise<ResendApiError> => {
  const rawBody = await res.text();
  let body: unknown = rawBody;

  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = rawBody || null;
  }

  const bodyMessage = typeof body === 'object' && body && 'message' in body
    ? String((body as { message?: unknown }).message || '')
    : '';

  return {
    status: res.status,
    body,
    message: bodyMessage || `Resend retornou HTTP ${res.status}`
  };
};

const PASSWORD_RESET_COPY: Record<AppLocale, {
  subject: string;
  title: string;
  eyebrow: string;
  h1: string;
  intro: (name: string, email: string) => string;
  instruction: (minutes: number) => string;
  button: string;
  noticeIntro: string;
  disclaimer: string;
  footer: string;
}> = {
  'pt-br': {
    subject: 'Recuperação de senha - WODArena',
    title: 'Recuperação de senha - WODArena',
    eyebrow: 'Acesso seguro',
    h1: 'Defina uma nova senha',
    intro: (name, email) => `Olá, <strong>${name}</strong>. Recebemos uma solicitação de recuperação de senha para o acesso vinculado a <strong>${email}</strong>.`,
    instruction: (minutes) => `Use o botão abaixo para criar uma nova senha. O link expira em <strong>${minutes} minutos</strong> e só pode ser usado uma vez.`,
    button: 'Criar nova senha',
    noticeIntro: 'Se o botão não abrir, copie e cole este link no navegador:',
    disclaimer: 'Se você não solicitou essa recuperação, ignore este e-mail. Sua senha atual continuará válida.',
    footer: 'Este e-mail foi enviado automaticamente pela WODArena. Nunca compartilhe este link com terceiros.'
  },
  'pt-pt': {
    subject: 'Recuperação de palavra-passe - WODArena',
    title: 'Recuperação de palavra-passe - WODArena',
    eyebrow: 'Acesso seguro',
    h1: 'Defina uma nova palavra-passe',
    intro: (name, email) => `Olá, <strong>${name}</strong>. Recebemos um pedido de recuperação de palavra-passe para o acesso associado a <strong>${email}</strong>.`,
    instruction: (minutes) => `Utilize o botão abaixo para criar uma nova palavra-passe. O link expira em <strong>${minutes} minutos</strong> e só pode ser utilizado uma vez.`,
    button: 'Criar nova palavra-passe',
    noticeIntro: 'Se o botão não abrir, copie e cole este link no navegador:',
    disclaimer: 'Se não pediu esta recuperação, ignore este e-mail. A sua palavra-passe atual mantém-se válida.',
    footer: 'Este e-mail foi enviado automaticamente pela WODArena. Nunca partilhe este link com terceiros.'
  },
  'en-gb': {
    subject: 'Password reset - WODArena',
    title: 'Password reset - WODArena',
    eyebrow: 'Secure access',
    h1: 'Set a new password',
    intro: (name, email) => `Hello, <strong>${name}</strong>. We received a password reset request for the account linked to <strong>${email}</strong>.`,
    instruction: (minutes) => `Use the button below to create a new password. The link expires in <strong>${minutes} minutes</strong> and can only be used once.`,
    button: 'Create new password',
    noticeIntro: "If the button doesn't open, copy and paste this link into your browser:",
    disclaimer: 'If you did not request this reset, ignore this email. Your current password remains valid.',
    footer: 'This email was sent automatically by WODArena. Never share this link with anyone.'
  }
};

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
  locale?: AppLocale;
}) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error('[Resend Password Reset] RESENDAPI_KEY não configurada no ambiente.');
    return { success: false, error: 'Chave de API do Resend ausente.' };
  }

  const locale = resolveLocale(params.locale);
  const c = PASSWORD_RESET_COPY[locale];
  const safeName = escapeHtml(params.userName || 'Atleta WODArena');
  const safeResetUrl = escapeHtml(params.resetUrl);
  const safeEmail = escapeHtml(params.toEmail);

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="${toBcp47(locale)}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${c.title}</title>
      <style>
        body { margin: 0; padding: 0; background: #f5f5f5; color: #181a20; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .wrapper { width: 100%; padding: 32px 0; background: #f5f5f5; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #eaecef; border-radius: 12px; overflow: hidden; }
        .header { background: #181a20; border-bottom: 3px solid #FCD535; padding: 26px 24px; text-align: center; }
        .brand { color: #FCD535; font-size: 20px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
        .body { padding: 32px 24px; }
        .eyebrow { display: inline-block; margin-bottom: 14px; border: 1px solid #d4a900; background: #fff7d6; color: #8a6a00; border-radius: 4px; padding: 6px 10px; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
        h1 { margin: 0 0 10px; font-size: 23px; line-height: 1.2; color: #181a20; text-transform: uppercase; }
        p { margin: 0 0 18px; color: #707a8a; font-size: 14px; line-height: 1.55; }
        .button-wrap { margin: 28px 0; text-align: center; }
        .button { display: inline-block; background: #FCD535; color: #181a20 !important; text-decoration: none; padding: 14px 22px; border-radius: 6px; font-size: 13px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
        .notice { border: 1px solid #eaecef; background: #fafafa; border-radius: 8px; padding: 14px; color: #707a8a; font-size: 12px; line-height: 1.5; }
        .url { word-break: break-all; color: #8a6a00; font-size: 12px; }
        .footer { border-top: 1px solid #eaecef; background: #fafafa; padding: 22px 24px; text-align: center; color: #707a8a; font-size: 11px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header"><div class="brand">WODArena</div></div>
          <div class="body">
            <span class="eyebrow">${c.eyebrow}</span>
            <h1>${c.h1}</h1>
            <p>${c.intro(safeName, safeEmail)}</p>
            <p>${c.instruction(params.expiresInMinutes)}</p>
            <div class="button-wrap">
              <a class="button" href="${safeResetUrl}" target="_blank" rel="noopener noreferrer">${c.button}</a>
            </div>
            <div class="notice">
              ${c.noticeIntro}<br>
              <span class="url">${safeResetUrl}</span>
            </div>
            <p style="margin-top: 18px;">${c.disclaimer}</p>
          </div>
          <div class="footer">
            ${c.footer}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getResendFrom(),
        to: params.toEmail,
        subject: c.subject,
        html: htmlContent,
      }),
    });

    if (!res.ok) {
      const errorData = await parseResendError(res);
      console.error('[Resend Password Reset] Erro na API do Resend:', errorData);
      return { success: false, error: errorData };
    }

    const data = await res.json();
    return { success: true, messageId: data.id };
  } catch (err) {
    console.error('[Resend Password Reset] Erro crítico ao enviar e-mail:', err);
    return { success: false, error: err };
  }
}

type RegistrationEmailCopy = {
  metaTitle: string;
  eyebrowBrand: string;
  badgeConfirmed: string;
  badgeRegistered: string;
  titleConfirmed: string;
  titleRegistered: string;
  greeting: (name: string, eventName: string, statusLabel: string) => string;
  suffixConfirmed: (journeyWord: string) => string;
  suffixPending: string;
  statusLabels: { failed: string; inReview: string; cancelled: string; pending: string; approved: string };
  eventTypeLabels: { fitnessRacing: string; qualifier: string; default: string };
  journeyWord: { racing: string; default: string };
  fields: {
    registrationId: string;
    competition: string;
    category: string;
    athleteTeam: string;
    membersPrefix: string;
    box: string;
    boxFallback: string;
    taxId: string;
    eventDate: string;
    location: string;
    cityRegion: string;
    totalPaid: string;
    paymentStatus: string;
  };
  validation: {
    validatedTitle: string;
    registeredTitle: string;
    validatedText: string;
    registeredText: string;
    guardIdSuffix: string;
  };
  footer: {
    emittedBy: string;
    perEventOrganizers: string;
    instagramLabel: string;
    websiteLabel: string;
    termsLabel: string;
    privacyLabel: string;
  };
  subject: (statusApproved: boolean, eventName: string) => string;
};

const REGISTRATION_EMAIL_COPY: Record<AppLocale, RegistrationEmailCopy> = {
  'pt-br': {
    metaTitle: 'Confirmação de Inscrição - WODArena',
    eyebrowBrand: 'Plataforma oficial de inscrições',
    badgeConfirmed: 'Inscrição Confirmada',
    badgeRegistered: 'Inscrição Registrada',
    titleConfirmed: 'Sua inscrição está confirmada!',
    titleRegistered: 'Sua inscrição foi registrada',
    greeting: (name, eventName, statusLabel) => `Olá, <strong>${name}</strong>. Sua inscrição para <strong>${eventName}</strong> foi registrada na WODArena. Status atual: <strong>${statusLabel}</strong>.`,
    suffixConfirmed: (journeyWord) => `Abaixo estão os detalhes oficiais de ${journeyWord}.`,
    suffixPending: 'A participação no evento depende da regularização do pagamento.',
    statusLabels: {
      failed: 'Pagamento não processado',
      inReview: 'Pagamento em análise',
      cancelled: 'Pagamento cancelado',
      pending: 'Pagamento pendente',
      approved: 'Pagamento aprovado'
    },
    eventTypeLabels: { fitnessRacing: 'Fitness Racing', qualifier: 'Functional Fitness Qualifier', default: 'Functional Fitness' },
    journeyWord: { racing: 'seu percurso', default: 'sua bateria' },
    fields: {
      registrationId: 'ID da Inscrição',
      competition: 'Competição',
      category: 'Categoria / Divisão',
      athleteTeam: 'Atleta / Equipe',
      membersPrefix: 'Integrantes',
      box: 'Box / Afiliado',
      boxFallback: 'Independente',
      taxId: 'CPF do Pagador',
      eventDate: 'Data do Evento',
      location: 'Local',
      cityRegion: 'Cidade / Estado',
      totalPaid: 'Total Pago',
      paymentStatus: 'Status do Pagamento'
    },
    validation: {
      validatedTitle: 'INSCRIÇÃO VALIDADA',
      registeredTitle: 'INSCRIÇÃO REGISTRADA',
      validatedText: 'Este comprovante confirma a sua inscrição no evento.',
      registeredText: 'Este registro não confirma a vaga financeiramente até a regularização do pagamento.',
      guardIdSuffix: 'Guarde o ID da inscrição para consultas com a organização.'
    },
    footer: {
      emittedBy: 'Este comprovante foi emitido digitalmente e de forma automática pela <strong>WODArena</strong>.',
      perEventOrganizers: 'Cada evento possui organizadores independentes. Em caso de dúvidas sobre cronogramas, kits ou locais, entre em contato diretamente com a organização do evento.',
      instagramLabel: 'Instagram do evento',
      websiteLabel: 'Site do evento',
      termsLabel: 'Termos de Inscrição',
      privacyLabel: 'Políticas de Privacidade'
    },
    subject: (approved, eventName) => `${approved ? 'Inscrição Confirmada' : 'Inscrição Registrada'} - ${eventName}`
  },
  'pt-pt': {
    metaTitle: 'Confirmação de Inscrição - WODArena',
    eyebrowBrand: 'Plataforma oficial de inscrições',
    badgeConfirmed: 'Inscrição Confirmada',
    badgeRegistered: 'Inscrição Registada',
    titleConfirmed: 'A sua inscrição está confirmada!',
    titleRegistered: 'A sua inscrição foi registada',
    greeting: (name, eventName, statusLabel) => `Olá, <strong>${name}</strong>. A sua inscrição para <strong>${eventName}</strong> foi registada na WODArena. Estado atual: <strong>${statusLabel}</strong>.`,
    suffixConfirmed: (journeyWord) => `Encontra abaixo os detalhes oficiais de ${journeyWord}.`,
    suffixPending: 'A participação no evento depende da regularização do pagamento.',
    statusLabels: {
      failed: 'Pagamento não processado',
      inReview: 'Pagamento em análise',
      cancelled: 'Pagamento cancelado',
      pending: 'Pagamento pendente',
      approved: 'Pagamento aprovado'
    },
    eventTypeLabels: { fitnessRacing: 'Fitness Racing', qualifier: 'Qualifier de Fitness Funcional', default: 'Fitness Funcional' },
    journeyWord: { racing: 'o seu percurso', default: 'a sua bateria' },
    fields: {
      registrationId: 'ID da Inscrição',
      competition: 'Competição',
      category: 'Categoria / Divisão',
      athleteTeam: 'Atleta / Equipa',
      membersPrefix: 'Elementos',
      box: 'Box / Afiliado',
      boxFallback: 'Independente',
      taxId: 'NIF do Pagador',
      eventDate: 'Data do Evento',
      location: 'Local',
      cityRegion: 'Cidade / Região',
      totalPaid: 'Total Pago',
      paymentStatus: 'Estado do Pagamento'
    },
    validation: {
      validatedTitle: 'INSCRIÇÃO VALIDADA',
      registeredTitle: 'INSCRIÇÃO REGISTADA',
      validatedText: 'Este comprovativo confirma a sua inscrição no evento.',
      registeredText: 'Este registo não confirma a vaga financeiramente até à regularização do pagamento.',
      guardIdSuffix: 'Guarde o ID da inscrição para consultas com a organização.'
    },
    footer: {
      emittedBy: 'Este comprovativo foi emitido digitalmente e de forma automática pela <strong>WODArena</strong>.',
      perEventOrganizers: 'Cada evento tem organizadores independentes. Em caso de dúvidas sobre horários, kits ou locais, contacte diretamente a organização do evento.',
      instagramLabel: 'Instagram do evento',
      websiteLabel: 'Site do evento',
      termsLabel: 'Termos de Inscrição',
      privacyLabel: 'Política de Privacidade'
    },
    subject: (approved, eventName) => `${approved ? 'Inscrição Confirmada' : 'Inscrição Registada'} - ${eventName}`
  },
  'en-gb': {
    metaTitle: 'Registration Confirmation - WODArena',
    eyebrowBrand: 'Official registration platform',
    badgeConfirmed: 'Registration Confirmed',
    badgeRegistered: 'Registration Recorded',
    titleConfirmed: 'Your registration is confirmed!',
    titleRegistered: 'Your registration has been recorded',
    greeting: (name, eventName, statusLabel) => `Hello, <strong>${name}</strong>. Your registration for <strong>${eventName}</strong> has been recorded with WODArena. Current status: <strong>${statusLabel}</strong>.`,
    suffixConfirmed: (journeyWord) => `Below are the official details for ${journeyWord}.`,
    suffixPending: 'Your participation in the event depends on the payment being settled.',
    statusLabels: {
      failed: 'Payment not processed',
      inReview: 'Payment under review',
      cancelled: 'Payment cancelled',
      pending: 'Payment pending',
      approved: 'Payment approved'
    },
    eventTypeLabels: { fitnessRacing: 'Fitness Racing', qualifier: 'Functional Fitness Qualifier', default: 'Functional Fitness' },
    journeyWord: { racing: 'your course', default: 'your heat' },
    fields: {
      registrationId: 'Registration ID',
      competition: 'Competition',
      category: 'Category / Division',
      athleteTeam: 'Athlete / Team',
      membersPrefix: 'Members',
      box: 'Box / Affiliate',
      boxFallback: 'Independent',
      taxId: 'Payer Tax ID',
      eventDate: 'Event Date',
      location: 'Venue',
      cityRegion: 'City / Region',
      totalPaid: 'Total Paid',
      paymentStatus: 'Payment Status'
    },
    validation: {
      validatedTitle: 'REGISTRATION VALIDATED',
      registeredTitle: 'REGISTRATION RECORDED',
      validatedText: 'This voucher confirms your registration for the event.',
      registeredText: 'This record does not confirm your spot financially until the payment is settled.',
      guardIdSuffix: 'Keep the registration ID for enquiries with the organiser.'
    },
    footer: {
      emittedBy: 'This voucher was issued digitally and automatically by <strong>WODArena</strong>.',
      perEventOrganizers: 'Each event has independent organisers. For questions about schedules, kits or venues, please contact the event organiser directly.',
      instagramLabel: 'Event Instagram',
      websiteLabel: 'Event website',
      termsLabel: 'Registration Terms',
      privacyLabel: 'Privacy Policy'
    },
    subject: (approved, eventName) => `${approved ? 'Registration Confirmed' : 'Registration Recorded'} - ${eventName}`
  }
};

/**
 * Envia um e-mail de confirmação de inscrição para o atleta utilizando a API do Resend.
 */
export async function sendRegistrationEmail(
  registration: Registration,
  athlete: Athlete,
  event: Event,
  cpf: string = '',
  locale?: AppLocale
) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error('[Resend Email Service] RESENDAPI_KEY não configurada no ambiente.');
    return { success: false, error: 'Chave de API do Resend ausente.' };
  }

  const resolvedLocale = resolveLocale(locale ?? registration.locale ?? event.defaultLocale);
  const c = REGISTRATION_EMAIL_COPY[resolvedLocale];

  // Mascarar CPF (formato brasileiro; NIF/Tax ID de outros países aparecem sem máscara)
  const cleanCpf = cpf.replace(/\D/g, '');
  const maskedCpf = resolvedLocale === 'pt-br' && cleanCpf.length === 11
    ? `***.${cleanCpf.substring(3, 6)}.${cleanCpf.substring(6, 9)}-**`
    : cpf;

  const totalPaidFormatted = new Intl.NumberFormat(toBcp47(resolvedLocale), {
    style: 'currency',
    currency: event.currency || 'BRL'
  }).format(registration.totalPaid);

  const paymentStatus = registration.paymentStatus || 'payment_approved';
  const isPaymentApproved = paymentStatus === 'payment_approved';
  const statusLabel = paymentStatus === 'payment_failed'
    ? c.statusLabels.failed
    : paymentStatus === 'payment_in_review'
      ? c.statusLabels.inReview
      : paymentStatus === 'payment_cancelled'
        ? c.statusLabels.cancelled
        : paymentStatus === 'payment_pending'
          ? c.statusLabels.pending
          : c.statusLabels.approved;

  const isTeam = athlete.isTeam || false;
  const teamMembersList = isTeam && athlete.teamMembers && athlete.teamMembers.length > 0
    ? athlete.teamMembers.map(m => m.name).join(', ')
    : '';

  // Recursos visuais do evento (banner no topo, logo em selo sobreposto)
  const safeEventName = escapeHtml(event.name || 'Evento WODArena');
  const safeBannerUrl = event.bannerUrl ? escapeHtml(event.bannerUrl) : '';
  const safeLogoUrl = event.logoUrl ? escapeHtml(event.logoUrl) : '';
  const hasBanner = Boolean(safeBannerUrl);
  const hasLogo = Boolean(safeLogoUrl);

  // Categoria do evento (mesma lógica de rótulo usada no card de destaque da home)
  const eventTypeLabel = event.eventType === 'fitness_racing'
    ? c.eventTypeLabels.fitnessRacing
    : event.eventType === 'functional_fitness_qualifier'
      ? c.eventTypeLabels.qualifier
      : c.eventTypeLabels.default;
  const journeyWord = event.eventType === 'fitness_racing' ? c.journeyWord.racing : c.journeyWord.default;

  const safeCity = event.city ? escapeHtml(event.city) : '';
  const safeState = event.state ? escapeHtml(event.state) : '';
  const cityStateLabel = [safeCity, safeState].filter(Boolean).join(' / ');

  // Links oficiais do evento (mesma normalização usada na página pública do evento)
  const instagramHandle = event.instagram ? event.instagram.trim().replace(/^@+/, '') : '';
  const safeInstagramHref = instagramHandle ? `https://instagram.com/${escapeHtml(instagramHandle)}` : '';
  const safeWebsiteHref = event.website
    ? escapeHtml(event.website.startsWith('http') ? event.website : `https://${event.website}`)
    : '';

  // Template HTML do E-mail (Estilo Binance Flat / Visual Profissional)
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="${toBcp47(resolvedLocale)}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${c.metaTitle}</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background-color: #fafafa;
          color: #181a20;
          -webkit-font-smoothing: antialiased;
        }
        .wrapper {
          width: 100%;
          background-color: #fafafa;
          padding: 30px 0;
        }
        .container {
          max-width: 580px;
          margin: 0 auto;
          background-color: #ffffff;
          border: 1px solid #eaecef;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        .body {
          padding: 32px 24px;
        }
        .success-badge {
          display: inline-block;
          background-color: #0ecb81;
          color: #ffffff;
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding: 6px 12px;
          border-radius: 4px;
          margin-bottom: 16px;
        }
        .title {
          font-size: 22px;
          font-weight: 800;
          margin-top: 0;
          margin-bottom: 8px;
          color: #181a20;
          text-transform: uppercase;
          letter-spacing: -0.3px;
        }
        .subtitle {
          font-size: 14px;
          color: #707a8a;
          margin-top: 0;
          margin-bottom: 24px;
          line-height: 1.5;
        }
        .divider {
          border: 0;
          border-top: 1px solid #eaecef;
          margin: 24px 0;
        }
        .dashed-divider {
          border: 0;
          border-top: 2px dashed #eaecef;
          margin: 24px 0;
        }
        .ticket-info {
          width: 100%;
          border-collapse: collapse;
        }
        .ticket-info td {
          padding: 8px 0;
          vertical-align: top;
          font-size: 13px;
        }
        .label {
          color: #707a8a;
          font-weight: bold;
          text-transform: uppercase;
          font-size: 10px;
          letter-spacing: 0.05em;
          width: 40%;
        }
        .value {
          color: #181a20;
          font-weight: bold;
        }
        .value-mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          color: #181a20;
          font-weight: bold;
        }
        .validation-section {
          text-align: center;
          padding: 20px;
          background-color: #fafafa;
          border-radius: 8px;
          border: 1px solid #eaecef;
          margin-top: 16px;
        }
        .validation-title {
          font-size: 11px;
          font-weight: 800;
          color: #181a20;
          letter-spacing: 0.1em;
          margin-bottom: 6px;
        }
        .validation-text {
          font-size: 10px;
          color: #707a8a;
          max-width: 320px;
          margin: 0 auto;
          line-height: 1.4;
        }
        .footer {
          background-color: #fafafa;
          border-top: 1px solid #eaecef;
          padding: 24px;
          text-align: center;
          font-size: 11px;
          color: #707a8a;
          line-height: 1.5;
        }
        .footer a {
          color: #9a7200;
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          
          <!-- Header: o evento é o protagonista visual; a WODArena vira selo discreto -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
            <tr>
              <td style="background-color: #181a20; padding: 10px 24px; text-align: center; border-bottom: 3px solid #FCD535;">
                <span style="color: #FCD535; font-size: 11px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">WODArena</span>
                <span style="color: #707a8a; font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-left: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">${c.eyebrowBrand}</span>
              </td>
            </tr>
            ${hasBanner ? `
            <tr>
              <td style="background-color: #0b0e11; padding: 0; font-size: 0; line-height: 0;">
                <img src="${safeBannerUrl}" alt="${safeEventName}" width="580" style="display: block; width: 100%; max-width: 580px; height: auto; border: 0; outline: none; text-decoration: none;">
              </td>
            </tr>` : ''}
            ${hasLogo ? `
            <tr>
              <td style="background-color: #ffffff; text-align: center; padding: 0;">
                <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: ${hasBanner ? '-40px' : '28px'} auto 0 auto;">
                  <tr>
                    <td style="background-color: #ffffff; border: 1px solid #eaecef; border-radius: 12px; padding: ${hasBanner ? '8px' : '12px'}; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
                      <img src="${safeLogoUrl}" alt="${safeEventName} logo" width="${hasBanner ? '72' : '96'}" height="${hasBanner ? '72' : '96'}" style="display: block; width: ${hasBanner ? '72px' : '96px'}; height: ${hasBanner ? '72px' : '96px'}; border-radius: 8px; border: 0;">
                    </td>
                  </tr>
                </table>
                ${!hasBanner ? `<div style="padding: 14px 24px 0; font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.3px; color: #181a20; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">${safeEventName}</div>` : ''}
              </td>
            </tr>` : ''}
            ${!hasBanner && !hasLogo ? `
            <tr>
              <td style="background-color: #0b0e11; padding: 34px 24px; text-align: center;">
                <div style="color: #FCD535; font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">${eventTypeLabel}</div>
                <div style="color: #ffffff; font-size: 26px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.4px; line-height: 1.15; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">${safeEventName}</div>
              </td>
            </tr>` : ''}
          </table>
          
          <!-- Body Content -->
          <div class="body">
            <div style="margin-bottom: 16px;">
              <span class="success-badge" style="margin-right: 6px; margin-bottom: 0;">${isPaymentApproved ? c.badgeConfirmed : c.badgeRegistered}</span>
              <span style="display: inline-block; background-color: #fff7d6; color: #8a6a00; border: 1px solid #d4a900; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; padding: 6px 10px; border-radius: 4px;">${eventTypeLabel}</span>
            </div>
            <h1 class="title">${isPaymentApproved ? c.titleConfirmed : c.titleRegistered}</h1>
            <p class="subtitle">
              ${c.greeting(registration.athleteName, event.name, statusLabel)}
              ${isPaymentApproved ? c.suffixConfirmed(journeyWord) : c.suffixPending}
            </p>

            <div class="divider"></div>

            <!-- Detalhes do Evento & Atleta -->
            <table class="ticket-info">
              <tr>
                <td class="label">${c.fields.registrationId}</td>
                <td class="value-mono">${registration.id}</td>
              </tr>
              <tr>
                <td class="label">${c.fields.competition}</td>
                <td class="value">${event.name}</td>
              </tr>
              <tr>
                <td class="label">${c.fields.category}</td>
                <td class="value">${registration.ticketType}</td>
              </tr>
              <tr>
                <td class="label">${c.fields.athleteTeam}</td>
                <td class="value">
                  ${registration.athleteName}
                  ${isTeam ? `<br><span style="font-size: 11px; font-weight: normal; color: #707a8a;">${c.fields.membersPrefix}: ${teamMembersList}</span>` : ''}
                </td>
              </tr>
              <tr>
                <td class="label">${c.fields.box}</td>
                <td class="value">${registration.box || c.fields.boxFallback}</td>
              </tr>
              ${cpf ? `
              <tr>
                <td class="label">${c.fields.taxId}</td>
                <td class="value-mono">${maskedCpf}</td>
              </tr>` : ''}
              <tr>
                <td class="label">${c.fields.eventDate}</td>
                <td class="value">${event.date}</td>
              </tr>
              <tr>
                <td class="label">${c.fields.location}</td>
                <td class="value">${event.location}</td>
              </tr>
              ${cityStateLabel ? `
              <tr>
                <td class="label">${c.fields.cityRegion}</td>
                <td class="value">${cityStateLabel}</td>
              </tr>` : ''}
              <tr>
                <td class="label">${c.fields.totalPaid}</td>
                <td class="value" style="color: #0ecb81; font-size: 15px;">${totalPaidFormatted}</td>
              </tr>
              <tr>
                <td class="label">${c.fields.paymentStatus}</td>
                <td class="value">${statusLabel}</td>
              </tr>
            </table>

            <div class="dashed-divider"></div>

            <!-- Validação da Inscrição -->
            <div class="validation-section">
              <div class="validation-title">${isPaymentApproved ? c.validation.validatedTitle : c.validation.registeredTitle}</div>
              <p class="validation-text">
                ${isPaymentApproved ? c.validation.validatedText : c.validation.registeredText}
                ${c.validation.guardIdSuffix}
              </p>
            </div>

          </div>

          <!-- Footer -->
          <div class="footer">
            <p>${c.footer.emittedBy}</p>
            <p>
              ${c.footer.perEventOrganizers}
            </p>
            ${(safeInstagramHref || safeWebsiteHref) ? `
            <p style="margin-top: 16px;">
              ${safeInstagramHref ? `<a href="${safeInstagramHref}" target="_blank" rel="noopener noreferrer">${c.footer.instagramLabel}</a>` : ''}
              ${safeInstagramHref && safeWebsiteHref ? ' &bull; ' : ''}
              ${safeWebsiteHref ? `<a href="${safeWebsiteHref}" target="_blank" rel="noopener noreferrer">${c.footer.websiteLabel}</a>` : ''}
            </p>` : ''}
            <p style="margin-top: 16px;">
              <a href="https://wodarena.com/termos" target="_blank">${c.footer.termsLabel}</a> &bull;
              <a href="https://wodarena.com/termos#privacidade" target="_blank">${c.footer.privacyLabel}</a>
            </p>
          </div>
          
        </div>
      </div>
    </body>
    </html>
  `;

  // Disparo do E-mail utilizando o fetch para a API do Resend
  try {
    const toEmail = athlete.email || registration.athleteEmail;
    if (!toEmail || toEmail.includes('nao-informado@wodarena.com')) {
      console.warn('[Resend Email Service] E-mail do atleta não disponível ou inválido. Abortando envio.');
      return { success: false, error: 'E-mail do destinatário ausente ou inválido.' };
    }

    console.log(`[Resend Email Service] Disparando e-mail de confirmação para ${toEmail}...`);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getResendFrom(),
        to: toEmail,
        subject: c.subject(isPaymentApproved, event.name),
        html: htmlContent,
      }),
    });

    if (!res.ok) {
      const errorData = await parseResendError(res);
      console.error('[Resend Email Service] Erro na API do Resend:', errorData);
      return { success: false, error: errorData };
    }

    const data = await res.json();
    console.log(`[Resend Email Service] E-mail enviado com sucesso! ID da mensagem: ${data.id}`);
    return { success: true, messageId: data.id };
  } catch (err) {
    console.error('[Resend Email Service] Erro crítico ao processar requisição do Resend:', err);
    return { success: false, error: err };
  }
}

const CONTESTATION_EMAIL_COPY: Record<AppLocale, {
  title: string;
  eyebrow: string;
  h1: string;
  intro: (name: string, event: string) => string;
  labels: { status: string; workout: string; heat: string; lane: string };
  statusLabels: { approved: string; rejected: string; underReview: string };
  creditMessage: (status: ContestationStatus, refunded: boolean) => string;
  managerNotePrefix: string;
  footer: string;
  subject: (eventName: string) => string;
}> = {
  'pt-br': {
    title: 'Atualização de contestação - WODArena',
    eyebrow: 'Contestação de prova',
    h1: 'Status atualizado',
    intro: (name, event) => `Olá, <strong>${name}</strong>. Houve uma atualização na sua contestação registrada para o evento <strong>${event}</strong>.`,
    labels: { status: 'Status', workout: 'Prova', heat: 'Bateria', lane: 'Raia' },
    statusLabels: { approved: 'Deferida', rejected: 'Indeferida', underReview: 'Em análise' },
    creditMessage: (status, refunded) => status === 'approved'
      ? (refunded
        ? 'Seu crédito utilizado foi devolvido pela organização.'
        : 'Sua contestação foi deferida, mas o crédito utilizado segue consumido conforme regra definida pela organização.')
      : status === 'rejected'
        ? 'Sua contestação foi indeferida e o crédito utilizado foi perdido.'
        : 'Sua contestação segue em análise pela organização.',
    managerNotePrefix: 'Observação da organização:',
    footer: 'Esta mensagem foi enviada automaticamente pela WODArena para manter você atualizado sobre o recurso aberto no painel do atleta.',
    subject: (eventName) => `Atualização da contestação - ${eventName}`
  },
  'pt-pt': {
    title: 'Atualização de contestação - WODArena',
    eyebrow: 'Contestação de prova',
    h1: 'Estado atualizado',
    intro: (name, event) => `Olá, <strong>${name}</strong>. Houve uma atualização na sua contestação registada para o evento <strong>${event}</strong>.`,
    labels: { status: 'Estado', workout: 'Prova', heat: 'Bateria', lane: 'Raia' },
    statusLabels: { approved: 'Deferida', rejected: 'Indeferida', underReview: 'Em análise' },
    creditMessage: (status, refunded) => status === 'approved'
      ? (refunded
        ? 'O crédito utilizado foi devolvido pela organização.'
        : 'A sua contestação foi deferida, mas o crédito utilizado mantém-se consumido conforme a regra definida pela organização.')
      : status === 'rejected'
        ? 'A sua contestação foi indeferida e o crédito utilizado foi perdido.'
        : 'A sua contestação continua em análise pela organização.',
    managerNotePrefix: 'Observação da organização:',
    footer: 'Esta mensagem foi enviada automaticamente pela WODArena para o manter atualizado sobre o recurso aberto no painel do atleta.',
    subject: (eventName) => `Atualização da contestação - ${eventName}`
  },
  'en-gb': {
    title: 'Dispute update - WODArena',
    eyebrow: 'Score dispute',
    h1: 'Status updated',
    intro: (name, event) => `Hello, <strong>${name}</strong>. There has been an update to your dispute registered for the event <strong>${event}</strong>.`,
    labels: { status: 'Status', workout: 'Workout', heat: 'Heat', lane: 'Lane' },
    statusLabels: { approved: 'Upheld', rejected: 'Rejected', underReview: 'Under review' },
    creditMessage: (status, refunded) => status === 'approved'
      ? (refunded
        ? 'Your used credit has been refunded by the organiser.'
        : 'Your dispute was upheld, but the used credit remains consumed per the rule set by the organiser.')
      : status === 'rejected'
        ? 'Your dispute was rejected and the used credit was lost.'
        : 'Your dispute is still under review by the organiser.',
    managerNotePrefix: 'Organiser note:',
    footer: 'This message was sent automatically by WODArena to keep you updated on the appeal opened in the athlete dashboard.',
    subject: (eventName) => `Dispute update - ${eventName}`
  }
};

export async function sendContestationStatusEmail(params: {
  toEmail: string;
  athleteName: string;
  eventName: string;
  workoutName: string;
  heatLabel: string;
  lane: string;
  status: ContestationStatus;
  creditRefunded: boolean;
  managerNote?: string;
  locale?: AppLocale;
}) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error('[Resend Contestation] RESENDAPI_KEY não configurada no ambiente.');
    return { success: false, error: 'Chave de API do Resend ausente.' };
  }

  const resolvedLocale = resolveLocale(params.locale);
  const c = CONTESTATION_EMAIL_COPY[resolvedLocale];
  const safeAthleteName = escapeHtml(params.athleteName || 'Atleta');
  const safeEventName = escapeHtml(params.eventName || 'Evento WODArena');
  const safeWorkoutName = escapeHtml(params.workoutName || 'Prova');
  const safeHeatLabel = escapeHtml(params.heatLabel || 'Bateria informada');
  const safeLane = escapeHtml(params.lane || '-');
  const safeManagerNote = params.managerNote ? escapeHtml(params.managerNote) : '';
  const statusLabel = resolvedLocale === 'pt-br'
    ? getContestationStatusLabel(params.status)
    : params.status === 'approved'
      ? c.statusLabels.approved
      : params.status === 'rejected'
        ? c.statusLabels.rejected
        : c.statusLabels.underReview;

  const creditMessage = c.creditMessage(params.status, params.creditRefunded);

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="${toBcp47(resolvedLocale)}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${c.title}</title>
      <style>
        body { margin: 0; padding: 0; background: #f5f5f5; color: #181a20; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .wrapper { width: 100%; padding: 32px 0; background: #f5f5f5; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #eaecef; border-radius: 12px; overflow: hidden; }
        .header { background: #181a20; border-bottom: 3px solid #FCD535; padding: 24px; text-align: center; }
        .brand { color: #FCD535; font-size: 20px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
        .body { padding: 32px 24px; }
        .eyebrow { display: inline-block; margin-bottom: 14px; border: 1px solid #d4a900; background: #fff7d6; color: #8a6a00; border-radius: 4px; padding: 6px 10px; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
        h1 { margin: 0 0 10px; font-size: 23px; line-height: 1.2; color: #181a20; text-transform: uppercase; }
        p { margin: 0 0 16px; color: #707a8a; font-size: 14px; line-height: 1.55; }
        .info { width: 100%; border-collapse: collapse; margin-top: 18px; }
        .info td { padding: 8px 0; vertical-align: top; font-size: 13px; }
        .label { color: #707a8a; font-weight: 800; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; width: 36%; }
        .value { color: #181a20; font-weight: 700; }
        .notice { border: 1px solid #eaecef; background: #fafafa; border-radius: 8px; padding: 14px; color: #707a8a; font-size: 12px; line-height: 1.5; }
        .footer { border-top: 1px solid #eaecef; background: #fafafa; padding: 22px 24px; text-align: center; color: #707a8a; font-size: 11px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header"><div class="brand">WODArena</div></div>
          <div class="body">
            <span class="eyebrow">${c.eyebrow}</span>
            <h1>${c.h1}</h1>
            <p>${c.intro(safeAthleteName, safeEventName)}</p>
            <table class="info">
              <tr><td class="label">${c.labels.status}</td><td class="value">${statusLabel}</td></tr>
              <tr><td class="label">${c.labels.workout}</td><td class="value">${safeWorkoutName}</td></tr>
              <tr><td class="label">${c.labels.heat}</td><td class="value">${safeHeatLabel}</td></tr>
              <tr><td class="label">${c.labels.lane}</td><td class="value">${safeLane}</td></tr>
            </table>
            <div class="notice">
              ${escapeHtml(creditMessage)}
              ${safeManagerNote ? `<br><br><strong>${c.managerNotePrefix}</strong><br>${safeManagerNote}` : ''}
            </div>
          </div>
          <div class="footer">
            ${c.footer}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getResendFrom(),
        to: params.toEmail,
        subject: c.subject(params.eventName),
        html: htmlContent,
      }),
    });

    if (!res.ok) {
      const errorData = await parseResendError(res);
      console.error('[Resend Contestation] Erro na API do Resend:', errorData);
      return { success: false, error: errorData };
    }

    const data = await res.json();
    return { success: true, messageId: data.id };
  } catch (err) {
    console.error('[Resend Contestation] Erro crítico ao enviar e-mail:', err);
    return { success: false, error: err };
  }
}

export async function sendCommercialLeadOwnerEmail(params: {
  toEmail: string;
  managerName: string;
  phone: string;
  eventName: string;
  city: string;
  state: string;
  country: string;
  acceptedAt: string;
  submittedAt: string;
}) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error('[Resend Commercial Lead] RESENDAPI_KEY nao configurada no ambiente.');
    return { success: false, error: 'Chave de API do Resend ausente.' };
  }

  const safeManagerName = escapeHtml(params.managerName || 'Gestor interessado');
  const safePhone = escapeHtml(params.phone || '-');
  const safeEventName = escapeHtml(params.eventName || '-');
  const safeCity = escapeHtml(params.city || '-');
  const safeState = escapeHtml(params.state || '-');
  const safeCountry = escapeHtml(params.country || '-');
  const safeAcceptedAt = escapeHtml(params.acceptedAt || '-');
  const safeSubmittedAt = escapeHtml(params.submittedAt || '-');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Novo gestor interessado no WODArena</title>
      <style>
        body { margin: 0; padding: 0; background: #f5f5f5; color: #181a20; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .wrapper { width: 100%; padding: 32px 0; background: #f5f5f5; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #eaecef; border-radius: 12px; overflow: hidden; }
        .header { background: #181a20; border-bottom: 3px solid #FCD535; padding: 24px; text-align: center; }
        .brand { color: #FCD535; font-size: 20px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
        .body { padding: 32px 24px; }
        .eyebrow { display: inline-block; margin-bottom: 14px; border: 1px solid #d4a900; background: #fff7d6; color: #8a6a00; border-radius: 4px; padding: 6px 10px; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
        h1 { margin: 0 0 10px; font-size: 23px; line-height: 1.2; color: #181a20; text-transform: uppercase; }
        p { margin: 0 0 16px; color: #707a8a; font-size: 14px; line-height: 1.55; }
        .info { width: 100%; border-collapse: collapse; margin-top: 18px; }
        .info td { padding: 8px 0; vertical-align: top; font-size: 13px; }
        .label { color: #707a8a; font-weight: 800; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; width: 40%; }
        .value { color: #181a20; font-weight: 700; }
        .footer { border-top: 1px solid #eaecef; background: #fafafa; padding: 22px 24px; text-align: center; color: #707a8a; font-size: 11px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header"><div class="brand">WODArena</div></div>
          <div class="body">
            <span class="eyebrow">Lead comercial</span>
            <h1>Novo gestor interessado</h1>
            <p>Um novo potencial cliente preencheu o formulario comercial da homepage da WODArena.</p>
            <table class="info">
              <tr><td class="label">Nome do Gestor</td><td class="value">${safeManagerName}</td></tr>
              <tr><td class="label">Telefone</td><td class="value">${safePhone}</td></tr>
              <tr><td class="label">Nome do Evento</td><td class="value">${safeEventName}</td></tr>
              <tr><td class="label">Cidade</td><td class="value">${safeCity}</td></tr>
              <tr><td class="label">Estado</td><td class="value">${safeState}</td></tr>
              <tr><td class="label">Pais</td><td class="value">${safeCountry}</td></tr>
              <tr><td class="label">Aceite de Termos</td><td class="value">Sim</td></tr>
              <tr><td class="label">Data/Hora do Aceite</td><td class="value">${safeAcceptedAt}</td></tr>
              <tr><td class="label">Data/Hora do Cadastro</td><td class="value">${safeSubmittedAt}</td></tr>
            </table>
          </div>
          <div class="footer">
            Este e-mail foi enviado automaticamente pela captacao comercial da homepage da WODArena.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getResendFrom(),
        to: params.toEmail,
        subject: 'Novo gestor interessado no WODArena',
        html: htmlContent,
      }),
    });

    if (!res.ok) {
      const errorData = await parseResendError(res);
      console.error('[Resend Commercial Lead] Erro na API do Resend:', errorData);
      return { success: false, error: errorData };
    }

    const data = await res.json();
    return { success: true, messageId: data.id };
  } catch (err) {
    console.error('[Resend Commercial Lead] Erro critico ao enviar e-mail:', err);
    return { success: false, error: err };
  }
}
