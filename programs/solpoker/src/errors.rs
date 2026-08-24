use anchor_lang::prelude::*;

#[error_code]
pub enum PokerError {
    #[msg("Faucet is still on cooldown")]
    FaucetOnCooldown,
    #[msg("Not enough chips")]
    InsufficientChips,
    #[msg("Buy-in is outside the table's limits")]
    BuyInOutOfRange,
    #[msg("Seat index is out of range for this table")]
    SeatIndexOutOfRange,
    #[msg("That seat is already taken")]
    SeatOccupied,
    #[msg("That seat is empty")]
    SeatEmpty,
    #[msg("You are not seated at this table")]
    NotSeated,
    #[msg("You are already seated at this table")]
    AlreadySeated,
    #[msg("Cannot do that while a hand is in progress")]
    HandInProgress,
    #[msg("No hand is in progress")]
    NoHandInProgress,
    #[msg("Need at least two funded players to start a hand")]
    NotEnoughPlayers,
    #[msg("It is not your turn to act")]
    OutOfTurn,
    #[msg("That action is not legal right now")]
    IllegalAction,
    #[msg("Cannot check while facing a bet")]
    CannotCheck,
    #[msg("Nothing to call")]
    NothingToCall,
    #[msg("Raising is not allowed here")]
    CannotRaise,
    #[msg("Raise does not exceed the current bet")]
    RaiseTooSmall,
    #[msg("Raise is below the minimum raise and is not an all-in")]
    BelowMinRaise,
    #[msg("Betting is still open on this street")]
    StreetNotComplete,
    #[msg("The betting street is already complete")]
    StreetComplete,
    #[msg("The deck has run out of cards")]
    DeckExhausted,
    #[msg("The action clock has not expired yet")]
    DeadlineNotReached,
    #[msg("Settlement left unclaimed chips, which should be impossible")]
    UnclaimedChips,
    #[msg("Seat account does not belong to this table")]
    SeatTableMismatch,
    #[msg("Seat accounts were supplied in the wrong order")]
    SeatOrderMismatch,
    #[msg("This table's accounts are already delegated")]
    AlreadyDelegated,
    #[msg("This table's accounts are not delegated")]
    NotDelegated,
    #[msg("Hand number does not match the table")]
    HandNumberMismatch,
    #[msg("No salt commitment for this seat")]
    SaltNotCommitted,
    #[msg("Revealed salt does not match the commitment")]
    SaltMismatch,
    #[msg("Shuffle randomness was already requested")]
    ShuffleAlreadyRequested,
    #[msg("No shuffle request is outstanding")]
    NoShuffleRequested,
    #[msg("Need at least two revealed salts")]
    NotEnoughSalts,
    #[msg("Shuffle seed is not ready yet")]
    ShuffleNotReady,
    #[msg("Only the player who created this table can do that")]
    NotTableCreator,
    #[msg("Every seat must be empty before the table can be closed")]
    TableNotEmpty,
    #[msg("Only the creator can delete a table until it has sat empty for an hour")]
    TableNotAbandoned,
    #[msg("The vault cannot cover that sale")]
    InsufficientVault,
    // Appended rather than inserted: Anchor numbers these in declaration order,
    // so adding anywhere but the end would renumber every error after it and
    // break clients that map codes to messages.
    #[msg("That config account belongs to a different table")]
    ConfigTableMismatch,
    #[msg("Cards are not locked down yet; the table must be secured before a hand can start")]
    CardsNotSecured,
    #[msg("Salts are already being revealed, so commitments are closed")]
    SaltCommitClosed,
    #[msg("A table's turn clock must be between 10 and 300 seconds")]
    TimeoutOutOfRange,
    #[msg("The outstanding shuffle request is not stale enough to clear yet")]
    ShuffleNotStale,
    #[msg("That account belongs to a different table")]
    TableMismatch,
    #[msg("This rollup is not the pinned TEE validator")]
    ValidatorNotPinned,
    #[msg("That is not the USDC this program accepts")]
    WrongMint,
    #[msg("Only the treasury authority can do that")]
    NotTreasuryAuthority,
    #[msg("Not enough USDC in the wallet for that purchase")]
    InsufficientUsdc,
}
