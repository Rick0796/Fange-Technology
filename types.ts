
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

export interface AnalysisResult {
  summary: string;
  keyTakeaways: KeyTakeaway[]; // Updated to object array
  mindMapMermaid: string;
  timestamps: Timestamp[];
  actionItems: string[];
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
