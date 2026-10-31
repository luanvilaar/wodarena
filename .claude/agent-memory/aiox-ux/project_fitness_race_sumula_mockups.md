---
name: fitness-race-sumula-mockups
description: Maquetes da súmula Fitness Race em docs/design/fitness-race-sumula/telas/; F1 (largada, Wall Ball, painel) aprovadas em D23; F2 (dois-cartoes 1.103, cobertura 1.105) entregues 2026-10-31, aguardando o Luan
metadata:
  type: project
---

F1: largada.html, wall-ball.html, painel-organizador.html, aprovadas pelo Luan em 2026-10-30 (D23). Depois veio a D27 (sem DQ), então botões de DQ dessas maquetes não valem mais.

F2 ajuste (2026-10-31, D39–D41): estação final e Wall Ball viraram tela de 1 atleta (view "solo" em dois-cartoes.html, sem Soltar/Dispensar); cobertura sem escala ficou sem avisos e com selo neutro "Fora da escala". Pendentes a confirmar: troca de judge na final só via organizador, Wall Ball no meio, judge com cartões não abre a final.

F2: em 2026-10-31 entreguei dois-cartoes.html (Story 1.103, inclui o StationCard da 1.102) e cobertura.html (Story 1.105, com a tabela de textos finais dos alertas). As duas aguardam aprovação; as stories ficam bloqueadas até lá.

**Why:** a regra do projeto é que o desenho aprovado vai para o repositório antes do código ([[design-system]]).

**How to apply:**
- Ajustes pedidos pelo Luan: editar esses arquivos e o README.md da pasta.
- Decisões propostas na F2 que ele precisa confirmar: celular em pé com abas (não empilhado); folha de infração dentro do cartão; soltar com folha de dois botões; cartão liberado vira resumo; "Atletas sem judge" substitui "Sem judge escalado" na mesma estação; "n de 2" conta cartões de qualquer onda; cobertura no topo da aba.
- O pedido do Luan é "um agente por vez, relatórios curtos".
- Antes de entregar: rodar `.claude/skills/impeccable/scripts/impeccable detect <dir>` (pega caixa alta acima de uns 30 caracteres, inclusive no sobretítulo da página) e conferir no Chrome headless (`--headless=new --screenshot`); as maquetes aceitam `#s=estado&w=largura` na URL.
