/**
 * A wallet-standard wallet backed by a keypair held outside the page.
 *
 * Injected before any app code runs so wallet-adapter discovers it the same way
 * it discovers Phantom. Signing is delegated to the harness through an exposed
 * binding, so the secret key never enters the page and the app takes exactly
 * the path it takes with a real extension.
 *
 * This exists so the UI itself can be tested end to end. Driving a real browser
 * extension from a test is not practical, and asserting on modules alone was
 * how a broken table page shipped once already.
 */
(() => {
  const address = window.__TEST_WALLET_ADDRESS__;
  const publicKeyBytes = Uint8Array.from(window.__TEST_WALLET_PUBKEY_BYTES__);
  const CHAIN = "solana:devnet";

  const account = {
    address,
    publicKey: publicKeyBytes,
    chains: [CHAIN],
    features: ["solana:signTransaction", "solana:signMessage"],
    label: "Test wallet",
    icon: undefined,
  };

  const listeners = {};
  const emit = (event, ...args) =>
    (listeners[event] ?? []).forEach((l) => l.apply(null, args));

  const wallet = {
    version: "1.0.0",
    name: "Test Wallet",
    // A 1x1 transparent gif; wallet-adapter requires an icon data URI.
    icon: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    chains: [CHAIN],
    accounts: [account],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts: [account] }),
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {},
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(listener);
          return () => {
            listeners[event] = listeners[event].filter((l) => l !== listener);
          };
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) =>
          Promise.all(
            inputs.map(async (input) => ({
              signedTransaction: Uint8Array.from(
                await window.__testSignTransaction(Array.from(input.transaction)),
              ),
            })),
          ),
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) =>
          Promise.all(
            inputs.map(async (input) => ({
              signedMessage: input.message,
              signature: Uint8Array.from(
                await window.__testSignMessage(Array.from(input.message)),
              ),
            })),
          ),
      },
    },
  };

  const register = (api) => api.register(wallet);
  // Both halves of the handshake: announce ourselves, and answer apps that
  // start listening after we load.
  window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
  window.dispatchEvent(
    new CustomEvent("wallet-standard:register-wallet", { detail: register }),
  );
  void emit;
})();
