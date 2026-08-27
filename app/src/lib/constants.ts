import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker",
);

/**
 * Reject an endpoint that would put a credential on the wire in cleartext.
 *
 * The TEE auth token rides in the query string of both the http and websocket
 * URLs, and that token is what reads hole cards. A deployer who typos `http://`
 * into their Vercel config would hand it to every hop in between, and the app
 * would look like it was working. Failing at module load is loud and immediate;
 * silently downgrading is not something a poker client should ever do.
 */
function secureEndpoint(
  value: string | undefined,
  fallback: string,
  name: string,
  allowed: readonly string[],
): string {
  const url = value ?? fallback;
  if (!allowed.some((scheme) => url.startsWith(scheme))) {
    throw new Error(
      `${name} must start with ${allowed.join(" or ")}, got "${url}". ` +
        `Credentials travel in this URL, so an insecure scheme is refused rather than downgraded.`,
    );
  }
  return url;
}

/**
 * Which chain this build talks to.
 *
 * Every endpoint below derives from this, so a deployment picks a cluster once
 * rather than setting three URLs consistently and hoping. Defaulting to devnet
 * is the safe direction: the failure of a missing variable is play money, not
 * real money.
 */
export type Cluster = "devnet" | "mainnet";

export const CLUSTER: Cluster =
  process.env.NEXT_PUBLIC_CLUSTER === "mainnet" ? "mainnet" : "devnet";

/**
 * MagicBlock's endpoints per cluster.
 *
 * The TEE validator identity is deliberately absent: it is the same key on both
 * clusters (`MTEWGuqx…`, pinned in the program as `TEE_VALIDATOR`), and only
 * the host differs. Getting the cluster wrong therefore shows up as talking to
 * the wrong chain, not as a delegation failure.
 */
const ENDPOINTS: Record<Cluster, { base: string; tee: string; ws: string }> = {
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
};

const DEFAULTS = ENDPOINTS[CLUSTER];

/**
 * Refuse a build that says mainnet and points somewhere else.
 *
 * A real-money deployment with one stale override — a `NEXT_PUBLIC_TEE_URL`
 * left over from devnet in a Vercel project — would look completely healthy
 * and be talking to the wrong chain, or worse, be reading hole cards from a
 * validator the mainnet program never delegated to. There is no honest way to
 * carry on from that, so it fails at module load.
 */
function assertClusterMatch(url: string, name: string) {
  if (CLUSTER === "mainnet") {
    if (/devnet/i.test(url)) {
      throw new Error(
        `${name} is "${url}", which is a devnet endpoint, but NEXT_PUBLIC_CLUSTER is "mainnet". ` +
          `Real funds are involved, so this is refused rather than guessed at.`,
      );
    }
    return;
  }
  // And the mirror image, which is not harmless either. A mainnet RPC left in
  // a devnet build reads every balance off the wrong chain and reports them as
  // zero — a wallet with money looks empty, the deposit button greys out, and
  // nothing anywhere says why. That cost two gate runs to find, so it fails
  // loudly now instead.
  if (/mainnet/i.test(url)) {
    throw new Error(
      `${name} is "${url}", which is a mainnet endpoint, but NEXT_PUBLIC_CLUSTER is "devnet". ` +
        `Every balance would be read from the wrong chain, so this is refused.`,
    );
  }
}

function endpoint(
  value: string | undefined,
  fallback: string,
  name: string,
  allowed: readonly string[],
): string {
  const url = secureEndpoint(value, fallback, name, allowed);
  assertClusterMatch(url, name);
  return url;
}

export const BASE_RPC = endpoint(
  process.env.NEXT_PUBLIC_BASE_RPC,
  DEFAULTS.base,
  "NEXT_PUBLIC_BASE_RPC",
  ["https://"],
);
export const TEE_URL = endpoint(
  process.env.NEXT_PUBLIC_TEE_URL,
  DEFAULTS.tee,
  "NEXT_PUBLIC_TEE_URL",
  ["https://"],
);
export const TEE_WS = endpoint(
  process.env.NEXT_PUBLIC_TEE_WS,
  DEFAULTS.ws,
  "NEXT_PUBLIC_TEE_WS",
  ["wss://"],
);

/**
 * The validator is pinned rather than left to float. A table that landed on a
 * different rollup between hands would be a different table.
 */
export const VALIDATOR = new PublicKey(
  "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);
/** The delegated queue, since the request is made from inside the rollup. */
export const ORACLE_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);
export const PERMISSION_PROGRAM = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
);
export const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const MAGIC_PROGRAM = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
export const EPHEMERAL_VAULT = new PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);
/**
 * The house's own wallet. Its `Player` account is where rake lands, and it
 * cashes out through the same `sell_chips` everyone else uses. Must match
 * `TREASURY_AUTHORITY` in the program, which is the only account `sweep_rake`
 * will credit.
 */
export const TREASURY_AUTHORITY = new PublicKey(
  "FWRvqaezac9noSy2WsPSNoZZs2Vc2peA4TRLkjziS7Vq",
);

export const SESSION_PROGRAM = new PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
);

export const MAX_SEATS = 6;
export const NO_SEAT = 0xff;
export const NO_CARD = 0xff;

/**
 * The fixed price of one chip, matching `MICRO_USDC_PER_CHIP` in the program:
 * one cent, in USDC's six-decimal base units. Chips are backed one to one by
 * USDC in the program vault — they exist only because someone paid this rate,
 * and selling pays it back.
 *
 * This number and the program's must move together or the client will quote
 * prices the chain does not honour.
 */
export const MICRO_USDC_PER_CHIP = 10_000;

/** USDC's decimals, on both clusters. */
export const USDC_DECIMALS = 6;

/**
 * The mint chips are bought with, per cluster.
 *
 * Mainnet is Circle's USDC. Devnet is a test mint we created and then threw the
 * keypair away, so it can never be brought into existence on mainnet; the
 * program hardcodes both and refuses everything else, because opening a token
 * account is permissionless and a mint anyone can print is a mint anyone can
 * pay with.
 */
export const USDC_MINT = new PublicKey(
  CLUSTER === "mainnet"
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "CzZoUHtyZkarrnRbsjPVEge6UANgCYrq8Bb8ambjjTxq",
);

/**
 * SOL a wallet needs on hand to transact at all: a few signatures, and the
 * rent for a token account if the wallet has never held USDC before.
 *
 * USDC is what a chip is made of, but SOL is still what a transaction costs,
 * and a wallet holding only USDC can afford chips it cannot actually buy. The
 * buy button says so rather than failing at signing time.
 */
export const GAS_FLOOR_LAMPORTS = 3_000_000;

/**
 * SOL a wallet needs to actually sit down and play, as opposed to merely buy
 * chips. The session key's float dominates it: 0.012 for the key, ~0.002 for
 * its token account, and the rest is fees and a little slack.
 *
 * The float used to be 0.05, which was set when this was a devnet toy and
 * nobody counted. On mainnet it meant parking more SOL than a Micro buy-in was
 * worth — money that came back, but only after someone watched their wallet
 * drop and wondered what had taken it. Measured against two real games, a
 * session spends about 0.0024 SOL; 0.012 covers a long night.
 *
 * Kept separate from the floor above because they answer different questions,
 * and conflating them fails in both directions: a wallet with 0.01 SOL can
 * genuinely buy chips, and blocking that would be wrong — but letting it buy
 * chips and then discover at the table that it cannot play is worse, so the
 * deposit sheet quotes this number.
 *
 * Only as much slack as the next transaction needs. This sat at 0.06 and
 * nagged a wallet holding 0.0599 that could in fact have played, which is its
 * own kind of wrong: a warning that fires when nothing is wrong teaches people
 * to ignore warnings.
 *
 * Raised from 0.018 when delegation rent was finally measured on mainnet, and
 * again when the first measurement turned out to be half the bill. Starting a
 * table has the session key front buffer rent for every account it moves to
 * the rollup — 9.2M lamports for the table, hand and deck together, plus 6.4M
 * per seat, and it moves all six seats whether or not anyone is in them,
 * because the rollup refuses to run a hand unless every account it might
 * touch is there. That is ~48M for a start, and startTable tops the key up to
 * it from the wallet before delegating. The old floor left a wallet able to
 * authorise a session and then unable to start the game it had just sat down
 * to, failing three CPIs deep as `custom program error: 0x1`. The rent is
 * refunded when the table returns to Solana, so this parks SOL rather than
 * spending it.
 */
export const PLAY_FLOOR_LAMPORTS = 60_000_000;

/**
 * SOL the creator of a table needs before starting.
 *
 * Building a table is thirteen accounts — the table, its config and history,
 * six seats, six hole slots — plus the pre-funding each hole and the deck need
 * for their rollup permission. Far more than joining one costs, and paid once
 * by whoever opens the room.
 *
 * Checked before the wallet is ever asked to sign, because creation is three
 * transactions and the third one is the expensive one. A wallet that runs out
 * between them leaves a table with seats and no card slots: it appears in the
 * lobby, accepts players, and can never deal. That happened on mainnet, and
 * two people sat at that table for three hours waiting for a hand that could
 * not come.
 */
export const CREATE_TABLE_LAMPORTS = 45_000_000;

/**
 * USDC the onboarding gate treats as "funded", in base units: the Micro
 * table's minimum buy-in. Less than this can buy chips but cannot sit
 * anywhere, so prompting for a deposit below it would declare a wallet ready
 * for a room it cannot enter.
 */
export const ONBOARD_FLOOR_MICRO_USDC = 4_000_000;

/** Salt protocol states, on Seat. */
export const SALT_NONE = 0;
export const SALT_COMMITTED = 1;
export const SALT_REVEALED = 2;

/** Shuffle states, on Hand. */
export const SHUFFLE_IDLE = 0;
export const SHUFFLE_REQUESTED = 1;
export const SHUFFLE_FULFILLED = 2;

export const STREET_NAMES = ["preflop", "flop", "turn", "river", "showdown"];

/**
 * Every delegated account gets 10 free commits, so settling to Solana after
 * each hand would run out in ten. Play at rollup speed, settle on a cadence.
 */
export const COMMIT_EVERY = 25;

/**
 * Raw byte offsets used for reads that skip Anchor's decoder, either because
 * the account is permission-restricted or because we only want two bytes.
 */
export const OFFSETS = {
  holeHandNumber: 41,
  holeCards: 49,
};

/**
 * The current on-chain size of a Deck account.
 *
 * Tables created by an older build have a shorter deck and cannot be played by
 * this program, because the account no longer deserializes. Comparing the size
 * is how the client spots one before offering a game that would only fail.
 */
export const DECK_ACCOUNT_SIZE =
  8 + // discriminator
  32 + // table
  52 + // cards
  1 + // next_index
  32 + // vrf_randomness (the board's draw, published at settlement)
  32 + // shuffle_seed
  32 + // hole_randomness (never published)
  5 + // board, held privately until each street reveals it
  1 + // shuffle_state
  1 + // fulfilled_mask
  1 + // bump
  1; // secured

/**
 * How long a table must sit empty before anyone may sweep it away.
 *
 * Solana has no timers, so an abandoned table cannot delete itself. What
 * happens instead is that any client may remove one once it has been empty
 * this long, and the lobby does so in the background, which comes to the same
 * thing from a player's side.
 */
export const ABANDONED_AFTER_SECS = 60 * 60;

/**
 * Anchor's own error codes. Without these a layout mismatch surfaces to a
 * player as "Custom":3003, which tells them nothing at all.
 */
export const ANCHOR_ERRORS: Record<number, string> = {
  2006: "ConstraintSeeds",
  3001: "AccountDiscriminatorNotFound",
  3002: "AccountDiscriminatorMismatch",
  3003: "AccountDidNotDeserialize",
  3004: "AccountDidNotSerialize",
  3007: "AccountOwnedByWrongProgram",
  3012: "AccountNotInitialized",
};

/** Program error names by code, for turning a failed transaction into English. */
export const ERROR_NAMES: Record<number, string> = {
  6000: "FaucetOnCooldown",
  6001: "InsufficientChips",
  6002: "BuyInOutOfRange",
  6003: "SeatIndexOutOfRange",
  6004: "SeatOccupied",
  6005: "SeatEmpty",
  6006: "NotSeated",
  6007: "AlreadySeated",
  6008: "HandInProgress",
  6009: "NoHandInProgress",
  6010: "NotEnoughPlayers",
  6011: "OutOfTurn",
  6012: "IllegalAction",
  6013: "CannotCheck",
  6014: "NothingToCall",
  6015: "CannotRaise",
  6016: "RaiseTooSmall",
  6017: "BelowMinRaise",
  6018: "StreetNotComplete",
  6019: "StreetComplete",
  6020: "DeckExhausted",
  6021: "DeadlineNotReached",
  6022: "UnclaimedChips",
  6023: "SeatTableMismatch",
  6024: "SeatOrderMismatch",
  6025: "AlreadyDelegated",
  6026: "NotDelegated",
  6027: "HandNumberMismatch",
  6028: "SaltNotCommitted",
  6029: "SaltMismatch",
  6030: "ShuffleAlreadyRequested",
  6031: "NoShuffleRequested",
  6032: "NotEnoughSalts",
  6033: "ShuffleNotReady",
  6034: "NotTableCreator",
  6035: "TableNotEmpty",
  6036: "TableNotAbandoned",
  6037: "InsufficientVault",
  6038: "ConfigTableMismatch",
  6039: "CardsNotSecured",
  6040: "SaltCommitClosed",
  6041: "TimeoutOutOfRange",
  6042: "ShuffleNotStale",
  6043: "TableMismatch",
  6044: "ValidatorNotPinned",
  6045: "WrongMint",
  6046: "NotTreasuryAuthority",
  6047: "InsufficientUsdc",
};

/** What to show a player when one of these comes back. */
export const ERROR_MESSAGES: Record<string, string> = {
  AccountDidNotDeserialize:
    "This table was created by an older version of the game and cannot be played. Pause it, cash out, and create a new table.",
  AccountDiscriminatorMismatch:
    "This table's accounts do not match the current game. Create a new table.",
  AccountNotInitialized:
    "Part of this table is missing on chain. Create a new table.",
  ConstraintSeeds: "An account address did not match what the program expected.",
  NotTableCreator: "Only the player who created this table can delete it.",
  TableNotEmpty: "Everyone has to leave the table before it can be deleted.",
  TableNotAbandoned:
    "Only the creator can delete this table until it has sat empty for an hour.",
  InsufficientVault:
    "The vault cannot cover that sale right now. This should not happen, please report it.",
  WrongMint: "That is not the USDC this game accepts.",
  InsufficientUsdc: "Not enough USDC in your wallet for that.",
  NotTreasuryAuthority: "Only the house can do that.",
  InsufficientChips: "Not enough chips for that.",
  ConfigTableMismatch:
    "That action carried the settings of a different table and was refused. An honest client never does this, so if you are seeing it, report it.",
  CardsNotSecured:
    "This table's cards are not locked down yet. Wait a moment; the hand will not start until they are.",
  TimeoutOutOfRange:
    "A table's turn clock has to be between 10 and 300 seconds.",
  TableMismatch:
    "That action carried an account belonging to a different table and was refused. An honest client never does this, so if you are seeing it, report it.",
  ValidatorNotPinned:
    "This table would have been sent to the wrong rollup, so it was refused. Cards are only private on the pinned TEE validator.",
  // Raised by the session key program, not this one. Its numbers overlap ours,
  // so these are matched by name.
  InvalidToken: "Your session key is no longer valid. Authorise a new one.",
  NoToken: "Your session key is missing. Authorise a new one.",
  InvalidAuthority: "That session key belongs to a different wallet.",
  ValidityTooLong: "That session would last too long.",
  BuyInOutOfRange: "That buy-in is outside the table limits.",
  SeatOccupied: "Someone took that seat first.",
  NotSeated: "You are not seated at this table.",
  AlreadySeated: "You are already seated here.",
  HandInProgress: "Wait for the current hand to finish.",
  OutOfTurn: "It is not your turn.",
  CannotCheck: "You cannot check facing a bet.",
  NothingToCall: "There is nothing to call.",
  RaiseTooSmall: "That raise does not beat the current bet.",
  BelowMinRaise: "That is below the minimum raise.",
  NotEnoughPlayers: "Need at least two players with chips.",
  SaltMismatch: "Your salt did not match its commitment. Sit out this hand.",
  UnclaimedChips: "Settlement failed. This should not happen, please report it.",
};

/**
 * Errors that mean another client got there first. Every shared step is
 * something any player may do, so losing the race is the normal case and must
 * not surface as a failure.
 */
export const RACE_LOST = new Set([
  "HandInProgress",
  "NoHandInProgress",
  "NotEnoughPlayers",
  "StreetNotComplete",
  "StreetComplete",
  "DeadlineNotReached",
  "SaltNotCommitted",
  "ShuffleAlreadyRequested",
  "NoShuffleRequested",
  "NotEnoughSalts",
  "ShuffleNotReady",
  "OutOfTurn",
  // The table is delegated but not locked down yet. Every client cranks
  // start_hand on a cadence, and the program now refuses until secure_deck and
  // secure_hole have run, so this is the same "not yet, try again" state as
  // ShuffleNotReady rather than anything a player should read about.
  "CardsNotSecured",
  // Someone else revealed first, which closes commitments. The client's own
  // retry loop can hit this benignly.
  "SaltCommitClosed",
  // The stale-shuffle escape hatch is permissionless and time-gated, so every
  // client tries it and all but one are early or late. Neither is a failure.
  "ShuffleNotStale",
  "NoShuffleRequested",
]);
