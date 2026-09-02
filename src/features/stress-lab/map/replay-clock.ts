export type ReplaySpeed = 0.5 | 1 | 2;

export interface ReplayClockSnapshot {
  readonly cursor: number;
  readonly frameCount: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
}

type Listener = () => void;

const BASE_FRAME_DELAY_MS = 600;

export class ReplayClock {
  private frameCount = 0;
  private cursor = 0;
  private playing = false;
  private speed: ReplaySpeed = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<Listener>();
  private snapshot: ReplayClockSnapshot = Object.freeze({
    cursor: 0,
    frameCount: 0,
    playing: false,
    speed: 1,
  });

  constructor(frameCount: number) {
    this.replaceFrames(frameCount, 0);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReplayClockSnapshot => this.snapshot;

  replaceFrames(frameCount: number, cursor: number): void {
    if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
      throw new TypeError("Replay frame count must be a non-negative integer.");
    }
    this.clearTimer();
    this.frameCount = frameCount;
    this.cursor = frameCount === 0
      ? 0
      : Math.max(0, Math.min(frameCount - 1, cursor));
    this.playing = false;
    this.publish();
  }

  play(): void {
    if (this.frameCount < 2 || this.cursor >= this.frameCount - 1 || this.playing) return;
    this.playing = true;
    this.publish();
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.clearTimer();
    this.playing = false;
    this.publish();
  }

  seek(cursor: number): void {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= this.frameCount) {
      throw new RangeError("Replay cursor is outside the committed frame sequence.");
    }
    this.clearTimer();
    this.cursor = cursor;
    this.playing = false;
    this.publish();
  }

  previous(): void {
    if (this.frameCount === 0) return;
    this.seek(Math.max(0, this.cursor - 1));
  }

  next(): void {
    if (this.frameCount === 0) return;
    this.seek(Math.min(this.frameCount - 1, this.cursor + 1));
  }

  restart(): void {
    if (this.frameCount === 0) return;
    this.seek(0);
  }

  setSpeed(speed: ReplaySpeed): void {
    if (speed !== 0.5 && speed !== 1 && speed !== 2) {
      throw new TypeError("Replay speed is unsupported.");
    }
    if (this.speed === speed) return;
    this.speed = speed;
    if (this.playing) {
      this.clearTimer();
      this.schedule();
    }
    this.publish();
  }

  dispose(): void {
    this.clearTimer();
    this.playing = false;
    this.listeners.clear();
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.playing) return;
      this.cursor += 1;
      if (this.cursor >= this.frameCount - 1) {
        this.cursor = Math.max(0, this.frameCount - 1);
        this.playing = false;
      }
      this.publish();
      if (this.playing) this.schedule();
    }, BASE_FRAME_DELAY_MS / this.speed);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      cursor: this.cursor,
      frameCount: this.frameCount,
      playing: this.playing,
      speed: this.speed,
    });
    for (const listener of [...this.listeners]) listener();
  }
}
