import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Exclui /api/**, os painéis internos (/admin, /owner, /judge), assets do
  // Next e qualquer caminho com extensão de arquivo. Se /api escapar dessa
  // exclusão, o webhook do Mercado Pago (/api/webhooks/mercadopago) passa a
  // ser redirecionado com prefixo de locale e pagamentos param de confirmar.
  matcher: [
    '/',
    '/(pt-br)/:path*',
    '/((?!api|admin|owner|judge|_next|_vercel|.*\\..*).*)'
  ]
};
