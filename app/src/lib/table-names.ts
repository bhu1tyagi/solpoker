/**
 * Display names for tables.
 *
 * On chain a table is an id, a creator and a stake config; it has no name.
 * The draft's named rooms ("Neptune's Deep") tested well because a name makes
 * a card feel like a place, so each table gets one — DETERMINISTICALLY, from
 * its id. Same id, same name, for every player, on every device, with no
 * server round trip. This is labelling, not invented liveness: the name
 * decorates a real table, it never fabricates one.
 *
 * When the backend name registry lands (creator names the table at creation,
 * stored in the DB, served by the API), that name wins and this becomes the
 * fallback for tables created before it existed. The seam is displayName().
 *
 * Words chosen to read as poker-room geography rather than fantasy loot:
 * felt, rivers, positions, streets.
 */

const FIRST = [
  "Meridian", "Harbor", "Copper", "Northern", "Velvet", "Cedar",
  "Ivory", "Monarch", "Baseline", "Hollow", "Ember", "Granite",
  "Juniper", "Windward", "Lantern", "Sable",
] as const;

const SECOND = [
  "Row", "House", "Court", "Room", "Bend", "Street",
  "Landing", "Circle", "Cross", "Yard", "Gate", "Walk",
] as const;

export function tableName(tableId: number | bigint): string {
  const n = BigInt(tableId);
  // Two independent digits from different parts of the id, so consecutive
  // ids (creation is sequential-ish) do not walk the same word pairs.
  const a = Number((n >> 8n) % BigInt(FIRST.length));
  const b = Number(n % BigInt(SECOND.length));
  return `${FIRST[a]} ${SECOND[b]}`;
}

/** The registry seam: DB name when the backend provides one, else generated. */
export function displayName(
  tableId: number | bigint,
  registered?: string | null,
): string {
  return registered?.trim() || tableName(tableId);
}
