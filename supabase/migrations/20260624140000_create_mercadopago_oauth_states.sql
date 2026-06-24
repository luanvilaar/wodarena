-- Criar tabela para gerenciar estados de segurança (CSRF) temporários do Mercado Pago (uso único)
CREATE TABLE IF NOT EXISTS public.mercadopago_oauth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

-- Habilitar RLS (sem policies públicas/autenticadas, acesso exclusivo da service_role)
ALTER TABLE public.mercadopago_oauth_states ENABLE ROW LEVEL SECURITY;
