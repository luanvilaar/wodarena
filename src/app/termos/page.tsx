import React from 'react';
import type { Metadata } from 'next';
import { ShieldCheck, FileText, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Políticas, Termos de Inscrição e Privacidade | WODArena',
  description: 'Leia atentamente os Termos de Uso, Políticas de Inscrição e Privacidade da plataforma de gerenciamento esportivo WODArena.',
};

export default function TermosPage() {
  const sections = [
    { id: 'uso', num: '1', title: 'Termos de Uso e Inscrições' },
    { id: 'pagamento', num: '2', title: 'Política de Pagamento' },
    { id: 'devolucao', num: '3', title: 'Devolução e Reembolso' },
    { id: 'transferencia', num: '4', title: 'Protocolo de Transferência' },
    { id: 'validacao', num: '5', title: 'Validação e Check-in' },
    { id: 'privacidade', num: '6', title: 'Política de Privacidade (LGPD)' },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero Header */}
      <div className="mb-12 border-b border-card-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Documento Oficial</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-foreground sm:text-4xl uppercase">
          Políticas, Termos de Inscrição e Privacidade
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-soft">
          Bem-vindo à WODArena. Leia atentamente as políticas abaixo que regem o uso de nossa plataforma tecnológica para inscrições de atletas, gestão e rankings de competições esportivas.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        {/* Navigation Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-1">
            <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-muted-soft mb-3">Índice do documento</p>
            {sections.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                className="group flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-soft transition-colors hover:bg-card hover:text-primary"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded bg-card-border text-[10px] font-mono text-muted group-hover:bg-primary group-hover:text-ink">
                  {sec.num}
                </span>
                {sec.title}
              </a>
            ))}
          </div>
        </aside>

        {/* Content Body */}
        <div className="space-y-12">
          {/* 1. Termos de Uso e Inscrição de Atletas */}
          <section id="uso" className="scroll-mt-24 rounded-xl border border-card-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-ink font-mono">1</span>
              <h2 className="text-lg font-bold uppercase tracking-wider text-foreground">Termos de Uso e Inscrição de Atletas</h2>
            </div>
            <div className="mt-4 border-t border-card-border pt-4">
              <p className="text-sm leading-relaxed text-muted">
                A WODArena concede a plataforma de gestão de eventos, fornecendo a infraestrutura tecnológica para inscrições de atletas, pagamentos, cronogramas e resultados em tempo real (rankings).
              </p>
              <ul className="mt-4 space-y-3 text-xs leading-relaxed text-muted-soft">
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>A inscrição adquirida na plataforma concede ao atleta participante o direito de competir no evento esportivo correspondente.</span>
                </li>
                <li className="flex gap-2 font-bold text-foreground">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>A responsabilidade exclusiva pela organização do evento, local da competição, categorias, cronogramas de provas, segurança física dos competidores e premiações pertence ao Organizador Independente do respectivo evento.</span>
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>O atleta é legalmente responsável por declarar dados verídicos e completos no momento de sua inscrição.</span>
                </li>
                <li className="flex gap-2 bg-[#fcd535]/5 border border-[#fcd535]/10 p-3 rounded-lg text-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                  <span>Cada inscrição gera um QR Code Único e Criptografado de credenciamento do atleta, cuja guarda e conservação são de inteira responsabilidade do titular.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* 2. Política de Pagamento das Inscrições */}
          <section id="pagamento" className="scroll-mt-24 rounded-xl border border-card-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-ink font-mono">2</span>
              <h2 className="text-lg font-bold uppercase tracking-wider text-foreground">Política de Pagamento das Inscrições</h2>
            </div>
            <div className="mt-4 border-t border-card-border pt-4">
              <p className="text-sm leading-relaxed text-muted">
                Os pagamentos de inscrições na plataforma WODArena são integrados de forma segura a gateways parceiros de processamento financeiro (Mercado Pago ou PagSeguro) configurados diretamente por cada Organizador Independente do evento.
              </p>
              <ul className="mt-4 space-y-3 text-xs leading-relaxed text-muted-soft">
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>O processamento e a liquidação das transferências são operados por intermédio das instituições processadoras oficiais (Mercado Pago / PagSeguro).</span>
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>O sistema WODArena não armazena dados bancários ou informações de cartões de crédito do usuário. A conciliação de pagamentos ocorre via webhook automático e código PIX Copia/Cola ou tokenização direta de cartões.</span>
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>A inscrição do atleta é confirmada imediatamente após o retorno positivo da processadora financeira. Em momentos de instabilidade do Banco Central ou rede, a compensação do Pix pode levar alguns minutos.</span>
                </li>
                <li className="flex gap-2 font-bold text-foreground">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>A apresentação de comprovantes de transferências bancárias ou extratos do banco não substitui a necessidade de geração e leitura do QR Code Oficial no check-in/credenciamento do atleta.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* 3. Política de Devolução, Reembolso e Retenção */}
          <section id="devolucao" className="scroll-mt-24 rounded-xl border border-card-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-ink font-mono">3</span>
              <h2 className="text-lg font-bold uppercase tracking-wider text-foreground">Devolução, Reembolso e Retenção</h2>
            </div>
            <div className="mt-4 border-t border-card-border pt-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 mb-4">
                <p className="text-xs font-bold text-primary uppercase tracking-wider">Direito de Arrependimento (CDC)</p>
                <p className="mt-1 text-sm text-foreground">
                  O atleta poderá solicitar o cancelamento de sua inscrição e o reembolso integral do valor pago em até 7 (sete) dias corridos a partir da data de confirmação da compra, nos termos do Artigo 49 do Código de Defesa do Consumidor (CDC), desde que a solicitação ocorra antes do início oficial da competição.
                </p>
              </div>
              <ul className="mt-4 space-y-3 text-xs leading-relaxed text-muted-soft">
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>Passados os 7 dias corridos da compra, o reembolso fica sujeito exclusivamente à política interna e autorização expressa do Organizador Independente do evento correspondente.</span>
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>Como mecanismo legal e para evitar prejuízos ao atleta que desiste tardiamente da participação, a WODArena disponibiliza a funcionalidade de <strong>Transferência de Titularidade Nominal</strong> da inscrição diretamente no painel do atleta.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* 4. Protocolo de Transferência de Titularidade da Inscrição */}
          <section id="transferencia" className="scroll-mt-24 rounded-xl border border-card-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-ink font-mono">4</span>
              <h2 className="text-lg font-bold uppercase tracking-wider text-foreground">Protocolo de Transferência de Titularidade</h2>
            </div>
            <div className="mt-4 border-t border-card-border pt-4">
              <p className="text-sm leading-relaxed text-muted">
                O atleta titular original detém os direitos sobre sua inscrição e pode cedê-la a outro atleta utilizando as ferramentas da plataforma.
              </p>
              <ul className="mt-4 space-y-3 text-xs leading-relaxed text-muted-soft">
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>A inscrição é nominal, sendo obrigatório que o nome contido no sistema WODArena seja o mesmo do documento de identidade do atleta apresentado no check-in/credenciamento da competição.</span>
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>O titular pode ceder ou transferir a titularidade de sua inscrição informando o CPF e dados do novo atleta beneficiário no painel de &quot;Recursos de Compra&quot;.</span>
                </li>
                <li className="flex gap-2 font-bold text-foreground">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>A transferência de titularidade só é permitida antes do check-in ser realizado ou do QR Code ser lido no Scanner Administrativo do evento.</span>
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>Toda transação de cessão gera um registro (log) inalterável no banco de dados e assume que o novo atleta passa a ser detentor exclusivo da vaga na competição, isentando a plataforma WODArena e os organizadores de disputas de terceiros.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* 5. Validação de Inscrições e Check-in do Competidor */}
          <section id="validacao" className="scroll-mt-24 rounded-xl border border-card-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-ink font-mono">5</span>
              <h2 className="text-lg font-bold uppercase tracking-wider text-foreground">Validação de Inscrições e Check-in</h2>
            </div>
            <div className="mt-4 border-t border-card-border pt-4">
              <p className="text-sm leading-relaxed text-muted">
                Regras e protocolos de segurança para credenciamento de atletas nos eventos:
              </p>
              <ul className="mt-4 space-y-3 text-xs leading-relaxed text-muted-soft">
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>A leitura (SCAN) do QR Code da inscrição pelo staff do evento através do Scanner Administrativo WODArena homologará o check-in do atleta e invalidará o código instantaneamente para novas leituras.</span>
                </li>
                <li className="flex gap-2 font-bold text-foreground">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>Uma inscrição validada dará direito à liberação de pulseira ou kit de atleta oficial da competição. É responsabilidade exclusiva do competidor mantê-la inviolável no braço durante toda a permanência no evento.</span>
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>Tentativas de repetição de leitura de um código já utilizado acionarão alertas vermelhos e sonoros de duplicidade no painel de controle administrativo do Organizador Independente.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* 6. Política de Privacidade (LGPD) */}
          <section id="privacidade" className="scroll-mt-24 rounded-xl border border-card-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-ink font-mono">6</span>
              <h2 className="text-lg font-bold uppercase tracking-wider text-foreground">Política de Privacidade (LGPD)</h2>
            </div>
            <div className="mt-4 border-t border-card-border pt-4">
              <p className="text-sm leading-relaxed text-muted">
                Em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD - Lei nº 13.709/2018), detalhamos com total transparência como seus dados são geridos na WODArena:
              </p>
              <ul className="mt-4 space-y-4 text-xs leading-relaxed text-muted-soft">
                <li className="space-y-1">
                  <strong className="text-foreground uppercase tracking-wider text-[11px] block">A. Dados Coletados</strong>
                  <span>Coletamos e processamos dados dos atletas (nome, e-mail, telefone, CPF, gênero, data de nascimento, cidade, estado, box de treino e perfil do Instagram) com o objetivo de viabilizar a inscrição na competição.</span>
                </li>
                <li className="space-y-1">
                  <strong className="text-foreground uppercase tracking-wider text-[11px] block">B. Finalidade e Legítimo Interesse</strong>
                  <span>O tratamento dos dados cadastrais é estritamente necessário para validar a cobrança e faturamento financeiro seguro, alocar os competidores nas categorias esportivas corretas, organizar os cronogramas de baterias e exibir publicamente pontuações e classificações em tempo real.</span>
                </li>
                <li className="space-y-1 bg-[#fcd535]/5 border border-[#fcd535]/10 p-3 rounded-lg text-foreground">
                  <strong className="text-foreground uppercase tracking-wider text-[11px] block">C. Transparência Esportiva nos Leaderboards</strong>
                  <span>O participante declara estar ciente e concorda que suas informações esportivas de desempenho (nome, equipe, box de treino, categoria e pontuações/resultados das provas) serão exibidas publicamente nos Leaderboards (rankings públicos) em tempo real no site da WODArena para auditoria esportiva e acompanhamento do público.</span>
                </li>
                <li className="space-y-1">
                  <strong className="text-foreground uppercase tracking-wider text-[11px] block">D. Direito de Uso de Imagem</strong>
                  <span>A inscrição e participação presencial no evento autorizam gratuitamente a captura de voz e imagem do atleta (fotos e transmissões de vídeo) para fins informativos, jornalísticos, publicações em mídias digitais e promoção da WODArena e do Organizador Independente da competição.</span>
                </li>
                <li className="space-y-1">
                  <strong className="text-foreground uppercase tracking-wider text-[11px] block">E. Compartilhamento Seguro</strong>
                  <span>Seus dados de faturamento são transmitidos de forma criptografada para gateways processadores de pagamento homologados. Seus dados cadastrais básicos de atleta são compartilhados com o Organizador Independente do respectivo evento para operações locais do campeonato. A WODArena não comercializa dados cadastrais com terceiros.</span>
                </li>
                <li className="space-y-1">
                  <strong className="text-foreground uppercase tracking-wider text-[11px] block">F. Direitos do Titular</strong>
                  <span>O atleta pode solicitar confirmação de tratamento, acesso, retificação ou exclusão de seus dados. A exclusão de dados esportivos em competições já concluídas poderá ser indeferida para a manutenção da integridade histórica e pública dos resultados do campeonato.</span>
                </li>
              </ul>
            </div>
          </section>
        </div>
      </div>

      {/* Footer Summary Notice */}
      <div className="mt-16 rounded-xl border border-card-border bg-card p-6 text-center max-w-2xl mx-auto">
        <FileText className="mx-auto h-8 w-8 text-primary" />
        <p className="mt-3 text-sm font-bold text-foreground">Dúvidas sobre o tratamento de seus dados?</p>
        <p className="mt-1 text-xs text-muted-soft">
          Para solicitar retificação de informações, transferências manuais de inscrições ou obter esclarecimentos adicionais sobre a nossa segurança de dados, fale com a nossa equipe de suporte.
        </p>
      </div>
    </div>
  );
}
