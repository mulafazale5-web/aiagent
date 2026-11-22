import { buildNovaSystemInstruction } from '../../server/novaSystem.ts';
import {
  formatUpstreamError,
  generateChatReplyWithRetry,
  getGeminiClient,
  synthesizeSpeechWav,
  transcribeAudioTurn,
  validateAndBuildChatContents,
} from '../../server/geminiHelpers.ts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as {
      audioBase64?: unknown;
      mimeType?: unknown;
      history?: unknown;
      focus?: unknown;
      scratchpad?: unknown;
      textOverride?: unknown;
    };

    const ai = getGeminiClient();
    let userTranscript = '';

    if (
      typeof body.textOverride === 'string' &&
      body.textOverride.trim().length > 0
    ) {
      userTranscript = body.textOverride.trim().slice(0, 2000);
    } else {
      if (
        typeof body.audioBase64 !== 'string' ||
        body.audioBase64.length === 0 ||
        typeof body.mimeType !== 'string'
      ) {
        return new Response(
          JSON.stringify({ error: 'Audio data and mimeType are required.' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      userTranscript = await transcribeAudioTurn(
        ai,
        body.audioBase64,
        body.mimeType
      );
    }

    if (!userTranscript) {
      return new Response(JSON.stringify({ empty: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const priorHistory = Array.isArray(body.history) ? body.history : [];
    const mergedHistory = [
      ...priorHistory,
      { role: 'user', text: userTranscript },
    ];
    const validated = validateAndBuildChatContents(mergedHistory);
    if (validated.error || !validated.contents) {
      return new Response(
        JSON.stringify({
          error: validated.error || 'Invalid conversation history.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const systemInstruction = buildNovaSystemInstruction({
      focus: typeof body.focus === 'string' ? body.focus : undefined,
      scratchpad:
        typeof body.scratchpad === 'string' ? body.scratchpad : undefined,
      mode: 'voice',
    });

    const replyText =
      (await generateChatReplyWithRetry(
        ai,
        validated.contents,
        systemInstruction
      )) || 'Could you repeat that part so I can guide you through it?';

    const replyAudioBase64 = await synthesizeSpeechWav(ai, replyText);

    return new Response(
      JSON.stringify({
        userTranscript,
        replyText,
        audioBase64: replyAudioBase64,
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
