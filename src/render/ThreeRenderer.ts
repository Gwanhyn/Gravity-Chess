import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Board } from '../core/Board';
import type {
  MoveOutcome,
  Player,
  Position,
  ReplayFrame
} from '../core/types';
import type { GameRenderer, RenderState } from './types';
import { ACTIVE_SHOWCASE_THEME } from '../showcaseTheme';

const CENTER_Y = 3.62;
const CELL_SPACING = 1.18;
const ACCENT = 0x74b7b3;

interface Layout {
  width: number;
  height: number;
  halfWidth: number;
  halfHeight: number;
  centerY: number;
}

interface AnimationHandle {
  token: number;
  stop: () => void;
}

export class ThreeRenderer implements GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly pickMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly boardGroup = new THREE.Group();
  private readonly boardDecorGroup = new THREE.Group();
  private readonly cellsGroup = new THREE.Group();
  private readonly piecesGroup = new THREE.Group();
  private readonly topologyGroup = new THREE.Group();
  private readonly gravityGroup = new THREE.Group();
  private readonly winGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly floor: THREE.Mesh;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.HemisphereLight;
  private readonly rimLight: THREE.PointLight;
  private readonly mount: HTMLElement;
  private readonly getState: () => RenderState;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly defaultCellGeometry = new THREE.CylinderGeometry(0.405, 0.435, 0.07, 32);
  private readonly defaultPieceGeometry = createPieceGeometry();
  private readonly slotRimGeometry = new THREE.TorusGeometry(0.435, 0.026, 8, 32);
  private readonly winHaloGeometry = new THREE.TorusGeometry(0.46, 0.04, 10, 40);
  private readonly boardMaterial = new THREE.MeshStandardMaterial({
    color: 0x43545a,
    emissive: 0x142126,
    emissiveIntensity: 0.42,
    metalness: 0.28,
    roughness: 0.44
  });
  private readonly frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x87999d,
    emissive: 0x161c1e,
    emissiveIntensity: 0.12,
    metalness: 0.5,
    roughness: 0.3
  });
  private readonly cellMaterial = new THREE.MeshStandardMaterial({
    color: 0x18252b,
    emissive: 0x071115,
    emissiveIntensity: 0.44,
    metalness: 0.28,
    roughness: 0.5
  });
  private readonly slotRimMaterial = new THREE.MeshStandardMaterial({
    color: 0x66757b,
    metalness: 0.48,
    roughness: 0.32
  });
  private readonly playerMaterials: Record<Player, THREE.MeshStandardMaterial> = {
    1: new THREE.MeshStandardMaterial({ color: ACTIVE_SHOWCASE_THEME.playerA, metalness: 0.18, roughness: 0.36, emissive: ACTIVE_SHOWCASE_THEME.playerAEmissive, emissiveIntensity: 0.24 }),
    2: new THREE.MeshStandardMaterial({ color: ACTIVE_SHOWCASE_THEME.playerB, metalness: 0.2, roughness: 0.38, emissive: ACTIVE_SHOWCASE_THEME.playerBEmissive, emissiveIntensity: 0.21 })
  };
  private readonly gravityMaterial = new THREE.MeshStandardMaterial({
    color: ACCENT,
    emissive: 0x1d4a49,
    emissiveIntensity: 0.5,
    metalness: 0.38,
    roughness: 0.35
  });
  private readonly topologyMaterial = new THREE.MeshStandardMaterial({
    color: 0x548986,
    emissive: 0x163535,
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.52,
    metalness: 0.32,
    roughness: 0.38
  });
  private readonly hoverMaterial = new THREE.MeshStandardMaterial({
    color: ACCENT,
    emissive: 0x1a5a57,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide
  });
  private readonly winMaterials: Record<Player, THREE.MeshStandardMaterial> = {
    1: new THREE.MeshStandardMaterial({
      color: 0xffd7db,
      emissive: ACTIVE_SHOWCASE_THEME.playerA,
      emissiveIntensity: 1.15,
      metalness: 0.14,
      roughness: 0.28,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    }),
    2: new THREE.MeshStandardMaterial({
      color: 0xffe7bd,
      emissive: ACTIVE_SHOWCASE_THEME.playerB,
      emissiveIntensity: 1.15,
      metalness: 0.14,
      roughness: 0.28,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    })
  };

  private board: Board;
  private layout: Layout = { width: 0, height: 0, halfWidth: 0, halfHeight: 0, centerY: CENTER_Y };
  private state: RenderState | null = null;
  private replayFrame: ReplayFrame | null = null;
  private lastSignature = '';
  private hoverColumn: number | null = null;
  private hoverMesh: THREE.Group | null = null;
  private pickSurface: THREE.Mesh | null = null;
  private gravityPivot: THREE.Group | null = null;
  private pickTargets: THREE.Object3D[] = [];
  private animationActive = false;
  private animationToken = 0;
  private animation: AnimationHandle | null = null;
  private frameHandle = 0;
  private destroyed = false;
  readonly ready: Promise<void>;

  constructor(mount: HTMLElement, board: Board, getState: () => RenderState) {
    this.mount = mount;
    this.board = board;
    this.getState = getState;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'three-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Gravity Chess 3D 棋盘');
    this.mount.replaceChildren(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0d161c);
    this.scene.fog = new THREE.Fog(0x11161a, 20, 38);
    this.fillLight = new THREE.HemisphereLight(0xd6e0e1, 0x222a2c, 2.05);
    this.scene.add(this.fillLight);

    this.keyLight = new THREE.DirectionalLight(0xffe3cb, 4.4);
    this.keyLight.position.set(-7, 11, 13);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(768, 768);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 40;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.PointLight(0x9fc9ce, 4.8, 20, 2);
    this.rimLight.position.set(7, 7, 6);
    this.scene.add(this.rimLight);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32),
      new THREE.MeshStandardMaterial({ color: 0x20292c, roughness: 0.82, metalness: 0.08 })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.boardGroup.add(this.boardDecorGroup, this.cellsGroup, this.piecesGroup, this.topologyGroup, this.gravityGroup, this.winGroup, this.overlayGroup);
    this.scene.add(this.boardGroup);

    this.camera.position.set(6.8, 8.1, 15.8);
    this.camera.lookAt(0, CENTER_Y, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, CENTER_Y, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.7;
    this.controls.minPolarAngle = Math.PI * 0.28;
    this.controls.minAzimuthAngle = -Math.PI * 0.38;
    this.controls.maxAzimuthAngle = Math.PI * 0.38;

    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(this.mount);
    window.addEventListener('resize', this.resize);
    this.renderer.domElement.dataset.modelSource = 'procedural';
    this.ready = Promise.resolve();
    this.resize();
    this.frameHandle = window.requestAnimationFrame(this.renderFrame);
  }

  destroy(): void {
    this.destroyed = true;
    this.animationToken += 1;
    this.animation?.stop();
    this.animation = null;
    window.cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.resize);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.mount.replaceChildren();
  }

  setBoard(board: Board): void {
    this.board = board;
    this.lastSignature = '';
    if (!this.animationActive) this.sync(this.state ?? this.getState());
  }

  sync(state: RenderState): void {
    this.state = cloneState(state);
    if (this.animationActive) return;
    this.applyDisplayState(this.getDisplayState());
  }

  setReplayFrame(frame: ReplayFrame | null): void {
    this.replayFrame = frame;
    this.lastSignature = '';
    if (!this.animationActive) this.applyDisplayState(this.getDisplayState());
  }

  setHoverFromEvent(event: PointerEvent): number | null {
    this.hoverColumn = this.getColumnFromEvent(event);
    return this.hoverColumn;
  }

  clearHover(): void {
    this.hoverColumn = null;
  }

  getColumnFromEvent(event: PointerEvent | MouseEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || this.pickTargets.length === 0) return null;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.pickTargets, false);
    const hit = intersections.find((intersection) => intersection.object.userData.boardCell) ?? intersections[0];
    let column = hit?.object.userData.col;
    if (hit?.object.userData.boardSurface) {
      const localPoint = this.boardGroup.worldToLocal(hit.point.clone());
      const state = this.getDisplayState();
      const candidate = Math.round(localPoint.x / CELL_SPACING + (state.cols - 1) / 2);
      column = candidate >= 0 && candidate < state.cols ? candidate : undefined;
    }
    this.renderer.domElement.dataset.lastRaycastHits = String(intersections.length);
    this.renderer.domElement.dataset.lastRaycastColumn = typeof column === 'number' ? String(column) : '';
    return typeof column === 'number' ? column : null;
  }

  animateMove(outcome: MoveOutcome, before?: RenderState, after?: RenderState): Promise<void> {
    if (!outcome.ok) return Promise.resolve();
    const target = cloneState(after ?? this.state ?? this.getState());
    const source = cloneState(before ?? this.state ?? target);
    this.replayFrame = null;
    this.animationToken += 1;
    const token = this.animationToken;
    this.animation?.stop();
    this.animation = null;
    this.animationActive = true;
    this.renderer.domElement.dataset.animation = outcome.kind ?? 'state';
    this.renderer.domElement.dataset.animationProgress = '0';
    this.clearGroup(this.overlayGroup);
    this.applyDisplayState(source);

    if (this.reducedMotion.matches) {
      this.completeAnimation(target);
      return Promise.resolve();
    }

    if (outcome.kind === 'drop' && outcome.position && outcome.player) {
      return this.animatePieceArrival(outcome, target, token);
    }

    this.completeAnimation(target);
    return Promise.resolve();
  }

  animateFlash(): Promise<void> {
    return Promise.resolve();
  }

  private readonly resize = (): void => {
    const rect = this.mount.getBoundingClientRect();
    const width = Math.max(320, rect.width);
    const height = Math.max(320, rect.height);
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.75));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.layout.width > 0) this.resizeCamera();
  };

  private readonly renderFrame = (time: number): void => {
    if (this.destroyed) return;
    if (!this.animationActive) this.applyDisplayState(this.getDisplayState());
    this.updateHover(this.getDisplayState());
    const pulse = 1.05 + Math.sin(time / 240) * 0.18;
    this.winMaterials[1].emissiveIntensity = pulse;
    this.winMaterials[2].emissiveIntensity = pulse;
    for (const child of this.winGroup.children) {
      if (!child.userData.winHalo) continue;
      const scale = 1 + Math.sin(time / 180) * 0.035;
      child.scale.setScalar(scale);
    }
    this.controls.update();
    this.updateProjectedPickPoint();
    this.renderer.render(this.scene, this.camera);
    this.frameHandle = window.requestAnimationFrame(this.renderFrame);
  };

  private getDisplayState(): RenderState {
    const live = this.state ?? this.getState();
    if (!this.replayFrame) return live;
    return {
      ...live,
      matrix: this.replayFrame.matrix,
      currentPlayer: this.replayFrame.currentPlayer,
      gravity: this.replayFrame.gravity,
      status: this.replayFrame.status,
      winner: this.replayFrame.winner,
      winLine: this.replayFrame.winLine
    };
  }

  private applyDisplayState(state: RenderState): void {
    const signature = stateSignature(state);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.ensureLayout(state);
    this.clearGroup(this.cellsGroup);
    this.clearGroup(this.piecesGroup);
    this.clearGroup(this.winGroup);
    delete this.renderer.domElement.dataset.winHighlights;
    this.pickTargets = [];

    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        const value = state.matrix[row]?.[col] ?? 0;
        const cell = this.createCell(row, col);
        this.cellsGroup.add(cell);
        this.cellsGroup.add(this.createCellRim(row, col));
        this.pickTargets.push(cell);
        if (value === 1 || value === 2) this.piecesGroup.add(this.createPiece(row, col, value));
      }
    }
    if (this.pickSurface) this.pickTargets.push(this.pickSurface);
    this.renderer.domElement.dataset.pickTargetCount = String(this.pickTargets.length);

    this.buildTopology(state);
    this.updateGravityIndicator(state);
    this.buildWinLine(state);
  }

  private ensureLayout(state: RenderState): void {
    const width = Math.max(3.5, state.cols * CELL_SPACING);
    const height = Math.max(3.4, state.rows * CELL_SPACING);
    const changed = width !== this.layout.width || height !== this.layout.height;
    this.layout = { width, height, halfWidth: width / 2, halfHeight: height / 2, centerY: CENTER_Y };
    this.boardGroup.position.y = CENTER_Y;
    // Keep the presentation floor below the lowest board edge as the board grows.
    this.floor.position.y = Math.min(0, CENTER_Y - this.layout.halfHeight - 0.72);
    if (!changed && this.hoverMesh) return;

    this.clearGroup(this.boardDecorGroup);
    this.clearGroup(this.cellsGroup);
    this.clearGroup(this.topologyGroup);
    this.clearGroup(this.gravityGroup);
    this.hoverMesh = null;
    this.pickSurface = null;

    this.createProceduralBoard();

    const hover = new THREE.Group();
    hover.name = 'DropPreview';
    const previewPiece = new THREE.Mesh(this.defaultPieceGeometry, this.hoverMaterial);
    previewPiece.rotation.x = Math.PI / 2;
    previewPiece.position.z = 0.31;
    const previewRim = new THREE.Mesh(this.slotRimGeometry, this.hoverMaterial);
    previewRim.position.z = 0.205;
    hover.add(previewPiece, previewRim);
    this.hoverMesh = hover;
    this.hoverMesh.visible = false;
    this.boardDecorGroup.add(this.hoverMesh);
    this.pickSurface = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.pickMaterial);
    this.pickSurface.name = 'BoardPickSurface';
    this.pickSurface.position.z = 0.52;
    this.pickSurface.userData.boardSurface = true;
    this.boardDecorGroup.add(this.pickSurface);
    this.buildTopology(state);
    this.buildGravity(state);
    this.resizeCamera();
  }

  private createProceduralBoard(): void {
    this.addRoundedBox('Board_Frame', this.layout.width + 1.02, this.layout.height + 1.02, 0.32, 0, 0, -0.12, this.frameMaterial, this.boardDecorGroup, 0.18);
    this.addRoundedBox('Board_Inlay', this.layout.width + 0.66, this.layout.height + 0.66, 0.22, 0, 0, 0, this.boardMaterial, this.boardDecorGroup, 0.14);
  }

  private createCell(row: number, col: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.defaultCellGeometry, this.cellMaterial);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(this.localPosition(row, col, 0.13));
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData = { boardCell: true, row, col };
    return mesh;
  }

  private createCellRim(row: number, col: number): THREE.Mesh {
    const rim = new THREE.Mesh(this.slotRimGeometry, this.slotRimMaterial);
    rim.position.copy(this.localPosition(row, col, 0.18));
    rim.receiveShadow = true;
    return rim;
  }

  private createPiece(row: number, col: number, player: Player): THREE.Mesh {
    const mesh = new THREE.Mesh(this.defaultPieceGeometry, this.playerMaterials[player]);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(this.localPosition(row, col, 0.35));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { player, row, col, modelSource: 'procedural' };
    return mesh;
  }

  private createAnimatedPiece(position: Position, player: Player): THREE.Mesh {
    const mesh = this.createPiece(position.row, position.col, player);
    this.overlayGroup.add(mesh);
    return mesh;
  }

  private animatePieceArrival(outcome: MoveOutcome, target: RenderState, token: number): Promise<void> {
    const position = outcome.position as Position;
    const player = outcome.player as Player;
    const piece = this.createAnimatedPiece(position, player);
    this.renderer.domElement.dataset.lastAnimatedModelSource = String(piece.userData.modelSource);
    this.renderer.domElement.dataset.lastAnimatedGeometry = piece.geometry.uuid;
    const targetLocal = this.localPosition(position.row, position.col, 0.35);
    const distance = Math.max(3.6, this.layout.height * 0.74);
    const direction = target.gravity === 'down' ? 1 : -1;
    const startY = targetLocal.y + distance * direction;
    piece.position.y = startY;
    return this.runTween(520, token, (progress) => {
      const settled = easeOutSettle(progress);
      piece.position.y = startY + (targetLocal.y - startY) * settled;
      const compression = 1 - Math.sin(Math.min(progress, 0.92) * Math.PI) * 0.028;
      piece.scale.set(1 + (1 - compression) * 0.45, compression, 1 + (1 - compression) * 0.45);
    }).then(() => {
      if (token !== this.animationToken || this.destroyed) return;
      piece.position.copy(targetLocal);
      piece.rotation.set(Math.PI / 2, 0, 0);
      piece.scale.setScalar(1);
      this.clearGroup(this.overlayGroup);
      this.completeAnimation(target);
      const settledGeometry = this.defaultPieceGeometry;
      this.renderer.domElement.dataset.lastSettledModelSource = 'procedural';
      this.renderer.domElement.dataset.lastSettledGeometry = settledGeometry.uuid;
    });
  }

  private completeAnimation(target: RenderState): void {
    this.animationActive = false;
    this.animation = null;
    this.boardGroup.rotation.z = 0;
    this.boardGroup.scale.setScalar(1);
    delete this.renderer.domElement.dataset.animation;
    delete this.renderer.domElement.dataset.animationProgress;
    this.clearGroup(this.overlayGroup);
    this.sync(target);
  }

  private runTween(duration: number, token: number, update: (progress: number) => void): Promise<void> {
    const started = performance.now();
    let stopped = false;
    return new Promise((resolve) => {
      const stop = () => {
        stopped = true;
        resolve();
      };
      this.animation = { token, stop };
      const schedule = (callback: (now: number) => void) => {
        let invoked = false;
        const invoke = (now: number) => {
          if (invoked) return;
          invoked = true;
          window.clearTimeout(fallback);
          callback(now);
        };
        const fallback = window.setTimeout(() => invoke(performance.now()), 48);
        window.requestAnimationFrame(invoke);
      };
      const step = (now: number) => {
        if (stopped || this.destroyed || token !== this.animationToken) {
          resolve();
          return;
        }
        const progress = Math.min(1, (now - started) / duration);
        update(progress);
        if (this.renderer.domElement.dataset.animation) {
          this.renderer.domElement.dataset.animationProgress = progress.toFixed(3);
        }
        if (progress >= 1) {
          resolve();
          return;
        }
        schedule(step);
      };
      schedule(step);
    });
  }

  private updateHover(state: RenderState): void {
    if (!this.hoverMesh) return;
    const canPreview = state.previewEnabled && !this.replayFrame && state.status === 'playing' && this.hoverColumn !== null;
    if (!canPreview || this.board.findDropRow(this.hoverColumn as number, state.gravity) === null) {
      this.hoverMesh.visible = false;
      return;
    }
    const dropRow = this.board.findDropRow(this.hoverColumn as number, state.gravity);
    if (dropRow === null) {
      this.hoverMesh.visible = false;
      return;
    }
    this.hoverMesh.visible = true;
    this.hoverMesh.position.copy(this.localPosition(dropRow, this.hoverColumn as number, 0));
  }

  private updateProjectedPickPoint(): void {
    if (this.pickTargets.length === 0) return;
    const state = this.getDisplayState();
    const row = Math.floor(state.rows / 2);
    const col = Math.floor(state.cols / 2);
    const target = this.pickTargets.find((candidate) => candidate.userData.row === row && candidate.userData.col === col);
    if (!target) return;
    const projected = target.getWorldPosition(new THREE.Vector3()).project(this.camera);
    this.renderer.domElement.dataset.pickX = ((projected.x + 1) / 2).toFixed(4);
    this.renderer.domElement.dataset.pickY = ((1 - projected.y) / 2).toFixed(4);
  }

  private buildTopology(state: RenderState): void {
    this.clearGroup(this.topologyGroup);
    if (!state.wrapHorizontal && !state.wrapVertical) return;
    const barDepth = 0.035;
    if (state.wrapHorizontal) {
      this.addRoundedBox('TopologyPortal_Horizontal_Left', 0.045, this.layout.height * 0.82, barDepth, -this.layout.halfWidth - 0.34, 0, 0.16, this.topologyMaterial, this.topologyGroup, 0.02);
      this.addRoundedBox('TopologyPortal_Horizontal_Right', 0.045, this.layout.height * 0.82, barDepth, this.layout.halfWidth + 0.34, 0, 0.16, this.topologyMaterial, this.topologyGroup, 0.02);
    }
    if (state.wrapVertical) {
      this.addRoundedBox('TopologyPortal_Vertical_Top', this.layout.width * 0.82, 0.045, barDepth, 0, this.layout.halfHeight + 0.34, 0.16, this.topologyMaterial, this.topologyGroup, 0.02);
      this.addRoundedBox('TopologyPortal_Vertical_Bottom', this.layout.width * 0.82, 0.045, barDepth, 0, -this.layout.halfHeight - 0.34, 0.16, this.topologyMaterial, this.topologyGroup, 0.02);
    }
  }

  private buildGravity(state: RenderState): void {
    this.clearGroup(this.gravityGroup);
    const pivot = new THREE.Group();
    pivot.name = 'GravityIndicator_Pivot';
    this.gravityGroup.add(pivot);
    this.gravityPivot = pivot;
    const edgeLength = Math.max(1.5, this.layout.width * 0.3);
    this.addRoundedBox('GravityEdge', edgeLength, 0.07, 0.045, 0, 0, 0.18, this.gravityMaterial, pivot, 0.03);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.21, 18), this.gravityMaterial);
    head.name = 'GravityChevron';
    head.position.set(0, 0, 0.2);
    pivot.add(head);
    this.updateGravityIndicator(state);
  }

  private updateGravityIndicator(state: RenderState): void {
    if (!this.gravityPivot) return;
    const atBottom = state.gravity === 'down';
    this.gravityPivot.position.set(0, atBottom ? -this.layout.halfHeight - 0.3 : this.layout.halfHeight + 0.3, 0);
    this.gravityPivot.rotation.z = atBottom ? Math.PI : 0;
  }

  private buildWinLine(state: RenderState): void {
    if (state.status !== 'won' || !state.winner || state.winLine.length === 0) return;
    const material = this.winMaterials[state.winner];
    const points = state.winLine.map((cell) => this.localPosition(cell.row, cell.col, 0.68));

    state.winLine.forEach((cell, index) => {
      const halo = new THREE.Mesh(this.winHaloGeometry, material);
      halo.name = `WinHalo_${cell.row}_${cell.col}`;
      halo.position.copy(points[index]);
      halo.renderOrder = 10;
      halo.userData.winHalo = true;
      this.winGroup.add(halo);
    });

    for (let index = 1; index < points.length; index += 1) {
      const previousCell = state.winLine[index - 1];
      const currentCell = state.winLine[index];
      const previousPoint = points[index - 1];
      const currentPoint = points[index];
      const colStep = wrapStep(currentCell.col - previousCell.col, state.cols, state.wrapHorizontal);
      const rowStep = wrapStep(currentCell.row - previousCell.row, state.rows, state.wrapVertical);
      const logicalDelta = new THREE.Vector3(colStep * CELL_SPACING, -rowStep * CELL_SPACING, 0);
      const actualDelta = currentPoint.clone().sub(previousPoint);

      if (actualDelta.distanceTo(logicalDelta) < 0.08) {
        this.addWinSegment(previousPoint, currentPoint, material);
        continue;
      }

      const direction = logicalDelta.normalize();
      const stubLength = CELL_SPACING * 0.86;
      this.addWinSegment(previousPoint, previousPoint.clone().addScaledVector(direction, stubLength), material);
      this.addWinSegment(currentPoint.clone().addScaledVector(direction, -stubLength), currentPoint, material);
    }
    this.renderer.domElement.dataset.winHighlights = String(state.winLine.length);
  }

  private addWinSegment(
    start: THREE.Vector3,
    end: THREE.Vector3,
    material: THREE.MeshStandardMaterial
  ): void {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0.001) return;
    const segment = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, length, 16), material);
    segment.name = 'WinLink';
    segment.position.copy(start).add(end).multiplyScalar(0.5);
    segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    segment.renderOrder = 9;
    this.winGroup.add(segment);
  }

  private localPosition(row: number, col: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(
      (col - (this.board.cols - 1) / 2) * CELL_SPACING,
      ((this.board.rows - 1) / 2 - row) * CELL_SPACING,
      z
    );
  }

  private addRoundedBox(
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    radius = 0.04
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, radius), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private resizeCamera(): void {
    const boardWidth = this.layout.width + 1.35;
    const boardHeight = this.layout.height + 1.35;
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const fitWidth = boardWidth / (2 * Math.tan(horizontalFov / 2));
    const fitHeight = boardHeight / (2 * Math.tan(verticalFov / 2));
    const distance = Math.max(fitWidth, fitHeight) * 1.6;
    const narrow = this.camera.aspect < 1.1;
    const azimuth = narrow ? 0.16 : 0.34;
    const elevation = narrow ? 0.2 : 0.27;
    const horizontalDistance = distance * Math.cos(elevation);
    const targetY = CENTER_Y - this.layout.height * 0.025;
    this.camera.position.set(
      horizontalDistance * Math.sin(azimuth),
      targetY + distance * Math.sin(elevation),
      horizontalDistance * Math.cos(azimuth)
    );
    this.controls.target.set(0, targetY, 0);
    this.controls.maxDistance = Math.max(22, distance * 1.4);
    this.controls.update();
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) group.remove(group.children[group.children.length - 1]);
  }
}

function cloneState(state: RenderState): RenderState {
  return {
    ...state,
    matrix: state.matrix.map((row) => [...row]),
    winLine: state.winLine.map((cell) => ({ ...cell }))
  };
}

function stateSignature(state: RenderState): string {
  return [
    state.rows,
    state.cols,
    state.currentPlayer,
    state.gravity,
    state.status,
    state.winner ?? 0,
    state.wrapHorizontal ? 1 : 0,
    state.wrapVertical ? 1 : 0,
    state.winLine.map((cell) => `${cell.row}:${cell.col}`).join(','),
    state.matrix.map((row) => row.join('')).join('/')
  ].join('|');
}

function createPieceGeometry(): THREE.LatheGeometry {
  return new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.105),
    new THREE.Vector2(0.32, -0.105),
    new THREE.Vector2(0.395, -0.072),
    new THREE.Vector2(0.43, -0.022),
    new THREE.Vector2(0.43, 0.025),
    new THREE.Vector2(0.39, 0.074),
    new THREE.Vector2(0.31, 0.105),
    new THREE.Vector2(0, 0.105)
  ], 40);
}

function easeOutSettle(value: number): number {
  const eased = 1 - Math.pow(1 - value, 4);
  const settle = Math.sin(value * Math.PI * 2.25) * Math.pow(1 - value, 2) * 0.028;
  return Math.min(1, eased + settle);
}

function wrapStep(delta: number, size: number, enabled: boolean): number {
  if (!enabled || size <= 0) return delta;
  if (delta > size / 2) return delta - size;
  if (delta < -size / 2) return delta + size;
  return delta;
}
