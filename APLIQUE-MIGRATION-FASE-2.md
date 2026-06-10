# 📋 Como Aplicar a Migration da Fase 2

**Arquivo SQL Criado:** `supabase/migrations/20260610100000_leaderboard_entries.sql`

---

## 🔧 Opção 1: Via Supabase Dashboard (MAIS FÁCIL)

### Passo 1: Abrir Supabase Dashboard
```
https://app.supabase.com
```

### Passo 2: Selecionar seu projeto

### Passo 3: Ir para SQL Editor
```
Sidebar esquerdo → SQL Editor
```

### Passo 4: Criar novo SQL
```
Clique em "+" → "New Query"
```

### Passo 5: Copiar SQL da migração
```
Abrir: supabase/migrations/20260610100000_leaderboard_entries.sql
Copiar TODO o conteúdo
Colar no SQL Editor do Supabase
```

### Passo 6: Executar
```
Clique em "Run"
Aguardar conclusão (deve levar ~10 segundos)
```

### Passo 7: Verificar Sucesso
```
✅ Se completou sem erros, a tabela foi criada
❌ Se teve erro, copiar mensagem e debugar
```

---

## 🔧 Opção 2: Via Supabase CLI (Se Instalado)

### Passo 1: Instalar/Verificar CLI
```bash
npm install -g supabase
# ou
npx supabase --version
```

### Passo 2: Fazer Login
```bash
supabase login
# Seguir instruções de autenticação
```

### Passo 3: Linkar Projeto
```bash
supabase link --project-ref YOUR_PROJECT_REF
# Encontre YOUR_PROJECT_REF em: https://app.supabase.com/project/_/settings/general
```

### Passo 4: Aplicar Migration
```bash
supabase db push
# Deve exibir: "Applied migration 20260610100000_leaderboard_entries"
```

---

## 🔧 Opção 3: Via PostgreSQL Client (pgAdmin, DBeaver, etc)

Se você tem acesso direto ao banco:

### Passo 1: Conectar ao banco
```
Usar credenciais do Supabase:
Host: [seu-project].supabase.co
Port: 5432
Database: postgres
User: postgres
Password: [sua-senha]
```

### Passo 2: Abrir arquivo SQL
```
File → Open → supabase/migrations/20260610100000_leaderboard_entries.sql
```

### Passo 3: Executar
```
Clique em Run / Execute
```

---

## ✅ Verificação Pós-Aplicação

### Verificar que tabela foi criada
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'leaderboard_entries';
```

**Resultado esperado:**
```
     table_name      
──────────────────────
 leaderboard_entries
```

### Verificar estrutura
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leaderboard_entries'
ORDER BY ordinal_position;
```

**Resultado esperado:**
```
      column_name       |            data_type             
────────────────────────┼──────────────────────────────────
 id                     | uuid
 event_id               | text
 division_id            | text
 athlete_id             | text
 athlete_name           | text
 box_name               | text
 instagram              | text
 country                | text
 gender                 | text
 birth_date             | text
 is_team                | boolean
 team_members           | jsonb
 payment_approved_at    | timestamp with time zone
 created_at             | timestamp with time zone
 updated_at             | timestamp with time zone
(15 rows)
```

### Verificar trigger foi criado
```sql
SELECT trigger_name, event_object_table 
FROM information_schema.triggers 
WHERE event_object_table = 'registrations';
```

**Resultado esperado:**
```
             trigger_name              | event_object_table
──────────────────────────────────────┼────────────────────
 trg_sync_leaderboard_on_payment_change | registrations
(1 row)
```

### Verificar RLS policy
```sql
SELECT policyname, permissive 
FROM pg_policies 
WHERE tablename = 'leaderboard_entries';
```

**Resultado esperado:**
```
       policyname       | permissive
────────────────────────┼───────────
 Public read leaderboard entries | t
(1 row)
```

---

## 🧪 Teste Rápido

Após aplicar a migration:

### 1. Verificar que tabela está vazia (inicialmente)
```sql
SELECT COUNT(*) FROM leaderboard_entries;
-- Resultado: 0 (ou alguns registros se fez backfill)
```

### 2. Simular inserção de registration aprovada
```sql
-- NOTA: Este é um teste conceitual
-- Você provavelmente não tem as IDs exatas
-- Simplesmente verifique que a tabela existe e está funcionando
SELECT * FROM leaderboard_entries LIMIT 1;
```

### 3. Verificar trigger está ativo
```sql
SELECT proname FROM pg_proc WHERE proname = 'sync_leaderboard_entry';
-- Resultado: sync_leaderboard_entry
```

---

## 🚨 Troubleshooting

### Erro: "relation "leaderboard_entries" already exists"
**Causa:** Tabela já foi criada  
**Solução:** Ignorar, prosseguir com próximas etapas

### Erro: "relation "events" does not exist"
**Causa:** Foreign key reference falhou  
**Solução:** Tabela events não existe (improvável). Verificar integridade do banco.

### Erro: "permission denied"
**Causa:** Usuário não tem permissão  
**Solução:** Usar conta com permissões de admin (postgres)

### Trigger não funciona
**Causa:** Função não foi criada antes do trigger  
**Solução:** Executar novamente a migration completa (já trata ordem)

---

## ✅ Checklist Pós-Migration

- [ ] Tabela `leaderboard_entries` existe
- [ ] Índices foram criados (3 índices)
- [ ] RLS policy está habilitada
- [ ] Trigger `trg_sync_leaderboard_on_payment_change` foi criado
- [ ] Função `sync_leaderboard_entry()` foi criada
- [ ] Backfill foi executado (sem erros)
- [ ] SELECT COUNT(*) FROM leaderboard_entries funciona
- [ ] Sem mensagens de erro no Supabase

---

## 📞 Depois de Aplicar a Migration

1. ✅ Confirmar que migration foi aplicada com sucesso
2. ✅ Executar testes de verificação acima
3. ✅ Prosseguir com modificações do AppContext
4. ✅ Testar trigger criando um novo registro

---

**Próximo Passo:** Depois de aplicar a migration, me avise para continuar com as mudanças do AppContext

