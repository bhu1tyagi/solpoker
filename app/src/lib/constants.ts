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

export const FAUCET_AMOUNT = 10_000;
export const FAUCET_COOLDOWN_SECS = 24 * 60 * 60;

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
};

/** What to show a player when one of these comes back. */
export const ERROR_MESSAGES: Record<string, string> = {
  FaucetOnCooldown: "You already claimed chips today. Try again tomorrow.",
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
