# UX Specification: Event Lifecycle State Signals

**Version:** 1.1  
**Author:** Uma (UX Design Expert)  
**Date:** 2026-06-21  
**Status:** Design Proposal (Awaiting Approval)

---

## Executive Summary

Eventos atualmente exibem cards uniformes sem distinção visual do estágio do ciclo de vida. O usuário não consegue identificar rapidamente se um evento está:

- **Ativo** — inscrições abertas, evento futuro
- **Em período final** — últimas horas ou dias para inscrição
- **Encerrado** — inscrições fechadas ou evento já ocorreu

Este spec introduz sinais visuais claros e acessíveis que respeitam o design system existente (tema escuro + acentos amarelos) e usam exclusivamente ícones já presentes no projeto via `lucide-react`.

---

## Problema

### Estado atual
- Cards exibem: título, data, localização, descrição, botões de ação
- Sem indicação do estágio do evento
- Usuário pode clicar em "INSCREVER-SE" e só então descobrir que as inscrições estão fechadas
- Sem sinal de urgência para eventos em período final

### Impacto no usuário
1. **Confusão**: "Esse evento ainda está aberto?"
2. **Esforço desperdiçado**: Cliques em eventos já encerrados
3. **Oportunidade perdida**: Nenhum sinal de urgência para eventos com prazo próximo

---

## Solução: Três estados de ciclo de vida

### Definição dos estados

| Estado | Condição | Intensidade do sinal |
|--------|----------|----------------------|
| **ATIVO** | Inscrições abertas, evento futuro | Neutro (card padrão) |
| **PERÍODO FINAL** | Últimas 72h de inscrição ou evento em menos de 48h | Elevado (urgência) |
| **ENCERRADO** | Inscrições fechadas ou evento já ocorreu | Desabilitado (dessaturado) |

---

## Especificação visual

### Contexto do design system
- **Tema:** Cards escuros (fundo `#0a0a0a` / `#111827`)
- **Acento primário:** Amarelo (`#FFD700` / `#FCD34D`)
- **Texto:** Branco e cinza claro sobre fundo escuro
- **Biblioteca de ícones:** `lucide-react` (já instalada, `^1.17.0`)

---

### Sinal 1 — Borda superior colorida

**Propósito:** Reconhecimento imediato de status na varredura visual horizontal

| Estado | Borda | Cor |
|--------|-------|-----|
| **ATIVO** | 2px sólida no topo | `#FCD34D` (amarelo do sistema) |
| **PERÍODO FINAL** | 3px sólida no topo | `#F59E0B` (âmbar — escala de alerta) |
| **ENCERRADO** | 2px sólida no topo | `#374151` (cinza neutro) |

Estado PERÍODO FINAL não usa animação por padrão. Se animação for desejada, implementar apenas com suporte a `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: no-preference) {
  .event-card--closing .card-border {
    animation: border-pulse 2.5s ease-in-out infinite;
  }
}
@keyframes border-pulse {
  0%, 100% { border-top-color: #F59E0B; }
  50%       { border-top-color: #FBBF24; }
}
```

---

### Sinal 2 — Badge de status

**Propósito:** Rótulo textual explícito para usuários que não percebem a borda

**Posição:** Canto superior direito do card

| Estado | Ícone (lucide-react) | Texto | Estilo |
|--------|----------------------|-------|--------|
| **ATIVO** | — | — | Sem badge |
| **PERÍODO FINAL** | `Clock` | "Últimas 24h" ou "Últimos 3 dias" | Pill âmbar |
| **ENCERRADO** | `Lock` | "Encerrado" | Pill cinza |

**Ícones já em uso no projeto:**
- `Clock` — importado em `src/app/admin/page.tsx`
- `Lock` — importado em `src/app/checkout/` pages

**Estilo do badge:**

```
PERÍODO FINAL:  bg-amber-600/20  border border-amber-500  text-amber-300
ENCERRADO:      bg-gray-800      border border-gray-600    text-gray-400
```

---

### Sinal 3 — Estado do botão CTA

**Propósito:** Evitar cliques em vão e reforçar o estado do evento diretamente na ação principal

| Estado | Botão "INSCREVER-SE" |
|--------|----------------------|
| **ATIVO** | Amarelo, normal |
| **PERÍODO FINAL** | Amarelo, normal — sem mudança visual para não confundir com alerta |
| **ENCERRADO** | Cinza, `disabled`, `cursor-not-allowed`, texto "Inscrições encerradas" |

O botão **ENCERRADO** usa `<button disabled>` semântico (não `pointer-events: none`), garantindo que leitores de tela anunciem o estado corretamente.

---

### Sinal 4 — Texto auxiliar

**Propósito:** Comunicar o estado textualmente para acessibilidade e clareza

| Estado | Ícone | Texto |
|--------|-------|-------|
| **ATIVO** | — | — |
| **PERÍODO FINAL** | `AlertTriangle` | "Inscrições encerram em X dias" |
| **ENCERRADO** | `Lock` | "Inscrições encerradas em {data}" |

**Ícones já em uso no projeto:**
- `AlertTriangle` — importado em `src/app/admin/page.tsx`

**Tipografia:** `text-xs`, `font-medium`, cor alinhada ao badge do estado

---

### Sinal 5 — Opacidade e dessaturação do card (estado ENCERRADO)

**Propósito:** Sinal subconsciente de que o evento pertence ao passado

| Estado | CSS |
|--------|-----|
| **ATIVO** | `opacity-100`, sem filtro |
| **PERÍODO FINAL** | `opacity-100`, sem filtro |
| **ENCERRADO** | `opacity-70 grayscale-[30%]` |

O evento encerrado permanece legível mas visualmente "apagado". Não é invisível.

---

## Wireframes — Antes e Depois

### ANTES (estado atual)

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Sertão Hybrid Run                                 │  │
│  │ 29/08/2026  •  Estação das Artes                  │  │
│  │                                                   │  │
│  │ Sertão Hybrid Run é onde a corrida encontra...    │  │
│  │                                                   │  │
│  │  [Ver Evento]   [INSCREVER-SE]                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Copa Intergames Bull                              │  │
│  │ 13/06/2026  •  Centro Físico Bull                 │  │
│  │                                                   │  │
│  │ Campeonato em celebração de 01 ano do Centro...   │  │
│  │                                                   │  │
│  │  [Ver Evento]   [INSCREVER-SE]                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
Problema: todos os cards parecem idênticos independente do status.
```

### DEPOIS (com sinais de ciclo de vida)

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ borda amarela 2px (ATIVO) │  │
│  │ Sertão Hybrid Run                                 │  │
│  │ 29/08/2026  •  Estação das Artes                  │  │
│  │                                                   │  │
│  │ Sertão Hybrid Run é onde a corrida encontra...    │  │
│  │                                                   │  │
│  │  [Ver Evento]   [INSCREVER-SE]                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ borda âmbar 3px (FINAL)  │  │
│  │ Copa Intergames Bull          [Clock] Últimas 24h │  │
│  │ 13/06/2026  •  Centro Físico Bull                 │  │
│  │                                                   │  │
│  │ Campeonato em celebração de 01 ano do Centro...   │  │
│  │                                                   │  │
│  │ [AlertTriangle] Inscrições encerram em 24h        │  │
│  │                                                   │  │
│  │  [Ver Evento]   [INSCREVER-SE]                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ borda cinza 2px  (OPACITY 70%)
│  │ Festival Nordestino              [Lock] Encerrado │  │
│  │ 10/06/2026  •  Parque da Estação                  │  │
│  │                                                   │  │
│  │ [Lock] Inscrições encerradas em 10 de junho       │  │
│  │                                                   │  │
│  │  [Ver Evento]   [Inscrições encerradas — disabled]│  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Matriz de estados — EventCard

| Propriedade | ATIVO | PERÍODO FINAL | ENCERRADO |
|-------------|-------|---------------|-----------|
| Borda topo | 2px `#FCD34D` | 3px `#F59E0B` | 2px `#374151` |
| Badge | — | `Clock` + "Últimas Xh/dias" | `Lock` + "Encerrado" |
| Cor do badge | — | `amber-600/20` | `gray-800` |
| Opacidade do card | 100% | 100% | 70% |
| Filtro CSS | — | — | `grayscale(30%)` |
| Texto auxiliar | — | `AlertTriangle` + prazo | `Lock` + data de encerramento |
| Botão CTA | Amarelo, ativo | Amarelo, ativo | Cinza, `disabled` |
| Cursor | `pointer` | `pointer` | `not-allowed` |

---

## Ícones utilizados

Todos os ícones abaixo já estão importados de `lucide-react` em algum arquivo do projeto:

| Ícone | Estado | Uso | Arquivo de referência |
|-------|--------|-----|------------------------|
| `Clock` | PERÍODO FINAL | Badge e texto auxiliar | `src/app/admin/page.tsx` |
| `AlertTriangle` | PERÍODO FINAL | Texto auxiliar de urgência | `src/app/admin/page.tsx` |
| `Lock` | ENCERRADO | Badge e texto auxiliar | `src/app/(checkout)/` |

Nenhum ícone novo precisa ser instalado ou importado além dos já existentes.

---

## Implementação — Arquivos a modificar

### 1. Componente de card de evento

Localizar o componente que renderiza os cards de eventos (ex: [src/components/EventCard.tsx](src/components/EventCard.tsx) ou equivalente) e adicionar:

- Lógica de cálculo de estado com base em `registration_deadline` e `event_date`
- Renderização condicional da borda, badge, texto auxiliar e estado do botão

### 2. Utilitário de estado (novo arquivo)

Criar `src/lib/eventStatus.ts`:

```
getEventStatus(registrationDeadline: Date, eventDate: Date): 'active' | 'closing' | 'finished'
```

Thresholds configuráveis:
- `CLOSING_THRESHOLD_HOURS = 72` — entra em "período final" 72h antes do prazo
- Evento com data passada → sempre `'finished'`

### 3. Dados necessários da API/banco

O objeto `Event` deve expor:
- `registration_deadline` (timestamp ISO) — quando as inscrições fecham
- `event_date` (timestamp ISO) — data do evento

---

## Acessibilidade

| Requisito | Solução |
|-----------|---------|
| Não depender apenas de cor | Badge tem ícone + texto; botão tem label descritivo |
| Botão desabilitado semântico | `<button disabled>` com aria-label "Inscrições encerradas" |
| Animação opcional | `prefers-reduced-motion` desativa pulse |
| Leitores de tela | Badge tem `aria-label` descritivo |
| Contraste | `#F59E0B` sobre `#111827` = 8.2:1 (WCAG AAA) |

---

## Perguntas para aprovação

1. **Threshold de tempo:** 72h antes do prazo é o ponto certo para acionar "período final", ou prefere outro valor?
2. **Badge "Encerrado":** Mostrar data exata de encerramento no badge ou apenas no texto auxiliar?
3. **Animação de borda:** Incluir pulse para PERÍODO FINAL (apenas para usuários sem `prefers-reduced-motion`) ou manter borda estática?
4. **Exibir eventos encerrados:** Eventos finalizados devem aparecer na listagem principal ou apenas em uma seção separada/filtrada?

---

**Versão:** 1.1  
**Atualizado em:** 2026-06-21  
**Status:** Aguardando aprovação
