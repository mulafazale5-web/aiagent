import { Send } from 'lucide-react';
import { STUDY_FOCUS_OPTIONS, getFocusOption } from '../data/studyPresets';
import { StudyFocusId } from '../types/study';

interface StudyDeckProps {
  activeFocus: StudyFocusId;
  scratchpad: string;
  isSending: boolean;
  onSelectFocus: (focus: StudyFocusId) => void;
  onUsePrompt: (prompt: string) => void;
  onChangeScratchpad: (value: string) => void;
  onShareScratchpad: () => void;
}

export function StudyDeck({
  activeFocus,
  scratchpad,
  isSending,
  onSelectFocus,
  onUsePrompt,
  onChangeScratchpad,
  onShareScratchpad,
}: StudyDeckProps) {
  const currentFocus = getFocusOption(activeFocus);

  return (
    <aside className="flex flex-col gap-5">
      <section
        id="focus-section"
        className="rounded-xl border border-slate-200 bg-white p-5"
      >
        <h2 className="font-display text-base font-semibold text-slate-900">
          Study Focus
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {currentFocus.shortDescription}
        </p>

        <div
          role="tablist"
          aria-label="Study focus categories"
          className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
        >
          {STUDY_FOCUS_OPTIONS.map((option) => {
            const isActive = option.id === activeFocus;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectFocus(option.id)}
                className={`min-h-9 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap truncate focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 border-t border-slate-200/80 pt-4">
          <p className="text-xs font-medium text-slate-500">
            Try asking Nova
          </p>
          <div className="mt-2.5 flex flex-col divide-y divide-slate-100">
            {currentFocus.samplePrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={isSending}
                onClick={() => onUsePrompt(prompt)}
                className="cursor-pointer py-2.5 text-left text-sm leading-snug text-slate-700 transition-colors hover:text-sky-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 rounded"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section
        id="scratchpad-section"
        className="rounded-xl border border-slate-200 bg-white p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Study Scratchpad
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {scratchpad.length} chars
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Draft your equations, essay outline, or code snippet here. Nova sees
          your notes when coaching you.
        </p>

        <textarea
          value={scratchpad}
          onChange={(e) => onChangeScratchpad(e.target.value)}
          rows={5}
          placeholder="Write your attempt, steps, or rough outline..."
          aria-label="Study scratchpad notes"
          className="mt-3 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/60 p-3 font-mono text-xs leading-relaxed text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-sky-600 focus:bg-white focus:outline-none"
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onChangeScratchpad('')}
            disabled={!scratchpad}
            className="cursor-pointer text-xs font-medium text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            Clear Notes
          </button>

          <button
            type="button"
            onClick={onShareScratchpad}
            disabled={!scratchpad.trim() || isSending}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            <Send className="h-3.5 w-3.5 text-sky-700 shrink-0" aria-hidden="true" />
            <span>Check My Attempt</span>
          </button>
        </div>
      </section>

      <section
        id="method-section"
        className="rounded-xl border border-slate-200 bg-white p-5"
      >
        <h2 className="font-display text-base font-semibold text-slate-900">
          How Nova Guides You
        </h2>
        <div className="mt-3 divide-y divide-slate-100 text-sm text-slate-600">
          <div className="py-2.5 first:pt-0">
            <p className="font-medium text-slate-800">
              01. Hints Before Final Answers
            </p>
            <p className="mt-0.5 leading-relaxed">
              Expect the core rule and first step first, followed by a quick
              check-in so you build real recall.
            </p>
          </div>
          <div className="py-2.5">
            <p className="font-medium text-slate-800">
              02. Plain Spoken Math &amp; Logic
            </p>
            <p className="mt-0.5 leading-relaxed">
              Every response avoids clutter and reads naturally aloud across
              both voice calls and text.
            </p>
          </div>
          <div className="py-2.5 last:pb-0">
            <p className="font-medium text-slate-800">
              03. Interrupt Anytime on Voice
            </p>
            <p className="mt-0.5 leading-relaxed">
              Jump in mid-sentence during a call—Nova stops immediately and
              answers your new question.
            </p>
          </div>
        </div>
      </section>
    </aside>
  );
}
