import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import {
  POSTER_SIZES,
  posterNameFontSize,
  type PosterFormat,
  type RegistrationPosterModel
} from '@/lib/registrationPoster';

// Pôster tipográfico (proposta 1B, docs/design/comprovante/): amarelo da marca na
// tela inteira, o nome como imagem e um bloco preto no pé com a confirmação.
// Gerado no servidor para os Stories (1080x1920) e para o e-mail (1200x600).

const YELLOW = '#fcd535';
const INK = '#181a20';
// Amarelo com 13% de tinta, em cor sólida: as linhas repetidas se sobrepõem sem escurecer.
const GHOST = '#dfbe33';
const MUTED_ON_INK = '#929aa5';

const FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts');
type PosterFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 800; style: 'normal' };
let fontsPromise: Promise<PosterFont[]> | null = null;

const loadFonts = (): Promise<PosterFont[]> => {
  if (!fontsPromise) {
    const read = async (file: string) => {
      const buffer = await readFile(join(FONT_DIR, file));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    };
    fontsPromise = Promise.all([
      read('Anton-Regular.ttf'),
      read('Inter-Medium.ttf'),
      read('Inter-ExtraBold.ttf')
    ]).then(([anton, interMedium, interExtraBold]): PosterFont[] => [
      { name: 'Anton', data: anton, weight: 400, style: 'normal' },
      { name: 'Inter', data: interMedium, weight: 500, style: 'normal' },
      { name: 'Inter', data: interExtraBold, weight: 800, style: 'normal' }
    ]).catch((error) => {
      // Falha de leitura não pode ficar guardada: a próxima chamada tenta de novo.
      fontsPromise = null;
      throw error;
    });
  }
  return fontsPromise;
};

const LOGO_TIMEOUT_MS = 3000;
const LOGO_MAX_BYTES = 1_500_000;

// O logo do evento vem de uma URL cadastrada pelo gestor: só é buscado quando está
// no armazenamento do próprio Supabase (evita fazer o servidor chamar hosts
// arbitrários) e em PNG ou JPEG, os formatos que o gerador desenha. Qualquer outra
// coisa cai nas iniciais do evento.
const loadLogoDataUri = async (logoUrl?: string): Promise<string | null> => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!logoUrl || !supabaseUrl) return null;
  try {
    const logo = new URL(logoUrl);
    if (logo.protocol !== 'https:' || logo.host !== new URL(supabaseUrl).host) return null;
    const response = await fetch(logo, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'image/png' && contentType !== 'image/jpeg') return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) return null;
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
};

const upper = { textTransform: 'uppercase' as const };

const LogoMark = ({ size, logo, initials }: { size: number; logo: string | null; initials: string }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.22),
      background: INK,
      color: YELLOW,
      overflow: 'hidden',
      flexShrink: 0,
      fontFamily: 'Anton',
      fontSize: Math.round(size * 0.46)
    }}
  >
    {logo ? (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img src={logo} width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} />
    ) : (
      initials
    )}
  </div>
);

const StoryPoster = ({ model, logo }: { model: RegistrationPosterModel; logo: string | null }) => {
  const { width, height } = POSTER_SIZES.story;
  const padding = 64;
  const nameSize = posterNameFontSize(model.lines, width - padding * 2, { max: 330, min: 130 });
  const ghostSize = Math.round(nameSize * 0.78);
  const footer = [model.instagramHandle, model.copy.viaPlatform].filter(Boolean).join(' · ');
  const facts = [
    { label: model.copy.category, value: model.categoryName },
    { label: model.copy.date, value: model.dateLabel },
    { label: model.copy.box, value: model.box }
  ].filter((fact) => fact.value);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width, height, background: YELLOW, color: INK, fontFamily: 'Inter' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: `${padding}px ${padding}px 0` }}>
        <LogoMark size={96} logo={logo} initials={model.eventInitials} />
        <div style={{ display: 'flex', flex: 1, fontSize: 34, fontWeight: 800, letterSpacing: 2, lineHeight: 1.15, ...upper }}>
          {model.eventName}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          padding: `0 ${padding}px`,
          overflow: 'hidden',
          fontFamily: 'Anton',
          lineHeight: 0.92,
          ...upper
        }}
      >
        {model.ghostTop.map((line, index) => (
          <div key={`top-${index}`} style={{ display: 'flex', fontSize: ghostSize, color: GHOST, whiteSpace: 'nowrap' }}>{line}</div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', margin: '10px 0' }}>
          {model.lines.map((line, index) => (
            <div key={`name-${index}`} style={{ display: 'flex', fontSize: nameSize, lineHeight: 1.02, color: INK, whiteSpace: 'nowrap' }}>{line}</div>
          ))}
        </div>
        {model.ghostBottom.map((line, index) => (
          <div key={`bottom-${index}`} style={{ display: 'flex', fontSize: ghostSize, color: GHOST, whiteSpace: 'nowrap' }}>{line}</div>
        ))}
        {model.members.length > 0 && (
          <div
            style={{
              display: 'flex',
              marginTop: 28,
              fontFamily: 'Inter',
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: 1.5,
              lineHeight: 1.35,
              color: INK
            }}
          >
            {model.members.join(' · ')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 30, background: INK, color: '#ffffff', padding: `52px ${padding}px 60px` }}>
        <div style={{ display: 'flex', fontFamily: 'Anton', fontSize: 96, lineHeight: 1, color: YELLOW, ...upper }}>
          {model.confirmedLabel}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 56, rowGap: 22 }}>
          {facts.map((fact) => (
            <div key={fact.label} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 456 }}>
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, letterSpacing: 3, color: MUTED_ON_INK, ...upper }}>{fact.label}</div>
              <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, lineHeight: 1.15, ...upper }}>{fact.value}</div>
            </div>
          ))}
        </div>
        {footer && <div style={{ display: 'flex', fontSize: 26, fontWeight: 500, color: MUTED_ON_INK }}>{footer}</div>}
      </div>
    </div>
  );
};

const EmailPoster = ({ model, logo }: { model: RegistrationPosterModel; logo: string | null }) => {
  const { width, height } = POSTER_SIZES.email;
  const padding = 52;
  const nameSize = posterNameFontSize(model.lines, 640, { max: 230, min: 96 });
  const tagLines = [model.confirmedLabel, model.categoryName, model.dateLabel].filter(Boolean);

  return (
    <div style={{ display: 'flex', width, height, background: YELLOW, color: INK, padding, fontFamily: 'Inter', gap: 40 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <LogoMark size={64} logo={logo} initials={model.eventInitials} />
          <div style={{ display: 'flex', flex: 1, fontSize: 26, fontWeight: 800, letterSpacing: 1.5, lineHeight: 1.15, ...upper }}>
            {model.eventName}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Anton', lineHeight: 0.88, ...upper }}>
          {model.lines.map((line, index) => (
            <div key={`name-${index}`} style={{ display: 'flex', fontSize: nameSize, whiteSpace: 'nowrap' }}>{line}</div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: 330 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: INK, color: YELLOW, padding: '22px 26px', borderRadius: 8 }}>
          {tagLines.map((line, index) => (
            <div
              key={line}
              style={{
                display: 'flex',
                fontSize: index === 0 ? 26 : 22,
                fontWeight: 800,
                letterSpacing: 2,
                lineHeight: 1.2,
                color: index === 0 ? YELLOW : '#ffffff',
                ...upper
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const renderRegistrationPoster = async (
  model: RegistrationPosterModel,
  format: PosterFormat,
  logoUrl?: string
): Promise<ImageResponse> => {
  const [fonts, logo] = await Promise.all([loadFonts(), loadLogoDataUri(logoUrl)]);
  const size = POSTER_SIZES[format];
  return new ImageResponse(
    format === 'story' ? <StoryPoster model={model} logo={logo} /> : <EmailPoster model={model} logo={logo} />,
    { width: size.width, height: size.height, fonts }
  );
};
