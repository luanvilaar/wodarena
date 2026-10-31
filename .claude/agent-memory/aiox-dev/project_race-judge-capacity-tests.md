---
name: race-judge-capacity-tests
description: Since Story 1.103 a judge holds max 2 active race attempts and a solo station (reps anywhere or last station) alone; race test fixtures must respect it
metadata:
  type: project
---

Since Story 1.103 (2026-10-31), `open_attempt` and assumir return 409 when the acting person (any role) already has 2 active attempts in the event, or any active attempt alongside a solo station (`isSoloRaceStation`: `wall_ball` kind in any position, or the last station of the course). Owner self-release (`release_attempt` / `claim_attempt` + release by a judge) and `dismiss_attempt` are 409 on solo stations.

**Why:** four existing race test files broke because they opened 3+ attempts or a Wall Ball next to another card with the same JUDGE; `race-wall-ball.test.mjs` had to stay unedited.

**How to apply:** in new race tests, spread attempts across judges (or MANAGER), dismiss empty cards, or have MANAGER release a solo attempt before the same judge opens another. Seeded rows (pushed directly) bypass the check but still count for later opens. Related: [[race-fixture-future-start]], [[flaky-rel002-heat-start]].
