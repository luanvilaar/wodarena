import { SupabaseClient } from '@supabase/supabase-js';

type RegistrationInput = Record<string, unknown>;
type AthleteInput = Record<string, unknown>;

export type SecureCheckoutSnapshot = {
  registrationData: RegistrationInput;
  athleteProfile: AthleteInput;
  transactionAmount: number;
  eventId: string;
  registrationId: string;
};

const asString = (value: unknown, fallback = '') => typeof value === 'string' && value.trim()
  ? value.trim()
  : fallback;

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeCoupon = (value: unknown) => asString(value).toUpperCase();

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
    .select('id, name, ticket_price, ticket_slots, is_ticketing_active')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError || !event) {
    throw new Error('Evento nao encontrado para checkout.');
  }

  if (event.is_ticketing_active === false) {
    throw new Error('As inscricoes online deste evento estao encerradas.');
  }

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

    discount = coupon.discount_type === 'percentage'
      ? (ticketPrice * Number(coupon.discount_value || 0)) / 100
      : Number(coupon.discount_value || 0);
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
