import { observable, observe, unobserve } from "@nx-js/observer-util";

export class Channel<Value> {
  private readonly signal = observable({ revision: 0 });
  private revision = 0;
  private readonly frames: Value[] = [];

  listen(listener: (value: Value) => void): () => void {
    const reaction = observe(() => this.signal.revision, {
      scheduler: () => listener(this.frames[this.frames.length - 1]!),
    });
    return () => unobserve(reaction);
  }

  emit(value: Value): void {
    this.frames.push(value);
    try {
      this.signal.revision = ++this.revision;
    } finally {
      this.frames.pop();
    }
  }
}
