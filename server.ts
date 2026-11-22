import 'dotenv/config';
import http from 'http';
import path from 'path';
import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { buildNovaSystemInstruction } from './server/novaSystem.ts';
import {
  formatUpstreamError,
  generateChatReplyWithRetry,
  getGeminiClient,
  openChatStreamWithRetry,
  synthesizeSpeechWav,
  transcribeAudioTurn,
  validateAndBuildChatContents,
} from './server/geminiHelpers.ts';

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      capabilities: {
        liveWebsocket: true,
        voiceTurn: true,
      },
    });
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const { history, focus, scratchpad } = req.body as {
        history?: unknown;
        focus?: unknown;
        scratchpad?: unknown;
      };

      const validated = validateAndBuildChatContents(history);
      if (validated.error || !validated.contents) {
        res
          .status(400)
          .json({ error: validated.error || 'Invalid request payload.' });
        return;
      }

      const ai = getGeminiClient();
      const systemInstruction = buildNovaSystemInstruction({
        focus: typeof focus === 'string' ? focus : undefined,
        scratchpad: typeof scratchpad === 'string' ? scratchpad : undefined,
        mode: 'text',
      });

      const stream = await openChatStreamWithRetry(
        ai,
        validated.contents,
        systemInstruction
      );

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      const formatted = formatUpstreamError(error);
      console.error('[Nova Chat Error]', formatted.status, formatted.message);
      if (!res.headersSent) {
        res.status(formatted.status).json({ error: formatted.message });
      } else {
        res.write(`data: ${JSON.stringify({ error: formatted.message })}\n\n`);
        res.end();
      }
    }
  });

  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      const { text } = req.body as { text?: unknown };
      if (typeof text !== 'string' || text.trim().length === 0) {
        res.status(400).json({ error: 'Text is required for speech playback.' });
        return;
      }

      const ai = getGeminiClient();
      const audioBase64 = await synthesizeSpeechWav(ai, text);

      res.json({
        audioBase64,
        mimeType: 'audio/wav',
      });
    } catch (error) {
      const formatted = formatUpstreamError(error);
      console.error('[Nova TTS Error]', formatted.status, formatted.message);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/voice-turn', async (req: Request, res: Response) => {
    try {
      const { audioBase64, mimeType, history, focus, scratchpad, textOverride } =
        req.body as {
          audioBase64?: unknown;
          mimeType?: unknown;
          history?: unknown;
          focus?: unknown;
          scratchpad?: unknown;
          textOverride?: unknown;
        };

      const ai = getGeminiClient();
      let userTranscript = '';

      if (typeof textOverride === 'string' && textOverride.trim().length > 0) {
        userTranscript = textOverride.trim().slice(0, 2000);
      } else {
        if (
          typeof audioBase64 !== 'string' ||
          audioBase64.length === 0 ||
          typeof mimeType !== 'string'
        ) {
          res
            .status(400)
            .json({ error: 'Audio data and mimeType are required.' });
          return;
        }
        userTranscript = await transcribeAudioTurn(ai, audioBase64, mimeType);
      }

      if (!userTranscript) {
        res.json({ empty: true });
        return;
      }

      const priorHistory = Array.isArray(history) ? history : [];
      const mergedHistory = [
        ...priorHistory,
        { role: 'user', text: userTranscript },
      ];
      const validated = validateAndBuildChatContents(mergedHistory);
      if (validated.error || !validated.contents) {
        res
          .status(400)
          .json({ error: validated.error || 'Invalid conversation history.' });
        return;
      }

      const systemInstruction = buildNovaSystemInstruction({
        focus: typeof focus === 'string' ? focus : undefined,
        scratchpad: typeof scratchpad === 'string' ? scratchpad : undefined,
        mode: 'voice',
      });

      const replyText =
        (await generateChatReplyWithRetry(
          ai,
          validated.contents,
          systemInstruction
        )) || 'Could you repeat that part so I can guide you through it?';

      const replyAudioBase64 = await synthesizeSpeechWav(ai, replyText);

      res.json({
        userTranscript,
        replyText,
        audioBase64: replyAudioBase64,
        mimeType: 'audio/wav',
      });
    } catch (error) {
      const formatted = formatUpstreamError(error);
      console.error(
        '[Nova Voice Turn Error]',
        formatted.status,
        formatted.message
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url ?? '';
    if (reqUrl.startsWith('/ws/live')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null =
      null;
    let isClosing = false;
    let hadError = false;

    const sendSafe = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    clientWs.on('message', async (rawData) => {
      try {
        const parsed = JSON.parse(rawData.toString()) as {
          type?: string;
          data?: string;
          text?: string;
          focus?: string;
          scratchpad?: string;
          conversationSummary?: string;
          hasUserHistory?: boolean;
        };

        if (parsed.type === 'init') {
          if (liveSession) {
            return;
          }

          const ai = getGeminiClient();
          const systemInstruction = buildNovaSystemInstruction({
            focus:
              typeof parsed.focus === 'string' ? parsed.focus : undefined,
            scratchpad:
              typeof parsed.scratchpad === 'string'
                ? parsed.scratchpad
                : undefined,
            conversationSummary:
              typeof parsed.conversationSummary === 'string'
                ? parsed.conversationSummary
                : undefined,
            mode: 'voice',
          });

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Zephyr' },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (!content) return;

                if (content.interrupted) {
                  sendSafe({ type: 'interrupted' });
                }

                if (content.inputTranscription?.text) {
                  sendSafe({
                    type: 'inputTranscript',
                    text: content.inputTranscription.text,
                  });
                }

                if (content.outputTranscription?.text) {
                  sendSafe({
                    type: 'outputTranscript',
                    text: content.outputTranscription.text,
                  });
                }

                for (const part of content.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendSafe({
                      type: 'audio',
                      data: part.inlineData.data,
                    });
                  }
                }

                if (content.turnComplete) {
                  sendSafe({ type: 'turnComplete' });
                }
              },
              onerror: (err: ErrorEvent) => {
                hadError = true;
                const msg =
                  err?.message ||
                  'The voice call connection encountered an error.';
                console.error('[Nova Live Error]', msg);
                sendSafe({ type: 'error', message: msg });
              },
              onclose: (closeEvent?: CloseEvent) => {
                console.log(
                  '[Nova Live Closed]',
                  closeEvent?.code,
                  closeEvent?.reason
                );
                if (!isClosing && !hadError) {
                  sendSafe({ type: 'closed' });
                }
              },
            },
          });

          sendSafe({ type: 'ready' });

          const kickoffText = parsed.hasUserHistory
            ? 'The student just switched onto a live voice call to continue the session. Greet them briefly in one warm sentence referencing where you left off and ask how they want to tackle the next step.'
            : 'The student just started a live voice call. Greet them warmly in one short sentence and ask what they are working on today.';

          liveSession.sendRealtimeInput({ text: kickoffText });
          return;
        }

        if (!liveSession) {
          return;
        }

        if (parsed.type === 'audio' && typeof parsed.data === 'string') {
          liveSession.sendRealtimeInput({
            audio: {
              data: parsed.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (parsed.type === 'text' && typeof parsed.text === 'string') {
          liveSession.sendRealtimeInput({
            text: parsed.text.slice(0, 2000),
          });
        }
      } catch (error) {
        hadError = true;
        const formatted = formatUpstreamError(error);
        console.error('[Nova Live Catch]', formatted.message);
        sendSafe({ type: 'error', message: formatted.message });
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // Ignore close cleanup errors
        }
        liveSession = null;
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Nova Study & Work Partner server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Nova server:', err);
  process.exit(1);
});
