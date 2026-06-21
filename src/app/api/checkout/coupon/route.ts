import { NextResponse } from 'next/server';
import { validateCheckoutCoupon } from '@/lib/serverCheckout';
import { ManagerAccessError, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { checkRateLimit, createSupabaseAdmin, getClientIp } from '@/lib/serverSecurity';

const supabaseAdmin = createSupabaseAdmin();

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { eventId, divisionId, couponCode } = body;
    const normalizedCoupon = String(couponCode || '').trim().toUpperCase();

    const rateLimited = checkRateLimit({
      key: `checkout-coupon:${getClientIp(request)}:${eventId || 'missing'}:${normalizedCoupon || 'missing'}`,
      limit: 20,
      windowMs: 60_000
    });
    if (rateLimited) return rateLimited;

    const result = await validateCheckoutCoupon(
      supabaseAdmin,
      String(eventId || ''),
      String(divisionId || ''),
      normalizedCoupon
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[Checkout Coupon API] Erro ao validar cupom:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Erro ao validar cupom.'
    }, { status: 400 });
  }
}
