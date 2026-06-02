import type {
  BoardOptions,
  BombResult,
  Cell,
  GravityDirection,
  Player,
  Position,
  WinResult
} from './types';

const EMPTY = 0;
const OBSTACLE = -1;

export class Board {
  rows: number;
  cols: number;
  winLength: number;
  wrapHorizontal: boolean;
  wrapVertical: boolean;
  matrix: Cell[][];

  constructor(options: BoardOptions) {
    this.rows = options.rows;
    this.cols = options.cols;
    this.winLength = options.winLength;
    this.wrapHorizontal = options.wrapHorizontal;
    this.wrapVertical = options.wrapVertical;
    this.matrix = this.createEmptyMatrix();

    if (options.obstaclesEnabled) {
      this.generateObstacles(options.obstacleCount);
    }
  }

  clone(): Board {
    const copy = new Board({
      rows: this.rows,
      cols: this.cols,
      winLength: this.winLength,
      wrapHorizontal: this.wrapHorizontal,
      wrapVertical: this.wrapVertical,
      obstaclesEnabled: false,
      obstacleCount: 0
    });
    copy.matrix = this.cloneMatrix();
    return copy;
  }

  cloneMatrix(): Cell[][] {
    return this.matrix.map((row) => [...row]);
  }

  setMatrix(matrix: Cell[][]): void {
    this.matrix = matrix.map((row) => [...row]);
  }

  updateOptions(options: Pick<BoardOptions, 'winLength' | 'wrapHorizontal' | 'wrapVertical'>): void {
    this.winLength = options.winLength;
    this.wrapHorizontal = options.wrapHorizontal;
    this.wrapVertical = options.wrapVertical;
  }

  getCell(row: number, col: number): Cell | null {
    if (!this.isInside(row, col)) return null;
    return this.matrix[row][col];
  }

  getAvailableColumns(gravity: GravityDirection): number[] {
    const columns: number[] = [];
    for (let col = 0; col < this.cols; col += 1) {
      if (this.findDropRow(col, gravity) !== null) {
        columns.push(col);
      }
    }
    return columns;
  }

  findDropRow(col: number, gravity: GravityDirection): number | null {
    if (col < 0 || col >= this.cols) return null;

    let lastEmpty: number | null = null;
    const start = gravity === 'down' ? 0 : this.rows - 1;
    const end = gravity === 'down' ? this.rows : -1;
    const step = gravity === 'down' ? 1 : -1;

    for (let row = start; row !== end; row += step) {
      const cell = this.matrix[row][col];
      if (cell !== EMPTY) {
        break;
      }
      lastEmpty = row;
    }

    return lastEmpty;
  }

  dropPiece(col: number, player: Player, gravity: GravityDirection): Position | null {
    const row = this.findDropRow(col, gravity);
    if (row === null) return null;
    this.matrix[row][col] = player;
    return { row, col };
  }

  detonateAtColumn(col: number, gravity: GravityDirection): BombResult | null {
    const row = this.findDropRow(col, gravity);
    if (row === null) return null;

    const removed: Position[] = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const targetRow = row + dr;
        const targetCol = col + dc;
        if (!this.isInside(targetRow, targetCol)) continue;
        if (this.matrix[targetRow][targetCol] === 1 || this.matrix[targetRow][targetCol] === 2) {
          this.matrix[targetRow][targetCol] = EMPTY;
          removed.push({ row: targetRow, col: targetCol });
        }
      }
    }

    this.settlePieces(gravity);
    return { center: { row, col }, removed };
  }

  flipGravity(nextGravity: GravityDirection): void {
    this.matrix.reverse();
    this.settlePieces(nextGravity);
  }

  settlePieces(gravity: GravityDirection): void {
    for (let col = 0; col < this.cols; col += 1) {
      let segmentStart = 0;
      for (let row = 0; row <= this.rows; row += 1) {
        const isBoundary = row === this.rows;
        const isObstacle = !isBoundary && this.matrix[row][col] === OBSTACLE;
        if (!isBoundary && !isObstacle) continue;

        this.settleSegment(col, segmentStart, row - 1, gravity);
        segmentStart = row + 1;
      }
    }
  }

  checkWin(row: number, col: number): WinResult | null {
    const player = this.matrix[row]?.[col];
    if (player !== 1 && player !== 2) return null;

    const directions: Position[] = [
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 1, col: -1 }
    ];

    for (const direction of directions) {
      const backward = this.collect(row, col, -direction.row, -direction.col, player).reverse();
      const forward = this.collect(row, col, direction.row, direction.col, player);
      const line = [...backward, { row, col }, ...forward];
      if (line.length >= this.winLength) {
        return {
          player,
          line: this.pickWinningWindow(line),
          direction
        };
      }
    }

    return null;
  }

  scanForWinner(preferredPlayer?: Player): WinResult | null {
    const players: Player[] = preferredPlayer === 2 ? [2, 1] : [1, 2];
    for (const player of players) {
      for (let row = 0; row < this.rows; row += 1) {
        for (let col = 0; col < this.cols; col += 1) {
          if (this.matrix[row][col] !== player) continue;
          const win = this.checkWin(row, col);
          if (win?.player === player) return win;
        }
      }
    }
    return null;
  }

  scanPlayerWinner(player: Player): WinResult | null {
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        if (this.matrix[row][col] !== player) continue;
        const win = this.checkWin(row, col);
        if (win?.player === player) return win;
      }
    }
    return null;
  }

  isDraw(gravity: GravityDirection): boolean {
    return this.getAvailableColumns(gravity).length === 0;
  }

  countPieces(player: Player): number {
    return this.matrix.flat().filter((cell) => cell === player).length;
  }

  private createEmptyMatrix(): Cell[][] {
    return Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, () => EMPTY as Cell));
  }

  private generateObstacles(count: number): void {
    const candidates: Position[] = [];
    const topGuard = this.rows > 6 ? 2 : 1;
    const bottomGuard = this.rows > 6 ? 2 : 1;

    for (let row = topGuard; row < this.rows - bottomGuard; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        candidates.push({ row, col });
      }
    }

    const max = Math.min(count, candidates.length);
    for (let index = 0; index < max; index += 1) {
      const pick = Math.floor(Math.random() * candidates.length);
      const [position] = candidates.splice(pick, 1);
      this.matrix[position.row][position.col] = OBSTACLE;
    }
  }

  private settleSegment(col: number, start: number, end: number, gravity: GravityDirection): void {
    if (start > end) return;

    const pieces: Player[] = [];
    for (let row = start; row <= end; row += 1) {
      const cell = this.matrix[row][col];
      if (cell === 1 || cell === 2) {
        pieces.push(cell);
      }
      this.matrix[row][col] = EMPTY;
    }

    if (gravity === 'up') {
      for (let offset = 0; offset < pieces.length; offset += 1) {
        this.matrix[start + offset][col] = pieces[offset];
      }
      return;
    }

    for (let offset = 0; offset < pieces.length; offset += 1) {
      this.matrix[end - offset][col] = pieces[pieces.length - 1 - offset];
    }
  }

  private collect(row: number, col: number, deltaRow: number, deltaCol: number, player: Player): Position[] {
    const cells: Position[] = [];
    const seen = new Set<string>([`${row}:${col}`]);
    let current: Position = { row, col };
    const maxSteps = this.rows * this.cols;

    for (let step = 0; step < maxSteps; step += 1) {
      const next = this.advance(current.row, current.col, deltaRow, deltaCol);
      if (!next) break;

      const key = `${next.row}:${next.col}`;
      if (seen.has(key)) break;
      seen.add(key);

      if (this.matrix[next.row][next.col] !== player) break;
      cells.push(next);
      current = next;
    }

    return cells;
  }

  private advance(row: number, col: number, deltaRow: number, deltaCol: number): Position | null {
    let nextRow = row + deltaRow;
    let nextCol = col + deltaCol;

    if (this.wrapVertical) {
      nextRow = this.mod(nextRow, this.rows);
    } else if (nextRow < 0 || nextRow >= this.rows) {
      return null;
    }

    if (this.wrapHorizontal) {
      nextCol = this.mod(nextCol, this.cols);
    } else if (nextCol < 0 || nextCol >= this.cols) {
      return null;
    }

    return { row: nextRow, col: nextCol };
  }

  private pickWinningWindow(line: Position[]): Position[] {
    if (line.length <= this.winLength) return line;
    const middle = Math.floor(line.length / 2);
    let start = Math.max(0, middle - Math.floor(this.winLength / 2));
    start = Math.min(start, line.length - this.winLength);
    return line.slice(start, start + this.winLength);
  }

  private isInside(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  private mod(value: number, size: number): number {
    return ((value % size) + size) % size;
  }
}
