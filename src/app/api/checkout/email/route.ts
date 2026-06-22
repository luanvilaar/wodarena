import { NextResponse } from 'next/server';
import { sendRegistrationEmail } from '@/lib/resend';
import { Registration, Athlete, Event } from '@/types';
import { assertRegistrationAccess, RegistrationAccessError } from '@/lib/serverCheckout';
import { checkRateLimit, createSupabaseAdmin, getClientIp } from '@/lib/serverSecurity';

const supabaseAdmin = createSupabaseAdmin();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationId, cpf, accessToken } = body;

    if (!registrationId) {
      return NextResponse.json({ error: 'Parâmetro registrationId obrigatório.' }, { status: 400 });
    }

    const rateLimited = checkRateLimit({
      key: `checkout-email:${getClientIp(request)}:${registrationId}`,
      limit: 3,
      windowMs: 60 * 60 * 1000
    });
    if (rateLimited) return rateLimited;

    console.log(`[Email API Endpoint] Processando solicitação para inscrição ${registrationId}...`);

    await assertRegistrationAccess(supabaseAdmin, request, {
      registrationId,
      accessToken
    });

    // 1. Buscar a inscrição no Supabase
    const { data: dbReg, error: regErr } = await supabaseAdmin
      .from('registrations')
      .select('*')
      .eq('id', registrationId)
      .maybeSingle();

    if (regErr || !dbReg) {
      console.warn(`[Email API Endpoint] Inscrição ${registrationId} não encontrada ou erro no banco.`);
      return NextResponse.json({ error: 'Inscrição não encontrada.' }, { status: 404 });
    }

    if (dbReg.payment_status && dbReg.payment_status !== 'payment_approved') {
      return NextResponse.json({ error: 'Comprovante disponível apenas após confirmação do pagamento.' }, { status: 403 });
    }

    // Mapear para o formato do tipo Registration
    const registration: Registration = {
      id: dbReg.id,
      eventId: dbReg.event_id,
      divisionId: dbReg.division_id,
      userId: dbReg.user_id || undefined,
      athleteId: dbReg.athlete_id || undefined,
      athleteName: dbReg.athlete_name,
      athleteEmail: dbReg.athlete_email,
      athletePhone: dbReg.athlete_phone,
      box: dbReg.box,
      gender: dbReg.gender,
      ticketType: dbReg.ticket_type,
      ticketPrice: dbReg.ticket_price,
      quantity: dbReg.quantity,
      totalPaid: dbReg.total_paid,
      createdAt: dbReg.created_at,
      couponCode: dbReg.coupon_code || undefined,
      paymentStatus: dbReg.payment_status || 'payment_approved',
      paymentMethod: dbReg.payment_method || undefined,
      paymentId: dbReg.payment_id || undefined,
      paymentStatusDetail: dbReg.payment_status_detail || undefined,
      paymentErrorMessage: dbReg.payment_error_message || undefined,
      updatedAt: dbReg.updated_at || undefined
    };

    // 2. Buscar o evento
    const { data: dbEvent, error: evtErr } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', registration.eventId)
      .maybeSingle();

    if (evtErr || !dbEvent) {
      console.error(`[Email API Endpoint] Evento ${registration.eventId} não encontrado.`);
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
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
      divisions: [], // Não necessário para o e-mail
      workouts: [], // Não necessário para o e-mail
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

    // 3. Buscar o atleta (para verificar se é equipe e integrantes)
    const athleteLookup = registration.athleteId
      ? supabaseAdmin
        .from('athletes')
        .select('*')
        .eq('id', registration.athleteId)
        .maybeSingle()
      : supabaseAdmin
        .from('athletes')
        .select('*')
        .eq('name', registration.athleteName)
        .eq('division_id', registration.divisionId)
        .maybeSingle();

    const { data: dbAthlete } = await athleteLookup;

    const athlete: Athlete = {
      id: dbAthlete?.id || `ath-${Date.now()}`,
      name: registration.athleteName,
      box: registration.box || 'Independente',
      country: 'BR',
      divisionId: registration.divisionId,
      birthDate: dbAthlete?.birth_date || '',
      gender: dbAthlete?.gender || undefined,
      city: dbAthlete?.city || '',
      state: dbAthlete?.state || '',
      instagram: dbAthlete?.instagram || '',
      photoUrl: dbAthlete?.photo_url || '',
      shirtSize: dbAthlete?.shirt_size || '',
      email: dbAthlete?.email || registration.athleteEmail,
      phone: dbAthlete?.phone || registration.athletePhone,
      isTeam: dbAthlete?.is_team || false,
      teamMembers: dbAthlete?.team_members
        ? (typeof dbAthlete.team_members === 'string' ? JSON.parse(dbAthlete.team_members) : dbAthlete.team_members)
        : []
    };

    // 4. Disparar e-mail via Resend
    const emailResult = await sendRegistrationEmail(registration, athlete, event, cpf || '');

    if (!emailResult.success) {
      console.error(`[Email API Endpoint] Falha no disparo de e-mail:`, emailResult.error);
      return NextResponse.json({ success: false, error: emailResult.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, messageId: emailResult.messageId });
  } catch (err) {
    if (err instanceof RegistrationAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Email API Endpoint] Erro crítico no endpoint de e-mail:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
