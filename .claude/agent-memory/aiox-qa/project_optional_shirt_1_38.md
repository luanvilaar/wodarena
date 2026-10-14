---
name: project-optional-shirt-1-38
description: Story 1.38 camisa opcional — gate final CONCERNS em 2026-10-14 (M-1 e M-2 corrigidos); LOWs abertos e o que conferir no re-gate
metadata:
  type: project
---

Story 1.38 (camisa opcional com adicional por evento). Rodada 1 do QA (servidor + lado do atleta) em 2026-10-13: CONCERNS, com M-1 (navegador decidia sozinho se a inscrição era gratuita) e M-2 (edição aceitava tamanho vazio). Rodada 2 / gate final em 2026-10-14, já com o painel do gestor: CONCERNS sem achados CRITICAL, HIGH ou MEDIUM; M-1 e M-2 corrigidos e conferidos.

**Why:** a regra pura `src/lib/shirtPricing.ts` está sólida (fuzz de 350 mil casos sem divergência). O risco que sobra está nas bordas e nas mudanças de comportamento em eventos existentes (AC13), que precisam de aceite registrado na story.

**How to apply:** no próximo re-gate, conferir: o ramo gratuito usa o `totalPaid`/`paymentStatus` devolvido por `/api/registrations/start`; a edição recusa tamanho vazio para quem já tinha tamanho; LOWs abertos L-1 (1 a 2 centavos com cupom percentual no modo incluso), L-3 (relocação não recobra), L-4, L-6 (parcial), R2-L-1 (resumo do pedido com valores antigos ao lado do aviso) e L-8 (aplicar a migration antes do deploy). Achados fora do escopo de uma story seguem o canal privado (ver [[project-public-repo-disclosure]]).
