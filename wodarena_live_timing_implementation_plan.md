# WodArena — Plano de Implementação para Integração com Sistema de Cronometragem

## Objetivo deste documento

Este documento deve ser usado por outra IA ou por uma equipe de desenvolvimento para adaptar o WodArena a sistemas externos de cronometragem utilizados em eventos de **Fitness Race**.

A implementação deve ser feita de forma **agnóstica ao fabricante**, evitando acoplar a lógica principal do WodArena a uma única marca de placa, leitor RFID, decoder ou software de timing.

A arquitetura desejada deve permitir integração futura com diferentes fornecedores por meio de adapters.

---

# 1. Objetivo funcional

Criar no WodArena um módulo de **Live Timing** capaz de:

- receber leituras de chips RFID/transponders em tempo real;
- associar chips aos atletas inscritos;
- identificar em qual ponto de cronometragem o atleta foi detectado;
- registrar timestamps;
- calcular splits;
- determinar progresso na prova;
- calcular tempo total;
- atualizar leaderboard ao vivo;
- detectar possíveis inconsistências;
- permitir correções manuais pela organização;
- monitorar a saúde dos leitores/antenas;
- manter logs completos para auditoria.

Fluxo esperado:

```text
Placa / Antena RFID
        ↓
Software da empresa de cronometragem
        ↓
Adapter / WodArena Timing Gateway
        ↓
WodArena Timing API
        ↓
Timing Engine
        ↓
Banco de dados
        ↓
WebSocket / SSE
        ↓
Leaderboard em tempo real
```

IMPORTANTE:

O frontend React não deve receber os dados diretamente da placa.

A comunicação deve acontecer sempre através do backend.

---

# 2. Conceito principal da arquitetura

A implementação deve separar três responsabilidades.

## 2.1 Provider Adapter

Responsável por entender o protocolo específico de cada empresa ou equipamento.

Exemplos:

```text
RaceResult Adapter
ChronoTrack Adapter
Generic HTTP Adapter
Generic TCP Adapter
CSV/File Adapter
Custom Provider Adapter
```

O adapter transforma qualquer formato externo para o formato interno padronizado do WodArena.

---

## 2.2 Timing API

Responsável por receber as leituras normalizadas.

Endpoint sugerido:

```http
POST /api/v1/timing/read
```

Exemplo:

```json
{
  "event_id": "evt_823",
  "provider": "empresa_cronometragem",
  "reader_id": "reader_04",
  "timing_point_id": "station_03_exit",
  "chip_id": "A98342",
  "timestamp": "2026-11-14T09:47:21.783-03:00",
  "sequence": 18482
}
```

Resposta esperada:

```json
{
  "success": true,
  "reading_id": "read_739281",
  "athlete_id": "ath_381",
  "bib": 128,
  "status": "processed"
}
```

---

## 2.3 Timing Engine

Responsável por interpretar a leitura.

O Timing Engine deve:

1. localizar o evento;
2. localizar o chip;
3. localizar o atleta;
4. validar o timing point;
5. verificar duplicidades;
6. verificar sequência esperada;
7. registrar a leitura original;
8. gerar ou atualizar split;
9. atualizar progresso do atleta;
10. recalcular classificação;
11. publicar atualização em tempo real.

---

# 3. Entidades necessárias

A IA responsável pela implementação deve verificar o schema atual do WodArena e adaptar as entidades existentes em vez de duplicar conceitos.

Caso necessário, criar entidades equivalentes às descritas abaixo.

---

## 3.1 TimingProvider

Representa a empresa ou sistema de cronometragem.

Campos sugeridos:

```text
id
name
slug
provider_type
api_key
webhook_secret
configuration
status
created_at
updated_at
```

Exemplo:

```text
RaceResult
ChronoTrack
Generic HTTP
Custom Fitness Race Provider
```

---

## 3.2 TimingReader

Representa uma placa, leitor ou decoder.

Campos sugeridos:

```text
id
event_id
provider_id
external_reader_id
name
timing_point_id
status
last_seen_at
metadata
```

Exemplo:

```text
reader_01
START
reader_02
RUN_01
reader_03
STATION_01_EXIT
```

---

## 3.3 TimingPoint

Representa um ponto lógico da prova.

Campos sugeridos:

```text
id
event_id
name
code
type
sequence_order
station_id
lap_number
distance
metadata
```

Tipos possíveis:

```text
START
RUN_SPLIT
STATION_IN
STATION_OUT
TRANSITION
LAP
FINISH
CUSTOM
```

---

# 4. Estrutura da prova Fitness Race

A prova deve possuir uma sequência configurável de checkpoints.

Exemplo:

```text
START
↓
RUN 01
↓
STATION 01 IN
↓
STATION 01 OUT
↓
RUN 02
↓
STATION 02 IN
↓
STATION 02 OUT
↓
RUN 03
↓
...
↓
FINISH
```

Não assumir que toda Fitness Race terá exatamente a mesma estrutura.

O gestor do evento deve poder configurar os pontos.

Exemplo:

```json
[
  {
    "order": 1,
    "code": "START",
    "type": "START"
  },
  {
    "order": 2,
    "code": "RUN_01",
    "type": "RUN_SPLIT"
  },
  {
    "order": 3,
    "code": "STATION_01_IN",
    "type": "STATION_IN"
  },
  {
    "order": 4,
    "code": "STATION_01_OUT",
    "type": "STATION_OUT"
  },
  {
    "order": 99,
    "code": "FINISH",
    "type": "FINISH"
  }
]
```

---

# 5. Associação chip → atleta

Cada atleta participante deve poder receber:

```text
bib_number
chip_id
secondary_chip_id (opcional)
```

Exemplo:

```text
Atleta: Luan Vilar
Número: 128
Chip: A98342
Categoria: Individual Masculino
```

A associação deve ocorrer antes da largada.

Criar ferramenta de importação em massa, se necessário.

Exemplo CSV:

```csv
bib,athlete_id,chip_id
128,ath_381,A98342
129,ath_382,B27391
130,ath_383,C98123
```

---

# 6. Modelo de leitura

Criar uma entidade imutável chamada, por exemplo:

```text
TimingReading
```

Campos:

```text
id
event_id
provider_id
reader_id
timing_point_id
chip_id
athlete_id
raw_timestamp
normalized_timestamp
sequence
raw_payload
processing_status
processing_error
created_at
```

Nunca apagar fisicamente uma leitura recebida.

Caso uma leitura seja invalidada, utilizar:

```text
invalidated_at
invalidated_by
invalidation_reason
```

ou equivalente.

Isso é importante para auditoria.

---

# 7. Idempotência e leituras duplicadas

Placas RFID podem gerar várias leituras do mesmo chip em poucos segundos.

O sistema deve tratar duplicidades.

Estratégia sugerida:

```text
event_id
+
chip_id
+
timing_point_id
+
timestamp window
```

Exemplo:

Se o mesmo chip aparecer no mesmo ponto dentro de 2 segundos:

```text
09:41:31.221
09:41:31.487
09:41:32.018
```

considerar apenas uma passagem válida.

O intervalo deve ser configurável.

Sugestão inicial:

```text
duplicate_window_ms = 2000
```

IMPORTANTE:

A leitura original pode continuar armazenada, mas somente uma deve gerar split.

---

# 8. Eventos fora de ordem

O Timing Engine deve saber a sequência esperada.

Exemplo:

```text
START
RUN_01
STATION_01_IN
STATION_01_OUT
RUN_02
...
FINISH
```

Se um atleta aparecer em:

```text
STATION_03_OUT
```

sem possuir registros anteriores necessários, marcar como:

```text
OUT_OF_SEQUENCE
```

Não necessariamente rejeitar imediatamente.

Pode existir atraso na comunicação dos leitores.

O sistema deve possuir capacidade de reprocessamento.

---

# 9. Processamento assíncrono

O endpoint de ingestão deve ser rápido.

Ideal:

```text
POST leitura
↓
validar autenticação
↓
salvar leitura
↓
enfileirar processamento
↓
responder 200/202
```

Depois:

```text
worker
↓
processa leitura
↓
atualiza splits
↓
atualiza leaderboard
↓
envia evento realtime
```

Se o stack atual já tiver fila:

```text
BullMQ
RabbitMQ
Kafka
SQS
Redis Queue
Celery
etc.
```

reutilizar.

Não adicionar infraestrutura desnecessária caso a escala atual não exija.

---

# 10. Timing Split

Criar entidade equivalente a:

```text
AthleteSplit
```

Campos sugeridos:

```text
id
event_id
athlete_id
timing_point_id
reading_id
absolute_time
elapsed_time
split_time
position_at_split
status
created_at
updated_at
```

---

# 11. Cálculo de tempo

Exemplo:

```text
START             09:30:00.000
RUN 01            09:33:42.000
STATION 01 OUT    09:35:56.000
RUN 02            09:39:47.000
FINISH            10:26:38.000
```

Gerar:

```text
RUN 01            03:42
STATION 01         02:14
RUN 02             03:51
...
TOTAL              56:38
```

O cálculo deve utilizar timestamps absolutos como fonte da verdade.

---

# 12. Leaderboard Live

O leaderboard deve considerar:

1. atleta finalizado;
2. quantidade de checkpoints concluídos;
3. último checkpoint;
4. timestamp da última passagem;
5. regras específicas da competição.

Exemplo:

| Pos. | Atleta | Progresso | Local atual | Tempo |
|---|---|---|---|---|
| 1 | Atleta A | 12/16 | Farmers Carry | 42:18 |
| 2 | Atleta B | 12/16 | Farmers Carry | 42:41 |
| 3 | Atleta C | 11/16 | Burpee Broad Jump | 43:02 |

Enquanto ninguém tiver terminado, o progresso pode determinar a posição provisória.

Depois da chegada:

```text
FINISH timestamp - START timestamp
```

passa a determinar a classificação final.

---

# 13. Atualização realtime

Após uma leitura válida:

```text
TimingReading
↓
AthleteSplit
↓
Leaderboard
↓
Realtime Event
```

Tecnologias possíveis:

```text
WebSocket
Socket.IO
Server-Sent Events
Supabase Realtime
Firebase
Pusher
Ably
```

A IA deve verificar o stack atual e reutilizar a solução já existente.

Evento sugerido:

```json
{
  "type": "timing.split.updated",
  "event_id": "evt_823",
  "athlete_id": "ath_381",
  "timing_point": "RUN_04",
  "elapsed_time_ms": 1842134,
  "position": 2
}
```

Outro evento:

```json
{
  "type": "leaderboard.updated",
  "event_id": "evt_823"
}
```

---

# 14. Dashboard de cronometragem

Criar no painel do organizador uma área:

```text
Evento
→ Cronometragem
```

Exemplo:

```text
CRONOMETRAGEM

STATUS DO SISTEMA
● ONLINE

LEITORES

START               ● Online
RUN 01              ● Online
STATION 01           ● Online
RUN 02              ● Online
FINISH               ● Online
```

Cada reader deve possuir:

```text
status
last_seen
última leitura
total de leituras
erro atual
```

---

# 15. Últimas leituras

Adicionar stream operacional.

Exemplo:

```text
09:41:31.221
Chip A98342
Atleta #128
STATION 03 EXIT
✓ Processado

09:41:32.018
Chip B27391
Atleta #041
RUN 04
✓ Processado
```

Estados:

```text
PROCESSED
DUPLICATE
UNKNOWN_CHIP
UNKNOWN_READER
OUT_OF_SEQUENCE
INVALID_TIMESTAMP
REJECTED
MANUAL_REVIEW
```

---

# 16. Operações manuais

A organização precisa conseguir corrigir problemas.

Adicionar:

```text
Adicionar passagem
Editar passagem
Invalidar passagem
Reprocessar leitura
Associar chip desconhecido
Trocar chip do atleta
Adicionar tempo manual
Corrigir timestamp
Mover passagem para outro timing point
```

Toda alteração deve gerar audit log.

---

# 17. Chip desconhecido

Quando chegar:

```json
{
  "chip_id": "XYZ9281"
}
```

e não existir associação:

```text
status = UNKNOWN_CHIP
```

Exibir no painel:

```text
CHIPS NÃO IDENTIFICADOS

XYZ9281
Última leitura: RUN_03
09:52:18

[Associar atleta]
```

Após associação:

```text
Reprocessar leituras anteriores
```

---

# 18. Monitoramento dos leitores

Criar heartbeat quando o provider permitir.

Caso não permita, utilizar última leitura ou último evento recebido.

Estados:

```text
ONLINE
DEGRADED
OFFLINE
UNKNOWN
```

Exemplo:

```text
ONLINE
último contato < 30s

DEGRADED
30s–120s

OFFLINE
> 120s
```

Valores devem ser configuráveis.

---

# 19. Segurança da API

Nunca deixar endpoint público sem autenticação.

Opções:

```text
API Key
HMAC Signature
JWT provider
Mutual TLS
IP Allowlist
```

Sugestão simples:

Headers:

```http
X-WodArena-Key
X-WodArena-Signature
X-WodArena-Timestamp
```

Payload assinado via HMAC.

Também implementar proteção contra replay.

Exemplo:

```text
timestamp máximo de 5 minutos
+
request_id / sequence
```

---

# 20. Endpoint sugerido

## Ingestão unitária

```http
POST /api/v1/timing/read
```

---

## Ingestão em lote

Alguns sistemas enviam várias leituras.

Criar também:

```http
POST /api/v1/timing/read/batch
```

Exemplo:

```json
{
  "event_id": "evt_823",
  "provider": "provider_x",
  "readings": [
    {
      "reader_id": "reader_01",
      "chip_id": "A98342",
      "timestamp": "2026-11-14T09:47:21.783-03:00"
    },
    {
      "reader_id": "reader_01",
      "chip_id": "B27391",
      "timestamp": "2026-11-14T09:47:22.104-03:00"
    }
  ]
}
```

---

# 21. Provider Adapter Interface

Criar interface interna equivalente a:

```ts
interface TimingProviderAdapter {
  validateRequest(request: Request): Promise<boolean>;

  parsePayload(payload: unknown): Promise<NormalizedTimingReading[]>;

  normalizeTimestamp(timestamp: unknown): Date;

  getExternalReaderId(payload: unknown): string;

  getChipId(payload: unknown): string;
}
```

Formato normalizado:

```ts
interface NormalizedTimingReading {
  provider: string;
  externalReaderId: string;
  chipId: string;
  timestamp: string;
  sequence?: number;
  metadata?: Record<string, unknown>;
}
```

---

# 22. Generic HTTP Adapter

O primeiro adapter deve ser genérico.

Permitir que o gestor configure mapeamento.

Exemplo:

Provider envia:

```json
{
  "tag": "A98342",
  "antenna": "5",
  "time": "2026-11-14 09:42:13.384"
}
```

Configuração:

```json
{
  "chip_field": "tag",
  "reader_field": "antenna",
  "timestamp_field": "time"
}
```

WodArena converte para:

```json
{
  "chip_id": "A98342",
  "reader_id": "5",
  "timestamp": "2026-11-14T09:42:13.384-03:00"
}
```

Isso pode reduzir muito o trabalho de integrações futuras.

---

# 23. TCP Gateway

Alguns equipamentos podem enviar leituras via TCP socket em vez de HTTP.

Nesse caso criar serviço separado:

```text
Timing Gateway
```

Fluxo:

```text
Reader
↓ TCP
WodArena Timing Gateway
↓ HTTP/internal queue
Timing API
```

Não misturar listener TCP com frontend.

---

# 24. Offline / internet instável

Evento esportivo precisa continuar funcionando mesmo com internet ruim.

Se possível, o Timing Gateway local deve possuir buffer.

Fluxo:

```text
placa
↓
gateway local
↓
buffer
↓
internet indisponível
↓
guardar eventos
↓
internet retorna
↓
sincronizar
```

Cada evento deve possuir:

```text
sequence
timestamp
unique_id
```

para evitar duplicação.

---

# 25. Prioridade de timestamps

Nunca utilizar somente:

```text
created_at do servidor WodArena
```

como tempo da prova.

Prioridade:

```text
1. timestamp do decoder
2. timestamp do software oficial
3. timestamp do gateway
4. timestamp do servidor WodArena
```

Registrar todos quando possível.

---

# 26. Precisão

Utilizar precisão de milissegundos.

Exemplo:

```text
2026-11-14T09:47:21.783-03:00
```

No banco:

```text
timestamp with timezone
```

ou equivalente.

---

# 27. Timezone

Normalizar internamente em UTC.

Exemplo recebido:

```text
2026-11-14T09:47:21.783-03:00
```

armazenar:

```text
2026-11-14T12:47:21.783Z
```

A interface pode exibir no timezone do evento.

---

# 28. Auditoria

Criar:

```text
TimingAuditLog
```

Registrar:

```text
quem
ação
registro anterior
registro novo
motivo
timestamp
```

Exemplo:

```text
Admin X alterou passagem
Atleta #128
RUN_04

Original:
09:47:21.783

Novo:
09:47:19.245

Motivo:
correção oficial da cronometragem
```

---

# 29. Logs técnicos

Não confundir audit log com logs técnicos.

Registrar:

```text
provider connection
payload inválido
auth failure
reader desconhecido
chip desconhecido
queue failure
processing delay
websocket failure
```

---

# 30. Métricas

Idealmente expor:

```text
readings_received_total
readings_processed_total
readings_duplicate_total
unknown_chip_total
processing_latency_ms
provider_errors_total
reader_last_seen
```

---

# 31. Performance

Não recalcular todo o leaderboard do evento a cada leitura se não for necessário.

Preferir:

```text
atualizar atleta
↓
recalcular posição impactada
↓
cache leaderboard
```

Para MVP, recalcular o leaderboard completo pode ser aceitável dependendo da escala.

A IA deve verificar:

```text
número máximo esperado de atletas
número de timing points
leituras por segundo
```

antes de otimizar prematuramente.

---

# 32. Exemplo de fluxo completo

Atleta:

```text
#128
Chip A98342
```

Passa pelo reader:

```text
reader_04
```

Reader está associado:

```text
reader_04
→ STATION_03_OUT
```

Provider envia:

```json
{
  "tag": "A98342",
  "reader": "04",
  "time": "2026-11-14T09:47:21.783-03:00"
}
```

Adapter transforma:

```json
{
  "provider": "provider_x",
  "externalReaderId": "04",
  "chipId": "A98342",
  "timestamp": "2026-11-14T09:47:21.783-03:00"
}
```

Timing Engine:

```text
chip A98342
↓
athlete ath_381
↓
timing point STATION_03_OUT
↓
validar
↓
criar split
↓
atualizar progresso
↓
atualizar leaderboard
```

Frontend recebe:

```json
{
  "type": "timing.split.updated",
  "athlete_id": "ath_381",
  "timing_point": "STATION_03_OUT"
}
```

Leaderboard atualiza automaticamente.

---

# 33. Painel de configuração do evento

Adicionar:

```text
Configurações
→ Cronometragem
```

Fluxo:

```text
Selecionar provider
↓
Cadastrar conexão
↓
Cadastrar readers
↓
Associar reader → timing point
↓
Importar chips
↓
Testar conexão
↓
Ativar Live Timing
```

---

# 34. Modo de teste

Antes do evento, permitir:

```text
TEST MODE
```

Botão:

```text
Simular leitura
```

Campos:

```text
chip
reader
timestamp
```

Isso deve gerar leitura real no pipeline, marcada como:

```text
is_test = true
```

Não contaminar resultados oficiais.

---

# 35. Tela operacional ideal

```text
LIVE TIMING
─────────────────────────────

Provider: Empresa X
Status: ● ONLINE

LEITORES

START               ●
RUN 01              ●
STATION 01           ●
RUN 02              ●
FINISH               ●

─────────────────────────────

LEITURAS / SEG

28

ATRASO MÉDIO

84ms

CHIPS DESCONHECIDOS

2

ERROS

0
```

---

# 36. MVP recomendado

Não implementar tudo de uma vez.

## Fase 1

Implementar:

```text
TimingProvider
TimingReader
TimingPoint
Athlete ↔ chip
TimingReading
AthleteSplit
Generic HTTP endpoint
duplicate detection
leaderboard update
realtime
painel de últimas leituras
```

---

## Fase 2

Adicionar:

```text
correção manual
unknown chips
reader monitoring
audit logs
batch ingestion
reprocessing
```

---

## Fase 3

Adicionar:

```text
TCP Gateway
offline buffering
provider adapters específicos
monitoramento avançado
métricas
alertas
```

---

# 37. Não implementar de forma acoplada

EVITAR:

```text
if provider == race_result
  regra da competição aqui
```

A regra deve estar separada.

Correto:

```text
Provider Adapter
↓
Normalized Reading
↓
Timing Engine
```

O Timing Engine não deve saber qual fabricante originou a leitura.

---

# 38. Perguntas que devem ser feitas à empresa de cronometragem

Antes de desenvolver um adapter específico, solicitar:

```text
1. Marca do equipamento
2. Modelo dos readers/decoders
3. Nome do software utilizado
4. Protocolo de comunicação
5. API REST disponível?
6. Webhook disponível?
7. TCP socket disponível?
8. Existe SDK?
9. Documentação técnica
10. Exemplo de payload
11. Precisão do timestamp
12. Timezone
13. Identificação do reader
14. Identificação do chip
15. Forma de autenticação
16. Possibilidade de ambiente de testes
17. Limite de requisições
18. Funcionamento offline
```

Mensagem sugerida:

> Precisamos integrar o sistema de cronometragem ao WodArena. Precisamos receber em tempo real as leituras dos chips/transponders realizadas pelas antenas. Favor informar se o sistema disponibiliza API REST, Webhook HTTP/HTTPS, TCP Socket, SDK ou outro protocolo de integração. Também precisamos da documentação técnica e de um exemplo do payload contendo, no mínimo, ID do chip, timestamp da leitura e identificação da antena/ponto de cronometragem.

Perguntar também:

> Qual é a marca e o modelo dos leitores/decoders e qual software vocês utilizam para controlar a cronometragem?

---

# 39. Instrução para a IA responsável pela implementação

Antes de escrever código:

1. analisar completamente a arquitetura atual do WodArena;
2. identificar stack backend;
3. identificar ORM;
4. identificar banco de dados;
5. identificar autenticação;
6. identificar solução realtime já existente;
7. identificar models de atletas;
8. identificar models de eventos;
9. identificar leaderboard atual;
10. identificar módulo Fitness Race existente.

Não criar sistemas paralelos se já houver estruturas equivalentes.

---

# 40. Princípio de adaptação

A IA deve adaptar este documento ao código existente.

NÃO assumir:

```text
Node
NestJS
Express
Laravel
Supabase
PostgreSQL
Prisma
Firebase
```

sem verificar.

Primeiro inspecionar o projeto.

Depois apresentar:

```text
AS-IS
arquitetura atual

TO-BE
arquitetura proposta

DELTA
mudanças necessárias
```

---

# 41. Entrega esperada da IA

Antes da implementação, produzir uma especificação contendo:

## Arquitetura

```text
component diagram
data flow
```

## Banco

```text
models novos
models alterados
migrations
indexes
constraints
```

## API

```text
endpoints
schemas
auth
responses
errors
```

## Processing Engine

```text
duplicate rules
ordering
split calculation
finish calculation
reprocessing
```

## Realtime

```text
events
payloads
subscriptions
```

## Frontend

```text
admin timing dashboard
leaderboard live
athlete splits
reader status
manual corrections
```

## Testes

```text
unit
integration
load
offline
duplicate
out-of-order
unknown chip
reader failure
```

---

# 42. Critérios de aceite mínimos

A integração está funcional quando:

- [ ] um chip pode ser associado a um atleta;
- [ ] uma leitura externa pode entrar via API;
- [ ] o reader é convertido para timing point;
- [ ] o atleta é localizado pelo chip;
- [ ] a leitura é armazenada;
- [ ] duplicidades não geram splits extras;
- [ ] um split é criado;
- [ ] o tempo decorrido é calculado;
- [ ] o leaderboard é atualizado;
- [ ] o frontend recebe atualização realtime;
- [ ] chips desconhecidos são identificados;
- [ ] leituras inválidas ficam disponíveis para auditoria;
- [ ] um administrador pode corrigir uma passagem;
- [ ] o sistema mantém histórico das correções.

---

# 43. Requisito crítico

O sistema de timing deve ser tratado como uma infraestrutura crítica durante a competição.

Priorizar:

```text
confiabilidade
auditabilidade
idempotência
recuperação
observabilidade
```

acima de complexidade visual.

Uma leitura nunca deve simplesmente desaparecer.

Mesmo uma leitura rejeitada deve poder ser encontrada posteriormente nos logs.

---

# 44. Resultado esperado

Com essa arquitetura, o WodArena deve conseguir operar:

```text
Fitness Race
Corridas
Eventos híbridos
Triathlon-style checkpoints
Eventos com voltas
Qualquer competição baseada em chips e checkpoints
```

sem depender estruturalmente de uma única empresa de cronometragem.

Arquitetura final desejada:

```text
               ┌──────────────────────┐
               │ Provider A Adapter   │
               ├──────────────────────┤
Readers ──────▶│ Provider B Adapter   │
               ├──────────────────────┤
               │ Generic HTTP Adapter│
               ├──────────────────────┤
               │ TCP Gateway          │
               └──────────┬───────────┘
                          │
                          ▼
                ┌─────────────────────┐
                │ WodArena Timing API │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │    Timing Engine    │
                └──────────┬──────────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          Splits       Leaderboard     Audit
             │             │
             └──────┬──────┘
                    ▼
                Realtime
                    │
                    ▼
             WodArena Frontend
```

---

# Próximo passo

Quando a marca/modelo do sistema de cronometragem estiver definido, complementar esta especificação com:

```text
PROVIDER IMPLEMENTATION SPEC
```

contendo:

- protocolo exato;
- autenticação;
- payload real;
- mapeamento de campos;
- mecanismo de conexão;
- tratamento de reconnect;
- exemplos reais;
- adapter específico;
- testes de integração com hardware.
