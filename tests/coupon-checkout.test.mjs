import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const registerModal = read('../src/components/RegisterModal.tsx');
const couponRoute = read('../src/app/api/checkout/coupon/route.ts');
const serverCheckout = read('../src/lib/serverCheckout.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const bootstrapPublicRoute = read('../src/app/api/app/bootstrap/public/route.ts');
const bootstrapPayloadHelper = read('../src/lib/bootstrapPayload.ts');

test('checkout coupon application validates against the server instead of client bootstrap state', () => {
  assert.match(couponRoute, /export async function POST\(request: Request\)/);
  assert.match(couponRoute, /validateCheckoutCoupon/);
  assert.match(couponRoute, /checkRateLimit/);
  assert.match(registerModal, /fetch\('\/api\/checkout\/coupon'/);
  assert.match(registerModal, /setDiscountApplied\(Number\(data\.discount\)\)/);
  assert.doesNotMatch(registerModal, /const \{ coupons,/);
  assert.doesNotMatch(registerModal, /coupons\.find/);
});

test('anonymous bootstrap does not expose coupon lists while coupon API returns only applied summary', () => {
  assert.match(bootstrapRoute, /requireSession\(request, \['owner', 'manager', 'athlete'\]\)/);
  assert.match(bootstrapPublicRoute, /buildPublicBootstrapPayload/);
  assert.match(bootstrapPayloadHelper, /coupons: \[\]/);
  assert.match(couponRoute, /return NextResponse\.json\(result\)/);
  assert.match(serverCheckout, /export type CouponValidationResult = \{/);
  assert.match(serverCheckout, /code: string;/);
  assert.match(serverCheckout, /discount: number;/);
  assert.match(serverCheckout, /totalPaid: number;/);
  assert.doesNotMatch(serverCheckout, /CouponValidationResult[\s\S]*usageCount/);
});

test('coupon discount state is cleared when the selected category or typed code changes', () => {
  assert.match(registerModal, /const clearAppliedCoupon = \(\) => \{/);
  assert.match(registerModal, /onChange=\{\(e\) => \{[\s\S]*setSelectedDivisionId\(e\.target\.value\);[\s\S]*clearAppliedCoupon\(\);[\s\S]*setCouponNotice\(null\);[\s\S]*\}\}/);
  assert.match(registerModal, /e\.target\.value\.trim\(\)\.toUpperCase\(\) !== appliedCoupon/);
  assert.match(registerModal, /clearAppliedCoupon\(\);/);
});
