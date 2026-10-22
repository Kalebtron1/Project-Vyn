import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

const readSavingsSnapshot = vi.fn();
const fetchActivity = vi.fn();
vi.mock("@/stellar/queries", () => ({ readSavingsSnapshot: (a: string) => readSavingsSnapshot(a) }));
vi.mock("@/stellar/activity", () => ({ fetchActivity: (a: string) => fetchActivity(a) }));
vi.mock("@/stellar/treasury", () => ({ fetchAccruedInterest: vi.fn(), fetchPoolBalance: vi.fn() }));

import { useActivity, useCredit, useRefreshChainData, useSavings, useScore } from "./chainData";
import { HORIZON_LAG_MS, createAppQueryClient } from "./queryClient";

const WALLET = "GWALLET";

function setup() {
  const client = createAppQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const fetchMock = vi.fn();

beforeEach(() => {
  readSavingsSnapshot.mockReset().mockResolvedValue({ position: 100, deposited: 120, withdrawn: 30 });
  fetchActivity.mockReset().mockResolvedValue([]);
  fetchMock.mockReset().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("calculate-score") ? { score: 42, tier: 1 } : { success: true, tier: 1, availableCredit: 300 },
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const callsTo = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(path)).length;

describe("chainData", () => {
  it("shares one request between every card that shows the same data", async () => {
    const { client, wrapper } = setup();
    // ProgressRing, NftLevelCard and CreditSection all read credit (and two of them score).
    renderHook(
      () => {
        useCredit(WALLET);
        useCredit(WALLET);
        useCredit(WALLET);
        useScore(WALLET);
        useScore(WALLET);
        useActivity(WALLET);
        useActivity(WALLET);
      },
      { wrapper }
    );

    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(callsTo("get-available-credit")).toBe(1);
    expect(callsTo("calculate-score")).toBe(1);
    expect(fetchActivity).toHaveBeenCalledTimes(1);
    expect(readSavingsSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not poll: no new requests while the data is fresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, wrapper } = setup();
    renderHook(() => { useSavings(WALLET); useCredit(WALLET); }, { wrapper });
    await waitFor(() => expect(client.isFetching()).toBe(0));

    await act(async () => { await vi.advanceTimersByTimeAsync(55_000); });
    expect(readSavingsSnapshot).toHaveBeenCalledTimes(1);
    expect(callsTo("get-available-credit")).toBe(1);
  });

  it("scores with the balance read after an action, not the old one", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () => ({ score: useScore(WALLET), refresh: useRefreshChainData() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.score.isSuccess).toBe(true));

    readSavingsSnapshot.mockResolvedValue({ position: 250, deposited: 270, withdrawn: 30 });
    act(() => result.current.refresh(WALLET));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    const lastScoreCall = fetchMock.mock.calls.filter(([url]) => String(url).includes("calculate-score")).at(-1);
    expect(JSON.parse(lastScoreCall?.[1].body).totalDeposited).toBe(250);
    expect(readSavingsSnapshot).toHaveBeenCalledTimes(2);
  });

  it("after an action refreshes everything now, then history and score once more", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () => {
        useSavings(WALLET);
        useActivity(WALLET);
        useScore(WALLET);
        return useRefreshChainData();
      },
      { wrapper }
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));

    act(() => result.current(WALLET));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(readSavingsSnapshot).toHaveBeenCalledTimes(2);
    expect(fetchActivity).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(HORIZON_LAG_MS); });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    // Horizon-backed data is read again; the balance is not.
    expect(fetchActivity).toHaveBeenCalledTimes(3);
    expect(callsTo("calculate-score")).toBe(3);
    expect(readSavingsSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchActivity).toHaveBeenCalledTimes(3);
  });

  it("keeps the last good balance when a later read fails", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({ savings: useSavings(WALLET), refresh: useRefreshChainData() }), { wrapper });
    await waitFor(() => expect(result.current.savings.data?.position).toBe(100));

    readSavingsSnapshot.mockRejectedValue(new Error("network down"));
    act(() => result.current.refresh(WALLET));
    await waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 5_000 });
    expect(result.current.savings.data?.position).toBe(100);
  });
});
