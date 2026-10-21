# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Atletas** de Functional Fitness e Fitness Race: inscrevem-se online, pagam, acompanham cronograma, baterias e leaderboard (muitas vezes pelo celular, no dia da prova).
- **Gestores (organizadores)**: criam e operam eventos no painel (divisões, provas, cronograma, baterias, resultados, judges), com validade de acesso controlada pela plataforma.
- **Judges**: arbitram na quadra pela súmula digital no celular (tema claro de alto contraste), atleta por atleta, raia por raia.
- **Owner da plataforma**: administra gestores, taxas e o destaque da home.
- **Público do evento**: acompanha resultados no local e à distância.

## Product Purpose

WODArena é a plataforma de eventos de Functional Fitness e Fitness Race: inscrição online com checkout (Mercado Pago em BRL, Stripe em EUR/GBP), cronograma e baterias, súmula digital do judge que publica o resultado na hora, e leaderboard. Sucesso: o evento roda do primeiro inscrito ao último resultado dentro da plataforma, sem planilha paralela.

## Positioning

O resultado nasce na quadra: a súmula digital registra cada repetição no servidor, que calcula e publica o resultado com a mesma regra do ranking do painel. O placar não depende de alguém digitar resultados depois.

## Operating Context

- Eventos presenciais em boxes e arenas, com baterias sequenciais definidas no cronograma oficial (itens do tipo bateria, com prova, horário e raias).
- Uma bateria roda por vez no evento.
- Conexão de internet do local pode ser instável; a súmula guarda os toques no aparelho e envia quando a rede volta.
- UI em português (com suporte a outras línguas nas páginas públicas).

## Capabilities and Constraints

- Next.js (App Router) na Vercel serverless; Supabase Postgres acessado pelo servidor (service role); sem worker em segundo plano e sem camada realtime hoje (atualização por re-leitura periódica).
- Autenticação própria (cookie de sessão HMAC de 12h), papéis owner, manager, athlete e judge.
- Dois tipos de evento: functional_fitness e fitness_racing.
- Leaderboard por divisão em pontos por colocação (low-point); nomes públicos passam por sanitização de PII.
- Migrations da súmula digital (estrutura da prova e súmulas) já aplicadas no Supabase (conferido em 2026-10-20). A migration do telão (`20261020120000_live_broadcast.sql`) ainda depende de aplicação autorizada.

## Brand Commitments

- Nome WODArena; logo em `src/app/icon.svg` e `docs/design/assets/`.
- Painel e páginas públicas em tema escuro; a súmula da quadra usa tema claro de alto contraste (decisão aprovada em 2026-10-15).
- Desenhos aprovados ficam versionados em `docs/design/` e são citados nos critérios de aceite das stories.

## Evidence on Hand

- Desenhos aprovados da súmula digital: `docs/design/sumula-digital/`.
- Não há fotos de eventos, depoimentos ou métricas de uso no repositório; não inventar.

## Product Principles

1. O resultado oficial vem do servidor, nunca do aparelho; o que é parcial é sempre rotulado como parcial.
2. Uma fonte de verdade por dado: o ranking público, o painel e qualquer nova tela usam a mesma regra de classificação.
3. O dia do evento não pode depender de uma pessoa digitando: o que a quadra registra aparece sozinho.
4. Dados pessoais do atleta não saem do servidor além do nome sanitizado e do box.
