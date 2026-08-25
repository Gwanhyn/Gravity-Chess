import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Board } from './core/Board';
import { ShowcaseAI } from './core/ShowcaseAI';
import type { Position } from './core/types';
import { ACTIVE_SHOWCASE_THEME, PLAYER_A_COLOR, PLAYER_B_COLOR } from './showcaseTheme';
import './style.css';

type Player = 1 | 2;
type ShowcasePhase = 'SPAWNING' | 'FALLING' | 'SETTLED' | 'WAITING' | 'CLEARING' | 'SETTLING' | 'STABILIZING' | 'WON' | 'RESETTING';

const SHOWCASE_PIECE_Z = 0.48;

interface ShowcasePiece {
  id: number;
  player: Player;
  row: number;
  col: number;
  mesh: THREE.Mesh;
  fromY: number;
  toY: number;
  spawnAt: number;
  duration: number;
}

const landing = document.querySelector<HTMLElement>('#landingView');
const game = document.querySelector<HTMLElement>('#app');
const canvas = document.querySelector<HTMLCanvasElement>('#heroCanvas');
const heroLoading = document.querySelector<HTMLElement>('#heroLoading');
const startLink = document.querySelector<HTMLAnchorElement>('#startGameLink');

if (landing && game && canvas) {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const playUrl = `${baseUrl.replace(/\/?$/, '/')}play`;
  if (startLink) startLink.href = playUrl;

  const normalizedPath = window.location.pathname.replace(/\/$/, '');
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const isPlay = normalizedPath === `${normalizedBase}/play` || normalizedPath.endsWith('/play');
  landing.hidden = isPlay;
  game.hidden = true;
  document.body.classList.toggle('landing-active', !isPlay);

  if (isPlay) {
    void import('./main');
  } else {
    // Let the module finish initializing before constructing the showcase class.
    queueMicrotask(() => {
      try {
        mountHero(canvas);
      } catch (error) {
        console.warn('Gravity Chess hero unavailable.', error);
        showHeroUnavailable(error);
      }
    });
  }
}

function showHeroUnavailable(error?: unknown): void {
  canvas?.setAttribute('data-hero-status', 'unavailable');
  if (canvas && error instanceof Error) canvas.dataset.heroError = error.message;
  if (heroLoading) {
    heroLoading.hidden = false;
    heroLoading.textContent = '3D BOARD UNAVAILABLE';
  }
}

function mountHero(canvas: HTMLCanvasElement): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvas.dataset.heroStatus = 'initializing';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071016);
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
  camera.position.set(7.4, 2.6, 15.6);

  const root = new THREE.Group();
  root.rotation.x = 0.02;
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xc2d1dc, 0x0c1415, 1.7));

  const key = new THREE.DirectionalLight(0xffebd2, 3.5);
  key.position.set(-6, 11, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(768, 768);
  scene.add(key);
  const rim = new THREE.PointLight(0x69e6ff, 2.8, 20, 2);
  rim.position.set(7, 5, 4);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0x0b1114, roughness: 0.78, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.7;
  floor.receiveShadow = true;
  scene.add(floor);

  const board = new THREE.Group();
  root.add(board);
  const boardWidth = 8.6;
  const boardHeight = 6.35;
  const spacing = 1.06;
  const rows = 5;
  const cols = 7;
  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0x1e282b, metalness: 0.35, roughness: 0.55, emissive: 0x071115, emissiveIntensity: 0.24 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x607579, metalness: 0.55, roughness: 0.42 });
  const holeMaterial = new THREE.MeshStandardMaterial({ color: 0x050b0d, roughness: 0.8, metalness: 0.1 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(boardWidth, boardHeight, 0.56), boardMaterial);
  base.castShadow = true;
  base.receiveShadow = true;
  board.add(base);

  const railGeometry = new THREE.BoxGeometry(boardWidth + 0.25, 0.24, 0.22);
  for (const y of [-boardHeight / 2, boardHeight / 2]) {
    const rail = new THREE.Mesh(railGeometry, frameMaterial);
    rail.position.set(0, y, 0.34);
    rail.castShadow = true;
    board.add(rail);
  }
  const sideRailGeometry = new THREE.BoxGeometry(0.22, boardHeight, 0.22);
  for (const x of [-boardWidth / 2, boardWidth / 2]) {
    const rail = new THREE.Mesh(sideRailGeometry, frameMaterial);
    rail.position.set(x, 0, 0.34);
    rail.castShadow = true;
    board.add(rail);
  }

  const holeGeometry = new THREE.CylinderGeometry(0.34, 0.4, 0.12, 28);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const hole = new THREE.Mesh(holeGeometry, holeMaterial);
      hole.position.set((col - 3) * spacing, (2 - row) * spacing, 0.31);
      hole.rotation.x = Math.PI / 2;
      hole.receiveShadow = true;
      board.add(hole);
    }
  }

  const playerAMaterial = new THREE.MeshStandardMaterial({ color: PLAYER_A_COLOR, metalness: 0.18, roughness: 0.36, emissive: ACTIVE_SHOWCASE_THEME.playerAEmissive, emissiveIntensity: 0.24 });
  const playerBMaterial = new THREE.MeshStandardMaterial({ color: PLAYER_B_COLOR, metalness: 0.2, roughness: 0.38, emissive: ACTIVE_SHOWCASE_THEME.playerBEmissive, emissiveIntensity: 0.21 });
  const pieceGeometry = new THREE.CylinderGeometry(0.31, 0.39, 0.25, 36);
  const pool: ShowcasePiece[] = [];
  for (let id = 0; id < rows * cols; id += 1) {
    const mesh = new THREE.Mesh(pieceGeometry, playerAMaterial);
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    board.add(mesh);
    pool.push({ id, player: 1, row: 0, col: 0, mesh, fromY: 0, toY: 0, spawnAt: 0, duration: 0.8 });
  }

  const winGroup = new THREE.Group();
  board.add(winGroup);
  const showcase = new ShowcaseBoard(rows, cols, spacing, pool, playerAMaterial, playerBMaterial, winGroup);
  canvas.dataset.showcasePhase = showcase.phase;
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 10;
  controls.maxDistance = 18;
  controls.minPolarAngle = 0.72;
  controls.maxPolarAngle = 1.22;
  controls.target.set(0, 0.25, 0);
  controls.update();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  let frameHandle = 0;
  let lastTime = 0;
  let disposed = false;
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const compact = width < 700;
    root.position.x = compact ? 1.15 : 2.25;
    root.scale.setScalar(compact ? 0.76 : 1);
    camera.position.z = compact ? 17.2 : 15.6;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.6));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  const render = (): void => {
    if (disposed) return;
    try {
      const now = clock.getElapsedTime();
      const delta = Math.min(0.1, Math.max(0, now - lastTime));
      lastTime = now;
      root.rotation.y = reducedMotion ? 0 : Math.sin(now * 0.16) * 0.035;
      showcase.update(now, delta);
      canvas.dataset.showcasePhase = showcase.phase;
      canvas.dataset.showcaseState = showcase.diagnostics;
      controls.update();
      renderer.render(scene, camera);
      canvas.dataset.heroStatus = 'ready';
      if (heroLoading) heroLoading.hidden = true;
      frameHandle = window.requestAnimationFrame(render);
    } catch (error) {
      console.warn('Gravity Chess hero render stopped.', error);
      disposed = true;
      showHeroUnavailable(error);
    }
  };
  render();

  window.addEventListener('pagehide', () => {
    disposed = true;
    window.cancelAnimationFrame(frameHandle);
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    controls.dispose();
    showcase.dispose();
    renderer.dispose();
  }, { once: true });
}

class ShowcaseBoard {
  private readonly board: Array<Array<ShowcasePiece | null>>;
  private readonly rulesBoard: Board;
  private readonly showcaseAI: ShowcaseAI;
  private readonly active = new Set<ShowcasePiece>();
  private readonly free: ShowcasePiece[];
  private readonly settlingPieces: ShowcasePiece[] = [];
  private readonly winRingGeometry = new THREE.TorusGeometry(0.42, 0.026, 8, 36);
  private readonly winRingMaterials: Record<Player, THREE.MeshBasicMaterial>;
  private readonly winRings: THREE.Mesh[] = [];
  private phaseStarted = 0;
  private nextSpawnAt = 0;
  private lastClearAt = 0;
  private clearThreshold = 13;
  private seed = (Date.now() ^ 0x9e3779b9) >>> 0;
  private fallingPiece: ShowcasePiece | null = null;
  private currentPhase: ShowcasePhase = 'SPAWNING';
  private nextPlayer: Player = 1;
  private winningLine: ShowcasePiece[] = [];
  private winStartedAt = -Infinity;
  private lastClearedCount = 0;
  private lastDropPosition: Position | null = null;
  private moveCount = 0;

  get phase(): ShowcasePhase { return this.currentPhase; }

  get diagnostics(): string {
    const bottomCount = this.board[this.rows - 1].filter(Boolean).length;
    return `${this.currentPhase}|pieces:${this.active.size}|moves:${this.moveCount}|styles:${this.showcaseAI.getLevel(1)}/${this.showcaseAI.getLevel(2)}|bottom:${bottomCount}|stable:${this.isBoardStable()}|cleared:${this.lastClearedCount}`;
  }

  constructor(
    private readonly rows: number,
    private readonly cols: number,
    private readonly spacing: number,
    pool: ShowcasePiece[],
    private readonly playerAMaterial: THREE.MeshStandardMaterial,
    private readonly playerBMaterial: THREE.MeshStandardMaterial,
    private readonly winGroup: THREE.Group
  ) {
    this.board = Array.from({ length: rows }, () => Array<ShowcasePiece | null>(cols).fill(null));
    this.rulesBoard = new Board({
      rows,
      cols,
      winLength: 4,
      wrapHorizontal: true,
      wrapVertical: true,
      obstaclesEnabled: false,
      obstacleCount: 0
    });
    this.showcaseAI = new ShowcaseAI({ gravity: 'down' });
    this.showcaseAI.assignRandomLevels(() => this.random());
    this.free = [...pool];
    this.winRingMaterials = {
      1: new THREE.MeshBasicMaterial({ color: ACTIVE_SHOWCASE_THEME.playerAHighlight, transparent: true, opacity: 0, depthTest: false }),
      2: new THREE.MeshBasicMaterial({ color: ACTIVE_SHOWCASE_THEME.playerBHighlight, transparent: true, opacity: 0, depthTest: false })
    };
    for (let index = 0; index < 4; index += 1) {
      const ring = new THREE.Mesh(this.winRingGeometry, this.winRingMaterials[1]);
      ring.visible = false;
      ring.renderOrder = 2;
      this.winGroup.add(ring);
      this.winRings.push(ring);
    }
  }

  update(now: number, _delta: number): void {
    this.updateSettlingPieces(now);
    this.updateWinHighlight(now);
    switch (this.currentPhase) {
      case 'SPAWNING': this.spawn(now); break;
      case 'FALLING': this.updateFalling(now); break;
      case 'SETTLED':
        {
          const winningLine = this.findFourInARow();
          if (winningLine) {
            this.beginVictory(now, winningLine);
          } else {
            this.currentPhase = 'WAITING';
            this.phaseStarted = now;
            this.nextSpawnAt = now + this.randomBetween(0.08, 0.16);
          }
        }
        break;
      case 'WAITING':
        if (this.shouldClear(now)) this.beginClearing(now);
        else if (now >= this.nextSpawnAt) this.currentPhase = 'SPAWNING';
        break;
      case 'CLEARING': this.updateClearing(now); break;
      case 'SETTLING': this.updateSettling(now); break;
      case 'STABILIZING':
        if (now - this.phaseStarted >= 0.22) {
          this.currentPhase = 'WAITING';
          this.nextSpawnAt = now + this.randomBetween(0.24, 0.42);
        }
        break;
      case 'WON': this.updateVictory(now); break;
      case 'RESETTING': this.updateResetting(now); break;
    }
  }

  dispose(): void {
    for (const piece of this.active) piece.mesh.visible = false;
    this.active.clear();
    this.settlingPieces.length = 0;
    this.free.length = 0;
    this.winRingGeometry.dispose();
    this.winRingMaterials[1].dispose();
    this.winRingMaterials[2].dispose();
  }

  private spawn(now: number): void {
    if (this.currentPhase !== 'SPAWNING' || this.free.length === 0) return;
    const column = this.showcaseAI.chooseMove(this.rulesBoard, this.nextPlayer, () => this.random());
    if (column === null) {
      this.beginClearing(now);
      return;
    }
    const position = this.rulesBoard.dropPiece(column, this.nextPlayer, 'down');
    if (!position) {
      this.beginClearing(now);
      return;
    }
    const row = position.row;

    const piece = this.free.pop() as ShowcasePiece;
    piece.player = this.nextPlayer;
    this.nextPlayer = this.nextPlayer === 1 ? 2 : 1;
    piece.row = row;
    piece.col = column;
    piece.fromY = 5.45 + this.random() * 0.22;
    piece.toY = this.targetY(row);
    piece.spawnAt = now;
    piece.duration = this.randomBetween(0.54, 0.82);
    piece.mesh.material = piece.player === 1 ? this.playerAMaterial : this.playerBMaterial;
    piece.mesh.position.set(this.targetX(column), piece.fromY, SHOWCASE_PIECE_Z);
    piece.mesh.scale.setScalar(1);
    piece.mesh.visible = true;

    // The logical grid reserves the destination before the visual fall begins.
    this.board[row][column] = piece;
    this.active.add(piece);
    this.lastDropPosition = position;
    this.moveCount += 1;
    this.fallingPiece = piece;
    this.currentPhase = 'FALLING';
    this.phaseStarted = now;
  }

  private updateFalling(now: number): void {
    const piece = this.fallingPiece;
    if (!piece) {
      this.currentPhase = 'SETTLED';
      return;
    }
    const progress = Math.min(1, (now - piece.spawnAt) / piece.duration);
    const eased = gravityEase(progress);
    piece.mesh.position.y = piece.fromY + (piece.toY - piece.fromY) * eased;
    if (progress > 0.86) piece.mesh.position.y += Math.sin((progress - 0.86) / 0.14 * Math.PI) * 0.018;
    // Release the next drop while the current piece is finishing its short settle.
    // The settling piece continues animating independently below.
    if (progress >= 0.68) {
      piece.fromY = piece.mesh.position.y;
      piece.spawnAt = now;
      piece.duration = 0.24;
      this.settlingPieces.push(piece);
      this.fallingPiece = null;
      this.currentPhase = 'SETTLED';
      this.phaseStarted = now;
    }
  }

  private updateSettlingPieces(now: number): void {
    for (let index = this.settlingPieces.length - 1; index >= 0; index -= 1) {
      const piece = this.settlingPieces[index];
      const progress = Math.min(1, (now - piece.spawnAt) / piece.duration);
      piece.mesh.position.y = piece.fromY + (piece.toY - piece.fromY) * gravityEase(progress);
      if (progress >= 1) {
        piece.mesh.position.y = piece.toY;
        this.settlingPieces.splice(index, 1);
      }
    }
  }

  private shouldClear(now: number): boolean {
    if (this.settlingPieces.length > 0) return false;
    const bottomCount = this.board[this.rows - 1].filter(Boolean).length;
    const total = this.active.size;
    if (bottomCount < Math.ceil(this.cols * 0.7)) return false;
    if (total >= this.clearThreshold) return true;
    return now - this.lastClearAt >= 22 && total >= 10;
  }

  private beginClearing(now: number): void {
    if (this.currentPhase === 'CLEARING' || this.currentPhase === 'SETTLING' || this.currentPhase === 'STABILIZING') return;
    if (this.board[this.rows - 1].every((piece) => !piece)) {
      this.currentPhase = 'SPAWNING';
      return;
    }
    this.clearWinHighlight();
    this.currentPhase = 'CLEARING';
    this.phaseStarted = now;
  }

  private updateClearing(now: number): void {
    const progress = Math.min(1, (now - this.phaseStarted) / 0.3);
    for (const piece of this.board[this.rows - 1]) {
      if (!piece) continue;
      piece.mesh.position.y = this.targetY(this.rows - 1) - easeInCubic(progress) * 0.24;
      piece.mesh.scale.setScalar(Math.max(0.04, 1 - easeInCubic(progress) * 0.34));
    }
    if (progress >= 1) this.removeBottomAndCompress(now);
  }

  private removeBottomAndCompress(now: number): void {
    let removed = 0;
    for (let col = 0; col < this.cols; col += 1) {
      const piece = this.board[this.rows - 1][col];
      if (!piece) continue;
      piece.mesh.visible = false;
      piece.mesh.scale.setScalar(1);
      this.active.delete(piece);
      this.free.push(piece);
      this.board[this.rows - 1][col] = null;
      removed += 1;
    }
    for (let col = 0; col < this.cols; col += 1) {
      const remaining: ShowcasePiece[] = [];
      for (let row = this.rows - 2; row >= 0; row -= 1) {
        const piece = this.board[row][col];
        if (piece) remaining.push(piece);
        this.board[row][col] = null;
      }
      for (let index = 0; index < remaining.length; index += 1) {
        const piece = remaining[index];
        const nextRow = this.rows - 1 - index;
        piece.fromY = this.targetY(piece.row);
        piece.toY = this.targetY(nextRow);
        piece.row = nextRow;
        this.board[nextRow][col] = piece;
      }
    }
    for (const piece of this.active) piece.mesh.position.y = piece.fromY;
    this.lastClearedCount = removed;
    this.currentPhase = 'SETTLING';
    this.phaseStarted = now;
    this.lastClearAt = now;
    this.clearThreshold = 13 + Math.floor(this.random() * 3);
    const matrix = this.rulesBoard.cloneMatrix();
    matrix[this.rows - 1].fill(0);
    for (let col = 0; col < this.cols; col += 1) {
      const remaining = matrix.slice(0, this.rows - 1).map((row) => row[col]).filter((cell) => cell === 1 || cell === 2);
      for (let row = 0; row < this.rows; row += 1) matrix[row][col] = 0;
      for (let index = 0; index < remaining.length; index += 1) matrix[this.rows - 1 - index][col] = remaining[remaining.length - 1 - index];
    }
    this.rulesBoard.setMatrix(matrix);
  }

  private updateSettling(now: number): void {
    const progress = Math.min(1, (now - this.phaseStarted) / 0.52);
    const eased = gravityEase(progress);
    for (const piece of this.active) {
      piece.mesh.position.set(this.targetX(piece.col), piece.fromY + (piece.toY - piece.fromY) * eased, SHOWCASE_PIECE_Z);
      piece.mesh.scale.setScalar(1);
    }
    if (progress >= 1) {
      for (const piece of this.active) piece.mesh.position.y = piece.toY;
      this.currentPhase = 'STABILIZING';
      this.phaseStarted = now;
    }
  }

  private beginVictory(now: number, line: ShowcasePiece[]): void {
    this.winningLine = line;
    this.winStartedAt = now;
    this.currentPhase = 'WON';
    this.phaseStarted = now;
  }

  private findFourInARow(): ShowcasePiece[] | null {
    const win = this.lastDropPosition
      ? this.rulesBoard.checkWin(this.lastDropPosition.row, this.lastDropPosition.col)
      : this.rulesBoard.scanForWinner();
    if (!win) return null;
    const line = win.line
      .map((cell) => this.board[cell.row]?.[cell.col] ?? null)
      .filter((piece): piece is ShowcasePiece => Boolean(piece));
    return line.length === win.line.length ? line : null;
  }

  private updateWinHighlight(now: number): void {
    if (this.winningLine.length === 0) return;
    const progress = Math.min(1, (now - this.winStartedAt) / 3.1);
    const fade = progress < 0.12 ? progress / 0.12 : progress > 0.9 ? (1 - progress) / 0.1 : 1;
    for (let index = 0; index < this.winningLine.length; index += 1) {
      const piece = this.winningLine[index];
      const ring = this.winRings[index];
      ring.material = this.winRingMaterials[piece.player];
      ring.position.set(this.targetX(piece.col), this.targetY(piece.row), SHOWCASE_PIECE_Z + 0.16);
      ring.scale.setScalar(1.02 + Math.sin(progress * Math.PI * 4) * 0.04);
      ring.visible = true;
    }
    this.winRingMaterials[1].opacity = 0.44 * fade;
    this.winRingMaterials[2].opacity = 0.44 * fade;
  }

  private clearWinHighlight(): void {
    this.winningLine = [];
    for (const ring of this.winRings) ring.visible = false;
    this.winRingMaterials[1].opacity = 0;
    this.winRingMaterials[2].opacity = 0;
  }

  private updateVictory(now: number): void {
    if (now - this.phaseStarted < 3.1) return;
    this.clearWinHighlight();
    this.currentPhase = 'RESETTING';
    this.phaseStarted = now;
    for (const piece of this.active) piece.mesh.scale.setScalar(1);
  }

  private updateResetting(now: number): void {
    const progress = Math.min(1, (now - this.phaseStarted) / 0.34);
    const scale = Math.max(0.02, 1 - easeInCubic(progress));
    for (const piece of this.active) piece.mesh.scale.setScalar(scale);
    if (progress >= 1) this.resetShowcase(now);
  }

  private resetShowcase(now: number): void {
    for (const piece of this.active) {
      piece.mesh.visible = false;
      piece.mesh.scale.setScalar(1);
      this.free.push(piece);
    }
    this.active.clear();
    this.settlingPieces.length = 0;
    for (const row of this.board) row.fill(null);
    this.fallingPiece = null;
    this.nextPlayer = 1;
    this.lastClearedCount = 0;
    this.lastDropPosition = null;
    this.moveCount = 0;
    this.showcaseAI.assignRandomLevels(() => this.random());
    this.rulesBoard.setMatrix(Array.from({ length: this.rows }, () => Array(this.cols).fill(0)));
    this.clearThreshold = 13;
    this.lastClearAt = now;
    this.currentPhase = 'SPAWNING';
    this.phaseStarted = now;
    this.nextSpawnAt = now;
  }

  private isBoardStable(): boolean {
    for (let col = 0; col < this.cols; col += 1) {
      for (let row = 0; row < this.rows - 1; row += 1) {
        if (this.board[row][col] && !this.board[row + 1][col]) return false;
      }
    }
    return true;
  }

  private targetX(col: number): number { return (col - (this.cols - 1) / 2) * this.spacing; }
  private targetY(row: number): number { return ((this.rows - 1) / 2 - row) * this.spacing; }
  private randomBetween(min: number, max: number): number { return min + (max - min) * this.random(); }
  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }
}

function gravityEase(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 1 - Math.pow(1 - clamped, 3);
}

function easeInCubic(value: number): number {
  return Math.pow(Math.min(1, Math.max(0, value)), 3);
}
