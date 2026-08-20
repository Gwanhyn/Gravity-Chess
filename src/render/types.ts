import type { Board } from '../core/Board';
import type {
  ActionMode,
  Cell,
  GameStatus,
  GravityDirection,
  MoveOutcome,
  Player,
  Position,
  ReplayFrame
} from '../core/types';

export interface RenderState {
  matrix: Cell[][];
  rows: number;
  cols: number;
  currentPlayer: Player;
  gravity: GravityDirection;
  status: GameStatus;
  winner: Player | null;
  winLine: Position[];
  actionMode: ActionMode;
  previewEnabled: boolean;
  scoreSkew: number;
  topologyPerspectiveEnabled: boolean;
  wrapHorizontal: boolean;
  wrapVertical: boolean;
}

export interface GameRenderer {
  setBoard(board: Board): void;
  sync(state: RenderState): void;
  setReplayFrame(frame: ReplayFrame | null): void;
  setHoverFromEvent(event: PointerEvent): number | null;
  clearHover(): void;
  getColumnFromEvent(event: PointerEvent | MouseEvent): number | null;
  animateMove(outcome: MoveOutcome, before?: RenderState, after?: RenderState): Promise<void>;
  animateFlash(): Promise<void>;
  destroy(): void;
}

export function cloneRenderState(state: RenderState): RenderState {
  return {
    ...state,
    matrix: state.matrix.map((row) => [...row]),
    winLine: state.winLine.map((cell) => ({ ...cell }))
  };
}

