import { NextResponse } from 'next/server';
import { getClearSessionCookieHeader } from '@/lib/serverSecurity';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.headers.set('Set-Cookie', getClearSessionCookieHeader());
  return response;
}
