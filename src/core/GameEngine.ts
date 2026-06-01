import { Board } from './Board';
import {
  DEFAULT_SETTINGS,
  otherPlayer,
  type ActionMode,
  type AiDifficulty,
  type Cell,
  type EngineSnapshot,
  type GameSettings,
  type GravityDirection,
  type MoveKind,
  type MoveOutcome,
  type MoveRecord,
  type Player,
  type Position,
  type ReplayFrame,
  type WinResult
} from './types';

const PLAYER_NAMES: Record<Player, string> = {
  1: '红方',
  2: '金方'
};

const DIRECTIONS: Position[] = [
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: -1 }
];

export class GameEngine {
  board: Board;
  settings: GameSettings;
  currentPlayer: Player = 1;
  status: 'playing' | 'won' | 'draw' = 'playing';
  winner: Player | null = null;
  winLine: Position[] = [];
  gravity: GravityDirection = 'down';
  bombsLeft: Record<Player, number> = { 1: 0, 2: 0 };
  flipsLeft: Record<Player, number> = { 1: 0, 2: 0 };
  turnRemaining = DEFAULT_SETTINGS.turnSeconds;
  totalRemaining: Record<Player, number> = {
    1: DEFAULT_SETTINGS.totalSeconds,
    2: DEFAULT_SETTINGS.totalSeconds
  };
  history: EngineSnapshot[] = [];
  moves: MoveRecord[] = [];
  replayFrames: ReplayFrame[] = [];

  private moveSequence = 0;

  constructor(settings: Partial<GameSettings> = {}) {
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...settings });
    this.board = new Board(this.settings);
    this.reset(this.settings);
  }

  reset(settings: Partial<GameSettings> = this.settings): void {
    this.settings = normalizeSettings({ ...this.settings, ...settings });
    this.board = new Board(this.settings);
    this.currentPlayer = 1;
    this.status = 'playing';
    this.winner = null;
    this.winLine = [];
    this.gravity = 'down';
    this.bombsLeft = {
      1: this.settings.bombsEnabled ? 1 : 0,
      2: this.settings.bombsEnabled ? 1 : 0
    };
    this.flipsLeft = {
      1: this.settings.gravityFlipEnabled ? 1 : 0,
      2: this.settings.gravityFlipEnabled ? 1 : 0
    };
    this.turnRemaining = this.settings.turnSeconds;
    this.totalRemaining = {
      1: this.settings.totalSeconds,
      2: this.settings.totalSeconds
    };
    this.history = [];
    this.moves = [];
    this.moveSequence = 0;
    this.replayFrames = [this.createReplayFrame('开局')];
  }

  playColumn(col: number, mode: ActionMode): MoveOutcome {
    if (this.status !== 'playing') {
      return { ok: false, message: '对局已结束' };
    }

    if (mode === 'bomb') {
      return this.useBomb(col);
    }

    return this.drop(col);
  }

  drop(col: number): MoveOutcome {
    const player = this.currentPlayer;
    const previewRow = this.board.findDropRow(col, this.gravity);
    if (previewRow === null) {
      return { ok: false, message: '该列无法落子' };
    }

    this.pushHistory();
    const position = this.board.dropPiece(col, player, this.gravity);
    if (!position) {
      this.history.pop();
      return { ok: false, message: '该列无法落子' };
    }

    const win = this.board.checkWin(position.row, position.col);
    const label = `${PLAYER_NAMES[player]} 落子 ${col + 1}`;
    this.recordMove('drop', player, label, position);
    this.finishAction(win, player);
    this.replayFrames.push(this.createReplayFrame(label));

    return {
      ok: true,
      kind: 'drop',
      player,
      position,
      win
    };
  }

  useBomb(col: number): MoveOutcome {
    if (!this.settings.bombsEnabled || this.bombsLeft[this.currentPlayer] <= 0) {
      return { ok: false, message: '炸弹不可用' };
    }

    const previewRow = this.board.findDropRow(col, this.gravity);
    if (previewRow === null) {
      return { ok: false, message: '该列无法投放炸弹' };
    }

    const player = this.currentPlayer;
    this.pushHistory();
    const result = this.board.detonateAtColumn(col, this.gravity);
    if (!result) {
      this.history.pop();
      return { ok: false, message: '该列无法投放炸弹' };
    }

    this.bombsLeft[player] -= 1;
    const win = this.board.scanForWinner(player);
    const label = `${PLAYER_NAMES[player]} 炸弹 ${col + 1}`;
    this.recordMove('bomb', player, label, result.center, result.removed);
    this.finishAction(win, player);
    this.replayFrames.push(this.createReplayFrame(label));

    return {
      ok: true,
      kind: 'bomb',
      player,
      position: result.center,
      removed: result.removed,
      win
    };
  }

  flipGravity(): MoveOutcome {
    if (this.status !== 'playing') {
      return { ok: false, message: '对局已结束' };
    }
    if (!this.settings.gravityFlipEnabled || this.flipsLeft[this.currentPlayer] <= 0) {
      return { ok: false, message: '重力反转不可用' };
    }

    const player = this.currentPlayer;
    this.pushHistory();
    this.gravity = this.gravity === 'down' ? 'up' : 'down';
    this.board.flipGravity(this.gravity);
    this.flipsLeft[player] -= 1;

    const win = this.board.scanForWinner(player);
    const label = `${PLAYER_NAMES[player]} 反转`;
    this.recordMove('flip', player, label);
    this.finishAction(win, player);
    this.replayFrames.push(this.createReplayFrame(label));

    return {
      ok: true,
      kind: 'flip',
      player,
      win
    };
  }

  undo(): boolean {
    const snapshot = this.history.pop();
    if (!snapshot) return false;
    this.restoreSnapshot(snapshot);
    this.replayFrames.push(this.createReplayFrame('悔棋'));
    return true;
  }

  tick(deltaSeconds: number): boolean {
    if (this.status !== 'playing') return false;

    let changed = false;
    if (this.settings.totalTimerEnabled) {
      this.totalRemaining[this.currentPlayer] = Math.max(
        0,
        this.totalRemaining[this.currentPlayer] - deltaSeconds
      );
      changed = true;

      if (this.totalRemaining[this.currentPlayer] <= 0) {
        this.pushHistory();
        const winner = otherPlayer(this.currentPlayer);
        this.status = 'won';
        this.winner = winner;
        this.winLine = [];
        const label = `${PLAYER_NAMES[this.currentPlayer]} 总时长耗尽`;
        this.recordMove('timeout', this.currentPlayer, label);
        this.replayFrames.push(this.createReplayFrame(label));
        return true;
      }
    }

    if (this.settings.turnTimerEnabled) {
      this.turnRemaining = Math.max(0, this.turnRemaining - deltaSeconds);
      changed = true;

      if (this.turnRemaining <= 0) {
        this.skipTurnByTimeout();
        return true;
      }
    }

    return changed;
  }

  getAiColumn(): number | null {
    if (this.settings.matchMode !== 'ai' || this.currentPlayer !== 2 || this.status !== 'playing') {
      return null;
    }

    const columns = this.board.getAvailableColumns(this.gravity);
    if (columns.length === 0) return null;

    if (this.settings.aiDifficulty === 'easy') {
      return this.pickRandom(columns);
    }

    const winNow = this.findImmediateMove(this.board, 2);
    if (winNow !== null) return winNow;

    const blockNow = this.findImmediateMove(this.board, 1);
    if (blockNow !== null) return blockNow;

    if (this.settings.aiDifficulty === 'medium') {
      return this.pickWeighted(columns);
    }

    return this.pickMinimax(columns);
  }

  getScoreSkew(): number {
    const red = this.board.countPieces(1);
    const gold = this.board.countPieces(2);
    if (red === gold) return 0;
    return Math.max(-1, Math.min(1, (red - gold) / Math.max(1, red + gold)));
  }

  getPlayerName(player: Player): string {
    return PLAYER_NAMES[player];
  }

  private finishAction(win: WinResult | null, preferredPlayer: Player): void {
    if (win) {
      this.status = 'won';
      this.winner = win.player;
      this.winLine = win.line;
      return;
    }

    const boardWideWin = this.board.scanForWinner(preferredPlayer);
    if (boardWideWin) {
      this.status = 'won';
      this.winner = boardWideWin.player;
      this.winLine = boardWideWin.line;
      return;
    }

    if (this.board.isDraw(this.gravity)) {
      this.status = 'draw';
      this.winner = null;
      this.winLine = [];
      return;
    }

    this.currentPlayer = otherPlayer(this.currentPlayer);
    this.turnRemaining = this.settings.turnSeconds;
  }

  private skipTurnByTimeout(): void {
    const player = this.currentPlayer;
    this.pushHistory();
    const label = `${PLAYER_NAMES[player]} 超时`;
    this.recordMove('timeout', player, label);
    this.currentPlayer = otherPlayer(player);
    this.turnRemaining = this.settings.turnSeconds;
    this.replayFrames.push(this.createReplayFrame(label));
  }

  private pushHistory(): void {
    this.history.push(this.createSnapshot());
  }

  private createSnapshot(): EngineSnapshot {
    return {
      matrix: this.board.cloneMatrix(),
      currentPlayer: this.currentPlayer,
      status: this.status,
      winner: this.winner,
      winLine: this.winLine.map((cell) => ({ ...cell })),
      gravity: this.gravity,
      bombsLeft: { ...this.bombsLeft },
      flipsLeft: { ...this.flipsLeft },
      turnRemaining: this.turnRemaining,
      totalRemaining: { ...this.totalRemaining },
      moves: this.moves.map((move) => ({
        ...move,
        position: move.position ? { ...move.position } : undefined,
        removed: move.removed?.map((cell) => ({ ...cell }))
      }))
    };
  }

  private restoreSnapshot(snapshot: EngineSnapshot): void {
    this.board.setMatrix(snapshot.matrix);
    this.currentPlayer = snapshot.currentPlayer;
    this.status = snapshot.status;
    this.winner = snapshot.winner;
    this.winLine = snapshot.winLine.map((cell) => ({ ...cell }));
    this.gravity = snapshot.gravity;
    this.bombsLeft = { ...snapshot.bombsLeft };
    this.flipsLeft = { ...snapshot.flipsLeft };
    this.turnRemaining = snapshot.turnRemaining;
    this.totalRemaining = { ...snapshot.totalRemaining };
    this.moves = snapshot.moves.map((move) => ({
      ...move,
      position: move.position ? { ...move.position } : undefined,
      removed: move.removed?.map((cell) => ({ ...cell }))
    }));
    this.moveSequence = this.moves.reduce((max, move) => Math.max(max, move.id), 0);
  }

  private createReplayFrame(label: string): ReplayFrame {
    return {
      matrix: this.board.cloneMatrix(),
      currentPlayer: this.currentPlayer,
      gravity: this.gravity,
      status: this.status,
      winner: this.winner,
      winLine: this.winLine.map((cell) => ({ ...cell })),
      label
    };
  }

  private recordMove(
    kind: MoveKind,
    player: Player,
    label: string,
    position?: Position,
    removed?: Position[]
  ): void {
    this.moves.push({
      id: ++this.moveSequence,
      kind,
      player,
      label,
      position: position ? { ...position } : undefined,
      removed: removed?.map((cell) => ({ ...cell }))
    });
  }

  private findImmediateMove(board: Board, player: Player): number | null {
    for (const col of board.getAvailableColumns(this.gravity)) {
      const copy = board.clone();
      const position = copy.dropPiece(col, player, this.gravity);
      if (position && copy.checkWin(position.row, position.col)) {
        return col;
      }
    }
    return null;
  }

  private pickRandom(columns: number[]): number {
    return columns[Math.floor(Math.random() * columns.length)];
  }

  private pickWeighted(columns: number[]): number {
    const center = (this.board.cols - 1) / 2;
    const weighted = columns
      .map((col) => ({
        col,
        score: 1 / (Math.abs(col - center) + 1) + Math.random() * 0.2
      }))
      .sort((a, b) => b.score - a.score);
    return weighted[0].col;
  }

  private pickMinimax(columns: number[]): number {
    const depth = this.board.rows * this.board.cols > 72 ? 3 : 4;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestColumns: number[] = [];

    for (const col of columns) {
      const copy = this.board.clone();
      const position = copy.dropPiece(col, 2, this.gravity);
      if (!position) continue;

      const immediateWin = copy.checkWin(position.row, position.col);
      const score = immediateWin
        ? 100_000
        : this.minimax(copy, depth - 1, 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);

      if (score > bestScore) {
        bestScore = score;
        bestColumns = [col];
      } else if (score === bestScore) {
        bestColumns.push(col);
      }
    }

    return this.pickWeighted(bestColumns.length ? bestColumns : columns);
  }

  private minimax(board: Board, depth: number, player: Player, alpha: number, beta: number): number {
    const win = board.scanForWinner(player);
    if (win) {
      return win.player === 2 ? 100_000 + depth : -100_000 - depth;
    }

    if (depth === 0 || board.isDraw(this.gravity)) {
      return this.scoreBoard(board);
    }

    const columns = board.getAvailableColumns(this.gravity);
    if (player === 2) {
      let value = Number.NEGATIVE_INFINITY;
      for (const col of columns) {
        const copy = board.clone();
        const position = copy.dropPiece(col, player, this.gravity);
        if (!position) continue;
        const child = this.minimax(copy, depth - 1, 1, alpha, beta);
        value = Math.max(value, child);
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break;
      }
      return value;
    }

    let value = Number.POSITIVE_INFINITY;
    for (const col of columns) {
      const copy = board.clone();
      const position = copy.dropPiece(col, player, this.gravity);
      if (!position) continue;
      const child = this.minimax(copy, depth - 1, 2, alpha, beta);
      value = Math.min(value, child);
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  private scoreBoard(board: Board): number {
    const aiWin = board.scanForWinner(2);
    if (aiWin?.player === 2) return 100_000;
    const humanWin = board.scanForWinner(1);
    if (humanWin?.player === 1) return -100_000;

    const center = (board.cols - 1) / 2;
    let centerScore = 0;
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const cell = board.matrix[row][col];
        if (cell === 2) centerScore += 4 - Math.abs(col - center);
        if (cell === 1) centerScore -= 3 - Math.abs(col - center);
      }
    }

    return this.threatScore(board, 2) - this.threatScore(board, 1) * 1.15 + centerScore;
  }

  private threatScore(board: Board, player: Player): number {
    const opponent = otherPlayer(player);
    let score = 0;

    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        for (const direction of DIRECTIONS) {
          const cells = this.collectWindow(board, row, col, direction);
          if (cells.length !== board.winLength) continue;

          const values = cells.map((cell) => board.matrix[cell.row][cell.col]);
          if (values.includes(-1) || values.includes(opponent)) continue;

          const owned = values.filter((value) => value === player).length;
          const empty = values.filter((value) => value === 0).length;
          if (owned === 0) continue;

          score += owned ** 3 * 8;
          if (owned === board.winLength - 1 && empty === 1) score += 180;
          if (owned === board.winLength - 2 && empty === 2) score += 28;
        }
      }
    }

    return score;
  }

  private collectWindow(board: Board, row: number, col: number, direction: Position): Position[] {
    const cells: Position[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < board.winLength; index += 1) {
      const next = this.resolvePosition(board, row + direction.row * index, col + direction.col * index);
      if (!next) return [];
      const key = `${next.row}:${next.col}`;
      if (seen.has(key)) return [];
      seen.add(key);
      cells.push(next);
    }

    return cells;
  }

  private resolvePosition(board: Board, row: number, col: number): Position | null {
    let resolvedRow = row;
    let resolvedCol = col;

    if (board.wrapVertical) {
      resolvedRow = mod(resolvedRow, board.rows);
    } else if (resolvedRow < 0 || resolvedRow >= board.rows) {
      return null;
    }

    if (board.wrapHorizontal) {
      resolvedCol = mod(resolvedCol, board.cols);
    } else if (resolvedCol < 0 || resolvedCol >= board.cols) {
      return null;
    }

    return { row: resolvedRow, col: resolvedCol };
  }
}

function normalizeSettings(settings: GameSettings): GameSettings {
  const rows = clampInt(settings.rows, 4, 12);
  const cols = clampInt(settings.cols, 4, 12);
  const maxWin = Math.min(8, Math.max(rows, cols));

  return {
    ...settings,
    rows,
    cols,
    winLength: clampInt(settings.winLength, 3, maxWin),
    obstacleCount: clampInt(settings.obstacleCount, 1, Math.max(1, Math.floor((rows * cols) / 5))),
    turnSeconds: clampInt(settings.turnSeconds, 5, 60),
    totalSeconds: clampInt(settings.totalSeconds, 60, 20 * 60)
  };
}

function clampInt(value: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, integer));
}

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}
