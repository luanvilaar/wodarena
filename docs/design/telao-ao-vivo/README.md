# Telão ao vivo: desenho aprovado

Desenho aprovado pelo usuário em 2026-10-20 para o leaderboard de transmissão (TV ou projetor no local do evento). Plano completo em [docs/PLANO-TELAO-LEADERBOARD-AO-VIVO.md](../../PLANO-TELAO-LEADERBOARD-AO-VIVO.md).

- **Maquete:** [telao-ao-vivo-aprovado.html](telao-ao-vivo-aprovado.html). Abra no navegador; a simulação roda sozinha (chamada, largada, bateria ao vivo e intervalo). As estruturas A e B continuam na maquete só como registro das alternativas.
- **Artefato publicado:** https://claude.ai/artifact/Djj1vQ3KUyAX8YCioKFQ5S (privado). Esta cópia é a referência caso o artefato deixe de abrir.

## O que foi aprovado

1. **Placar da bateria: estrutura C, "Líder e pelotão".** Quem lidera ocupa a coluna da esquerda (posição, raia, nome, box, repetições ou tempo final e a vantagem sobre o 2º). As demais raias ficam numa lista à direita que se reordena a cada ultrapassagem, com a barra dos blocos da prova, o bloco atual e quanto falta.
2. **Troca automática de tela, com mesa de controle.** Bateria rodando → placar da bateria; intervalo → geral da categoria; o gestor pode fixar uma bateria, o geral de uma categoria ou a tela de espera.
3. **O telão detecta pelas súmulas quem está sendo julgado** (decisão do usuário em 2026-10-20): ele não depende do horário do cronograma, porque atrasos são comuns. A chamada aparece quando os judges abrem as súmulas da próxima bateria (ou quando a chamada é liberada no cronograma). O cronograma só dá a ordem, as raias e os nomes.
4. **Largada e encerrar são só do gestor.** A largada acerta o relógio do telão no sinal oficial; sem ela, o relógio começa no "Iniciar" da primeira súmula. Encerrar força o intervalo com súmula pendente.
5. **Link secreto revogável**, sem login na TV. O banco guarda só o hash; perdeu o link, gera outro.
6. **Uma bateria por vez** no evento.
7. **Nome completo sanitizado e box.** Times mostram o nome do time.
8. **O placar da bateria é parcial** até o judge enviar a súmula, e diz isso na tela; o envio troca pelo resultado oficial (selo verde).

## Telas

| Tela | Quando aparece |
|------|----------------|
| Chamada | Súmulas da bateria abertas sem nenhum toque, ou chamada liberada no cronograma |
| Bateria ao vivo | Uma súmula da bateria recebeu registro (e nenhuma ficou parada por mais de 20 min) |
| Intervalo | Todas as súmulas enviadas, ou "Encerrar bateria"; fica pelo menos 90 s antes da chamada seguinte |
| Espera | Sem bateria começada, ou fixada pelo gestor |

## Stories

| Story | Escopo |
|-------|--------|
| [1.53](../../stories/1.53.story.md) | Migration do telão, link secreto e aba "Telão" |
| [1.54](../../stories/1.54.story.md) | Progresso ao vivo da súmula e ordem parcial da bateria |
| [1.55](../../stories/1.55.story.md) | Geral da categoria em função pura compartilhada |
| [1.56](../../stories/1.56.story.md) | API do telão e detecção do que vai ao ar |
| [1.57](../../stories/1.57.story.md) | Tela do telão |
| [1.58](../../stories/1.58.story.md) | Mesa de controle |
