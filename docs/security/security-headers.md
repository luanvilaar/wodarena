# Security Headers — WODArena

Documentação dos headers de segurança configurados em [`next.config.ts`](../../next.config.ts).

- **Framework:** Next.js 16 (App Router) · **Deploy:** Vercel
- **Local de configuração:** `next.config.ts` → `async headers()` (aplicado a `/:path*`)
- **Status atual da CSP:** **Enforce** (bloqueia recursos fora da allowlist e pontua no Observatory/SecurityHeaders). Para um rollout em etapas, ver "Validar antes de bloquear" abaixo.

---

## Headers aplicados

| Header | Valor | Função |
|---|---|---|
| `Content-Security-Policy` | ver CSP abaixo | Controla origens de conteúdo (modo enforce — bloqueia) |
| `X-Content-Type-Options` | `nosniff` | Impede MIME sniffing |
| `X-Frame-Options` | `SAMEORIGIN` | Anti-clickjacking (compat. navegadores antigos) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limita o referrer enviado a terceiros |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Força HTTPS (2 anos + preload) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), browsing-topics=()` | Desativa APIs do navegador não usadas |

---

## CSP — diretivas e justificativa

| Diretiva | Valor | Por quê |
|---|---|---|
| `default-src` | `'self'` | Base restritiva (fallback de tudo) |
| `script-src` | `'self' 'unsafe-inline' https://sdk.mercadopago.com https://*.mercadopago.com https://*.mlstatic.com` | `'unsafe-inline'`: scripts de bootstrap/hydration do Next.js. Domínios MP: SDK de pagamento (`sdk.mercadopago.com/js/v2`). `'unsafe-eval'` é adicionado **apenas em desenvolvimento** (React Refresh) |
| `style-src` | `'self' 'unsafe-inline'` | Next.js/Tailwind injetam estilos inline; `<style>` em RegistrationVoucher |
| `img-src` | `'self' data: blob: https:` | `data:` (QR PIX base64), `blob:` (downloads), `https:` (logos/banners de eventos são **URLs externas arbitrárias** — default Unsplash) |
| `font-src` | `'self' data:` | Fontes auto-hospedadas pelo `next/font` (sem CDN externo) |
| `connect-src` | `'self' {supabase https} {supabase wss} https://api.mercadopago.com https://*.mercadopago.com https://*.mlstatic.com` | XHR/fetch/WebSocket: Supabase (auth, REST, storage, realtime) e tokenização de cartão MP |
| `frame-src` | `'self' https://*.mercadopago.com https://*.mlstatic.com` | Iframes do SDK MP (Secure Fields / Bricks) |
| `frame-ancestors` | `'self'` | Anti-clickjacking (moderno) |
| `form-action` | `'self' https://*.mercadopago.com` | Redirect de checkout (`init_point`) |
| `base-uri` | `'self'` | Bloqueia injeção de `<base>` |
| `object-src` | `'none'` | Bloqueia `<object>`/`<embed>`/plugins |
| `worker-src` | `'self' blob:` | Web Workers a partir de blobs |
| `upgrade-insecure-requests` | — | Promove sub-requisições http→https |

> A origem do Supabase é derivada automaticamente de `NEXT_PUBLIC_SUPABASE_URL` em build, gerando os valores `https://` e `wss://` correspondentes (fallback `*.supabase.co` se a variável estiver ausente).

### Domínios externos liberados (e motivo)

| Domínio | Diretiva(s) | Motivo |
|---|---|---|
| `https://momigbtnsswoldqnadmc.supabase.co` | connect-src, img-src(https) | Backend Supabase (auth/DB/storage) |
| `wss://momigbtnsswoldqnadmc.supabase.co` | connect-src | Supabase Realtime (WebSocket) |
| `https://sdk.mercadopago.com` | script-src | SDK JS v2 do Mercado Pago |
| `https://*.mercadopago.com` | script-src, connect-src, frame-src, form-action | API, iframes e redirect do Mercado Pago |
| `https://api.mercadopago.com` | connect-src | Tokenização de cartão / métodos de pagamento |
| `https://*.mlstatic.com` | script-src, connect-src, frame-src, img-src(https) | Assets estáticos do Mercado Pago/Mercado Livre |
| `https:` (genérico) | img-src | Logos/banners de eventos com URL externa arbitrária |

---

## Validar antes de bloquear (rollout em etapas — opcional)

A CSP já está em **enforce**. Caso prefira validar sem bloquear antes de um deploy de produção,
inverta temporariamente em [`next.config.ts`](next.config.ts):

```diff
- key: "Content-Security-Policy",
+ key: "Content-Security-Policy-Report-Only",
```

Nesse modo nada é bloqueado — violações aparecem como `[Report Only] Refused to...` no console.
Após validar o checklist, volte para `Content-Security-Policy` e redeploy.

> **Atenção:** Mozilla Observatory e SecurityHeaders.com **não** pontuam a CSP em
> `Report-Only` — apenas o header enforcing `Content-Security-Policy` conta para a nota.

---

## Checklist de validação (executar em produção)

- [x] `npm run build` sem erros
- [x] `npm run lint` sem erros (warnings pré-existentes apenas)
- [x] `npm run typecheck` sem erros
- [x] Headers presentes em rotas estáticas e dinâmicas (`curl -I`)
- [ ] Home, listagem de eventos e leaderboard carregam (sem tela branca)
- [ ] Login/auth Supabase funciona
- [ ] Imagens de banner/logo (Unsplash + uploads) aparecem
- [ ] Checkout cartão (SDK MP tokeniza) funciona
- [ ] Checkout PIX (QR `data:`) renderiza
- [ ] Redirect Checkout Pro (`init_point`) funciona
- [ ] Console do browser **sem** `[Report Only] Refused to...` inesperado
- [ ] Mozilla Observatory / SecurityHeaders.com → nota A/A+

---

## Rollback

- **Reverter tudo:** remover o bloco `async headers()` de `next.config.ts` (ou `git revert` do commit) + redeploy.
- **Reverter só o enforce:** voltar a chave para `Content-Security-Policy-Report-Only`.
- **HSTS preload:** a remoção da preload list é lenta (requer submissão em hstspreload.org). Se for um risco, remover `; preload` do header **antes** do primeiro deploy com o domínio na lista.

---

## Notas / limitações

- **`payment=()`** desativa a W3C Payment Request API. A integração MP usa redirect (`init_point`) + tokenização (`createCardToken`), que **não** dependem dessa API. Se no futuro usar MP Bricks/Payment Request, alterar para `payment=(self)`.
- **`'unsafe-inline'` em `script-src`** é necessário porque a CSP é sem nonce (Opção B). Para nota A+ no Observatory e remoção do `'unsafe-inline'`, migrar futuramente para CSP baseada em **nonce + `strict-dynamic`** via `middleware.ts`.
