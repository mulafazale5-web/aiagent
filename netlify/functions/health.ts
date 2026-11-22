import { hasConfiguredGeminiApiKey } from '../../server/geminiHelpers.ts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      status: 'ok',
      envConfigured: hasConfiguredGeminiApiKey(),
      capabilities: {
        liveWebsocket: false,
        voiceTurn: true,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
