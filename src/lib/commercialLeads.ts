import { CommercialLead, CommercialLeadEmailNotificationStatus, CommercialLeadStatus } from '@/types';

export const COMMERCIAL_LEAD_SOURCE = 'homepage-commercial-interest';
export const COMMERCIAL_LEAD_TERMS_VERSION = 'wodarena-commercial-lead-v1';
export const COMMERCIAL_LEAD_SUCCESS_MESSAGE = 'Recebemos suas informacoes e, em breve, um de nossos agentes entrara em contato para apresentar a plataforma e esclarecer qualquer duvida.';

type CommercialLeadDbRow = Record<string, unknown>;

const optionalString = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : undefined;

export const sanitizeLeadText = (value: string) => value
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .replace(/[<>]/g, '')
  .trim();

export const normalizeLeadPhone = (value: string) => value.replace(/\D/g, '');

export const getCommercialLeadStatusLabel = (status: CommercialLeadStatus) => {
  if (status === 'contacted') return 'Contatado';
  if (status === 'qualified') return 'Qualificado';
  if (status === 'discarded') return 'Descartado';
  return 'Novo';
};

export const getCommercialLeadEmailStatusLabel = (status: CommercialLeadEmailNotificationStatus) => {
  if (status === 'sent') return 'Enviado';
  if (status === 'failed') return 'Falhou';
  if (status === 'skipped') return 'Nao enviado';
  return 'Pendente';
};

export const mapCommercialLeadFromDb = (row: CommercialLeadDbRow): CommercialLead => ({
  id: String(row.id),
  managerName: String(row.manager_name || ''),
  phone: String(row.phone || ''),
  phoneNormalized: String(row.phone_normalized || ''),
  eventName: String(row.event_name || ''),
  city: String(row.city || ''),
  state: String(row.state || ''),
  leadStatus: String(row.lead_status || 'new') as CommercialLeadStatus,
  acceptedTerms: row.accepted_terms === true,
  acceptedAt: String(row.accepted_at || row.submitted_at || ''),
  termsVersion: String(row.terms_version || COMMERCIAL_LEAD_TERMS_VERSION),
  source: String(row.source || COMMERCIAL_LEAD_SOURCE),
  ownerEmailNotificationStatus: String(row.owner_email_notification_status || 'pending') as CommercialLeadEmailNotificationStatus,
  ownerEmailNotifiedAt: optionalString(row.owner_email_notified_at),
  ownerEmailRecipient: optionalString(row.owner_email_recipient),
  ownerEmailMessageId: optionalString(row.owner_email_message_id),
  ownerEmailError: optionalString(row.owner_email_error),
  submittedAt: String(row.submitted_at || row.created_at || ''),
  updatedAt: optionalString(row.updated_at)
});
