import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ImagePlus,
  Phone,
  RotateCcw,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  ChatImageAttachment,
  ChatMessage,
  VoiceCallStatus,
} from '../types/study';

interface ChatThreadProps {
  messages: ChatMessage[];
  isSending: boolean;
  chatError: string | null;
  callStatus: VoiceCallStatus;
  onSendMessage: (text: string, image?: ChatImageAttachment) => void;
  onStartCall: () => void;
  onResetSession: () => void;
  onDismissError: () => void;
}

export function ChatThread({
  messages,
  isSending,
  chatError,
  callStatus,
  onSendMessage,
  onStartCall,
  onResetSession,
  onDismissError,
}: ChatThreadProps) {
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<ChatImageAttachment | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [loadingTtsId, setLoadingTtsId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleTextareaChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = draft.trim();
    if ((!trimmed && !attachment) || isSending) return;

    onSendMessage(
      trimmed || 'Please review this image and guide me on the first step.',
      attachment ?? undefined
    );
    setDraft('');
    setAttachment(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
    if (!validTypes.includes(file.type as (typeof validTypes)[number])) {
      setTtsError('Please attach a PNG, JPEG, or WebP image.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setTtsError('Please keep image attachments under 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.split(',')[1] ?? '';
      if (base64) {
        setTtsError(null);
        setAttachment({
          data: base64,
          mimeType: file.type as ChatImageAttachment['mimeType'],
          previewUrl: result,
          name: file.name,
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleListen = async (message: ChatMessage) => {
    setTtsError(null);

    if (playingMessageId === message.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingMessageId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingMessageId(null);
    setLoadingTtsId(message.id);

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.text }),
      });
      const data = (await res.json()) as {
        audioBase64?: string;
        mimeType?: string;
        error?: string;
      };

      if (!res.ok || !data.audioBase64) {
        throw new Error(data.error || 'Unable to generate audio.');
      }

      const audio = new Audio(
        `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`
      );
      audioRef.current = audio;
      setPlayingMessageId(message.id);

      audio.onended = () => {
        setPlayingMessageId(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingMessageId(null);
        audioRef.current = null;
      };
      await audio.play();
    } catch (err) {
      setTtsError(
        err instanceof Error ? err.message : 'Could not play speech audio.'
      );
      setPlayingMessageId(null);
    } finally {
      setLoadingTtsId(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
        <div>
          <h1 className="font-display text-lg font-semibold text-slate-900">
            Study &amp; Work Session
          </h1>
          <p className="text-xs text-slate-500">
            Unified text chat and live voice transcript
          </p>
        </div>

        <button
          type="button"
          onClick={onResetSession}
          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>New Session</span>
        </button>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-5 py-5 space-y-6 min-h-[380px] max-h-[560px]"
        role="log"
        aria-live="polite"
        aria-label="Conversation history with Nova"
      >
        {messages.map((msg) => {
          const isNova = msg.role === 'model';
          const isPlaying = playingMessageId === msg.id;
          const isLoadingAudio = loadingTtsId === msg.id;

          return (
            <article
              key={msg.id}
              className={`flex flex-col ${isNova ? 'items-start' : 'items-end'}`}
            >
              <div className="mb-1.5 flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">
                  {isNova ? 'Nova' : 'You'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{msg.timestamp}</span>
                <span aria-hidden="true">·</span>
                <span>{msg.channel === 'voice' ? 'Voice' : 'Text'}</span>
              </div>

              <div
                className={`max-w-[68ch] rounded-xl px-4 py-3 text-[15px] leading-[1.6] ${
                  isNova
                    ? 'border border-slate-200 bg-slate-50/75 text-slate-900'
                    : 'bg-sky-700 text-white'
                }`}
              >
                {msg.image && (
                  <div className="mb-2.5 overflow-hidden rounded-lg border border-black/10 bg-white">
                    <img
                      src={
                        msg.image.previewUrl ||
                        `data:${msg.image.mimeType};base64,${msg.image.data}`
                      }
                      alt={msg.image.name || 'Attached study problem'}
                      referrerPolicy="no-referrer"
                      className="max-h-56 w-auto object-contain"
                    />
                  </div>
                )}

                <p className="whitespace-pre-wrap break-words">
                  {msg.text || (msg.isStreaming ? 'Thinking...' : '')}
                </p>

                {isNova && !msg.isStreaming && msg.text.trim().length > 0 && (
                  <div className="mt-2.5 flex items-center justify-end border-t border-slate-200/70 pt-2">
                    <button
                      type="button"
                      onClick={() => handleListen(msg)}
                      disabled={isLoadingAudio}
                      className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 transition-colors hover:text-sky-800 disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 rounded"
                    >
                      {isPlaying ? (
                        <>
                          <Square className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Stop Audio</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            {isLoadingAudio ? 'Generating Voice...' : 'Listen'}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {(chatError || ttsError) && (
        <div
          role="alert"
          className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900"
        >
          <span>{chatError || ttsError}</span>
          <button
            type="button"
            onClick={() => {
              onDismissError();
              setTtsError(null);
            }}
            aria-label="Dismiss error"
            className="cursor-pointer rounded p-1 text-red-700 hover:bg-red-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="border-t border-slate-200 bg-slate-50/50 p-4"
      >
        {attachment && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={attachment.previewUrl}
                alt={attachment.name}
                referrerPolicy="no-referrer"
                className="h-10 w-10 rounded object-cover border border-slate-200 shrink-0"
              />
              <span className="truncate text-xs font-medium text-slate-700">
                {attachment.name}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              aria-label="Remove attached image"
              className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 shrink-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach problem photo or screenshot"
            aria-label="Attach problem photo or screenshot"
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
          </button>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask about a problem, share your first step, or outline a project..."
            aria-label="Message Nova"
            className="min-h-10 max-h-40 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none"
          />

          {callStatus === 'idle' && (
            <button
              type="button"
              onClick={onStartCall}
              title="Switch to voice call"
              aria-label="Start voice call"
              className="hidden sm:inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
            >
              <Phone className="h-3.5 w-3.5 text-sky-700 shrink-0" aria-hidden="true" />
              <span>Voice</span>
            </button>
          )}

          <button
            type="submit"
            disabled={(!draft.trim() && !attachment) || isSending}
            aria-label="Send message"
            className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            <span>Send</span>
            <ArrowUp className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}
