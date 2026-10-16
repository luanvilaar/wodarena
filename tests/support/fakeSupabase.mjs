// Cliente Supabase falso, em memória, para testes de comportamento das rotas e
// helpers do servidor. Implementa só o necessário: from().select/insert/update/
// upsert/delete com eq/in/not/order/maybeSingle/single, contagem com head e rpc. As chaves
// únicas seguem as do banco (supabase/migrations) e um conflito devolve o mesmo
// código do Postgres (23505), sem gravar nada.

const clone = (value) => structuredClone(value);

const lower = (value) => String(value ?? '').toLowerCase();

// Chaves únicas por tabela. Uma chave que devolve null não participa (índice parcial).
const UNIQUE_KEYS = {
  users: [
    { name: 'users_pkey', key: (row) => row.id },
    { name: 'users_email_key', key: (row) => row.email }
  ],
  users_secrets: [{ name: 'users_secrets_pkey', key: (row) => row.user_id }],
  registrations: [
    { name: 'registrations_pkey', key: (row) => row.id },
    {
      name: 'registrations_event_email_active_unique',
      key: (row) => (row.payment_status === 'payment_cancelled' ? null : `${row.event_id}|${lower(row.athlete_email)}`)
    }
  ],
  scores: [{ name: 'scores_pkey', key: (row) => `${row.athlete_id}|${row.workout_id}` }],
  // Súmula presencial (Stories 1.49 a 1.52): uma ativa por atleta e prova; o log com seq e id do aparelho únicos.
  scoresheets: [
    { name: 'scoresheets_pkey', key: (row) => row.id },
    { name: 'scoresheets_one_active_per_athlete', key: (row) => (row.status === 'cancelled' ? null : `${row.workout_id}|${row.athlete_id}`) }
  ],
  scoresheet_events: [
    { name: 'scoresheet_events_pkey', key: (row) => `${row.sheet_id}|${row.seq}` },
    { name: 'scoresheet_events_sheet_id_client_event_id_key', key: (row) => `${row.sheet_id}|${row.client_event_id}` }
  ]
};

const DEFAULT_UNIQUE_KEYS = [{ name: 'pkey', key: (row) => row.id }];

const uniqueKeysFor = (table) => UNIQUE_KEYS[table] || DEFAULT_UNIQUE_KEYS;

const duplicateKeyError = (constraint) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${constraint}"`,
  details: null,
  hint: null
});

const cardinalityError = () => ({
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
  details: null,
  hint: null
});

const findConflict = (table, existingRows, candidate) => {
  for (const { name, key } of uniqueKeysFor(table)) {
    const candidateKey = key(candidate);
    if (candidateKey === null || candidateKey === undefined) continue;
    if (existingRows.some((row) => row !== candidate && key(row) === candidateKey)) return name;
  }
  return null;
};

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.payload = undefined;
    this.returning = false;
    this.cardinality = null;
    this.countOnly = false;
    this.conflictColumns = ['id'];
    this.ordering = [];
  }

  select(_columns, options = {}) {
    if (this.action === 'select') {
      this.countOnly = options.count === 'exact' && options.head === true;
    } else {
      this.returning = true;
    }
    return this;
  }

  insert(payload) {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  update(patch) {
    this.action = 'update';
    this.payload = patch;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  order(column, options = {}) {
    this.ordering.push({ column, ascending: options.ascending !== false });
    return this;
  }

  upsert(payload, options = {}) {
    this.action = 'upsert';
    this.payload = payload;
    this.conflictColumns = String(options.onConflict || 'id').split(',').map((column) => column.trim());
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && row[column] === value);
    return this;
  }

  in(column, values) {
    const accepted = new Set(values);
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && accepted.has(row[column]));
    return this;
  }

  not(column, operator, value) {
    if (operator !== 'eq') throw new Error(`fakeSupabase: operador não suportado em not(): ${operator}`);
    // Como no Postgres: NOT (NULL = x) não é verdadeiro, então nulos ficam de fora.
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && row[column] !== value);
    return this;
  }

  maybeSingle() {
    this.cardinality = 'maybe';
    return this;
  }

  single() {
    this.cardinality = 'single';
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }

  matchingRows() {
    const rows = this.database.rows(this.table).filter((row) => this.filters.every((filter) => filter(row)));
    if (this.action !== 'select' || this.ordering.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const { column, ascending } of this.ordering) {
        if (a[column] === b[column]) continue;
        const direction = ascending ? 1 : -1;
        return (a[column] > b[column] ? 1 : -1) * direction;
      }
      return 0;
    });
  }

  shape(rows) {
    if (this.cardinality === 'single') {
      return rows.length === 1 ? { data: clone(rows[0]), error: null } : { data: null, error: cardinalityError() };
    }
    if (this.cardinality === 'maybe') {
      if (rows.length > 1) return { data: null, error: cardinalityError() };
      return { data: rows[0] ? clone(rows[0]) : null, error: null };
    }
    return { data: clone(rows), error: null };
  }

  execute() {
    const { database, table } = this;
    database.operations.push({ table, action: this.action });

    if (this.action === 'select') {
      const rows = this.matchingRows();
      if (this.countOnly) return { data: null, count: rows.length, error: null };
      return this.shape(rows);
    }

    if (this.action === 'insert') {
      database.runBeforeInsert(table);
      const tableRows = database.rows(table);
      const candidates = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(clone);
      for (const [index, candidate] of candidates.entries()) {
        const conflict = findConflict(table, [...tableRows, ...candidates.slice(0, index)], candidate);
        if (conflict) return { data: null, error: duplicateKeyError(conflict) };
      }
      tableRows.push(...candidates);
      return this.returning ? this.shape(candidates) : { data: null, error: null };
    }

    if (this.action === 'update') {
      const rows = this.matchingRows();
      for (const row of rows) Object.assign(row, clone(this.payload));
      return this.returning ? this.shape(rows) : { data: null, error: null };
    }

    if (this.action === 'upsert') {
      database.runBeforeInsert(table);
      const tableRows = database.rows(table);
      const written = [];
      for (const candidate of (Array.isArray(this.payload) ? this.payload : [this.payload]).map(clone)) {
        const existing = tableRows.find((row) => this.conflictColumns.every((column) => row[column] === candidate[column]));
        if (existing) {
          Object.assign(existing, candidate);
          written.push(existing);
          continue;
        }
        const conflict = findConflict(table, tableRows, candidate);
        if (conflict) return { data: null, error: duplicateKeyError(conflict) };
        tableRows.push(candidate);
        written.push(candidate);
      }
      return this.returning ? this.shape(written) : { data: null, error: null };
    }

    if (this.action === 'delete') {
      const tableRows = database.rows(table);
      const removed = this.matchingRows();
      for (const row of removed) tableRows.splice(tableRows.indexOf(row), 1);
      return this.returning ? this.shape(removed) : { data: null, error: null };
    }

    throw new Error(`fakeSupabase: ação não suportada: ${this.action}`);
  }
}

/**
 * Cria um banco em memória a partir de `seed` ({ tabela: linhas[] }).
 * - `client`: o que o código do servidor recebe no lugar do Supabase;
 * - `rows(tabela)`: as linhas atuais (referência viva);
 * - `snapshot()`: cópia profunda de todas as tabelas, para comparar antes e depois;
 * - `onceBeforeInsert(tabela, fn)`: executa `fn(database)` uma vez, logo antes
 *   do próximo insert na tabela (simula outra requisição gravando no meio);
 * - `rpcCalls` e `operations`: o que foi chamado, na ordem.
 */
export const createFakeSupabase = (seed = {}) => {
  const tables = new Map(Object.entries(seed).map(([table, rows]) => [table, rows.map(clone)]));
  const beforeInsert = new Map();

  const database = {
    operations: [],
    rpcCalls: [],
    rows(table) {
      if (!tables.has(table)) tables.set(table, []);
      return tables.get(table);
    },
    snapshot() {
      return clone(Object.fromEntries(tables));
    },
    onceBeforeInsert(table, callback) {
      beforeInsert.set(table, callback);
    },
    runBeforeInsert(table) {
      const callback = beforeInsert.get(table);
      if (!callback) return;
      beforeInsert.delete(table);
      callback(database);
    },
    client: {
      from: (table) => new FakeQuery(database, table),
      rpc: async (name, args) => {
        database.rpcCalls.push({ name, args: clone(args) });
        return { data: null, error: null };
      }
    }
  };

  return database;
};
