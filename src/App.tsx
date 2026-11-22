import { useCallback, useRef, useState } from 'react';
import { ChatThread } from './components/ChatThread';
import { StudyDeck } from './components/StudyDeck';
import { TopBar } from './components/TopBar';
import { VoiceStage } from './components/VoiceStage';
import { NOVA_INITIAL_GREETING } from './data/studyPresets';
import { useVoiceCall } from './hooks/useVoiceCall';
import { apiFetch } from './utils/api';
import {
  ChatImageAttachment,
  ChatMessage,
  StudyFocusId,
} from './types/study';

function formatTimeNow(): string {
  return new Date().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function createInitialGreeting(): ChatMessage {
  return {
    id: `nova-greeting-${Date.now()}`,
    role: 'model',
    text: NOVA_INITIAL_GREETING,
    timestamp: formatTimeNow(),
    channel: 'text',
  };
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createInitialGreeting(),
  ]);
  const [activeFocus, setActiveFocus] = useState<StudyFocusId>('homework');
  const [scratchpad, setScratchpad] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [liveInputCaption, setLiveInputCaption] = useState('');
  const [liveOutputCaption, setLiveOutputCaption] = useState('');

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const getConversationSummary = useCallback(() => {
    const current = messagesRef.current;
    const hasUserHistory = current.some((m) => m.role === 'user');
    const history = current.map((m) => ({
      role: m.role,
      text: m.text,
    }));
    const summary = current
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'Student' : 'Nova'}: ${m.text}`)
      .join('\n');
    return { summary, hasUserHistory, history };
  }, []);

  const handleVoiceInputTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (!isFinal) {
        setLiveInputCaption(text);
        return;
      }
      setLiveInputCaption('');
      const clean = text.trim();
      if (!clean) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `voice-user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text: clean,
          timestamp: formatTimeNow(),
          channel: 'voice',
        },
      ]);
    },
    []
  );

  const handleVoiceOutputTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (!isFinal) {
        setLiveOutputCaption(text);
        return;
      }
      setLiveOutputCaption('');
      const clean = text.trim();
      if (!clean) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `voice-nova-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'model',
          text: clean,
          timestamp: formatTimeNow(),
          channel: 'voice',
        },
      ]);
    },
    []
  );

  const {
    status: callStatus,
    errorMessage: callError,
    isMuted,
    durationSeconds,
    micLevelRef,
    novaLevelRef,
    startCall,
    endCall,
    toggleMute,
    sendContextText,
  } = useVoiceCall({
    focus: activeFocus,
    scratchpad,
    getConversationSummary,
    onInputTranscript: handleVoiceInputTranscript,
    onOutputTranscript: handleVoiceOutputTranscript,
  });

  const handleSendMessage = useCallback(
    async (text: string, image?: ChatImageAttachment) => {
      const trimmed = text.trim();
      if (!trimmed && !image) return;

      setChatError(null);

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: formatTimeNow(),
        channel: 'text',
        image: image
          ? {
              mimeType: image.mimeType,
              data: image.data,
              previewUrl: image.previewUrl,
              name: image.name,
            }
          : undefined,
      };

      // If on an active live voice call and no image attached, inject directly into the live call
      if (callStatus === 'connected' && !image) {
        setMessages((prev) => [...prev, userMessage]);
        sendContextText(trimmed);
        return;
      }

      const assistantId = `nova-${Date.now()}`;
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: 'model',
        text: '',
        timestamp: formatTimeNow(),
        channel: 'text',
        isStreaming: true,
      };

      const updatedHistory = [...messagesRef.current, userMessage];
      setMessages([...updatedHistory, assistantPlaceholder]);
      setIsSending(true);

      try {
        const payloadHistory = updatedHistory.map((m) => ({
          role: m.role,
          text: m.text,
          image: m.image
            ? { mimeType: m.image.mimeType, data: m.image.data }
            : undefined,
        }));

        const response = await apiFetch('chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: payloadHistory,
            focus: activeFocus,
            scratchpad,
          }),
        });

        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errData.error || `Request failed with status ${response.status}.`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Streaming response is unavailable.');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('data:')) continue;
            const jsonStr = trimmedLine.slice(5).trim();
            if (!jsonStr) continue;

            const parsed = JSON.parse(jsonStr) as {
              chunk?: string;
              done?: boolean;
              error?: string;
            };

            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.chunk) {
              accumulated += parsed.chunk;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: accumulated } : m
                )
              );
            }
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text:
                    accumulated.trim() ||
                    'Could you share a bit more about what part you want to work on next?',
                  isStreaming: false,
                }
              : m
          )
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to reach Nova right now.';
        setChatError(message);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsSending(false);
      }
    },
    [activeFocus, scratchpad, callStatus, sendContextText]
  );

  const handleShareScratchpad = useCallback(() => {
    const notes = scratchpad.trim();
    if (!notes) return;
    handleSendMessage(
      `Here is my current attempt from my scratchpad. Can you check my reasoning and guide me on the next step? "${notes}"`
    );
  }, [scratchpad, handleSendMessage]);

  const handleResetSession = useCallback(() => {
    if (callStatus === 'connected' || callStatus === 'connecting') {
      endCall();
    }
    setLiveInputCaption('');
    setLiveOutputCaption('');
    setChatError(null);
    setMessages([createInitialGreeting()]);
  }, [callStatus, endCall]);

  const handleNavigate = useCallback(
    (section: 'workspace' | 'focus' | 'scratchpad' | 'method') => {
      const idMap: Record<typeof section, string> = {
        workspace: 'workspace-stage',
        focus: 'focus-section',
        scratchpad: 'scratchpad-section',
        method: 'method-section',
      };
      const target = document.getElementById(idMap[section]);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    []
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <TopBar
        callStatus={callStatus}
        onStartCall={startCall}
        onEndCall={endCall}
        onNavigate={handleNavigate}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          <div id="workspace-stage" className="lg:col-span-8 flex flex-col">
            <VoiceStage
              status={callStatus}
              errorMessage={callError}
              isMuted={isMuted}
              durationSeconds={durationSeconds}
              micLevelRef={micLevelRef}
              novaLevelRef={novaLevelRef}
              liveInputCaption={liveInputCaption}
              liveOutputCaption={liveOutputCaption}
              onToggleMute={toggleMute}
              onEndCall={endCall}
              onRetryCall={startCall}
            />

            <ChatThread
              messages={messages}
              isSending={isSending}
              chatError={chatError}
              callStatus={callStatus}
              onSendMessage={handleSendMessage}
              onStartCall={startCall}
              onResetSession={handleResetSession}
              onDismissError={() => setChatError(null)}
            />
          </div>

          <div className="lg:col-span-4">
            <StudyDeck
              activeFocus={activeFocus}
              scratchpad={scratchpad}
              isSending={isSending}
              onSelectFocus={setActiveFocus}
              onUsePrompt={(prompt) => handleSendMessage(prompt)}
              onChangeScratchpad={setScratchpad}
              onShareScratchpad={handleShareScratchpad}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
