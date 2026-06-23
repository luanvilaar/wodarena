# WODArena

Estrutura canonica da raiz do repositorio:

- `src/`: aplicacao Next.js, componentes, contexto e bibliotecas de dominio.
- `public/`: assets servidos pela aplicacao em runtime.
- `bin/`: entrypoints e scripts operacionais/CLI do projeto.
- `tests/`: regressao estatica e testes via `node --test`.
- `supabase/`: migrations e artefatos de banco.
- `docs/`: historias, auditorias, planos e referencias tecnicas.
- `archive/`: snapshots e material legado fora da raiz operacional.
- `.aiox-core/`, `.codex/`, `.claude/`, `.gemini/`: infraestrutura local de agentes e automacao.

Convencao da raiz:

- Manter no root apenas configuracoes, manifests, contratos de ferramenta e diretorios de alto nivel.
- Novos documentos devem entrar em `docs/` na subpasta semantica adequada.
- Novos assets executados pela interface devem entrar em `public/`.
- Novos scripts utilitarios devem entrar em `bin/`.
- Material legado, snapshots ou referencias nao operacionais devem entrar em `archive/`.
