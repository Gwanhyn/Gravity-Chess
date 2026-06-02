export type Player = 1 | 2;
export type EmptyCell = 0;
export type ObstacleCell = -1;
export type Cell = EmptyCell | ObstacleCell | Player;
export type GravityDirection = 'down' | 'up';
export type GameStatus = 'playing' | 'won' | 'draw';
export type ActionMode = 'drop' | 'bomb';
export type MatchMode = 'local' | 'ai';
export type AiDifficulty = 'easy' | 'medium' | 'hard';
export type MoveKind =
  | 'drop'
  | 'bomb'
  | 'flip'
  | 'check'
  | 'undo'
  | 'undo-request'
  | 'undo-accept'
  | 'undo-decline'
  | 'reset'
  | 'timeout';

export interface Position {
  row: number;
  col: number;
}

export interface BoardOptions {
  rows: number;
  cols: number;
  winLength: number;
  wrapHorizontal: boolean;
  wrapVertical: boolean;
  obstaclesEnabled: boolean;
  obstacleCount: number;
}

export interface GameSettings extends BoardOptions {
  autoWinCheckEnabled: boolean;
  topologyPerspectiveEnabled: boolean;
  bombsEnabled: boolean;
  gravityFlipEnabled: boolean;
  matchMode: MatchMode;
  aiDifficulty: AiDifficulty;
  turnTimerEnabled: boolean;
  turnSeconds: number;
  totalTimerEnabled: boolean;
  totalSeconds: number;
}

export interface WinResult {
  player: Player;
  line: Position[];
  direction: Position;
}

export interface BombResult {
  center: Position;
  removed: Position[];
}

export interface MoveRecord {
  id: number;
  kind: MoveKind;
  player?: Player;
  label: string;
  position?: Position;
  removed?: Position[];
}

export interface EngineSnapshot {
  matrix: Cell[][];
  currentPlayer: Player;
  status: GameStatus;
  winner: Player | null;
  winLine: Position[];
  gravity: GravityDirection;
  bombsLeft: Record<Player, number>;
  flipsLeft: Record<Player, number>;
  turnRemaining: number;
  totalRemaining: Record<Player, number>;
  moves: MoveRecord[];
}

export interface SerializedGameState {
  settings: GameSettings;
  matrix: Cell[][];
  currentPlayer: Player;
  status: GameStatus;
  winner: Player | null;
  winLine: Position[];
  gravity: GravityDirection;
  bombsLeft: Record<Player, number>;
  flipsLeft: Record<Player, number>;
  turnRemaining: number;
  totalRemaining: Record<Player, number>;
  moves: MoveRecord[];
  logEntries: MoveRecord[];
  replayFrames: ReplayFrame[];
  historyDepth: number;
}

export interface ReplayFrame {
  matrix: Cell[][];
  currentPlayer: Player;
  gravity: GravityDirection;
  status: GameStatus;
  winner: Player | null;
  winLine: Position[];
  label: string;
}

export interface MoveOutcome {
  ok: boolean;
  kind?: MoveKind;
  player?: Player;
  position?: Position;
  removed?: Position[];
  win?: WinResult | null;
  message?: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  rows: 5,
  cols: 7,
  winLength: 4,
  wrapHorizontal: false,
  wrapVertical: false,
  obstaclesEnabled: false,
  obstacleCount: 2,
  autoWinCheckEnabled: true,
  topologyPerspectiveEnabled: false,
  bombsEnabled: false,
  gravityFlipEnabled: false,
  matchMode: 'local',
  aiDifficulty: 'medium',
  turnTimerEnabled: false,
  turnSeconds: 20,
  totalTimerEnabled: false,
  totalSeconds: 5 * 60
};

export function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}
