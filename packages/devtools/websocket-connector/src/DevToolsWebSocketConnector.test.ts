import { DevToolsWebSocketConnector } from "./DevToolsWebSocketConnector";

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }
}

describe("global WebSocket connector", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    DevToolsWebSocketConnector.destroyInstance();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the host constructor, sends queued messages, receives messages and closes", () => {
    const connector = DevToolsWebSocketConnector.getInstance();
    connector.sendMessage("test", "queued");
    connector.connect({ url: "ws://localhost:10001" });
    const socket = MockWebSocket.instances[0]!;
    expect(socket.url).toBe("ws://localhost:10001");
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();
    expect(socket.send).toHaveBeenCalledWith(
      'message|{"type":"test","payload":"queued"}',
    );
    const listener = vi.fn();
    connector.listenToMessages(listener);
    socket.onmessage!(
      new MessageEvent("message", {
        data: 'message|{"type":"reply","payload":"ok"}',
      }),
    );
    expect(listener).toHaveBeenCalledWith("reply", "ok");
    connector.connect({ url: socket.url });
    expect(MockWebSocket.instances).toHaveLength(1);
    DevToolsWebSocketConnector.destroyInstance();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("handles a generic error event without accessing EventTarget.readyState", () => {
    const connector = DevToolsWebSocketConnector.getInstance().connect({
      url: "ws://localhost:10001",
    });
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.CLOSED;
    socket.onerror!(new Event("error"));
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(connector).toBe(DevToolsWebSocketConnector.getInstance());
  });

  it("fails explicitly when no global constructor is available", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() =>
      DevToolsWebSocketConnector.getInstance().connect({
        url: "ws://localhost:10001",
      }),
    ).toThrow();
  });
});
