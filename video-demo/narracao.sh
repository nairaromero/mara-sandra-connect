#!/bin/bash
# Gera a narração do vídeo com a voz Luciana (PT-BR) do macOS.
# Como usar: abra o Terminal e rode:  bash ~/Documents/marasandraconnect/video-demo/narracao.sh
set -e
cd "$(dirname "$0")"
mkdir -p narracao
V="Luciana"
say -v "$V" -o narracao/cena01.aiff "Este é o Mara Sandra Connect, a plataforma do escritório Mara Sandra Vian Advocacia para gestão de parcerias em casos previdenciários. Nele, escritório e advogados parceiros acompanham os casos em um só lugar."
say -v "$V" -o narracao/cena02.aiff "Na área de clientes, a equipe localiza qualquer cliente por nome, CPF ou número de processo, com status e processos vinculados."
say -v "$V" -o narracao/cena03.aiff "Cada caso tem uma página completa: dados do cliente, tags sincronizadas com o Tramitação Inteligente e acesso controlado à senha do Meu INSS, com registro de auditoria."
say -v "$V" -o narracao/cena04.aiff "Na aba de andamentos, as movimentações administrativas do INSS chegam automaticamente, integradas ao Tramitação Inteligente."
say -v "$V" -o narracao/cena05.aiff "Os documentos do caso ficam organizados por pasta, com integração ao Google Drive."
say -v "$V" -o narracao/cena06.aiff "Nos comentários, escritório e parceiro conversam dentro do próprio caso. O destinatário é avisado por e-mail."
say -v "$V" -o narracao/cena07.aiff "A aba de processos consolida requerimentos administrativos e processos judiciais, com o resultado de cada fase."
say -v "$V" -o narracao/cena08.aiff "Em documentos pendentes, o escritório solicita documentos e acompanha o que falta, por caso e por origem."
say -v "$V" -o narracao/cena09.aiff "O cadastro de parceiros envia o convite por e-mail e o advogado define a própria senha."
say -v "$V" -o narracao/cena10.aiff "E esta é a visão do advogado parceiro: ao entrar, ele vê apenas os casos que indicou, com status e métricas."
say -v "$V" -o narracao/cena11.aiff "No caso, ele acompanha os dados essenciais, com CPF mascarado, e os andamentos liberados pelo escritório, em tempo real."
say -v "$V" -o narracao/cena12.aiff "Quando o escritório solicita um documento, o parceiro vê a pendência e cumpre direto pela plataforma. Mara Sandra Connect: transparência total para a parceria, do protocolo ao êxito."
echo "Pronto! 12 áudios gerados em video-demo/narracao/"
