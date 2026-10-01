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

- active: false permitia executar agentes inativos, então foi implementado uma consulta para verificar o estado dos agente antes de fazer a execução.

- Se o agente tiver inativo ao tentar ser executado, o WORKER registra FAILED na execução com motivos e não cobra tokens depois do enfileiramento.

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

- Anteriormente, foi identificado que uma mensagem repetida (mesmo ID) podia processar e cobrar a mesma execução novamente.
- Agora valida o custo total, verificação de estado e retomada de PROCESSING, transação com bloqueios e uso das configurações. 

**create-agent.dto.ts**

- Agora também rejeita caractere nulo em `name`, `description` e `systemPrompt`. As regras também são herdadas pelo DTO de atualização para evitar refazer do zero.

**env.ts**

- Validação estrita de inteiro e das faixas de portas, prefetch e atraso

**executions.controller.ts**

- Documentação no swagger de que o worker pode recusar o custo total após o enfileiramento.

**POST /agents/{agentId}/executions**

- A API já verificava o consumo mensal, mas validava apenas os tokens de entrada que o agente tinha antes de enfileirar. Então acontecia que o `POST /agents/{agentId}/executions` dava 201, mas quando ia para as consultas de uma execução `GET /executions/{id}`, mostrava que chegou ao limite de token e a quantidade que seria necessário.

- Foi feito uma validação, e agora da erro 429 na rota `POST /agents/{agentId}/executions` e mostra a quantidade requerida de token para aquela execução.

- A rota  dava 201, mas quando ia para as consultas de uma execução também está mostrando a quantidade de token gasto na entrada e saida

## Erro crítico:

**Rabbit**

Era permitido criar e logar com usuários que continham somente espaços vazios no login e senha.

`rabbitmq/20-credentials.conf` - Configura o validador personalizado implementado em Erlang.

`rabbitmq/spotmetrics_credential_validator.erl` - Valida o username e password contra espaços.

`docker-compose.yml` - Carrega o módulo na inicialização, que no caso é o arquivo `rabbitmq/spotmetrics_credential_validator.erl`

## Riscos

- **Reenvio sem limite de tentativas:** 

- erros técnicos agora têm 3 tentativas no total, com 1 segundo entre os reenvios. Ao atingir o limite, a mensagem vai para `agent-executions.failed`, com o ID, a quantidade de tentativas e o último erro nos headers. Isso evita repetir indefinidamente uma falha de processamento. Os valores podem ser configurados no `.env`.

**Publicação sem confirmação do Rabbit** 

- agora a publicação usa um canal com confirmação do broker, mensagens persistentes e verificação de roteamento. A API aguarda essa confirmação antes do 201 e limita a espera a 5 segundos por padrão. Se falhar, retorna 503 com o ID da execução, desde que consiga registrar o resultado no banco. Uma execução ainda PENDING é marcada FAILED; estados já alterados pelo worker são preservados, pois perder a confirmação não significa necessariamente perder a mensagem.

**Falha ao encaminhar uma tentativa** 

- o worker só confirma a mensagem original depois de confirmar a nova publicação. Se não conseguir encaminhar, pausa o consumo e devolve a mensagem à fila. Depois de recuperar o Rabbit, é necessário reiniciar o worker. Preferi preservar a mensagem e parar as tentativas automáticas nesse caso.



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







