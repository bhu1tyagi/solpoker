//! Main pot and side pot construction and distribution.
//!
//! When players are all-in for different amounts, the pot splits into layers. A
//! player can only win the chips they could have matched, so each layer is
//! contested by a different set of seats.
//!
//! The construction here is **level-based** rather than incremental. Take every
//! distinct contribution amount as a boundary, then for each band between
//! consecutive boundaries take what each seat put into that band. A seat is
//! eligible for a band if it reached that band and did not fold. Folded players'
//! chips still fill the pots — that is dead money — they are simply never
//! eligible to win it back.
//!
//! Worked three-way example. A is all-in for 100, B is all-in for 300, C calls 300:
//!
//! ```text
//! contributions   A=100  B=300  C=300          total 700
//!
//! band 0..100     100 + 100 + 100 = 300        eligible A, B, C   (main pot)
//! band 100..300     0 + 200 + 200 = 400        eligible    B, C   (side pot 1)
//!                                    ---
//!                                    700
//! ```
//!
//! If A has the best hand, A wins 300 and cannot touch the 400 — that is settled
//! between B and C alone.

// Seat indices double as bitmask positions throughout this module, so
// indexed loops are clearer here than iterator adapters.
#![allow(clippy::needless_range_loop)]

use crate::eval::HandRank;
use crate::MAX_SEATS;

/// One layer of the pot and the seats that may win it.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Pot {
    pub amount: u64,
    /// Bitmask of eligible seats, bit `i` for seat `i`.
    pub eligible: u8,
}

impl Pot {
    #[inline]
    pub fn is_eligible(&self, seat: usize) -> bool {
        self.eligible & (1 << seat) != 0
    }

    pub fn eligible_seats(&self) -> Vec<usize> {
        (0..MAX_SEATS).filter(|i| self.is_eligible(*i)).collect()
    }
}

/// The full layered pot for a hand. Index 0 is the main pot.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Pots {
    pots: [Pot; MAX_SEATS],
    count: usize,
}

impl Default for Pots {
    fn default() -> Self {
        Pots {
            pots: [Pot::default(); MAX_SEATS],
            count: 0,
        }
    }
}

impl Pots {
    pub fn as_slice(&self) -> &[Pot] {
        &self.pots[..self.count]
    }

    pub fn iter(&self) -> impl Iterator<Item = &Pot> {
        self.as_slice().iter()
    }

    pub fn len(&self) -> usize {
        self.count
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Main pot plus every side pot.
    pub fn total(&self) -> u64 {
        self.iter().map(|p| p.amount).sum()
    }

    /// The main pot, contested by the widest set of players.
    pub fn main(&self) -> Option<&Pot> {
        self.as_slice().first()
    }

    /// Side pots, in increasing order of the stack depth that created them.
    pub fn side(&self) -> &[Pot] {
        if self.count > 1 {
            &self.pots[1..self.count]
        } else {
            &[]
        }
    }
}

/// Split total contributions into a main pot and side pots.
///
/// `contributions[i]` is everything seat `i` put in across all streets;
/// `folded[i]` marks seats that gave up their claim. Chips from folded seats stay
/// in the pots as dead money.
///
/// The returned pots always sum to the total contributed — no chip is created or
/// lost — and adjacent layers with identical eligibility are merged so the result
/// is the minimal correct list.
pub fn build_pots(contributions: &[u64; MAX_SEATS], folded: &[bool; MAX_SEATS]) -> Pots {
    // Distinct non-zero contribution amounts become the band boundaries.
    let mut levels = [0u64; MAX_SEATS];
    let mut n_levels = 0usize;
    for &c in contributions.iter() {
        if c != 0 && !levels[..n_levels].contains(&c) {
            levels[n_levels] = c;
            n_levels += 1;
        }
    }
    // Ascending. At most six entries, so an insertion sort is the right tool.
    for i in 1..n_levels {
        let mut j = i;
        while j > 0 && levels[j - 1] > levels[j] {
            levels.swap(j - 1, j);
            j -= 1;
        }
    }

    let mut out = Pots::default();
    let mut prev = 0u64;

    for &level in &levels[..n_levels] {
        let mut amount = 0u64;
        let mut eligible: u8 = 0;
        for (i, &c) in contributions.iter().enumerate() {
            // What seat i contributed within this band.
            amount += c.min(level).saturating_sub(c.min(prev));
            if c >= level && !folded[i] {
                eligible |= 1 << i;
            }
        }

        if amount > 0 {
            let merge_with_previous = out.count > 0
                && (out.pots[out.count - 1].eligible == eligible
                    // Nobody can win this band, so it rides with the band below.
                    || eligible == 0);
            if merge_with_previous {
                out.pots[out.count - 1].amount += amount;
            } else {
                out.pots[out.count] = Pot { amount, eligible };
                out.count += 1;
            }
        }
        prev = level;
    }

    debug_assert_eq!(
        out.total(),
        contributions.iter().sum::<u64>(),
        "pot construction must conserve chips"
    );
    out
}

/// The result of settling every pot.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Distribution {
    pub payouts: [u64; MAX_SEATS],
    /// Chips sitting in a layer that no live player was eligible to win.
    ///
    /// This is always zero in a real hand, because a hand always ends with at
    /// least one player who has not folded. It can only be non-zero if every
    /// single contributor to a layer folded. It is reported rather than silently
    /// dropped so callers can assert on it — an on-chain settle instruction
    /// should treat a non-zero value as a bug and refuse to proceed.
    pub unclaimed: u64,
}

impl Distribution {
    /// Chips actually paid out to seats.
    pub fn total_paid(&self) -> u64 {
        self.payouts.iter().sum()
    }
}

/// Award every pot to its best eligible hand, splitting ties.
///
/// `ranks[i]` is `Some` for a seat that reached showdown and `None` otherwise.
/// Odd chips that cannot divide evenly go to the first tied winner clockwise from
/// the button, which is the standard rule and keeps settlement deterministic.
///
/// `payouts.sum() + unclaimed` always equals `pots.total()`, so no chip is ever
/// created or destroyed.
pub fn distribute(
    pots: &Pots,
    ranks: &[Option<HandRank>; MAX_SEATS],
    button: usize,
) -> Distribution {
    let mut payouts = [0u64; MAX_SEATS];
    let mut unclaimed = 0u64;

    for pot in pots.iter() {
        // Best hand among the seats eligible for this layer.
        let mut best: Option<HandRank> = None;
        for seat in 0..MAX_SEATS {
            if !pot.is_eligible(seat) {
                continue;
            }
            if let Some(r) = ranks[seat] {
                best = Some(match best {
                    Some(b) => b.max(r),
                    None => r,
                });
            }
        }

        let mut winners = [false; MAX_SEATS];
        let mut n_winners = 0u64;
        match best {
            Some(b) => {
                for seat in 0..MAX_SEATS {
                    if pot.is_eligible(seat) && ranks[seat] == Some(b) {
                        winners[seat] = true;
                        n_winners += 1;
                    }
                }
            }
            None => {
                // Eligible seats exist but none supplied a rank, which means the
                // caller forgot a live player's hand. Split among the eligible
                // rather than destroying chips.
                debug_assert!(
                    pot.eligible == 0,
                    "every eligible seat should have a hand rank at showdown"
                );
                for seat in 0..MAX_SEATS {
                    if pot.is_eligible(seat) {
                        winners[seat] = true;
                        n_winners += 1;
                    }
                }
            }
        }

        if n_winners == 0 {
            // Every contributor to this layer folded, so it has no owner.
            // Unreachable in a real hand; surfaced instead of dropped.
            unclaimed += pot.amount;
            continue;
        }

        let share = pot.amount / n_winners;
        let mut remainder = pot.amount % n_winners;

        // Walk clockwise from the button so odd chips land deterministically.
        for step in 1..=MAX_SEATS {
            let seat = (button + step) % MAX_SEATS;
            if !winners[seat] {
                continue;
            }
            payouts[seat] += share;
            if remainder > 0 {
                payouts[seat] += 1;
                remainder -= 1;
            }
        }
    }

    debug_assert_eq!(
        payouts.iter().sum::<u64>() + unclaimed,
        pots.total(),
        "distribution must conserve chips"
    );
    Distribution { payouts, unclaimed }
}

/// Give the whole pot to the last player standing, for hands that end without a
/// showdown because everyone else folded.
pub fn award_uncontested(
    contributions: &[u64; MAX_SEATS],
    winner: usize,
) -> [u64; MAX_SEATS] {
    let mut payouts = [0u64; MAX_SEATS];
    payouts[winner] = contributions.iter().sum();
    payouts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_folds() -> [bool; MAX_SEATS] {
        [false; MAX_SEATS]
    }

    /// The worked example from the module docs.
    #[test]
    fn three_way_all_in_at_different_depths() {
        // A(0) all-in 100, B(1) all-in 300, C(2) calls 300.
        let contributions = [100, 300, 300, 0, 0, 0];
        let pots = build_pots(&contributions, &no_folds());

        assert_eq!(pots.len(), 2, "one main pot and one side pot");

        let main = pots.as_slice()[0];
        assert_eq!(main.amount, 300, "100 from each of three players");
        assert_eq!(main.eligible_seats(), vec![0, 1, 2]);

        let side = pots.as_slice()[1];
        assert_eq!(side.amount, 400, "200 more from each of two players");
        assert_eq!(side.eligible_seats(), vec![1, 2], "A cannot win this");

        assert_eq!(pots.total(), 700);
        assert_eq!(pots.total(), contributions.iter().sum::<u64>());
    }

    #[test]
    fn short_stack_winning_the_main_pot_cannot_touch_the_side_pot() {
        let contributions = [100, 300, 300, 0, 0, 0];
        let pots = build_pots(&contributions, &no_folds());

        // A has the best hand, C the second best.
        let ranks = [
            Some(HandRank(900)), // A — best
            Some(HandRank(500)), // B — worst
            Some(HandRank(700)), // C — middle
            None,
            None,
            None,
        ];
        let payouts = distribute(&pots, &ranks, 5).payouts;

        assert_eq!(payouts[0], 300, "A wins only the main pot");
        assert_eq!(payouts[2], 400, "C takes the side pot from B");
        assert_eq!(payouts[1], 0);
        assert_eq!(payouts.iter().sum::<u64>(), 700);
    }

    #[test]
    fn four_way_with_three_distinct_all_in_depths() {
        // Depths 50 / 150 / 400 / 400.
        let contributions = [50, 150, 400, 400, 0, 0];
        let pots = build_pots(&contributions, &no_folds());
        assert_eq!(pots.len(), 3);

        assert_eq!(pots.as_slice()[0].amount, 200); // 50 x 4
        assert_eq!(pots.as_slice()[0].eligible_seats(), vec![0, 1, 2, 3]);

        assert_eq!(pots.as_slice()[1].amount, 300); // 100 x 3
        assert_eq!(pots.as_slice()[1].eligible_seats(), vec![1, 2, 3]);

        assert_eq!(pots.as_slice()[2].amount, 500); // 250 x 2
        assert_eq!(pots.as_slice()[2].eligible_seats(), vec![2, 3]);

        assert_eq!(pots.total(), 1000);
    }

    #[test]
    fn folded_players_chips_stay_in_the_pot_as_dead_money() {
        // Seat 1 put in 300 then folded.
        let contributions = [300, 300, 300, 0, 0, 0];
        let mut folded = no_folds();
        folded[1] = true;

        let pots = build_pots(&contributions, &folded);
        assert_eq!(pots.len(), 1);
        assert_eq!(pots.total(), 900, "the folded 300 is still in the pot");
        assert_eq!(
            pots.as_slice()[0].eligible_seats(),
            vec![0, 2],
            "but seat 1 cannot win it back"
        );
    }

    #[test]
    fn a_folded_short_stack_does_not_create_a_side_pot_it_cannot_win() {
        // Seat 0 folded after committing 100; seats 1 and 2 went to 300.
        let contributions = [100, 300, 300, 0, 0, 0];
        let mut folded = no_folds();
        folded[0] = true;

        let pots = build_pots(&contributions, &folded);
        // Both bands are contested by exactly {1, 2}, so they merge.
        assert_eq!(pots.len(), 1, "identical eligibility must merge");
        assert_eq!(pots.total(), 700);
        assert_eq!(pots.as_slice()[0].eligible_seats(), vec![1, 2]);
    }

    #[test]
    fn split_pot_divides_evenly() {
        let contributions = [100, 100, 0, 0, 0, 0];
        let pots = build_pots(&contributions, &no_folds());
        let tie = Some(HandRank(700));
        let ranks = [tie, tie, None, None, None, None];
        let payouts = distribute(&pots, &ranks, 5).payouts;
        assert_eq!(payouts[0], 100);
        assert_eq!(payouts[1], 100);
    }

    #[test]
    fn an_uncalled_overbet_returns_to_its_owner_rather_than_splitting() {
        // Seat 0 put in one chip more than anyone matched. That chip forms its
        // own band that only seat 0 is eligible for, so it comes straight back
        // even though the two hands tie.
        let contributions = [51, 50, 0, 0, 0, 0];
        let pots = build_pots(&contributions, &no_folds());
        let tie = Some(HandRank(700));
        let ranks = [tie, tie, None, None, None, None];

        for button in 0..MAX_SEATS {
            let payouts = distribute(&pots, &ranks, button).payouts;
            assert_eq!(payouts[0], 51, "button {button}");
            assert_eq!(payouts[1], 50, "button {button}");
        }
    }

    #[test]
    fn odd_chip_goes_clockwise_from_the_button() {
        // Two players tie for a pot made odd by a folded player's dead chip:
        // 50 + 50 matched, plus 1 abandoned by seat 2.
        let contributions = [50, 50, 1, 0, 0, 0];
        let mut folded = no_folds();
        folded[2] = true;

        let pots = build_pots(&contributions, &folded);
        assert_eq!(pots.len(), 1, "same eligibility throughout, so one pot");
        assert_eq!(pots.total(), 101);

        let tie = Some(HandRank(700));
        let ranks = [tie, tie, None, None, None, None];

        // Button on seat 5, so seat 0 is first clockwise and takes the odd chip.
        let payouts = distribute(&pots, &ranks, 5).payouts;
        assert_eq!(payouts[0], 51);
        assert_eq!(payouts[1], 50);

        // Button on seat 0, so seat 1 is first clockwise instead.
        let payouts = distribute(&pots, &ranks, 0).payouts;
        assert_eq!(payouts[0], 50);
        assert_eq!(payouts[1], 51);

        assert_eq!(payouts.iter().sum::<u64>(), 101, "conserved either way");
    }

    #[test]
    fn three_way_tie_spreads_two_odd_chips() {
        let contributions = [100, 100, 101, 0, 0, 0];
        let pots = build_pots(&contributions, &no_folds());
        // 100/100/100 main pot, then a 1-chip band only seat 2 can win.
        let tie = Some(HandRank(700));
        let ranks = [tie, tie, tie, None, None, None];
        let payouts = distribute(&pots, &ranks, 5).payouts;
        assert_eq!(payouts.iter().sum::<u64>(), 301);
        // Main pot of 300 splits evenly; the extra chip is seat 2's own overbet.
        assert_eq!(payouts[2], 101);
        assert_eq!(payouts[0], 100);
        assert_eq!(payouts[1], 100);
    }

    #[test]
    fn everyone_matching_makes_a_single_pot() {
        let contributions = [200; MAX_SEATS];
        let pots = build_pots(&contributions, &no_folds());
        assert_eq!(pots.len(), 1);
        assert_eq!(pots.total(), 1200);
        assert_eq!(pots.as_slice()[0].eligible_seats(), (0..6).collect::<Vec<_>>());
    }

    #[test]
    fn empty_contributions_make_no_pots() {
        let pots = build_pots(&[0; MAX_SEATS], &no_folds());
        assert!(pots.is_empty());
        assert_eq!(pots.total(), 0);
    }

    #[test]
    fn uncontested_win_takes_everything() {
        let contributions = [10, 40, 0, 0, 0, 0];
        let payouts = award_uncontested(&contributions, 1);
        assert_eq!(payouts[1], 50);
        assert_eq!(payouts.iter().sum::<u64>(), 50);
    }

    #[test]
    fn side_pot_tie_splits_only_that_layer() {
        let contributions = [100, 300, 300, 0, 0, 0];
        let pots = build_pots(&contributions, &no_folds());
        let ranks = [
            Some(HandRank(900)), // A wins the main pot outright
            Some(HandRank(700)), // B and C tie the side pot
            Some(HandRank(700)),
            None,
            None,
            None,
        ];
        let payouts = distribute(&pots, &ranks, 5).payouts;
        assert_eq!(payouts[0], 300);
        assert_eq!(payouts[1], 200);
        assert_eq!(payouts[2], 200);
        assert_eq!(payouts.iter().sum::<u64>(), 700);
    }
}
