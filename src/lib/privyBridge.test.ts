import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El puente guarda estado a nivel de módulo: cada prueba importa una copia nueva.
async function loadBridge() {
  vi.resetModules();
  return import("./privyBridge");
}

function fakeActions() {
  return {
    login: vi.fn(),
    logout: vi.fn(async () => {}),
    exportWallet: vi.fn(async () => {}),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("privyBridge", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues the login until Privy is ready and asks to mount it", async () => {
    const bridge = await loadBridge();
    const actions = fakeActions();

    bridge.privyLogin();
    expect(actions.login).not.toHaveBeenCalled();

    bridge.registerPrivyActions(actions);
    bridge.setPrivyState({ loaded: true, ready: false });
    await flush();
    expect(actions.login).not.toHaveBeenCalled();

    bridge.setPrivyState({ ready: true });
    await flush();
    expect(actions.login).toHaveBeenCalledTimes(1);
  });

  it("opens the login right away when Privy is already ready", async () => {
    const bridge = await loadBridge();
    const actions = fakeActions();
    bridge.registerPrivyActions(actions);
    bridge.setPrivyState({ loaded: true, ready: true });

    bridge.privyLogin();
    expect(actions.login).toHaveBeenCalledTimes(1);
  });

  it("makes privySign wait for the signer after a reload", async () => {
    const bridge = await loadBridge();
    const signing = bridge.privySign("unsigned-xdr");

    bridge.registerPrivySigner(async (xdr) => `${xdr}+signed`);
    await expect(signing).resolves.toBe("unsigned-xdr+signed");
  });

  it("fails privySign when Privy never becomes ready", async () => {
    vi.useFakeTimers();
    const bridge = await loadBridge();
    const signing = bridge.privySign("unsigned-xdr");
    const assertion = expect(signing).rejects.toThrow(/Privy no está listo/);

    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("closes a leftover Privy session once it loads and ignores its connect event", async () => {
    const bridge = await loadBridge();
    const actions = fakeActions();
    const onConnected = vi.fn();
    bridge.onPrivyConnected(onConnected);

    // Logout from a Freighter session: Privy is not loaded yet.
    bridge.privyLogout();

    bridge.registerPrivyActions(actions);
    bridge.setPrivyState({ loaded: true, ready: true, authenticated: true });
    await flush();
    expect(actions.logout).toHaveBeenCalledTimes(1);

    // PrivyBridge may still report the old wallet while logout is in flight.
    bridge.notifyPrivyConnected({ stellarAddress: "GOLD" });
    expect(onConnected).not.toHaveBeenCalled();

    // Once Privy reports the session as closed, a new login goes through.
    bridge.setPrivyState({ authenticated: false });
    bridge.notifyPrivyConnected({ stellarAddress: "GNEW" });
    expect(onConnected).toHaveBeenCalledWith({ stellarAddress: "GNEW" });
  });

  it("does not call Privy logout when there is no Privy session", async () => {
    const bridge = await loadBridge();
    const actions = fakeActions();
    bridge.registerPrivyActions(actions);
    bridge.setPrivyState({ loaded: true, ready: true, authenticated: false });

    bridge.privyLogout();
    await flush();
    expect(actions.logout).not.toHaveBeenCalled();
  });

  it("runs a queued login only after the leftover session is closed", async () => {
    const bridge = await loadBridge();
    const order: string[] = [];
    let finishLogout: () => void = () => {};
    const actions = {
      login: vi.fn(() => { order.push("login"); }),
      logout: vi.fn(
        () => new Promise<void>((resolve) => {
          finishLogout = () => { order.push("logout"); resolve(); };
        })
      ),
      exportWallet: vi.fn(async () => {}),
    };

    bridge.privyLogout();
    bridge.privyLogin();
    bridge.registerPrivyActions(actions);
    bridge.setPrivyState({ loaded: true, ready: true, authenticated: true });
    await flush();
    expect(actions.login).not.toHaveBeenCalled();

    finishLogout();
    await flush();
    expect(order).toEqual(["logout", "login"]);
  });

  it("waits for Privy before exporting the wallet", async () => {
    const bridge = await loadBridge();
    const actions = fakeActions();
    const exporting = bridge.privyExportWallet("GADDR");

    bridge.registerPrivyActions(actions);
    bridge.setPrivyState({ loaded: true, ready: true, authenticated: true });
    await exporting;
    expect(actions.exportWallet).toHaveBeenCalledWith("GADDR");
  });
});
