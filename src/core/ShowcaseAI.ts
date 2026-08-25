import { Board } from './Board';
import type { GravityDirection, Player, Position } from './types';
import { otherPlayer } from './types';

interface ShowcaseAIOptions {
  gravity: GravityDirection;
}

export type ShowcaseLevel = 'frontLoaded' | 'direct' | 'steady';

interface PhaseProfile {
  topologyWeight: number;
  topologyDefense: boolean;
  allowDiagonal: boolean;
  directDefense: boolean;
  defensiveWeight: number;
  replyWeight: number;
  tolerance: number;
}

interface Candidate {
  column: number;
  score: number;
  wins: boolean;
  topologyWin: boolean;
  opponentWins: number;
  opponentDirectWins: number;
}

interface ThreatSummary {
  total: number;
  direct: number;
  topology: number;
}

const DIRECTIONS: Position[] = [
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: -1 }
];

const SHOWCASE_WIN_SCORE = 1_000_000;

/** A shallow, presentation-oriented player. Rules and board state remain owned by Board. */
export class ShowcaseAI {
  private levels: Record<Player, ShowcaseLevel> = { 1: 'frontLoaded', 2: 'direct' };

  constructor(private readonly options: ShowcaseAIOptions) {}

  assignRandomLevels(random: () => number): void {
    const levels: ShowcaseLevel[] = ['frontLoaded', 'direct', 'steady'];
    for (let index = levels.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [levels[index], levels[swap]] = [levels[swap], levels[index]];
    }
    this.levels = { 1: levels[0], 2: levels[1] };
  }

  getLevel(player: Player): ShowcaseLevel {
    return this.levels[player];
  }

  chooseMove(board: Board, player: Player, random: () => number): number | null {
    const legal = board.getAvailableColumns(this.options.gravity);
    if (legal.length === 0) return null;

    const opponent = otherPlayer(player);
    const profile = this.getPhaseProfile(player, board);
    const opponentThreats = this.threatSummary(board, opponent, profile.allowDiagonal);
    let candidates = legal.map((column) => this.evaluateCandidate(board, column, player, opponent));

    const winning = candidates.filter((candidate) => candidate.wins);
    if (winning.length > 0) {
      const topologyWins = profile.topologyWeight > 0.5
        ? winning.filter((candidate) => candidate.topologyWin)
        : [];
      candidates = topologyWins.length > 0 ? topologyWins : winning;
      return this.pickBest(candidates, random, 0);
    }

    // Direct threats are always defended. Topology threats are style-dependent after the opening third.
    if (profile.directDefense && opponentThreats.direct > 0) {
      const fewestDirectReplies = Math.min(...candidates.map((candidate) => candidate.opponentDirectWins));
      candidates = candidates.filter((candidate) => candidate.opponentDirectWins === fewestDirectReplies);
    }
    if (profile.topologyDefense && opponentThreats.topology > 0) {
      const fewestReplies = Math.min(...candidates.map((candidate) => candidate.opponentWins));
      candidates = candidates.filter((candidate) => candidate.opponentWins === fewestReplies);
    }

    return this.pickBest(candidates, random, profile.tolerance);
  }

  private evaluateCandidate(
    board: Board,
    column: number,
    player: Player,
    opponent: Player
  ): Candidate {
    const copy = board.clone();
    const position = copy.dropPiece(column, player, this.options.gravity);
    if (!position) {
      return {
        column,
        score: Number.NEGATIVE_INFINITY,
        wins: false,
        topologyWin: false,
        opponentWins: 99,
        opponentDirectWins: 99
      };
    }

    const profile = this.getPhaseProfile(player, board);
    const win = copy.checkWin(position.row, position.col);
    const wins = Boolean(win && (profile.allowDiagonal || this.isStraightLine(win.line)));
    const topologyWin = Boolean(wins && win && this.isTopologyLine(win.line, copy));
    const opponentThreats = this.threatSummary(copy, opponent, profile.allowDiagonal);
    const playerThreats = this.countWinningMoves(copy, player, profile.allowDiagonal);
    const beforeOpponentThreats = this.threatSummary(board, opponent, profile.allowDiagonal);
    const attack = this.positionScore(copy, player, profile);
    const defense = (beforeOpponentThreats.direct - opponentThreats.direct) * 4_600 * profile.defensiveWeight
      + (beforeOpponentThreats.topology - opponentThreats.topology) * (profile.topologyDefense ? 3_600 : 500) * profile.defensiveWeight;

    let score = attack + defense + playerThreats * 1_250 - opponentThreats.total * 6_300;
    if (topologyWin) score += 34_000;
    if (wins) score += SHOWCASE_WIN_SCORE;

    // Look one reply ahead so attacks create a response instead of a static pattern.
    if (!wins) {
      const reply = this.bestOpponentReply(copy, player, opponent);
      score -= reply * profile.replyWeight;
    }

    return {
      column,
      score,
      wins,
      topologyWin,
      opponentWins: opponentThreats.total,
      opponentDirectWins: opponentThreats.direct
    };
  }

  private bestOpponentReply(board: Board, player: Player, opponent: Player): number {
    let worst = Number.NEGATIVE_INFINITY;
    for (const column of board.getAvailableColumns(this.options.gravity)) {
      const copy = board.clone();
      const position = copy.dropPiece(column, opponent, this.options.gravity);
      if (!position) continue;
      const win = copy.checkWin(position.row, position.col);
      const profile = this.getPhaseProfile(opponent, board);
      const topologyBonus = win && profile.topologyWeight > 0.5 && this.isTopologyLine(win.line, copy) ? 4_800 : 0;
      // The opponent chooses the reply that is strongest from their own perspective.
      const replyIsConsidered = Boolean(win && (profile.allowDiagonal || this.isStraightLine(win.line)));
      const replyScore = replyIsConsidered
        ? SHOWCASE_WIN_SCORE + topologyBonus
        : this.positionScore(copy, opponent, profile);
      worst = Math.max(worst, replyScore);
    }
    return worst === Number.NEGATIVE_INFINITY ? 0 : worst;
  }

  private countWinningMoves(board: Board, player: Player, allowDiagonal = true): number {
    return this.threatSummary(board, player, allowDiagonal).total;
  }

  private threatSummary(board: Board, player: Player, allowDiagonal: boolean): ThreatSummary {
    let total = 0;
    let direct = 0;
    let topology = 0;
    for (const column of board.getAvailableColumns(this.options.gravity)) {
      const copy = board.clone();
      const position = copy.dropPiece(column, player, this.options.gravity);
      const win = position ? copy.checkWin(position.row, position.col) : null;
      if (!win || (!allowDiagonal && !this.isStraightLine(win.line))) continue;
      total += 1;
      if (this.isTopologyLine(win.line, copy)) topology += 1;
      else direct += 1;
    }
    return { total, direct, topology };
  }

  private pickBest(candidates: Candidate[], random: () => number, tolerance: number): number | null {
    candidates.sort((left, right) => right.score - left.score);
    const bestScore = candidates[0]?.score;
    if (bestScore === undefined) return null;
    const equivalent = candidates.filter((candidate) => candidate.score >= bestScore - tolerance);
    return equivalent[Math.floor(random() * equivalent.length)]?.column ?? candidates[0].column;
  }

  private positionScore(board: Board, player: Player, profile: PhaseProfile): number {
    const opponent = otherPlayer(player);
    const own = this.patternScore(board, player, profile);
    const enemy = this.patternScore(board, opponent, profile);
    const ownThreats = this.countWinningMoves(board, player, profile.allowDiagonal);
    const enemyThreats = this.countWinningMoves(board, opponent, profile.allowDiagonal);
    const topologyPotential = this.topologyPotential(board, player, profile) * profile.topologyWeight;
    return own * 1.15 - enemy * 1.38 * profile.defensiveWeight
      + ownThreats * 2_100 - enemyThreats * 3_100 * profile.defensiveWeight + topologyPotential;
  }

  private getPhaseProfile(player: Player, board: Board): PhaseProfile {
    const early = board.matrix.flat().filter((cell) => cell === 1 || cell === 2).length < Math.ceil(board.rows * board.cols / 3);
    const level = this.levels[player];
    if (level === 'frontLoaded') {
      return early
        ? { topologyWeight: 1.2, topologyDefense: true, allowDiagonal: true, directDefense: true, defensiveWeight: 1, replyWeight: 0.88, tolerance: 8 }
        : { topologyWeight: 0.25, topologyDefense: false, allowDiagonal: true, directDefense: true, defensiveWeight: 0.65, replyWeight: 0.56, tolerance: 72 };
    }
    if (level === 'direct') {
      return early
        ? { topologyWeight: 0.05, topologyDefense: false, allowDiagonal: true, directDefense: true, defensiveWeight: 1, replyWeight: 0.7, tolerance: 36 }
        : { topologyWeight: 0.05, topologyDefense: false, allowDiagonal: true, directDefense: false, defensiveWeight: 0, replyWeight: 0, tolerance: 92 };
    }
    return { topologyWeight: 0.08, topologyDefense: false, allowDiagonal: false, directDefense: true, defensiveWeight: 0.8, replyWeight: 0.42, tolerance: early ? 68 : 126 };
  }

  private patternScore(board: Board, player: Player, profile: PhaseProfile): number {
    const opponent = otherPlayer(player);
    const seen = new Set<string>();
    let score = 0;

    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        for (const direction of DIRECTIONS) {
          if (!profile.allowDiagonal && direction.row !== 0 && direction.col !== 0) continue;
          const cells = this.collectWindow(board, row, col, direction);
          if (!cells) continue;
          const key = cells.map((cell) => `${cell.row}:${cell.col}`).sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const values = cells.map((cell) => board.matrix[cell.row][cell.col]);
          if (values.includes(opponent) || values.includes(-1)) continue;
          const owned = values.filter((value) => value === player).length;
          if (owned === 0) continue;
          const playable = cells.filter(
            (cell) => board.matrix[cell.row][cell.col] === 0 && board.findDropRow(cell.col, this.options.gravity) === cell.row
          ).length;
          score += owned === board.winLength ? 50_000 : owned * owned * 34 + playable * (owned + 1) * 14;
          if (this.isTopologyLine(cells, board)) score += owned * owned * 22 * profile.topologyWeight;
        }
      }
    }
    return score;
  }

  private topologyPotential(board: Board, player: Player, profile: PhaseProfile): number {
    if (!board.wrapHorizontal && !board.wrapVertical) return 0;
    let score = 0;
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        for (const direction of DIRECTIONS) {
          if (!profile.allowDiagonal && direction.row !== 0 && direction.col !== 0) continue;
          const cells = this.collectWindow(board, row, col, direction);
          if (!cells || !this.isTopologyLine(cells, board)) continue;
          const owned = cells.filter((cell) => board.matrix[cell.row][cell.col] === player).length;
          const empty = cells.filter((cell) => board.matrix[cell.row][cell.col] === 0).length;
          score += owned * owned * 18 + (owned > 0 ? empty * 8 : 0);
        }
      }
    }
    return score;
  }

  private collectWindow(board: Board, row: number, col: number, direction: Position): Position[] | null {
    const cells: Position[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < board.winLength; index += 1) {
      const next = this.resolve(board, row + direction.row * index, col + direction.col * index);
      if (!next) return null;
      const key = `${next.row}:${next.col}`;
      if (seen.has(key)) return null;
      seen.add(key);
      cells.push(next);
    }
    return cells;
  }

  private resolve(board: Board, row: number, col: number): Position | null {
    let resolvedRow = row;
    let resolvedCol = col;
    if (board.wrapVertical) resolvedRow = ((row % board.rows) + board.rows) % board.rows;
    else if (row < 0 || row >= board.rows) return null;
    if (board.wrapHorizontal) resolvedCol = ((col % board.cols) + board.cols) % board.cols;
    else if (col < 0 || col >= board.cols) return null;
    return { row: resolvedRow, col: resolvedCol };
  }

  private isTopologyLine(line: Position[], board: Board): boolean {
    if (line.length < 2) return false;
    for (let index = 1; index < line.length; index += 1) {
      const rowDelta = Math.abs(line[index].row - line[index - 1].row);
      const colDelta = Math.abs(line[index].col - line[index - 1].col);
      if ((board.wrapVertical && rowDelta > 1) || (board.wrapHorizontal && colDelta > 1)) return true;
    }
    return false;
  }

  private isStraightLine(line: Position[]): boolean {
    if (line.length < 2) return false;
    const rowStep = line[1].row - line[0].row;
    const colStep = line[1].col - line[0].col;
    return rowStep === 0 || colStep === 0;
  }
}
