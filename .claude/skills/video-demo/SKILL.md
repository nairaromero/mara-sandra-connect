---
name: video-demo
description: Grava o filme de demonstração da feature recém-concluída — ritmo humano, staging real, atos por papel (equipe/parceiro), dados verossímeis, limpeza total e MP4 único pra apresentar ao time e aos parceiros.
---

# Filme de demonstração de feature

**Quando usar:** ao concluir e validar um item do lote (ou quando a Naira pedir
"grava o vídeo"). O fechamento padrão de uma atualização relevante inclui este
filme — é o registro de apresentação, complementar ao vídeo técnico da suíte E2E
(`bun run e2e:video`, ver D21 em planning/DECISOES.md).

**Modelo pronto:** [e2e/demo/roteiros/exigencia-judicial.cjs](../../../e2e/demo/roteiros/exigencia-judicial.cjs)
· **Utilitários:** [e2e/demo/helpers.cjs](../../../e2e/demo/helpers.cjs)
· Roteiro novo = copiar o modelo e trocar as cenas.

## O ritual

1. **Roteiro em atos por papel.** Conte a história completa do fluxo: o que a
   equipe faz → o que o parceiro vê e faz → o que volta pra equipe. Um ato =
   um context Playwright (`estudio.novaParte("interno"|"parceiro"|"admin")`) =
   um clipe. Sessões vêm de `e2e/.auth/*.json` (renovar rodando qualquer spec;
   se uma conta não logar, `node scripts/seed-staging-contas.mjs` — o espelho
   de segunda-feira apaga o auth e já quebrou login no meio do dia).
2. **Dados de cena verossímeis.** Cliente com nome fictício realista (nunca
   pessoa real), caso ligado ao parceiro sintético. As contas sintéticas ganham
   nomes apresentáveis SÓ durante a filmagem ("Equipe Mara Vian", "Silva &
   Costa Advogados") e são **restauradas no finally** — a suíte E2E usa essas
   contas.
3. **Ritmo humano.** slowMo 350 (já no `abrirEstudio`), `deslizar/clicar` pra o
   cursor viajar até o alvo, `ler(page, ms)` depois de cada tela — o espectador
   precisa de tempo pra LER. Pausa longa (~5s) na cena-troféu (ex.: a mensagem
   reescrita pela IA).
3b. **Narração legendada** (`narrar(page, "…")`): um letreiro no rodapé explica
   cada cena em uma frase curta ("A publicação chegou pelo DJE e virou
   andamento no caso"). Narre ANTES da ação da cena; o letreiro some ao
   navegar — narre de novo após cada goto/reload. É o que faz o filme se
   explicar sozinho pra quem nunca viu a tela. Rolar até o que a narração
   menciona — nada de citar coisa fora do enquadramento.
4. **Still de conferência por cena** (`estudio.still(page, "atoN-XX-nome")`).
   É assim que se revisa o filme sem assistir: olhe os stills ANTES de entregar
   e refilme se uma cena saiu errada.
5. **Sentinelas de conclusão honestas.** Botão que vira spinner perde o nome
   acessível — esperar "botão sumir" dispara cedo. Espere o efeito real (sheet
   fechar = `Cancelar` hidden; toast; registro no banco). **Nunca navegue com
   um save em andamento** — aborta os inserts no meio (aconteceu no take 1).
   Saves com IA levam 10–30s: timeouts generosos.
6. **Cenas opcionais com `tentar()`** — o filme nunca morre por uma cena
   bônus.
7. **Limpeza total no `finally`**, mesmo com filmagem abortada: storage →
   documentos → solicitações → tarefas → tarefas_excluidas → notificações →
   andamentos → caso → cliente → restaurar nomes. Confirme depois com um
   SELECT que nada sobrou.
8. **Montagem em MP4 único** (webm não abre em Keynote). ffmpeg não fica no
   repo — instalar `ffmpeg-static` no scratchpad da sessão:
   `npm i ffmpeg-static` e então
   `ffmpeg -y -i ato1.webm -i ato2.webm -i ato3.webm -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 22 -preset medium -r 25 filme.mp4`
9. **Entrega:** enviar o MP4 pra Naira com a minutagem dos capítulos (durações
   dos atos via `ffmpeg -i atoN.webm`). A saída fica em `e2e/demo/saida/`
   (gitignorada) — vídeo NUNCA entra no repo.

## Limites

- Filmar SEMPRE no staging (`staging.marasandraconnect.com` + banco staging via
  `adminStaging()`) — nunca produção.
- A IA do staging precisa de chave cadastrada (Configurações → Integração de
  IA, compartilhada) — quem cadastra é a Naira; sem chave o texto sai no
  fallback do template (o filme funciona, mas perde a cena-troféu).
- Rodar da raiz do repo: `node e2e/demo/roteiros/<roteiro>.cjs`.
