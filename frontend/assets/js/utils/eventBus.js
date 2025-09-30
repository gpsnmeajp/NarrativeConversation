// シンプルな Pub/Sub（イベントバス）実装
// このモジュールはアプリケーション内のコンポーネント同士で疎結合に通信するための軽量な仕組みを提供します。
// 実装は非常にシンプルで、イベント名をキーに Set でハンドラを保持します。
// - on(event, handler): イベントリスナ登録（戻り値は解除関数）
// - once(event, handler): 1 回だけ実行されるハンドラ登録
// - off(event, handler): ハンドラの解除
// - emit(event, payload): ハンドラを同期的に呼び出す

class EventBus {
  constructor() {
    // Map<eventName, Set<handler>> を保持
    this.listeners = new Map();
  }

  /**
   * on(event, handler)
   * - イベントハンドラを登録します。
   * - 戻り値はその登録を解除する関数 (unsubscribe) です。
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * once(event, handler)
   * - 登録後一度だけ呼び出されるハンドラを登録します。
   * - 内部で on を利用し、最初の呼び出し時に自動で解除されます。
   */
  once(event, handler) {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }

  /**
   * off(event, handler)
   * - 指定したイベントからハンドラを削除します。
   * - ハンドラ集合が空になったら Map からキー自体も削除します。
   */
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) {
      this.listeners.delete(event);
    }
  }

  /**
   * emit(event, payload)
   * - 登録された全ハンドラを同期的に呼び出します。
   * - 各ハンドラは try/catch で保護され、例外が発生しても他のハンドラに影響を与えません。
   */
  emit(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[EventBus] handler error for ${event}`, error);
      }
    });
  }
}

export const eventBus = new EventBus();
