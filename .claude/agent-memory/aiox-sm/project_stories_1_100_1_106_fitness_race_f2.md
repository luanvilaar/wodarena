---
name: stories-1-100-1-106-fitness-race-f2
description: Stories 1.100 a 1.106 (Fitness Race F2, nível 2, D27-D38) em Draft desde 2026-10-30; corte, cadeia de dependência, maquetes exigidas e perguntas abertas ao Luan
metadata:
  type: project
---

Stories 1.100 a 1.106 criadas em Draft em 2026-10-30 (nível 2 aprovado, D27-D38 em DECISOES.md). Cadeia: 1.100 estrutura da prova (`conferenceKind`/`units` em CourseStage, snapshot) -> 1.101 última estação fecha o tempo (D34; Wall Ball no meio não fecha; registro tardio) -> 1.102 tela do judge de uma estação não-reps (`raceStationKey` = nome normalizado, `StationCard`) -> 1.103 dois cartões + limite 2 (reps 1, exclusivo) com maquete exigida -> 1.104 escala judge x estação (tabela `race_judge_assignments`, padrão + por onda) -> 1.105 cobertura ao vivo com maquete exigida -> 1.106 splits públicos (fatia fina, `buildRaceSplits` já existe).

**Why:** o item 8 do corte (troca de judge) foi dobrado em 1.103 (soltar/dispensar cartão, autoria preservada) e 1.104 (escala por onda), sem story própria.

**How to apply:** perguntas abertas ao Luan (AUTO-DECISIONs nas stories): saída incompleta na última estação de trenó/seções fecha o tempo com 180 s/unidade (1.101); escala orienta e não bloqueia o servidor (1.104); "mais de 2 por judge" virou capacidade/inconsistência (1.105); `reps` do organizador = contagem do Wall Ball (1.100); controles de carga só em seção com carga (1.102). Lacunas: snapshot trava na 1ª largada e `set_ruleset` saiu com a D29 (sem como refrescar metas); D7 fala em número de peito mas D38 não o traz (lista + busca por nome). Textos de DQ ainda existem em 1.97/1.98/1.99 e em "Efeito nas stories" do DECISOES.md, o código já não tem DQ. F1 inteira estava sem commit e admin/page.tsx com 1.92 não commitada; court-ui.test.mjs trava admin/page.tsx por regex.
