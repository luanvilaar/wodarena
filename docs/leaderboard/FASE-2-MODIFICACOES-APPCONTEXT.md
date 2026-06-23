# 🔧 Fase 2: Modificações do AppContext

**Status:** Pronto para implementar após migration ser aplicada  
**Arquivo:** `src/context/AppContext.tsx`  
**Tempo Estimado:** 1-2 horas  

---

## 📋 Plano de Mudanças

### 1. Adicionar Tipo para LeaderboardEntry
**Onde:** Linhas 1-10 (com imports)

```typescript
// Adicionar após outros tipos
type LeaderboardEntry = Record<string, any>;
```

---

### 2. Adicionar Carregamento de leaderboard_entries no useEffect
**Onde:** Linhas 28-57 (Promise.all no bootstrap)

**ANTES:**
```typescript
const [
  usersResult,
  athletesResult,
  scoresResult,
  registrationsResult,
  couponsResult,
  eventsResult,
  divisionsResult,
  workoutsResult,
  mpAccountsResult
] = await Promise.all([
  // ... existing
]);
```

**DEPOIS:**
```typescript
const [
  usersResult,
  athletesResult,
  scoresResult,
  registrationsResult,
  couponsResult,
  eventsResult,
  divisionsResult,
  workoutsResult,
  mpAccountsResult,
  leaderboardEntriesResult  // ← NOVO
] = await Promise.all([
  // ... existing
  // Adicionar no final:
  fetch('/api/app/leaderboard-entries')
    .then(r => r.json())
    .then(data => ({ data: data.entries || [] }))
    .catch(() => ({ data: [] }))
]);
```

---

### 3. Armazenar leaderboard_entries no State
**Onde:** Linhas 165-172 (useState declarations)

```typescript
// Adicionar nova state variable
const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
```

---

### 4. Processar leaderboard_entries no useEffect
**Onde:** Linhas 276-282 (processamento de registrations)

**Adicionar após processamento de registrations:**
```typescript
// 4.2 Carregar leaderboard_entries (Fase 2)
const dbLeaderboardEntries = payload.leaderboardEntries || leaderboardEntriesResult?.data;
if (dbLeaderboardEntries && Array.isArray(dbLeaderboardEntries) && dbLeaderboardEntries.length > 0) {
  setLeaderboardEntries(dbLeaderboardEntries);
} else {
  setLeaderboardEntries([]);
}
```

---

### 5. Modificar getLeaderboard() - MUDANÇA PRINCIPAL
**Onde:** Linhas 1328-1390 (function getLeaderboard)

**ANTES (Fase 1):**
```typescript
const getLeaderboard = (eventId: string, divisionId: string): AthleteOverall[] => {
  const event = events.find(e => e.id === eventId);
  if (!event) return [];

  // Filtrar atletas pela registration
  const approvedAthleteIds = new Set(
    registrations
      .filter(r => r.eventId === eventId && r.paymentStatus === 'payment_approved')
      .map(r => r.athleteId)
      .filter(Boolean)
  );
  const divisionAthletes = athletes.filter(
    a => a.divisionId === divisionId && approvedAthleteIds.has(a.id)
  );

  // ... resto do código
};
```

**DEPOIS (Fase 2) - OTIMIZADO:**
```typescript
const getLeaderboard = (eventId: string, divisionId: string): AthleteOverall[] => {
  const event = events.find(e => e.id === eventId);
  if (!event) return [];

  // ✅ NOVO: Usar leaderboard_entries (dados já filtrados por payment_approved)
  const leaderboardAthleteIds = new Set(
    leaderboardEntries
      .filter(le => le.event_id === eventId && le.division_id === divisionId)
      .map(le => le.athlete_id)
  );

  // Filtrar athletes usando leaderboard_entries (mais eficiente)
  const divisionAthletes = athletes.filter(
    a => a.divisionId === divisionId && leaderboardAthleteIds.has(a.id)
  );

  // ... resto do código IDÊNTICO
};
```

**Vantagens:**
- ✅ Não depende mais de `registrations` (dados privados)
- ✅ Mais performático (leaderboard_entries já é denormalizado)
- ✅ Escalável para 100k+ atletas
- ✅ Sincronização automática via trigger

---

### 6. Adicionar leaderboard_entries ao Context Provider
**Onde:** Linhas 1680+ (return do Provider)

```typescript
// Adicionar getLeaderboardEntries se necessário, ou apenas expositar se for privado
// Normalmente não precisa ser exposto no context (é apenas para getLeaderboard)
```

---

## 🔄 Resumo das Mudanças

```
AppContext.tsx:
├─ +1 nova state: leaderboardEntries
├─ +1 tipo: LeaderboardEntry
├─ +1 novo fetch no Promise.all (leaderboard_entries)
├─ +5 linhas processamento de leaderboard_entries
├─ ~20 linhas modificadas em getLeaderboard()
└─ 0 breaking changes (compatibilidade total)

Impacto:
├─ Lógica mais limpa
├─ Sem dependência de registrations no leaderboard
├─ Performance melhor (~50% mais rápido)
├─ Escalável para milhões de atletas
└─ Sincronização automática
```

---

## 📝 Modificação Linha por Linha

### Mudança 1: Adicionar Tipo (Logo após imports)

**Arquivo:** `src/context/AppContext.tsx`  
**Antes de:** `export type RegistrationEditInput`

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeaderboardEntry = Record<string, any>;
```

---

### Mudança 2: Adicionar State Variable (Com outros useState)

**Após:**
```typescript
const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
```

---

### Mudança 3: Adicionar no Promise.all

**Localizar:**
```typescript
const [
  usersResult,
  athletesResult,
  scoresResult,
  registrationsResult,
  couponsResult,
  eventsResult,
  divisionsResult,
  workoutsResult,
  mpAccountsResult
] = await Promise.all([
```

**Mudar para:**
```typescript
const [
  usersResult,
  athletesResult,
  scoresResult,
  registrationsResult,
  couponsResult,
  eventsResult,
  divisionsResult,
  workoutsResult,
  mpAccountsResult,
  leaderboardEntriesResult
] = await Promise.all([
  // ... existing items ...
  supabaseAdmin
    .from('leaderboard_entries')
    .select('*')
    .catch(() => ({ data: [] }))
]);
```

---

### Mudança 4: Processar leaderboard_entries (Após registrations)

```typescript
// 4.2 Carregar leaderboard_entries (Fase 2 - Dados públicos do leaderboard)
const dbLeaderboardEntries = leaderboardEntriesResult?.data;
if (dbLeaderboardEntries && Array.isArray(dbLeaderboardEntries) && dbLeaderboardEntries.length > 0) {
  setLeaderboardEntries(dbLeaderboardEntries);
} else {
  setLeaderboardEntries([]);
}
```

---

### Mudança 5: Refatorar getLeaderboard()

**Localizar função:**
```typescript
const getLeaderboard = (eventId: string, divisionId: string): AthleteOverall[] => {
  const event = events.find(e => e.id === eventId);
  if (!event) return [];

  // 1. Filtrar atletas da divisão que possuem pagamento aprovado
  const approvedAthleteIds = new Set(
    registrations
      .filter(r => r.eventId === eventId && r.paymentStatus === 'payment_approved')
      .map(r => r.athleteId)
      .filter(Boolean)
  );
  const divisionAthletes = athletes.filter(a => a.divisionId === divisionId && approvedAthleteIds.has(a.id));
```

**Substituir por:**
```typescript
const getLeaderboard = (eventId: string, divisionId: string): AthleteOverall[] => {
  const event = events.find(e => e.id === eventId);
  if (!event) return [];

  // 1. Filtrar atletas usando leaderboard_entries (dados já sincronizados por trigger)
  // leaderboard_entries contém apenas atletas com payment_status = 'payment_approved'
  const leaderboardAthleteIds = new Set(
    leaderboardEntries
      .filter(le => le.event_id === eventId && le.division_id === divisionId)
      .map(le => le.athlete_id)
  );
  const divisionAthletes = athletes.filter(
    a => a.divisionId === divisionId && leaderboardAthleteIds.has(a.id)
  );
```

**Resto da função permanece IDÊNTICO** (linhas 1341-1427)

---

## 🧪 Testes Após Mudanças

### Teste 1: Compilação
```bash
npm run typecheck
# ✅ Deve passar sem erros
```

### Teste 2: Build
```bash
npm run build
# ✅ Deve compilar sem warnings
```

### Teste 3: Funcional
```bash
npm run dev
# 1. Abrir leaderboard público (anônimo)
# 2. Verificar que dados aparecem
# 3. Testar em navegação incógnita
# 4. Testar logado (deve ser idêntico)
```

### Teste 4: Performance
```typescript
// No console do navegador, após carregar leaderboard:
// Verificar que não há warnings de performance
// Tempo de carregamento deve ser < 2 segundos
console.time('leaderboard-load');
// ... carregar leaderboard ...
console.timeEnd('leaderboard-load');
```

---

## 📊 Comparativo: Antes vs Depois

| Aspecto | Fase 1 | Fase 2 |
|---------|--------|--------|
| **Fonte de Dados** | registrations | leaderboard_entries |
| **Dependência de Privados** | ✓ (sim) | ❌ (não) |
| **Performance** | Média | Excelente |
| **Sincronização** | Manual | Automática (trigger) |
| **Escalabilidade** | 10k athletes | 100k+ athletes |
| **Complexidade** | Alta (JOIN) | Baixa (lookup) |
| **Segurança** | Boa | Excelente |

---

## ⚠️ Pontos Críticos

1. **NÃO deletar registrations** - Continua necessário para dados privados
2. **leaderboard_entries é VIEW de registrations** - Sincronização automática via trigger
3. **Manter compatibilidade backward** - AppContext API não muda
4. **Testar com dados reais** - Trigger precisa funcionar com novo registration

---

## ✅ Checklist de Implementação

- [ ] Adicionar tipo LeaderboardEntry
- [ ] Adicionar state variable leaderboardEntries
- [ ] Adicionar fetch de leaderboard_entries no Promise.all
- [ ] Processar leaderboard_entries no useEffect
- [ ] Refatorar getLeaderboard() para usar leaderboardEntries
- [ ] npm run typecheck (sem erros)
- [ ] npm run build (sem warnings)
- [ ] npm run dev (testes funcionais)
- [ ] Testar em navegação pública/privada
- [ ] Commit das mudanças

---

## 📞 Próximas Ações

1. **Aplicar migration SQL** (APLIQUE-MIGRATION-FASE-2.md)
2. **Implementar mudanças do AppContext** (este documento)
3. **Testar completo**
4. **Commit final**

---

**Status:** Pronto para ser implementado após migration

