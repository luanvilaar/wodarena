import { randomBytes } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { assertManagerSalesAccessForEvent } from '@/lib/serverManagerAccess';
import { getRequestSession, hashPassword, verifyRegistrationAccessToken } from '@/lib/serverSecurity';
import { sendRegistrationEmail } from '@/lib/resend';
import { getRegistrationAvailability } from '@/lib/eventStatus';
import { Registration, Athlete, Event, AppLocale } from '@/types';

type RegistrationInput = Record<string, unknown>;
type AthleteInput = Record<string, unknown>;

export type SecureCheckoutSnapshot = {
  registrationData: RegistrationInput;
  athleteProfile: AthleteInput;
  transactionAmount: number;
  eventId: string;
  registrationId: string;
};

export type CouponValidationResult = {
  code: string;
  discount: number;
  totalPaid: number;
  ticketPrice: number;
};

type RegistrationAccessOptions = {
  registrationId: string;
  eventId?: string;
  accessToken?: string | null;
};

type RegistrationAccessResult = {
  registration: {
    id: string;
    event_id: string;
    user_id: string | null;
  };
};

const asString = (value: unknown, fallback = '') => typeof value === 'string' && value.trim()
  ? value.trim()
  : fallback;

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeCoupon = (value: unknown) => asString(value).toUpperCase();

const calculateDiscount = (ticketPrice: number, discountType: string, discountValue: unknown) => (
  discountType === 'percentage'
    ? (ticketPrice * Number(discountValue || 0)) / 100
    : Number(discountValue || 0)
);

export class RegistrationAccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = 'RegistrationAccessError';
    this.status = status;
  }
}

type EventRegistrationAvailabilityRow = {
  id: string;
  status: Event['status'];
  date: string;
  registration_deadline?: string | null;
  is_ticketing_active?: boolean | null;
};

const assertRegistrationAvailableForEvent = (event: EventRegistrationAvailabilityRow) => {
  const availability = getRegistrationAvailability({
    status: event.status,
    date: event.date,
    registrationDeadline: event.registration_deadline || undefined,
    isTicketingActive: event.is_ticketing_active !== false,
  });

  if (availability.isAvailable) return;

  if (availability.reason === 'sales_closed') {
    throw new RegistrationAccessError('As inscricoes online deste evento estao encerradas.', 409);
  }

  throw new RegistrationAccessError('Este evento esta encerrado e nao aceita novas inscricoes.', 409);
};

export const assertEventRegistrationAvailable = async (
  supabaseAdmin: SupabaseClient,
  eventId: string,
) => {
  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id, status, date, registration_deadline, is_ticketing_active')
    .eq('id', eventId)
    .maybeSingle<EventRegistrationAvailabilityRow>();

  if (error || !event) {
    throw new RegistrationAccessError('Evento nao encontrado para checkout.', 404);
  }

  assertRegistrationAvailableForEvent(event);
};

export const assertRegistrationAccess = async (
  supabaseAdmin: SupabaseClient,
  request: Request,
  options: RegistrationAccessOptions
): Promise<RegistrationAccessResult> => {
  const registrationId = asString(options.registrationId);
  const eventId = asString(options.eventId);
  if (!registrationId) {
    throw new RegistrationAccessError('Inscricao obrigatoria para continuar.', 400);
  }

  const { data: registration, error } = await supabaseAdmin
    .from('registrations')
    .select('id, event_id, user_id')
    .eq('id', registrationId)
    .maybeSingle<{ id: string; event_id: string; user_id: string | null }>();

  if (error || !registration) {
    throw new RegistrationAccessError('Inscricao nao encontrada.', 404);
  }

  if (eventId && registration.event_id !== eventId) {
    throw new RegistrationAccessError('Inscricao nao pertence ao evento informado.', 403);
  }

  const actor = getRequestSession(request);
  if (actor) {
    if (actor.role === 'owner') {
      return { registration };
    }

    if (actor.role === 'athlete' && registration.user_id === actor.id) {
      return { registration };
    }

    if (actor.role === 'manager') {
      const { data: event } = await supabaseAdmin
        .from('events')
        .select('organizer_id')
        .eq('id', registration.event_id)
        .maybeSingle<{ organizer_id: string }>();

      if (event?.organizer_id === actor.id) {
        return { registration };
      }
    }
  }

  const tokenClaims = verifyRegistrationAccessToken(options.accessToken || null);
  if (
    tokenClaims
    && tokenClaims.sub === registration.id
    && tokenClaims.eventId === registration.event_id
    && (!tokenClaims.userId || !registration.user_id || tokenClaims.userId === registration.user_id)
  ) {
    return { registration };
  }

  throw new RegistrationAccessError('Acesso negado para esta inscricao.', 403);
};

export const validateCheckoutCoupon = async (
  supabaseAdmin: SupabaseClient,
  eventId: string,
  divisionId: string,
  couponCodeValue: unknown
): Promise<CouponValidationResult> => {
  const couponCode = normalizeCoupon(couponCodeValue);
  if (!eventId || !divisionId || !couponCode) {
    throw new Error('Evento, categoria e cupom sao obrigatorios.');
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, status, date, registration_deadline, ticket_price, is_ticketing_active')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError || !event) {
    throw new Error('Evento nao encontrado para checkout.');
  }

  assertRegistrationAvailableForEvent(event);

  await assertManagerSalesAccessForEvent(supabaseAdmin, eventId);

  const { data: division, error: divisionError } = await supabaseAdmin
    .from('divisions')
    .select('id, price, is_active')
    .eq('id', divisionId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (divisionError || !division) {
    throw new Error('Categoria nao encontrada para checkout.');
  }

  if (division.is_active === false) {
    throw new Error('Esta categoria nao esta aceitando inscricoes.');
  }

  const { data: coupon, error: couponError } = await supabaseAdmin
    .from('coupons')
    .select('code, discount_type, discount_value, usage_limit, usage_count, is_active')
    .eq('event_id', eventId)
    .eq('code', couponCode)
    .maybeSingle();

  if (couponError || !coupon) {
    throw new Error('Cupom invalido para este evento.');
  }

  if (coupon.is_active === false) {
    throw new Error('Este cupom esta desativado.');
  }

  if (Number(coupon.usage_limit || 0) > 0 && Number(coupon.usage_count || 0) >= Number(coupon.usage_limit || 0)) {
    throw new Error('Este cupom ja atingiu o limite de utilizacao.');
  }

  const ticketPrice = asNumber(division.price, asNumber(event.ticket_price, 0));
  const discount = calculateDiscount(ticketPrice, coupon.discount_type, coupon.discount_value);
  const totalPaid = Math.max(0, ticketPrice - discount);

  return {
    code: String(coupon.code || couponCode).toUpperCase(),
    discount,
    totalPaid: totalPaid > 0 && totalPaid < 1 ? 1 : totalPaid,
    ticketPrice
  };
};

/**
 * Contabiliza o uso de um cupom para uma inscrição aprovada, de forma atômica e
 * idempotente, via função RPC `apply_coupon_usage` (ver migration
 * 20260609100000_coupon_usage_tracking.sql).
 *
 * Deve ser chamada em TODOS os pontos onde uma inscrição transita para
 * `payment_approved` (cartão, pix, conciliação/polling, webhook e inscrição
 * gratuita). A idempotência no banco garante que cada inscrição conte no máximo
 * uma vez, mesmo que múltiplos fluxos disparem em paralelo.
 *
 * Nunca lança: uma falha aqui não pode interromper a confirmação do pagamento.
 */
export const applyCouponUsageForApprovedRegistration = async (
  supabaseAdmin: SupabaseClient,
  registrationId: string | undefined | null
): Promise<void> => {
  const id = asString(registrationId);
  if (!id) return;

  try {
    const { error } = await supabaseAdmin.rpc('apply_coupon_usage', {
      p_registration_id: id
    });
    if (error) {
      console.warn('[Coupon Usage] Falha ao contabilizar uso do cupom:', error.message);
    }
  } catch (err) {
    console.warn('[Coupon Usage] Erro inesperado ao contabilizar uso do cupom:', err);
  }
};

export const calculateSecureRegistrationSnapshot = async (
  supabaseAdmin: SupabaseClient,
  registrationData: RegistrationInput,
  athleteProfile: AthleteInput
): Promise<SecureCheckoutSnapshot> => {
  const eventId = asString(registrationData.eventId);
  const divisionId = asString(registrationData.divisionId);
  if (!eventId || !divisionId) {
    throw new Error('Evento e categoria sao obrigatorios para checkout.');
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, name, status, date, registration_deadline, ticket_price, ticket_slots, is_ticketing_active')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError || !event) {
    throw new Error('Evento nao encontrado para checkout.');
  }

  assertRegistrationAvailableForEvent(event);

  await assertManagerSalesAccessForEvent(supabaseAdmin, eventId);

  const { data: division, error: divisionError } = await supabaseAdmin
    .from('divisions')
    .select('id, name, price, slots_limit, is_active, type, category')
    .eq('id', divisionId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (divisionError || !division) {
    throw new Error('Categoria nao encontrada para checkout.');
  }

  if (division.is_active === false) {
    throw new Error('Esta categoria nao esta aceitando inscricoes.');
  }

  // Capacidade: cada inscrição não cancelada ocupa 1 vaga, na categoria e no
  // evento (mesmo critério usado no painel do gestor para exibir "X/Y vagas").
  // Sem isso, nada impedia overselling sob concorrência.
  const [{ count: divisionRegistrationCount, error: divisionCountError }, { count: eventRegistrationCount, error: eventCountError }] = await Promise.all([
    supabaseAdmin
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('division_id', divisionId)
      .not('payment_status', 'eq', 'payment_cancelled'),
    supabaseAdmin
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .not('payment_status', 'eq', 'payment_cancelled')
  ]);

  if (divisionCountError || eventCountError) {
    throw new Error('Erro ao verificar vagas disponiveis.');
  }

  const divisionSlotsLimit = asNumber(division.slots_limit, 0);
  if (divisionSlotsLimit > 0 && (divisionRegistrationCount || 0) >= divisionSlotsLimit) {
    throw new RegistrationAccessError('Esta categoria atingiu o limite de vagas.', 409);
  }

  const eventTicketSlots = asNumber(event.ticket_slots, 0);
  if (eventTicketSlots > 0 && (eventRegistrationCount || 0) >= eventTicketSlots) {
    throw new RegistrationAccessError('Este evento atingiu o limite de vagas.', 409);
  }

  const quantity = Math.max(1, Math.min(4, Math.trunc(asNumber(registrationData.quantity, 1))));
  const ticketPrice = asNumber(division.price, asNumber(event.ticket_price, 0));
  const couponCode = normalizeCoupon(registrationData.couponCode);
  let discount = 0;

  if (couponCode) {
    const couponResult = await validateCheckoutCoupon(supabaseAdmin, eventId, divisionId, couponCode);
    discount = couponResult.discount;
  }

  const subtotal = Math.max(0, ticketPrice * quantity);
  const totalPaid = Math.max(0, subtotal - discount);
  const transactionAmount = totalPaid > 0 && totalPaid < 1 ? 1 : totalPaid;
  const registrationId = asString(registrationData.id, `reg-${Date.now()}`);

  return {
    registrationData: {
      ...registrationData,
      id: registrationId,
      eventId,
      divisionId,
      ticketType: asString(division.name, asString(registrationData.ticketType)),
      ticketPrice,
      quantity,
      totalPaid: transactionAmount,
      couponCode: couponCode || undefined
    },
    athleteProfile,
    transactionAmount,
    eventId,
    registrationId
  };
};

export const loadRegistrationCheckoutSnapshot = async (
  supabaseAdmin: SupabaseClient,
  registrationId: string
): Promise<SecureCheckoutSnapshot> => {
  const { data: registration, error } = await supabaseAdmin
    .from('registrations')
    .select('*')
    .eq('id', registrationId)
    .maybeSingle();

  if (error || !registration) {
    throw new Error('Inscricao nao encontrada para pagamento.');
  }

  const { data: athlete } = await supabaseAdmin
    .from('athletes')
    .select('*')
    .eq('id', registration.athlete_id)
    .maybeSingle();

  const registrationData = {
    id: registration.id,
    eventId: registration.event_id,
    divisionId: registration.division_id,
    userId: registration.user_id || undefined,
    athleteId: registration.athlete_id || undefined,
    athleteName: registration.athlete_name,
    athleteEmail: registration.athlete_email,
    athletePhone: registration.athlete_phone,
    box: registration.box,
    gender: registration.gender,
    ticketType: registration.ticket_type,
    ticketPrice: Number(registration.ticket_price),
    quantity: Number(registration.quantity),
    totalPaid: Number(registration.total_paid),
    serviceFeePercent: registration.service_fee_percent !== null && registration.service_fee_percent !== undefined ? Number(registration.service_fee_percent) : undefined,
    serviceFeeAmount: registration.service_fee_amount !== null && registration.service_fee_amount !== undefined ? Number(registration.service_fee_amount) : undefined,
    amountCollected: registration.amount_collected !== null && registration.amount_collected !== undefined ? Number(registration.amount_collected) : undefined,
    applicationFeeCharged: registration.application_fee_charged !== null && registration.application_fee_charged !== undefined ? Number(registration.application_fee_charged) : undefined,
    createdAt: registration.created_at,
    couponCode: registration.coupon_code || undefined,
    locale: registration.locale || undefined,
    currency: registration.currency || undefined
  };

  const athleteProfile = {
    id: athlete?.id || registration.athlete_id || undefined,
    name: athlete?.name || registration.athlete_name,
    box: athlete?.box || registration.box,
    country: athlete?.country || 'BR',
    divisionId: registration.division_id,
    birthDate: athlete?.birth_date || undefined,
    gender: athlete?.gender || registration.gender,
    city: athlete?.city || undefined,
    state: athlete?.state || undefined,
    instagram: athlete?.instagram || undefined,
    photoUrl: athlete?.photo_url || undefined,
    shirtSize: athlete?.shirt_size || undefined,
    email: athlete?.email || registration.athlete_email,
    phone: athlete?.phone || registration.athlete_phone,
    isTeam: athlete?.is_team || false,
    teamMembers: athlete?.team_members || []
  };

  const totalPaid = Number(registration.total_paid);
  return {
    registrationData,
    athleteProfile,
    transactionAmount: totalPaid > 0 && totalPaid < 1 ? 1 : totalPaid,
    eventId: registration.event_id,
    registrationId
  };
};

export const triggerRegistrationApprovedEmail = async (
  supabaseAdmin: SupabaseClient,
  registrationId: string
) => {
  try {
    const snapshot = await loadRegistrationCheckoutSnapshot(supabaseAdmin, registrationId);
    
    const { data: dbEvent, error: eventError } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', snapshot.eventId)
      .maybeSingle();

    if (eventError || !dbEvent) {
      console.error(`[Email Trigger] Evento ${snapshot.eventId} não encontrado para envio de e-mail.`);
      return { success: false, error: 'Evento não encontrado.' };
    }

    const event: Event = {
      id: dbEvent.id,
      name: dbEvent.name,
      logoUrl: dbEvent.logo_url,
      bannerUrl: dbEvent.banner_url,
      status: dbEvent.status,
      location: dbEvent.location,
      date: dbEvent.date,
      description: dbEvent.description,
      organizerId: dbEvent.organizer_id,
      sponsors: dbEvent.sponsors || [],
      divisions: [],
      workouts: [],
      format: dbEvent.format || 'individual',
      ticketPrice: dbEvent.ticket_price,
      ticketSlots: dbEvent.ticket_slots,
      isTicketingActive: dbEvent.is_ticketing_active,
      time: dbEvent.time || '',
      city: dbEvent.city || '',
      state: dbEvent.state || '',
      rules: dbEvent.rules || '',
      instagram: dbEvent.instagram || '',
      website: dbEvent.website || '',
      eventType: dbEvent.event_type || 'functional_fitness',
      currency: dbEvent.currency || 'BRL',
      defaultLocale: (dbEvent.default_locale as AppLocale) || 'pt-br'
    };

    const registration: Registration = {
      id: snapshot.registrationId,
      eventId: snapshot.eventId,
      divisionId: String(snapshot.registrationData.divisionId),
      userId: snapshot.registrationData.userId ? String(snapshot.registrationData.userId) : undefined,
      athleteId: snapshot.registrationData.athleteId ? String(snapshot.registrationData.athleteId) : undefined,
      athleteName: String(snapshot.registrationData.athleteName),
      athleteEmail: String(snapshot.registrationData.athleteEmail),
      athletePhone: String(snapshot.registrationData.athletePhone),
      box: snapshot.registrationData.box ? String(snapshot.registrationData.box) : '',
      gender: snapshot.registrationData.gender as 'male' | 'female',
      ticketType: String(snapshot.registrationData.ticketType),
      ticketPrice: Number(snapshot.registrationData.ticketPrice),
      quantity: Number(snapshot.registrationData.quantity),
      totalPaid: Number(snapshot.registrationData.totalPaid),
      createdAt: String(snapshot.registrationData.createdAt),
      couponCode: snapshot.registrationData.couponCode ? String(snapshot.registrationData.couponCode) : undefined,
      paymentStatus: 'payment_approved',
      updatedAt: new Date().toISOString(),
      locale: (snapshot.registrationData.locale as AppLocale) || undefined,
      currency: snapshot.registrationData.currency ? String(snapshot.registrationData.currency) as Registration['currency'] : undefined
    };

    const normalizeTeamMembers = (value: unknown) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    const athlete: Athlete = {
      id: snapshot.athleteProfile.id ? String(snapshot.athleteProfile.id) : `ath-${Date.now()}`,
      name: String(snapshot.athleteProfile.name),
      box: snapshot.athleteProfile.box ? String(snapshot.athleteProfile.box) : 'Independente',
      country: String(snapshot.athleteProfile.country || 'BR'),
      divisionId: String(snapshot.athleteProfile.divisionId),
      birthDate: snapshot.athleteProfile.birthDate ? String(snapshot.athleteProfile.birthDate) : '',
      gender: snapshot.athleteProfile.gender as 'male' | 'female',
      city: snapshot.athleteProfile.city ? String(snapshot.athleteProfile.city) : '',
      state: snapshot.athleteProfile.state ? String(snapshot.athleteProfile.state) : '',
      instagram: snapshot.athleteProfile.instagram ? String(snapshot.athleteProfile.instagram) : '',
      photoUrl: snapshot.athleteProfile.photoUrl ? String(snapshot.athleteProfile.photoUrl) : '',
      shirtSize: snapshot.athleteProfile.shirtSize ? String(snapshot.athleteProfile.shirtSize) : '',
      email: String(snapshot.athleteProfile.email),
      phone: String(snapshot.athleteProfile.phone),
      isTeam: Boolean(snapshot.athleteProfile.isTeam),
      teamMembers: normalizeTeamMembers(snapshot.athleteProfile.teamMembers)
    };

    console.log(`[Email Trigger] Disparando e-mail de confirmação para a inscrição ${registrationId}...`);
    const emailResult = await sendRegistrationEmail(registration, athlete, event, '', registration.locale || event.defaultLocale);
    
    if (!emailResult.success) {
      console.error(`[Email Trigger] Falha ao enviar e-mail via Resend:`, emailResult.error);
    } else {
      console.log(`[Email Trigger] E-mail enviado com sucesso! ID: ${emailResult.messageId}`);
    }

    return emailResult;
  } catch (err) {
    console.error(`[Email Trigger] Erro crítico no envio do e-mail da inscrição ${registrationId}:`, err);
    return { success: false, error: err };
  }
};

export type ManagerRegistrationInput = {
  eventId: string;
  divisionId: string;
  athleteName: string;
  athleteEmail: string;
  athletePhone: string;
  box?: string;
  gender: 'male' | 'female';
  couponCode?: string;
  birthDate?: string;
  city?: string;
  state?: string;
  instagram?: string;
  photoUrl?: string;
  shirtSize?: string;
  isTeam?: boolean;
  teamMembers?: { name: string; instagram?: string; shirtSize?: string }[];
};

/**
 * Cria uma inscrição manual iniciada pelo gestor (painel "Bilheteria"),
 * incluindo convites com 100% de desconto. Ao contrário do checkout público
 * (auto-atendimento, com senha escolhida pelo próprio atleta), aqui o gestor
 * já recebeu o pagamento (ou é um convite gratuito) no momento da inscrição:
 * o registro nasce aprovado quando o valor final calculado no servidor é
 * zero, e pendente caso contrário — nunca fica "esquecido" sem persistir,
 * que era a causa raiz do bug (o fluxo antigo só existia em memória local).
 */
export const createManagerRegistration = async (
  supabaseAdmin: SupabaseClient,
  input: ManagerRegistrationInput
): Promise<{ registration: Record<string, unknown>; athlete: Record<string, unknown> | null }> => {
  const email = asString(input.athleteEmail).toLowerCase();
  if (!email || !email.includes('@')) {
    throw new RegistrationAccessError('Informe um e-mail válido para o atleta.', 400);
  }
  const athleteName = asString(input.athleteName);
  if (!athleteName) throw new RegistrationAccessError('Informe o nome do atleta.', 400);
  const athletePhone = asString(input.athletePhone);
  if (!athletePhone) throw new RegistrationAccessError('Informe o telefone de contato.', 400);

  const secureSnapshot = await calculateSecureRegistrationSnapshot(
    supabaseAdmin,
    {
      eventId: input.eventId,
      divisionId: input.divisionId,
      couponCode: input.couponCode,
      quantity: 1
    },
    {}
  );
  const safeRegistrationData = secureSnapshot.registrationData;

  const { data: existingUser, error: existingUserError } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('email', email)
    .maybeSingle<{ id: string; role: string }>();
  if (existingUserError) {
    throw new RegistrationAccessError('Erro ao validar usuário do atleta.', 500);
  }

  let userId: string;
  if (existingUser) {
    if (existingUser.role !== 'athlete') {
      throw new RegistrationAccessError('Este e-mail já pertence a uma conta administrativa e não pode ser usado para inscrição de atleta.', 409);
    }
    userId = existingUser.id;
  } else {
    userId = `ath-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        id: userId,
        name: athleteName,
        email,
        role: 'athlete',
        organization: input.box || 'Atleta WODArena'
      });
    if (userError) {
      const isRoleConstraintError = userError.code === '23514'
        || String(userError.message || '').includes('users_role_check');
      throw new RegistrationAccessError(
        isRoleConstraintError
          ? 'Banco de dados ainda não aceita o papel de atleta. Aplique as migrations pendentes antes de tentar novamente.'
          : 'Erro ao criar o painel do atleta.',
        500
      );
    }

    // Sem senha escolhida pelo gestor: gera um segredo aleatório descartável.
    // O atleta define a própria senha depois via "esqueci minha senha".
    const { error: secretError } = await supabaseAdmin
      .from('users_secrets')
      .insert({
        user_id: userId,
        password: hashPassword(randomBytes(24).toString('hex'))
      });
    if (secretError) {
      throw new RegistrationAccessError('Erro ao configurar o acesso do atleta.', 500);
    }
  }

  const { data: existingRegistration, error: regCheckError } = await supabaseAdmin
    .from('registrations')
    .select('id')
    .eq('event_id', input.eventId)
    .eq('athlete_email', email)
    .not('payment_status', 'eq', 'payment_cancelled')
    .maybeSingle();
  if (regCheckError) {
    throw new RegistrationAccessError('Erro ao verificar inscrições existentes.', 500);
  }
  if (existingRegistration) {
    throw new RegistrationAccessError('Este e-mail já possui uma inscrição ativa para este evento.', 409);
  }

  let athleteId = `ath-${Date.now()}`;
  const teamMembersJson = JSON.stringify(input.teamMembers || []);
  const { data: existingAthlete } = await supabaseAdmin
    .from('athletes')
    .select('id')
    .eq('email', email)
    .eq('division_id', input.divisionId)
    .maybeSingle<{ id: string }>();

  if (existingAthlete) {
    athleteId = existingAthlete.id;
    const { error: athleteUpdateError } = await supabaseAdmin
      .from('athletes')
      .update({
        shirt_size: input.shirtSize || null,
        team_members: teamMembersJson
      })
      .eq('id', athleteId);
    if (athleteUpdateError) {
      throw new RegistrationAccessError('Erro ao atualizar dados do atleta.', 500);
    }
  } else {
    const { error: athleteError } = await supabaseAdmin
      .from('athletes')
      .insert({
        id: athleteId,
        name: athleteName,
        box: input.box || 'Independente',
        country: 'BR',
        division_id: input.divisionId,
        birth_date: input.birthDate || null,
        gender: input.gender || null,
        city: input.city || null,
        state: input.state || null,
        instagram: input.instagram || null,
        photo_url: input.photoUrl || null,
        shirt_size: input.shirtSize || null,
        email,
        phone: athletePhone,
        is_team: input.isTeam || false,
        team_members: teamMembersJson
      });
    if (athleteError) {
      throw new RegistrationAccessError('Erro ao registrar atleta.', 500);
    }
  }

  // payment_status nunca vem do cliente: só nasce aprovado quando o valor
  // calculado no servidor (cupom incluso) é zero — mesma regra do checkout
  // de auto-atendimento em /api/registrations/start.
  const paymentStatus = secureSnapshot.transactionAmount === 0 ? 'payment_approved' : 'payment_pending';
  const now = new Date().toISOString();
  const regId = `reg-${Date.now()}`;
  const registrationPayload = {
    id: regId,
    event_id: input.eventId,
    division_id: input.divisionId,
    user_id: userId,
    athlete_id: athleteId,
    athlete_name: athleteName,
    athlete_email: email,
    athlete_phone: athletePhone,
    box: input.box || 'Independente',
    gender: input.gender,
    ticket_type: safeRegistrationData.ticketType,
    ticket_price: Number(safeRegistrationData.ticketPrice),
    quantity: 1,
    total_paid: Number(safeRegistrationData.totalPaid),
    service_fee_percent: null,
    service_fee_amount: 0,
    amount_collected: Number(safeRegistrationData.totalPaid),
    application_fee_charged: 0,
    created_at: now,
    coupon_code: safeRegistrationData.couponCode || null,
    payment_status: paymentStatus,
    payment_method: 'manual',
    updated_at: now
  };

  const { data: dbRegistration, error: regError } = await supabaseAdmin
    .from('registrations')
    .insert(registrationPayload)
    .select('*')
    .single();

  if (regError || !dbRegistration) {
    if (regError?.code === '23505') {
      throw new RegistrationAccessError('Este e-mail já possui uma inscrição ativa para este evento.', 409);
    }
    throw new RegistrationAccessError('Erro ao registrar inscrição.', 500);
  }

  // Inscrição gratuita (cupom 100%) já nasce aprovada — contabiliza o uso do
  // cupom aqui, no mesmo ponto de transição para payment_approved usado pelo
  // checkout público, para não perder nem duplicar a contagem.
  if (paymentStatus === 'payment_approved') {
    await applyCouponUsageForApprovedRegistration(supabaseAdmin, regId);
  }

  const { data: dbAthlete } = await supabaseAdmin
    .from('athletes')
    .select('*')
    .eq('id', athleteId)
    .maybeSingle();

  return { registration: dbRegistration, athlete: dbAthlete || null };
};
