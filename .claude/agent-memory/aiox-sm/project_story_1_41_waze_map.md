---
name: project-story-1-41-waze-map
description: Story 1.41 (mapa Waze do local do evento + coordenadas no admin) criada em 2026-10-14; pendências de termos do Mapbox/Waze que o usuário ainda precisa decidir
metadata:
  type: project
---

Story 1.41 (Draft, 2026-10-14) está em `docs/stories/1.41.story.md`: card de mapa (iframe Waze Live Map) na aba Detalhes de `EventView.tsx`, colunas `events.latitude/longitude`, campo de coordenadas no admin e "Buscar pelo endereço" via Mapbox em `POST /api/admin/geocode`.

**Why:** ao verificar a documentação oficial (14/10/2026), o @sm achou dois pontos que contrariam premissas do pedido do Luan e que dependem dele: (1) Mapbox diz "só usar respostas do Geocoding junto de um mapa Mapbox" e que resultados permanentes "não podem ser usados para distribuição ou sublicença" (a story grava e publica o ponto, e exibe num mapa Waze); (2) Waze proíbe usar sua logo com mapa não-Waze (caso cinzento: evento sem coordenadas mostra o botão com a logo sem o iframe). Permanente custa US$ 5 por 1.000 sem faixa grátis.

**How to apply:** se o Luan voltar a falar de 1.41, geocode ou Mapbox, lembrar que `MAPBOX_TOKEN` só deve ser configurado em produção depois da decisão dele (a story foi desenhada para funcionar só com colagem manual, token ausente responde 503). Detalhes e fontes estão em Dev Notes R1 e R2 da story; conferir lá antes de afirmar qualquer coisa, pois preços e termos mudam.
