import type { SupabaseClient } from '@supabase/supabase-js';
import { readBootstrapPages, readBootstrapQuery } from '@/lib/bootstrapPayload';
import { resolveUserCreatedAt } from '@/lib/ownerOverview';

// Cadastros recentes do painel do proprietário com busca (Story 1.122, decisão E2):
// gestores, contas de atleta, inscrições e leads, do mais novo para o mais antigo,
// com busca por nome ou e-mail, paginados no servidor pelo cursor `before`. Só leitura.

export type OwnerSignupKind = 'manager' | 'athlete_account' | 'registration' | 'lead';
export const OWNER_SIGNUP_KINDS: OwnerSignupKind[] = ['manager', 'athlete_account', 'registration', 'lead'];

export type OwnerSignupItem = {
  kind: OwnerSignupKind;
  id: string;
  name: string;
  /** E-mail (contas e inscrições) ou telefone (leads). */
  contact: string;
  /** Organização do gestor, evento da inscrição ou evento que o lead quer fazer. */
  detail: string;
  createdAt: string;
};

export type OwnerSignupsResult = {
  items: OwnerSignupItem[];
  /** Cursor da próxima página, ou null quando acabou. */
  nextBefore: string | null;
};

export const OWNER_SIGNUPS_DEFAULT_LIMIT = 20;
export const OWNER_SIGNUPS_MAX_LIMIT = 50;
const SEARCH_MAX_LENGTH = 80;

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

/**
 * Texto da busca sem os caracteres que mudam a sintaxe do filtro do PostgREST
 * (vírgula, parênteses, aspas, curingas): sobra letra, número, espaço e @ . _ + -.
 */
export const sanitizeOwnerSearch = (value: unknown): string =>
  text(value)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s@._+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);

export const normalizeOwnerSignupsLimit = (value: unknown) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return OWNER_SIGNUPS_DEFAULT_LIMIT;
  return Math.min(parsed, OWNER_SIGNUPS_MAX_LIMIT);
};

export const normalizeOwnerSignupsBefore = (value: unknown): string | null => {
  const raw = text(value).trim();
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

const isMissingColumnError = (error: unknown, column: string) => {
  const candidate = error as { code?: string; message?: string } | null;
  return Boolean(candidate && (candidate.code === '42703' || candidate.code === 'PGRST204')
    && String(candidate.message || '').includes(column));
};

const ilikeAny = (columns: string[], search: string) => columns.map(column => `${column}.ilike."%${search}%"`).join(',');

type Options = { search: string; before: string | null; limit: number; kinds: OwnerSignupKind[] };

const readUserSignups = async (
  supabaseAdmin: SupabaseClient,
  role: 'manager' | 'athlete',
  options: Options,
  hasCreatedAt: boolean
): Promise<OwnerSignupItem[]> => {
  const kind: OwnerSignupKind = role === 'manager' ? 'manager' : 'athlete_account';
  const label = role === 'manager' ? 'cadastros de gestores' : 'cadastros de contas de atleta';
  // O select muda conforme a coluna existe; o tipo do Supabase não lê string montada.
  const select: string = hasCreatedAt ? 'id, name, email, organization, created_at' : 'id, name, email, organization';
  // Um construtor novo por consulta: o do Supabase acumula filtros e ordem a cada chamada.
  const baseQuery = () => {
    const query = supabaseAdmin
      .from('users')
      .select<string, Row>(select)
      .eq('role', role);
    return options.search ? query.or(ilikeAny(['name', 'email'], options.search)) : query;
  };

  let rows: Row[];
  if (hasCreatedAt) {
    const query = options.before ? baseQuery().lt('created_at', options.before) : baseQuery();
    rows = await readBootstrapQuery(label, query.order('created_at', { ascending: false, nullsFirst: false }).range(0, options.limit - 1));
  } else if (role === 'manager') {
    // Sem a coluna: gestores são poucos; a data sai do id e a ordem é feita aqui.
    rows = await readBootstrapPages(label, (from, to) => baseQuery().order('id', { ascending: true }).range(from, to));
  } else {
    // Contas de atleta têm id `ath-user-<ms>`: a ordem do id é a ordem do cadastro.
    const query = options.before ? baseQuery().lt('id', `ath-user-${Date.parse(options.before)}`) : baseQuery();
    rows = await readBootstrapQuery(label, query.order('id', { ascending: false }).range(0, options.limit - 1));
  }

  return rows
    .map(row => ({
      kind,
      id: text(row.id),
      name: text(row.name),
      contact: text(row.email),
      detail: text(row.organization),
      createdAt: resolveUserCreatedAt(text(row.id), text(row.created_at) || null) || ''
    }))
    .filter(item => item.createdAt && (!options.before || item.createdAt < options.before));
};

export const readOwnerSignups = async (supabaseAdmin: SupabaseClient, options: Options): Promise<OwnerSignupsResult> => {
  const wants = (kind: OwnerSignupKind) => options.kinds.includes(kind);

  let hasCreatedAt = true;
  if (wants('manager') || wants('athlete_account')) {
    const probe = await supabaseAdmin.from('users').select('id, created_at').range(0, 0);
    hasCreatedAt = !isMissingColumnError(probe.error, 'created_at');
  }

  const registrationQuery = () => {
    let query = supabaseAdmin
      .from('registrations')
      .select('id, athlete_name, athlete_email, event_id, created_at');
    if (options.search) query = query.or(ilikeAny(['athlete_name', 'athlete_email'], options.search));
    if (options.before) query = query.lt('created_at', options.before);
    return query.order('created_at', { ascending: false }).range(0, options.limit - 1);
  };

  const leadQuery = () => {
    let query = supabaseAdmin
      .from('commercial_leads')
      .select('id, manager_name, phone, event_name, submitted_at');
    if (options.search) query = query.or(ilikeAny(['manager_name', 'event_name', 'phone'], options.search));
    if (options.before) query = query.lt('submitted_at', options.before);
    return query.order('submitted_at', { ascending: false }).range(0, options.limit - 1);
  };

  const [managers, athleteAccounts, registrationRows, leadRows] = await Promise.all([
    wants('manager') ? readUserSignups(supabaseAdmin, 'manager', options, hasCreatedAt) : Promise.resolve([]),
    wants('athlete_account') ? readUserSignups(supabaseAdmin, 'athlete', options, hasCreatedAt) : Promise.resolve([]),
    wants('registration') ? readBootstrapQuery<Row[]>('cadastros de inscrições', registrationQuery()) : Promise.resolve([] as Row[]),
    wants('lead') ? readBootstrapQuery<Row[]>('cadastros de leads', leadQuery()) : Promise.resolve([] as Row[])
  ]);

  const eventIds = [...new Set(registrationRows.map(row => text(row.event_id)).filter(Boolean))];
  const eventRows = eventIds.length > 0
    ? await readBootstrapQuery<Row[]>('eventos dos cadastros', supabaseAdmin.from('events').select('id, name').in('id', eventIds))
    : [];
  const eventNames = new Map(eventRows.map(row => [text(row.id), text(row.name)]));

  const registrations: OwnerSignupItem[] = registrationRows.map(row => ({
    kind: 'registration',
    id: text(row.id),
    name: text(row.athlete_name),
    contact: text(row.athlete_email),
    detail: eventNames.get(text(row.event_id)) || '',
    createdAt: text(row.created_at)
  }));

  const leads: OwnerSignupItem[] = leadRows.map(row => ({
    kind: 'lead',
    id: text(row.id),
    name: text(row.manager_name),
    contact: text(row.phone),
    detail: text(row.event_name),
    createdAt: text(row.submitted_at)
  }));

  // Gestores lidos inteiros (sem a coluna) também passam pela busca e pelo limite aqui.
  const sources = [managers, athleteAccounts, registrations, leads];
  const merged = sources
    .flat()
    .filter(item => item.createdAt && Number.isFinite(Date.parse(item.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));

  const items = merged.slice(0, options.limit);
  // Há mais quando alguma fonte encheu a página ou a junção passou do limite.
  const someSourceFull = [athleteAccounts, registrationRows, leadRows].some(rows => rows.length >= options.limit)
    || (hasCreatedAt && managers.length >= options.limit);
  const hasMore = merged.length > options.limit || someSourceFull;

  return {
    items,
    nextBefore: hasMore && items.length > 0 ? items[items.length - 1].createdAt : null
  };
};
