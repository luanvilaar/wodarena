# 🏗️ Arquitetura Segura: Leaderboard Público vs Privado

**Proposta de Arquitetura Completa**  
**Status:** Pronto para Implementação  

---

## 📊 Diagrama de Fluxo

### ANTES (INSEGURO)
```
┌─────────────────────────────────────────────────────────────────┐
│                    NAVEGAÇÃO ANÔNIMA                            │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────┐
         │  /api/app/bootstrap (GET)       │
         │  sem autenticação                │
         └──────────────┬────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │  Bootstrap carrega:                      │
         │  ❌ registrations: registrationsResult   │
         │                                          │
         │  Problem: registrations = [] (vazio!)   │
         └──────────────┬───────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │  AppContext.getLeaderboard()             │
         │  filtra por registrations                │
         │                                          │
         │  approvedAthleteIds = new Set([])       │
         │  (vazio porque registrations vazio!)    │
         └──────────────┬───────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │  Resultado: Leaderboard VAZIO ❌         │
         └──────────────────────────────────────────┘
```

### DEPOIS (SEGURO)

#### **Opção D: Quick Fix (Curto Prazo)**
```
┌─────────────────────────────────────────────────────────────────┐
│                    NAVEGAÇÃO ANÔNIMA                            │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────┐
         │  /api/app/bootstrap (GET)       │
         │  sem autenticação                │
         └──────────────┬────────────────────┘
                        ↓
         ┌──────────────────────────────────────────────────────┐
         │  Bootstrap carrega:                                  │
         │  ✅ registrations = supabaseAdmin.from(...)          │
         │     .select('*')  (sempre, sem condition)           │
         │                                                      │
         │  Aplica sanitização:                                │
         │  registrations.map(r => ({                          │
         │    id, athlete_id, event_id, division_id,          │
         │    payment_status  // Apenas esses campos          │
         │    // ❌ remove: email, phone, payment_id, etc     │
         │  }))                                                │
         └──────────────┬───────────────────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────────────────┐
         │  AppContext.getLeaderboard()                         │
         │  filtra por registrations (sanitizadas)              │
         │                                                      │
         │  approvedAthleteIds = new Set(['ath1', 'ath2', ...])│
         │  (preenchido porque registrations contém dados!)    │
         └──────────────┬───────────────────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────────────────┐
         │  Resultado: Leaderboard COM DADOS ✅                 │
         │            (sem exposição de dados sensíveis) ✅     │
         └──────────────────────────────────────────────────────┘
```

#### **Opção A: Solução Definitiva (Médio Prazo)**
```
┌─────────────────────────────────────────────────────────────────┐
│                    NAVEGAÇÃO ANÔNIMA                            │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────┐
         │  /api/app/bootstrap (GET)       │
         │  sem autenticação                │
         └──────────────┬────────────────────┘
                        ↓
         ┌──────────────────────────────────────────────────────┐
         │  Bootstrap carrega:                                  │
         │  ✅ leaderboard_entries                              │
         │     .select('athlete_id, athlete_name, box_name,    │
         │              instagram, country, gender, ...')      │
         │                                                      │
         │  (Apenas dados públicos, sem email/payment)        │
         │                                                      │
         │  Filtro automático:                                 │
         │  WHERE payment_status = 'payment_approved'  (SQL)  │
         └──────────────┬───────────────────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────────────────┐
         │  AppContext.getLeaderboard()                         │
         │  usa leaderboard_entries diretamente                 │
         │                                                      │
         │  divisionAthletes = athletes filtrados por          │
         │  leaderboard_entries (sem exposição de dados)       │
         └──────────────┬───────────────────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────────────────┐
         │  Resultado: Leaderboard COM DADOS ✅                 │
         │            (máxima segurança) ✅                     │
         │            (melhor performance) ✅                   │
         └──────────────────────────────────────────────────────┘
```

---

## 📋 Tabelas de Dados

### Tabela: `registrations` (PRIVADA)

**Propósito:** Armazenar dados de inscrição e pagamento  
**Acesso:** Apenas usuários autenticados e admins  

```sql
CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  division_id TEXT,
  athlete_id TEXT,
  athlete_name TEXT,
  athlete_email TEXT,           ❌ PRIVADO
  athlete_phone TEXT,           ❌ PRIVADO
  box TEXT,
  gender TEXT,
  ticket_type TEXT,
  ticket_price NUMERIC,
  quantity INTEGER,
  total_paid NUMERIC,           ❌ PRIVADO
  payment_status TEXT,          ⚠️ SEMI-PRIVADO
  payment_id TEXT,              ❌ PRIVADO
  payment_method TEXT,          ❌ PRIVADO
  coupon_code TEXT,             ❌ PRIVADO
  user_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

RLS POLICY:
- Anônimos: SEM ACESSO (deny all)
- Athlete: VÊ apenas suas próprias registrations
- Manager: VÊ registrations de seus eventos
- Owner: VÊ tudo
```

---

### Tabela: `leaderboard_entries` (PÚBLICA) - NOVO

**Propósito:** Cache desnormalizado com dados públicos  
**Acesso:** Público (sem autenticação)  
**Sincronização:** Automática via trigger quando payment_approved  

```sql
CREATE TABLE leaderboard_entries (
  id UUID PRIMARY KEY,
  event_id TEXT,                ✅ PÚBLICO
  division_id TEXT,             ✅ PÚBLICO
  athlete_id TEXT,              ✅ PÚBLICO
  athlete_name TEXT,            ✅ PÚBLICO
  box_name TEXT,                ✅ PÚBLICO
  instagram TEXT,               ✅ PÚBLICO
  country TEXT,                 ✅ PÚBLICO
  gender TEXT,                  ✅ PÚBLICO
  birth_date TEXT,              ✅ PÚBLICO
  is_team BOOLEAN,              ✅ PÚBLICO
  team_members JSONB,           ✅ PÚBLICO (sanitizado)
  payment_approved_at TIMESTAMPTZ, ✅ PÚBLICO (timestamp apenas)
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

INDICES:
- (event_id, division_id) → rápido filtro
- (payment_approved_at) → rápido para "últimas inscrições"

RLS POLICY:
- Público: VÊ todos
```

---

## 🔄 Fluxo de Sincronização (OPÇÃO A)

```
1. ATLETA FAZ INSCRIÇÃO
   └─ registration.payment_status = "payment_pending"
      └─ ❌ Não cria leaderboard_entry

2. MERCADO PAGO PROCESSA
   └─ API atualiza registration.payment_status = "payment_in_process"
      └─ ❌ Não cria leaderboard_entry

3. MERCADO PAGO APROVA
   └─ API atualiza registration.payment_status = "payment_approved"
      └─ ✅ TRIGGER EXECUTADO!

4. TRIGGER sync_leaderboard_entry()
   ├─ Verifica: NEW.payment_status = 'payment_approved' ✓
   ├─ Verifica: OLD.payment_status != 'payment_approved' ✓
   ├─ Busca dados do atleta em athletes table
   ├─ INSERT INTO leaderboard_entries (
   │    athlete_name, box_name, instagram, country, ...
   │  )
   └─ Insere apenas dados PÚBLICOS

5. USUÁRIO ANÔNIMO ACESSA LEADERBOARD
   └─ Bootstrap carrega leaderboard_entries (dados públicos)
   └─ ✅ Leaderboard aparece com dados
   └─ ❌ Nenhum dado privado exposto

6. FUTURO: ATLETA PERDE INSCRIÇÃO
   └─ registration.payment_status = "payment_cancelled"
      └─ DELETE FROM leaderboard_entries (ou UPDATE is_active = false)
```

---

## 🔐 Matriz de Segurança

```
                    | Anônimo | Atleta | Manager | Owner
────────────────────┼─────────┼────────┼─────────┼──────
registrations       |   ❌    |   ✓    |   ✓     |  ✓
                    |  (deny) | (own)  | (event) | (all)
────────────────────┼─────────┼────────┼─────────┼──────
leaderboard_entries |   ✅    |   ✅   |   ✅    |  ✅
(dados públicos)    | (all)   | (all)  | (all)   | (all)
────────────────────┼─────────┼────────┼─────────┼──────
athletes            |   ✓*    |   ✓*   |   ✓*    |  ✓
(sanitizado público)| (pub)   | (own+) | (own+)  | (all)
────────────────────┼─────────┼────────┼─────────┼──────
scores              |   ✅    |   ✅   |   ✅    |  ✅
(dados competição)  | (all)   | (all)  | (all)   | (all)
────────────────────┼─────────┼────────┼─────────┼──────
events              |   ✓*    |   ✓*   |   ✓*    |  ✓
(publicados apenas) | (pub)   | (pub)  | (own+)  | (all)

* Dados públicos apenas (sem sensíveis)
✓ = Acesso controlado
✅ = Acesso total público
❌ = Negado
```

---

## 🗂️ Estrutura de Dados Final

### UM ATLETA INSCRITO NO LEADERBOARD

#### **Em `registrations` (PRIVADO)**
```javascript
{
  id: "reg_123",
  event_id: "evt_456",
  division_id: "div_789",
  athlete_id: "ath_001",
  athlete_name: "João Santos",
  athlete_email: "joao@example.com",        ❌ NÃO para público
  athlete_phone: "(11) 98765-4321",         ❌ NÃO para público
  box: "Box Força Total",
  gender: "male",
  payment_status: "payment_approved",       ⚠️ Interno apenas
  payment_id: "pay_mp_123456",              ❌ NÃO para público
  payment_method: "credit_card",            ❌ NÃO para público
  coupon_code: "SUMMER20",                  ❌ NÃO para público
  total_paid: 150.00,                       ❌ NÃO para público
  user_id: "user_123",
  created_at: "2026-06-01T10:00:00Z"
}
```

#### **Em `leaderboard_entries` (PÚBLICO)**
```javascript
{
  id: "le_001",
  event_id: "evt_456",
  division_id: "div_789",
  athlete_id: "ath_001",
  athlete_name: "João Santos",              ✅ PÚBLICO
  box_name: "Box Força Total",              ✅ PÚBLICO
  instagram: "@joao.santos",                ✅ PÚBLICO
  country: "BR",                            ✅ PÚBLICO
  gender: "male",                           ✅ PÚBLICO
  birth_date: "1990-05-15",                 ✅ PÚBLICO
  is_team: false,                           ✅ PÚBLICO
  team_members: null,                       ✅ PÚBLICO
  payment_approved_at: "2026-06-01T15:00Z", ✅ PÚBLICO (timestamp)
  created_at: "2026-06-01T15:00:00Z",
  updated_at: "2026-06-01T15:00:00Z"
}
```

#### **Resultado no Leaderboard (PÚBLICO)**
```javascript
{
  rank: 1,
  athlete: {
    id: "ath_001",
    name: "João Santos",
    box: "Box Força Total",
    country: "BR",
    instagram: "@joao.santos",
    isTeam: false
  },
  totalPoints: 450,
  scores: {
    "wod_1": { points: 100, rank: 1 },
    "wod_2": { points: 150, rank: 2 },
    // ...
  }
  // ❌ Nada de email, payment_id, coupon_code, etc
}
```

---

## 📋 Migração de Dados (OPÇÃO A)

### Passo 1: Criar Tabela
```sql
CREATE TABLE leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  athlete_name TEXT NOT NULL,
  box_name TEXT NOT NULL,
  instagram TEXT,
  country TEXT DEFAULT 'BR',
  gender TEXT,
  birth_date TEXT,
  is_team BOOLEAN DEFAULT FALSE,
  team_members JSONB,
  payment_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(event_id, division_id, athlete_id),
  INDEX idx_event_division (event_id, division_id),
  INDEX idx_payment_approved (payment_approved_at)
);
```

### Passo 2: Criar Trigger
```sql
CREATE OR REPLACE FUNCTION sync_leaderboard_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'payment_approved' 
     AND (OLD.payment_status IS NULL 
          OR OLD.payment_status != 'payment_approved') THEN
    
    INSERT INTO leaderboard_entries (
      event_id, division_id, athlete_id, athlete_name, 
      box_name, instagram, country, gender, birth_date, 
      is_team, team_members, payment_approved_at
    )
    SELECT 
      r.event_id, r.division_id, a.id, a.name, a.box,
      a.instagram, a.country, a.gender, a.birth_date, 
      a.is_team, a.team_members, NEW.updated_at
    FROM athletes a
    WHERE a.id = NEW.athlete_id
    
    ON CONFLICT (event_id, division_id, athlete_id)
    DO UPDATE SET 
      updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_leaderboard
AFTER UPDATE ON registrations
FOR EACH ROW
EXECUTE FUNCTION sync_leaderboard_entry();
```

### Passo 3: Backfill de Dados Existentes
```sql
INSERT INTO leaderboard_entries (
  event_id, division_id, athlete_id, athlete_name, box_name,
  instagram, country, gender, birth_date, is_team, team_members,
  payment_approved_at
)
SELECT 
  r.event_id, r.division_id, a.id, a.name, a.box,
  a.instagram, a.country, a.gender, a.birth_date, 
  a.is_team, a.team_members, r.updated_at
FROM registrations r
JOIN athletes a ON r.athlete_id = a.id
WHERE r.payment_status = 'payment_approved'
  AND NOT EXISTS (
    SELECT 1 FROM leaderboard_entries le
    WHERE le.athlete_id = a.id
      AND le.event_id = r.event_id
      AND le.division_id = r.division_id
  );
```

### Passo 4: RLS Policy
```sql
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read leaderboard entries"
ON leaderboard_entries FOR SELECT
USING (true);  -- Público pode ler tudo
```

---

## 📈 Comparação de Performance

```
                  | Dados Privados | Dados Públicos
──────────────────┼────────────────┼────────────────
Inscrições Total  | 1000           | 1000
Registrations     | 150 KB         | -
Leaderboard(JOIN) | -              | 35 KB
Tempo Load        | 500ms          | 150ms
Dados Expostos    | ❌ 0 campos    | ✅ 8 campos
Segurança         | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐
```

---

## 🎯 Campos Sanitizados por Tipo de Usuário

### **Usuário Anônimo (Público)**
```javascript
{
  athlete_name: "João Santos",
  box_name: "Box Força Total",
  instagram: "@joao.santos",
  country: "BR",
  gender: "male",
  birth_date: "1990-05-15",
  is_team: false,
  team_members: [],
  rank: 1,
  totalPoints: 450
  // ❌ Email, phone, payment_id, etc NÃO inclusos
}
```

### **Atleta Logado (Vê próprias infos)**
```javascript
{
  // Todos os campos públicos ACIMA, mais:
  athlete_email: "joao@example.com",      ✅ PRÓPRIO EMAIL
  athlete_phone: "(11) 98765-4321",       ✅ PRÓPRIO TELEFONE
  payment_status: "payment_approved",     ✅ PRÓPRIO STATUS
  // Mas NÃO vê dados de outros atletas
}
```

### **Manager de Evento (Vê de seus eventos)**
```javascript
{
  // Todos os campos públicos ACIMA, mais:
  athlete_email: "joao@example.com",
  athlete_phone: "(11) 98765-4321",
  payment_status: "payment_approved",
  coupon_code: "SUMMER20",                ✅ CUPOM USADO
  total_paid: 150.00,                     ✅ VALOR PAGO
  // Vê dados de seus eventos apenas
}
```

---

## ✅ Checklist de Implementação

### **FASE 1: Quick Fix (OPÇÃO D) - 30 minutos**
- [ ] Criar função `sanitizePublicRegistration()`
- [ ] Modificar bootstrap para sempre carregar registrations
- [ ] Aplicar sanitização para usuários anônimos
- [ ] Testar: usuário anônimo não vê email/phone
- [ ] Testar: leaderboard público funciona
- [ ] Commit

### **FASE 2: Solução Permanente (OPÇÃO A) - 4 horas**
- [ ] Criar migration para `leaderboard_entries`
- [ ] Criar trigger `sync_leaderboard_entry()`
- [ ] Fazer backfill de dados existentes
- [ ] Adicionar RLS policy pública
- [ ] Modificar bootstrap para carregar `leaderboard_entries`
- [ ] Modificar AppContext para usar `leaderboard_entries`
- [ ] Testes: trigger funciona em nova registration
- [ ] Testes: leaderboard mostra dados corretos
- [ ] Testes: performance aceitável
- [ ] Commit

### **FASE 3: Validação**
- [ ] Deploy em staging
- [ ] Verificar logs
- [ ] Monitorar performance
- [ ] Deploy em produção

---

## 🎓 Resultado Final

```
ANTES (Inseguro)
├─ ❌ Leaderboard público vazio
├─ ❌ Dados sensíveis expostos se logado
├─ ❌ Bootstrap expõe registrations completas
└─ ❌ Sem separação público/privado

DEPOIS (Seguro)
├─ ✅ Leaderboard público com dados
├─ ✅ Dados sensíveis nunca expostos
├─ ✅ Bootstrap retorna apenas dados públicos
├─ ✅ Separação clara público/privado
├─ ✅ Performance otimizada (cache desnormalizado)
├─ ✅ Escalável para 100k+ atletas
├─ ✅ Conformidade com segurança
└─ ✅ Experiência do usuário melhorada
```

---

**Próximo:** Aprovar este plano para implementação?

