# Plano — Banner + Logo do Evento no E-mail de Confirmação de Inscrição

**Status:** Aguardando verificação manual antes da implementação
**Arquivo-alvo:** `src/lib/resend.ts` → função `sendRegistrationEmail` (linhas 139-464)
**Design de referência:** `docs/design/desinger-novo.md` (Binance flat — canvas escuro, accent único `#FCD535`, hairlines `#eaecef`, cards radius 12px)

---

## 1. Objetivo

Atualizar o e-mail de confirmação de inscrição para que o **header** carregue:
1. O **banner do evento** (`event.bannerUrl`) no topo.
2. A **logo do evento** (`event.logoUrl`) em um selo sobreposto.

Mantendo a identidade da plataforma **WODArena** (faixa de marca com o wordmark amarelo) acima do banner do evento.

---

## 2. Estado atual

O header hoje é apenas a faixa escura com o wordmark da plataforma (linhas 330-334):

```html
<!-- Header Banner -->
<div class="header">
  <div class="header-logo">WODArena</div>
</div>
```

Não há nenhuma referência visual ao evento específico no e-mail.

---

## 3. Dados disponíveis (sem necessidade de novas queries)

O objeto `Event` já chega completo na função, com os campos preenchidos pelos dois fluxos que enviam o e-mail:

| Campo | Origem no banco | Fluxos que populam |
|-------|-----------------|--------------------|
| `event.bannerUrl` | `events.banner_url` | `api/checkout/email/route.ts:84`, `api/webhooks/mercadopago/route.ts:88` |
| `event.logoUrl` | `events.logo_url` | `api/checkout/email/route.ts:83`, `api/webhooks/mercadopago/route.ts:87` |
| `event.name` | `events.name` | ambos |

> **Conclusão:** a mudança é **somente de template** (HTML/CSS), sem alterar APIs, banco ou tipos.

---

## 4. Estratégia de compatibilidade (e-mail ≠ navegador)

Clientes de e-mail (especialmente Outlook desktop) não suportam bem `position:absolute`, `object-fit` ou `background-image` com overlay. Por isso:

- Header construído com **tabelas** (`role="presentation"`) em vez de `div` + flex.
- Banner como `<img>` full-width (`width:100%; max-width:580px; height:auto; display:block`).
- Logo num **selo branco com borda** centralizado, sobreposto via `margin-top` negativo. **Degradação graciosa:** se o cliente ignorar a margem negativa (Outlook), a logo apenas aparece centralizada logo abaixo do banner — ainda fica bom.
- **Fallbacks completos:**
  - Sem banner **e** sem logo → mostra só a faixa de marca WODArena (≈ header atual).
  - Com banner, sem logo → banner + faixa, sem selo.
  - Sem banner, com logo → selo da logo sobre fundo branco (margem normal, sem sobreposição).
- URLs **escapadas** com a função `escapeHtml` já existente no arquivo (evita quebra de atributo/HTML injection a partir de URLs vindas do painel).

---

## 5. Mudança A — Novas variáveis (antes de montar o `htmlContent`)

Adicionar logo após o bloco `teamMembersList` (≈ linha 177), antes do comentário do template:

```ts
  // Recursos visuais do evento (banner no topo, logo em selo sobreposto)
  const safeEventName = escapeHtml(event.name || 'Evento WODArena');
  const safeBannerUrl = event.bannerUrl ? escapeHtml(event.bannerUrl) : '';
  const safeLogoUrl = event.logoUrl ? escapeHtml(event.logoUrl) : '';
  const hasBanner = Boolean(safeBannerUrl);
  const hasLogo = Boolean(safeLogoUrl);
```

---

## 6. Mudança B — Novo HTML do header

**Substituir** o bloco atual (linhas 330-334):

```html
          <!-- Header Banner -->
          <div class="header">
            <div class="header-logo">WODArena</div>
          </div>
```

**Por** este (usa as variáveis acima via template string):

```html
          <!-- Header: faixa de marca WODArena + banner do evento + logo -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
            <tr>
              <td style="background-color: #181a20; padding: 14px 24px; text-align: center; border-bottom: 3px solid #FCD535;">
                <span style="color: #FCD535; font-size: 15px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">WODArena</span>
              </td>
            </tr>
            ${hasBanner ? `
            <tr>
              <td style="background-color: #0b0e11; padding: 0; font-size: 0; line-height: 0;">
                <img src="${safeBannerUrl}" alt="${safeEventName}" width="580" style="display: block; width: 100%; max-width: 580px; height: auto; border: 0; outline: none; text-decoration: none;">
              </td>
            </tr>` : ''}
            ${hasLogo ? `
            <tr>
              <td style="background-color: #ffffff; text-align: center; padding: 0;">
                <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: ${hasBanner ? '-40px' : '24px'} auto 0 auto;">
                  <tr>
                    <td style="background-color: #ffffff; border: 1px solid #eaecef; border-radius: 12px; padding: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
                      <img src="${safeLogoUrl}" alt="${safeEventName} logo" width="72" height="72" style="display: block; width: 72px; height: 72px; border-radius: 8px; border: 0;">
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}
          </table>
```

> Observação: o `.container` já tem `border-radius: 12px; overflow: hidden`, então o banner herda os cantos arredondados no topo. As classes CSS `.header` e `.header-logo` ficam órfãs após a troca — podem ser removidas do `<style>` (linhas 210-222) ou mantidas sem efeito colateral. Recomendo remover para higiene.

---

## 7. Pré-visualização do layout (caso completo: com banner + logo)

```
┌─────────────────────────────────────────┐
│  ▓▓ WODArena ▓▓ (faixa escura, barra ───) │  ← faixa de marca da plataforma
├─────────────────────────────────────────┤
│                                           │
│        [ BANNER DO EVENTO — img ]         │  ← event.bannerUrl, full-width
│                                           │
│                ┌────────┐                 │
│                │  LOGO  │ ← selo branco,   │  ← event.logoUrl sobreposto
├────────────────│ evento │─────────────────┤
│                └────────┘                 │
│   [Badge] Sua inscrição está confirmada!  │  ← corpo (inalterado)
│   ...                                      │
```

---

## 8. Escopo do que NÃO muda

- Corpo do e-mail (detalhes da inscrição, badges, validação, footer): **inalterado**.
- Assunto, remetente, lógica de envio, status de pagamento: **inalterado**.
- E-mail de recuperação de senha (`sendPasswordResetEmail`): **fora de escopo**.

---

## 9. Riscos & mitigação

| Risco | Mitigação |
|-------|-----------|
| Banner muito alto desequilibra o e-mail | Banner respeita proporção original; sugiro validar com um banner real (16:9 ou 1200×400) |
| Outlook ignora `margin` negativa | Degrada para logo centralizada abaixo do banner — ainda apresentável |
| URL de banner/logo quebrada/ausente | Fallbacks por `hasBanner`/`hasLogo`; faixa WODArena sempre presente |
| Imagem bloqueada pelo cliente | `alt` com nome do evento + faixa de marca textual garantem contexto |

---

## 10. Checklist de verificação manual (sua revisão)

- [ ] Aprovar o layout proposto (faixa WODArena no topo + banner + logo sobreposta)
- [ ] Confirmar tamanho do selo da logo (72×72) e radius
- [ ] Confirmar manter a faixa de marca WODArena acima do banner
- [ ] Confirmar remoção das classes `.header`/`.header-logo` órfãs
- [ ] Autorizar implementação em `src/lib/resend.ts`

---

**Após sua aprovação:** aplico as Mudanças A e B em `src/lib/resend.ts`, rodo `npm run lint` + `npm run typecheck` e reporto o resultado.
