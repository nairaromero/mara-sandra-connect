# Permissões por pessoa: o admin ajusta o que o papel dá

**Pedido (Naira, 24/09/2026):** em Configurações, uma área só do admin onde ele escolhe uma
pessoa, vê o papel dela e uma lista de caixas com tudo que ela pode e não pode, e então marca ou
desmarca permissões individualmente.

**Estado:** plano. Nada implementado. Este documento é para você aprovar, cortar ou corrigir
antes de eu escrever qualquer código.

---

## 1. O que já existe (e por que o pedido cabe bem)

O modelo de hoje tem três peças:

| Peça | O que é |
|---|---|
| `permissoes` | as 26 ações que o sistema controla, com `grupo` (Casos, Documentos, Escritório…) e descrição |
| `papeis` + `papel_permissoes` | o conjunto de cada papel, com **escopo** (`todos`, `atribuidos`, `indicados`, `proprios`) |
| `membros` | o vínculo da pessoa com o escritório, apontando para UM papel |

Tudo que decide acesso passa por `private.tem_permissao(chave, escopo)`, e a tela lê
`minhas_permissoes()`. **Há um único ponto para mudar** — é o que torna este pedido barato.

Um detalhe que ajuda: `papeis` já tem `escritorio_id`. Papel próprio de escritório é previsto
no desenho e ninguém criou ainda (hoje são 5 papéis de sistema, 0 de escritório).

## 2. A decisão de fundo: ajuste por pessoa, não cópia do papel

Duas formas de fazer o que você pediu:

| | Como funciona | Problema |
|---|---|---|
| **A. Copiar a matriz** | ao ajustar, a pessoa ganha uma cópia das 26 linhas do papel | congela: melhorar o papel "advogado" amanhã não alcança quem foi ajustado; ninguém lembra por que Fulano difere |
| **B. Guardar só a diferença** ✅ | grava só o que foi **concedido a mais** ou **tirado** em relação ao papel | o papel continua vivo; a tela mostra "herdado" x "ajustado"; desfazer é apagar a linha |

**Recomendo a B.** Uma tabela `membro_permissoes (membro_id, permissao, escopo, concedida)`, onde
`concedida = true` soma e `false` tira. O efetivo vira:

```
permissões do papel  −  as tiradas  +  as concedidas
```

## 3. O que muda no banco

1. **Tabela `membro_permissoes`**, com `escritorio_id` (isolamento), FK para `membros` e
   `permissoes`, chave única por (membro, permissão), `definida_por` e `definida_em`.
2. **`private.permissoes_efetivas(membro_id)`**: o cálculo acima, num lugar só.
3. **`private.tem_permissao`** passa a ler o efetivo em vez de `papel_permissoes` direto. É a
   mudança de uma função — todas as policies, RPCs e functions herdam sem tocar em nada.
4. **`minhas_permissoes()`** passa a devolver também a **origem** (`papel` ou `ajuste`), para a
   tela poder marcar o que foi mexido.
5. **RPC `definir_permissao_do_membro(membro, permissao, estado, escopo)`**, com
   `equipe:gerenciar`, auditoria e as travas da seção 5.

## 4. A tela

Onde: **Configurações → aba Equipe** (nova, só admin). Hoje a gestão de equipe vive em `/equipe`;
a aba nova pode conviver, e `/equipe` ganha um link "ajustar permissões" por pessoa. Se você
preferir tudo em `/equipe`, é a mesma tela noutro endereço — me diga qual.

O que a tela mostra, por pessoa:

- **Cabeçalho**: nome, papel atual (com troca de papel ali mesmo) e um resumo em uma linha:
  "Advogado, com 2 ajustes".
- **Lista agrupada** pelos grupos que já existem em `permissoes` (Casos, Clientes, Documentos,
  Rotina, Comercial, Financeiro, Parceiros, IA, Cadastros, Escritório), cada item com:
  - a caixa (marcada = pode),
  - a descrição em português (já está no banco),
  - uma etiqueta discreta quando difere do papel: **"ajustado"**, com um "voltar ao papel",
  - onde o escopo importa (tarefas e agenda), um seletor **todos / só os atribuídos**.
- **Rodapé**: "voltar tudo ao papel" e o registro de quem mexeu por último.

Ponto importante de construção: a lista **vem do banco** (`permissoes` + efetivo), nunca de uma
matriz escrita no front. Foi essa a lição da auditoria de 24/09 — matriz escrita à mão em dois
lugares diverge em silêncio (planning/RBAC_AUDITORIA_TELAS.md).

## 5. Os melhoramentos que eu proponho junto

São o que transforma "caixinhas" em algo seguro de usar num escritório:

1. **Trava de porta**: ninguém tira a própria `equipe:gerenciar`, e o escritório não pode ficar
   sem nenhum admin com ela. O banco recusa, não só a tela.
2. **Permissões sensíveis com aviso**: `equipe:gerenciar`, `escritorio:configurar`,
   `auditoria:ler`, `integracoes:gerenciar`, `clientes:excluir`, `parceiros:excluir`,
   `ia:mcp_conceder` — marcar na tabela `permissoes` com `sensivel = true` e a tela pedir
   confirmação com o efeito escrito ("passa a ver a auditoria inteira do escritório").
3. **Coerência com o tipo de acesso**: não oferecer permissão de interno para quem é parceiro.
   O banco também recusa, porque o papel do vínculo é parceiro.
4. **Escopo de verdade**: o ajuste guarda escopo, então dá para conceder "tarefas:gerenciar"
   apenas dos atribuídos, que é o que o assistente já tem hoje.
5. **Auditoria com antes e depois**: cada ajuste vira linha na Auditoria do escritório, com quem
   mexeu, em quem, o que mudou. Já existe `private.auditar`.
6. **A pessoa sente na hora**: hoje as permissões são lidas no login. Proponho a tela recarregar
   `minhas_permissoes()` quando a aba volta ao foco, para o ajuste valer sem a pessoa sair e
   entrar. (O banco já barra na hora; o que atrasa é só o que a tela oferece.)
7. **"Vira papel do escritório"**: quando o mesmo ajuste se repete em três pessoas, a tela
   sugere criar um papel próprio do escritório com aquele conjunto. O modelo já suporta
   (`papeis.escritorio_id`), e isso evita o escritório virar uma coleção de exceções.
8. **Explicar antes de salvar**: um resumo do que muda ("passa a poder excluir documentos;
   deixa de gerenciar etiquetas") em vez de só fechar o diálogo.
9. **Ver como fica**: um botão que abre a lista de menus e botões que a pessoa passará a ver.
   Opcional, mas é o que mais reduz erro de configuração.
10. **Nada de permissão órfã**: o verificador que já existe
    (`scripts/rbac-conferir-exigencias.mjs`) passa a conferir também que toda permissão em uso
    existe na tabela — assim um ajuste não concede algo que ninguém lê.

## 6. O que eu NÃO faria agora

- **Permissão por caso ou por cliente** (ex.: "só os casos da Dra. Fulana"). É outro problema,
  com custo alto em cada consulta. O escopo `atribuidos` já cobre o caso comum.
- **Papéis customizados livres** antes de ver o uso real dos ajustes. O item 7 acima é o caminho
  natural, e barato, quando o padrão aparecer.
- **Permissões do QG** por pessoa: o QG tem seu próprio quadro (`plataforma_staff`) e outra
  régua; misturar confunde.

## 7. Ordem de execução, se aprovado

| Passo | O que entra | Tamanho |
|---|---|---|
| 1 | Migration: tabela, efetivo, `tem_permissao`, `minhas_permissoes` com origem, RPC com as travas | médio |
| 2 | Specs de banco: concede, tira, trava de porta, isolamento entre escritórios, auditoria | pequeno |
| 3 | Tela: aba Equipe em Configurações, lista por grupo, ajustes, voltar ao papel | médio |
| 4 | Melhoramentos 2, 5, 6 e 8 (sensíveis, auditoria, recarregar, resumo) | pequeno |
| 5 | Specs de tela por papel + conferência do lote e trecho no filme | pequeno |
| 6 | Glossário (termo "ajuste de permissão"), CLAUDE.md e este plano viram registro | pequeno |

Os melhoramentos 7 e 9 ficam para um segundo lote, depois de ver o uso.

## 8. O que eu preciso decidir com você

1. **Onde mora**: aba nova em Configurações (como você pediu) ou dentro de `/equipe`, que já é a
   tela da equipe? Dá para ser uma e linkar da outra.
2. **Quem pode ajustar**: só admin (`equipe:gerenciar`, como hoje), ou você quer que o advogado
   possa ajustar assistente? Minha recomendação é só admin.
3. **Sensíveis**: confirma a lista do item 2 da seção 5?
4. **Conceder acima do próprio nível**: um admin pode conceder algo que ele mesmo não tem? Hoje
   admin tem tudo, então é teórico — mas a regra precisa existir antes de aparecer papel novo.
   Minha recomendação: não.
