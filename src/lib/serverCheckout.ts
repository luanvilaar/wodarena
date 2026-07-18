import { SupabaseClient } from '@supabase/supabase-js';
import { assertManagerSalesAccessForEvent } from '@/lib/serverManagerAccess';
import { getRequestSession, verifyRegistrationAccessToken } from '@/lib/serverSecurity';
import { sendRegistrationEmail } from '@/lib/resend';
import { getEventStatus } from '@/lib/eventStatus';
import { Registration, Athlete, Event } from '@/types';

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

  if (event.is_ticketing_active === false) {
    throw new Error('As inscricoes online deste evento estao encerradas.');
  }

  if (getEventStatus({
    status: event.status,
    date: event.date,
    registrationDeadline: event.registration_deadline || undefined,
  }) === 'finished') {
    throw new RegistrationAccessError('Este evento esta encerrado e nao aceita novas inscricoes.', 409);
  }

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

  if (event.is_ticketing_active === false) {
    throw new Error('As inscricoes online deste evento estao encerradas.');
  }

  if (getEventStatus({
    status: event.status,
    date: event.date,
    registrationDeadline: event.registration_deadline || undefined,
  }) === 'finished') {
    throw new RegistrationAccessError('Este evento esta encerrado e nao aceita novas inscricoes.', 409);
  }

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
    createdAt: registration.created_at,
    couponCode: registration.coupon_code || undefined
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
      eventType: dbEvent.event_type || 'functional_fitness'
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
      updatedAt: new Date().toISOString()
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
    const emailResult = await sendRegistrationEmail(registration, athlete, event, '');
    
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
