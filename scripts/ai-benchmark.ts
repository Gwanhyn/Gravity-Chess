import { performance } from 'node:perf_hooks';
import { GameEngine } from '../src/core/GameEngine';
import type { Cell, GameSettings } from '../src/core/types';

interface BenchmarkCase {
  name: string;
  settings: Partial<GameSettings>;
  matrix: Cell[][];
}

const standardMatrix: Cell[][] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
  [0, 1, 2, 1, 0, 0, 0],
  [1, 2, 1, 2, 1, 0, 2]
];

const wideMatrix: Cell[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 2, 0, 0, 0, 0],
  [0, 1, 2, 2, 1, 1, 0, 0, 0],
  [1, 2, 1, 1, 2, 2, 1, 0, 2]
];

const cases: BenchmarkCase[] = [
  {
    name: '标准 5x7',
    settings: { rows: 5, cols: 7, winLength: 4 },
    matrix: standardMatrix
  },
  {
    name: '横环 5x7',
    settings: { rows: 5, cols: 7, winLength: 4, wrapHorizontal: true },
    matrix: standardMatrix
  },
  {
    name: '环面 5x7',
    settings: { rows: 5, cols: 7, winLength: 4, wrapHorizontal: true, wrapVertical: true },
    matrix: standardMatrix
  },
  {
    name: '环面 8x9',
    settings: { rows: 8, cols: 9, winLength: 5, wrapHorizontal: true, wrapVertical: true },
    matrix: wideMatrix
  }
];

const runs = 5;
let failed = false;

for (const difficulty of ['easy', 'medium', 'hard'] as const) {
  for (const benchmark of cases) {
    const timings: number[] = [];
    let nodes = 0;
    let cacheHits = 0;
    let depth = 0;

    for (let run = 0; run < runs; run += 1) {
      const engine = new GameEngine({
        matchMode: 'ai',
        aiDifficulty: difficulty,
        autoWinCheckEnabled: true,
        ...benchmark.settings
      });
      engine.board.setMatrix(benchmark.matrix);
      engine.currentPlayer = 2;
      engine.status = 'playing';

      const startedAt = performance.now();
      const move = engine.getAiColumn();
      const elapsed = performance.now() - startedAt;
      const diagnostics = engine.getLastAiDiagnostics();

      if (move === null) {
        throw new Error(`${benchmark.name} ${difficulty}: AI did not return a legal move`);
      }
      timings.push(elapsed);
      nodes += diagnostics.nodes;
      cacheHits += diagnostics.cacheHits;
      depth = Math.max(depth, diagnostics.depth);
    }

    const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    const max = Math.max(...timings);
    const averageNodes = Math.round(nodes / runs);
    const averageCacheHits = Math.round(cacheHits / runs);
    console.log(
      `${difficulty.padEnd(6)} ${benchmark.name.padEnd(10)} avg ${average.toFixed(1)}ms  max ${max.toFixed(1)}ms  depth ${depth}  nodes ${averageNodes}  cache ${averageCacheHits}`
    );

    if (difficulty === 'hard' && max > 350) {
      failed = true;
      console.error(`Advanced AI exceeded the 350ms responsiveness budget in ${benchmark.name}.`);
    }
  }
}

if (failed) process.exitCode = 1;
