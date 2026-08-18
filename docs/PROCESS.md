# Como eu conduzi este projeto

Este documento existe porque o enunciado pede exatamente isso: *"o que nos
interessa não é o volume entregue: é como você pensa"*. Aqui está o processo, os
números e — principalmente — as decisões que **não** foram tomadas.

> Convenção: README, este documento e o de uso de IA estão em português, porque
> são a leitura de quem avalia. Os ADRs seguem em inglês, convenção comum para
> registros de arquitetura.

## O ritmo de trabalho

Cada incremento passou pelo mesmo ciclo, e nenhum pulou etapa:

```
contrato escrito  ->  decisão humana  ->  testes  ->  implementação  ->  revisão independente  ->  decisão humana
```

O **contrato** é um documento com critérios de aceite verificáveis, escopo
explicitamente fora, e a tabela de erros esperados — escrito antes de existir
qualquer código. Os **testes** vêm antes da implementação e precisam falhar por
motivo honesto. A **revisão** é feita sem acesso ao raciocínio de quem
implementou: ela lê o contrato e o diff, nada mais. E as duas **decisões
humanas** são obrigatórias: nada avança sozinho.

Isso produziu, ao longo do desafio:

| Artefato | Quantidade |
|---|---|
| Contratos de tarefa (T-001 … T-014) | 14 |
| Decisões registradas em log | 93 |
| Relatórios de revisão independente | 11 |
| ADRs | 8 |
| Testes automatizados | 305 |

## Por que `.pipeline/` não está neste repositório

Os artefatos brutos do fluxo (contratos, log completo, relatórios) somavam mais
de 100 KB de material operacional — útil para conduzir o trabalho, ruim para
alguém revisar em poucos minutos. Eles vivem no repositório da ferramenta que
usei. O que importa para leitura — as decisões, os motivos e as alternativas
descartadas — está destilado aqui e nos ADRs.

Essa também é uma decisão com contrapartida: perde-se a rastreabilidade
completa. Se você preferir ver o material bruto, posso disponibilizá-lo.

## As decisões que moldaram o sistema

Para cada uma, o que foi descartado importa tanto quanto o que ficou.

**Invariantes críticas no banco, não no código.**
Verificar-e-depois-gravar tem uma janela de corrida que nenhum cuidado fecha.
Descartei checagem em memória e trava por assento no processo — nenhuma das duas
sobrevive a duas réplicas da API. Ficou um índice único parcial para a venda
única e um `UPDATE` condicional para o uso único do ingresso. Detalhes em
[ADR 003](adr/003-seat-allocation-concurrency.md) e
[ADR 008](adr/008-single-use-ticket-validation.md).

**Liberar assento marca `releasedAt`; não apaga a linha.**
Um `UNIQUE` simples em `eventSeatId` impediria o assento de ser revendido
*para sempre* depois de uma recusa. O índice parcial (`WHERE "releasedAt" IS
NULL`) libera o assento e mantém a tentativa auditável.

**Reservas expiram preguiçosamente.**
Descartei agendador e job de fundo. O único instante em que uma reserva vencida
importa é quando alguém quer aquele assento — então ela é recuperada dentro da
própria transação de reserva. Menos peça móvel, mesmo resultado.

**Capacidade é derivada, nunca armazenada.**
Um número editável diverge do estoque real. Capacidade é sempre a contagem de
`EventSeat`.

**Escopo cortado conscientemente.**
Busca e filtro de eventos constam como *opcionais* no enunciado e foram
cortados no Gate 1 da última tarefa, com o prazo em vista, para garantir o fluxo
inteiro funcionando. O enunciado é explícito: *"preferimos o fluxo inteiro
simples e completo a um pedaço sofisticado com telas pela metade"*.

**Mapa de assentos não é tempo real.**
Sem WebSocket. Duas pessoas podem ver o mesmo assento livre; o banco recusa a
segunda reserva e a interface trata o `409` relendo a disponibilidade. O caso
raro é resolvido corretamente sem pagar o custo de infraestrutura do caso comum.

## O erro mais instrutivo

Durante boa parte do projeto a suíte esteve verde com **a build quebrada**.

O Vitest transpila TypeScript sem checar tipos. Havia cinco erros de `tsc` —
três deles versionados havia dias — e nenhum teste percebeu, porque teste
nenhum compila o projeto. Passaram por quatro revisões sem serem vistos.

Duas correções saíram disso:

1. `pnpm test` agora roda `tsc` **antes** dos testes. Uma build vermelha não
   passa mais como suíte verde.
2. Passei a executar o binário compilado como um avaliador faria — e só assim
   apareceram três defeitos que teste nenhum pegaria: falta de CORS, o Nest não
   lendo `.env`, e uma chave de API vazia impedindo a aplicação inteira de
   subir.

A lição que levo: **teste verde prova comportamento, não prova que o projeto
compila nem que ele sobe.** São três garantias diferentes e cada uma precisa do
seu próprio portão.

## Um caso de diagnóstico

Em determinado momento 23 testes falharam de uma vez. A causa raiz era uma só:
um helper do próprio teste comparava `uuid = text` no PostgreSQL, sem cast.

Vale registrar o que **não** fiz. Um dos testes falhava porque tentava criar
dois eventos na mesma sala, no mesmo horário — e a API recusava com `409`. O
teste estava errado; a regra de negócio estava certa. Alterar o serviço para
deixar passar teria "consertado" o teste e quebrado o produto.

Teste que falha é hipótese, não veredito.

## O que eu faria diferente com mais tempo

- Checar tipos também nos arquivos de teste; hoje só o código-fonte passa por `tsc`.
- Testes de interface mais profundos: hoje há cobertura de fumaça no front-end e
  cobertura séria no back-end.
- Configurar um linter — não há um no projeto, e isso é uma lacuna real.
- Integração contínua rodando `pnpm test` e `pnpm build` a cada push.
