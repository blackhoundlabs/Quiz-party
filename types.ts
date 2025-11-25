export enum GamePhase {
  LOBBY = 'LOBBY',
  CATEGORY_SELECTION = 'CATEGORY_SELECTION',
  LEVEL_INTRO = 'LEVEL_INTRO',
  QUESTION = 'QUESTION',
  ANSWERS_REVEAL = 'ANSWERS_REVEAL',
  ROUND_RESULT = 'ROUND_RESULT',
  LEVEL_COMPLETE = 'LEVEL_COMPLETE',
  GAME_OVER = 'GAME_OVER',
}

export enum MessageType {
  JOIN = 'JOIN',
  STATE_UPDATE = 'STATE_UPDATE',
  VOTE_CATEGORY = 'VOTE_CATEGORY',
  SUBMIT_ANSWER = 'SUBMIT_ANSWER',
  PLAYER_JOINED = 'PLAYER_JOINED',
  REQUEST_STATE = 'REQUEST_STATE',
  REQUEST_NEXT_STEP = 'REQUEST_NEXT_STEP',
}

export const CHANNEL_NAME = 'neural_quiz_party_v1';

export interface Player {
  id: string;
  name: string;
  avatar: string;
  score: number;
  lastActionTime: number; // For tie-breaking
  selectedCategory?: string;
  currentAnswer?: number; // Index of answer
  roundScore: number;
}

export interface Question {
  text: string;
  options: string[];
  correctIndex: number;
  category: string;
  explanation?: string;
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  currentLevel: number;
  totalLevels: number;
  currentQuestionIndex: number;
  totalQuestionsInLevel: number; // Added to help client know when level ends
  currentQuestion: Question | null;
  availableCategories: string[];
  timeRemaining: number;
  winnerId?: string;
  loading: boolean;
  loadingMessage: string;
}

// For BroadcastChannel communication
export interface NetworkMessage {
  type: MessageType;
  payload: any;
  senderId?: string;
}