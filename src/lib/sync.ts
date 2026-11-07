/**
 * Keeps an open file's remote sources up to date.
 *
 * Only one window per file runs the timer: windows queue for a Web Lock named
 * after the file, and whichever holds it is the "sync window". When that window
 * closes, the next one in the queue takes over. Results are saved like any other
 * edit, so the other windows pick them up through the normal merge.
 */
export class SyncLoop {
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private release: (() => void) | null = null;
  leader = false;

  constructor(
    private run: () => Promise<void>,
    private onLeaderChange: (leader: boolean) => void = () => {},
  ) {}

  start(fileId: string, minutes: () => number) {
    this.stop();
    const abort = new AbortController();
    this.abort = abort;
    const become = () => {
      this.leader = true;
      this.onLeaderChange(true);
      void this.run();
      this.schedule(minutes);
    };
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) {
      become();
      return;
    }
    locks
      .request(`cashflow-allseeing.sync.${fileId}`, { signal: abort.signal }, () => {
        if (abort.signal.aborted) return;
        become();
        return new Promise<void>((resolve) => (this.release = resolve));
      })
      .catch(() => {
        // Aborted while waiting in the queue.
      });
  }

  /** Re-arm the timer, e.g. after the interval setting changes. */
  schedule(minutes: () => number) {
    if (this.timer) clearInterval(this.timer);
    if (!this.leader) return;
    this.timer = setInterval(() => void this.run(), Math.max(1, minutes()) * 60_000);
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.release?.();
    this.release = null;
    if (this.leader) {
      this.leader = false;
      this.onLeaderChange(false);
    }
  }
}
