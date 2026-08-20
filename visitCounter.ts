import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface StoredVisitCount {
  count: number;
}

const RECENT_VISIT_TTL_MS = 60 * 60 * 1000;

export class VisitCounter {
  private count = 0;
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();
  private recentVisitIds = new Map<string, number>();

  constructor(private readonly filePath: string) {}

  getCount(): Promise<number> {
    return this.runExclusive(async () => {
      await this.load();
      return this.count;
    });
  }

  increment(visitId?: string): Promise<number> {
    return this.runExclusive(async () => {
      await this.load();
      this.pruneRecentVisits();
      if (visitId && this.recentVisitIds.has(visitId)) return this.count;

      this.count += 1;
      if (visitId) this.recentVisitIds.set(visitId, Date.now());
      await this.persist();
      return this.count;
    });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const stored = JSON.parse(raw) as Partial<StoredVisitCount>;
      this.count = Number.isFinite(stored.count) ? Math.max(0, Math.floor(stored.count ?? 0)) : 0;
    } catch {
      this.count = 0;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ count: this.count }, null, 2), 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  private pruneRecentVisits(): void {
    const cutoff = Date.now() - RECENT_VISIT_TTL_MS;
    for (const [visitId, recordedAt] of this.recentVisitIds) {
      if (recordedAt < cutoff) this.recentVisitIds.delete(visitId);
    }
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function createVisitCounter(): VisitCounter {
  const configuredPath = process.env.GRAVITY_CHESS_VIEW_COUNT_FILE;
  const filePath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(process.cwd(), 'data', 'view-count.json');
  return new VisitCounter(filePath);
}
