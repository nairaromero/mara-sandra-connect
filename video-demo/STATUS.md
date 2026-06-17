# Vídeo demo Mara Sandra Connect — Status da sessão (2026-06-04)

## Objetivo
Vídeo MP4 de 1–2 min para apresentar o app aos advogados parceiros do Mara Vian.
Decisões da Naira: narração com voz do macOS (comando `say`, voz Luciana), visão interna + parceiro, dados reais anonimizados (LGPD).

## O que já está pronto

### Telas capturadas (anonimizadas via DOM antes da captura, verificadas por OCR)
Resolução 1485x812. Frames CLEAN (sem dados reais):

**frames_interno_v3/** (visão interna, gravação 3):
- Dashboard interno: f004–f009
- Clientes: f013–f018
- Caso – Visão geral: f022–f027

**frames_interno_v2/** (visão interna, gravação 2):
- Caso – Andamentos (expandido): f007–f011
- Caso – Documentos: f015–f019
- Caso – Comentários (chat parceiro): f023–f027
- Caso – Processos (admin INSS): f031–f034
- Documentos pendentes: f038–f041
- Parceiros (form convite): f042–f043 / Parceiros (tabela): f044–f050

**frames_parceiro/** (visão do parceiro, login Andre→exibido como "Ricardo Almeida Prado"):
- Dashboard parceiro: f004–f009 (verificado CLEAN)
- Caso – Visão geral (CPF mascarado ***.456.789-**): f013–f024 CLEAN
- f001–f003 BAD (Andre Alves Servan real), f010–f012 BAD (Clerton) — NÃO USAR
- f025–f048: AINDA NÃO VERIFICADOS por OCR (abas Andamentos/Comentários parceiro + Documentos pendentes parceiro). Verificar antes de usar: procurar "Clerton|Andre Alves|Servan|574.135|135.843-8|52369|ALUMINIO".

### Dados fictícios usados (mapa de anonimização)
Clerton→Carlos Ferreira de Souza; Adeilton→João Batista Moreira; Elizaine→Ana Lúcia Mendes; Jose Fernandes→Pedro Henrique Alves; Sergio→Marcos Aurélio Nunes; Camila Moraes Gonçalves→Paula Cristina Martins; Andre Alves Servan→Ricardo Almeida Prado; CPFs→000.000.000-00 etc.; protocolos 401271791→401000111, 1593268866→1593000222, 44233539908202698→44233500000000333.

## Próximos passos (retomar amanhã)
1. Verificar por OCR frames_parceiro f025–f048 (tesseract no sandbox).
2. Roteiro de narração (~9 cenas interno + 3 parceiro, 1–2 min total).
3. Gerar script `narracao.sh` com `say -v Luciana` para a Naira rodar no Terminal (TTS neural bloqueado no sandbox; aiff vão para esta pasta).
4. Montar MP4 1920x1080 com ffmpeg (sandbox tem ffmpeg 4.4): stills + crossfade + zoom suave + narração sincronizada + legendas.
5. Verificação final: rever vídeo frame a frame (OCR) antes de entregar.

## Notas técnicas
- Screenshots do Chrome não salvam em disco nesta sessão; usar gif_creator (export baixa em ~/Downloads; gravador captura no máx. 50 frames, ring buffer — gravar em blocos).
- Padrão que funciona: navigate → wait → JS de anonimização → 2-3 cliques neutros (geram frames limpos).
- App: marasandraconnect.com. Caso usado: /casos/0d2ae043-5b13-47d7-82db-d99601f71b4c.
- A conta do Chrome ficou logada como PARCEIRO de teste — Naira precisa relogar como interna se for usar o app.
