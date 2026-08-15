import { describe, it, expect } from "vitest";
import { getOrCreateSalt, loadSalt, commitmentFor, pruneSalts } from "./salts";
import { sha256 } from "@noble/hashes/sha2";

/**
 * These run with no localStorage at all, which is the case that bit us: a salt
 * that changes between the commit and the reveal makes the reveal fail and
 * stalls the hand on that player, every hand.
 */
describe("salts without storage", () => {
  it("returns the same salt for the same hand", () => {
    const a = getOrCreateSalt("tableA", 1);
    const b = getOrCreateSalt("tableA", 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("gives different hands different salts", () => {
    const a = getOrCreateSalt("tableB", 1);
    const b = getOrCreateSalt("tableB", 2);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("gives different tables different salts", () => {
    const a = getOrCreateSalt("tableC", 1);
    const b = getOrCreateSalt("tableD", 1);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("can be read back after creation", () => {
    const a = getOrCreateSalt("tableE", 7);
    expect(Array.from(loadSalt("tableE", 7)!)).toEqual(Array.from(a));
  });

  it("has no salt for a hand never started", () => {
    expect(loadSalt("tableF", 99)).toBeNull();
  });

  it("commits to the hash the program will check", () => {
    const salt = getOrCreateSalt("tableG", 1);
    expect(Array.from(commitmentFor(salt))).toEqual(Array.from(sha256(salt)));
  });

  it("is 32 bytes and not all zeros", () => {
    const salt = getOrCreateSalt("tableH", 1);
    expect(salt.length).toBe(32);
    expect(salt.some((b) => b !== 0)).toBe(true);
  });

  it("keeps recent hands when pruning", () => {
    getOrCreateSalt("tableI", 1);
    const recent = getOrCreateSalt("tableI", 20);
    pruneSalts("tableI", 20, 10);
    expect(loadSalt("tableI", 1)).toBeNull();
    expect(Array.from(loadSalt("tableI", 20)!)).toEqual(Array.from(recent));
  });
});
