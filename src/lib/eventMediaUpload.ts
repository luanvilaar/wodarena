'use client';

// Story 1.151: 'sponsor' é o logo de patrocinador (só PNG, transparência mantida).
export type EventMediaKind = 'logo' | 'banner' | 'sponsor';

const MEDIA_LIMITS: Record<EventMediaKind, { maxWidth: number; maxHeight: number; quality: number }> = {
  logo: { maxWidth: 512, maxHeight: 512, quality: 0.85 },
  banner: { maxWidth: 1600, maxHeight: 640, quality: 0.82 },
  sponsor: { maxWidth: 600, maxHeight: 300, quality: 1 }
};

// Logo de patrocinador (D5): só PNG, até 2 MB, e sai em PNG para manter o fundo transparente.
const SPONSOR_SOURCE_MAX_BYTES = 2 * 1024 * 1024;

const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_SOURCE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export class EventMediaUploadError extends Error {}

const loadImageBitmapFromFile = async (file: File): Promise<ImageBitmap> => {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  // Fallback para navegadores sem createImageBitmap (Safari antigo).
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<ImageBitmap>((resolve, reject) => {
      const img = new window.Image();
      img.onload = async () => {
        try {
          resolve(await createImageBitmap(img));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new EventMediaUploadError('Não foi possível ler a imagem selecionada.'));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const resolveOutputDimensions = (sourceWidth: number, sourceHeight: number, kind: EventMediaKind) => {
  const { maxWidth, maxHeight } = MEDIA_LIMITS[kind];
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
};

/**
 * Redimensiona e recodifica a imagem em WebP no navegador antes do upload,
 * para que o navio de bytes trafegados dependa do que será exibido, não do
 * arquivo original enviado pelo usuário.
 */
export const compressEventMediaFile = async (file: File, kind: EventMediaKind): Promise<Blob> => {
  if (kind === 'sponsor') {
    if (file.type !== 'image/png') throw new EventMediaUploadError('Só PNG. Exporte o logo em PNG, de preferência com fundo transparente.');
    if (file.size > SPONSOR_SOURCE_MAX_BYTES) throw new EventMediaUploadError('O PNG passa de 2 MB. Reduza o tamanho do logo e envie de novo.');
  }
  if (!ACCEPTED_SOURCE_TYPES.includes(file.type)) {
    throw new EventMediaUploadError('Apenas arquivos PNG, JPEG ou WebP são permitidos.');
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new EventMediaUploadError('A imagem é muito grande. Escolha um arquivo de até 8 MB.');
  }

  const bitmap = await loadImageBitmapFromFile(file);
  try {
    const { width, height } = resolveOutputDimensions(bitmap.width, bitmap.height, kind);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new EventMediaUploadError('Não foi possível processar a imagem neste navegador.');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { quality } = MEDIA_LIMITS[kind];
    const outputType = kind === 'sponsor' ? 'image/png' : 'image/webp';
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, outputType, quality));
    if (!blob) throw new EventMediaUploadError('Falha ao gerar a imagem otimizada.');
    return blob;
  } finally {
    bitmap.close();
  }
};

export const uploadEventMedia = async (file: File, kind: EventMediaKind): Promise<string> => {
  const compressed = await compressEventMediaFile(file, kind);

  const formData = new FormData();
  formData.append('type', kind);
  formData.append('file', compressed, `${kind}.${compressed.type === 'image/png' ? 'png' : 'webp'}`);

  const response = await fetch('/api/admin/media/upload', {
    method: 'POST',
    body: formData
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new EventMediaUploadError(data.error || 'Não foi possível enviar a imagem.');
  }
  if (typeof data.url !== 'string' || !data.url) {
    throw new EventMediaUploadError('Resposta inválida do upload de imagem.');
  }
  return data.url;
};
