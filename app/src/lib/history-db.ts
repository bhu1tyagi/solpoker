/**
 * Keeping finished hands so they can be verified later.
 *
 * The chain does not keep them. Hand and Seat accounts are reused every hand,
 * so the salts and the seed for hand N are gone the moment hand N+1 starts,
 * and only a digest of the result reaches the base layer. If a client does not
 * write the hand down when it ends, nobody can check it afterwards.
 *
 * So the capture happens at settle, from state already in memory, and lands
 * here. The result hash ties each record back to what the base layer recorded,
 * which is what stops this from being a story the client tells itself.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { HandHistory } from "./verifier/verify-shuffle";

const DB_NAME = "solpoker";
const STORE = "hands";
// Version 2, and the upgrade checks before creating. Anything else that opens
// this database without a version, devtools included, creates it empty at
// version 1, and a version-1 open from here would then skip the upgrade and
// leave every save failing quietly forever.
const VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("byTable", "tableId");
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Which build's capture logic wrote a record.
 *
 * Earlier builds could store a hand whose seed belonged to the hand before it,
 * and such a record fails verification forever with no way to repair it. That
 * is why old hands showed "Failed" while the newest one passed: the game was
 * fine, the recording was not. Records without the current stamp are from those
 * builds and are dropped on sight rather than shown as failures, which would
 * accuse an honest hand of cheating. Bump this whenever capture changes in a way
 * that makes older records untrustworthy.
 */
export const CAPTURE_VERSION = 2;

export interface StoredHand extends HandHistory {
  /** `${tableId}:${handNumber}`, so a hand is written once however many clients saw it. */
  id: string;
  tableId: number;
  capturedAt: number;
  /** Absent means an older build wrote it. See CAPTURE_VERSION. */
  captureVersion?: number;
}

export async function saveHand(hand: StoredHand): Promise<void> {
  if (typeof window === "undefined") return;
  const database = await db();
  const existing = (await database.get(STORE, hand.id)) as StoredHand | undefined;
  // First good capture wins. A later one has the same content but a rewritten
  // hand account behind it, so it can only be worse. A record from an older
  // build is replaced, because this one is known to verify and that one is not.
  if (existing && existing.captureVersion === CAPTURE_VERSION) return;
  await database.put(STORE, { ...hand, captureVersion: CAPTURE_VERSION });
}

/** Drop records an older build wrote, which can never verify. */
async function pruneStale(database: IDBPDatabase, hands: StoredHand[]) {
  const stale = hands.filter((h) => h.captureVersion !== CAPTURE_VERSION);
  if (stale.length === 0) return;
  await Promise.all(stale.map((h) => database.delete(STORE, h.id).catch(() => {})));
  console.warn(
    `dropped ${stale.length} hand record(s) written by an earlier build; ` +
      "they could not be verified because of a capture bug, not a shuffle problem",
  );
}

export async function listHands(tableId: number): Promise<StoredHand[]> {
  if (typeof window === "undefined") return [];
  const database = await db();
  const all = (await database.getAllFromIndex(STORE, "byTable", tableId)) as StoredHand[];
  void pruneStale(database, all);
  return all
    .filter((h) => h.captureVersion === CAPTURE_VERSION)
    .sort((a, b) => b.handNumber - a.handNumber);
}

export async function getHand(id: string): Promise<StoredHand | undefined> {
  if (typeof window === "undefined") return undefined;
  return (await db()).get(STORE, id);
}

export async function listAllHands(): Promise<StoredHand[]> {
  if (typeof window === "undefined") return [];
  const database = await db();
  const all = (await database.getAll(STORE)) as StoredHand[];
  void pruneStale(database, all);
  return all
    .filter((h) => h.captureVersion === CAPTURE_VERSION)
    .sort((a, b) => b.capturedAt - a.capturedAt);
}

export const handId = (tableId: number, handNumber: number) => `${tableId}:${handNumber}`;
