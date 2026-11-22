import {
  formatUpstreamError,
  getGeminiClient,
  synthesizeSpeechWav,
} from '../../server/geminiHelpers.ts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as { text?: unknown };
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Text is required for speech playback.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const ai = getGeminiClient();
    const audioBase64 = await synthesizeSpeechWav(ai, body.text);

    return new Response(
      JSON.stringify({
        audioBase64,
        mimeType: 'audio/wav',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formatted = formatUpstreamError(error);
    return new Response(JSON.stringify({ error: formatted.message }), {
      status: formatted.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
