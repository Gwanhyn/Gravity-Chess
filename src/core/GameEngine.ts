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
  type SerializedGameState,
  type WinResult
} from './types';

const PLAYER_NAMES: Record<Player, string> = {
  1: '蓝方',
  2: '黄方'
};

const DIRECTIONS: Position[] = [
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: -1 }
];

const AI_WIN_SCORE = 1_000_000;

interface AiProfile {
  maxDepth: number;
  maxCandidates: number;
  timeLimitMs: number;
  randomJitter: number;
}

interface SearchContext {
  deadline: number;
  maxCandidates: number;
  nodes: number;
  cacheHits: number;
  table: Map<string, SearchCacheEntry>;
  aborted: boolean;
}

interface SearchCacheEntry {
  depth: number;
  value: number;
  bound: 'exact' | 'lower' | 'upper';
}

interface SearchResult {
  move: number;
  score: number;
  depth: number;
  complete: boolean;
  nodes: number;
  cacheHits: number;
}

export interface AiDiagnostics {
  difficulty: AiDifficulty;
  elapsedMs: number;
  nodes: number;
  cacheHits: number;
  depth: number;
}

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
  logEntries: MoveRecord[] = [];
  replayFrames: ReplayFrame[] = [];

  private moveSequence = 0;
  private logSequence = 0;
  private lastAiDiagnostics: AiDiagnostics = {
    difficulty: 'medium',
    elapsedMs: 0,
    nodes: 0,
    cacheHits: 0,
    depth: 0
  };

  constructor(settings: Partial<GameSettings> = {}) {
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...settings });
    this.board = new Board(this.settings);
    this.reset(this.settings);
  }

  reset(settings: Partial<GameSettings> = this.settings): void {
    this.settings = normalizeSettings({ ...this.settings, ...settings });
    this.board = new Board(this.settings);
    this.currentPlayer = this.settings.startingPlayer;
    this.status = 'playing';
    this.winner = null;
    this.winLine = [];
    this.gravity = 'down';
    this.bombsLeft = {
      1: this.settings.bombsEnabled ? this.settings.bombLimit : 0,
      2: this.settings.bombsEnabled ? this.settings.bombLimit : 0
    };
    this.flipsLeft = {
      1: this.settings.gravityFlipEnabled ? this.settings.gravityFlipLimit : 0,
      2: this.settings.gravityFlipEnabled ? this.settings.gravityFlipLimit : 0
    };
    this.turnRemaining = this.settings.turnSeconds;
    this.totalRemaining = {
      1: this.settings.totalSeconds,
      2: this.settings.totalSeconds
    };
    this.history = [];
    this.moves = [];
    this.logEntries = [];
    this.moveSequence = 0;
    this.logSequence = 0;
    const openingLabel = `开局：${PLAYER_NAMES[this.currentPlayer]}先手`;
    this.appendLog('reset', undefined, openingLabel);
    this.replayFrames = [this.createReplayFrame(openingLabel)];
  }

  setTopology(wrapHorizontal: boolean, wrapVertical: boolean): void {
    this.settings.wrapHorizontal = wrapHorizontal;
    this.settings.wrapVertical = wrapVertical;
    this.board.updateOptions({
      winLength: this.settings.winLength,
      wrapHorizontal,
      wrapVertical
    });
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

    const win = this.settings.autoWinCheckEnabled ? this.board.checkWin(position.row, position.col) : null;
    const label = `${PLAYER_NAMES[player]} 落子 ${col + 1}`;
    this.recordMove('drop', player, label, position);
    this.finishAction(win, player, true);
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
    if (!this.settings.bombsEnabled || !hasRuleUseLeft(this.bombsLeft[this.currentPlayer])) {
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

    this.bombsLeft[player] = spendRuleUse(this.bombsLeft[player]);
    const win = this.settings.autoWinCheckEnabled ? this.board.scanForWinner(player) : null;
    const label = `${PLAYER_NAMES[player]} 炸弹3x3 ${col + 1}`;
    this.recordMove('bomb', player, label, result.center, result.removed);
    this.finishAction(win, player, true);
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
    if (!this.settings.gravityFlipEnabled || !hasRuleUseLeft(this.flipsLeft[this.currentPlayer])) {
      return { ok: false, message: '重力反转不可用' };
    }

    const player = this.currentPlayer;
    this.pushHistory();
    this.gravity = 'down';
    this.board.flipGravity(this.gravity);
    this.flipsLeft[player] = spendRuleUse(this.flipsLeft[player]);

    const win = this.settings.autoWinCheckEnabled ? this.board.scanForWinner(player) : null;
    const label = `${PLAYER_NAMES[player]} 反转`;
    this.recordMove('flip', player, label);
    this.finishAction(win, player, true);
    this.replayFrames.push(this.createReplayFrame(label));

    return {
      ok: true,
      kind: 'flip',
      player,
      win
    };
  }

  checkWinManually(): MoveOutcome {
    if (this.status !== 'playing') {
      return { ok: false, message: '对局已结束' };
    }
    if (this.settings.autoWinCheckEnabled) {
      return { ok: false, message: '自动查胜已开启' };
    }

    const player = this.currentPlayer;
    this.pushHistory();
    const win = this.board.scanPlayerWinner(player);
    const label = win ? `${PLAYER_NAMES[player]} 查胜成功` : `${PLAYER_NAMES[player]} 查胜未中`;
    this.recordMove('check', player, label);

    if (win) {
      this.status = 'won';
      this.winner = player;
      this.winLine = win.line;
      this.replayFrames.push(this.createReplayFrame(label));
      return {
        ok: true,
        kind: 'check',
        player,
        win
      };
    }

    if (this.board.isDraw(this.gravity)) {
      this.status = 'draw';
      this.winner = null;
      this.winLine = [];
    } else {
      this.currentPlayer = otherPlayer(this.currentPlayer);
      this.turnRemaining = this.settings.turnSeconds;
    }
    this.replayFrames.push(this.createReplayFrame(label));
    return {
      ok: true,
      kind: 'check',
      player,
      win: null,
      message: '未发现连珠，检查计为一步'
    };
  }

  undo(): boolean {
    const snapshot = this.history.pop();
    if (!snapshot) return false;
    this.restoreSnapshot(snapshot);
    this.appendLog('undo', undefined, '悔棋');
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
    const startedAt = Date.now();
    const difficulty = this.settings.aiDifficulty;
    const winNow = this.findImmediateMove(this.board, 2);
    const blockNow = this.findImmediateMove(this.board, 1);
    let move: number;
    let nodes = 0;
    let cacheHits = 0;
    let depth = 0;

    if (winNow !== null) {
      move = winNow;
    } else if (blockNow !== null) {
      move = blockNow;
    } else if (difficulty === 'easy') {
      move = this.pickEasyMove(columns);
    } else {
      const profile = this.getAiProfile(difficulty);
      const result = this.pickSearchMove(columns, profile);
      move = result.move;
      nodes = result.nodes;
      cacheHits = result.cacheHits;
      depth = result.depth;
    }

    this.lastAiDiagnostics = {
      difficulty,
      elapsedMs: Date.now() - startedAt,
      nodes,
      cacheHits,
      depth
    };
    return move;
  }

  getLastAiDiagnostics(): AiDiagnostics {
    return { ...this.lastAiDiagnostics };
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

  exportState(): SerializedGameState {
    return {
      settings: { ...this.settings },
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
      })),
      logEntries: this.logEntries.map((entry) => ({
        ...entry,
        position: entry.position ? { ...entry.position } : undefined,
        removed: entry.removed?.map((cell) => ({ ...cell }))
      })),
      replayFrames: this.replayFrames.map((frame) => ({
        ...frame,
        matrix: frame.matrix.map((row) => [...row]),
        winLine: frame.winLine.map((cell) => ({ ...cell }))
      })),
      historyDepth: this.history.length
    };
  }

  importState(state: SerializedGameState): void {
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...state.settings });
    this.board = new Board(this.settings);
    this.board.setMatrix(state.matrix);
    this.currentPlayer = state.currentPlayer;
    this.status = state.status;
    this.winner = state.winner;
    this.winLine = state.winLine.map((cell) => ({ ...cell }));
    this.gravity = state.gravity;
    this.bombsLeft = state.bombsLeft
      ? { ...state.bombsLeft }
      : {
          1: this.settings.bombsEnabled ? this.settings.bombLimit : 0,
          2: this.settings.bombsEnabled ? this.settings.bombLimit : 0
        };
    this.flipsLeft = state.flipsLeft
      ? { ...state.flipsLeft }
      : {
          1: this.settings.gravityFlipEnabled ? this.settings.gravityFlipLimit : 0,
          2: this.settings.gravityFlipEnabled ? this.settings.gravityFlipLimit : 0
        };
    this.turnRemaining = state.turnRemaining;
    this.totalRemaining = { ...state.totalRemaining };
    this.moves = state.moves.map((move) => ({
      ...move,
      position: move.position ? { ...move.position } : undefined,
      removed: move.removed?.map((cell) => ({ ...cell }))
    }));
    this.logEntries = state.logEntries.map((entry) => ({
      ...entry,
      position: entry.position ? { ...entry.position } : undefined,
      removed: entry.removed?.map((cell) => ({ ...cell }))
    }));
    this.replayFrames = state.replayFrames.map((frame) => ({
      ...frame,
      matrix: frame.matrix.map((row) => [...row]),
      winLine: frame.winLine.map((cell) => ({ ...cell }))
    }));
    this.history = [];
    this.moveSequence = this.moves.reduce((max, move) => Math.max(max, move.id), 0);
    this.logSequence = this.logEntries.reduce((max, entry) => Math.max(max, entry.id), 0);
  }

  appendExternalLog(kind: MoveKind, label: string, player?: Player): void {
    this.appendLog(kind, player, label);
  }

  private finishAction(win: WinResult | null, preferredPlayer: Player, advanceTurn: boolean): void {
    if (win) {
      this.status = 'won';
      this.winner = win.player;
      this.winLine = win.line;
      return;
    }

    if (this.settings.autoWinCheckEnabled) {
      const boardWideWin = this.board.scanForWinner(preferredPlayer);
      if (boardWideWin) {
        this.status = 'won';
        this.winner = boardWideWin.player;
        this.winLine = boardWideWin.line;
        return;
      }
    }

    if (this.board.isDraw(this.gravity)) {
      this.status = 'draw';
      this.winner = null;
      this.winLine = [];
      return;
    }

    if (!advanceTurn) return;

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
    const move = {
      id: ++this.moveSequence,
      kind,
      player,
      label,
      position: position ? { ...position } : undefined,
      removed: removed?.map((cell) => ({ ...cell }))
    };
    this.moves.push(move);
    this.appendLog(kind, player, label, position, removed);
  }

  private appendLog(
    kind: MoveKind,
    player: Player | undefined,
    label: string,
    position?: Position,
    removed?: Position[]
  ): void {
    this.logEntries.push({
      id: ++this.logSequence,
      kind,
      player,
      label,
      position: position ? { ...position } : undefined,
      removed: removed?.map((cell) => ({ ...cell }))
    });
  }

  private findImmediateMove(board: Board, player: Player): number | null {
    const wins: number[] = [];
    for (const col of board.getAvailableColumns(this.gravity)) {
      const copy = board.clone();
      const position = copy.dropPiece(col, player, this.gravity);
      if (position && copy.checkWin(position.row, position.col)) {
        wins.push(col);
      }
    }
    if (wins.length === 0) return null;
    const center = (board.cols - 1) / 2;
    return wins.sort((left, right) => Math.abs(left - center) - Math.abs(right - center))[0];
  }

  private getAiProfile(difficulty: AiDifficulty): AiProfile {
    const cellCount = this.board.rows * this.board.cols;
    if (difficulty === 'medium') {
      return {
        maxDepth: cellCount <= 54 ? 3 : 2,
        maxCandidates: Math.min(this.board.cols, cellCount <= 72 ? 7 : 6),
        timeLimitMs: 72,
        randomJitter: 24
      };
    }

    return {
      maxDepth: cellCount <= 42 ? 6 : cellCount <= 72 ? 5 : 4,
      maxCandidates: Math.min(this.board.cols, cellCount <= 72 ? 8 : 7),
      timeLimitMs: cellCount <= 54 ? 180 : 145,
      randomJitter: 0
    };
  }

  private pickEasyMove(columns: number[]): number {
    const ranked = this.rankColumns(this.board, 2, columns.length);
    const poolSize = Math.min(ranked.length, Math.max(3, Math.ceil(columns.length * 0.6)));
    const pool = ranked.slice(0, poolSize);
    return pool[Math.floor(Math.random() * pool.length)].col;
  }

  private pickSearchMove(columns: number[], profile: AiProfile): SearchResult {
    const ranked = this.rankColumns(this.board, 2, profile.maxCandidates);
    const fallback = ranked[0]?.col ?? columns[0];
    const context: SearchContext = {
      deadline: Date.now() + profile.timeLimitMs,
      maxCandidates: profile.maxCandidates,
      nodes: 0,
      cacheHits: 0,
      table: new Map(),
      aborted: false
    };
    let best: SearchResult = {
      move: fallback,
      score: Number.NEGATIVE_INFINITY,
      depth: 0,
      complete: false,
      nodes: 0,
      cacheHits: 0
    };

    for (let depth = 1; depth <= profile.maxDepth; depth += 1) {
      const iteration = this.searchRoot(ranked, depth, context, profile.randomJitter);
      if (!iteration.complete) break;
      best = iteration;
      if (this.isSearchExpired(context)) break;
    }

    return {
      ...best,
      nodes: context.nodes,
      cacheHits: context.cacheHits
    };
  }

  private searchRoot(
    candidates: Array<{ col: number; score: number }>,
    depth: number,
    context: SearchContext,
    randomJitter: number
  ): SearchResult {
    let bestMove = candidates[0].col;
    let bestScore = Number.NEGATIVE_INFINITY;
    let alpha = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      if (this.isSearchExpired(context)) {
        return { move: bestMove, score: bestScore, depth, complete: false, nodes: 0, cacheHits: 0 };
      }

      const copy = this.board.clone();
      const position = copy.dropPiece(candidate.col, 2, this.gravity);
      if (!position) continue;
      const win = copy.checkWin(position.row, position.col);
      const score = win
        ? AI_WIN_SCORE + depth
        : this.search(copy, depth - 1, 1, alpha, Number.POSITIVE_INFINITY, context);
      if (context.aborted) {
        return { move: bestMove, score: bestScore, depth, complete: false, nodes: 0, cacheHits: 0 };
      }

      const comparisonScore = score + (Math.random() - 0.5) * randomJitter;
      const currentComparison = bestScore + (Math.random() - 0.5) * randomJitter;
      if (comparisonScore > currentComparison) {
        bestMove = candidate.col;
        bestScore = score;
      }
      alpha = Math.max(alpha, bestScore);
    }

    return { move: bestMove, score: bestScore, depth, complete: true, nodes: 0, cacheHits: 0 };
  }

  private search(
    board: Board,
    depth: number,
    player: Player,
    alpha: number,
    beta: number,
    context: SearchContext
  ): number {
    context.nodes += 1;
    if (this.isSearchExpired(context)) return this.scoreBoard(board);
    if (depth <= 0 || board.isDraw(this.gravity)) return this.scoreBoard(board);

    const key = this.getBoardKey(board, player);
    const cached = context.table.get(key);
    const alphaStart = alpha;
    const betaStart = beta;
    if (cached && cached.depth >= depth) {
      context.cacheHits += 1;
      if (cached.bound === 'exact') return cached.value;
      if (cached.bound === 'lower') alpha = Math.max(alpha, cached.value);
      if (cached.bound === 'upper') beta = Math.min(beta, cached.value);
      if (alpha >= beta) return cached.value;
    }

    const candidates = this.rankColumns(board, player, context.maxCandidates);
    if (candidates.length === 0) return this.scoreBoard(board);

    const maximizing = player === 2;
    let value = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (this.isSearchExpired(context)) return this.scoreBoard(board);
      const copy = board.clone();
      const position = copy.dropPiece(candidate.col, player, this.gravity);
      if (!position) continue;
      const win = copy.checkWin(position.row, position.col);
      const child = win
        ? (player === 2 ? AI_WIN_SCORE + depth : -AI_WIN_SCORE - depth)
        : this.search(copy, depth - 1, otherPlayer(player), alpha, beta, context);
      if (context.aborted) return this.scoreBoard(board);

      if (maximizing) {
        value = Math.max(value, child);
        alpha = Math.max(alpha, value);
      } else {
        value = Math.min(value, child);
        beta = Math.min(beta, value);
      }
      if (alpha >= beta) break;
    }

    if (!context.aborted) {
      const bound: SearchCacheEntry['bound'] =
        value <= alphaStart ? 'upper' : value >= betaStart ? 'lower' : 'exact';
      context.table.set(key, { depth, value, bound });
    }
    return value;
  }

  private rankColumns(board: Board, player: Player, limit: number): Array<{ col: number; score: number }> {
    const center = (board.cols - 1) / 2;
    const ranked = board.getAvailableColumns(this.gravity).map((col) => {
      const copy = board.clone();
      const position = copy.dropPiece(col, player, this.gravity);
      if (!position) return { col, score: Number.NEGATIVE_INFINITY };
      const win = copy.checkWin(position.row, position.col);
      const boardScore = win
        ? player === 2 ? AI_WIN_SCORE : -AI_WIN_SCORE
        : this.scoreBoard(copy);
      const perspectiveScore = player === 2 ? boardScore : -boardScore;
      return {
        col,
        score: perspectiveScore + (board.cols - Math.abs(col - center)) * 3
      };
    });
    ranked.sort((left, right) => right.score - left.score || Math.abs(left.col - center) - Math.abs(right.col - center));
    return ranked.slice(0, Math.max(1, Math.min(limit, ranked.length)));
  }

  private scoreBoard(board: Board): number {
    const aiWin = board.scanPlayerWinner(2);
    if (aiWin) return AI_WIN_SCORE;
    const humanWin = board.scanPlayerWinner(1);
    if (humanWin) return -AI_WIN_SCORE;

    const aiThreats = this.threatScore(board, 2);
    const humanThreats = this.threatScore(board, 1);
    let score = aiThreats.score - humanThreats.score * 1.22 + this.positionScore(board);

    if (aiThreats.immediateWins > 1) score += 18_000;
    if (humanThreats.immediateWins > 1) score -= 22_000;
    if (aiThreats.nearWins > 1) score += 1_400;
    if (humanThreats.nearWins > 1) score -= 1_750;
    return score;
  }

  private threatScore(board: Board, player: Player): { score: number; immediateWins: number; nearWins: number } {
    const opponent = otherPlayer(player);
    let score = 0;
    let immediateWins = 0;
    let nearWins = 0;
    const seenWindows = new Set<string>();

    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        for (const direction of DIRECTIONS) {
          const cells = this.collectWindow(board, row, col, direction);
          if (cells.length !== board.winLength) continue;

          const windowKey = cells
            .map((cell) => `${cell.row}:${cell.col}`)
            .sort()
            .join('|');
          if (seenWindows.has(windowKey)) continue;
          seenWindows.add(windowKey);

          const values = cells.map((cell) => board.matrix[cell.row][cell.col]);
          if (values.includes(-1) || values.includes(opponent)) continue;

          const owned = values.filter((value) => value === player).length;
          if (owned === 0) continue;

          const missing = board.winLength - owned;
          const playableEmpties = cells.filter(
            (cell) => board.matrix[cell.row][cell.col] === 0 && board.findDropRow(cell.col, this.gravity) === cell.row
          ).length;
          const openEnds = this.countOpenEnds(board, row, col, direction, board.winLength);

          if (missing === 1) {
            score += 3_400 + playableEmpties * 7_500 + openEnds * 420;
            if (playableEmpties > 0) immediateWins += 1;
          } else if (missing === 2) {
            score += 260 + playableEmpties * 460 + openEnds * 95;
            if (playableEmpties > 0) nearWins += 1;
          } else if (missing === 3) {
            score += 38 + playableEmpties * 52 + openEnds * 16;
          } else {
            score += owned * 5;
          }
        }
      }
    }

    return { score, immediateWins, nearWins };
  }

  private positionScore(board: Board): number {
    const center = (board.cols - 1) / 2;
    let score = 0;
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const cell = board.matrix[row][col];
        if (cell !== 1 && cell !== 2) continue;
        const centrality = Math.max(0, board.cols / 2 - Math.abs(col - center));
        const height = this.gravity === 'down' ? row / Math.max(1, board.rows - 1) : 1 - row / Math.max(1, board.rows - 1);
        const value = centrality * 7 + height * 1.5;
        score += cell === 2 ? value : -value;
      }
    }
    return score;
  }

  private countOpenEnds(
    board: Board,
    row: number,
    col: number,
    direction: Position,
    length: number
  ): number {
    const before = this.resolvePosition(board, row - direction.row, col - direction.col);
    const after = this.resolvePosition(board, row + direction.row * length, col + direction.col * length);
    let openEnds = 0;
    if (before && board.matrix[before.row][before.col] === 0) openEnds += 1;
    if (after && board.matrix[after.row][after.col] === 0) openEnds += 1;
    return openEnds;
  }

  private getBoardKey(board: Board, player: Player): string {
    const matrix = board.matrix.map((row) => row.join('')).join('/');
    return `${player}:${matrix}`;
  }

  private isSearchExpired(context: SearchContext): boolean {
    if (context.aborted) return true;
    if (Date.now() <= context.deadline) return false;
    context.aborted = true;
    return true;
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
    startingPlayer: settings.startingPlayer === 2 ? 2 : 1,
    winLength: clampInt(settings.winLength, 3, maxWin),
    obstacleCount: clampInt(settings.obstacleCount, 1, Math.max(1, Math.floor((rows * cols) / 5))),
    bombLimit: normalizeRuleLimit(settings.bombLimit),
    gravityFlipLimit: normalizeRuleLimit(settings.gravityFlipLimit),
    turnSeconds: clampInt(settings.turnSeconds, 5, 60),
    totalSeconds: clampInt(settings.totalSeconds, 60, 20 * 60)
  };
}

function normalizeRuleLimit(value: number): number {
  if (value === -1) return -1;
  return clampInt(value, 1, 9);
}

function hasRuleUseLeft(value: number): boolean {
  return value === -1 || value > 0;
}

function spendRuleUse(value: number): number {
  return value === -1 ? -1 : Math.max(0, value - 1);
}

function clampInt(value: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, integer));
}

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}
