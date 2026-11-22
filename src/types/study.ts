export type StudyFocusId = 'homework' | 'exam' | 'coding' | 'schedule';

export interface StudyFocusOption {
  id: StudyFocusId;
  label: string;
  shortDescription: string;
  starterPrompt: string;
  samplePrompts: string[];
}

export type MessageChannel = 'text' | 'voice';

export interface ChatImageAttachment {
  data: string; // base64 without data URL prefix
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  previewUrl: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  channel: MessageChannel;
  image?: {
    mimeType: string;
    data: string;
    previewUrl?: string;
    name?: string;
  };
  isStreaming?: boolean;
}

export type VoiceCallStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error';
