# Súmula Fitness Race: maquetes das telas (aprovadas)

Maquetes de 2026-10-30 para as Stories 1.96, 1.97 e 1.98 (decisão D11). Abra cada arquivo no navegador; são autocontidos (só as fontes vêm do Google Fonts) e usam dados fictícios.

**Aprovadas pelo Luan em 2026-10-30 (D23)**, já com os ajustes D15 a D22. Elas são o desenho aprovado das Stories 1.96, 1.97 e 1.98, e o bloqueio da D11 está levantado. As decisões D24 a D26, tomadas na mesma aprovação, prevalecem sobre a maquete onde ela não as mostra (ver abaixo).

| Arquivo | Story | Estados (barra "Estado" no topo da página) |
|---------|-------|--------------------------------------------|
| [largada.html](largada.html) | 1.96 | Lista de ondas · Antes da largada · Toque rápido · Segurando · Largada guardada (sem conexão) · Depois da largada · Segundo toque (409) |
| [wall-ball.html](wall-ball.html) | 1.97 | Lista da onda · Em andamento · NO REP aberto · Infração geral · Trava em 100 · Saída com 94 · Saída registrada · Propor DQ · Confirmar DQ · Dupla · Liberado |
| [painel-organizador.html](painel-organizador.html) | 1.98 (e seção Ondas da 1.96) | Lista cheia · modais de alterar, revogar, confirmar DQ, ajustar tempo, corrigir largada e trocar regulamento · falha na atualização do resultado · evento sem pendências · largura desktop ou tablet |
| [dois-cartoes.html](dois-cartoes.html) | 1.103 (e cartão da 1.102) | Um cartão e vaga livre · lista da onda com busca · cartão novo em foco · dois cartões (vaga cheia) · terceiro recusado · Wall Ball recusado · equipe · infração e advertência · ergômetro · seções com carga · seções: refazer · genérica (no meio do percurso) · pronto para liberar · concluído, vaga livre · atleta saiu · soltar · dispensar · troca de judge (lista e cartão) · recusa em um cartão · **estação final, tela de 1 atleta (D39): em andamento · liberado · segundo atleta recusado ("Esta estação é de 1 atleta por judge") · outro judge assume** · Wall Ball sozinho · Wall Ball: segundo atleta recusado (Wall Ball no meio do percurso confirmado, D43) · larguras celular em pé (abas ou empilhados), deitado e tablet. Soltar e Dispensar só nas estações de 2 cartões. |
| [cobertura.html](cobertura.html) | 1.105 | Tudo coberto · alertas ao vivo · onda que não largou (preparação, escala ajustada) · outra onda · evento sem escala (sem nenhum aviso, só a orientação e o resumo do que já foi aberto, D40) · carregando · falha ao atualizar · judge fora da escala com selo neutro nos estados com escala (D41) · largura desktop ou tablet · tabela com os textos finais dos alertas |

**dois-cartoes.html e cobertura.html: aprovadas pelo Luan em 2026-10-31 (D42)**; Stories 1.103 e 1.105 liberadas. Cada maquete termina com a lista "Para o Luan aprovar". Os estados também abrem pela URL: `dois-cartoes.html#s=two&w=land`, `cobertura.html#prep`.

Em todas: a barra "Sincronização" alterna Salvo, Pendente e Sem conexão; as telas do árbitro têm tema claro de alto contraste (padrão da quadra) e o escuro só para comparação. O painel é só escuro, como o admin.

Valores de penalidade dos presets 2025/26 e 2026/27 estão **a conferir com o regulamento oficial**.

## Decisões do Luan aplicadas (D15 a D22, ver [DECISOES.md](../DECISOES.md))

- **D15:** "Desclassificar" direto do organizador, no painel, aprovado.
- **D17:** infração geral em 1 toque, sem confirmação; "Desfazer último" corrige.
- **D18:** "Atleta saiu" exige segurar para confirmar, como o "Liberar".
- **D19 e D20:** "Alterada" é um selo sobre a penalidade vigente; no tablet o painel mantém os cartões altos.
- **D21:** a tela de liberação mostra em destaque o tempo do atleta (largada da onda até a liberação, pelo relógio do aparelho), avisando que o oficial é calculado pelo servidor.
- **D22:** sair antes das 100 reps **não fecha o tempo**. A folha "Saída com 94" orienta o árbitro a mandar o atleta completar as reps faltantes, e o tempo segue correndo. O cálculo "faltantes × 15 s" saiu da tela.

## Aprovação (D23) e decisões que a acompanham (D24 a D26)

- **D23:** as três maquetes estão aprovadas. Stories 1.96, 1.97 e 1.98 liberadas para implementação.
- **D24 (resolve a pendência do botão "Atleta saiu"):** o botão **fica**, como registro de abandono que **não fecha o tempo**, segurando para confirmar (D18). É o que a maquete já mostra nos estados "Saída com 94" e "Saída registrada". No código o registro é um evento próprio do log, `abandon` (sem penalidade, sem fechar a corrida, desfazível); o `{ t: 'exit' }` que aparece no log fictício da maquete é só ilustração e **não** é o evento usado (Story 1.97, AC8). No painel, a corrida aparece em "Sem tempo fechado" com a linha da saída registrada (Story 1.98, AC9).
- **D25:** "Desfazer DQ" do organizador (gestor dono ou owner, motivo obrigatório). A maquete do painel não mostra esse botão; ele segue o mesmo padrão do "Desfazer DNF" já aprovado (botão no cartão da corrida desclassificada, modal com motivo e prévia "volta para a situação anterior"). Story 1.98, AC16.
- **D26:** a faixa das telas do árbitro mostra "Fitness Race · Largada" e "Fitness Race · Wall Ball", como nas maquetes; o `CourtShell` ganha um parâmetro de título e "Arbitragem na quadra" continua o padrão de Functional Fitness (Stories 1.96 e 1.97).
