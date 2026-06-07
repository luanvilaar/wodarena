import { Registration, Athlete, Event } from '@/types';

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

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
}) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error('[Resend Password Reset] RESENDAPI_KEY não configurada no ambiente.');
    return { success: false, error: 'Chave de API do Resend ausente.' };
  }

  const safeName = escapeHtml(params.userName || 'Atleta WODArena');
  const safeResetUrl = escapeHtml(params.resetUrl);
  const safeEmail = escapeHtml(params.toEmail);

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Recuperação de senha - WODArena</title>
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
            <span class="eyebrow">Acesso seguro</span>
            <h1>Defina uma nova senha</h1>
            <p>Olá, <strong>${safeName}</strong>. Recebemos uma solicitação de recuperação de senha para o acesso vinculado a <strong>${safeEmail}</strong>.</p>
            <p>Use o botão abaixo para criar uma nova senha. O link expira em <strong>${params.expiresInMinutes} minutos</strong> e só pode ser usado uma vez.</p>
            <div class="button-wrap">
              <a class="button" href="${safeResetUrl}" target="_blank" rel="noopener noreferrer">Criar nova senha</a>
            </div>
            <div class="notice">
              Se o botão não abrir, copie e cole este link no navegador:<br>
              <span class="url">${safeResetUrl}</span>
            </div>
            <p style="margin-top: 18px;">Se você não solicitou essa recuperação, ignore este e-mail. Sua senha atual continuará válida.</p>
          </div>
          <div class="footer">
            Este e-mail foi enviado automaticamente pela WODArena. Nunca compartilhe este link com terceiros.
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
        subject: 'Recuperação de senha - WODArena',
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

/**
 * Envia um e-mail de confirmação de inscrição para o atleta utilizando a API do Resend.
 */
export async function sendRegistrationEmail(
  registration: Registration,
  athlete: Athlete,
  event: Event,
  cpf: string = ''
) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error('[Resend Email Service] RESENDAPI_KEY não configurada no ambiente.');
    return { success: false, error: 'Chave de API do Resend ausente.' };
  }

  // Mascarar CPF
  const cleanCpf = cpf.replace(/\D/g, '');
  const maskedCpf = cleanCpf.length === 11 
    ? `***.${cleanCpf.substring(3, 6)}.${cleanCpf.substring(6, 9)}-**`
    : cpf;

  const totalPaidFormatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(registration.totalPaid);

  const paymentStatus = registration.paymentStatus || 'payment_approved';
  const isPaymentApproved = paymentStatus === 'payment_approved';
  const statusLabel = paymentStatus === 'payment_failed'
    ? 'Pagamento não processado'
    : paymentStatus === 'payment_in_review'
      ? 'Pagamento em análise'
      : paymentStatus === 'payment_cancelled'
        ? 'Pagamento cancelado'
        : paymentStatus === 'payment_pending'
          ? 'Pagamento pendente'
          : 'Pagamento aprovado';

  const isTeam = athlete.isTeam || false;
  const teamMembersList = isTeam && athlete.teamMembers && athlete.teamMembers.length > 0
    ? athlete.teamMembers.map(m => m.name).join(', ')
    : '';

  // Template HTML do E-mail (Estilo Binance Flat / Visual Profissional)
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Confirmação de Inscrição - WODArena</title>
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
        .header {
          background-color: #181a20;
          padding: 24px;
          text-align: center;
          border-bottom: 3px solid #FCD535;
        }
        .header-logo {
          color: #FCD535;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
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
          
          <!-- Header Banner -->
          <div class="header">
            <div class="header-logo">WODArena</div>
          </div>
          
          <!-- Body Content -->
          <div class="body">
            <div class="success-badge">${isPaymentApproved ? 'Inscrição Confirmada' : 'Inscrição Registrada'}</div>
            <h1 class="title">${isPaymentApproved ? 'Sua inscrição está confirmada!' : 'Sua inscrição foi registrada'}</h1>
            <p class="subtitle">
              Olá, <strong>${registration.athleteName}</strong>. Sua inscrição para o evento <strong>${event.name}</strong> foi registrada na WODArena. Status atual: <strong>${statusLabel}</strong>.
              ${isPaymentApproved ? 'Abaixo estão os detalhes oficiais da sua vaga.' : 'A participação no evento depende da regularização do pagamento.'}
            </p>
            
            <div class="divider"></div>
            
            <!-- Detalhes do Evento & Atleta -->
            <table class="ticket-info">
              <tr>
                <td class="label">ID da Inscrição</td>
                <td class="value-mono">${registration.id}</td>
              </tr>
              <tr>
                <td class="label">Competição</td>
                <td class="value">${event.name}</td>
              </tr>
              <tr>
                <td class="label">Categoria / Divisão</td>
                <td class="value">${registration.ticketType}</td>
              </tr>
              <tr>
                <td class="label">Atleta / Equipe</td>
                <td class="value">
                  ${registration.athleteName}
                  ${isTeam ? `<br><span style="font-size: 11px; font-weight: normal; color: #707a8a;">Integrantes: ${teamMembersList}</span>` : ''}
                </td>
              </tr>
              <tr>
                <td class="label">Box / Afiliado</td>
                <td class="value">${registration.box || 'Independente'}</td>
              </tr>
              ${cpf ? `
              <tr>
                <td class="label">CPF do Pagador</td>
                <td class="value-mono">${maskedCpf}</td>
              </tr>` : ''}
              <tr>
                <td class="label">Data do Evento</td>
                <td class="value">${event.date}</td>
              </tr>
              <tr>
                <td class="label">Local</td>
                <td class="value">${event.location}</td>
              </tr>
              <tr>
                <td class="label">Total Pago</td>
                <td class="value" style="color: #0ecb81; font-size: 15px;">${totalPaidFormatted}</td>
              </tr>
              <tr>
                <td class="label">Status do Pagamento</td>
                <td class="value">${statusLabel}</td>
              </tr>
            </table>
            
            <div class="dashed-divider"></div>
            
            <!-- Validação da Inscrição -->
            <div class="validation-section">
              <div class="validation-title">${isPaymentApproved ? 'INSCRIÇÃO VALIDADA' : 'INSCRIÇÃO REGISTRADA'}</div>
              <p class="validation-text">
                ${isPaymentApproved
                  ? 'Este comprovante confirma a sua inscrição no evento.'
                  : 'Este registro não confirma a vaga financeiramente até a regularização do pagamento.'}
                Guarde o ID da inscrição para consultas com a organização.
              </p>
            </div>
            
          </div>
          
          <!-- Footer -->
          <div class="footer">
            <p>Este comprovante foi emitido digitalmente e de forma automática pela <strong>WODArena</strong>.</p>
            <p>
              Cada evento possui organizadores independentes. Em caso de dúvidas sobre cronogramas, kits ou locais, entre em contato diretamente com a organização do evento.
            </p>
            <p style="margin-top: 16px;">
              <a href="https://wodarena.com/termos" target="_blank">Termos de Inscrição</a> &bull; 
              <a href="https://wodarena.com/termos#privacidade" target="_blank">Políticas de Privacidade</a>
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
        subject: `Inscrição Confirmada - ${event.name}`,
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
