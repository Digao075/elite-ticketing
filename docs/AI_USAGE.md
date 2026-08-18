# Uso de IA

O enunciado recomenda usar IA e pede que eu conte como usei. Segue o relato
honesto, incluindo onde a ferramenta errou.

## Ferramentas

| Ferramenta | Onde |
|---|---|
| Codex | Análise do enunciado, arquitetura, contratos de tarefa, e a maior parte do back-end (T-001 a T-013) |
| Claude (Cowork) | Encerramento do T-013, back-end do fluxo de venda (T-014), front-end, documentação |

Nas duas usei o mesmo fluxo com portões humanos: contrato escrito antes do
código, testes antes da implementação, revisão independente e aprovação minha
em cada transição. O processo está em [PROCESS.md](PROCESS.md).

## O que a IA fez

- Rascunhou os contratos de tarefa a partir de escopo que eu defini
- Escreveu os testes antes da implementação, e a implementação depois
- Revisou o próprio trabalho em uma sessão separada, sem ver o raciocínio anterior
- Escreveu a maior parte do CSS e dos componentes de interface
- Redigiu README, ADRs e este documento a partir de decisões já tomadas

## O que eu decidi

Estas escolhas foram minhas, e a IA registrou o motivo:

- Stack (React, NestJS, PostgreSQL, Prisma) e monólito modular
- MVP de cinema com assentos marcados, em vez de pista por quantidade
- QR assinado por HMAC em vez de token opaco armazenado
- Invariantes críticas no banco, não no código
- Publicação torna o mapa de assentos imutável
- Cortar busca e filtro de eventos para garantir o fluxo completo no prazo
- Aposentar os artefatos brutos do fluxo e manter só o registro curado

Em todo portão em que houve alternativa real, ela está registrada — com o que
foi descartado e por quê.

## Onde a IA errou

Registro isto porque é a parte útil.

**Suíte verde com a build quebrada.** Cinco erros de TypeScript, três deles
versionados havia dias, passaram por quatro revisões automatizadas. Nenhum teste
percebeu, porque o Vitest transpila sem checar tipos. A IA revisava contra os
critérios de aceite e todos passavam — o buraco era o próprio conceito de
"pronto". Correção: `pnpm test` agora roda `tsc` antes dos testes.

**Defeitos que só aparecem executando.** Faltava CORS, o Nest não lia o `.env`,
e uma chave de API vazia impedia a aplicação inteira de subir. Nenhum apareceria
em teste algum, porque os testes injetam o próprio ambiente. Só apareceram
quando rodei o binário compilado como um avaliador rodaria.

**Testes errados que pareciam código errado.** Em uma rodada, 23 testes
falharam. A causa raiz era um helper de teste comparando `uuid = text` no
PostgreSQL. Outro falhava porque tentava criar dois eventos na mesma sala e
horário — e a API recusava, corretamente. Mexer no serviço teria "consertado" o
teste e quebrado o produto.

**O servidor de desenvolvimento rodava código de cinco dias antes.** Uma
compilação antiga havia emitido para `dist/src/`, o Nest CLI prefere esse
caminho quando ele existe, e a compilação incremental nunca reescreveu por cima.
O resultado: `/health` respondia e toda rota criada depois devolvia 404 — com a
suíte inteira verde, porque os testes importam o módulo direto e nunca tocam em
`dist`. Só apareceu quando fui abrir a aplicação no navegador. Minha primeira
correção piorou: limpar o `dist` a cada build, combinado com o cache incremental
sobrevivente, produzia uma pasta vazia e um build que nem iniciava. A correção
certa foi mover o cache para dentro do `dist`, amarrando os dois ciclos de vida.

**Quinze testes de interface, dez falhando pela mesma causa.** O `cleanup` da
Testing Library nunca era registrado, porque ele só se auto-registra quando o
Vitest roda com `globals`. As árvores renderizadas se acumulavam entre os testes.
Os quatro testes que já existiam passavam por sorte — consultavam textos que por
acaso continuavam únicos. Um deles ficou vermelho por culpa do meu próprio
mock, que detectava erro HTTP procurando um campo `status`, sem perceber que
`ReservationDto` tem um `status` legítimo: um pagamento aprovado era lido como
falha.

**Tendência a acrescentar.** Sempre que eu abria espaço, a proposta vinha maior
do que o necessário. Os cortes — sem busca, sem tempo real, sem entidade de
pagamento separada, sem agendador — foram todos meus.

## O que eu tiro disso

IA acelera muito a parte mecânica e é uma boa parceira para enumerar
alternativas. Mas ela otimiza para o critério que você escreveu, e o meu
critério estava incompleto: eu tinha portão para comportamento e não tinha para
compilação nem para inicialização.

Há um padrão nos quatro casos acima: todos passaram por revisão automatizada
sem serem notados, e todos apareceram no momento em que alguém executou a coisa
de verdade. Teste verde prova comportamento. Não prova que o projeto compila,
não prova que ele sobe, e não prova que o que sobe é o código de hoje — são
quatro garantias diferentes, e cada uma precisa do seu próprio portão.

A revisão que encontrou os defeitos reais não foi a automatizada — foi rodar o
programa.
