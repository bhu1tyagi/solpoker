//! Betting round state machine.
//!
//! Models one hand's worth of betting: blinds, action order, the legal action set
//! at every point, min-raise sizing, and all-in handling.
//!
//! Two rules here are worth calling out because they are where poker
//! implementations usually go wrong.
//!
//! **Action order.** Preflop, action starts left of the big blind. Postflop it
//! starts left of the button. Heads-up looks like a special case, the button
//! posts the small blind and acts first preflop, then acts *last* postflop, but
//! it falls out of the same two rules with no special casing, because with two
//! players "left of the big blind" *is* the button.
//!
//! **An all-in for less than a full raise does not reopen the betting.** If a
//! player shoves for more than the current bet but less than a full raise
//! increment, opponents who have already acted owe the difference but may only
//! call or fold, they cannot re-raise. Players who had not yet acted keep full
//! rights. This is tracked per seat with [`SeatState::may_raise`], which is why a
//! single "has acted" flag is not enough.

use crate::MAX_SEATS;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Street {
    PreFlop,
    Flop,
    Turn,
    River,
    Showdown,
}

impl Street {
    pub fn next(self) -> Street {
        match self {
            Street::PreFlop => Street::Flop,
            Street::Flop => Street::Turn,
            Street::Turn => Street::River,
            Street::River | Street::Showdown => Street::Showdown,
        }
    }

    /// How many board cards are face up on this street.
    pub fn board_len(self) -> usize {
        match self {
            Street::PreFlop => 0,
            Street::Flop => 3,
            Street::Turn => 4,
            Street::River | Street::Showdown => 5,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    Fold,
    Check,
    Call,
    /// Raise the street's total commitment to this many chips. Also used for an
    /// opening bet, where the current bet is zero.
    RaiseTo(u64),
    /// Commit the entire remaining stack. Resolves to an all-in call or an
    /// all-in raise depending on the current bet.
    AllIn,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BettingError {
    /// Betting is finished for this street, or the hand is over.
    NoActionPending,
    /// This seat is not the one to act.
    OutOfTurn,
    /// Seat is empty, folded, or already all-in.
    SeatNotActive,
    /// Cannot check while facing a bet.
    CannotCheck,
    /// Cannot call with nothing to call, check instead.
    NothingToCall,
    /// Raising is not allowed here, either because the seat is capped after an
    /// under-raise all-in or because it has no chips behind.
    CannotRaise,
    /// Raise target does not exceed the current bet.
    RaiseTooSmall,
    /// Raise target is below the minimum raise and is not an all-in.
    BelowMinRaise,
    /// Raise target exceeds the seat's stack.
    InsufficientChips,
    /// Fewer than two funded players.
    NotEnoughPlayers,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct SeatState {
    pub occupied: bool,
    /// Chips still behind.
    pub stack: u64,
    /// Chips pushed forward on the current street.
    pub street_committed: u64,
    /// Chips pushed forward across the whole hand. Drives pot construction.
    pub total_committed: u64,
    pub folded: bool,
    pub all_in: bool,
    /// Still owes an action this street.
    pub needs_action: bool,
    /// May raise if it acts. Cleared by an under-raise all-in for seats that had
    /// already acted.
    pub may_raise: bool,
}

impl SeatState {
    /// Seated, live, and still able to make decisions.
    pub fn is_active(&self) -> bool {
        self.occupied && !self.folded && !self.all_in
    }

    /// Seated and still contesting the pot, whether or not it can act.
    pub fn is_in_hand(&self) -> bool {
        self.occupied && !self.folded
    }
}

/// What a seat may legally do right now. Shaped for direct use by a UI.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct LegalActions {
    pub can_fold: bool,
    pub can_check: bool,
    pub can_call: bool,
    /// Chips needed to call. Capped at the stack, so this is the all-in amount
    /// when the seat cannot cover the bet.
    pub call_amount: u64,
    pub can_raise: bool,
    /// Smallest legal raise target. Equals `max_raise_to` when the only legal
    /// raise is an all-in for less than a full increment.
    pub min_raise_to: u64,
    /// Largest legal raise target, i.e. the all-in amount.
    pub max_raise_to: u64,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Betting {
    pub seats: [SeatState; MAX_SEATS],
    pub button: usize,
    pub street: Street,
    /// Seat to act, or `None` when the street is complete or the hand is over.
    pub to_act: Option<usize>,
    /// Highest street commitment anyone must match.
    pub current_bet: u64,
    /// Minimum raise *increment* over the current bet.
    pub min_raise: u64,
    pub small_blind: u64,
    pub big_blind: u64,
    /// Last seat to make a full raise, for showdown reveal order.
    pub last_aggressor: Option<usize>,
}

impl Betting {
    /// Start a hand: reset seat state, post blinds, and set the first actor.
    ///
    /// `stacks[i] > 0` marks seat `i` as occupied.
    pub fn begin_hand(
        stacks: [u64; MAX_SEATS],
        button: usize,
        small_blind: u64,
        big_blind: u64,
    ) -> Result<Betting, BettingError> {
        let mut seats = [SeatState::default(); MAX_SEATS];
        for (i, &s) in stacks.iter().enumerate() {
            if s > 0 {
                seats[i] = SeatState {
                    occupied: true,
                    stack: s,
                    needs_action: true,
                    may_raise: true,
                    ..Default::default()
                };
            }
        }
        if seats.iter().filter(|s| s.occupied).count() < 2 {
            return Err(BettingError::NotEnoughPlayers);
        }

        let mut b = Betting {
            seats,
            button: button % MAX_SEATS,
            street: Street::PreFlop,
            to_act: None,
            current_bet: big_blind,
            min_raise: big_blind,
            small_blind,
            big_blind,
            last_aggressor: None,
        };

        // Heads-up: the button posts the small blind. With three or more, the
        // small blind is left of the button. Both are "next occupied seat after
        // the button, starting from the button itself when heads-up".
        let occupied = b.occupied_count();
        let sb_seat = if occupied == 2 {
            b.button
        } else {
            b.next_occupied(b.button)
        };
        let bb_seat = b.next_occupied(sb_seat);

        b.post_blind(sb_seat, small_blind);
        b.post_blind(bb_seat, big_blind);

        // First to act is left of the big blind, which is the button heads-up.
        b.to_act = b.find_next_actor(bb_seat);
        b.settle_if_no_action();
        Ok(b)
    }

    fn occupied_count(&self) -> usize {
        self.seats.iter().filter(|s| s.occupied).count()
    }

    /// Next occupied seat strictly after `from`, wrapping.
    fn next_occupied(&self, from: usize) -> usize {
        for step in 1..=MAX_SEATS {
            let i = (from + step) % MAX_SEATS;
            if self.seats[i].occupied {
                return i;
            }
        }
        from
    }

    /// Post a blind, going all-in if the stack cannot cover it.
    fn post_blind(&mut self, seat: usize, amount: u64) {
        let s = &mut self.seats[seat];
        let paid = amount.min(s.stack);
        s.stack -= paid;
        s.street_committed += paid;
        s.total_committed += paid;
        if s.stack == 0 {
            s.all_in = true;
            s.needs_action = false;
        }
    }

    /// Next seat after `from` that is active and still owes an action.
    fn find_next_actor(&self, from: usize) -> Option<usize> {
        for step in 1..=MAX_SEATS {
            let i = (from + step) % MAX_SEATS;
            let s = &self.seats[i];
            if s.is_active() && s.needs_action {
                return Some(i);
            }
        }
        None
    }

    /// Only one player left holding cards, everyone else folded.
    pub fn hand_is_over(&self) -> bool {
        self.seats.iter().filter(|s| s.is_in_hand()).count() <= 1
    }

    /// Nobody can act any more this street.
    pub fn street_is_complete(&self) -> bool {
        self.to_act.is_none()
    }

    /// Every remaining player is all-in, so the rest of the board just runs out.
    pub fn all_remaining_are_all_in(&self) -> bool {
        self.seats.iter().filter(|s| s.is_active()).count() <= 1
            && self.seats.iter().filter(|s| s.is_in_hand()).count() >= 2
    }

    /// Chips committed by every seat this hand, for pot construction.
    pub fn contributions(&self) -> [u64; MAX_SEATS] {
        let mut out = [0u64; MAX_SEATS];
        for (i, s) in self.seats.iter().enumerate() {
            out[i] = s.total_committed;
        }
        out
    }

    /// Seats that have folded, for pot eligibility.
    pub fn folded(&self) -> [bool; MAX_SEATS] {
        let mut out = [false; MAX_SEATS];
        for (i, s) in self.seats.iter().enumerate() {
            out[i] = s.folded;
        }
        out
    }

    /// Total chips in the middle across all streets.
    pub fn pot_total(&self) -> u64 {
        self.seats.iter().map(|s| s.total_committed).sum()
    }

    /// Clear `to_act` when the hand is decided or the street has run out of
    /// actors. A lone active player with nothing to call has no decision left.
    fn settle_if_no_action(&mut self) {
        if self.hand_is_over() {
            self.to_act = None;
            return;
        }
        if let Some(seat) = self.to_act {
            // A player who is the only one left able to act, and who already
            // matches the bet, has no decision to make.
            let others_can_act = self
                .seats
                .iter()
                .enumerate()
                .any(|(i, s)| i != seat && s.is_active());
            let matched = self.seats[seat].street_committed >= self.current_bet;
            if !others_can_act && matched && !self.seats[seat].needs_action {
                self.to_act = None;
            }
        }
    }

    /// What `seat` may legally do right now.
    pub fn legal_actions(&self, seat: usize) -> LegalActions {
        if self.to_act != Some(seat) {
            return LegalActions::default();
        }
        let s = &self.seats[seat];
        if !s.is_active() {
            return LegalActions::default();
        }

        let owed = self.current_bet.saturating_sub(s.street_committed);
        let call_amount = owed.min(s.stack);
        let max_raise_to = s.street_committed + s.stack;
        // A raise must strictly exceed the current bet, and the seat must not be
        // capped by a previous under-raise all-in.
        let can_raise = s.may_raise && max_raise_to > self.current_bet;
        let full_raise_to = self.current_bet + self.min_raise;
        let min_raise_to = if can_raise {
            full_raise_to.min(max_raise_to)
        } else {
            0
        };

        LegalActions {
            can_fold: true,
            can_check: owed == 0,
            can_call: owed > 0,
            call_amount,
            can_raise,
            min_raise_to,
            max_raise_to,
        }
    }

    /// Apply an action for `seat`, advancing the state machine.
    pub fn apply(&mut self, seat: usize, action: Action) -> Result<(), BettingError> {
        let Some(turn) = self.to_act else {
            return Err(BettingError::NoActionPending);
        };
        if turn != seat {
            return Err(BettingError::OutOfTurn);
        }
        if !self.seats[seat].is_active() {
            return Err(BettingError::SeatNotActive);
        }

        // Resolve AllIn into the concrete action it represents.
        let action = match action {
            Action::AllIn => {
                let s = &self.seats[seat];
                let shove_to = s.street_committed + s.stack;
                if shove_to > self.current_bet {
                    Action::RaiseTo(shove_to)
                } else {
                    Action::Call
                }
            }
            other => other,
        };

        match action {
            Action::Fold => {
                let s = &mut self.seats[seat];
                s.folded = true;
                s.needs_action = false;
            }

            Action::Check => {
                let s = &mut self.seats[seat];
                if s.street_committed < self.current_bet {
                    return Err(BettingError::CannotCheck);
                }
                s.needs_action = false;
            }

            Action::Call => {
                let owed = self
                    .current_bet
                    .saturating_sub(self.seats[seat].street_committed);
                if owed == 0 {
                    return Err(BettingError::NothingToCall);
                }
                let s = &mut self.seats[seat];
                let paid = owed.min(s.stack);
                s.stack -= paid;
                s.street_committed += paid;
                s.total_committed += paid;
                s.needs_action = false;
                if s.stack == 0 {
                    s.all_in = true;
                }
            }

            Action::RaiseTo(to) => {
                let s = self.seats[seat];
                if !s.may_raise {
                    return Err(BettingError::CannotRaise);
                }
                if to <= self.current_bet {
                    return Err(BettingError::RaiseTooSmall);
                }
                let needed = to - s.street_committed;
                if needed > s.stack {
                    return Err(BettingError::InsufficientChips);
                }
                let is_all_in = needed == s.stack;
                let increment = to - self.current_bet;
                // Short raises are legal only when they put the seat all-in.
                if increment < self.min_raise && !is_all_in {
                    return Err(BettingError::BelowMinRaise);
                }

                {
                    let s = &mut self.seats[seat];
                    s.stack -= needed;
                    s.street_committed += needed;
                    s.total_committed += needed;
                    s.needs_action = false;
                    if s.stack == 0 {
                        s.all_in = true;
                    }
                }

                let full_raise = increment >= self.min_raise;
                if full_raise {
                    self.min_raise = increment;
                    self.last_aggressor = Some(seat);
                }
                self.current_bet = to;

                // Everyone else now owes chips. A full raise also restores the
                // right to re-raise; an under-raise all-in does not, but only for
                // seats that had already acted.
                for i in 0..MAX_SEATS {
                    if i == seat || !self.seats[i].is_active() {
                        continue;
                    }
                    if full_raise {
                        self.seats[i].may_raise = true;
                    } else if !self.seats[i].needs_action {
                        self.seats[i].may_raise = false;
                    }
                    self.seats[i].needs_action = true;
                }
            }

            Action::AllIn => unreachable!("resolved above"),
        }

        self.to_act = self.find_next_actor(seat);
        self.settle_if_no_action();
        Ok(())
    }

    /// Move to the next street: clear street commitments and reopen betting.
    ///
    /// Does nothing once the hand is over. When every remaining player is
    /// all-in the street advances with no actor, so the board simply runs out.
    pub fn advance_street(&mut self) {
        if self.hand_is_over() {
            self.street = Street::Showdown;
            self.to_act = None;
            return;
        }

        self.street = self.street.next();
        self.current_bet = 0;
        self.min_raise = self.big_blind;
        self.last_aggressor = None;

        for s in self.seats.iter_mut() {
            s.street_committed = 0;
            if s.is_active() {
                s.needs_action = true;
                s.may_raise = true;
            } else {
                s.needs_action = false;
            }
        }

        if self.street == Street::Showdown {
            self.to_act = None;
            return;
        }

        // Postflop action starts left of the button.
        self.to_act = self.find_next_actor(self.button);

        // With at most one player able to act there is no betting to do.
        if self.seats.iter().filter(|s| s.is_active()).count() < 2 {
            self.to_act = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stacks(v: [u64; MAX_SEATS]) -> [u64; MAX_SEATS] {
        v
    }

    /// Six-handed, button at seat 0, blinds 5/10.
    fn six_handed() -> Betting {
        Betting::begin_hand(stacks([1000; MAX_SEATS]), 0, 5, 10).unwrap()
    }

    #[test]
    fn blinds_are_posted_and_utg_acts_first() {
        let b = six_handed();
        assert_eq!(
            b.seats[1].street_committed, 5,
            "seat 1 posts the small blind"
        );
        assert_eq!(
            b.seats[2].street_committed, 10,
            "seat 2 posts the big blind"
        );
        assert_eq!(b.to_act, Some(3), "action starts left of the big blind");
        assert_eq!(b.current_bet, 10);
        assert_eq!(b.min_raise, 10);
        assert_eq!(b.pot_total(), 15);
    }

    #[test]
    fn heads_up_button_posts_small_blind_and_acts_first_preflop() {
        let mut s = [0u64; MAX_SEATS];
        s[0] = 1000;
        s[1] = 1000;
        let b = Betting::begin_hand(s, 0, 5, 10).unwrap();
        assert_eq!(
            b.seats[0].street_committed, 5,
            "button posts the small blind"
        );
        assert_eq!(b.seats[1].street_committed, 10);
        assert_eq!(b.to_act, Some(0), "button acts first preflop heads-up");
    }

    #[test]
    fn heads_up_button_acts_last_postflop() {
        let mut s = [0u64; MAX_SEATS];
        s[0] = 1000;
        s[1] = 1000;
        let mut b = Betting::begin_hand(s, 0, 5, 10).unwrap();
        b.apply(0, Action::Call).unwrap();
        b.apply(1, Action::Check).unwrap();
        b.advance_street();
        assert_eq!(b.street, Street::Flop);
        assert_eq!(b.to_act, Some(1), "big blind acts first postflop heads-up");
    }

    #[test]
    fn big_blind_gets_the_option_when_everyone_limps() {
        let mut b = six_handed();
        for seat in [3, 4, 5, 0, 1] {
            b.apply(seat, Action::Call).unwrap();
        }
        assert_eq!(b.to_act, Some(2), "big blind still has the option to raise");
        assert!(b.legal_actions(2).can_check);
        assert!(b.legal_actions(2).can_raise);
        b.apply(2, Action::Check).unwrap();
        assert!(b.street_is_complete());
    }

    #[test]
    fn a_raise_reopens_action_for_players_who_already_called() {
        let mut b = six_handed();
        b.apply(3, Action::Call).unwrap(); // seat 3 calls 10
        b.apply(4, Action::RaiseTo(30)).unwrap();
        assert_eq!(b.current_bet, 30);
        assert_eq!(b.min_raise, 20, "raise increment becomes the new minimum");
        assert!(
            b.seats[3].needs_action,
            "seat 3 must act again after the raise"
        );
        assert!(b.seats[3].may_raise, "and may re-raise");
    }

    #[test]
    fn min_raise_is_enforced() {
        let mut b = six_handed();
        // Current bet 10, min raise 10, so the smallest legal raise is to 20.
        assert_eq!(
            b.apply(3, Action::RaiseTo(15)),
            Err(BettingError::BelowMinRaise)
        );
        assert_eq!(
            b.apply(3, Action::RaiseTo(10)),
            Err(BettingError::RaiseTooSmall)
        );
        assert_eq!(b.legal_actions(3).min_raise_to, 20);
        b.apply(3, Action::RaiseTo(20)).unwrap();
        assert_eq!(b.current_bet, 20);
    }

    #[test]
    fn all_in_for_less_than_a_full_raise_does_not_reopen_betting() {
        // Seat 4 is short: it can shove to 25 when the bet is 20 and the minimum
        // raise increment is 10, so its shove is a raise-for-less.
        let mut s = [1000u64; MAX_SEATS];
        s[4] = 25;
        let mut b = Betting::begin_hand(s, 0, 5, 10).unwrap();

        b.apply(3, Action::RaiseTo(20)).unwrap(); // full raise to 20
        assert_eq!(b.min_raise, 10);

        b.apply(4, Action::AllIn).unwrap(); // shove to 25, only +5
        assert_eq!(b.current_bet, 25);
        assert!(b.seats[4].all_in);
        assert_eq!(
            b.min_raise, 10,
            "an under-raise must not change the minimum"
        );

        assert!(b.seats[3].needs_action, "seat 3 still owes the extra 5");
        assert!(
            !b.seats[3].may_raise,
            "but seat 3 already acted, so it cannot re-raise"
        );

        // Seat 5 had not acted yet, so it keeps the right to raise.
        assert!(b.seats[5].needs_action);
        assert!(b.seats[5].may_raise);

        // Confirm the engine actually refuses the re-raise.
        // Drain the queue until seat 3 is to act.
        while b.to_act != Some(3) {
            let seat = b.to_act.unwrap();
            b.apply(seat, Action::Fold).unwrap();
        }
        assert_eq!(
            b.apply(3, Action::RaiseTo(60)),
            Err(BettingError::CannotRaise)
        );
        assert!(b.legal_actions(3).can_call);
        assert_eq!(b.legal_actions(3).call_amount, 5);
    }

    #[test]
    fn a_full_reraise_restores_the_right_to_raise() {
        let mut s = [1000u64; MAX_SEATS];
        s[4] = 25;
        let mut b = Betting::begin_hand(s, 0, 5, 10).unwrap();
        b.apply(3, Action::RaiseTo(20)).unwrap();
        b.apply(4, Action::AllIn).unwrap(); // under-raise, caps seat 3
        assert!(!b.seats[3].may_raise);
        b.apply(5, Action::RaiseTo(60)).unwrap(); // full raise
        assert!(b.seats[3].may_raise, "a full raise reopens seat 3");
    }

    #[test]
    fn calling_more_than_the_stack_goes_all_in() {
        let mut s = [1000u64; MAX_SEATS];
        s[4] = 12; // seat 4 cannot cover a raise to 100
        let mut b = Betting::begin_hand(s, 0, 5, 10).unwrap();
        b.apply(3, Action::RaiseTo(100)).unwrap();
        let la = b.legal_actions(4);
        assert_eq!(la.call_amount, 12, "call is capped at the stack");
        b.apply(4, Action::Call).unwrap();
        assert!(b.seats[4].all_in);
        assert_eq!(b.seats[4].stack, 0);
        assert_eq!(b.seats[4].total_committed, 12);
    }

    #[test]
    fn folding_to_one_player_ends_the_hand() {
        let mut b = six_handed();
        for seat in [3, 4, 5, 0, 1] {
            b.apply(seat, Action::Fold).unwrap();
        }
        assert!(b.hand_is_over());
        assert!(b.street_is_complete());
        assert_eq!(b.to_act, None);
    }

    #[test]
    fn checking_while_facing_a_bet_is_rejected() {
        let mut b = six_handed();
        assert_eq!(b.apply(3, Action::Check), Err(BettingError::CannotCheck));
    }

    #[test]
    fn acting_out_of_turn_is_rejected() {
        let mut b = six_handed();
        assert_eq!(b.apply(5, Action::Call), Err(BettingError::OutOfTurn));
    }

    #[test]
    fn postflop_action_starts_left_of_the_button() {
        let mut b = six_handed();
        for seat in [3, 4, 5, 0, 1] {
            b.apply(seat, Action::Call).unwrap();
        }
        b.apply(2, Action::Check).unwrap();
        b.advance_street();
        assert_eq!(b.street, Street::Flop);
        assert_eq!(b.to_act, Some(1), "first active seat left of the button");
        assert_eq!(b.current_bet, 0);
        assert!(b.legal_actions(1).can_check);
    }

    #[test]
    fn street_commitments_reset_but_totals_accumulate() {
        let mut b = six_handed();
        for seat in [3, 4, 5, 0, 1] {
            b.apply(seat, Action::Call).unwrap();
        }
        b.apply(2, Action::Check).unwrap();
        let pot_after_preflop = b.pot_total();
        assert_eq!(pot_after_preflop, 60, "six players at 10 each");
        b.advance_street();
        assert!(b.seats.iter().all(|s| s.street_committed == 0));
        assert_eq!(
            b.pot_total(),
            pot_after_preflop,
            "totals survive the street"
        );
    }

    #[test]
    fn requires_two_funded_players() {
        let mut s = [0u64; MAX_SEATS];
        s[0] = 100;
        assert_eq!(
            Betting::begin_hand(s, 0, 5, 10),
            Err(BettingError::NotEnoughPlayers)
        );
    }

    #[test]
    fn short_blind_posts_all_in() {
        let mut s = [1000u64; MAX_SEATS];
        s[2] = 4; // big blind cannot cover
        let b = Betting::begin_hand(s, 0, 5, 10).unwrap();
        assert_eq!(b.seats[2].street_committed, 4);
        assert!(b.seats[2].all_in);
        assert_eq!(b.current_bet, 10, "the bet to match is still the big blind");
    }

    #[test]
    fn everyone_all_in_leaves_no_actor() {
        let mut s = [0u64; MAX_SEATS];
        s[0] = 100;
        s[1] = 100;
        let mut b = Betting::begin_hand(s, 0, 5, 10).unwrap();
        b.apply(0, Action::AllIn).unwrap();
        b.apply(1, Action::Call).unwrap();
        assert!(b.seats[0].all_in && b.seats[1].all_in);
        b.advance_street();
        assert_eq!(b.to_act, None, "no one can act, the board just runs out");
        assert!(b.all_remaining_are_all_in());
    }
}
