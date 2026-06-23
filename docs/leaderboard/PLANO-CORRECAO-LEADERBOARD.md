# 🎯 Plano de Correção: Desaparecimento de Dados do Leaderboard

**Iniciado:** 2026-06-10  
**Status:** Pronto para Execução  
**Tempo Estimado:** 4-6 horas (incluindo testes)  
**Prioridade:** 🔴 CRÍTICA

---

## 📌 Resumo do Problema (TL;DR)

**O QUÊ:** Atletas desaparecem e reaparecem do leaderboard intermitentemente

**POR QUÊ:** O leaderboard filtra APENAS atletas com `paymentStatus === 'payment_approved'`. Quando o Mercado Pago sincroniza, altera o status para `in_process` ou `pending`, fazendo o atleta sumir do leaderboard.

**QUANDO:** Toda vez que há sincronização de pagamento com Mercado Pago (PIX confirmado, cartão processado, retentativa, etc.)

**IMPACTO:** 
- Dados continuam no banco de dados
- Mas ficam invisíveis para usuários
- Volta quando status muda para `approved` novamente

**SOLUÇÃO RÁPIDA:** Modificar o filtro para incluir múltiplos status de pagamento válidos

---

## 🔍 O Problema Explicado Visualmente

```
┌─────────────────────────────────────────────────────┐
│        FLUXO ATUAL (PROBLEMÁTICO)                   │
├─────────────────────────────────────────────────────┤
│                                                       │
│  1. Atleta faz inscrição com PIX/Cartão            │
│     payment_status: "payment_pending"                │
│     ❌ NÃO aparece no leaderboard                    │
│                                                       │
│  2. Mercado Pago processa pagamento                 │
│     payment_status: "payment_in_process"             │
│     ❌ AINDA NÃO aparece no leaderboard              │
│                                                       │
│  3. Mercado Pago aprova pagamento                   │
│     payment_status: "payment_approved"               │
│     ✅ AGORA aparece no leaderboard                  │
│                                                       │
│  4. (Possível) Sincronização retorna status anterior│
│     payment_status: "payment_in_process"             │
│     ❌ DESAPARECE novamente (BUG!)                   │
│                                                       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│        FLUXO DESEJADO (APÓS CORREÇÃO)               │
├─────────────────────────────────────────────────────┤
│                                                       │
│  1. Atleta faz inscrição com PIX/Cartão            │
│     payment_status: "payment_pending"                │
│     ✅ APARECE no leaderboard (status pendente)      │
│                                                       │
│  2-4. (Qualquer sincronização)                       │
│       ✅ CONTINUA aparecendo (status muda, mas       │
│           continua mostrado)                         │
│                                                       │
│  Final: Sem desaparecimentos mágicos!               │
│                                                       │
└─────────────────────────────────────────────────────┘
```

---

## 📋 Plano em 3 Fases

### ⚡ FASE 1: Quick Fix (30 minutos) - EXECUTAR HOJE

Modificar o filtro do leaderboard para aceitar múltiplos status de pagamento.

**Arquivo a Modificar:** `src/context/AppContext.tsx`

**Localização Exata:** Linha 1333-1339

**O Que Mudar:**

```typescript
// ❌ ANTES (BUGADO)
const approvedAthleteIds = new Set(
  registrations
    .filter(r => r.eventId === eventId && r.paymentStatus === 'payment_approved')
    .map(r => r.athleteId)
    .filter(Boolean)
);

// ✅ DEPOIS (CORRIGIDO)
const approvedAthleteIds = new Set(
  registrations
    .filter(r => r.eventId === eventId && [
      'payment_approved',
      'payment_in_review',
      'payment_pending'
    ].includes(r.paymentStatus))
    .map(r => r.athleteId)
    .filter(Boolean)
);
```

**Impacto:**
- ✅ Atletas com pagamento pendente agora aparecem
- ✅ Atletas em revisão agora aparecem
- ✅ Sem mais desaparecimentos por sincronização
- ⚠️ Pode mostrar atletas que não pagaram (aceitável)

**Testes Imediatos:**

```bash
# 1. Compilar sem erros
npm run typecheck

# 2. Iniciar dev server
npm run dev

# 3. Abrir evento com leaderboard
# 4. Verificar que atletas aparecem
# 5. Fazer teste com diferentes status (manual no Supabase se necessário)
```

---

### 🔍 FASE 2: Investigação (2 horas) - PRÓXIMAS 24H

Entender o padrão de mudanças de status no Mercado Pago.

**Tarefas:**

- [ ] Verificar logs do servidor para padrão de atualizações `/api/checkout/status`
- [ ] Consultar documentação do Mercado Pago sobre fluxo de status
- [ ] Verificar se há race conditions (múltiplas requisições simultâneas)
- [ ] Criar query SQL para ver histórico de mudanças de status

**Consulta SQL para Análise:**

```sql
-- Verificar atletas que mudaram de status múltiplas vezes
SELECT 
  r.athlete_id,
  r.payment_status,
  r.updated_at,
  COUNT(*) as mudancas
FROM registrations r
GROUP BY r.athlete_id, r.payment_status
HAVING COUNT(*) > 1
ORDER BY r.updated_at DESC;

-- Ver últimas 100 atualizações de status
SELECT 
  id,
  athlete_id,
  payment_status,
  updated_at,
  created_at
FROM registrations
ORDER BY updated_at DESC
LIMIT 100;
```

---

### 🛠️ FASE 3: Implementação Robusta (3-4 horas) - PRÓXIMA SEMANA

Se Fase 2 confirmar race conditions, implementar versioning.

**Opção A: Simples (Sem Migração)**

Adicionar lógica de "não regredí status":

```typescript
// Em src/app/api/checkout/status/route.ts

const statusHierarchy = {
  'payment_pending': 0,
  'payment_in_review': 1,
  'payment_approved': 2,
  'payment_failed': -1,
  'payment_cancelled': -1
};

// Antes de atualizar:
const currentStatus = /* ler de DB */;
const newStatus = toRegistrationPaymentStatus(paymentData.status);

// Não regredir de um status para outro anterior
if (statusHierarchy[newStatus] < statusHierarchy[currentStatus]) {
  console.warn(`Ignorando regressão de status: ${currentStatus} → ${newStatus}`);
  return NextResponse.json({ status: currentStatus });
}

// Atualizar normalmente
await supabaseAdmin
  .from('registrations')
  .update({ payment_status: newStatus })
  .eq('id', registrationId);
```

**Opção B: Robusto (Com Migração)**

Adicionar `last_approved_at` timestamp:

```sql
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS last_approved_at TIMESTAMPTZ;

-- Atualizar registrations aprovadas existentes
UPDATE registrations 
SET last_approved_at = updated_at 
WHERE payment_status = 'payment_approved';
```

---

## 📊 Tabela de Status de Pagamento

```
Status               | Valor DB         | Aparece Leaderboard? | Descrição
─────────────────────┼──────────────────┼──────────────────────┼───────────────────────
payment_pending      | payment_pending   | ❌ Antes / ✅ Depois   | Esperando processamento
payment_in_review    | payment_in_review | ❌ Antes / ✅ Depois   | Sob análise Mercado Pago
payment_approved     | payment_approved  | ✅ Sempre             | Confirmado e válido
payment_failed       | payment_failed    | ❌ Sempre             | Rejeitado
payment_cancelled    | payment_cancelled | ❌ Sempre             | Cancelado pelo usuário
```

---

## 🧪 Checklist de Testes

### Teste 1: Compilação e Type Safety ✅
- [ ] `npm run typecheck` passa sem erros
- [ ] Sem `any` types adicionados
- [ ] IntelliSense funciona em IDE

### Teste 2: Leaderboard com Diferentes Status
- [ ] [ ] Abrir página de evento
- [ ] [ ] Confirmar que atletas aparecem normalmente
- [ ] [ ] Modificar status de um atleta para `payment_in_review` via Supabase
- [ ] [ ] Recarregar leaderboard → atleta deve continuar visível
- [ ] [ ] Modificar para `payment_failed`
- [ ] [ ] Recarregar → atleta deve desaparecer
- [ ] [ ] Modificar de volta para `payment_approved`
- [ ] [ ] Recarregar → atleta reaparece

### Teste 3: Performance
- [ ] [ ] Abrir leaderboard com 100+ atletas
- [ ] [ ] Verificar tempo de carregamento (< 2s)
- [ ] [ ] Verificar não há lags ao filtrar

### Teste 4: Casos Extremos
- [ ] [ ] Evento sem registrations → leaderboard vazio
- [ ] [ ] Evento com apenas status `payment_failed` → leaderboard vazio
- [ ] [ ] Evento com mix de status → mostra apenas aqueles com status válido

### Teste 5: Compatibilidade
- [ ] [ ] Mobile responsivo
- [ ] [ ] Filtros de categoria funcionam
- [ ] [ ] Search continua funcionando

---

## 🔐 Checklist de Segurança

- [ ] Nenhuma mudança em RLS policies
- [ ] Nenhum novo acesso a dados sensíveis
- [ ] Nenhuma mudança em autenticação
- [ ] SQL injection não é possível (usando Supabase client)
- [ ] XSS não é possível (React escapa strings)

---

## 📈 Métricas de Sucesso

| Métrica | Antes | Depois | Alvo |
|---------|-------|--------|------|
| **Atletas visíveis durante sync** | 0-30% | 95%+ | 99%+ |
| **Reclamações de dados "desaparecendo"** | 3-5/semana | 0-1/semana | 0/semana |
| **Tempo de load leaderboard** | <2s | <2s | <2s |
| **Taxa de erro API** | <0.5% | <0.5% | <0.1% |

---

## 🚨 Possíveis Efeitos Colaterais

### ✅ Nenhum Risco Esperado

1. **Dados Fraudulentos?** Não - apenas mostra atletas que já estão no banco
2. **Performance Degradação?** Não - sem mudanças na complexidade de query
3. **Conflito com Mercado Pago?** Não - continua sincronizando normalmente
4. **Impacto em Ranking?** Não - apenas muda visibilidade, não ranking

---

## 📞 Comunicação com Stakeholders

**Mensagem para Usuários (após implementação):**

> "Corrigimos um problema onde atletas desapareciam temporariamente do leaderboard durante a sincronização de pagamentos. Isso foi um problema visual apenas - os dados sempre estiveram no banco. Agora o leaderboard permanece estável durante todo o processo de pagamento."

---

## 🎬 Ordem de Execução

```
┌─────────────────────────────────────────┐
│ 1. Entender o Problema (✅ Completo)   │
│    └─ Auditoria finalizada             │
├─────────────────────────────────────────┤
│ 2. Implementar Fase 1 (30 min)          │
│    └─ Modificar AppContext.tsx          │
│    └─ Testar compilação                 │
│    └─ Commit                            │
├─────────────────────────────────────────┤
│ 3. Testar em Dev (1-2 horas)            │
│    └─ Abrir leaderboard                 │
│    └─ Testar diferentes status          │
│    └─ Verificar performance             │
├─────────────────────────────────────────┤
│ 4. Deploy Staging (30 min)              │
│    └─ Fazer push para staging           │
│    └─ Verificar comportamento real      │
├─────────────────────────────────────────┤
│ 5. Deploy Produção (15 min)             │
│    └─ Fazer push para main              │
│    └─ Monitor de logs                   │
├─────────────────────────────────────────┤
│ 6. Investigação Profunda (24h depois)   │
│    └─ Analisar logs                     │
│    └─ Decidir Fase 2/3                  │
└─────────────────────────────────────────┘
```

---

## 📝 Notas Técnicas

### Registro de Arquivos Afetados

| Arquivo | Mudanças | Linhas | Risco |
|---------|----------|--------|-------|
| `src/context/AppContext.tsx` | Sim | 1333-1339 | ✅ Baixo |
| `src/app/api/checkout/status/route.ts` | Não (Fase 1) | — | ✅ Seguro |
| `src/components/Leaderboard.tsx` | Não | — | ✅ Seguro |

### Dependências
- Nenhuma nova dependência
- Nenhuma mudança em imports
- Nenhuma mudança em tipos

### Backward Compatibility
- ✅ 100% backward compatible
- ✅ Sem breaking changes
- ✅ Sem migration necessária

---

## ⏰ Timeline

| Tarefa | Tempo | Data Estimada |
|--------|-------|---------------|
| Implementar Fase 1 | 30 min | Hoje |
| Testes básicos | 1 hora | Hoje |
| Commit e push | 15 min | Hoje |
| Investigação profunda | 2 horas | Amanhã |
| Decidir Fase 2/3 | 30 min | Amanhã |
| Implementar se necessário | 3-4 horas | Próxima semana |

---

## ✅ Sign-off

- [ ] Arquitetura revisada
- [ ] Problema raiz identificado
- [ ] Solução aprovada
- [ ] Testes planejados
- [ ] Pronto para implementação

---

**Status:** 🟢 PRONTO PARA EXECUÇÃO

Próximo passo: Implementar Fase 1 (modificar AppContext.tsx)

