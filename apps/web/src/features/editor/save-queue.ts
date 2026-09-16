export type SaveState = "saved" | "pending" | "saving" | "error";
// A single in-flight writer, with a separate desired snapshot for edits made while saving.
export class SaveQueue<T> {
  private desired: T;
  private persisted: string;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  revision: number;
  state: SaveState = "saved";
  error: Error | null = null;
  constructor(
    initial: T,
    revision: number,
    private write: (doc: T, revision: number) => Promise<{ revision: number }>,
    private notify: () => void = () => {},
  ) {
    this.desired = initial;
    this.persisted = JSON.stringify(initial);
    this.revision = revision;
  }
  get dirty() {
    return JSON.stringify(this.desired) !== this.persisted;
  }
  get document() {
    return this.desired;
  }
  change(doc: T) {
    this.desired = doc;
    // Incomplete email/URL/date input may be invalid while typing. Resume saving
    // after it changes; conflicts and network errors still require explicit recovery.
    if (
      this.error?.name === "ZodError" ||
      (this.error as { status?: number } | null)?.status === 422
    ) {
      this.error = null;
    }
    this.state = this.error ? "error" : "pending";
    this.notify();
    clearTimeout(this.timer);
    if (!this.error)
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, 800);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flight) {
      await this.flight;
      if (this.dirty) return this.flush();
      return;
    }
    if (this.error) throw this.error;
    if (!this.dirty) {
      this.state = "saved";
      this.notify();
      return;
    }
    this.flight = (async () => {
      while (this.dirty) {
        const snapshot = structuredClone(this.desired);
        this.state = "saving";
        this.notify();
        try {
          const result = await this.write(snapshot, this.revision);
          this.persisted = JSON.stringify(snapshot);
          this.revision = result.revision;
        } catch (e) {
          this.error = e as Error;
          this.state = "error";
          this.notify();
          throw e;
        }
      }
      this.state = "saved";
      this.notify();
    })();
    try {
      await this.flight;
    } finally {
      this.flight = null;
    }
  }
  retry() {
    this.error = null;
    return this.flush();
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
