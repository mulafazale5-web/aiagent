import { MutableRefObject, useEffect, useRef } from 'react';
import { Mic, MicOff, PhoneOff, AlertCircle, Radio } from 'lucide-react';
import { VoiceCallStatus } from '../types/study';

interface VoiceStageProps {
  status: VoiceCallStatus;
  errorMessage: string | null;
  isMuted: boolean;
  durationSeconds: number;
  micLevelRef: MutableRefObject<number>;
  novaLevelRef: MutableRefObject<number>;
  liveInputCaption: string;
  liveOutputCaption: string;
  onToggleMute: () => void;
  onEndCall: () => void;
  onRetryCall: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function VoiceStage({
  status,
  errorMessage,
  isMuted,
  durationSeconds,
  micLevelRef,
  novaLevelRef,
  liveInputCaption,
  liveOutputCaption,
  onToggleMute,
  onEndCall,
  onRetryCall,
}: VoiceStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (status !== 'connected' && status !== 'connecting') {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let animId = 0;
    let phase = 0;
    let smoothedMic = 0;
    let smoothedNova = 0;

    const drawFrame = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const targetMic = isMuted ? 0 : micLevelRef.current;
      const targetNova = novaLevelRef.current;
      smoothedMic += (targetMic - smoothedMic) * 0.25;
      smoothedNova += (targetNova - smoothedNova) * 0.25;

      const barCount = 36;
      const gap = 5;
      const barWidth = Math.max(3, (width - gap * (barCount - 1)) / barCount);
      const centerY = height / 2;

      for (let i = 0; i < barCount; i++) {
        const normPos = i / (barCount - 1);
        const envelope = Math.sin(normPos * Math.PI);
        const activeEnergy = Math.max(smoothedNova, smoothedMic);
        const isNovaSpeaking = smoothedNova >= smoothedMic && smoothedNova > 0.03;

        let barHeight = 6;
        if (status === 'connected') {
          if (prefersReducedMotion) {
            barHeight = 6 + activeEnergy * (height * 0.55) * envelope;
          } else {
            const waveA = Math.sin(phase * 1.4 + i * 0.35);
            const waveB = Math.cos(phase * 0.9 - i * 0.22);
            const ripple = 0.5 + 0.5 * (waveA * 0.6 + waveB * 0.4);
            const idleFloor = 5 + ripple * 4 * envelope;
            barHeight = Math.max(
              idleFloor,
              6 + activeEnergy * (height * 0.72) * envelope * (0.45 + 0.55 * ripple)
            );
          }
        } else {
          barHeight = 5 + 3 * envelope;
        }

        const x = i * (barWidth + gap);
        const y = centerY - barHeight / 2;

        if (isNovaSpeaking) {
          ctx.fillStyle = '#0369A1';
        } else if (smoothedMic > 0.03 && !isMuted) {
          ctx.fillStyle = '#059669';
        } else {
          ctx.fillStyle = '#CBD5E1';
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      ctx.restore();

      if (!prefersReducedMotion) {
        phase += 0.07;
      }
      animId = window.requestAnimationFrame(drawFrame);
    };

    animId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(animId);
  }, [status, isMuted, micLevelRef, novaLevelRef]);

  if (status === 'idle') {
    return null;
  }

  if (status === 'error') {
    return (
      <section
        aria-live="polite"
        className="mb-4 rounded-xl border border-red-200 bg-red-50/70 px-5 py-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-red-900">
                Voice call could not connect
              </p>
              <p className="mt-0.5 text-sm text-red-800">
                {errorMessage || 'Please check your microphone permission and try again.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRetryCall}
            className="min-h-10 cursor-pointer rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            Try Again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Live voice call with Nova"
      className="mb-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Radio
            className={`h-4 w-4 shrink-0 ${
              status === 'connected' ? 'text-emerald-700' : 'text-sky-700'
            }`}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-slate-900">
              {status === 'connected'
                ? 'Live Voice Call'
                : 'Connecting Voice Call'}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="font-mono text-xs text-slate-600 tabular-nums">
              {formatDuration(durationSeconds)}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-xs text-slate-600">
              {isMuted ? 'Microphone muted' : 'Speak naturally—interrupt anytime'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={isMuted}
            className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
              isMuted
                ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
            }`}
          >
            {isMuted ? (
              <MicOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          <button
            type="button"
            onClick={onEndCall}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            <PhoneOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>End Call</span>
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="h-12 w-full sm:w-64 shrink-0 rounded-lg bg-slate-50 px-3 py-1.5 border border-slate-200/80">
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            aria-label="Real-time voice audio waveform"
          />
        </div>

        <div className="min-w-0 flex-1 text-sm text-slate-700">
          {liveOutputCaption ? (
            <p className="leading-relaxed">
              <span className="font-semibold text-sky-800">Nova: </span>
              <span>{liveOutputCaption}</span>
            </p>
          ) : liveInputCaption ? (
            <p className="leading-relaxed">
              <span className="font-semibold text-emerald-800">You: </span>
              <span>{liveInputCaption}</span>
            </p>
          ) : (
            <p className="text-slate-500">
              {status === 'connecting'
                ? 'Preparing real-time audio channel with Nova...'
                : 'Listening—go ahead whenever you are ready.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
