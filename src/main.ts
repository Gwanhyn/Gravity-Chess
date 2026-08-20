import {
  ArrowRight,
  BadgeCheck,
  Bot,
  ChevronDown,
  ChevronUp,
  Check,
  CircleDot,
  createIcons,
  Eye,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Settings,
  Undo2,
  Users,
  Wifi,
  X
} from 'lucide';
import { io, type Socket } from 'socket.io-client';
import './style.css';
import { Board } from './core/Board';
import { GameEngine } from './core/GameEngine';
import {
  DEFAULT_SETTINGS,
  type ActionMode,
  type GameSettings,
  type MoveKind,
  type MoveOutcome,
  type Player,
  type ReplayFrame
} from './core/types';
import type { ClientToServerEvents, OnlineRole, OnlineRoomState, ServerToClientEvents } from './network/types';
import { CanvasRenderer } from './render/CanvasRenderer';
import type { ThreeRenderer } from './render/ThreeRenderer';
import type { GameRenderer, RenderState } from './render/types';

const SETTINGS_STORAGE_KEY = 'gravity-chess:settings';
const RENDER_MODE_STORAGE_KEY = 'gravity-chess:render-mode:v2';

const engine = new GameEngine(loadStoredSettings());
let topologyPerspectivePreference = engine.settings.topologyPerspectiveEnabled;
let selectedMode: ActionMode = 'drop';
let inputLocked = false;
let aiPending = false;
let replaying = false;
let replayTimer: number | null = null;
let replayFrameIndex: number | null = null;
let lastTick = performance.now();
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let onlineRoom: OnlineRoomState | null = null;
let onlineModeSelected = false;
let pendingRemoteOutcome: MoveOutcome | null = null;
let settingsPreview: GameSettings | null = null;
let settingsPreviewBoard: Board | null = null;
let settingsDirty = false;

const canvas = query<HTMLCanvasElement>('#gameCanvas');
const app = query<HTMLElement>('#app');
const canvasShell = query<HTMLElement>('#canvasShell');
const threeViewport = query<HTMLElement>('#threeViewport');
const canvasModeBtn = query<HTMLButtonElement>('#canvasModeBtn');
const threeModeBtn = query<HTMLButtonElement>('#threeModeBtn');
const getRenderState = (): RenderState => {
  const settings = getVisualSettings();
  const visualBoard = settingsPreviewBoard ?? engine.board;
  return {
    matrix: visualBoard.cloneMatrix(),
    rows: visualBoard.rows,
    cols: visualBoard.cols,
    currentPlayer: engine.currentPlayer,
    gravity: engine.gravity,
    status: engine.status,
    winner: engine.winner,
    winLine: engine.winLine,
    actionMode: selectedMode,
    previewEnabled: !inputLocked && !replaying && !settingsDirty && canActLocally() && engine.status === 'playing',
    scoreSkew: engine.getScoreSkew(),
    topologyPerspectiveEnabled: settings.topologyPerspectiveEnabled,
    wrapHorizontal: settings.wrapHorizontal,
    wrapVertical: settings.wrapVertical
  };
};
let canvasRenderer: CanvasRenderer | null = null;
let threeRenderer: ThreeRenderer | null = null;
let threeRendererPromise: Promise<ThreeRenderer | null> | null = null;
let threeRendererUnavailable = false;
let renderer!: GameRenderer;
let renderMode: '2d' | '3d' = '3d';

const currentToken = query<HTMLElement>('#currentToken');
const statusText = query<HTMLElement>('#statusText');
const mobileStatus = query<HTMLElement>('#mobileStatus');
const redClock = query<HTMLElement>('#redClock');
const goldClock = query<HTMLElement>('#goldClock');
const turnClock = query<HTMLElement>('#turnClock');
const modeSummary = query<HTMLElement>('#modeSummary');
const moveCount = query<HTMLElement>('#moveCount');
const moveList = query<HTMLOListElement>('#moveList');
const moveLogSection = query<HTMLElement>('#moveLogSection');
const moveLogToggle = query<HTMLButtonElement>('#moveLogToggle');

const rowsInput = query<HTMLInputElement>('#rowsInput');
const colsInput = query<HTMLInputElement>('#colsInput');
const winInput = query<HTMLInputElement>('#winInput');
const turnTimerInput = query<HTMLInputElement>('#turnTimerInput');
const turnTimerConfig = query<HTMLElement>('#turnTimerConfig');
const turnSecondsInput = query<HTMLInputElement>('#turnSecondsInput');
const turnSecondsOutput = query<HTMLOutputElement>('#turnSecondsOutput');
const obstacleCountInput = query<HTMLInputElement>('#obstacleCountInput');
const obstacleConfig = query<HTMLElement>('#obstacleConfig');
const wrapHorizontalInput = query<HTMLInputElement>('#wrapHorizontalInput');
const wrapVerticalInput = query<HTMLInputElement>('#wrapVerticalInput');
const autoWinCheckInput = query<HTMLInputElement>('#autoWinCheckInput');
const topologyPerspectiveInput = query<HTMLInputElement>('#topologyPerspectiveInput');
const obstaclesInput = query<HTMLInputElement>('#obstaclesInput');
const bombsInput = query<HTMLInputElement>('#bombsInput');
const bombLimitConfig = query<HTMLElement>('#bombLimitConfig');
const bombLimitModeSelect = query<HTMLSelectElement>('#bombLimitModeSelect');
const bombLimitInput = query<HTMLInputElement>('#bombLimitInput');
const gravityFlipInput = query<HTMLInputElement>('#gravityFlipInput');
const gravityFlipLimitConfig = query<HTMLElement>('#gravityFlipLimitConfig');
const gravityFlipLimitModeSelect = query<HTMLSelectElement>('#gravityFlipLimitModeSelect');
const gravityFlipLimitInput = query<HTMLInputElement>('#gravityFlipLimitInput');
const modeSelect = query<HTMLSelectElement>('#modeSelect');
const redFirstBtn = query<HTMLButtonElement>('#redFirstBtn');
const goldFirstBtn = query<HTMLButtonElement>('#goldFirstBtn');
const difficultySelect = query<HTMLSelectElement>('#difficultySelect');
const totalTimerInput = query<HTMLInputElement>('#totalTimerInput');
const totalTimerConfig = query<HTMLElement>('#totalTimerConfig');
const totalMinutesInput = query<HTMLInputElement>('#totalMinutesInput');
const totalMinutesOutput = query<HTMLOutputElement>('#totalMinutesOutput');
const onlineRoleBadge = query<HTMLElement>('#onlineRoleBadge');
const onlineStatus = query<HTMLElement>('#onlineStatus');
const roomCodeInput = query<HTMLInputElement>('#roomCodeInput');
const hostRoomBtn = query<HTMLButtonElement>('#hostRoomBtn');
const joinRoomBtn = query<HTMLButtonElement>('#joinRoomBtn');
const leaveRoomBtn = query<HTMLButtonElement>('#leaveRoomBtn');
const shareUrl = query<HTMLElement>('#shareUrl');
const settingsDrawer = query<HTMLElement>('#settingsDrawer');
const settingsToggleBtn = query<HTMLButtonElement>('#settingsToggleBtn');
const settingsCloseBtn = query<HTMLButtonElement>('#settingsCloseBtn');
const matchMenuBtn = query<HTMLButtonElement>('#matchMenuBtn');
const matchMenu = query<HTMLElement>('#matchMenu');
const matchMenuCloseBtn = query<HTMLButtonElement>('#matchMenuCloseBtn');
const battleAiBtn = query<HTMLButtonElement>('#battleAiBtn');
const battleLocalBtn = query<HTMLButtonElement>('#battleLocalBtn');
const battleOnlineBtn = query<HTMLButtonElement>('#battleOnlineBtn');
const battleOnlinePanel = query<HTMLElement>('#battleOnlinePanel');
const battleOnlineStatus = query<HTMLElement>('#battleOnlineStatus');
const battleCurrentRoomCode = query<HTMLElement>('#battleCurrentRoomCode');
const battleHostBtn = query<HTMLButtonElement>('#battleHostBtn');
const battleJoinBtn = query<HTMLButtonElement>('#battleJoinBtn');
const battleLeaveBtn = query<HTMLButtonElement>('#battleLeaveBtn');
const battleRoomCodeInput = query<HTMLInputElement>('#battleRoomCodeInput');
const boardMenuBtn = query<HTMLButtonElement>('#boardMenuBtn');
const boardMenu = query<HTMLElement>('#boardMenu');
const boardMenuCloseBtn = query<HTMLButtonElement>('#boardMenuCloseBtn');
const boardPerspectiveBtn = query<HTMLButtonElement>('#boardPerspectiveBtn');
const topologyChoices = query<HTMLElement>('#topologyChoices');
const topologySummary = query<HTMLElement>('#topologySummary');
const visitCount = query<HTMLElement>('#visitCount');
const visitCountValue = query<HTMLElement>('#visitCountValue');
const undoRequestDialog = query<HTMLElement>('#undoRequestDialog');
const undoRequestTitle = query<HTMLElement>('#undoRequestTitle');
const undoRequestText = query<HTMLElement>('#undoRequestText');
const undoAcceptBtn = query<HTMLButtonElement>('#undoAcceptBtn');
const undoDeclineBtn = query<HTMLButtonElement>('#undoDeclineBtn');

const dropModeBtn = query<HTMLButtonElement>('#dropModeBtn');
const checkWinBtn = query<HTMLButtonElement>('#checkWinBtn');
const undoBtn = query<HTMLButtonElement>('#undoBtn');
const replayBtn = query<HTMLButtonElement>('#replayBtn');
const newGameBtn = query<HTMLButtonElement>('#newGameBtn');
const applySettingsBtn = query<HTMLButtonElement>('#applySettingsBtn');
const lucideIcons = {
  BadgeCheck,
  Check,
  CircleDot,
  Eye,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Settings,
  Undo2,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Users,
  Wifi,
  X
};

void bootstrap();

async function bootstrap(): Promise<void> {
  createIcons({ icons: lucideIcons });
  syncSettingsToForm(engine.settings);
  updateRuleConfigVisibility(engine.settings);
  wireEvents();
  await setRenderMode(loadStoredRenderMode());
  app.hidden = false;
  updateUI();
  requestAnimationFrame(tick);
  void recordPageVisit();
}

function wireEvents(): void {
  canvasModeBtn.addEventListener('click', () => void setRenderMode('2d'));
  threeModeBtn.addEventListener('click', () => void setRenderMode('3d'));
  for (const target of [canvas, threeViewport]) {
    target.addEventListener('pointermove', (event) => renderer.setHoverFromEvent(event));
    target.addEventListener('pointerleave', () => renderer.clearHover());
    target.addEventListener('click', async (event) => {
      if (inputLocked || replaying || settingsDirty || !canActLocally() || engine.status !== 'playing') return;
      const col = renderer.getColumnFromEvent(event);
      if (col === null) return;
      await performColumnAction(col);
    });
  }

  dropModeBtn.addEventListener('click', () => {
    selectedMode = 'drop';
    updateUI();
  });

  checkWinBtn.addEventListener('click', async () => {
    if (inputLocked || replaying || !canActLocally()) return;
    await performManualCheck();
  });

  undoBtn.addEventListener('click', async () => {
    if (inputLocked || replaying) return;
    if (isOnline()) {
      emitOnlineAction({ kind: 'undo-request' });
      return;
    }
    const before = getRenderState();
    if (engine.undo()) {
      const after = getRenderState();
      selectedMode = 'drop';
      setRendererReplayFrame(null);
      setRendererBoard(engine.board);
      inputLocked = true;
      updateUI();
      await renderer.animateMove({ ok: true, kind: 'undo' }, before, after);
      inputLocked = false;
      updateUI();
      maybeScheduleAi();
    }
  });

  replayBtn.addEventListener('click', () => {
    if (replaying) {
      stopReplay();
      return;
    }
    if (inputLocked) return;
    startReplay();
  });
  moveLogToggle.addEventListener('click', () => {
    const collapsed = moveLogSection.classList.toggle('collapsed');
    moveLogToggle.setAttribute('aria-expanded', String(!collapsed));
  });
  moveList.addEventListener('click', (event) => {
    if (settingsDirty || (inputLocked && !replaying)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>('[data-move-id]');
    if (!button) return;
    jumpToMove(Number(button.dataset.moveId));
  });

  newGameBtn.addEventListener('click', () => resetGame(readSettings()));
  applySettingsBtn.addEventListener('click', () => resetGame(readSettings()));
  redFirstBtn.addEventListener('click', () => {
    setStartingPlayerChoice(1);
    updateSettingsPreview();
  });
  goldFirstBtn.addEventListener('click', () => {
    setStartingPlayerChoice(2);
    updateSettingsPreview();
  });
  hostRoomBtn.addEventListener('click', () => createOnlineRoom());
  joinRoomBtn.addEventListener('click', () => joinOnlineRoom());
  leaveRoomBtn.addEventListener('click', () => leaveOnlineRoom());
  matchMenuBtn.addEventListener('click', () => setMatchMenu(matchMenu.hidden));
  matchMenuCloseBtn.addEventListener('click', () => setMatchMenu(false));
  battleAiBtn.addEventListener('click', () => startMatch('ai'));
  battleLocalBtn.addEventListener('click', () => startMatch('local'));
  battleOnlineBtn.addEventListener('click', () => {
    enterOnlineMode();
  });
  battleHostBtn.addEventListener('click', () => {
    createOnlineRoom();
  });
  battleJoinBtn.addEventListener('click', () => {
    roomCodeInput.value = battleRoomCodeInput.value.trim().toUpperCase();
    joinOnlineRoom();
  });
  battleLeaveBtn.addEventListener('click', () => leaveOnlineRoom());
  boardMenuBtn.addEventListener('click', () => setBoardMenu(boardMenu.hidden));
  boardMenuCloseBtn.addEventListener('click', () => setBoardMenu(false));
  boardMenu.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const choice = target.closest<HTMLButtonElement>('[data-header-topology]');
    if (!choice) return;
    setTopology(choice.dataset.headerTopology ?? 'standard', true);
  });
  boardPerspectiveBtn.addEventListener('click', () => {
    topologyPerspectiveInput.checked = !topologyPerspectiveInput.checked;
    applyPerspectivePreference();
  });
  settingsToggleBtn.addEventListener('click', () => {
    const isOpen = settingsDrawer.classList.contains('open');
    setSettingsDrawer(!(isOpen && !settingsDirty));
  });
  settingsCloseBtn.addEventListener('click', () => setSettingsDrawer(false));
  undoAcceptBtn.addEventListener('click', () => emitOnlineAction({ kind: 'undo-accept' }));
  undoDeclineBtn.addEventListener('click', () => emitOnlineAction({ kind: 'undo-decline' }));

  turnSecondsInput.addEventListener('input', () => {
    turnSecondsOutput.value = turnSecondsInput.value;
    updateSettingsPreview();
  });
  totalMinutesInput.addEventListener('input', () => {
    totalMinutesOutput.value = totalMinutesInput.value;
    updateSettingsPreview();
  });

  modeSelect.addEventListener('change', () => {
    difficultySelect.disabled = modeSelect.value !== 'ai';
    updateSettingsPreview();
  });

  topologyChoices.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const choice = target.closest<HTMLButtonElement>('[data-topology]');
    if (!choice) return;
    setTopology(choice.dataset.topology ?? 'standard');
  });

  const settingControls: Array<HTMLInputElement | HTMLSelectElement> = [
    rowsInput,
    colsInput,
    winInput,
    turnTimerInput,
    obstacleCountInput,
    wrapHorizontalInput,
    wrapVerticalInput,
    autoWinCheckInput,
    topologyPerspectiveInput,
    obstaclesInput,
    bombsInput,
    bombLimitModeSelect,
    bombLimitInput,
    gravityFlipInput,
    gravityFlipLimitModeSelect,
    gravityFlipLimitInput,
    difficultySelect,
    totalTimerInput
  ];

  for (const control of settingControls) {
    control.addEventListener('input', updateSettingsPreview);
    control.addEventListener('change', updateSettingsPreview);
  }

  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!matchMenu.hidden && !matchMenu.contains(target) && !matchMenuBtn.contains(target)) {
      setMatchMenu(false);
    }
    if (!boardMenu.hidden && !boardMenu.contains(target) && !boardMenuBtn.contains(target)) {
      setBoardMenu(false);
    }
    if (settingsDrawer.classList.contains('open') && !settingsDirty) {
      if (settingsDrawer.contains(target) || settingsToggleBtn.contains(target)) return;
      setSettingsDrawer(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMatchMenu(false);
      setBoardMenu(false);
      if (!settingsDirty) setSettingsDrawer(false);
    }
  });
}

async function performColumnAction(col: number): Promise<void> {
  if (renderMode === '3d' && selectedMode !== 'drop') {
    selectedMode = 'drop';
  }
  if (isOnline()) {
    emitOnlineAction({ kind: 'drop', col, mode: selectedMode });
    return;
  }

  const before = getRenderState();
  const outcome = engine.playColumn(col, selectedMode);
  if (!outcome.ok) {
    selectedMode = 'drop';
    updateUI(outcome.message);
    return;
  }

  await playOutcome(outcome, before, getRenderState());
}

async function performManualCheck(): Promise<void> {
  if (isOnline()) {
    emitOnlineAction({ kind: 'check' });
    return;
  }

  const before = getRenderState();
  const outcome = engine.checkWinManually();
  if (!outcome.ok) {
    updateUI(outcome.message);
    return;
  }

  await playOutcome(outcome, before, getRenderState());
}

async function playOutcome(outcome: MoveOutcome, before?: RenderState, after?: RenderState): Promise<void> {
  inputLocked = true;
  setRendererReplayFrame(null);
  updateUI();
  await renderer.animateMove(outcome, before, after ?? getRenderState());
  inputLocked = false;

  updateUI();
  maybeScheduleAi();
}

function maybeScheduleAi(): void {
  if (isOnline() || !isAiTurn() || inputLocked || replaying || aiPending || engine.status !== 'playing') return;

  aiPending = true;
  window.setTimeout(async () => {
    const col = engine.getAiColumn();
    aiPending = false;
    if (col === null || engine.status !== 'playing') {
      updateUI();
      return;
    }

    selectedMode = 'drop';
    const before = getRenderState();
    const outcome = engine.playColumn(col, 'drop');
    await playOutcome(outcome, before, getRenderState());
  }, 460);
}

function startReplay(): void {
  if (engine.replayFrames.length === 0) return;
  if (replayTimer !== null) {
    window.clearTimeout(replayTimer);
  }

  replaying = true;
  inputLocked = true;
  let index = 0;

  const showFrame = () => {
    showReplayFrame(index);
    index += 1;

    if (index < engine.replayFrames.length) {
      replayTimer = window.setTimeout(showFrame, 620);
      return;
    }

    replayTimer = window.setTimeout(() => {
      stopReplay();
    }, 820);
  };

  showFrame();
}

function stopReplay(): void {
  if (replayTimer !== null) {
    window.clearTimeout(replayTimer);
    replayTimer = null;
  }
  replaying = false;
  inputLocked = false;
  replayFrameIndex = null;
  setRendererReplayFrame(null);
  updateUI();
  maybeScheduleAi();
}

function jumpToMove(moveId: number): void {
  if (!Number.isFinite(moveId) || engine.replayFrames.length === 0) return;
  const logIndex = engine.logEntries.findIndex((entry) => entry.id === moveId);
  if (logIndex < 0) return;

  if (replayTimer !== null) {
    window.clearTimeout(replayTimer);
    replayTimer = null;
  }
  replaying = true;
  inputLocked = true;
  showReplayFrame(Math.min(logIndex, engine.replayFrames.length - 1));
}

function showReplayFrame(index: number): void {
  const frameIndex = clampInt(index, 0, engine.replayFrames.length - 1);
  const frame = engine.replayFrames[frameIndex];
  replayFrameIndex = frameIndex;
  setRendererReplayFrame(frame);
  updateUI(undefined, frame);
}

function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (socket) return socket;

  socket = io();
  socket.on('room:state', async (payload) => {
    const before = getRenderState();
    onlineModeSelected = true;
    onlineRoom = payload;
    pendingRemoteOutcome = payload.outcome ?? null;
    engine.importState(payload.state);
    // Keep legacy experimental flags inert for normal matches, including reconnects.
    engine.settings.obstaclesEnabled = false;
    engine.settings.bombsEnabled = false;
    engine.settings.gravityFlipEnabled = false;
    engine.settings.topologyPerspectiveEnabled = topologyPerspectivePreference;
    saveStoredSettings(engine.settings);
    replayFrameIndex = null;
    setRendererReplayFrame(null);
    setRendererBoard(engine.board);
    syncSettingsToForm(engine.settings);
    settingsPreview = null;
    settingsPreviewBoard = null;
    settingsDirty = false;
    updateRuleConfigVisibility(engine.settings);
    const after = getRenderState();

    const outcome = pendingRemoteOutcome;
    pendingRemoteOutcome = null;
    if (outcome?.ok && outcome.kind && outcome.kind !== 'check') {
      inputLocked = true;
      updateUI(payload.message);
      await renderer.animateMove(outcome, before, after);
      inputLocked = false;
    } else {
      inputLocked = false;
    }

    updateUI(payload.message);
  });

  socket.on('room:error', (payload) => {
    inputLocked = false;
    onlineRoom = null;
    updateUI(onlineModeSelected ? '未加入房间' : payload.message);
  });

  socket.on('disconnect', () => {
    onlineRoom = null;
    updateUI(onlineModeSelected ? '未加入房间' : '联机已断开');
  });

  return socket;
}

function createOnlineRoom(): void {
  onlineModeSelected = true;
  onlineRoom = null;
  modeSelect.value = 'local';
  difficultySelect.disabled = true;
  updateUI();
  getSocket().emit('room:create', readSettings());
}

function joinOnlineRoom(): void {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    updateUI('请输入房间码');
    return;
  }
  onlineModeSelected = true;
  onlineRoom = null;
  modeSelect.value = 'local';
  difficultySelect.disabled = true;
  updateUI();
  getSocket().emit('room:join', code);
}

function leaveOnlineRoom(): void {
  if (socket && onlineRoom) socket.emit('room:leave');
  onlineRoom = null;
  onlineModeSelected = false;
  battleOnlinePanel.hidden = true;
  modeSelect.value = 'local';
  engine.settings.matchMode = 'local';
  difficultySelect.disabled = true;
  saveStoredSettings(engine.settings);
  syncSettingsToForm(engine.settings);
  updateUI('已离开房间');
}

function setMatchMenu(open: boolean): void {
  matchMenu.hidden = !open;
  matchMenuBtn.setAttribute('aria-expanded', String(open));
  if (open) battleOnlinePanel.hidden = !onlineModeSelected;
}

function setBoardMenu(open: boolean): void {
  boardMenu.hidden = !open;
  boardMenuBtn.setAttribute('aria-expanded', String(open));
}

async function setRenderMode(mode: '2d' | '3d'): Promise<void> {
  if (mode === '3d') {
    const restriction = getThreeModeRestriction(getVisualSettings());
    if (restriction) {
      if (renderMode !== '2d' || !renderer) {
        ensureCanvasRenderer();
        activateRenderMode('2d');
        updateUI();
      }
      return;
    }
    if (threeRendererUnavailable) {
      if (renderMode !== '2d' || !renderer) {
        ensureCanvasRenderer();
        activateRenderMode('2d');
        updateUI();
      }
      return;
    }
    if (!(await ensureThreeRenderer())) {
      activateRenderMode('2d');
      updateUI();
      return;
    }
    const currentRestriction = getThreeModeRestriction(getVisualSettings());
    if (currentRestriction) {
      activateRenderMode('2d');
      updateUI();
      return;
    }
  }

  activateRenderMode(mode);
  updateThreeModeAvailability(getVisualSettings());
  updateUI();
}

function activateRenderMode(mode: '2d' | '3d'): void {
  renderMode = mode;
  if (mode === '3d') selectedMode = 'drop';
  saveStoredRenderMode(mode);
  document.documentElement.dataset.renderMode = mode;
  renderer = mode === '3d' ? (threeRenderer as GameRenderer) : ensureCanvasRenderer();
  canvasShell.dataset.renderMode = mode;
  canvasModeBtn.classList.toggle('active', mode === '2d');
  threeModeBtn.classList.toggle('active', mode === '3d');
  canvasModeBtn.setAttribute('aria-pressed', String(mode === '2d'));
  threeModeBtn.setAttribute('aria-pressed', String(mode === '3d'));
  canvas.hidden = mode === '3d';
  threeViewport.hidden = mode !== '3d';
  setRendererBoard(settingsPreviewBoard ?? engine.board);
  setRendererReplayFrame(replayFrameIndex === null ? null : engine.replayFrames[replayFrameIndex] ?? null);
  renderer.sync(getRenderState());
}

function getThreeModeRestriction(settings: GameSettings): string | null {
  if (settings.obstaclesEnabled) return '障碍规则开启时';
  if (settings.bombsEnabled) return '炸弹规则开启时';
  if (settings.gravityFlipEnabled) return '重力反转开启时';
  if (settings.topologyPerspectiveEnabled && (settings.wrapHorizontal || settings.wrapVertical)) {
    return '拓扑透视开启时';
  }
  return null;
}

function ensureCanvasRenderer(): CanvasRenderer {
  if (!canvasRenderer) {
    canvasRenderer = new CanvasRenderer(canvas, canvasShell, engine.board, getRenderState);
  }
  return canvasRenderer;
}

function updateThreeModeAvailability(settings: GameSettings): void {
  const restriction = getThreeModeRestriction(settings);
  threeModeBtn.disabled = Boolean(threeRendererPromise) || Boolean(restriction) || threeRendererUnavailable;
  threeModeBtn.title = threeRendererUnavailable
    ? '3D 视图暂不可用，请使用 2D'
    : restriction
    ? `当前规则需要 2D：${restriction}`
    : '切换到 3D 棋盘';
  threeModeBtn.setAttribute('aria-label', threeModeBtn.title);
}

function updateThreeControlAvailability(settings: GameSettings): void {
  const threeActive = renderMode === '3d';
  const restricted = getThreeModeRestriction(settings);
  const topologyRestricted = threeActive && Boolean(settings.topologyPerspectiveEnabled) &&
    (settings.wrapHorizontal || settings.wrapVertical);
  const controls: Array<[HTMLInputElement | HTMLSelectElement, string]> = [
    [obstaclesInput, '障碍规则需要切换到 2D'],
    [obstacleCountInput, '障碍规则需要切换到 2D'],
    [bombsInput, '炸弹规则需要切换到 2D'],
    [bombLimitModeSelect, '炸弹规则需要切换到 2D'],
    [bombLimitInput, '炸弹规则需要切换到 2D'],
    [gravityFlipInput, '重力反转需要切换到 2D'],
    [gravityFlipLimitModeSelect, '重力反转需要切换到 2D'],
    [gravityFlipLimitInput, '重力反转需要切换到 2D']
  ];
  for (const [control, title] of controls) {
    control.disabled = threeActive;
    if (threeActive) control.title = title;
    else if (control.title === title) control.title = '';
  }
  topologyPerspectiveInput.disabled = topologyRestricted;
  boardPerspectiveBtn.disabled = topologyRestricted;
  if (topologyRestricted) {
    topologyPerspectiveInput.title = '拓扑透视需要切换到 2D';
    boardPerspectiveBtn.title = '拓扑透视需要切换到 2D';
  } else {
    topologyPerspectiveInput.title = '';
    boardPerspectiveBtn.title = '透视展示';
  }
  if (!threeActive) {
    bombLimitInput.disabled = bombLimitModeSelect.value === 'unlimited';
    gravityFlipLimitInput.disabled = gravityFlipLimitModeSelect.value === 'unlimited';
  }
  applySettingsBtn.dataset.threeRestriction = restricted ?? '';
}

async function ensureThreeRenderer(): Promise<ThreeRenderer | null> {
  if (threeRendererPromise) return threeRendererPromise;
  if (threeRenderer) {
    await threeRenderer.ready;
    return threeRenderer;
  }

  threeModeBtn.disabled = true;
  threeRendererPromise = import('./render/ThreeRenderer')
    .then(async ({ ThreeRenderer: Renderer3D }) => {
      threeRendererUnavailable = false;
      threeRenderer = new Renderer3D(threeViewport, settingsPreviewBoard ?? engine.board, getRenderState);
      await threeRenderer.ready;
      threeRenderer.sync(getRenderState());
      return threeRenderer;
    })
    .catch((error) => {
      console.warn('Three.js renderer unavailable; continuing with Canvas.', error);
      threeRendererUnavailable = true;
      return null;
    })
    .finally(() => {
      threeRendererPromise = null;
      updateThreeModeAvailability(getVisualSettings());
    });
  return threeRendererPromise;
}

function setRendererBoard(board: Board): void {
  canvasRenderer?.setBoard(board);
  threeRenderer?.setBoard(board);
}

function setRendererReplayFrame(frame: ReplayFrame | null): void {
  canvasRenderer?.setReplayFrame(frame);
  threeRenderer?.setReplayFrame(frame);
}

function startMatch(mode: 'ai' | 'local'): void {
  if (isOnline() || onlineModeSelected) leaveOnlineRoom();
  onlineModeSelected = false;
  modeSelect.value = mode;
  difficultySelect.disabled = mode !== 'ai';
  setMatchMenu(false);
  resetGame(readSettings());
}

function enterOnlineMode(): void {
  onlineModeSelected = true;
  battleOnlinePanel.hidden = false;
  modeSelect.value = 'local';
  difficultySelect.disabled = true;
  engine.settings.matchMode = 'local';
  saveStoredSettings(engine.settings);
  syncSettingsToForm(engine.settings);
  updateUI();
  if (!onlineRoom) createOnlineRoom();
}

function setSettingsDrawer(open: boolean): void {
  settingsDrawer.classList.toggle('open', open);
  settingsDrawer.setAttribute('aria-hidden', String(!open));
  settingsToggleBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    updateSettingsPreview();
    return;
  }

  settingsPreview = null;
  settingsDirty = false;
  settingsPreviewBoard = null;
  setRendererBoard(engine.board);
  syncSettingsToForm(engine.settings);
  updateRuleConfigVisibility(engine.settings);
  updateUI();
}

function emitOnlineAction(action: Parameters<ClientToServerEvents['game:action']>[0]): void {
  if (!socket || !onlineRoom) {
    updateUI('尚未加入房间');
    return;
  }
  inputLocked = true;
  updateUI();
  socket.emit('game:action', action);
}

function resetGame(settings: GameSettings): void {
  topologyPerspectivePreference = settings.topologyPerspectiveEnabled;
  if (isOnline()) {
    if (onlineRoom?.isHost) {
      saveStoredSettings(settings);
      emitOnlineAction({ kind: 'reset', settings });
    } else {
      updateUI('只有房主可以重开或应用设置');
    }
    return;
  }

  if (replayTimer !== null) {
    window.clearTimeout(replayTimer);
    replayTimer = null;
  }
  replaying = false;
  replayFrameIndex = null;
  inputLocked = false;
  aiPending = false;
  selectedMode = 'drop';
  engine.reset(settings);
  saveStoredSettings(engine.settings);
  setRendererReplayFrame(null);
  setRendererBoard(engine.board);
  syncSettingsToForm(engine.settings);
  settingsPreview = null;
  settingsPreviewBoard = null;
  settingsDirty = false;
  updateRuleConfigVisibility(engine.settings);
  updateUI();
  maybeScheduleAi();
}

function tick(now: number): void {
  const delta = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;

  if (!replaying && !isOnline()) {
    const changed = engine.tick(delta);
    if (changed) {
      updateUI();
      maybeScheduleAi();
    }
  }

  requestAnimationFrame(tick);
}

function updateUI(message?: string, replayFrame?: ReplayFrame): void {
  const currentPlayer = replayFrame?.currentPlayer ?? engine.currentPlayer;
  const status = replayFrame?.status ?? engine.status;
  const winner = replayFrame?.winner ?? engine.winner;
  const visualSettings = getVisualSettings();
  const visualBoard = settingsPreviewBoard ?? engine.board;
  updateThreeModeAvailability(visualSettings);
  updateThreeControlAvailability(visualSettings);

  document.documentElement.style.setProperty('--board-aspect', `${visualBoard.cols} / ${visualBoard.rows}`);
  currentToken.className = `player-token ${currentPlayer === 1 ? 'blue' : 'yellow'}`;

  if (onlineModeSelected && !onlineRoom) {
    statusText.textContent = '未加入房间';
  } else if (message) {
    statusText.textContent = message;
  } else if (replaying && replayFrame) {
    statusText.textContent = `复盘：${replayFrame.label}`;
  } else if (status === 'won' && winner) {
    statusText.textContent = `${engine.getPlayerName(winner)}获胜`;
  } else if (status === 'draw') {
    statusText.textContent = '平局';
  } else if (aiPending) {
    statusText.textContent = 'AI 思考中';
  } else {
    statusText.textContent = `${engine.getPlayerName(currentPlayer)}行动`;
  }
  mobileStatus.textContent = statusText.textContent;

  redClock.textContent = visualSettings.totalTimerEnabled ? formatTime(engine.totalRemaining[1]) : '--:--';
  goldClock.textContent = visualSettings.totalTimerEnabled ? formatTime(engine.totalRemaining[2]) : '--:--';
  turnClock.textContent = visualSettings.turnTimerEnabled ? `${Math.ceil(engine.turnRemaining)}s` : '--';

  dropModeBtn.classList.toggle('active', selectedMode === 'drop');
  const checkLabel = checkWinBtn.querySelector('span');
  if (checkLabel) {
    checkLabel.textContent = '查胜';
  }
  checkWinBtn.title = `检查${engine.getPlayerName(currentPlayer)}是否获胜`;
  const hasPendingUndo = Boolean(onlineRoom?.pendingUndoRequest);
  checkWinBtn.disabled =
    engine.settings.autoWinCheckEnabled ||
    settingsDirty ||
    inputLocked ||
    replaying ||
    hasPendingUndo ||
    !canActLocally() ||
    status !== 'playing';
  undoBtn.disabled = inputLocked || replaying || hasPendingUndo || !canRequestUndo();
  replayBtn.disabled = (!replaying && (inputLocked || settingsDirty)) || engine.replayFrames.length <= 1;
  replayBtn.title = replaying ? '停止复盘' : '复盘';
  replayBtn.innerHTML = `<i data-lucide="${replaying ? 'x' : 'play'}"></i>`;
  dropModeBtn.disabled =
    settingsDirty || inputLocked || replaying || hasPendingUndo || !canActLocally() || status !== 'playing';
  checkWinBtn.title = `检查${engine.getPlayerName(currentPlayer)}是否获胜`;
  applySettingsBtn.disabled =
    (isOnline() && !onlineRoom?.isHost) ||
    !settingsDirty ||
    (renderMode === '3d' && Boolean(getThreeModeRestriction(visualSettings)));
  applySettingsBtn.title = renderMode === '3d' && getThreeModeRestriction(visualSettings)
    ? '当前设置需要 2D：请先切换到 2D'
    : '应用设置';
  newGameBtn.disabled = isOnline() && !onlineRoom?.isHost;
  redFirstBtn.disabled = isOnline() && !onlineRoom?.isHost;
  goldFirstBtn.disabled = isOnline() && !onlineRoom?.isHost;
  updateOnlineUI();
  updateUndoRequestUI();
  updateMatchMenuChoice();

  renderSummary();
  renderMoves();

  renderer.sync(getRenderState());
  createIcons({ icons: lucideIcons });
}

function updateMatchMenuChoice(): void {
  const mode = getVisualSettings().matchMode;
  battleAiBtn.classList.toggle('active', !onlineModeSelected && mode === 'ai');
  battleLocalBtn.classList.toggle('active', !onlineModeSelected && mode === 'local');
  battleOnlineBtn.classList.toggle('active', onlineModeSelected);
  battleAiBtn.setAttribute('aria-pressed', String(!onlineModeSelected && mode === 'ai'));
  battleLocalBtn.setAttribute('aria-pressed', String(!onlineModeSelected && mode === 'local'));
  battleOnlineBtn.setAttribute('aria-pressed', String(onlineModeSelected));
}

function renderSummary(): void {
  const visualSettings = getVisualSettings();
  const visualBoard = settingsPreviewBoard ?? engine.board;
  const matchLabel = onlineModeSelected
    ? onlineRoom ? '联机模式' : '联机模式 · 未加入房间'
    : visualSettings.matchMode === 'ai' ? `AI ${difficultyLabel(visualSettings.aiDifficulty)}` : '本地双人';
  const badges = [
    matchLabel,
    `${engine.getPlayerName(visualSettings.startingPlayer)}先手`,
    `${visualBoard.rows}x${visualBoard.cols}`,
    `${visualSettings.winLength} 连珠`,
    visualSettings.autoWinCheckEnabled ? '自动查胜' : '手动查胜'
  ];
  if (visualSettings.topologyPerspectiveEnabled) badges.push('拓扑透视');
  if (visualSettings.wrapHorizontal) badges.push('左右联通');
  if (visualSettings.wrapVertical) badges.push('上下联通');
  if (visualSettings.obstaclesEnabled) badges.push(`障碍 ${visualSettings.obstacleCount}`);
  if (visualSettings.bombsEnabled) {
    const uses = settingsDirty
      ? formatRuleLimit(visualSettings.bombLimit)
      : `${formatRuleUses(engine.bombsLeft[1])}/${formatRuleUses(engine.bombsLeft[2])}`;
    badges.push(`炸弹 ${uses}`);
  }
  if (visualSettings.gravityFlipEnabled) {
    const uses = settingsDirty
      ? formatRuleLimit(visualSettings.gravityFlipLimit)
      : `${formatRuleUses(engine.flipsLeft[1])}/${formatRuleUses(engine.flipsLeft[2])}`;
    badges.push(`反转 ${uses}`);
  }
  if (onlineRoom) badges.push(`房间 ${onlineRoom.roomCode}`);
  modeSummary.innerHTML = badges.map((badge) => `<span>${badge}</span>`).join('');
}

function renderMoves(): void {
  moveCount.textContent = String(engine.logEntries.length);
  const recent = engine.logEntries.slice().reverse();
  moveList.innerHTML = recent
    .map((entry) => {
      const marker = entry.player === 1 ? 'blue-dot' : entry.player === 2 ? 'yellow-dot' : 'neutral-dot';
      const frameIndex = engine.logEntries.findIndex((candidate) => candidate.id === entry.id);
      const active = replayFrameIndex === frameIndex;
      return `<li><button class="move-entry${active ? ' active' : ''}" type="button" data-move-id="${entry.id}"><span class="${marker}"></span><strong>${logKindLabel(entry.kind)}</strong><span>${entry.label}</span></button></li>`;
    })
    .join('');
}

function logKindLabel(kind: MoveKind): string {
  const labels: Record<MoveKind, string> = {
    drop: 'drop',
    bomb: 'bomb',
    flip: 'flip',
    check: 'check',
    undo: 'undo',
    'undo-request': 'ask',
    'undo-accept': 'ok',
    'undo-decline': 'no',
    reset: 'init',
    timeout: 'time'
  };
  return labels[kind];
}

function updateOnlineUI(): void {
  if (!onlineRoom) {
    onlineRoleBadge.textContent = onlineModeSelected ? '未入房' : socket?.connected ? '未入房' : '离线';
    onlineStatus.textContent = onlineModeSelected ? '联机模式 · 未加入房间' : '本地模式';
    battleOnlineStatus.textContent = onlineModeSelected ? '未加入房间' : '尚未选择联机';
    battleCurrentRoomCode.textContent = '----';
    shareUrl.textContent = '';
    roomCodeInput.disabled = false;
    hostRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    leaveRoomBtn.disabled = !onlineModeSelected;
    battleHostBtn.disabled = false;
    battleJoinBtn.disabled = false;
    battleLeaveBtn.disabled = !onlineModeSelected;
    return;
  }

  const roleLabel = roleToLabel(onlineRoom.role);
  battleOnlineStatus.textContent = onlineRoom.isHost ? `${roleLabel} · 房主` : roleLabel;
  battleCurrentRoomCode.textContent = onlineRoom.roomCode;
  onlineRoleBadge.textContent = onlineRoom.isHost ? `${roleLabel} · 房主` : roleLabel;
  onlineStatus.textContent = `房间 ${onlineRoom.roomCode} | ${engine.getPlayerName(engine.settings.startingPlayer)}先手 | 蓝方 ${
    onlineRoom.players.red ? '在线' : '空位'
  } | 黄方 ${
    onlineRoom.players.gold ? '在线' : '空位'
  } | 观战 ${onlineRoom.players.spectators}`;
  if (onlineRoom.pendingUndoRequest?.requester === onlineRoom.role) {
    onlineStatus.textContent = `${onlineStatus.textContent} | 等待对方回应悔棋`;
  }
  roomCodeInput.value = onlineRoom.roomCode;
  roomCodeInput.disabled = true;
  hostRoomBtn.disabled = true;
  joinRoomBtn.disabled = true;
  leaveRoomBtn.disabled = false;
  battleHostBtn.disabled = false;
  battleJoinBtn.disabled = false;
  battleLeaveBtn.disabled = false;
  battleRoomCodeInput.value = onlineRoom.roomCode;
  shareUrl.textContent = `分享：${window.location.origin}/  房间码：${onlineRoom.roomCode}`;
}

function updateUndoRequestUI(): void {
  const request = onlineRoom?.pendingUndoRequest;
  const shouldRespond = Boolean(request && onlineRoom?.role === otherPlayerLocal(request.requester));
  undoRequestDialog.classList.toggle('hidden', !shouldRespond);

  if (!request || !shouldRespond) return;
  undoRequestTitle.textContent = `${roleToLabel(request.requester)}请求悔棋`;
  undoRequestText.textContent = '同意后棋局会回退上一步，双方棋盘同步更新。';
  undoAcceptBtn.disabled = inputLocked;
  undoDeclineBtn.disabled = inputLocked;
}

function isOnline(): boolean {
  return onlineRoom !== null;
}

function canActLocally(): boolean {
  if (!isOnline()) {
    return !isAiTurn();
  }
  return onlineRoom?.role === engine.currentPlayer;
}

function canRequestUndo(): boolean {
  if (!isOnline()) {
    return engine.history.length > 0;
  }
  return (onlineRoom?.role === 1 || onlineRoom?.role === 2) && engine.moves.length > 0;
}

function roleToLabel(role: OnlineRole): string {
  if (role === 1) return '蓝方';
  if (role === 2) return '黄方';
  return '观战';
}

function otherPlayerLocal(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function getVisualSettings(): GameSettings {
  return settingsPreview ?? engine.settings;
}

function updateSettingsPreview(): void {
  const formSettings = normalizeFormSettings(readSettings());
  const drawerOpen = settingsDrawer.classList.contains('open');

  settingsDirty = !settingsMatch(formSettings, engine.settings);
  settingsPreview = drawerOpen ? formSettings : null;
  updateTopologyUI(formSettings);
  updateRuleConfigVisibility(formSettings);
  updatePreviewBoard(formSettings, drawerOpen && settingsDirty);
  updateUI();
}

function setTopology(topology: string, applyImmediately = false): void {
  const isHorizontal = topology === 'horizontal' || topology === 'toroidal';
  const isVertical = topology === 'vertical' || topology === 'toroidal';
  const currentTopology = getTopologyKey(readSettings());
  const shouldEnablePerspective = currentTopology === 'standard' && topology !== 'standard';

  wrapHorizontalInput.checked = isHorizontal;
  wrapVerticalInput.checked = isVertical;
  if (shouldEnablePerspective) topologyPerspectiveInput.checked = true;

  updateTopologyUI(readSettings());
  if (applyImmediately) {
    if (shouldEnablePerspective) applyPerspectivePreference();
    applyTopologyPreference(isHorizontal, isVertical);
  } else {
    updateSettingsPreview();
  }
}

function applyTopologyPreference(wrapHorizontal: boolean, wrapVertical: boolean): void {
  if (isOnline()) {
    if (!onlineRoom?.isHost) {
      syncSettingsToForm(engine.settings);
      updateUI('只有房主可以切换棋盘');
      return;
    }
    emitOnlineAction({ kind: 'topology', wrapHorizontal, wrapVertical });
    return;
  }

  engine.setTopology(wrapHorizontal, wrapVertical);
  saveStoredSettings(engine.settings);
  syncSettingsToForm(engine.settings);
  updateUI();
}

function applyPerspectivePreference(): void {
  topologyPerspectivePreference = topologyPerspectiveInput.checked;
  engine.settings.topologyPerspectiveEnabled = topologyPerspectivePreference;
  saveStoredSettings(engine.settings);
  if (settingsDrawer.classList.contains('open')) {
    updateSettingsPreview();
    return;
  }
  syncSettingsToForm(engine.settings);
  updateUI();
}

function updateTopologyUI(
  settings: Pick<GameSettings, 'wrapHorizontal' | 'wrapVertical'> & Partial<Pick<GameSettings, 'topologyPerspectiveEnabled'>>
): void {
  const topology = settings.wrapHorizontal && settings.wrapVertical
    ? 'toroidal'
    : settings.wrapHorizontal
      ? 'horizontal'
      : settings.wrapVertical
        ? 'vertical'
        : 'standard';
  const labels: Record<string, string> = {
    standard: '标准棋盘',
    horizontal: '左右环通',
    vertical: '上下环通',
    toroidal: '环形棋盘'
  };
  topologySummary.textContent = labels[topology];
  const perspectiveEnabled = settings.topologyPerspectiveEnabled ?? topologyPerspectiveInput.checked;
  boardPerspectiveBtn.classList.toggle('active', perspectiveEnabled);
  boardPerspectiveBtn.setAttribute('aria-pressed', String(perspectiveEnabled));
  topologyChoices.querySelectorAll<HTMLButtonElement>('[data-topology]').forEach((choice) => {
    const active = choice.dataset.topology === topology;
    choice.classList.toggle('active', active);
    choice.setAttribute('aria-pressed', String(active));
  });
  boardMenu.querySelectorAll<HTMLButtonElement>('[data-header-topology]').forEach((choice) => {
    const active = choice.dataset.headerTopology === topology;
    choice.classList.toggle('active', active);
    choice.setAttribute('aria-pressed', String(active));
  });
}

function getTopologyKey(settings: Pick<GameSettings, 'wrapHorizontal' | 'wrapVertical'>): string {
  return settings.wrapHorizontal && settings.wrapVertical
    ? 'toroidal'
    : settings.wrapHorizontal
      ? 'horizontal'
      : settings.wrapVertical
        ? 'vertical'
        : 'standard';
}

function updatePreviewBoard(settings: GameSettings, active: boolean): void {
  if (!active || !needsBoardPreview(settings)) {
    if (settingsPreviewBoard) {
      settingsPreviewBoard = null;
      setRendererBoard(engine.board);
    }
    return;
  }

  settingsPreviewBoard = new Board(settings);
  setRendererBoard(settingsPreviewBoard);
}

function needsBoardPreview(settings: GameSettings): boolean {
  return (
    settings.rows !== engine.board.rows ||
    settings.cols !== engine.board.cols ||
    settings.obstaclesEnabled !== engine.settings.obstaclesEnabled ||
    (settings.obstaclesEnabled && settings.obstacleCount !== engine.settings.obstacleCount)
  );
}

function updateRuleConfigVisibility(settings: GameSettings): void {
  const drawerOpen = settingsDrawer.classList.contains('open');
  setRuleConfigVisible(turnTimerConfig, drawerOpen && settings.turnTimerEnabled);
  setRuleConfigVisible(obstacleConfig, drawerOpen && settings.obstaclesEnabled);
  setRuleConfigVisible(bombLimitConfig, drawerOpen && settings.bombsEnabled);
  setRuleConfigVisible(gravityFlipLimitConfig, drawerOpen && settings.gravityFlipEnabled);
  setRuleConfigVisible(totalTimerConfig, drawerOpen && settings.totalTimerEnabled);
  bombLimitInput.disabled = bombLimitModeSelect.value === 'unlimited';
  gravityFlipLimitInput.disabled = gravityFlipLimitModeSelect.value === 'unlimited';
}

function setRuleConfigVisible(element: HTMLElement, visible: boolean): void {
  element.classList.toggle('visible', visible);
  element.setAttribute('aria-hidden', String(!visible));
}

function normalizeFormSettings(settings: GameSettings): GameSettings {
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
    bombLimit: settings.bombLimit === -1 ? -1 : clampInt(settings.bombLimit, 1, 9),
    gravityFlipLimit: settings.gravityFlipLimit === -1 ? -1 : clampInt(settings.gravityFlipLimit, 1, 9),
    turnSeconds: clampInt(settings.turnSeconds, 5, 60),
    totalSeconds: clampInt(settings.totalSeconds, 60, 20 * 60)
  };
}

function settingsMatch(left: GameSettings, right: GameSettings): boolean {
  const keys: Array<keyof GameSettings> = [
    'rows',
    'cols',
    'winLength',
    'wrapHorizontal',
    'wrapVertical',
    'obstaclesEnabled',
    'obstacleCount',
    'startingPlayer',
    'autoWinCheckEnabled',
    'topologyPerspectiveEnabled',
    'bombsEnabled',
    'bombLimit',
    'gravityFlipEnabled',
    'gravityFlipLimit',
    'matchMode',
    'aiDifficulty',
    'turnTimerEnabled',
    'turnSeconds',
    'totalTimerEnabled',
    'totalSeconds'
  ];
  return keys.every((key) => left[key] === right[key]);
}

function readSettings(): GameSettings {
  const matchMode = isOnline() ? 'local' : modeSelect.value === 'ai' ? 'ai' : 'local';
  return {
    ...engine.settings,
    rows: readNumber(rowsInput, DEFAULT_SETTINGS.rows),
    cols: readNumber(colsInput, DEFAULT_SETTINGS.cols),
    winLength: readNumber(winInput, DEFAULT_SETTINGS.winLength),
    obstacleCount: readNumber(obstacleCountInput, DEFAULT_SETTINGS.obstacleCount),
    wrapHorizontal: wrapHorizontalInput.checked,
    wrapVertical: wrapVerticalInput.checked,
    autoWinCheckEnabled: autoWinCheckInput.checked,
    topologyPerspectiveEnabled: topologyPerspectiveInput.checked,
    obstaclesEnabled: false,
    bombsEnabled: false,
    bombLimit: readRuleLimit(bombLimitModeSelect, bombLimitInput, engine.settings.bombLimit),
    gravityFlipEnabled: false,
    gravityFlipLimit: readRuleLimit(
      gravityFlipLimitModeSelect,
      gravityFlipLimitInput,
      engine.settings.gravityFlipLimit
    ),
    startingPlayer: getStartingPlayerChoice(),
    matchMode,
    aiDifficulty:
      difficultySelect.value === 'hard' ? 'hard' : difficultySelect.value === 'easy' ? 'easy' : 'medium',
    turnTimerEnabled: turnTimerInput.checked,
    turnSeconds: readNumber(turnSecondsInput, DEFAULT_SETTINGS.turnSeconds),
    totalTimerEnabled: totalTimerInput.checked,
    totalSeconds: readNumber(totalMinutesInput, 5) * 60
  };
}

function syncSettingsToForm(settings: GameSettings): void {
  rowsInput.value = String(settings.rows);
  colsInput.value = String(settings.cols);
  winInput.value = String(settings.winLength);
  obstacleCountInput.value = String(settings.obstacleCount);
  wrapHorizontalInput.checked = settings.wrapHorizontal;
  wrapVerticalInput.checked = settings.wrapVertical;
  autoWinCheckInput.checked = settings.autoWinCheckEnabled;
  topologyPerspectiveInput.checked = settings.topologyPerspectiveEnabled;
  obstaclesInput.checked = settings.obstaclesEnabled;
  bombsInput.checked = settings.bombsEnabled;
  syncRuleLimitToForm(bombLimitModeSelect, bombLimitInput, settings.bombLimit);
  gravityFlipInput.checked = settings.gravityFlipEnabled;
  syncRuleLimitToForm(gravityFlipLimitModeSelect, gravityFlipLimitInput, settings.gravityFlipLimit);
  setStartingPlayerChoice(settings.startingPlayer);
  modeSelect.value = settings.matchMode;
  difficultySelect.value = settings.aiDifficulty;
  difficultySelect.disabled = settings.matchMode !== 'ai';
  turnTimerInput.checked = settings.turnTimerEnabled;
  turnSecondsInput.value = String(settings.turnSeconds);
  turnSecondsOutput.value = String(settings.turnSeconds);
  totalTimerInput.checked = settings.totalTimerEnabled;
  totalMinutesInput.value = String(Math.round(settings.totalSeconds / 60));
  totalMinutesOutput.value = String(Math.round(settings.totalSeconds / 60));
  updateTopologyUI(settings);
}

function setStartingPlayerChoice(player: Player): void {
  const isGold = player === 2;
  redFirstBtn.classList.toggle('active', !isGold);
  goldFirstBtn.classList.toggle('active', isGold);
  redFirstBtn.setAttribute('aria-pressed', String(!isGold));
  goldFirstBtn.setAttribute('aria-pressed', String(isGold));
}

function getStartingPlayerChoice(): Player {
  return goldFirstBtn.classList.contains('active') ? 2 : 1;
}

function readRuleLimit(modeSelect: HTMLSelectElement, input: HTMLInputElement, fallback: number): number {
  if (modeSelect.value === 'unlimited') return -1;
  return clampInt(readNumber(input, fallback > 0 ? fallback : 1), 1, 9);
}

function syncRuleLimitToForm(modeSelect: HTMLSelectElement, input: HTMLInputElement, limit: number): void {
  const unlimited = limit === -1;
  modeSelect.value = unlimited ? 'unlimited' : 'limited';
  input.value = String(unlimited ? 1 : clampInt(limit, 1, 9));
  input.disabled = unlimited;
}

function isAiTurn(): boolean {
  return engine.settings.matchMode === 'ai' && engine.currentPlayer === 2 && engine.status === 'playing';
}

function readNumber(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, integer));
}

function hasRuleUseLeft(value: number): boolean {
  return value === -1 || value > 0;
}

function formatTime(value: number): string {
  const seconds = Math.max(0, Math.ceil(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatRuleLimit(value: number): string {
  return value === -1 ? '不限' : `${value}次`;
}

function formatRuleUses(value: number): string {
  return value === -1 ? '不限' : String(value);
}

function difficultyLabel(value: string): string {
  if (value === 'easy') return '简单';
  if (value === 'hard') return '困难';
  return '中等';
}

function loadStoredSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      obstaclesEnabled: false,
      bombsEnabled: false,
      gravityFlipEnabled: false
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveStoredSettings(settings: GameSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private contexts; the running match still keeps the settings.
  }
}

function loadStoredRenderMode(): '2d' | '3d' {
  try {
    return window.localStorage.getItem(RENDER_MODE_STORAGE_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

function saveStoredRenderMode(mode: '2d' | '3d'): void {
  try {
    window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, mode);
  } catch {
    // The mode still applies for the current session when storage is unavailable.
  }
}

async function recordPageVisit(): Promise<void> {
  const visitId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const response = await fetch('/api/visits', {
      method: 'POST',
      headers: { 'X-Visit-Id': visitId }
    });
    if (!response.ok) throw new Error(`Visit counter returned ${response.status}`);
    const payload = await response.json() as { count?: number };
    if (!Number.isFinite(payload.count) || (payload.count ?? 0) < 0) throw new Error('Invalid visit count');
    const count = Math.floor(payload.count ?? 0);
    visitCountValue.textContent = formatVisitCount(count);
    visitCount.title = `已被浏览 ${count.toLocaleString('zh-CN')} 次`;
    visitCount.hidden = false;
  } catch {
    visitCount.hidden = true;
  }
}

function formatVisitCount(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(count / 1_000)}k`;
}

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}
