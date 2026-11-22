import { useCallback, useEffect, useRef, useState } from 'react';
import { StudyFocusId, VoiceCallStatus } from '../types/study';
import { NOVA_INITIAL_GREETING } from '../data/studyPresets';
import { apiFetch } from '../utils/api';

interface VoiceHistoryItem {
  role: 'user' | 'model';
  text: string;
}

interface UseVoiceCallOptions {
  focus: StudyFocusId;
  scratchpad: string;
  getConversationSummary: () => {
    summary: string;
    hasUserHistory: boolean;
    history: VoiceHistoryItem[];
  };
  onInputTranscript: (text: string, isFinal: boolean) => void;
  onOutputTranscript: (text: string, isFinal: boolean) => void;
}

function downsampleTo16k(
  input: Float32Array,
  inputSampleRate: number
): Float32Array {
  if (inputSampleRate === 16000) {
    return input;
  }
  const ratio = inputSampleRate / 16000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    result[i] = count > 0 ? sum / count : input[start] ?? 0;
  }
  return result;
}

function floatTo16BitPcmBase64(float32Array: Float32Array): string {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): {
  samples: Float32Array;
  rms: number;
} {
  const binary = atob(base64);
  const byteLength = binary.length;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer);
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    const f = int16 / 32768;
    float32[i] = f;
    sumSq += f * f;
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0;
  return { samples: float32, rms };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to encode audio recording.'));
    reader.readAsDataURL(blob);
  });
}

function pickSupportedRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export function useVoiceCall({
  focus,
  scratchpad,
  getConversationSummary,
  onInputTranscript,
  onOutputTranscript,
}: UseVoiceCallOptions) {
  const [status, setStatus] = useState<VoiceCallStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const modeRef = useRef<'live-ws' | 'serverless'>('live-ws');
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const statusRef = useRef<VoiceCallStatus>('idle');
  statusRef.current = status;

  // Serverless VAD + MediaRecorder refs
  const vadRafRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const isTurnBusyRef = useRef(false);

  const isMutedRef = useRef(false);
  const micLevelRef = useRef(0);
  const novaLevelRef = useRef(0);

  const inputBufferRef = useRef('');
  const outputBufferRef = useRef('');

  const callbacksRef = useRef({
    onInputTranscript,
    onOutputTranscript,
    getConversationSummary,
  });
  callbacksRef.current = {
    onInputTranscript,
    onOutputTranscript,
    getConversationSummary,
  };

  const focusRef = useRef(focus);
  focusRef.current = focus;
  const scratchpadRef = useRef(scratchpad);
  scratchpadRef.current = scratchpad;

  const clearScheduledPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped sources
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    novaLevelRef.current = 0;
  }, []);

  const cleanupResources = useCallback(() => {
    clearScheduledPlayback();

    if (vadRafRef.current) {
      window.cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = 0;
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
      recorderRef.current = null;
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    isTurnBusyRef.current = false;
    micLevelRef.current = 0;
    novaLevelRef.current = 0;
  }, [clearScheduledPlayback]);

  useEffect(() => {
    if (status !== 'connected') {
      return;
    }
    const timer = window.setInterval(() => {
      setDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  const schedulePcmPlayback = useCallback((base64Data: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;

    const { samples, rms } = base64PcmToFloat32(base64Data);
    if (samples.length === 0) return;

    novaLevelRef.current = Math.min(1, rms * 3.2);

    const audioBuffer = outCtx.createBuffer(1, samples.length, 24000);
    audioBuffer.copyToChannel(new Float32Array(samples), 0);

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startAt = Math.max(now + 0.01, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        novaLevelRef.current = 0;
      }
    };
  }, []);

  const playWavReply = useCallback(
    async (base64Wav: string, mimeType = 'audio/wav') => {
      clearScheduledPlayback();
      if (statusRef.current !== 'connected') return;

      const audio = new Audio(`data:${mimeType};base64,${base64Wav}`);
      audioPlayerRef.current = audio;

      let levelTimer = 0;
      const startWaveformPulse = () => {
        levelTimer = window.setInterval(() => {
          if (!audioPlayerRef.current || audioPlayerRef.current.paused) {
            novaLevelRef.current = 0;
            return;
          }
          novaLevelRef.current = 0.25 + Math.random() * 0.45;
        }, 90);
      };

      audio.onplay = () => startWaveformPulse();
      audio.onended = () => {
        window.clearInterval(levelTimer);
        novaLevelRef.current = 0;
        if (audioPlayerRef.current === audio) {
          audioPlayerRef.current = null;
        }
      };
      audio.onpause = () => {
        window.clearInterval(levelTimer);
        novaLevelRef.current = 0;
      };
      audio.onerror = () => {
        window.clearInterval(levelTimer);
        novaLevelRef.current = 0;
      };

      try {
        await audio.play();
      } catch {
        window.clearInterval(levelTimer);
        novaLevelRef.current = 0;
      }
    },
    [clearScheduledPlayback]
  );

  const submitServerlessVoiceTurn = useCallback(
    async (payload: {
      audioBase64?: string;
      mimeType?: string;
      textOverride?: string;
    }) => {
      if (isTurnBusyRef.current || statusRef.current !== 'connected') return;
      isTurnBusyRef.current = true;

      try {
        if (!payload.textOverride) {
          callbacksRef.current.onInputTranscript('Listening...', false);
        }

        const { history } = callbacksRef.current.getConversationSummary();
        const res = await apiFetch('voice-turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            history: history.slice(-16),
            focus: focusRef.current,
            scratchpad: scratchpadRef.current,
          }),
        });

        const data = (await res.json()) as {
          empty?: boolean;
          userTranscript?: string;
          replyText?: string;
          audioBase64?: string;
          mimeType?: string;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'Voice turn failed.');
        }

        if (data.empty) {
          callbacksRef.current.onInputTranscript('', false);
          return;
        }

        if (data.userTranscript && !payload.textOverride) {
          callbacksRef.current.onInputTranscript(data.userTranscript, true);
        }

        if (data.replyText) {
          callbacksRef.current.onOutputTranscript(data.replyText, true);
        }

        if (data.audioBase64) {
          await playWavReply(data.audioBase64, data.mimeType || 'audio/wav');
        }
      } catch (err) {
        callbacksRef.current.onInputTranscript('', false);
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to complete voice turn.'
        );
      } finally {
        isTurnBusyRef.current = false;
      }
    },
    [playWavReply]
  );

  const startServerlessVoiceCall = useCallback(
    async (stream: MediaStream) => {
      modeRef.current = 'serverless';
      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      inputCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      sourceNodeRef.current = source;
      source.connect(analyser);

      setStatus('connected');
      statusRef.current = 'connected';

      // Greet immediately on serverless voice call start
      const { hasUserHistory } = callbacksRef.current.getConversationSummary();
      const greetingText = hasUserHistory
        ? "I'm on the line with you now. Go ahead and tell me which step you'd like to tackle next."
        : NOVA_INITIAL_GREETING;

      apiFetch('tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: greetingText }),
      })
        .then((r) => r.json())
        .then((d: { audioBase64?: string; mimeType?: string }) => {
          if (d.audioBase64 && statusRef.current === 'connected') {
            playWavReply(d.audioBase64, d.mimeType || 'audio/wav');
          }
        })
        .catch(() => {});

      const timeData = new Float32Array(analyser.fftSize);
      const mimeType = pickSupportedRecorderMime();
      let isRecording = false;
      let speechFrames = 0;
      let silenceStart = 0;
      let recordingStart = 0;
      let chunks: BlobPart[] = [];

      const beginUtteranceCapture = () => {
        if (
          isRecording ||
          isTurnBusyRef.current ||
          isMutedRef.current ||
          statusRef.current !== 'connected'
        ) {
          return;
        }
        // Barge-in: stop Nova playback immediately if student begins speaking
        clearScheduledPlayback();

        isRecording = true;
        recordingStart = performance.now();
        silenceStart = 0;
        chunks = [];

        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        recorder.onstop = async () => {
          isRecording = false;
          recorderRef.current = null;
          if (statusRef.current !== 'connected' || chunks.length === 0) return;
          const recordedType = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: recordedType });
          chunks = [];
          if (blob.size < 1800) {
            callbacksRef.current.onInputTranscript('', false);
            return;
          }
          const base64 = await blobToBase64(blob);
          await submitServerlessVoiceTurn({
            audioBase64: base64,
            mimeType: recordedType,
          });
        };

        recorder.start(250);
        callbacksRef.current.onInputTranscript('Speaking...', false);
      };

      const finishUtteranceCapture = () => {
        if (!isRecording || !recorderRef.current) return;
        if (recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      };

      const monitorVad = () => {
        if (statusRef.current !== 'connected') return;
        analyser.getFloatTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          sumSq += timeData[i] * timeData[i];
        }
        const rms = Math.sqrt(sumSq / timeData.length);
        micLevelRef.current = isMutedRef.current ? 0 : Math.min(1, rms * 4.8);

        if (!isMutedRef.current && !isTurnBusyRef.current) {
          const isSpeaking = rms > 0.026;
          if (!isRecording) {
            if (isSpeaking) {
              speechFrames++;
              if (speechFrames >= 4) {
                speechFrames = 0;
                beginUtteranceCapture();
              }
            } else {
              speechFrames = 0;
            }
          } else {
            const now = performance.now();
            if (isSpeaking) {
              silenceStart = 0;
            } else {
              if (silenceStart === 0) {
                silenceStart = now;
              } else if (now - silenceStart > 1150) {
                finishUtteranceCapture();
              }
            }
            if (now - recordingStart > 18000) {
              finishUtteranceCapture();
            }
          }
        }

        vadRafRef.current = window.requestAnimationFrame(monitorVad);
      };

      vadRafRef.current = window.requestAnimationFrame(monitorVad);
    },
    [clearScheduledPlayback, playWavReply, submitServerlessVoiceTurn]
  );

  const endCall = useCallback(() => {
    if (inputBufferRef.current.trim()) {
      callbacksRef.current.onInputTranscript(inputBufferRef.current.trim(), true);
      inputBufferRef.current = '';
    }
    if (outputBufferRef.current.trim()) {
      callbacksRef.current.onOutputTranscript(outputBufferRef.current.trim(), true);
      outputBufferRef.current = '';
    }
    cleanupResources();
    setStatus('idle');
    statusRef.current = 'idle';
    setIsMuted(false);
    isMutedRef.current = false;
  }, [cleanupResources]);

  const startCall = useCallback(async () => {
    if (statusRef.current === 'connecting' || statusRef.current === 'connected') {
      return;
    }

    setErrorMessage(null);
    setDurationSeconds(0);
    setStatus('connecting');
    statusRef.current = 'connecting';
    setIsMuted(false);
    isMutedRef.current = false;
    inputBufferRef.current = '';
    outputBufferRef.current = '';

    try {
      let supportsLiveWs = true;
      try {
        const healthRes = await apiFetch('health');
        if (healthRes.ok) {
          const health = (await healthRes.json()) as {
            capabilities?: { liveWebsocket?: boolean };
          };
          if (health.capabilities?.liveWebsocket === false) {
            supportsLiveWs = false;
          }
        }
      } catch {
        // Default to trying live WebSocket if health check fails
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      if (!supportsLiveWs) {
        await startServerlessVoiceCall(stream);
        return;
      }

      modeRef.current = 'live-ws';
      let inputCtx: AudioContext;
      try {
        inputCtx = new AudioContext({ sampleRate: 16000 });
      } catch {
        inputCtx = new AudioContext();
      }
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      wsRef.current = ws;
      let wsConnectedOnce = false;

      ws.onopen = () => {
        wsConnectedOnce = true;
        const { summary, hasUserHistory } =
          callbacksRef.current.getConversationSummary();
        ws.send(
          JSON.stringify({
            type: 'init',
            focus: focusRef.current,
            scratchpad: scratchpadRef.current,
            conversationSummary: summary,
            hasUserHistory,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
          };

          if (msg.type === 'ready') {
            setStatus('connected');
            statusRef.current = 'connected';

            let source: MediaStreamAudioSourceNode;
            try {
              source = inputCtx.createMediaStreamSource(stream);
            } catch {
              inputCtx.close().catch(() => {});
              const fallbackCtx = new AudioContext();
              inputCtxRef.current = fallbackCtx;
              inputCtx = fallbackCtx;
              source = fallbackCtx.createMediaStreamSource(stream);
            }

            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            sourceNodeRef.current = source;
            processorRef.current = processor;

            const muteGain = inputCtx.createGain();
            muteGain.gain.value = 0;

            source.connect(processor);
            processor.connect(muteGain);
            muteGain.connect(inputCtx.destination);

            processor.onaudioprocess = (audioEvent) => {
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                return;
              }
              if (isMutedRef.current) {
                micLevelRef.current = 0;
                return;
              }

              const rawChannel = audioEvent.inputBuffer.getChannelData(0);
              const pcm16k = downsampleTo16k(
                rawChannel,
                audioEvent.inputBuffer.sampleRate
              );

              let sumSq = 0;
              for (let i = 0; i < pcm16k.length; i++) {
                sumSq += pcm16k[i] * pcm16k[i];
              }
              const rms = Math.sqrt(sumSq / pcm16k.length);
              micLevelRef.current = Math.min(1, rms * 4.5);

              const base64Audio = floatTo16BitPcmBase64(pcm16k);
              wsRef.current.send(
                JSON.stringify({
                  type: 'audio',
                  data: base64Audio,
                })
              );
            };
          } else if (msg.type === 'audio' && msg.data) {
            schedulePcmPlayback(msg.data);
          } else if (msg.type === 'interrupted') {
            clearScheduledPlayback();
            if (outputBufferRef.current.trim()) {
              callbacksRef.current.onOutputTranscript(
                outputBufferRef.current.trim(),
                true
              );
              outputBufferRef.current = '';
            }
          } else if (msg.type === 'inputTranscript' && msg.text) {
            inputBufferRef.current += msg.text;
            callbacksRef.current.onInputTranscript(inputBufferRef.current, false);
          } else if (msg.type === 'outputTranscript' && msg.text) {
            if (inputBufferRef.current.trim()) {
              callbacksRef.current.onInputTranscript(
                inputBufferRef.current.trim(),
                true
              );
              inputBufferRef.current = '';
            }
            outputBufferRef.current += msg.text;
            callbacksRef.current.onOutputTranscript(
              outputBufferRef.current,
              false
            );
          } else if (msg.type === 'turnComplete') {
            if (inputBufferRef.current.trim()) {
              callbacksRef.current.onInputTranscript(
                inputBufferRef.current.trim(),
                true
              );
              inputBufferRef.current = '';
            }
            if (outputBufferRef.current.trim()) {
              callbacksRef.current.onOutputTranscript(
                outputBufferRef.current.trim(),
                true
              );
              outputBufferRef.current = '';
            }
          } else if (msg.type === 'error') {
            setErrorMessage(
              msg.message || 'Voice call failed. Please try again.'
            );
            cleanupResources();
            statusRef.current = 'error';
            setStatus('error');
          } else if (msg.type === 'closed') {
            if (statusRef.current !== 'error') {
              cleanupResources();
              statusRef.current = 'idle';
              setStatus('idle');
            }
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      ws.onerror = () => {
        if (!wsConnectedOnce && streamRef.current) {
          // Automatic fallback to Netlify serverless voice mode if WebSocket upgrade fails
          inputCtx.close().catch(() => {});
          outputCtx.close().catch(() => {});
          inputCtxRef.current = null;
          outputCtxRef.current = null;
          wsRef.current = null;
          startServerlessVoiceCall(streamRef.current).catch((err) => {
            setErrorMessage(
              err instanceof Error
                ? err.message
                : 'Could not establish a voice connection.'
            );
            cleanupResources();
            statusRef.current = 'error';
            setStatus('error');
          });
          return;
        }

        setErrorMessage('Could not establish a real-time voice connection.');
        cleanupResources();
        statusRef.current = 'error';
        setStatus('error');
      };

      ws.onclose = () => {
        if (
          modeRef.current === 'live-ws' &&
          (statusRef.current === 'connected' ||
            statusRef.current === 'connecting')
        ) {
          cleanupResources();
          statusRef.current = 'idle';
          setStatus('idle');
        }
      };
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow microphone permissions in your browser to start a voice call.'
          : err instanceof Error
          ? err.message
          : 'Unable to start microphone audio.';
      setErrorMessage(msg);
      cleanupResources();
      statusRef.current = 'error';
      setStatus('error');
    }
  }, [
    cleanupResources,
    clearScheduledPlayback,
    schedulePcmPlayback,
    startServerlessVoiceCall,
  ]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) {
        micLevelRef.current = 0;
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          try {
            recorderRef.current.stop();
          } catch {
            // ignore
          }
        }
      }
      return next;
    });
  }, []);

  const sendContextText = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (modeRef.current === 'serverless') {
        submitServerlessVoiceTurn({ textOverride: clean });
        return;
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'text', text: clean }));
      }
    },
    [submitServerlessVoiceTurn]
  );

  return {
    status,
    errorMessage,
    isMuted,
    durationSeconds,
    micLevelRef,
    novaLevelRef,
    startCall,
    endCall,
    toggleMute,
    sendContextText,
  };
}
