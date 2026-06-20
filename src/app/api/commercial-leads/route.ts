import { NextResponse } from 'next/server';
import {
  COMMERCIAL_LEAD_SOURCE,
  COMMERCIAL_LEAD_SUCCESS_MESSAGE,
  COMMERCIAL_LEAD_TERMS_VERSION,
  mapCommercialLeadFromDb,
  normalizeLeadPhone,
  sanitizeLeadText
} from '@/lib/commercialLeads';
import { sendCommercialLeadOwnerEmail } from '@/lib/resend';
import { checkRateLimit, createSupabaseAdmin, getClientIp, requireSession } from '@/lib/serverSecurity';

const createCommercialLeadId = () => `lead-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const CANONICAL_COMMERCIAL_LEADS_OWNER_EMAIL = 'l.vilaar@gmail.com';
const LEGACY_OWNER_EMAILS = new Set(['owner@wodarena.com']);

const normalizeOwnerEmailCandidate = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (LEGACY_OWNER_EMAILS.has(normalized)) return CANONICAL_COMMERCIAL_LEADS_OWNER_EMAIL;
  return normalized;
};

const getOwnerEmail = async (supabaseAdmin: ReturnType<typeof createSupabaseAdmin>) => {
  const configuredEmail = normalizeOwnerEmailCandidate(
    process.env.COMMERCIAL_LEADS_OWNER_EMAIL || process.env.WODARENA_OWNER_EMAIL
  );
  if (configuredEmail) return configuredEmail;

  const { data: explicitCommercialOwner, error: explicitCommercialOwnerError } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('role', 'owner')
    .eq('email', CANONICAL_COMMERCIAL_LEADS_OWNER_EMAIL)
    .maybeSingle<{ email: string }>();

  if (explicitCommercialOwnerError) throw explicitCommercialOwnerError;
  if (explicitCommercialOwner?.email) {
    return normalizeOwnerEmailCandidate(explicitCommercialOwner.email);
  }

  const { data: canonicalOwner, error: canonicalOwnerError } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', 'owner-1')
    .eq('role', 'owner')
    .maybeSingle<{ email: string }>();

  if (canonicalOwnerError) throw canonicalOwnerError;
  if (canonicalOwner?.email) return normalizeOwnerEmailCandidate(canonicalOwner.email);

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('role', 'owner')
    .order('id', { ascending: true })
    .limit(10);

  if (error) throw error;

  const fallbackEmail = (data || [])
    .map((row) => normalizeOwnerEmailCandidate(row.email))
    .find((email): email is string => Boolean(email));

  return fallbackEmail || CANONICAL_COMMERCIAL_LEADS_OWNER_EMAIL;
};

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['owner']);
    if (auth.response) return auth.response;

    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('commercial_leads')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      leads: (data || []).map(mapCommercialLeadFromDb)
    });
  } catch (err) {
    console.error('[Commercial Leads API] Erro ao listar leads:', err);
    return NextResponse.json({ error: 'Erro ao listar leads comerciais.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimitResponse = checkRateLimit({
      key: `commercial-leads:${ip}`,
      limit: 5,
      windowMs: 15 * 60 * 1000
    });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json() as {
      managerName?: string;
      phone?: string;
      eventName?: string;
      city?: string;
      state?: string;
      acceptedTerms?: boolean;
    };

    const managerName = sanitizeLeadText(String(body.managerName || ''));
    const phone = sanitizeLeadText(String(body.phone || ''));
    const eventName = sanitizeLeadText(String(body.eventName || ''));
    const city = sanitizeLeadText(String(body.city || ''));
    const state = sanitizeLeadText(String(body.state || '')).toUpperCase();
    const acceptedTerms = body.acceptedTerms === true;
    const phoneNormalized = normalizeLeadPhone(phone);

    if (!managerName || !phone || !eventName || !city || !state) {
      return NextResponse.json({ error: 'Nome do gestor, telefone, nome do evento, cidade e estado sao obrigatorios.' }, { status: 400 });
    }

    if (managerName.length < 3 || eventName.length < 3 || city.length < 2) {
      return NextResponse.json({ error: 'Preencha os campos com informacoes validas.' }, { status: 400 });
    }

    if (phoneNormalized.length < 10 || phoneNormalized.length > 13) {
      return NextResponse.json({ error: 'Informe um telefone valido com DDD.' }, { status: 400 });
    }

    if (!/^[A-Z]{2}$/.test(state)) {
      return NextResponse.json({ error: 'Informe um estado valido no formato UF.' }, { status: 400 });
    }

    if (!acceptedTerms) {
      return NextResponse.json({ error: 'Voce precisa aceitar os termos e a politica de privacidade para continuar.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    const duplicateThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentLead, error: duplicateError } = await supabaseAdmin
      .from('commercial_leads')
      .select('id')
      .eq('phone_normalized', phoneNormalized)
      .eq('event_name', eventName)
      .gte('submitted_at', duplicateThreshold)
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (recentLead) {
      return NextResponse.json({ error: 'Ja recebemos recentemente uma solicitacao com esse telefone para este evento. Aguarde nosso contato.' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const leadId = createCommercialLeadId();
    const payload = {
      id: leadId,
      manager_name: managerName,
      phone,
      phone_normalized: phoneNormalized,
      event_name: eventName,
      city,
      state,
      lead_status: 'new',
      accepted_terms: true,
      accepted_at: now,
      terms_version: COMMERCIAL_LEAD_TERMS_VERSION,
      source: COMMERCIAL_LEAD_SOURCE,
      owner_email_notification_status: 'pending',
      submitted_at: now
    };

    const { data: insertedLead, error: insertError } = await supabaseAdmin
      .from('commercial_leads')
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (insertError || !insertedLead) {
      throw insertError || new Error('Falha ao registrar lead comercial.');
    }

    let ownerEmailNotificationStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
    let ownerEmailNotifiedAt: string | null = null;
    let ownerEmailRecipient: string | null = null;
    let ownerEmailMessageId: string | null = null;
    let ownerEmailError: string | null = null;

    try {
      const ownerEmail = await getOwnerEmail(supabaseAdmin);
      ownerEmailRecipient = ownerEmail;

      if (!ownerEmail) {
        ownerEmailNotificationStatus = 'skipped';
        ownerEmailError = 'Nenhum e-mail de owner encontrado.';
      } else {
        console.info('[Commercial Leads API] Enviando notificacao comercial para owner:', {
          leadId,
          ownerEmail
        });

        const emailResult = await sendCommercialLeadOwnerEmail({
          toEmail: ownerEmail,
          managerName,
          phone,
          eventName,
          city,
          state,
          acceptedAt: now,
          submittedAt: now
        });

        if (emailResult.success) {
          ownerEmailNotificationStatus = 'sent';
          ownerEmailNotifiedAt = new Date().toISOString();
          ownerEmailMessageId = emailResult.messageId || null;
          console.info('[Commercial Leads API] Notificacao comercial enviada com sucesso:', {
            leadId,
            ownerEmail,
            messageId: ownerEmailMessageId
          });
        } else {
          ownerEmailNotificationStatus = 'failed';
          ownerEmailError = emailResult.error instanceof Error
            ? emailResult.error.message
            : typeof emailResult.error === 'string'
              ? emailResult.error
              : JSON.stringify(emailResult.error);
          console.error('[Commercial Leads API] Falha no envio da notificacao comercial:', {
            leadId,
            ownerEmail,
            error: ownerEmailError
          });
        }
      }
    } catch (emailErr) {
      ownerEmailNotificationStatus = 'failed';
      ownerEmailError = emailErr instanceof Error ? emailErr.message : 'Falha ao enviar e-mail para o proprietario.';
      console.error('[Commercial Leads API] Erro critico ao notificar owner:', {
        leadId,
        error: ownerEmailError
      });
    }

    const { data: updatedLead, error: updateError } = await supabaseAdmin
      .from('commercial_leads')
      .update({
        owner_email_notification_status: ownerEmailNotificationStatus,
        owner_email_notified_at: ownerEmailNotifiedAt,
        owner_email_recipient: ownerEmailRecipient,
        owner_email_message_id: ownerEmailMessageId,
        owner_email_error: ownerEmailError
      })
      .eq('id', leadId)
      .select('*')
      .maybeSingle();

    if (updateError) {
      console.error('[Commercial Leads API] Falha ao registrar status do e-mail:', updateError);
    }

    return NextResponse.json({
      success: true,
      message: COMMERCIAL_LEAD_SUCCESS_MESSAGE,
      lead: mapCommercialLeadFromDb(updatedLead || insertedLead)
    });
  } catch (err) {
    console.error('[Commercial Leads API] Erro ao criar lead:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao registrar interesse comercial.' }, { status: 500 });
  }
}
