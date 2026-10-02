*Resoluções e validações inicais:*


## Comando para testes HTTP: npm test -- --runInBand src/common/validation.spec.ts

## Primeiro problema encontrado ao realizar testes unitários via terminal.

## Primeira validações:

em "create-agent.dto.ts" permitia a criação de agentes com nomes e prompts contendo apenas espaços, com limite negativo, e números acima da capacidade da coluna integer do PostgreSQL.

**create-agent.dto.ts**

- @Trim(), @IsNotEmpty(): Para não permitir nome e prompt contendo apenas espaços e @MaxLength(500) para limitar tamanho de descrição (Padronizar tamanho para evitar poluição visual e quebras visuais)

- @min() e @max(): @min() evita colocar valores negativos e @max() elabora um valor máximo para não ficar com números absurdos.

**create-execution.dto.ts:**

- @Matches(/\S/): Exige algum caractere que não seja espaço.

**Get-agent-usage-query.dto.ts:**

- @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must use YYYY-MM with a month between 01 and 12' }): Agora ele exige exatamente um mes entre 1 e 12. Quando omitido, continua usando o mes atual em UTC.


## Segunda validações:

**executions.service.ts:**

`active: false` permitia executar agentes inativos

*Solução:*

- Foi implementado uma consulta para verificar o estado dos agente antes de fazer a execução.

- Se o agente já estiver inativo ao receber a requisição, a API retorna `409` sem criar nem enfileirar a execução (`src/modules/executions/executions.service.ts`, método `create`). Se a execução já tiver sido enfileirada e o agente estiver inativo quando o worker verificar seu estado no processamento, o worker registra `FAILED` com o motivo e não cobra tokens (`src/modules/executions/executions.consumer.ts`).

- Também exige uma mensagem JSON contendo um objeto com executionId UUID válido para validação no worker (evita enviar mensagens inválidas, reenvio para as filas e gerar logs repetitivos)

## Terceira validações:

**create-execution.dto.ts:**

- Introduzi @ApiProperty ao campo input, pois na hora que iamos pro schema, o schema não vinha padronizado o valor que esperava, tendo que ser feito manualmente e gastando um pouco mais de tempo.

- Limites de caracteres de 1 a 10.000.

- Regra para exigir texto além de espaço (evita enviar um input vazio)
- Rejeita caractéres nulos no input

**executions.controller.ts:**

- Adicionei descrições sobre o que significa cada código: 201, 400, 409, 404, 429 e 503. (Fiz isso porquê deixa visualmente melhor caso não souber de cabeça o porquê do erro)


**executions.consumer.ts**

Anteriormente, foi identificado que uma mensagem repetida (mesmo ID) podia processar e cobrar a mesma execução novamente.

*Solução:*

- Agora valida o custo total, verificação de estado e retomada de PROCESSING, transação com bloqueios e uso das configurações. 

**create-agent.dto.ts**

- Agora também rejeita caractere nulo em `name`, `description` e `systemPrompt`. As regras também são herdadas pelo DTO de atualização para evitar refazer do zero.

**env.ts**

- Validação estrita de inteiro e das faixas de portas, prefetch e atraso

**executions.controller.ts**

- Documentação no swagger de que o worker pode recusar o custo total após o enfileiramento.

**POST /agents/{agentId}/executions**

A API já verificava o saldo mensal antes de enfileirar, mas considerava apenas os tokens de entrada. Faltava verificar o custo total de entrada + saída simulada; por isso, uma execução podia receber `201` e depois ser marcada como `FAILED` pelo worker por saldo insuficiente.

*Solução:*

- Em `src/modules/executions/executions.service.ts`, método `create`, a API agora soma os tokens de entrada e de saída simulada e verifica esse custo total contra o saldo mensal antes de criar ou enfileirar a execução.

- Se o saldo for insuficiente, `POST /agents/{agentId}/executions` retorna `429` e informa `monthlyTokenLimit`, `tokensUsed` e `requiredTokens`.

- O `201` confirma que a execução passou pela validação e foi enfileirada, mas não reserva tokens. Em `src/modules/executions/executions.consumer.ts`, o worker verifica novamente o custo total contra o consumo atualizado; se o saldo estiver insuficiente, registra `FAILED` sem cobrar tokens. Quando concluída, a execução consultada por `GET /executions/{id}` informa os tokens de entrada, saída e total.

## Erro crítico:

**Rabbit**

Era permitido criar e logar com usuários que continham somente espaços vazios no login e senha.

*Soluções:*

`rabbitmq/20-credentials.conf` - Configura o validador personalizado implementado em Erlang.

`rabbitmq/spotmetrics_credential_validator.erl` - Valida o username e password contra espaços.

`docker-compose.yml` - Carrega o módulo na inicialização, que no caso é o arquivo `rabbitmq/spotmetrics_credential_validator.erl`

## Riscos observados

**Problema com Reenvios sem liimite de tentativa**

- Observado um comportamento de risco, quando uma fila falhava, ela dava erro e continuava tentando sem limites, podendo gerar uma quebra.

*Solução:* Agora os erros técnicos tem 3 tentativas no totais, com 1 segundo entre os reenvios. Caso atinja o limite de 3, a mensagem é enviada para a fila de falhas `agent-executions.failed`, com o ID e a quantidade de tentativas com o último erro nos headers. 

**Publicação sem confirmação do Rabbit** 

- Uma publicação era enviada sem confirmação e validação do Rabbit

*Solução:* Agora utilizamos um canal de confirmação do broker, mensagens persistentes e verificação de roteamento. A API aguarda essa confirmação antes do 201 e irá limitar a espera por 5 segundos por padrão. Se falhar, retorna 503 com o ID da execução.

## Implementações:


Foi implementado na rota `GET /agents`, tokensUsedThisMonth, tokensRemainingThisMonth e tokensUsedToday.

Motivo: Para uma consulta, Incluí consumo mensal, saldo e consumo diário para permitir acompanhar a utilização do agente em uma única consulta. E ter um melhor controle na usabilidade
.
- A rota `/agents/{id}/usage` fica somente para consulta de mes

`PATCH /agents/:id` - Atualiza parcialmente um agente (Name, description, SystemPrompt, active, monthlyTokenLimit)
`DELETE /agents/:id` - Desativa um agente
`GET /agents/:id/executions` - Paginação, filtro por status e ordenação
`GET /agents/:id/metrics` - Totais de execuções (execuções concluídas, falhadas), tokens (total gasto de token e utilização de token por execução)
`POST /agents/{agentId}/executions` - Enfileira uma execução para um agente ativo 

- Em uma visão administrativa acho a rota `DELETE /agents/:id` redundante, já que o administrador pode desativar e ativar usando a rota PATCH. Já na visão do cliente, onde ele só poderá mexer em campos específicos, acho interessante ela existir, para que o cliente tenha apenas a opção de fazer um soft delete de um agente que já pertence a ele.

`env.spec.ts` - Testes de valores padrão, valores malformados e limites das configurações.

`main.ts` - Registro de um novo pipe global e leitura da porta pela configuração validada.

`request-validation.pipe.ts`- - Validação do formato do Body antes de transformar e validar os DTO's

`executions.consumer.spec.ts` - Implementado testes de saldos insuficientes, saldo exato, entrega duplicada, estados terminais e retomada e criação do consumo mensal.

`executions.consumer.integration.spec.ts`- Adicionado testes no PostgreSQL real para duplicidade simultânea, disputa de saldo e reversão da cobrança quando a conclusão falha

`rabbitmq/20-credentials.conf` - Configura o validador personalizado em Erlang (Tecnologia do RabbitMQ)

`spotmetrics_credential_validator.erl`- Valida o username e password contra espaços.

`rabbitmq.service.spec.ts` - Implementado testes uniitários de confirmações, rejeição, mensagens sem destinos, timeout (Após atingir um tempo de resposta), confirmações atrasadas, publicações simultânes, fechamento do canal e limpeza dos temporizadores.

`rabbitmq.integration.spec.ts` -  Testes reais para publicação persistente, mensagens sem destino, recuperação na segunda tentativa e encaminhamento à fila de falhas após três tentativas.

## Validação no banco de dados

DTOs ja validava regra de negócios (tokens negativos, limite mensal fora de 1 a 100.000.000, status diferentes e mes fora do esperado), mas, gravações diretas no banco de dados permitia todos esses problemas.

*Solução:* Foi adicionado validações por `CHECK`, no qual foi feito um migration.

*Testes:* Testes feito pelo `DBeanver`

**"Problema" não solucionados e possivel melhoria**

- O projeto apesar de usar a API do Rabbit e o usuário Guest, ele não salva novos usuários em nosso banco de dados, não corrigi por não ser um projeto pronto e grande. Em um cenário como a SpotMetrics, poderia ser interessante caso a gente queira traçar vínculo com uma empresa e histórico de aprovações dessa mensageria.

## Teste finais e validações feito pelo Swagger e Banco

*Criar agente* - `POST /agents`
`{`
  "id": "ce7625b0-3427-4534-88f0-38761feb0970",
  "name": "bot-teste-final",
  "description": "Responde dúvidas de clientes",
  "systemPrompt": "Você é um assistente de suporte cordial.",
  "active": true,
  "monthlyTokenLimit": 100,
  "createdAt": "2026-10-02T12:44:03.639Z",
  "updatedAt": "2026-10-02T12:44:03.639Z"
`}`

*Execution* - `POST /agents/{agentId}/executions`
`{`
  "id": "d2b0c265-415b-433a-b58f-fe9919c6dee3",
  "agentId": "ce7625b0-3427-4534-88f0-38761feb0970",
  "input": "Resuma o arquivo NOTES.md",
  "output": null,
  "status": "PENDING",
  "error": null,
  "inputTokens": 4,
  "outputTokens": 0,
  "totalTokens": 0,
  "createdAt": "2026-10-02T14:07:20.515Z",
  "startedAt": null,
  "completedAt": null
`}`

*Atualizar* - `PATCH /agents/{id}`
`{`
  "id": "ce7625b0-3427-4534-88f0-38761feb0970",
  "name": "bot teste-final",
  "description": "Responde dúvidas de clientes",
  "systemPrompt": "Você é um assistente de suporte cordial.",
  "active": true,
  "monthlyTokenLimit": 200,
  "createdAt": "2026-10-02T12:44:03.639Z",
  "updatedAt": "2026-10-02T14:08:32.582Z"
`}`


*Execution* - `POST /agents/{agentId}/executions`
`{`
  "id": "42807beb-5484-4e21-91a9-d9b2baf43305",
  "agentId": "ce7625b0-3427-4534-88f0-38761feb0970",
  "input": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque odio velit, sodales vitae eleifend quis, molestie non arcu. Nulla venenatis porttitor quam, eu faucibus lectus semper viverra. Phasellus at viverra metus. Nullam pharetra, dui quis condimentum tempor, ex mauris interdum eros, vel pretium erat sapien a risus. Suspendisse potenti. Sed ligula magna, mattis vitae libero et, imperdiet blandit urna. Ut feugiat est eu sem rhoncus tempus. Sed a lobortis magna. Phasellus vestibulum vehicula nunc, lobortis finibus erat efficitur in. Donec placerat magna id maximus vehicula. Vestibulum imperdiet, urna viverra tempor ultrices, lorem diam gravida magna, sit amet tristique nunc mi vitae augue. Donec tincidunt sollicitudin massa. Nullam feugiat aliquam quam quis consectetur. Proin malesuada aliquam sodales. Sed scelerisque euismod libero et efficitur.Suspendisse non rutrum nisl. Praesent enim tortor, fermentum sed nisi eu, volutpat posuere tortor. Nullam sollicitudin scelerisque lacus, sed faucibus libero. Interdum et malesuada fames ac ante ipsum primis in faucibus. Integer iaculis elementum aliquam. Pellentesque accumsan metus eget nulla consequat efficitur. Suspendisse tincidunt euismod nisi at porta.",
  "output": null,
  "status": "PENDING",
  "error": null,
  "inputTokens": 169,
  "outputTokens": 0,
  "totalTokens": 0,
  "createdAt": "2026-10-02T14:11:17.743Z",
  "startedAt": null,
  "completedAt": null
`}`


*Desativar* - `DELETE /agents/{id}`

`HTTP: 204` - Retorna corpo vazio

 connection: keep-alive 
 date: Fri,02 Oct 2026 14:11:56 GMT 
 keep-alive: timeout=5 
 x-powered-by: Express 


*Execution* - `POST /agents/{agentId}/executions`
`{`
  "message": "Agent ce7625b0-3427-4534-88f0-38761feb0970 is inactive",
  "error": "Conflict",
  "statusCode": 409
`}`

*Worker Stop* - `docker compose stop worker`
parado..

*ativar agente*
 connection: keep-alive 
 date: Fri,02 Oct 2026 14:14:14 GMT 
 keep-alive: timeout=5 
 x-powered-by: Express

*Execution*  - `POST /agents/{agentId}/executions`
`{`
  "message": "Agent ce7625b0-3427-4534-88f0-38761feb0970 is inactive",
  "error": "Conflict",
  "statusCode": 409
`}`

*Worker Start* - `docker compose start worker`
Mesmo com o work parado, continua sendo enviado pra mim se o bot executou ou não uma tarefa.

*Inserir no diretamente no banco*

`violates check constraint "chk_agents_monthly_token_limit"` - Validação no qual não permite colocar valor negativo diretamente no banco.

`violates foreign key constraint "fk_agent_executions_agent" on table "agent_executions"` - O banco rejeitou uma alteração que violaria o relacionamento entre agente e execução, impedindo que uma execução ficasse associada a um agente inexistente.






