import { buildNovaSystemInstruction } from '../../server/novaSystem.ts';
import {
  formatUpstreamError,
  getGeminiClient,
  openChatStreamWithRetry,
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
      history?: unknown;
      focus?: unknown;
      scratchpad?: unknown;
    };

    const validated = validateAndBuildChatContents(body.history);
    if (validated.error || !validated.contents) {
      return new Response(
        JSON.stringify({ error: validated.error || 'Invalid request payload.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const ai = getGeminiClient();
    const systemInstruction = buildNovaSystemInstruction({
      focus: typeof body.focus === 'string' ? body.focus : undefined,
      scratchpad:
        typeof body.scratchpad === 'string' ? body.scratchpad : undefined,
      mode: 'text',
    });

    const geminiStream = await openChatStreamWithRetry(
      ai,
      validated.contents,
      systemInstruction
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of geminiStream) {
            const text = chunk.text;
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`)
              );
            }
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
          );
          controller.close();
        } catch (streamErr) {
          const formatted = formatUpstreamError(streamErr);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: formatted.message })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    const formatted = formatUpstreamError(error);
    return new Response(JSON.stringify({ error: formatted.message }), {
      status: formatted.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
