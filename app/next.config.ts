import type { NextConfig } from "next";

// Read straight from the environment rather than importing src/lib/constants.
// That module pulls in @solana/web3.js, and the Next config is loaded by plain
// Node before any of that is needed. The defaults are the same ones the client
// falls back to; if they ever drift, the CSP is too tight rather than too
// loose, which fails visibly in the browser console instead of silently
// allowing a host it should not.
// Resolved the same way src/lib/constants.ts resolves them: the cluster picks
// the defaults, an explicit env var overrides. The CSP must allowlist exactly
// what the client will dial; these fell out of step the day mainnet arrived,
// and the first mainnet hand died on a devnet-only connect-src — every TEE
// auth call refused by the browser, so the table never delegated.
const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER === "mainnet" ? "mainnet" : "devnet";
const CLUSTER_DEFAULTS = {
  devnet: {
    base: "https://rpc.magicblock.app/devnet",
    tee: "https://devnet-tee.magicblock.app",
    ws: "wss://devnet-tee.magicblock.app",
  },
  mainnet: {
    base: "https://rpc.magicblock.app/mainnet",
    tee: "https://mainnet-tee.magicblock.app",
    ws: "wss://mainnet-tee.magicblock.app",
  },
}[CLUSTER];
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC ?? CLUSTER_DEFAULTS.base;
const TEE_URL = process.env.NEXT_PUBLIC_TEE_URL ?? CLUSTER_DEFAULTS.tee;
const TEE_WS = process.env.NEXT_PUBLIC_TEE_WS ?? CLUSTER_DEFAULTS.ws;

/**
 * Content Security Policy.
 *
 * This origin holds two credentials in browser storage: a session key that can
 * sign bets, and a TEE auth token that reads hole cards. Without a CSP, one
 * injected script — a compromised npm dependency, a bad extension — reads both
 * and plays the rest of the table's hands with perfect information. A CSP is
 * what keeps a single script-injection bug from being a total compromise.
 *
 * `connect-src` is an allowlist rather than `*` on purpose: it is the control
 * that stops an injected script from posting a stolen token anywhere. It has to
 * name the two chains this app actually talks to, which is why it is built from
 * the same constants the client connects with rather than written out twice.
 *
 * `'unsafe-inline'` for styles is unavoidable: the app styles almost everything
 * with inline `style` props, and wallet-adapter ships its own. Scripts do not
 * get the same latitude — `'unsafe-eval'` is deliberately absent, which is also
 * what `webpack`'s `crypto: false` fallback below makes safe to do.
 */
function contentSecurityPolicy(dev: boolean): string {
  const rpc = [BASE_RPC, TEE_URL, TEE_WS].map((u) => new URL(u).origin);
  // The websocket origins are the same hosts over ws(s), and web3.js derives
  // the base-layer socket from the http endpoint, so both schemes are needed.
  const sockets = [BASE_RPC, TEE_URL, TEE_WS].map(
    (u) => `wss://${new URL(u).host}`,
  );
  const connect = Array.from(new Set([...rpc, ...sockets, "'self'"])).join(" ");

  return [
    "default-src 'self'",
    // Next's runtime needs inline bootstrap scripts. Nothing in a production
    // build needs `eval` — but React Fast Refresh compiles every hot-reloaded
    // module with it, so `next dev` white-screens without it: main-app.js
    // throws an EvalError before React ever mounts. Allowing it in development
    // only keeps the dev loop working and keeps the shipped policy tight, which
    // is the one that matters. Check this against `next start`, not `next dev`.
    dev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    // Google Fonts is here for exactly one reason: wallet-adapter's own
    // stylesheet opens with `@import url('https://fonts.googleapis.com/...')`
    // for DM Sans, which the wallet modal uses. This app's own faces are
    // self-hosted through next/font. Allowing a stylesheet and a font file
    // cannot exfiltrate anything — `connect-src` is what governs where a
    // stolen token could be sent — so the cost is a third-party request, not a
    // hole in the credential story.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connect}`,
    // Nothing here is ever legitimately framed, and the action buttons sign
    // real money with no confirmation, so clickjacking is a live concern.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function securityHeaders(dev: boolean) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    // Belt and braces with frame-ancestors, for anything that predates CSP 2.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // The TEE token rides in a URL query string. Referrer-Policy is what stops
    // that URL being handed to any other origin the page happens to reach.
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    // Deliberately not sent in development. HSTS is scoped to a host, and
    // `localhost` is shared with every other project on this machine, so
    // pinning it to https here would break their plain-http dev servers too.
    ...(dev
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]),
  ];
}

const nextConfig: NextConfig = {
  async headers() {
    const dev = process.env.NODE_ENV === "development";
    return [{ source: "/:path*", headers: securityHeaders(dev) }];
  },
  // The attestation check pulls @phala/dcap-qvl, which is CJS and stubs out node
  // built-ins for browsers. Keeping it server-side means it never has to bundle.
  serverExternalPackages: [
    "@phala/dcap-qvl",
    "@magicblock-labs/ephemeral-rollups-sdk",
  ],
  webpack: (config) => {
    // web3.js v1 and its deps reference node built-ins that the browser does not
    // need. Without this they resolve to nothing and the build fails.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
      crypto: false,
    };
    // The websocket library asks for two optional native speedups. They are not
    // installed, and it works fine without them, but the bundler still tries to
    // resolve the require and fails on the empty package directories.
    config.resolve.alias = {
      ...config.resolve.alias,
      bufferutil: false,
      "utf-8-validate": false,
    };
    return config;
  },
};

export default nextConfig;
