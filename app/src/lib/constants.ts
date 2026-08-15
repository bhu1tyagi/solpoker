import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "CJT1DDJe5cFsSVcwTAWr3wEo7QEqNjrXwmWkw1pdxmJd",
);

export const BASE_RPC =
  process.env.NEXT_PUBLIC_BASE_RPC ?? "https://rpc.magicblock.app/devnet";
export const TEE_URL =
  process.env.NEXT_PUBLIC_TEE_URL ?? "https://devnet-tee.magicblock.app";
export const TEE_WS =
  process.env.NEXT_PUBLIC_TEE_WS ?? "wss://devnet-tee.magicblock.app";

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
export const SESSION_PROGRAM = new PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
);

export const MAX_SEATS = 6;
export const NO_SEAT = 0xff;
export const NO_CARD = 0xff;

/**
 * The fixed price of one chip, matching the program. 10,000 chips cost
 * 0.01 SOL. Chips are backed one to one by lamports in the program vault:
 * they exist only because someone paid this rate, and selling pays it back.
 */
export const LAMPORTS_PER_CHIP = 1_000;
export const CHIPS_PER_SOL = 1_000_000_000 / LAMPORTS_PER_CHIP;

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
export const DECK_ACCOUNT_SIZE = 8 + 32 + 52 + 1 + 32 + 32 + 1 + 1;

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
  InsufficientChips: "Not enough chips for that.",
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
]);
