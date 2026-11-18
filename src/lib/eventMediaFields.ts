// Regulamento em PDF e patrocinadores com logo (Stories 1.150 a 1.152,
// docs/design/regulamento-patrocinadores/). Puro: o servidor valida o que
// grava, o painel mostra os mesmos limites e a página lê as mesmas regras.

export const EVENT_DOCUMENTS_BUCKET = 'event-documents';
export const RULES_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const SPONSOR_MAX_SLOTS = 12;
export const SPONSOR_NAME_MAX = 60;
export const SPONSOR_LINK_MAX = 300;
export const SPONSOR_PNG_MAX_BYTES = 2 * 1024 * 1024;
const RULES_NAME_MAX = 200;

export type RulesDocument = { url: string; name: string; size: number; uploadedAt: string };
export type SponsorSlot = { name: string; logoUrl: string | null; link: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Prefixo público do Storage: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/`. */
export const storagePublicPrefix = (supabaseUrl: string, bucket: string) => `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/`;

/** Começo de um PDF de verdade (%PDF-), conferido nos bytes e não no nome do arquivo. */
export const isPdfSignature = (bytes: Uint8Array) => bytes.length >= 5
  && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;

/** Nome que o atleta vê e baixa: sem caminho, sem caracteres de controle, terminando em .pdf. */
export const cleanPdfFileName = (raw: unknown) => {
  const base = String(raw ?? '').split(/[\\/]/).pop() || '';
  const name = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, RULES_NAME_MAX);
  if (!name) return 'Regulamento.pdf';
  return /\.pdf$/i.test(name) ? name : `${name.slice(0, RULES_NAME_MAX - 4)}.pdf`;
};

/**
 * Documento do regulamento para gravar (D1, D3). `null` tira o PDF. A URL tem
 * de ser do espaço de documentos do Storage (o prefixo vem do servidor).
 */
export const normalizeRulesDocument = (raw: unknown, documentsPrefix: string): Result<RulesDocument | null> => {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (!isPlainObject(raw)) return { ok: false, error: 'Regulamento em PDF inválido.' };
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url.startsWith(documentsPrefix) || !/\.pdf$/i.test(url.split('?')[0])) {
    return { ok: false, error: 'O PDF do regulamento precisa ser enviado pelo painel.' };
  }
  const size = Number(raw.size);
  if (!Number.isInteger(size) || size <= 0 || size > RULES_DOCUMENT_MAX_BYTES) {
    return { ok: false, error: 'O PDF do regulamento passa de 10 MB.' };
  }
  const uploadedAt = typeof raw.uploadedAt === 'string' && Number.isFinite(Date.parse(raw.uploadedAt)) ? new Date(raw.uploadedAt).toISOString() : '';
  if (!uploadedAt) return { ok: false, error: 'Data de envio do PDF inválida.' };
  return { ok: true, value: { url, name: cleanPdfFileName(raw.name), size, uploadedAt } };
};

/** Lê o documento que veio do banco (ou do bootstrap) sem confiar no formato. */
export const readRulesDocument = (raw: unknown): RulesDocument | null => {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!isPlainObject(value) || typeof value.url !== 'string' || !value.url) return null;
  const size = Number(value.size);
  return {
    url: value.url,
    name: cleanPdfFileName(value.name),
    size: Number.isFinite(size) && size > 0 ? size : 0,
    uploadedAt: typeof value.uploadedAt === 'string' ? value.uploadedAt : ''
  };
};

/**
 * Link da marca (opcional): só http ou https. Sem protocolo, entra https://
 * ("instagram.com/marca" vira "https://instagram.com/marca").
 */
export const normalizeSponsorLink = (raw: unknown): Result<string> => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: true, value: '' };
  if (text.length > SPONSOR_LINK_MAX) return { ok: false, error: 'Link da marca muito longo.' };
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'O link da marca precisa começar com http ou https.' };
    if (!url.hostname.includes('.')) return { ok: false, error: 'Link da marca inválido.' };
    const normalized = url.toString();
    if (normalized.length > SPONSOR_LINK_MAX) return { ok: false, error: 'Link da marca muito longo.' };
    return { ok: true, value: normalized };
  } catch {
    return { ok: false, error: 'Link da marca inválido.' };
  }
};

/**
 * Vagas de patrocinador para gravar (D4, D5). De 0 a 12 vagas, na ordem do
 * carrossel. Vaga com logo exige nome (texto do leitor de tela); o logo tem de
 * ser do espaço de imagens do evento no Storage.
 */
export const normalizeSponsorSlots = (raw: unknown, mediaPrefix: string): Result<SponsorSlot[]> => {
  if (raw === null || raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'Lista de patrocinadores inválida.' };
  if (raw.length > SPONSOR_MAX_SLOTS) return { ok: false, error: `No máximo ${SPONSOR_MAX_SLOTS} patrocinadores.` };
  const slots: SponsorSlot[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isPlainObject(item)) return { ok: false, error: `Patrocinador ${index + 1} inválido.` };
    const name = typeof item.name === 'string' ? item.name.replace(/\s+/g, ' ').trim().slice(0, SPONSOR_NAME_MAX) : '';
    const logoUrl = typeof item.logoUrl === 'string' && item.logoUrl.trim() ? item.logoUrl.trim() : null;
    if (logoUrl && !logoUrl.startsWith(mediaPrefix)) return { ok: false, error: `O logo do patrocinador ${index + 1} precisa ser enviado pelo painel.` };
    if (logoUrl && !name) return { ok: false, error: `Falta o nome do patrocinador ${index + 1}.` };
    const link = normalizeSponsorLink(item.link);
    if (!link.ok) return { ok: false, error: `Patrocinador ${index + 1}: ${link.error}` };
    slots.push({ name, logoUrl, link: link.value });
  }
  return { ok: true, value: slots };
};

/** O que impede salvar as vagas no painel (nome faltando, link inválido), antes de ir ao servidor. */
export const findSponsorSlotIssue = (slots: readonly SponsorSlot[]) => {
  const checked = normalizeSponsorSlots(slots, '');
  return checked.ok ? null : checked.error;
};

/** Lê as vagas que vieram do banco (ou do bootstrap) sem confiar no formato. */
export const readSponsorSlots = (raw: unknown): SponsorSlot[] => {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  if (!Array.isArray(value)) return [];
  return value.slice(0, SPONSOR_MAX_SLOTS).flatMap((item) => (isPlainObject(item) ? [{
    name: typeof item.name === 'string' ? item.name : '',
    logoUrl: typeof item.logoUrl === 'string' && item.logoUrl ? item.logoUrl : null,
    link: typeof item.link === 'string' ? item.link : ''
  }] : []));
};

/** O que a página mostra (D4): só as vagas com logo e nome. */
export const publicSponsors = (slots: readonly SponsorSlot[]) => slots.filter((slot): slot is SponsorSlot & { logoUrl: string } => Boolean(slot.logoUrl && slot.name.trim()));

/** Páginas do carrossel (D7): duas marcas por página. */
export const sponsorPages = <T>(items: readonly T[], perPage = 2): T[][] => {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += perPage) pages.push(items.slice(index, index + perPage));
  return pages;
};

/** Com até duas marcas o carrossel fica parado (D7). */
export const sponsorsRotate = (count: number, perPage = 2) => count > perPage;

/** Tamanho legível para o atleta ("2,4 MB", "820 KB"). */
export const formatFileSize = (bytes: number) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);
