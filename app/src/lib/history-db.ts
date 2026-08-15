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

export interface StoredHand extends HandHistory {
  /** `${tableId}:${handNumber}`, so a hand is written once however many clients saw it. */
  id: string;
  tableId: number;
  capturedAt: number;
}

export async function saveHand(hand: StoredHand): Promise<void> {
  if (typeof window === "undefined") return;
  const database = await db();
  const existing = await database.get(STORE, hand.id);
  // First capture wins. A later one has the same content but a rewritten hand
  // account behind it, so it can only be worse.
  if (existing) return;
  await database.put(STORE, hand);
}

export async function listHands(tableId: number): Promise<StoredHand[]> {
  if (typeof window === "undefined") return [];
  const database = await db();
  const all = (await database.getAllFromIndex(STORE, "byTable", tableId)) as StoredHand[];
  return all.sort((a, b) => b.handNumber - a.handNumber);
}

export async function getHand(id: string): Promise<StoredHand | undefined> {
  if (typeof window === "undefined") return undefined;
  return (await db()).get(STORE, id);
}

export async function listAllHands(): Promise<StoredHand[]> {
  if (typeof window === "undefined") return [];
  const all = (await (await db()).getAll(STORE)) as StoredHand[];
  return all.sort((a, b) => b.capturedAt - a.capturedAt);
}

export const handId = (tableId: number, handNumber: number) => `${tableId}:${handNumber}`;
