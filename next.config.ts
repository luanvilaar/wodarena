import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Origem do Supabase derivada do env público (auth, REST, storage e realtime).
 * Em runtime/build o valor real é injetado; mantemos um fallback amplo (*.supabase.co)
 * apenas para não quebrar caso a variável esteja ausente em algum ambiente.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseHttp = supabaseUrl || "https://*.supabase.co";
const supabaseWss = supabaseUrl
  ? supabaseUrl.replace(/^https?:\/\//, "wss://")
  : "wss://*.supabase.co";

/**
 * Content-Security-Policy (Opção B — sem nonce).
 * Modo: ENFORCE (bloqueia recursos fora da allowlist e pontua no Observatory/SecurityHeaders).
 * A CSP foi desenhada para ser livre de regressões (vide SECURITY-HEADERS.md).
 * Para validar antes de bloquear, troque a chave do header abaixo para
 * "Content-Security-Policy-Report-Only" (apenas reporta, não bloqueia).
 * Domínios liberados estão documentados em SECURITY-HEADERS.md.
 */
const cspDirectives: string[] = [
  "default-src 'self'",
  // 'unsafe-inline' é necessário para os scripts inline de bootstrap/hydration do Next.js.
  // 'unsafe-eval' apenas em desenvolvimento (React Refresh usa eval); nunca em produção.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://sdk.mercadopago.com https://*.mercadopago.com https://*.mlstatic.com`,
  // Next.js e Tailwind injetam estilos inline; baixo risco de XSS.
  "style-src 'self' 'unsafe-inline'",
  // data: (QR Code PIX em base64), blob: (downloads), https: (logos/banners de eventos são URLs externas arbitrárias).
  "img-src 'self' data: blob: https:",
  // Fontes auto-hospedadas pelo next/font (sem CDN externo).
  "font-src 'self' data:",
  // Supabase (REST/auth/storage + realtime via wss) e APIs do Mercado Pago (tokenização de cartão).
  `connect-src 'self' ${supabaseHttp} ${supabaseWss} https://api.mercadopago.com https://*.mercadopago.com https://*.mlstatic.com`,
  // Iframes do SDK Mercado Pago (Secure Fields / Bricks).
  "frame-src 'self' https://*.mercadopago.com https://*.mlstatic.com",
  // Anti-clickjacking (substituto moderno do X-Frame-Options).
  "frame-ancestors 'self'",
  // Permite o redirect de checkout (init_point) para o Mercado Pago.
  "form-action 'self' https://*.mercadopago.com",
  "base-uri 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
];

const contentSecurityPolicy = cspDirectives.join("; ");

const securityHeaders = [
  {
    // Enforce: aplica a política (bloqueia o que estiver fora da allowlist).
    // Para um rollout em etapas, troque para "Content-Security-Policy-Report-Only".
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
