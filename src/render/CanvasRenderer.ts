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
import type { GameRenderer, RenderState } from './types';
import { ACTIVE_SHOWCASE_THEME } from '../showcaseTheme';

const PERSPECTIVE_REVEAL = 1 / 3;

interface RenderContext {
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

interface Layout {
  width: number;
  height: number;
  cell: number;
  originX: number;
  originY: number;
  boardWidth: number;
  boardHeight: number;
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

export class CanvasRenderer implements GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private hoverCol: number | null = null;
  private layout: Layout = {
    width: 0,
    height: 0,
    cell: 0,
    originX: 0,
    originY: 0,
    boardWidth: 0,
    boardHeight: 0,
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

  sync(_state: RenderState): void {
    // Canvas reads the live engine context each frame; this keeps the renderer contract shared with Three.js.
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

  animateMove(resolvedOutcome: MoveOutcome, _before?: RenderState, _after?: RenderState): Promise<void> {
    if (!resolvedOutcome.ok || !resolvedOutcome.position || !resolvedOutcome.player) {
      if (resolvedOutcome.kind === 'flip') return this.animateFlash();
      return Promise.resolve();
    }

    if (resolvedOutcome.kind === 'bomb') {
      return this.animateBomb(resolvedOutcome.position, resolvedOutcome.player);
    }

    return this.animateDrop(resolvedOutcome.position, resolvedOutcome.player);
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

    const reserve = this.getPerspectiveReserve();
    const padding = Math.max(16, Math.min(width, height) * 0.04);
    const cell = Math.min(
      (width - padding * 2) / (this.board.cols * (1 + reserve.x)),
      (height - padding * 2) / (this.board.rows * (1 + reserve.y))
    );
    const boardWidth = cell * this.board.cols;
    const boardHeight = cell * this.board.rows;

    this.layout = {
      width,
      height,
      cell,
      originX: (width - boardWidth) / 2,
      originY: (height - boardHeight) / 2,
      boardWidth,
      boardHeight,
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

    const perspectiveOffsets = this.getMirrorOffsets(context);

    this.drawBackground(context.scoreSkew);
    for (const offset of perspectiveOffsets) {
      if (offset.x === 0 && offset.y === 0) continue;
      this.drawPerspectiveSlice(matrix, offset.x, offset.y);
    }

    this.drawBoardPlate(0, 0, 1);
    this.drawHover(context, gravity);
    this.drawCells(matrix, 0, 0, 1);
    this.drawGhost(context, gravity);
    this.drawFalling(time);
    this.drawBlasts(time);
    this.drawWinLine(winLine, status, winner, time, context.wrapHorizontal, context.wrapVertical);
    this.drawFlash(time);

    this.frameHandle = window.requestAnimationFrame((nextTime) => this.draw(nextTime));
  }

  private drawBackground(scoreSkew: number): void {
    const { width, height } = this.layout;
    // Keep the playfield quiet so the board and pieces carry the color hierarchy.
    this.ctx.fillStyle = '#071016';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    this.ctx.globalAlpha = 0.12;
    this.ctx.fillStyle = '#31515c';
    for (let i = 0; i < 12; i += 1) {
      const x = (i * 97) % width;
      const y = (i * 151) % height;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private drawBoardPlate(offsetX = 0, offsetY = 0, alpha = 1): void {
    const { cell, boardWidth: width, boardHeight: height } = this.layout;
    const origin = this.boardOrigin(offsetX, offsetY);
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
    this.ctx.shadowBlur = offsetX === 0 && offsetY === 0 ? 18 : 8;
    this.ctx.shadowOffsetY = offsetX === 0 && offsetY === 0 ? 8 : 3;
    this.roundRect(origin.x - cell * 0.1, origin.y - cell * 0.1, width + cell * 0.2, height + cell * 0.2, 18);
    this.ctx.fillStyle = '#1d282a';
    this.ctx.fill();

    this.ctx.shadowColor = 'transparent';
    this.roundRect(origin.x, origin.y, width, height, 14);
    const plateGradient = this.ctx.createLinearGradient(0, origin.y, 0, origin.y + height);
    plateGradient.addColorStop(0, '#263335');
    plateGradient.addColorStop(1, '#1d282a');
    this.ctx.fillStyle = plateGradient;
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(120, 150, 150, 0.24)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawPerspectiveSlice(matrix: Cell[][], offsetX: number, offsetY: number): void {
    const clip = this.perspectiveClipRect(offsetX, offsetY);
    if (clip.width <= 0 || clip.height <= 0) return;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(clip.x, clip.y, clip.width, clip.height);
    this.ctx.clip();
    this.drawBoardPlate(offsetX, offsetY, 0.28);
    this.drawCells(matrix, offsetX, offsetY, 0.24);
    this.ctx.restore();
  }

  private drawHover(context: RenderContext, gravity: GravityDirection): void {
    if (this.hoverCol === null || !context.previewEnabled || this.replayFrame) return;
    if (this.board.findDropRow(this.hoverCol, gravity) === null) return;

    const { originX, originY, cell } = this.layout;
    this.ctx.save();
    this.roundRect(originX + this.hoverCol * cell + cell * 0.08, originY + cell * 0.08, cell * 0.84, cell * this.board.rows - cell * 0.16, 12);
    this.ctx.fillStyle = 'rgba(105, 230, 255, 0.06)';
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(105, 230, 255, 0.42)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawCells(matrix: Cell[][], offsetX = 0, offsetY = 0, alpha = 1): void {
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    for (let row = 0; row < this.board.rows; row += 1) {
      for (let col = 0; col < this.board.cols; col += 1) {
        const center = this.centerOf(row, col, offsetX, offsetY);
        const cell = matrix[row][col];
        this.drawHole(center.x, center.y);

        if (cell === -1) {
          this.drawObstacle(center.x, center.y);
        } else if ((cell === 1 || cell === 2) && !this.hiddenCells.has(this.key({ row, col }))) {
          this.drawPiece(center.x, center.y, cell, alpha, this.layout.radius);
        }
      }
    }
    this.ctx.restore();
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

  private drawWinLine(
    line: Position[],
    status: GameStatus,
    winner: Player | null,
    time: number,
    wrapHorizontal: boolean,
    wrapVertical: boolean
  ): void {
    if (status !== 'won' || !winner || line.length === 0) return;

    const pulse = 0.5 + Math.sin(time / 130) * 0.5;
    const centers = line.map((cell) => this.centerOf(cell.row, cell.col));
    const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];

    for (let index = 1; index < centers.length; index += 1) {
      const previousCell = line[index - 1];
      const currentCell = line[index];
      const previous = centers[index - 1];
      const current = centers[index];
      const colStep = wrapStep(currentCell.col - previousCell.col, this.board.cols, wrapHorizontal);
      const rowStep = wrapStep(currentCell.row - previousCell.row, this.board.rows, wrapVertical);
      const expected = { x: colStep * this.layout.cell, y: rowStep * this.layout.cell };
      const actual = { x: current.x - previous.x, y: current.y - previous.y };

      if (Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1) {
        segments.push([previous, current]);
        continue;
      }

      const length = Math.max(1, Math.hypot(expected.x, expected.y));
      const direction = { x: expected.x / length, y: expected.y / length };
      const stubLength = this.layout.cell * 0.82;
      segments.push([
        previous,
        { x: previous.x + direction.x * stubLength, y: previous.y + direction.y * stubLength }
      ]);
      segments.push([
        { x: current.x - direction.x * stubLength, y: current.y - direction.y * stubLength },
        current
      ]);
    }

    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowColor = winner === 1 ? ACTIVE_SHOWCASE_THEME.playerAHighlightCss : ACTIVE_SHOWCASE_THEME.playerBHighlightCss;
    this.ctx.shadowBlur = 16 + pulse * 14;

    const drawSegments = (color: string, width: number) => {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = width;
      this.ctx.beginPath();
      for (const [start, end] of segments) {
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);
      }
      this.ctx.stroke();
    };

    drawSegments(winner === 1 ? ACTIVE_SHOWCASE_THEME.playerADarkCss : ACTIVE_SHOWCASE_THEME.playerBDarkCss, Math.max(10, this.layout.cell * 0.18));
    drawSegments(winner === 1 ? ACTIVE_SHOWCASE_THEME.playerAHighlightCss : ACTIVE_SHOWCASE_THEME.playerBHighlightCss, Math.max(5, this.layout.cell * 0.085));

    for (const center of centers) {
      this.ctx.fillStyle = winner === 1 ? `rgba(77, 163, 255, ${0.12 + pulse * 0.1})` : `rgba(245, 184, 75, ${0.12 + pulse * 0.1})`;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, this.layout.radius * 1.2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = winner === 1 ? ACTIVE_SHOWCASE_THEME.playerAHighlightCss : ACTIVE_SHOWCASE_THEME.playerBHighlightCss;
      this.ctx.lineWidth = Math.max(4, this.layout.cell * 0.065);
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
    const gradient = this.ctx.createRadialGradient(x, y + this.layout.radius * 0.12, this.layout.radius * 0.08, x, y + this.layout.radius * 0.12, this.layout.radius * 1.04);
    gradient.addColorStop(0, '#071114');
    gradient.addColorStop(0.72, '#050a0d');
    gradient.addColorStop(1, '#050b0d');
    this.ctx.save();
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.layout.radius * 1.03, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(120, 150, 150, 0.28)';
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
      gradient.addColorStop(0, ACTIVE_SHOWCASE_THEME.playerAHighlightCss);
      gradient.addColorStop(0.45, ACTIVE_SHOWCASE_THEME.playerACss);
      gradient.addColorStop(1, ACTIVE_SHOWCASE_THEME.playerADarkCss);
    } else {
      gradient.addColorStop(0, ACTIVE_SHOWCASE_THEME.playerBHighlightCss);
      gradient.addColorStop(0.5, ACTIVE_SHOWCASE_THEME.playerBCss);
      gradient.addColorStop(1, ACTIVE_SHOWCASE_THEME.playerBDarkCss);
    }

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.shadowColor = player === 1 ? 'rgba(77, 163, 255, 0.28)' : 'rgba(245, 184, 75, 0.25)';
    this.ctx.shadowBlur = 8;
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
    this.ctx.strokeStyle = player === 1 ? ACTIVE_SHOWCASE_THEME.playerACss : ACTIVE_SHOWCASE_THEME.playerBCss;
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

  private centerOf(row: number, col: number, offsetX = 0, offsetY = 0): { x: number; y: number } {
    const origin = this.boardOrigin(offsetX, offsetY);
    const { cell } = this.layout;
    return {
      x: origin.x + col * cell + cell / 2,
      y: origin.y + row * cell + cell / 2
    };
  }

  private boardOrigin(offsetX: number, offsetY: number): { x: number; y: number } {
    const { originX, originY, cell } = this.layout;
    return {
      x: originX + offsetX * cell * this.board.cols,
      y: originY + offsetY * cell * this.board.rows
    };
  }

  private perspectiveClipRect(offsetX: number, offsetY: number): { x: number; y: number; width: number; height: number } {
    const { width: canvasWidth, height: canvasHeight, boardWidth, boardHeight } = this.layout;
    const origin = this.boardOrigin(offsetX, offsetY);
    const x = Math.max(0, origin.x);
    const y = Math.max(0, origin.y);
    const right = Math.min(canvasWidth, origin.x + boardWidth);
    const bottom = Math.min(canvasHeight, origin.y + boardHeight);

    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y)
    };
  }

  private getMirrorOffsets(context: RenderContext): Array<{ x: number; y: number }> {
    const active = context.topologyPerspectiveEnabled && (context.wrapHorizontal || context.wrapVertical);
    if (!active) return [{ x: 0, y: 0 }];

    const xs = context.wrapHorizontal ? [-1, 0, 1] : [0];
    const ys = context.wrapVertical ? [-1, 0, 1] : [0];
    const offsets: Array<{ x: number; y: number }> = [];

    for (const y of ys) {
      for (const x of xs) {
        offsets.push({ x, y });
      }
    }

    return offsets;
  }

  private getPerspectiveReserve(): { x: number; y: number } {
    return {
      x: PERSPECTIVE_REVEAL * 2,
      y: PERSPECTIVE_REVEAL * 2
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

function wrapStep(delta: number, size: number, enabled: boolean): number {
  if (!enabled || size <= 0) return delta;
  if (delta > size / 2) return delta - size;
  if (delta < -size / 2) return delta + size;
  return delta;
}
