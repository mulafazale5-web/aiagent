import { Content, GoogleGenAI, Part } from '@google/genai';

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
]);

export interface IncomingHistoryItem {
  role: 'user' | 'model';
  text: string;
  image?: {
    data: string;
    mimeType: string;
  };
}

const ENV_KEY_NAMES = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
] as const;

export function hasConfiguredGeminiApiKey(): boolean {
  return Boolean(findConfiguredApiKey());
}

function findConfiguredApiKey(): string {
  const netlifyEnv = (
    globalThis as {
      Netlify?: { env?: { get?: (key: string) => string | undefined } };
    }
  ).Netlify?.env;

  for (const keyName of ENV_KEY_NAMES) {
    const val = process.env[keyName] || netlifyEnv?.get?.(keyName);
    if (val && val.trim().length > 0 && val !== 'MY_GEMINI_API_KEY') {
      return val.trim();
    }
  }
  return '';
}

export function resolveGeminiApiKey(): string {
  const apiKey = findConfiguredApiKey();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add GEMINI_API_KEY in Netlify Site configuration > Environment variables (or Settings > Secrets) and redeploy.'
    );
  }
  return apiKey;
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = resolveGeminiApiKey();
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractReadableMessage(raw: string): string {
  let current = raw.trim();
  for (let i = 0; i < 3; i++) {
    if (!current.startsWith('{')) break;
    try {
      const parsed = JSON.parse(current) as {
        message?: string;
        error?: { message?: string } | string;
      };
      if (typeof parsed.error === 'object' && parsed.error?.message) {
        current = parsed.error.message.trim();
      } else if (typeof parsed.error === 'string') {
        current = parsed.error.trim();
      } else if (typeof parsed.message === 'string') {
        current = parsed.message.trim();
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return current;
}

export function formatUpstreamError(error: unknown): {
  status: number;
  message: string;
} {
  const errObj = error as { status?: number; message?: string };
  const rawMessage =
    errObj?.message ?? 'An unexpected error occurred with Nova.';
  const readable = extractReadableMessage(rawMessage);
  const status = typeof errObj?.status === 'number' ? errObj.status : 500;

  if (
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    status === 403
  ) {
    return {
      status: 403,
      message:
        'Your Gemini API key could not be verified. Please verify GEMINI_API_KEY in your environment settings.',
    };
  }
  if (rawMessage.includes('RESOURCE_EXHAUSTED') || status === 429) {
    return {
      status: 429,
      message:
        'Rate limit reached on the Gemini API. Please wait a moment and try again.',
    };
  }
  if (status === 503 || rawMessage.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message:
        'The AI model is temporarily busy. Please try sending your message again in a moment.',
    };
  }
  if (rawMessage.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 500,
      message: rawMessage,
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: readable || 'An unexpected error occurred with Nova.',
  };
}

function isTransientError(error: unknown): boolean {
  const errObj = error as { status?: number; message?: string };
  const status = errObj?.status;
  const msg = errObj?.message ?? '';
  return (
    status === 503 ||
    status === 429 ||
    status === 500 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function validateAndBuildChatContents(
  history: unknown
): { contents?: Content[]; error?: string } {
  if (!Array.isArray(history) || history.length === 0) {
    return { error: 'Conversation history is required.' };
  }

  const trimmedHistory = history.slice(-40) as IncomingHistoryItem[];
  const contents: Content[] = [];

  for (const item of trimmedHistory) {
    if (
      !item ||
      (item.role !== 'user' && item.role !== 'model') ||
      typeof item.text !== 'string'
    ) {
      return { error: 'Invalid conversation message format.' };
    }

    const parts: Part[] = [];
    if (item.image && typeof item.image.data === 'string') {
      if (!ALLOWED_IMAGE_MIME_TYPES.has(item.image.mimeType)) {
        return { error: 'Unsupported image attachment format.' };
      }
      if (item.image.data.length > 8 * 1024 * 1024) {
        return { error: 'Image attachment exceeds maximum size.' };
      }
      parts.push({
        inlineData: {
          mimeType: item.image.mimeType,
          data: item.image.data,
        },
      });
    }

    const cleanText = item.text.slice(0, 6000);
    if (cleanText.trim().length > 0 || parts.length === 0) {
      parts.push({ text: cleanText });
    }

    contents.push({
      role: item.role,
      parts,
    });
  }

  while (contents.length > 0 && contents[0].role !== 'user') {
    contents.shift();
  }

  if (contents.length === 0) {
    return { error: 'At least one student message is required.' };
  }

  return { contents };
}

export async function openChatStreamWithRetry(
  ai: GoogleGenAI,
  contents: Content[],
  systemInstruction: string
) {
  const attempts: { model: string; delayMs: number }[] = [
    { model: 'gemini-4-hydrogen', delayMs: 0 },
    { model: 'gemini-4-hydrogen', delayMs: 600 },
    { model: 'gemini-3.1-flash-lite', delayMs: 300 },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    try {
      return await ai.models.generateContentStream({
        model: attempt.model,
        contents,
        config: { systemInstruction },
      });
    } catch (err) {
      lastError = err;
      if (!isTransientError(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

export async function generateChatReplyWithRetry(
  ai: GoogleGenAI,
  contents: Content[],
  systemInstruction: string
): Promise<string> {
  const attempts: { model: string; delayMs: number }[] = [
    { model: 'gemini-4-hydrogen', delayMs: 0 },
    { model: 'gemini-4-hydrogen', delayMs: 500 },
    { model: 'gemini-3.1-flash-lite', delayMs: 250 },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents,
        config: { systemInstruction },
      });
      return (response.text ?? '').trim();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

export async function synthesizeSpeechWav(
  ai: GoogleGenAI,
  text: string
): Promise<string> {
  const trimmed = text.trim().slice(0, 1500);
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: trimmed,
            speechMetadata: {
              style: 'Warm, encouraging, clear study partner',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Zephyr' },
        },
      },
    },
  });

  const base64Audio =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Speech synthesis returned no audio.');
  }
  return base64Audio;
}

export function normalizeAudioMimeType(rawMime: string): string {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp3') return 'audio/mpeg';
  return base;
}

export async function transcribeAudioTurn(
  ai: GoogleGenAI,
  base64Audio: string,
  rawMimeType: string
): Promise<string> {
  const mimeType = normalizeAudioMimeType(rawMimeType);
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
    throw new Error('Unsupported recorded audio format.');
  }
  if (base64Audio.length > 8 * 1024 * 1024) {
    throw new Error('Recorded audio exceeds maximum size.');
  }

  const audioPart = {
    inlineData: {
      mimeType,
      data: base64Audio,
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          audioPart,
          {
            text: 'Transcribe the spoken student audio accurately in plain text. If there is only silence or background noise, return an empty string.',
          },
        ],
      },
    });
    return (response.text ?? '').trim();
  } catch (err) {
    if (!isTransientError(err)) {
      throw err;
    }
    const fallback = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          audioPart,
          {
            text: 'Return only the exact plain-text transcription of what the speaker said. If silent, return an empty string.',
          },
        ],
      },
    });
    return (fallback.text ?? '').trim();
  }
}
