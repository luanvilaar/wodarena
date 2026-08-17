---
name: public-repo-disclosure
description: wodarena é um repo GitHub PÚBLICO de SaaS de pagamentos em produção — auditar todo commit por secrets e por disclosure de vulnerabilidades
metadata:
  type: project
---

O remote `github.com/luanvilaar/wodarena` (branch `main`) é **PUBLIC** (confirmado via `gh repo view --json visibility` em 2026-08-14), apesar de ser o repositório de produção de um SaaS que processa pagamentos reais via Mercado Pago marketplace.

**Why:** Qualquer coisa commitada vira imediatamente pública e permanente no histórico do git — inclusive se removida depois. Combinado com o fato de o app ter auth custom (HMAC + scrypt, sem Supabase Auth), service role key server-side e split de pagamento, o custo de um vazamento é alto.

**How to apply:** Em toda revisão pré-push neste repo:
1. Varrer o diff por credenciais reais (`SUPABASE_SERVICE_ROLE_KEY`, `MERCADOPAGO_WEBHOOK_SECRET`, `WODA_SESSION_SECRET`, `RESEND_API_KEY`, tokens `APP_USR-`/`eyJ...`) — não só em código, mas em `.env*`, comentários e docs `.md`.
2. Tratar documentos de segurança com atenção redobrada: uma **spec/metodologia** genérica (ex.: `SECURITY-PENTEST.md`, playbook OWASP) é segura para publicar; um **relatório de achados** com endpoints, payloads e vulnerabilidades específicas do WODArena **não é** — vira roadmap de ataque público. Sempre checar se o doc referencia endpoints reais antes de liberar.
3. Confirmar que nenhum `.env` real entrou no commit (só `.env.example` é rastreado).

Relacionado: [[qa-prepush-verification-routine]]
