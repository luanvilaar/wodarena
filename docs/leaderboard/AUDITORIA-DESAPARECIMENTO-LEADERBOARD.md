# 🔍 Auditoria: Desaparecimento de Dados do Leaderboard

**Data da Auditoria:** 2026-06-10  
**Problema Relatado:** Dados do leaderboard desaparecem em alguns momentos e depois retornam  
**Severidade:** 🔴 CRÍTICA  
**Status:** Investigação Inicial Completa  

---

## 📋 Resumo Executivo

Os dados do leaderboard estão desaparecendo intermitentemente porque **o filtro de exibição depende criticamente do `payment_status` das inscrições (registrations)**, que está sendo alterado dinamicamente durante sincronizações com Mercado Pago.

### Cenário do Problema

```
[Estado Normal]
Registration: payment_status = 'payment_approved' ✅
→ Atleta aparece no leaderboard

[Estado Intermitente - Causa Encontrada]
Sync do Mercado Pago muda payment_status para outro valor (pending/in_review/failed)
→ Atleta DESAPARECE do leaderboard

[Após Resolução no Mercado Pago]
payment_status volta para 'payment_approved'
→ Atleta REAPARECE no leaderboard
```

---

## 🎯 Raiz do Problema Identificada

### 1. **Filtro do Leaderboard é Restritivo (AppContext.tsx:1333-1339)**

```typescript
// PROBLEMA: Filtra APENAS atletas com pagamento aprovado
const approvedAthleteIds = new Set(
  registrations
    .filter(r => r.eventId === eventId && r.paymentStatus === 'payment_approved')
    .map(r => r.athleteId)
    .filter(Boolean)
);
const divisionAthletes = athletes.filter(a => a.divisionId === divisionId && approvedAthleteIds.has(a.id));
```

**Impacto:** Se `paymentStatus !== 'payment_approved'`, o atleta é COMPLETAMENTE removido do leaderboard.

---

### 2. **Sincronização Dinâmica de Pagamento (checkout/status/route.ts:140-151)**

```typescript
// Este endpoint é chamado por sincronização do Mercado Pago
await supabaseAdmin
  .from('registrations')
  .update({
    payment_status: toRegistrationPaymentStatus(paymentData.status),
    payment_method: paymentData.payment_method_id || null,
    payment_id: String(paymentData.id),
    payment_status_detail: paymentData.status_detail || null,
    payment_error_message: paymentData.status === 'rejected' ? 'Pagamento não processado.' : null,
    updated_at: new Date().toISOString()
  })
  .eq('id', registrationId)
  .eq('event_id', eventId);
```

**Mapeamento de Status:**
```typescript
const toRegistrationPaymentStatus = (status?: string) => {
  if (status === 'approved') return 'payment_approved';
  if (status === 'in_process') return 'payment_in_review';  // ⚠️ Causa desaparecimento
  if (status === 'cancelled') return 'payment_cancelled';   // ⚠️ Causa desaparecimento
  if (status === 'rejected') return 'payment_failed';        // ⚠️ Causa desaparecimento
  return 'payment_pending';                                   // ⚠️ Causa desaparecimento
};
```

**Trigger Provável:** Quando Mercado Pago sincroniza com a API, qualquer mudança de status (mesmo temporária) remove o atleta do leaderboard.

---

### 3. **Bootstrap API Carrega Registrations Condicionalmente**

```typescript
// src/app/api/app/bootstrap/route.ts:46
session 
  ? supabaseAdmin.from('registrations').select('*') 
  : Promise.resolve({ data: [] })
```

- Se não houver sessão de usuário, retorna registrations vazio → leaderboard vazio
- Mas isso é esperado para usuários públicos

---

## 📊 Cenários que Causam o Desaparecimento

### Cenário 1: Polling/Reconciliação do Mercado Pago ⚠️ **MAIS PROVÁVEL**

1. Usuário faz pagamento PIX ou cartão
2. Mercado Pago marca como `in_process` inicialmente
3. **API `/checkout/status` atualiza para `payment_in_review`**
4. ❌ Atleta desaparece do leaderboard
5. Após 5-10 minutos, Mercado Pago confirma como `approved`
6. **API atualiza novamente para `payment_approved`**
7. ✅ Atleta reaparece no leaderboard

**Frequência:** Acontece com cada pagamento novo ou sincronização automática

### Cenário 2: Erro de Integração com Mercado Pago

Se o Mercado Pago retornar um status inesperado ou houver timeout:
1. API recebe `null` ou status inválido
2. Mapeamento retorna `payment_pending`
3. Atleta desaparece
4. Fica fora até que alguém manualmente corrija ou sincronize novamente

### Cenário 3: Concorrência de Requisições

Se múltiplas requisições `/checkout/status` forem feitas simultaneamente:
1. Uma lê status `approved`
2. Outra lê status `in_process` (mais antiga do Mercado Pago)
3. A mais recente (in_process) sobrescreve a anterior (approved)
4. Dados desaparecem

---

## 🔧 Análise do Código

### Arquivo: `src/context/AppContext.tsx`

**Linha 1328-1389:** Método `getLeaderboard()`

```typescript
const getLeaderboard = (eventId: string, divisionId: string): AthleteOverall[] => {
  const event = events.find(e => e.id === eventId);
  if (!event) return [];

  // ❌ FILTRO RESTRITIVO
  const approvedAthleteIds = new Set(
    registrations
      .filter(r => r.eventId === eventId && r.paymentStatus === 'payment_approved')
      .map(r => r.athleteId)
      .filter(Boolean)
  );
  
  // ❌ Se não tiver no Set, some completely
  const divisionAthletes = athletes.filter(
    a => a.divisionId === divisionId && approvedAthleteIds.has(a.id)
  );
  // ... resto da lógica
}
```

**Problema:** Não há lógica para mostrar atletas com pagamento pendente/em revisão com um estado visual diferente.

### Arquivo: `src/app/api/checkout/status/route.ts`

**Linha 140-151:** Atualização de status

```typescript
// Atualiza sem verificar se foi realmente aprovado
await supabaseAdmin
  .from('registrations')
  .update({
    payment_status: toRegistrationPaymentStatus(paymentData.status)
    // ... sem versioning ou check de conflito
  })
  .eq('id', registrationId)
  .eq('event_id', eventId);
```

**Problema:** Sobrescreve qualquer status anterior sem versioning ou verificação de se é uma atualização "para trás" no tempo.

---

## 📍 Locais do Código Afetados

| Arquivo | Linhas | Problema | Severidade |
|---------|--------|----------|-----------|
| `src/context/AppContext.tsx` | 1333-1339 | Filtro `paymentStatus === 'payment_approved'` | 🔴 CRÍTICA |
| `src/app/api/checkout/status/route.ts` | 140-151 | Atualização dinâmica sem validação | 🔴 CRÍTICA |
| `src/app/api/checkout/status/route.ts` | 12-18 | Mapeamento de status do Mercado Pago | 🔴 CRÍTICA |
| `src/components/Leaderboard.tsx` | 93-96 | Dependência em `getLeaderboard()` | 🟡 MÉDIA |

---

## ✅ Soluções Propostas

### **Solução 1: Mostrar Atletas com Qualquer Status (RECOMENDADA)**

Modificar o filtro para incluir atletas com qualquer `paymentStatus` relacionado a pagamento válido:

```typescript
// ANTES
const approvedAthleteIds = new Set(
  registrations
    .filter(r => r.eventId === eventId && r.paymentStatus === 'payment_approved')
    .map(r => r.athleteId)
    .filter(Boolean)
);

// DEPOIS
const approvedAthleteIds = new Set(
  registrations
    .filter(r => r.eventId === eventId && [
      'payment_approved',
      'payment_in_review',  // Incluir pagamentos em revisão
      'payment_pending'     // Incluir pagamentos pendentes
    ].includes(r.paymentStatus))
    .map(r => r.athleteId)
    .filter(Boolean)
);
```

**Vantagem:** Simples, não quebra fluxo de usuário  
**Desvantagem:** Pode incluir usuários que ainda não pagaram  

---

### **Solução 2: Adicionar Cache de Status + Versioning (IDEAL PARA PRODUÇÃO)**

Implementar um cache de última atualização bem-sucedida:

```typescript
// Na tabela registrations, adicionar:
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS last_approved_at TIMESTAMPTZ;

// Antes de atualizar, verificar:
const { data: currentReg } = await supabaseAdmin
  .from('registrations')
  .select('payment_status, last_approved_at')
  .eq('id', registrationId)
  .single();

// Se novo status é MENOS avançado que o anterior, ignorar
if (isStatusLessAdvanced(newStatus, currentReg.payment_status)) {
  return; // Não sobrescrever
}

// Se aprovado, guardar timestamp
if (newStatus === 'payment_approved') {
  last_approved_at = NOW();
}
```

**Vantagem:** Previne regressão de status  
**Desvantagem:** Mais complexo, requer migration  

---

### **Solução 3: Adicionar Indicador Visual de Status**

Mostrar no leaderboard qual o status de pagamento de cada atleta:

```typescript
// No MobileLeaderboardCard ou Tabela, adicionar:
<div className={`status-badge status-${payment_status}`}>
  {payment_status === 'payment_approved' && '✅ Pago'}
  {payment_status === 'payment_in_review' && '⏳ Em Revisão'}
  {payment_status === 'payment_pending' && '⏳ Pendente'}
  {payment_status === 'payment_failed' && '❌ Falhou'}
</div>
```

**Vantagem:** Transparência total para usuários  
**Desvantagem:** Requer mudança visual na UI  

---

## 🧪 Como Reproduzir o Problema

1. **Setup:**
   - Evento com divisão criada
   - Atleta registrado com pagamento
   - Abrir leaderboard e confirmar que atleta aparece

2. **Trigger:**
   - Abrir DevTools → Network
   - Fazer uma requisição GET para `/api/checkout/status?payment_id=XXXX&event_id=YYYY`
   - Observar que `payment_status` é alterado no Supabase

3. **Resultado:**
   - Leaderboard atualiza (hard refresh necessário)
   - Atleta desaparece se status não for `payment_approved`

---

## 📋 Checklist de Correção

### Fase 1: Quick Fix (Hoje - 30 minutos) 🟢

- [ ] Modificar `getLeaderboard()` para incluir `payment_in_review` e `payment_pending`
- [ ] Testar com múltiplas condições de pagamento
- [ ] Fazer commit

### Fase 2: Validação (Próximas 24h) 🟡

- [ ] Monitorar logs de produção para padrão de mudanças de status
- [ ] Verificar com Mercado Pago qual é o comportamento esperado de status
- [ ] Decidir se implementar Solução 2 (versioning)

### Fase 3: Long-term (Próxima semana) 🔴

- [ ] Implementar Solução 2 (cache + versioning) se necessário
- [ ] Adicionar testes de leaderboard com múltiplos status de pagamento
- [ ] Adicionar logging detalhado de mudanças de status

---

## 📊 Impacto

| Aspecto | Status | Impacto |
|---------|--------|--------|
| **Dados Perdidos** | Não | Dados continuam no banco, só ficam ocultos |
| **Experiência do Usuário** | Crítico | Atletas desaparecem e reaparecem do nada |
| **Confiança da Plataforma** | Crítico | Usuários questionam integridade dos dados |
| **Facilidade de Fix** | Simples | Uma mudança de 3 linhas resolve |

---

## 🚀 Próximos Passos Recomendados

1. **Imediato:** Implementar Solução 1 (incluir múltiplos status no filtro)
2. **Investigação:** Verificar logs de Mercado Pago para entender padrão de mudanças
3. **Implementação:** Decidir se necesário Solução 2 (versioning)
4. **Monitoramento:** Adicionar alertas para mudanças frequentes de status

---

**Análise Completa:** ✅ Pronta para implementação  
**Próxima Fase:** Plano de Correção

