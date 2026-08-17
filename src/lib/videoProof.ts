export type YouTubeVideoProof = {
  videoId: string;
  canonicalUrl: string;
};

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const normalizeYouTubeVideoUrl = (input: unknown): YouTubeVideoProof => {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Informe o link do vídeo no YouTube.');
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Informe uma URL válida do YouTube.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('O vídeo deve usar uma URL segura (https) do YouTube.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = '';

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
    if (['shorts', 'live', 'embed'].includes(parts[0] || '')) videoId = parts[1] || '';
  }

  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error('Use um link válido de vídeo do YouTube (watch, youtu.be, shorts ou live).');
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
};

export const getYouTubeNoCookieEmbedUrl = (videoId: string) => (
  VIDEO_ID_PATTERN.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}` : null
);
