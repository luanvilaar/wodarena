---
name: project-fitness-race-f2-1-100-1-106-validation
description: Súmula Fitness Race F2 (Stories 1.100–1.106, nível 2, D27–D38) validada GO em 2026-10-31; 1.103 e 1.105 Ready com maquete obrigatória; perguntas abertas ao Luan
metadata:
  type: project
---

Stories 1.100–1.106 (F2, nível 2) foram validadas GO e passaram a Ready em 2026-10-31. As notas: 9, 8, 8, 9, 8, 8, 9. As decisões D27–D38 prevalecem sobre D1, D2, D12, D14c, D15, D16 e D25 (sem DQ, última estação fecha o tempo, 2 cartões por judge, escala, splits públicos).

- 1.103 (dois cartões) e 1.105 (cobertura) estão Ready, mas o @dev só começa depois que o Luan aprovar as maquetes `telas/dois-cartoes.html` e `telas/cobertura.html`.
- Recomendei publicar a 1.101 junto com a 1.102. Sozinha, a 1.101 faz um percurso com o Wall Ball no meio parar de fechar o tempo pela súmula.
- Risco que deixei registrado: percurso com duas estações reps. `readRaceWallBallBoard` só pega a primeira.

Perguntas abertas ao Luan:
- saída incompleta na última estação de trenó ou seções;
- escala que só orienta;
- textos dos alertas;
- no-rep do Wall Ball numa estação reps genérica;
- controles de carga só quando a carga é informada;
- número de peito (a 1.97 o adiou para a F2, mas a D38 não o inclui);
- meta errada depois da 1ª largada: um gatilho trava o snapshot, e não há como corrigir.

**Why:** a próxima sessão não deve reabrir o que já foi validado e precisa saber quais respostas do Luan ainda faltam.
**How to apply:** quando o Luan responder alguma dessas perguntas, revalidar só a story afetada. Ver [[project-fitness-race-1-93-1-99-validation]].
