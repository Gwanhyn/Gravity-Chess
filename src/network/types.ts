import type { ActionMode, GameSettings, MoveOutcome, Player, SerializedGameState } from '../core/types';

export type OnlineRole = Player | 'spectator';

export interface OnlinePlayers {
  red: boolean;
  gold: boolean;
  spectators: number;
}

export interface UndoRequest {
  id: string;
  requester: Player;
}

export interface OnlineRoomState {
  roomCode: string;
  role: OnlineRole;
  isHost: boolean;
  players: OnlinePlayers;
  pendingUndoRequest: UndoRequest | null;
  state: SerializedGameState;
  message?: string;
  outcome?: MoveOutcome;
}

export interface OnlineAction {
  kind: 'drop' | 'check' | 'flip' | 'undo-request' | 'undo-accept' | 'undo-decline' | 'reset' | 'topology';
  col?: number;
  mode?: ActionMode;
  settings?: GameSettings;
  wrapHorizontal?: boolean;
  wrapVertical?: boolean;
}

export interface OnlineError {
  message: string;
}

export interface ServerToClientEvents {
  'room:state': (payload: OnlineRoomState) => void;
  'room:error': (payload: OnlineError) => void;
}

export interface ClientToServerEvents {
  'room:create': (settings: GameSettings) => void;
  'room:join': (roomCode: string) => void;
  'room:leave': () => void;
  'game:action': (action: OnlineAction) => void;
}
