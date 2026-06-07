import {
  ArrowDownUp,
  BadgeCheck,
  Bomb,
  Check,
  CircleHelp,
  CircleDot,
  createIcons,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Settings,
  Undo2,
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

const SETTINGS_STORAGE_KEY = 'gravity-chess:settings';

const engine = new GameEngine(loadStoredSettings());
let selectedMode: ActionMode = 'drop';
let inputLocked = false;
let aiPending = false;
let replaying = false;
let replayTimer: number | null = null;
let replayFrameIndex: number | null = null;
let lastTick = performance.now();
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let onlineRoom: OnlineRoomState | null = null;
let pendingRemoteOutcome: MoveOutcome | null = null;
let settingsPreview: GameSettings | null = null;
let settingsPreviewBoard: Board | null = null;
let settingsDirty = false;
let previousDialogFocus: HTMLElement | null = null;

const canvas = query<HTMLCanvasElement>('#gameCanvas');
const canvasShell = query<HTMLElement>('#canvasShell');
const renderer = new CanvasRenderer(canvas, canvasShell, engine.board, () => ({
  currentPlayer: engine.currentPlayer,
  gravity: engine.gravity,
  status: engine.status,
  winner: engine.winner,
  winLine: engine.winLine,
  actionMode: selectedMode,
  previewEnabled: !inputLocked && !replaying && !settingsDirty && canActLocally() && engine.status === 'playing',
  scoreSkew: engine.getScoreSkew(),
  topologyPerspectiveEnabled: getVisualSettings().topologyPerspectiveEnabled,
  wrapHorizontal: getVisualSettings().wrapHorizontal,
  wrapVertical: getVisualSettings().wrapVertical
}));

const currentToken = query<HTMLElement>('#currentToken');
const statusText = query<HTMLElement>('#statusText');
const redClock = query<HTMLElement>('#redClock');
const goldClock = query<HTMLElement>('#goldClock');
const turnClock = query<HTMLElement>('#turnClock');
const modeSummary = query<HTMLElement>('#modeSummary');
const winnerLine = query<HTMLElement>('#winnerLine');
const moveCount = query<HTMLElement>('#moveCount');
const moveList = query<HTMLOListElement>('#moveList');

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
const howToPlayBtn = query<HTMLButtonElement>('#howToPlayBtn');
const howToPlayDialog = query<HTMLElement>('#howToPlayDialog');
const howToPlayCloseBtn = query<HTMLButtonElement>('#howToPlayCloseBtn');
const undoRequestDialog = query<HTMLElement>('#undoRequestDialog');
const undoRequestTitle = query<HTMLElement>('#undoRequestTitle');
const undoRequestText = query<HTMLElement>('#undoRequestText');
const undoAcceptBtn = query<HTMLButtonElement>('#undoAcceptBtn');
const undoDeclineBtn = query<HTMLButtonElement>('#undoDeclineBtn');

const dropModeBtn = query<HTMLButtonElement>('#dropModeBtn');
const checkWinBtn = query<HTMLButtonElement>('#checkWinBtn');
const bombModeBtn = query<HTMLButtonElement>('#bombModeBtn');
const flipBtn = query<HTMLButtonElement>('#flipBtn');
const undoBtn = query<HTMLButtonElement>('#undoBtn');
const replayBtn = query<HTMLButtonElement>('#replayBtn');
const newGameBtn = query<HTMLButtonElement>('#newGameBtn');
const applySettingsBtn = query<HTMLButtonElement>('#applySettingsBtn');
const lucideIcons = {
  ArrowDownUp,
  BadgeCheck,
  Bomb,
  Check,
  CircleHelp,
  CircleDot,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Settings,
  Undo2,
  Wifi,
  X
};

createIcons({ icons: lucideIcons });
syncSettingsToForm(engine.settings);
updateRuleConfigVisibility(engine.settings);
wireEvents();
updateUI();
requestAnimationFrame(tick);

function wireEvents(): void {
  canvas.addEventListener('pointermove', (event) => renderer.setHoverFromEvent(event));
  canvas.addEventListener('pointerleave', () => renderer.clearHover());
  canvas.addEventListener('click', async (event) => {
    if (inputLocked || replaying || settingsDirty || !canActLocally() || engine.status !== 'playing') return;
    const col = renderer.getColumnFromEvent(event);
    if (col === null) return;
    await performColumnAction(col);
  });

  dropModeBtn.addEventListener('click', () => {
    selectedMode = 'drop';
    updateUI();
  });

  bombModeBtn.addEventListener('click', () => {
    if (canUseBomb(engine.currentPlayer)) {
      selectedMode = 'bomb';
      updateUI();
    }
  });

  checkWinBtn.addEventListener('click', async () => {
    if (inputLocked || replaying || !canActLocally()) return;
    await performManualCheck();
  });

  flipBtn.addEventListener('click', async () => {
    if (inputLocked || replaying || !canActLocally()) return;
    await performFlip();
  });

  undoBtn.addEventListener('click', () => {
    if (inputLocked || replaying) return;
    if (isOnline()) {
      emitOnlineAction({ kind: 'undo-request' });
      return;
    }
    if (engine.undo()) {
      selectedMode = 'drop';
      renderer.setReplayFrame(null);
      renderer.setBoard(engine.board);
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
  settingsToggleBtn.addEventListener('click', () => {
    const isOpen = settingsDrawer.classList.contains('open');
    setSettingsDrawer(!(isOpen && !settingsDirty));
  });
  settingsCloseBtn.addEventListener('click', () => setSettingsDrawer(false));
  howToPlayBtn.addEventListener('click', () => setHowToPlayDialog(true));
  howToPlayCloseBtn.addEventListener('click', () => setHowToPlayDialog(false));
  howToPlayDialog.addEventListener('click', (event) => {
    if (event.target === howToPlayDialog) {
      setHowToPlayDialog(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !howToPlayDialog.classList.contains('hidden')) {
      setHowToPlayDialog(false);
    }
  });
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
    if (!settingsDrawer.classList.contains('open') || settingsDirty) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (settingsDrawer.contains(target) || settingsToggleBtn.contains(target)) return;
    setSettingsDrawer(false);
  });
}

async function performColumnAction(col: number): Promise<void> {
  if (isOnline()) {
    emitOnlineAction({ kind: 'drop', col, mode: selectedMode });
    return;
  }

  const outcome = engine.playColumn(col, selectedMode);
  if (!outcome.ok) {
    selectedMode = 'drop';
    updateUI(outcome.message);
    return;
  }

  await playOutcome(outcome);
}

async function performFlip(): Promise<void> {
  if (isOnline()) {
    emitOnlineAction({ kind: 'flip' });
    return;
  }

  const outcome = engine.flipGravity();
  if (!outcome.ok) {
    updateUI(outcome.message);
    return;
  }

  await playOutcome(outcome);
}

async function performManualCheck(): Promise<void> {
  if (isOnline()) {
    emitOnlineAction({ kind: 'check' });
    return;
  }

  const outcome = engine.checkWinManually();
  if (!outcome.ok) {
    updateUI(outcome.message);
    return;
  }

  await playOutcome(outcome);
}

async function playOutcome(outcome: MoveOutcome): Promise<void> {
  inputLocked = true;
  renderer.setReplayFrame(null);
  updateUI();
  await renderer.animateMove(outcome);
  inputLocked = false;

  if (!canUseBomb(engine.currentPlayer)) {
    selectedMode = 'drop';
  }

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
    const outcome = engine.playColumn(col, 'drop');
    await playOutcome(outcome);
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
  renderer.setReplayFrame(null);
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
  renderer.setReplayFrame(frame);
  updateUI(undefined, frame);
}

function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (socket) return socket;

  socket = io();
  socket.on('room:state', async (payload) => {
    onlineRoom = payload;
    pendingRemoteOutcome = payload.outcome ?? null;
    engine.importState(payload.state);
    saveStoredSettings(engine.settings);
    replayFrameIndex = null;
    renderer.setReplayFrame(null);
    renderer.setBoard(engine.board);
    syncSettingsToForm(engine.settings);
    settingsPreview = null;
    settingsPreviewBoard = null;
    settingsDirty = false;
    updateRuleConfigVisibility(engine.settings);

    const outcome = pendingRemoteOutcome;
    pendingRemoteOutcome = null;
    if (outcome?.ok && outcome.position && outcome.kind !== 'check') {
      inputLocked = true;
      updateUI(payload.message);
      await renderer.animateMove(outcome);
      inputLocked = false;
    } else {
      inputLocked = false;
    }

    if (!canUseBomb(engine.currentPlayer)) {
      selectedMode = 'drop';
    }
    updateUI(payload.message);
  });

  socket.on('room:error', (payload) => {
    inputLocked = false;
    updateUI(payload.message);
  });

  socket.on('disconnect', () => {
    onlineRoom = null;
    updateUI('联机已断开');
  });

  return socket;
}

function createOnlineRoom(): void {
  getSocket().emit('room:create', readSettings());
}

function joinOnlineRoom(): void {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    updateUI('请输入房间码');
    return;
  }
  getSocket().emit('room:join', code);
}

function leaveOnlineRoom(): void {
  if (!socket) return;
  socket.emit('room:leave');
  onlineRoom = null;
  updateUI('已离开房间');
}

function setSettingsDrawer(open: boolean): void {
  settingsDrawer.classList.toggle('open', open);
  if (open) {
    updateSettingsPreview();
    return;
  }

  settingsPreview = null;
  settingsDirty = false;
  settingsPreviewBoard = null;
  renderer.setBoard(engine.board);
  syncSettingsToForm(engine.settings);
  updateRuleConfigVisibility(engine.settings);
  updateUI();
}

function setHowToPlayDialog(open: boolean): void {
  howToPlayDialog.classList.toggle('hidden', !open);
  howToPlayDialog.setAttribute('aria-hidden', String(!open));

  if (open) {
    previousDialogFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    howToPlayCloseBtn.focus();
    return;
  }

  const focusTarget = previousDialogFocus ?? howToPlayBtn;
  previousDialogFocus = null;
  focusTarget.focus();
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
  renderer.setReplayFrame(null);
  renderer.setBoard(engine.board);
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
      if (!canUseBomb(engine.currentPlayer)) selectedMode = 'drop';
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
  const winLine = replayFrame?.winLine ?? engine.winLine;
  const visualSettings = getVisualSettings();
  const visualBoard = settingsPreviewBoard ?? engine.board;

  document.documentElement.style.setProperty('--board-aspect', `${visualBoard.cols} / ${visualBoard.rows}`);
  currentToken.className = `player-token ${currentPlayer === 1 ? 'red' : 'gold'}`;

  if (message) {
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

  redClock.textContent = visualSettings.totalTimerEnabled ? formatTime(engine.totalRemaining[1]) : '--:--';
  goldClock.textContent = visualSettings.totalTimerEnabled ? formatTime(engine.totalRemaining[2]) : '--:--';
  turnClock.textContent = visualSettings.turnTimerEnabled ? `${Math.ceil(engine.turnRemaining)}s` : '--';

  dropModeBtn.classList.toggle('active', selectedMode === 'drop');
  bombModeBtn.classList.toggle('active', selectedMode === 'bomb');
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
  bombModeBtn.disabled =
    settingsDirty || !canUseBomb(currentPlayer) || inputLocked || replaying || hasPendingUndo || !canActLocally();
  flipBtn.disabled =
    settingsDirty ||
    !canUseFlip(currentPlayer) ||
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
  applySettingsBtn.disabled = (isOnline() && !onlineRoom?.isHost) || !settingsDirty;
  newGameBtn.disabled = isOnline() && !onlineRoom?.isHost;
  redFirstBtn.disabled = isOnline() && !onlineRoom?.isHost;
  goldFirstBtn.disabled = isOnline() && !onlineRoom?.isHost;
  updateOnlineUI();
  updateUndoRequestUI();

  renderSummary();
  renderMoves();

  if (status === 'won' && winLine.length > 0) {
    winnerLine.textContent = winLine.map((cell) => `${cell.col + 1}:${cell.row + 1}`).join('  ');
  } else {
    winnerLine.textContent = '';
  }

  createIcons({ icons: lucideIcons });
}

function renderSummary(): void {
  const visualSettings = getVisualSettings();
  const visualBoard = settingsPreviewBoard ?? engine.board;
  const badges = [
    visualSettings.matchMode === 'ai' ? `AI ${difficultyLabel(visualSettings.aiDifficulty)}` : '本地双人',
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
  const recent = engine.logEntries.slice(-80).reverse();
  moveList.innerHTML = recent
    .map((entry) => {
      const marker = entry.player === 1 ? 'red-dot' : entry.player === 2 ? 'gold-dot' : 'neutral-dot';
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
    onlineRoleBadge.textContent = socket?.connected ? '未入房' : '离线';
    onlineStatus.textContent = '本地模式';
    shareUrl.textContent = '';
    roomCodeInput.disabled = false;
    hostRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    leaveRoomBtn.disabled = true;
    return;
  }

  const roleLabel = roleToLabel(onlineRoom.role);
  onlineRoleBadge.textContent = onlineRoom.isHost ? `${roleLabel} · 房主` : roleLabel;
  onlineStatus.textContent = `房间 ${onlineRoom.roomCode} | ${engine.getPlayerName(engine.settings.startingPlayer)}先手 | 红方 ${
    onlineRoom.players.red ? '在线' : '空位'
  } | 金方 ${
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
  if (role === 1) return '红方';
  if (role === 2) return '金方';
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
  updateRuleConfigVisibility(formSettings);
  updatePreviewBoard(formSettings, drawerOpen && settingsDirty);
  updateUI();
}

function updatePreviewBoard(settings: GameSettings, active: boolean): void {
  if (!active || !needsBoardPreview(settings)) {
    if (settingsPreviewBoard) {
      settingsPreviewBoard = null;
      renderer.setBoard(engine.board);
    }
    return;
  }

  settingsPreviewBoard = new Board(settings);
  renderer.setBoard(settingsPreviewBoard);
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
    obstaclesEnabled: obstaclesInput.checked,
    bombsEnabled: bombsInput.checked,
    bombLimit: readRuleLimit(bombLimitModeSelect, bombLimitInput, engine.settings.bombLimit),
    gravityFlipEnabled: gravityFlipInput.checked,
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

function canUseBomb(player: Player): boolean {
  return engine.status === 'playing' && engine.settings.bombsEnabled && hasRuleUseLeft(engine.bombsLeft[player]);
}

function canUseFlip(player: Player): boolean {
  return (
    engine.status === 'playing' && engine.settings.gravityFlipEnabled && hasRuleUseLeft(engine.flipsLeft[player])
  );
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}
