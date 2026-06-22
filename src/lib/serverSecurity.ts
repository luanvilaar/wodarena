import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'athlete';
  organization?: string;
};

export type DbUserRecord = SessionUser & {
  service_valid_until?: string | null;
};

const SESSION_COOKIE = 'woda_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const REGISTRATION_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24;
const PASSWORD_PREFIX = 'scrypt';

export const getRequiredServerEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
};

export const createSupabaseAdmin = () => createClient(
  getRequiredServerEnv('SUPABASE_URL'),
  getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY'),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const getSessionSecret = () => {
  const configuredSecret = process.env.WODA_SESSION_SECRET?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Variavel de ambiente obrigatoria ausente: WODA_SESSION_SECRET');
  }

  return 'wodarena-dev-session-secret';
};

const base64UrlEncode = (value: Buffer | string) => Buffer
  .from(value)
  .toString('base64url');

const base64UrlJson = (value: unknown) => base64UrlEncode(JSON.stringify(value));

const sign = (payload: string, purpose = 'session') => createHmac('sha256', `${getSessionSecret()}:${purpose}`)
  .update(payload)
  .digest('base64url');

type RegistrationAccessClaims = {
  typ: 'registration-access';
  sub: string;
  eventId: string;
  userId?: string;
  iat: number;
  exp: number;
};

export const createSessionToken = (user: SessionUser) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlJson({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    organization: user.organization,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS
  });
  return `${payload}.${sign(payload, 'session')}`;
};

export const createRegistrationAccessToken = (input: {
  registrationId: string;
  eventId: string;
  userId?: string;
}) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlJson({
    typ: 'registration-access',
    sub: input.registrationId,
    eventId: input.eventId,
    userId: input.userId,
    iat: now,
    exp: now + REGISTRATION_ACCESS_MAX_AGE_SECONDS
  } satisfies RegistrationAccessClaims);

  return `${payload}.${sign(payload, 'registration-access')}`;
};

export const getSessionCookieHeader = (token: string) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
};

export const getClearSessionCookieHeader = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const parseCookies = (cookieHeader: string | null) => Object.fromEntries(
  (cookieHeader || '')
    .split(';')
    .map(cookie => cookie.trim())
    .filter(Boolean)
    .map(cookie => {
      const index = cookie.indexOf('=');
      return index === -1 ? [cookie, ''] : [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
    })
);

export const verifySessionToken = (token: string | null): SessionUser | null => {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expectedSignature = sign(payload, 'session');
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded?.sub || !decoded?.email || !decoded?.role || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      id: String(decoded.sub),
      name: String(decoded.name || ''),
      email: String(decoded.email),
      role: decoded.role,
      organization: decoded.organization ? String(decoded.organization) : undefined
    };
  } catch {
    return null;
  }
};

export const verifyRegistrationAccessToken = (
  token: string | null
): RegistrationAccessClaims | null => {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expectedSignature = sign(payload, 'registration-access');
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<RegistrationAccessClaims>;
    if (
      decoded?.typ !== 'registration-access'
      || !decoded.sub
      || !decoded.eventId
      || !decoded.exp
      || decoded.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      typ: 'registration-access',
      sub: String(decoded.sub),
      eventId: String(decoded.eventId),
      userId: decoded.userId ? String(decoded.userId) : undefined,
      iat: Number(decoded.iat || 0),
      exp: Number(decoded.exp)
    };
  } catch {
    return null;
  }
};

export const getRequestSession = (request: Request) => {
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
  const cookies = parseCookies(request.headers.get('cookie'));
  return verifySessionToken(bearer || cookies[SESSION_COOKIE] || null);
};

export const requireSession = (request: Request, allowedRoles?: SessionUser['role'][]) => {
  const user = getRequestSession(request);
  if (!user) {
    return {
      response: NextResponse.json({ error: 'Sessao invalida ou expirada.' }, { status: 401 })
    };
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return {
      response: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 })
    };
  }

  return { user };
};

export const canActOnUser = (actor: SessionUser, targetUserId: string) => (
  actor.role === 'owner' || actor.id === targetUserId
);

export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `${PASSWORD_PREFIX}$${salt}$${hash}`;
};

export const verifyPassword = (password: string, storedPassword: string) => {
  if (!storedPassword.startsWith(`${PASSWORD_PREFIX}$`)) {
    return {
      valid: timingSafeStringEqual(password, storedPassword),
      needsRehash: true
    };
  }

  const [, salt, hash] = storedPassword.split('$');
  if (!salt || !hash) return { valid: false, needsRehash: false };
  const actual = Buffer.from(scryptSync(password, salt, 64).toString('base64url'));
  const expected = Buffer.from(hash);
  return {
    valid: actual.length === expected.length && timingSafeEqual(actual, expected),
    needsRehash: false
  };
};

const timingSafeStringEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const maskEmailForLog = (email: string) => {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '[email-redacted]';
  return `${name.slice(0, 2)}***@${domain}`;
};

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export const checkRateLimit = ({ key, limit, windowMs }: RateLimitOptions) => {
  const now = Date.now();
  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count += 1;
  if (current.count > limit) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, { status: 429 });
  }

  return null;
};

export const getClientIp = (request: Request) => (
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || request.headers.get('x-real-ip')
  || 'unknown'
);

export const loadUserById = async (supabaseAdmin: SupabaseClient, userId: string) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role, organization, service_valid_until')
    .eq('id', userId)
    .maybeSingle<DbUserRecord>();

  if (error) throw error;
  return data;
};
