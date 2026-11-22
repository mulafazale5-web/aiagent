import { Phone, PhoneOff } from 'lucide-react';
import { VoiceCallStatus } from '../types/study';

interface TopBarProps {
  callStatus: VoiceCallStatus;
  onStartCall: () => void;
  onEndCall: () => void;
  onNavigate: (section: 'workspace' | 'focus' | 'scratchpad' | 'method') => void;
}

export function TopBar({
  callStatus,
  onStartCall,
  onEndCall,
  onNavigate,
}: TopBarProps) {
  const isCallActive = callStatus === 'connected' || callStatus === 'connecting';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('workspace');
          }}
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600 rounded"
        >
          Nova
        </a>

        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className="cursor-pointer py-1 hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600 rounded"
          >
            Study Session
          </button>
          <button
            type="button"
            onClick={() => onNavigate('focus')}
            className="cursor-pointer py-1 hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600 rounded"
          >
            Focus Modes
          </button>
          <button
            type="button"
            onClick={() => onNavigate('scratchpad')}
            className="cursor-pointer py-1 hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600 rounded"
          >
            Scratchpad
          </button>
          <button
            type="button"
            onClick={() => onNavigate('method')}
            className="cursor-pointer py-1 hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600 rounded"
          >
            How Nova Helps
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          {isCallActive ? (
            <button
              type="button"
              onClick={onEndCall}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              <PhoneOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>End Voice Call</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartCall}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Start Voice Call</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
