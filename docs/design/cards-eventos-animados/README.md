# Cards de evento da home: movimento aprovado

Desenho aprovado pelo usuário em 2026-10-22 para a animação dos cards de evento da home (`EventCard`). Origem: variante **2A** do projeto "Animações para Wodarena" no Claude Design, que combina 1A (entrada em cascata), 1D (botão Garantir Vaga) e 1E (contagem do preço e das divisões), adaptada ao design system do WODArena.

- **Artefato publicado:** https://claude.ai/artifact/3n7Dfc6bo36uwtAqebYZcw (privado). Telas Desktop 1280 e Mobile 390, com o seletor **Hoje / Proposta**, "Reiniciar" e "Movimento reduzido".
- **Fontes da maquete:** [desktop.dc.html](desktop.dc.html) e [mobile.dc.html](mobile.dc.html). São artboards do formato Design Component do Claude (`.dc.html`) e só rodam dentro do canvas do artefato; esta cópia é a referência caso o artefato deixe de abrir. Os valores de CSS (tempos, curvas, deslocamentos) estão neles.
- **Story:** [1.65](../../stories/1.65.story.md).

## O que foi aprovado

1. **Cor:** amarelo do design system do site (`--primary` #fcd535), nunca o lima do projeto do Claude Design (era placeholder; o teste `design-system.test.mjs` proíbe o lima antigo). Tipografia, raios e superfícies são os do `EventCard` atual (Inter, IBM Plex Sans nos números).
2. **Escopo:** só o 2A. Ficam de fora 1B (mira e varredura), 1C (radar do "Ao vivo"), 1F (glitch RGB), 1G (tilt 3D) e 1H (linha de energia). O carrossel do topo (`FeaturedEventBanner`) não muda.
3. **Brilho único no mobile mantido:** em tela sem hover, o brilho do Garantir Vaga toca uma vez depois que o card assenta, só nos cards abertos.

## Linha do tempo (card aberto ou ao vivo)

| Instante | O que acontece |
|----------|----------------|
| 0 ms | O card abre de cima para baixo (`clip-path`, 520 ms). |
| +100 ms a +460 ms | Cinco blocos sobem 14 px com 90 ms entre eles: status, banner, identidade, detalhes, botões (440 ms cada). O banner dá zoom-out de 1,1 para 1 (900 ms). |
| +450 ms | O preço conta de zero ao valor (700 ms, desaceleração exponencial). |
| +500 ms | O número de divisões conta de zero ao valor (500 ms). |
| +1250 ms | **Só em tela sem hover:** o brilho diagonal cruza o Garantir Vaga uma vez (750 ms), quando o botão está visível (60%). Se o visitante só chegar ao botão depois desse tempo, o brilho toca 150 ms depois de ele aparecer. Refinamento de implementação sobre a maquete, que tocava no tempo fixo mesmo com o botão fora da tela (em celular o botão fica ~600 px abaixo do topo do card). |

- **Desktop com hover:** no Garantir Vaga, brilho diagonal (700 ms) e seta que avança 3 px; no card, zoom de 3% no banner (500 ms). Cards em colunas diferentes da mesma linha entram com 70 ms de diferença (2 colunas em `sm`, 3 em `lg`).
- **Toque ou clique em qualquer botão do card:** comprime a 97% (80 ms para entrar, 120 ms para soltar) e a seta avança 3 px.
- **Card encerrado ("Vendas encerradas" ou evento finalizado):** só um fade de 240 ms. Sem contagem, sem brilho, sem zoom.
- **Card ao vivo:** mesma entrada do aberto; o botão Leaderboard só comprime.

## Regras de mobile

- A entrada dispara quando o card chega a 96 px da borda inferior da tela, uma vez por evento na sessão. Não há cascata entre cards em 1 coluna. Voltar para um card já visto, trocar o filtro ou voltar de outra página não repete a animação.
- Sem hover: tudo que depende de hover fica atrás de `@media (hover: hover)`; o toque usa `:active`. Alvos de toque seguem com 48 px de altura.
- Só `transform`, `opacity` e `clip-path`. A contagem usa números de largura fixa (`tabular-nums`), sem mexer no layout.
- O conteúdo nunca fica escondido se a animação não rodar (movimento reduzido, sem `IntersectionObserver`).

## Movimento reduzido

Sem animação nenhuma: o card aparece pronto, com o preço final, e o botão mantém o feedback de cor. (A maquete da primeira rodada mostrava um fade de 160 ms; a política global do projeto, em `globals.css`, zera as durações, então vale "sem animação".)
