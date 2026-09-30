*Resoluções e validações inicais:*

# Comando para testes HTTP: npm test -- --runInBand src/common/validation.spec.ts

# Primeiro problema encontrado ao realizar testes unitários via terminal.

em "create-agent.dto.ts" permite a criação de agentes com nomes e prompts contendo apenas espaços, e com limite negativo, além de números acima da capacidade da coluna integer do PostgreSQL.

**create-agent.dto.ts**

- @Trim(), @IsNotEmpty(): Para não permitir nome e prompt contendo apenas espaços e @MaxLength(500) para limitar tamanho de descrição (Padronizar tamanho para evitar poluição visual e quebras visuais)

- @min() e @max(): @min() evita colocar valores negativos e @max() elabora um valor máximo para não ficar com números absurdos.

**Arquivo create-execution.dto.ts:**

- @Matches(/\S/): Exige algum caractere que não seja espaço.

**Get-agent-usage-query.dto.ts:**

- @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must use YYYY-MM with a month between 01 and 12' }): Agora ele exige exatamente um mes entre 1 e 12. Quando omitido, continua usando o mes atual em UTC.


==============================================================================

# Segundas validações:

**executions.service.ts:**

- active: false permitia executar agentes inativas, então foi implementado uma consulta para verificar o estado do agente antes de fazer a execução.
- Se o agente tiver inativo ao tentar ser executado, registra um FAILED na execução com motivos e não cobra tokens.
- Também exige mensagem JSON contendo um objeto com executionId UUID válido para validação no worker (evita enviar mensagens inválidas, reenvio para as filas e gerar logs repetitivos)





