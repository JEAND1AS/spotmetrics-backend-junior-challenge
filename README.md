# Desafio Técnico — Backend Júnior · SpotMetrics

Olá! 👋

Que bom ter você aqui. Este repositório é a etapa técnica do nosso processo seletivo para **Desenvolvedor(a) Backend Júnior** na SpotMetrics. Antes de qualquer coisa: parabéns por ter chegado até aqui, e obrigado pelo tempo que você vai dedicar a isso.

Queremos que esta etapa seja o mais próxima possível do que é trabalhar com a gente no dia a dia. Por isso, em vez de pedir para você construir algo do zero, vamos te entregar um projeto que **já existe e já funciona** — e pedir que você faça o que faria na sua primeira semana de time: rodar, entender, encontrar o que pode melhorar e melhorar.

Não existe pegadinha. Existe um sistema real, com decisões reais, e a gente quer ver como você pensa.

---

## O que é este projeto

Uma API para gerenciar **agentes de IA** e executar tarefas com eles de forma assíncrona.

- Você cadastra um agente (nome, prompt de sistema, limite mensal de tokens).
- Você envia uma tarefa para o agente (`input`). A API responde na hora e coloca a execução numa fila.
- Um **worker** consome a fila, "processa" a tarefa (não há LLM real — o processamento é simulado) e registra o resultado.
- Cada agente tem um **limite mensal de tokens**, e o sistema controla o consumo.

**Stack:** Node.js 20 · TypeScript · NestJS 11 · PostgreSQL 16 (TypeORM) · RabbitMQ · Docker Compose.

Se você nunca usou alguma dessas ferramentas, tudo bem — o projeto sobe com um comando e o código foi escrito para ser lido.

---

## O que esperamos de você

O desafio tem duas frentes, e as duas contam:

### 1. Evoluir o sistema

O projeto entrega o básico (criar/listar agentes, disparar e consultar execuções). Queremos que você complete o que falta:

| Item | O que precisa existir |
| --- | --- |
| **CRUD de agentes** | Atualizar (`PATCH /agents/:id`) e excluir/desativar (`DELETE /agents/:id`) um agente. Revise também as validações dos DTOs — há regras importantes que ainda não são checadas. |
| **Histórico de execuções** | `GET /agents/:id/executions` com **paginação**, **filtro por status** e **ordenação por data de criação**. |
| **Métricas do agente** | `GET /agents/:id/metrics` retornando: total de execuções, concluídas, falhas, total de tokens consumidos e média de tokens por execução. |
| **Limite mensal de tokens** | Garanta que funciona no caso comum: agente que já consumiu o limite do mês não recebe novas execuções (recusa ou marca como `FAILED` com erro descritivo). Não precisa tratar execuções simultâneas. |
| **Testes** | Testes para o que você criar e para pelo menos um cenário de erro. Já existem alguns `*.spec.ts` no projeto para servir de referência. |
| **Swagger** | O Swagger já está montado em `/docs`. Documente os endpoints novos e complete os existentes que estiverem incompletos. |

### 2. Investigar o que já existe

O projeto funciona, mas **tem alguns problemas**. Alguns são bugs de fato; outros são comportamentos que, em produção, dariam dor de cabeça. Não vamos dizer quantos são nem onde estão — essa é a parte do desafio.

- **Rode o projeto** e explore a API. Crie agentes, dispare execuções, veja o worker trabalhar, olhe o banco, olhe a fila.
- **Leia o código com senso crítico.** Pergunte-se: "o que acontece se…?". Teste suas hipóteses.
- **Registre o que encontrar** no `NOTES.md` — inclusive o que você identificou mas decidiu não corrigir. **Descrever bem um problema sem corrigir tem valor.** Esse relatório é parte central da avaliação.

### Alinhando expectativas

Seja transparente com a gente e consigo mesmo(a) sobre o que entendeu e o que não entendeu:

- **Tempo:** estimamos entre **3 e 5 dias** de dedicação parcial. Se passar disso, entregue o que tiver. Preferimos uma entrega honesta e parcial a uma entrega "completa" que você não consegue explicar.
- **Não esperamos perfeição.** Esperamos que você chegue a conclusões sobre o sistema e consiga defendê-las.
- **Código limpo e pequeno > código muito.** Siga a estrutura que já existe no projeto.
- **Pode usar IA, Google, documentação, o que quiser.** Só garanta que você entende cada linha do que entregar — na entrevista vamos conversar sobre as suas decisões.
- **Não quebre o que funciona.** Rode os testes antes de entregar.

### O que **não** é o desafio

- Não precisa adicionar autenticação, CI, observabilidade ou trocar o processamento simulado por um LLM real.
- Não precisa reescrever a arquitetura. Trabalhe com o que está aí.

---

## Entrega

Faça um **fork** deste repositório (ou clone e suba num repositório seu) e nos envie o link. No repositório, queremos encontrar:

1. **Seu código**, com commits pequenos e mensagens claras. Dá para acompanhar o seu raciocínio pelo histórico.
2. **Um arquivo `NOTES.md`** na raiz, escrito com suas palavras, contendo:
   - Decisões técnicas que você tomou e por quê.
   - Problemas ou riscos que identificou no código existente — **mesmo os que não corrigiu**.
   - Como resolveria cada um deles se tivesse mais tempo.
   - Qualquer dúvida ou decisão que você gostaria de discutir na entrevista.
3. **Testes** para o que você implementou.

Prazo: combinamos por e-mail. Se precisar de mais tempo, avise — não é problema.

---

## Como rodar

### Com Docker (recomendado)

```bash
cp .env.example .env
docker compose up --build
```

- API: `http://localhost:3000`
- RabbitMQ Management: `http://localhost:15672` (usuário `guest`, senha `guest`)
- O serviço `api` roda migrations e seed automaticamente. O serviço `worker` consome a fila.

Se as portas `5432`, `5672` ou `15672` já estiverem ocupadas na sua máquina:

```bash
POSTGRES_HOST_PORT=5433 RABBITMQ_HOST_PORT=5673 RABBITMQ_MGMT_HOST_PORT=15673 docker compose up --build
```

### Sem Docker

Você precisa de Postgres e RabbitMQ rodando localmente e configurados no `.env`.

```bash
npm install
npm run migration:run && npm run seed
npm run start:dev            # API
npm run start:worker:dev     # worker, em outro terminal
npm test
```

### Verificando

```bash
curl localhost:3000/health
# {"status":"ok","database":"up","rabbitmq":"up"}
```

O seed cria dois agentes de exemplo. Liste com `GET /agents`.

---

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/agents` | Cria agente |
| GET | `/agents` | Lista agentes |
| GET | `/agents/:id` | Detalha agente |
| GET | `/agents/:id/usage?month=YYYY-MM` | Consumo de tokens do agente no mês |
| POST | `/agents/:id/executions` | Enfileira execução — body `{ "input": "..." }` |
| GET | `/executions/:id` | Detalha execução |
| GET | `/health` | Estado de Postgres e RabbitMQ |
| GET | `/docs` | Swagger |

### Exemplo rápido

```bash
# criar um agente
curl -s -X POST localhost:3000/agents \
  -H 'content-type: application/json' \
  -d '{"name":"Assistente","systemPrompt":"Você é um assistente útil.","monthlyTokenLimit":10000}'

# disparar uma execução (use o id retornado acima)
curl -s -X POST localhost:3000/agents/<AGENT_ID>/executions \
  -H 'content-type: application/json' \
  -d '{"input":"Resuma o relatório de vendas do trimestre"}'

# acompanhar
curl -s localhost:3000/executions/<EXECUTION_ID>
curl -s localhost:3000/agents/<AGENT_ID>/usage
```

---

## Fluxo de uma execução

1. `POST /agents/:id/executions` valida a requisição e verifica o limite mensal do agente.
2. A execução é salva com status `PENDING` e uma mensagem `{ executionId }` é publicada na fila `agent-executions`.
3. O worker consome a mensagem, muda o status para `PROCESSING`, simula o processamento (`PROCESSING_DELAY_MS`, padrão 2s), gera um output e finaliza como `COMPLETED` (ou `FAILED`).
4. O consumo mensal do agente é atualizado.

Status possíveis: `PENDING → PROCESSING → COMPLETED | FAILED`.

> **Tokens** são contados como palavras (`src/modules/executions/tokens.ts`). É uma simplificação intencional — não faz parte do desafio trocar por um tokenizador real.

---

## Estrutura do projeto

```
src/
  common/rabbitmq/      conexão com retry, publish, channel
  database/             data-source, migrations, seed
  modules/agents/       entity, dto, service, controller, uso mensal
  modules/executions/   entity, dto, service (API), consumer (worker), tokens
  modules/health/
  main.ts               entrada da API
  worker.ts             entrada do worker
```

Os testes existentes (Jest) ficam ao lado do código, em arquivos `*.spec.ts` dentro de `src/`. Rode com `npm test`.

Variáveis de ambiente estão documentadas em `.env.example`.

---

## Dúvidas

Se algo não estiver claro — do enunciado, do projeto ou do processo — nos escreva. Perguntar é parte do trabalho, não um demérito.

Boa sorte, e divirta-se. 🚀

**Time de Engenharia · SpotMetrics**
