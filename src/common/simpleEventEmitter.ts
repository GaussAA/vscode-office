type Listener = (...args: unknown[]) => void;

export class SimpleEventEmitter {
  private readonly listenerMap = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): this {
    let eventListeners = this.listenerMap.get(event);
    if (!eventListeners) {
      eventListeners = new Set();
      this.listenerMap.set(event, eventListeners);
    }
    eventListeners.add(listener);
    return this;
  }

  removeListener(event: string, listener: Listener): boolean {
    const deleted = this.listenerMap.get(event)?.delete(listener) ?? false;
    // Clean up empty sets
    if (this.listenerMap.get(event)?.size === 0) {
      this.listenerMap.delete(event);
    }
    return deleted;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.listenerMap.delete(event);
    } else {
      this.listenerMap.clear();
    }
    return this;
  }

  listeners(event: string): Listener[] {
    return [...(this.listenerMap.get(event) ?? [])];
  }

  emit(event: string, ...args: unknown[]): boolean {
    const eventListeners = this.listenerMap.get(event);
    if (!eventListeners || eventListeners.size === 0) {
      return false;
    }
    for (const listener of eventListeners) {
      listener(...args);
    }
    return true;
  }
}
