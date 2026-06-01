import { Board } from '../core/Board';
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

interface RenderContext {
  currentPlayer: Player;
  gravity: GravityDirection;
  status: GameStatus;
  winner: Player | null;
  winLine: Position[];
  actionMode: ActionMode;
  previewEnabled: boolean;
  scoreSkew: number;
}

interface Layout {
  width: number;
  height: number;
  cell: number;
  originX: number;
  originY: number;
  radius: number;
}

interface FallingAnimation {
  kind: 'drop' | 'bomb';
  player: Player;
  row: number;
  col: number;
  gravity: GravityDirection;
  startedAt: number;
  duration: number;
  resolve: () => void;
}

interface BlastAnimation {
  center: Position;
  startedAt: number;
  duration: number;
}

interface FlashAnimation {
  startedAt: number;
  duration: number;
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private hoverCol: number | null = null;
  private layout: Layout = {
    width: 0,
    height: 0,
    cell: 0,
    originX: 0,
    originY: 0,
    radius: 0
  };
  private falling: FallingAnimation[] = [];
  private blasts: BlastAnimation[] = [];
  private flashes: FlashAnimation[] = [];
  private hiddenCells = new Set<string>();
  private replayFrame: ReplayFrame | null = null;
  private frameHandle = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private shell: HTMLElement,
    private board: Board,
    private getContext: () => RenderContext
  ) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is unavailable.');
    }
    this.ctx = context;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.frameHandle = window.requestAnimationFrame((time) => this.draw(time));
  }

  destroy(): void {
    window.cancelAnimationFrame(this.frameHandle);
  }

  setBoard(board: Board): void {
    this.board = board;
    this.resize();
  }

  setReplayFrame(frame: ReplayFrame | null): void {
    this.replayFrame = frame;
    this.hoverCol = null;
  }

  setHoverFromEvent(event: PointerEvent): number | null {
    const col = this.getColumnFromEvent(event);
    this.hoverCol = col;
    return col;
  }

  clearHover(): void {
    this.hoverCol = null;
  }

  getColumnFromEvent(event: PointerEvent | MouseEvent): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { originX, originY, cell } = this.layout;
    if (cell <= 0) return null;
    if (x < originX || y < originY || x > originX + cell * this.board.cols || y > originY + cell * this.board.rows) {
      return null;
    }
    return Math.min(this.board.cols - 1, Math.max(0, Math.floor((x - originX) / cell)));
  }

  animateMove(outcome: MoveOutcome): Promise<void> {
    if (!outcome.ok || !outcome.position || !outcome.player) {
      if (outcome.kind === 'flip') return this.animateFlash();
      return Promise.resolve();
    }

    if (outcome.kind === 'bomb') {
      return this.animateBomb(outcome.position, outcome.player);
    }

    return this.animateDrop(outcome.position, outcome.player);
  }

  animateFlash(): Promise<void> {
    return new Promise((resolve) => {
      this.flashes.push({
        startedAt: performance.now(),
        duration: 520
      });
      window.setTimeout(resolve, 520);
    });
  }

  private animateDrop(position: Position, player: Player): Promise<void> {
    return new Promise((resolve) => {
      this.hiddenCells.add(this.key(position));
      this.falling.push({
        kind: 'drop',
        player,
        row: position.row,
        col: position.col,
        gravity: this.getContext().gravity,
        startedAt: performance.now(),
        duration: 460 + Math.abs(this.startRowOffset(position.row)) * 22,
        resolve
      });
    });
  }

  private animateBomb(position: Position, player: Player): Promise<void> {
    return new Promise((resolve) => {
      this.falling.push({
        kind: 'bomb',
        player,
        row: position.row,
        col: position.col,
        gravity: this.getContext().gravity,
        startedAt: performance.now(),
        duration: 520 + Math.abs(this.startRowOffset(position.row)) * 18,
        resolve: () => {
          this.blasts.push({
            center: position,
            startedAt: performance.now(),
            duration: 520
          });
          resolve();
        }
      });
    });
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.shell.getBoundingClientRect();
    const width = Math.max(320, rect.width);
    const height = Math.max(320, rect.height);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padding = Math.max(14, Math.min(width, height) * 0.055);
    const cell = Math.min((width - padding * 2) / this.board.cols, (height - padding * 2) / this.board.rows);
    const boardWidth = cell * this.board.cols;
    const boardHeight = cell * this.board.rows;

    this.layout = {
      width,
      height,
      cell,
      originX: (width - boardWidth) / 2,
      originY: (height - boardHeight) / 2,
      radius: cell * 0.36
    };
  }

  private draw(time: number): void {
    const context = this.getContext();
    const matrix = this.replayFrame?.matrix ?? this.board.matrix;
    const gravity = this.replayFrame?.gravity ?? context.gravity;
    const winLine = this.replayFrame?.winLine ?? context.winLine;
    const status = this.replayFrame?.status ?? context.status;
    const winner = this.replayFrame?.winner ?? context.winner;

    this.drawBackground(context.scoreSkew);
    this.drawBoardPlate();
    this.drawHover(context, gravity);
    this.drawCells(matrix);
    this.drawGhost(context, gravity);
    this.drawFalling(time);
    this.drawBlasts(time);
    this.drawWinLine(winLine, status, winner, time);
    this.drawFlash(time);

    this.frameHandle = window.requestAnimationFrame((nextTime) => this.draw(nextTime));
  }

  private drawBackground(scoreSkew: number): void {
    const { width, height } = this.layout;
    const redAlpha = Math.max(0, scoreSkew) * 0.16;
    const goldAlpha = Math.max(0, -scoreSkew) * 0.16;

    const gradient = this.ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `rgba(238, 91, 91, ${0.08 + redAlpha})`);
    gradient.addColorStop(0.5, 'rgba(249, 251, 255, 0.96)');
    gradient.addColorStop(1, `rgba(239, 183, 68, ${0.08 + goldAlpha})`);
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    this.ctx.globalAlpha = 0.22;
    this.ctx.fillStyle = '#334155';
    for (let i = 0; i < 18; i += 1) {
      const x = (i * 97) % width;
      const y = (i * 151) % height;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private drawBoardPlate(): void {
    const { originX, originY, cell } = this.layout;
    const width = cell * this.board.cols;
    const height = cell * this.board.rows;
    this.ctx.save();
    this.ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
    this.ctx.shadowBlur = 24;
    this.ctx.shadowOffsetY = 12;
    this.roundRect(originX - cell * 0.1, originY - cell * 0.1, width + cell * 0.2, height + cell * 0.2, 18);
    this.ctx.fillStyle = '#253047';
    this.ctx.fill();

    this.ctx.shadowColor = 'transparent';
    this.roundRect(originX, originY, width, height, 14);
    this.ctx.fillStyle = '#30415f';
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawHover(context: RenderContext, gravity: GravityDirection): void {
    if (this.hoverCol === null || !context.previewEnabled || this.replayFrame) return;
    if (this.board.findDropRow(this.hoverCol, gravity) === null) return;

    const { originX, originY, cell } = this.layout;
    this.ctx.save();
    this.roundRect(originX + this.hoverCol * cell + cell * 0.08, originY + cell * 0.08, cell * 0.84, cell * this.board.rows - cell * 0.16, 12);
    this.ctx.fillStyle = 'rgba(92, 200, 255, 0.16)';
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(92, 200, 255, 0.45)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawCells(matrix: Cell[][]): void {
    for (let row = 0; row < this.board.rows; row += 1) {
      for (let col = 0; col < this.board.cols; col += 1) {
        const center = this.centerOf(row, col);
        const cell = matrix[row][col];
        this.drawHole(center.x, center.y);

        if (cell === -1) {
          this.drawObstacle(center.x, center.y);
        } else if ((cell === 1 || cell === 2) && !this.hiddenCells.has(this.key({ row, col }))) {
          this.drawPiece(center.x, center.y, cell, 1, this.layout.radius);
        }
      }
    }
  }

  private drawGhost(context: RenderContext, gravity: GravityDirection): void {
    if (this.hoverCol === null || !context.previewEnabled || this.replayFrame || context.status !== 'playing') return;

    const row = this.board.findDropRow(this.hoverCol, gravity);
    if (row === null) return;
    const center = this.centerOf(row, this.hoverCol);

    if (context.actionMode === 'bomb') {
      this.drawBomb(center.x, center.y, context.currentPlayer, 0.42, this.layout.radius);
      return;
    }

    this.drawPiece(center.x, center.y, context.currentPlayer, 0.36, this.layout.radius);
  }

  private drawFalling(time: number): void {
    this.falling = this.falling.filter((animation) => {
      const elapsed = time - animation.startedAt;
      const progress = Math.min(1, elapsed / animation.duration);
      const eased = easeOutBounce(progress);
      const center = this.centerOf(animation.row, animation.col);
      const startY = animation.gravity === 'down' ? -this.layout.cell : this.layout.height + this.layout.cell;
      const y = startY + (center.y - startY) * eased;

      if (animation.kind === 'bomb') {
        this.drawBomb(center.x, y, animation.player, 1, this.layout.radius);
      } else {
        this.drawPiece(center.x, y, animation.player, 1, this.layout.radius);
      }

      if (progress >= 1) {
        this.hiddenCells.delete(this.key(animation));
        animation.resolve();
        return false;
      }
      return true;
    });
  }

  private drawBlasts(time: number): void {
    this.blasts = this.blasts.filter((blast) => {
      const elapsed = time - blast.startedAt;
      const progress = Math.min(1, elapsed / blast.duration);
      const center = this.centerOf(blast.center.row, blast.center.col);

      this.ctx.save();
      this.ctx.globalAlpha = 1 - progress;
      this.ctx.strokeStyle = '#f97316';
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, this.layout.cell * (0.45 + progress * 1.15), 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.fillStyle = `rgba(255, 211, 91, ${0.22 * (1 - progress)})`;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, this.layout.cell * (0.35 + progress * 0.95), 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      return progress < 1;
    });
  }

  private drawWinLine(line: Position[], status: GameStatus, winner: Player | null, time: number): void {
    if (status !== 'won' || !winner || line.length === 0) return;

    const pulse = 0.5 + Math.sin(time / 130) * 0.5;
    const centers = line.map((cell) => this.centerOf(cell.row, cell.col));

    this.ctx.save();
    this.ctx.strokeStyle = winner === 1 ? '#ffeff0' : '#fff7d6';
    this.ctx.lineWidth = Math.max(5, this.layout.cell * 0.1);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowColor = winner === 1 ? '#ff4263' : '#f8c33b';
    this.ctx.shadowBlur = 16 + pulse * 14;

    if (centers.length > 1) {
      this.ctx.beginPath();
      this.ctx.moveTo(centers[0].x, centers[0].y);
      for (let index = 1; index < centers.length; index += 1) {
        const previous = centers[index - 1];
        const current = centers[index];
        const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
        if (distance > this.layout.cell * 1.65) {
          this.ctx.moveTo(current.x, current.y);
        } else {
          this.ctx.lineTo(current.x, current.y);
        }
      }
      this.ctx.stroke();
    }

    for (const center of centers) {
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, this.layout.radius * (1.12 + pulse * 0.12), 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawFlash(time: number): void {
    this.flashes = this.flashes.filter((flash) => {
      const progress = Math.min(1, (time - flash.startedAt) / flash.duration);
      this.ctx.save();
      this.ctx.globalAlpha = (1 - progress) * 0.45;
      this.ctx.fillStyle = '#67e8f9';
      this.ctx.fillRect(0, 0, this.layout.width, this.layout.height);
      this.ctx.restore();
      return progress < 1;
    });
  }

  private drawHole(x: number, y: number): void {
    const gradient = this.ctx.createRadialGradient(x, y, this.layout.radius * 0.2, x, y, this.layout.radius * 1.2);
    gradient.addColorStop(0, '#edf3fb');
    gradient.addColorStop(1, '#d6e0ec');
    this.ctx.save();
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.layout.radius * 1.03, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawObstacle(x: number, y: number): void {
    const size = this.layout.radius * 1.45;
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(Math.PI / 4);
    this.roundRect(-size / 2, -size / 2, size, size, 8);
    this.ctx.fillStyle = '#3f3f46';
    this.ctx.fill();
    this.ctx.strokeStyle = '#a1a1aa';
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawPiece(x: number, y: number, player: Player, alpha: number, radius: number): void {
    const gradient = this.ctx.createRadialGradient(x - radius * 0.32, y - radius * 0.32, radius * 0.08, x, y, radius);
    if (player === 1) {
      gradient.addColorStop(0, '#ffe0e6');
      gradient.addColorStop(0.45, '#ef476f');
      gradient.addColorStop(1, '#9f1239');
    } else {
      gradient.addColorStop(0, '#fff8cf');
      gradient.addColorStop(0.5, '#f2b84b');
      gradient.addColorStop(1, '#b45309');
    }

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.shadowColor = player === 1 ? 'rgba(239, 71, 111, 0.55)' : 'rgba(242, 184, 75, 0.55)';
    this.ctx.shadowBlur = 10;
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowColor = 'transparent';
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.66)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawBomb(x: number, y: number, player: Player, alpha: number, radius: number): void {
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    this.ctx.shadowBlur = 12;
    this.ctx.fillStyle = '#1f2937';
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 0.88, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowColor = 'transparent';
    this.ctx.strokeStyle = player === 1 ? '#fb7185' : '#facc15';
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 0.58, -0.2, Math.PI * 1.45);
    this.ctx.stroke();
    this.ctx.strokeStyle = '#f97316';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius * 0.48, y - radius * 0.64);
    this.ctx.quadraticCurveTo(x + radius * 0.8, y - radius * 1.08, x + radius * 1.05, y - radius * 0.82);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private centerOf(row: number, col: number): { x: number; y: number } {
    const { originX, originY, cell } = this.layout;
    return {
      x: originX + col * cell + cell / 2,
      y: originY + row * cell + cell / 2
    };
  }

  private startRowOffset(row: number): number {
    return this.getContext().gravity === 'down' ? row + 1 : this.board.rows - row;
  }

  private key(position: Position): string {
    return `${position.row}:${position.col}`;
  }

  private roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + width, y, x + width, y + height, r);
    this.ctx.arcTo(x + width, y + height, x, y + height, r);
    this.ctx.arcTo(x, y + height, x, y, r);
    this.ctx.arcTo(x, y, x + width, y, r);
    this.ctx.closePath();
  }
}

function easeOutBounce(value: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (value < 1 / d1) {
    return n1 * value * value;
  }
  if (value < 2 / d1) {
    const adjusted = value - 1.5 / d1;
    return n1 * adjusted * adjusted + 0.75;
  }
  if (value < 2.5 / d1) {
    const adjusted = value - 2.25 / d1;
    return n1 * adjusted * adjusted + 0.9375;
  }
  const adjusted = value - 2.625 / d1;
  return n1 * adjusted * adjusted + 0.984375;
}
