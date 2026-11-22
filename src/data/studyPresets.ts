import { StudyFocusId, StudyFocusOption } from '../types/study';

export const NOVA_INITIAL_GREETING =
  "Hi there, I'm Nova, and I'm glad to be studying with you today—what are you working on, like homework, exam revision, a coding project, or planning your schedule?";

export const STUDY_FOCUS_OPTIONS: StudyFocusOption[] = [
  {
    id: 'homework',
    label: 'Homework',
    shortDescription: 'Step-by-step reasoning for math, science, and problem sets.',
    starterPrompt:
      'I am stuck on solving two x plus five equals seventeen. Can you guide me through the first step?',
    samplePrompts: [
      'Help me solve 3x minus 7 equals 14 step by step.',
      'Why does photosynthesis need both light reactions and the Calvin cycle?',
      'I know the answer is 42, wait just give me the answer for question 4.',
    ],
  },
  {
    id: 'exam',
    label: 'Exam Prep',
    shortDescription: 'Active recall check-ins and concept explanations before test day.',
    starterPrompt:
      'Quiz me on cellular respiration and tell me if my explanation of ATP makes sense.',
    samplePrompts: [
      'Test me on the difference between mitosis and meiosis.',
      'Can you check my understanding of supply and demand shifts?',
      'Give me a quick practice check-in on derivatives.',
    ],
  },
  {
    id: 'coding',
    label: 'Coding',
    shortDescription: 'Spot logic bugs, structure functions, and trace edge cases.',
    starterPrompt:
      'My loop keeps skipping the last item in the array. Can you help me trace why?',
    samplePrompts: [
      'Why would a binary search get stuck in an infinite loop?',
      'Help me outline the logic for a task tracker before I write code.',
      'My recursive function hits a stack overflow—what should I check first?',
    ],
  },
  {
    id: 'schedule',
    label: 'Schedule',
    shortDescription: 'Organize study blocks, assignments, and freelance deadlines.',
    starterPrompt:
      'I have a calculus quiz on Thursday and a client site due Friday. Help me plan my week.',
    samplePrompts: [
      'Break down a 2-hour study block so I do not burn out.',
      'Help me prioritize three overdue readings and a lab report.',
      'How should I estimate time for a freelance landing page project?',
    ],
  },
];

export function getFocusOption(id: StudyFocusId): StudyFocusOption {
  return (
    STUDY_FOCUS_OPTIONS.find((item) => item.id === id) ?? STUDY_FOCUS_OPTIONS[0]
  );
}
