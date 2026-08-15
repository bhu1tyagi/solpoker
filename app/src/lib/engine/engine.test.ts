import { describe, it, expect } from "vitest";
import { evaluate, describe as describeHand, bestFive, categoryOf, Category } from "./evaluate";
import { buildPots, distribute, potsTotal, eligibleSeats } from "./pots";
import { legalActions } from "./legal-actions";
import { makeCard, cardName } from "./cards";

/** Cards by name, so the fixtures read like poker rather than arithmetic. */
const c = (s: string) => {
  const rank = "23456789TJQKA".indexOf(s[0]);
  const suit = "cdhs".indexOf(s[1]);
  return makeCard(rank, suit);
};
const hand = (s: string) => s.split(" ").map(c);

describe("evaluate", () => {
  it("names each category correctly", () => {
    expect(categoryOf(evaluate(hand("As Ks Qs Js Ts")))).toBe(Category.StraightFlush);
    expect(categoryOf(evaluate(hand("As Ac Ad Ah Ks")))).toBe(Category.Quads);
    expect(categoryOf(evaluate(hand("As Ac Ad Ks Kc")))).toBe(Category.FullHouse);
    expect(categoryOf(evaluate(hand("As Ks Qs Js 9s")))).toBe(Category.Flush);
    expect(categoryOf(evaluate(hand("As Kc Qd Jh Ts")))).toBe(Category.Straight);
    expect(categoryOf(evaluate(hand("As Ac Ad Ks Qc")))).toBe(Category.Trips);
    expect(categoryOf(evaluate(hand("As Ac Ks Kc Qd")))).toBe(Category.TwoPair);
    expect(categoryOf(evaluate(hand("As Ac Ks Qc Jd")))).toBe(Category.Pair);
    expect(categoryOf(evaluate(hand("As Kc Qd Jh 9s")))).toBe(Category.HighCard);
  });

  it("ranks the wheel as a five-high straight", () => {
    const wheel = evaluate(hand("As 2c 3d 4h 5s"));
    expect(categoryOf(wheel)).toBe(Category.Straight);
    expect(describeHand(wheel)).toBe("straight, five high");
    // A six-high straight must beat it.
    expect(evaluate(hand("2c 3d 4h 5s 6c"))).toBeGreaterThan(wheel);
  });

  it("orders categories so plain comparison is poker comparison", () => {
    const ordered = [
      hand("As Kc Qd Jh 9s"),
      hand("As Ac Ks Qc Jd"),
      hand("As Ac Ks Kc Qd"),
      hand("As Ac Ad Ks Qc"),
      hand("As Kc Qd Jh Ts"),
      hand("As Ks Qs Js 9s"),
      hand("As Ac Ad Ks Kc"),
      hand("As Ac Ad Ah Ks"),
      hand("As Ks Qs Js Ts"),
    ].map(evaluate);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
  });

  it("breaks ties on kickers", () => {
    const better = evaluate(hand("As Ac Ks Qc Jd"));
    const worse = evaluate(hand("As Ac Ks Qc Td"));
    expect(better).toBeGreaterThan(worse);
  });

  it("treats identical five-card hands as a genuine tie", () => {
    // Same ranks, different suits. Suits never break ties in Hold'em.
    expect(evaluate(hand("As Kc Qd Jh 9s"))).toBe(evaluate(hand("Ac Kd Qh Js 9c")));
  });

  it("picks the best five out of seven", () => {
    const { five, rank } = bestFive(hand("As Ks Qs Js Ts 2c 3d"));
    expect(categoryOf(rank)).toBe(Category.StraightFlush);
    expect(five.map(cardName).sort()).toEqual(["Js", "Ks", "Qs", "As", "Ts"].sort());
  });

  it("describes hands the way the program does", () => {
    expect(describeHand(evaluate(hand("Ks Kc Qd Jh 9s")))).toBe("pair of kings");
    expect(describeHand(evaluate(hand("Ks Kc 3d 3h 9s")))).toBe("two pair, kings and threes");
    expect(describeHand(evaluate(hand("Ks Kc Kd 3h 3s")))).toBe("full house, kings over threes");
    expect(describeHand(evaluate(hand("Ks Kc Kd Kh 3s")))).toBe("four kings");
  });
});

describe("buildPots", () => {
  it("splits a three-way all-in into main and side pots", () => {
    // A all-in 100, B all-in 300, C calls 300. The worked example from pots.rs.
    const pots = buildPots([100, 300, 300, 0, 0, 0], [false, false, false, false, false, false]);
    expect(pots.length).toBe(2);
    expect(pots[0].amount).toBe(300);
    expect(eligibleSeats(pots[0])).toEqual([0, 1, 2]);
    expect(pots[1].amount).toBe(400);
    expect(eligibleSeats(pots[1])).toEqual([1, 2]);
    expect(potsTotal(pots)).toBe(700);
  });

  it("keeps folded chips in the pot as dead money", () => {
    const pots = buildPots([100, 100, 100, 0, 0, 0], [true, false, false, false, false, false]);
    expect(potsTotal(pots)).toBe(300);
    expect(eligibleSeats(pots[0])).toEqual([1, 2]);
  });

  it("conserves chips for any contribution mix", () => {
    const contributions = [10, 250, 250, 75, 0, 1000];
    const pots = buildPots(contributions, [false, false, true, false, false, false]);
    expect(potsTotal(pots)).toBe(contributions.reduce((a, b) => a + b, 0));
  });

  it("merges layers nobody can win into the layer below", () => {
    // Seat 2 outbid everyone and then folded, so its excess has no owner.
    const pots = buildPots([100, 100, 500, 0, 0, 0], [false, false, true, false, false, false]);
    expect(potsTotal(pots)).toBe(700);
    // Every layer must have someone who can win it.
    for (const p of pots) expect(p.eligible).not.toBe(0);
  });
});

describe("distribute", () => {
  it("gives each layer to its best eligible hand", () => {
    const pots = buildPots([100, 300, 300, 0, 0, 0], [false, false, false, false, false, false]);
    // Seat 0 has the best hand but is only in for the main pot.
    const ranks = [900, 500, 400, null, null, null];
    const { payouts, unclaimed } = distribute(pots, ranks, 5);
    expect(payouts[0]).toBe(300);
    expect(payouts[1]).toBe(400);
    expect(unclaimed).toBe(0);
  });

  it("splits a tie evenly", () => {
    const pots = buildPots([100, 100, 0, 0, 0, 0], [false, false, false, false, false, false]);
    const { payouts } = distribute(pots, [500, 500, null, null, null, null], 5);
    expect(payouts[0]).toBe(100);
    expect(payouts[1]).toBe(100);
  });

  it("gives odd chips clockwise from the button", () => {
    // 101 chips between two tied winners. Button is seat 5, so seat 0 is first.
    const pots = [{ amount: 101, eligible: 0b000011 }];
    const { payouts } = distribute(pots, [500, 500, null, null, null, null], 5);
    expect(payouts[0]).toBe(51);
    expect(payouts[1]).toBe(50);
    // Move the button and the odd chip moves with it.
    const other = distribute(pots, [500, 500, null, null, null, null], 0);
    expect(other.payouts[1]).toBe(51);
    expect(other.payouts[0]).toBe(50);
  });

  it("never creates or destroys chips", () => {
    const contributions = [50, 200, 200, 75, 0, 0];
    const pots = buildPots(contributions, [false, false, false, true, false, false]);
    const { payouts, unclaimed } = distribute(pots, [100, 900, 300, null, null, null], 2);
    const paid = payouts.reduce((a, b) => a + b, 0);
    expect(paid + unclaimed).toBe(contributions.reduce((a, b) => a + b, 0));
  });
});

describe("legalActions", () => {
  const seat = (over: Partial<Record<string, unknown>> = {}) => ({
    inHand: true,
    folded: false,
    allIn: false,
    stack: 1000,
    committedStreet: 0,
    mayRaise: true,
    ...over,
  }) as never;

  it("offers nothing when it is not your turn", () => {
    const la = legalActions({ toAct: 1, currentBet: 0, minRaise: 10 }, seat(), 0);
    expect(la.canFold).toBe(false);
    expect(la.canCheck).toBe(false);
  });

  it("lets you check when nothing is owed", () => {
    const la = legalActions({ toAct: 0, currentBet: 0, minRaise: 10 }, seat(), 0);
    expect(la.canCheck).toBe(true);
    expect(la.canCall).toBe(false);
    expect(la.callAmount).toBe(0);
  });

  it("computes the call amount facing a bet", () => {
    const la = legalActions(
      { toAct: 0, currentBet: 50, minRaise: 10 },
      seat({ committedStreet: 10 }),
      0,
    );
    expect(la.canCheck).toBe(false);
    expect(la.canCall).toBe(true);
    expect(la.callAmount).toBe(40);
  });

  it("caps the call at the stack when short", () => {
    const la = legalActions(
      { toAct: 0, currentBet: 500, minRaise: 10 },
      seat({ stack: 120 }),
      0,
    );
    expect(la.callAmount).toBe(120);
    // Calling all-in for less is not a raise.
    expect(la.canRaise).toBe(false);
  });

  it("uses min_raise as an increment, not a target", () => {
    const la = legalActions(
      { toAct: 0, currentBet: 50, minRaise: 20 },
      seat({ committedStreet: 0 }),
      0,
    );
    expect(la.minRaiseTo).toBe(70);
    expect(la.maxRaiseTo).toBe(1000);
  });

  it("allows only a short all-in when the stack cannot cover a full raise", () => {
    const la = legalActions(
      { toAct: 0, currentBet: 50, minRaise: 50 },
      seat({ stack: 60, committedStreet: 0 }),
      0,
    );
    expect(la.canRaise).toBe(true);
    expect(la.minRaiseTo).toBe(60);
    expect(la.maxRaiseTo).toBe(60);
  });

  it("respects may_raise being cleared by an under-raise all-in", () => {
    const la = legalActions(
      { toAct: 0, currentBet: 50, minRaise: 10 },
      seat({ mayRaise: false }),
      0,
    );
    expect(la.canRaise).toBe(false);
    expect(la.minRaiseTo).toBe(0);
    expect(la.canCall).toBe(true);
  });

  it("offers nothing to a folded or all-in seat", () => {
    expect(legalActions({ toAct: 0, currentBet: 0, minRaise: 10 }, seat({ folded: true }), 0).canFold).toBe(false);
    expect(legalActions({ toAct: 0, currentBet: 0, minRaise: 10 }, seat({ allIn: true }), 0).canFold).toBe(false);
  });
});
