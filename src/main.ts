import { ArrowDown, ArrowDownUp, ArrowUp, Bomb, CircleDot, createIcons, Play, RefreshCw, Undo2 } from 'lucide';
import './style.css';
import { GameEngine } from './core/GameEngine';
import { DEFAULT_SETTINGS, type ActionMode, type GameSettings, type Player, type ReplayFrame } from './core/types';
import { CanvasRenderer } from './render/CanvasRenderer';

const engine = new GameEngine(DEFAULT_SETTINGS);

const canvas = query<HTMLCanvasElement>('#gameCanvas');
const canvasShell = query<HTMLElement>('#canvasShell');
const renderer = new CanvasRenderer(canvas, canvasShell, engine.board, () => ({
  currentPlayer: engine.currentPlayer,
  gravity: engine.gravity,
  status: engine.status,
  winner: engine.winner,
  winLine: engine.winLine,
  actionMode: selectedMode,
  previewEnabled: !inputLocked && !replaying && !isAiTurn() && engine.status === 'playing',
  scoreSkew: engine.getScoreSkew()
}));

const currentToken = query<HTMLElement>('#currentToken');
const statusText = query<HTMLElement>('#statusText');
const redClock = query<HTMLElement>('#redClock');
const goldClock = query<HTMLElement>('#goldClock');
const turnClock = query<HTMLElement>('#turnClock');
const gravityBadge = query<HTMLElement>('#gravityBadge');
const modeSummary = query<HTMLElement>('#modeSummary');
const winnerLine = query<HTMLElement>('#winnerLine');
const moveCount = query<HTMLElement>('#moveCount');
const moveList = query<HTMLOListElement>('#moveList');

const rowsInput = query<HTMLInputElement>('#rowsInput');
const colsInput = query<HTMLInputElement>('#colsInput');
const winInput = query<HTMLInputElement>('#winInput');
const obstacleCountInput = query<HTMLInputElement>('#obstacleCountInput');
const wrapHorizontalInput = query<HTMLInputElement>('#wrapHorizontalInput');
const wrapVerticalInput = query<HTMLInputElement>('#wrapVerticalInput');
const obstaclesInput = query<HTMLInputElement>('#obstaclesInput');
const bombsInput = query<HTMLInputElement>('#bombsInput');
const gravityFlipInput = query<HTMLInputElement>('#gravityFlipInput');
const modeSelect = query<HTMLSelectElement>('#modeSelect');
const difficultySelect = query<HTMLSelectElement>('#difficultySelect');
const turnTimerInput = query<HTMLInputElement>('#turnTimerInput');
const turnSecondsInput = query<HTMLInputElement>('#turnSecondsInput');
const turnSecondsOutput = query<HTMLOutputElement>('#turnSecondsOutput');
const totalTimerInput = query<HTMLInputElement>('#totalTimerInput');
const totalMinutesInput = query<HTMLInputElement>('#totalMinutesInput');
const totalMinutesOutput = query<HTMLOutputElement>('#totalMinutesOutput');

const dropModeBtn = query<HTMLButtonElement>('#dropModeBtn');
const bombModeBtn = query<HTMLButtonElement>('#bombModeBtn');
const flipBtn = query<HTMLButtonElement>('#flipBtn');
const undoBtn = query<HTMLButtonElement>('#undoBtn');
const replayBtn = query<HTMLButtonElement>('#replayBtn');
const newGameBtn = query<HTMLButtonElement>('#newGameBtn');
const applySettingsBtn = query<HTMLButtonElement>('#applySettingsBtn');
const lucideIcons = {
  ArrowDown,
  ArrowUp,
  ArrowDownUp,
  Bomb,
  CircleDot,
  Play,
  RefreshCw,
  Undo2
};

let selectedMode: ActionMode = 'drop';
let inputLocked = false;
let aiPending = false;
let replaying = false;
let replayTimer: number | null = null;
let lastTick = performance.now();

createIcons({ icons: lucideIcons });
syncSettingsToForm(engine.settings);
wireEvents();
updateUI();
requestAnimationFrame(tick);

function wireEvents(): void {
  canvas.addEventListener('pointermove', (event) => renderer.setHoverFromEvent(event));
  canvas.addEventListener('pointerleave', () => renderer.clearHover());
  canvas.addEventListener('click', async (event) => {
    if (inputLocked || replaying || isAiTurn() || engine.status !== 'playing') return;
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

  flipBtn.addEventListener('click', async () => {
    if (inputLocked || replaying || isAiTurn()) return;
    await performFlip();
  });

  undoBtn.addEventListener('click', () => {
    if (inputLocked || replaying) return;
    if (engine.undo()) {
      selectedMode = 'drop';
      renderer.setReplayFrame(null);
      renderer.setBoard(engine.board);
      updateUI();
      maybeScheduleAi();
    }
  });

  replayBtn.addEventListener('click', () => {
    if (inputLocked || replaying) return;
    startReplay();
  });

  newGameBtn.addEventListener('click', () => resetGame(readSettings()));
  applySettingsBtn.addEventListener('click', () => resetGame(readSettings()));

  turnSecondsInput.addEventListener('input', () => {
    turnSecondsOutput.value = turnSecondsInput.value;
  });
  totalMinutesInput.addEventListener('input', () => {
    totalMinutesOutput.value = totalMinutesInput.value;
  });

  modeSelect.addEventListener('change', () => {
    difficultySelect.disabled = modeSelect.value !== 'ai';
  });
}

async function performColumnAction(col: number): Promise<void> {
  const outcome = engine.playColumn(col, selectedMode);
  if (!outcome.ok) {
    selectedMode = 'drop';
    updateUI(outcome.message);
    return;
  }

  await playOutcome(outcome);
}

async function performFlip(): Promise<void> {
  const outcome = engine.flipGravity();
  if (!outcome.ok) {
    updateUI(outcome.message);
    return;
  }

  await playOutcome(outcome);
}

async function playOutcome(outcome: ReturnType<GameEngine['playColumn']> | ReturnType<GameEngine['flipGravity']>): Promise<void> {
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
  if (!isAiTurn() || inputLocked || replaying || aiPending || engine.status !== 'playing') return;

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
    const frame = engine.replayFrames[index];
    renderer.setReplayFrame(frame);
    updateUI(frame.label, frame);
    index += 1;

    if (index < engine.replayFrames.length) {
      replayTimer = window.setTimeout(showFrame, 620);
      return;
    }

    replayTimer = window.setTimeout(() => {
      replaying = false;
      inputLocked = false;
      renderer.setReplayFrame(null);
      updateUI();
      maybeScheduleAi();
    }, 820);
  };

  showFrame();
}

function resetGame(settings: GameSettings): void {
  if (replayTimer !== null) {
    window.clearTimeout(replayTimer);
    replayTimer = null;
  }
  replaying = false;
  inputLocked = false;
  aiPending = false;
  selectedMode = 'drop';
  engine.reset(settings);
  renderer.setReplayFrame(null);
  renderer.setBoard(engine.board);
  syncSettingsToForm(engine.settings);
  updateUI();
  maybeScheduleAi();
}

function tick(now: number): void {
  const delta = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;

  if (!replaying) {
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
  const gravity = replayFrame?.gravity ?? engine.gravity;
  const winLine = replayFrame?.winLine ?? engine.winLine;

  document.documentElement.style.setProperty('--board-aspect', `${engine.board.cols} / ${engine.board.rows}`);
  currentToken.className = `player-token ${currentPlayer === 1 ? 'red' : 'gold'}`;
  gravityBadge.innerHTML = `<i data-lucide="${gravity === 'down' ? 'arrow-down' : 'arrow-up'}"></i>`;

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

  redClock.textContent = engine.settings.totalTimerEnabled ? formatTime(engine.totalRemaining[1]) : '--:--';
  goldClock.textContent = engine.settings.totalTimerEnabled ? formatTime(engine.totalRemaining[2]) : '--:--';
  turnClock.textContent = engine.settings.turnTimerEnabled ? `${Math.ceil(engine.turnRemaining)}s` : '--';

  dropModeBtn.classList.toggle('active', selectedMode === 'drop');
  bombModeBtn.classList.toggle('active', selectedMode === 'bomb');
  bombModeBtn.disabled = !canUseBomb(currentPlayer) || inputLocked || replaying || isAiTurn();
  flipBtn.disabled = !canUseFlip(currentPlayer) || inputLocked || replaying || isAiTurn() || status !== 'playing';
  undoBtn.disabled = inputLocked || replaying || engine.history.length === 0;
  replayBtn.disabled = inputLocked || replaying || engine.replayFrames.length <= 1;
  dropModeBtn.disabled = inputLocked || replaying || isAiTurn() || status !== 'playing';

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
  const badges = [
    engine.settings.matchMode === 'ai' ? `AI ${difficultyLabel(engine.settings.aiDifficulty)}` : '本地双人',
    `${engine.board.rows}x${engine.board.cols}`,
    `${engine.board.winLength} 连珠`
  ];
  if (engine.settings.wrapHorizontal) badges.push('左右联通');
  if (engine.settings.wrapVertical) badges.push('上下联通');
  if (engine.settings.obstaclesEnabled) badges.push('障碍');
  if (engine.settings.bombsEnabled) badges.push(`炸弹 ${engine.bombsLeft[1]}/${engine.bombsLeft[2]}`);
  if (engine.settings.gravityFlipEnabled) badges.push(`反转 ${engine.flipsLeft[1]}/${engine.flipsLeft[2]}`);
  modeSummary.innerHTML = badges.map((badge) => `<span>${badge}</span>`).join('');
}

function renderMoves(): void {
  moveCount.textContent = String(engine.moves.length);
  const recent = engine.moves.slice(-12).reverse();
  moveList.innerHTML = recent
    .map((move) => {
      const marker = move.player === 1 ? 'red-dot' : 'gold-dot';
      return `<li><span class="${marker}"></span><strong>${move.id}</strong>${move.label}</li>`;
    })
    .join('');
}

function readSettings(): GameSettings {
  return {
    ...engine.settings,
    rows: readNumber(rowsInput, DEFAULT_SETTINGS.rows),
    cols: readNumber(colsInput, DEFAULT_SETTINGS.cols),
    winLength: readNumber(winInput, DEFAULT_SETTINGS.winLength),
    obstacleCount: readNumber(obstacleCountInput, DEFAULT_SETTINGS.obstacleCount),
    wrapHorizontal: wrapHorizontalInput.checked,
    wrapVertical: wrapVerticalInput.checked,
    obstaclesEnabled: obstaclesInput.checked,
    bombsEnabled: bombsInput.checked,
    gravityFlipEnabled: gravityFlipInput.checked,
    matchMode: modeSelect.value === 'ai' ? 'ai' : 'local',
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
  obstaclesInput.checked = settings.obstaclesEnabled;
  bombsInput.checked = settings.bombsEnabled;
  gravityFlipInput.checked = settings.gravityFlipEnabled;
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

function canUseBomb(player: Player): boolean {
  return engine.status === 'playing' && engine.settings.bombsEnabled && engine.bombsLeft[player] > 0;
}

function canUseFlip(player: Player): boolean {
  return engine.status === 'playing' && engine.settings.gravityFlipEnabled && engine.flipsLeft[player] > 0;
}

function isAiTurn(): boolean {
  return engine.settings.matchMode === 'ai' && engine.currentPlayer === 2 && engine.status === 'playing';
}

function readNumber(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function formatTime(value: number): string {
  const seconds = Math.max(0, Math.ceil(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function difficultyLabel(value: string): string {
  if (value === 'easy') return '简单';
  if (value === 'hard') return '困难';
  return '中等';
}

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}
