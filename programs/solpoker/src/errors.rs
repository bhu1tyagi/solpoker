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
}
