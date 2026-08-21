import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** Load constants.ts fresh with a given environment. */
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await import("./constants");
  } finally {
    process.env = prev;
  }
}

describe("cluster configuration", () => {
  it("defaults to devnet when nothing is set", async () => {
    const c = await loadWith({ NEXT_PUBLIC_CLUSTER: undefined });
    expect(c.CLUSTER).toBe("devnet");
    expect(c.TEE_URL).toContain("devnet-tee");
  });

  it("points every endpoint at mainnet when asked", async () => {
    const c = await loadWith({ NEXT_PUBLIC_CLUSTER: "mainnet" });
    expect(c.CLUSTER).toBe("mainnet");
    expect(c.BASE_RPC).toBe("https://rpc.magicblock.app/mainnet");
    expect(c.TEE_URL).toBe("https://mainnet-tee.magicblock.app");
    expect(c.TEE_WS).toBe("wss://mainnet-tee.magicblock.app");
  });

  /** The whole point: a stale devnet override on a real-money build. */
  it("refuses a mainnet build carrying a devnet endpoint", async () => {
    await expect(
      loadWith({
        NEXT_PUBLIC_CLUSTER: "mainnet",
        NEXT_PUBLIC_TEE_URL: "https://devnet-tee.magicblock.app",
      }),
    ).rejects.toThrow(/devnet endpoint/);
  });

  it("still refuses an insecure scheme", async () => {
    await expect(
      loadWith({ NEXT_PUBLIC_BASE_RPC: "http://rpc.magicblock.app/devnet" }),
    ).rejects.toThrow(/must start with/);
  });
});
