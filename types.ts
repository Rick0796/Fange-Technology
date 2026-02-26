
export enum AnalysisStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export type AnalysisMode = 'FAST' | 'DEEP';

export interface Timestamp {
  time: string;
  seconds: number;
  description: string;
}

export interface KeyTakeaway {
  point: string;
  detail: string;
}

export interface SoraPrompt {
  title: string;
  fullPrompt: string;
}

export interface ViralContent {
  copies: string[];
  script: string;
  soraPrompts?: SoraPrompt[];
}

export interface VideoStructure {
  coreProposition: string;
  openingType: string;
  conflictStructure: string;
  progressionLogic: string;
  psychologicalHook: string;
  climaxSentence: string;
  languageFeatures: string;
  emotionalCurve: string;
  viewerReward: string;
}

export interface AnalysisResult {
  summary: string;
  keyTakeaways: KeyTakeaway[];
  videoStructure: VideoStructure;
  timestamps: Timestamp[];
  viralContent: ViralContent;
  fileUri?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface HistoryItem {
  id: string;
  date: string;
  fileName: string;
  result: AnalysisResult;
  mode: AnalysisMode;
}
