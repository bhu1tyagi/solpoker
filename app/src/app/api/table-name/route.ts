import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * The name registry: a table's creator names it once, at creation.
 *
 * v1 auth is set-once-first-writer: the creating client posts immediately
 * after the create transaction lands, so in practice the first writer IS the
 * creator. What this does not yet do is verify a signature from the
 * creator's wallet, which means a racing stranger could name a table they
 * did not make. Accepted for now because a name is a label with no money
 * behind it, the window is seconds wide, and set-once means nobody can
 * rename an established table out from under its players. Tightening it
 * means signing the name with the creating wallet; the route is the seam.
 *
 * Names are clamped to a conservative charset so the lobby never renders
 * markup, RTL overrides, or a wall of emoji from a stranger.
 */
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&.-]{1,30}$/u;

export async function POST(req: Request) {
  const s = db();
  if (!s) return NextResponse.json({ stored: false }, { status: 202 });

  let body: { tableId?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "not json" }, { status: 400 });
  }

  const tableId = typeof body.tableId === "string" ? body.tableId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!/^\d{1,20}$/.test(tableId)) {
    return NextResponse.json({ error: "bad table id" }, { status: 400 });
  }
  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { error: "2 to 31 characters: letters, numbers, spaces, '&.-" },
      { status: 422 },
    );
  }

  await ensureSchema(s);
  const rows = await s`
    INSERT INTO table_names (table_id, name)
    VALUES (${tableId}, ${name})
    ON CONFLICT (table_id) DO NOTHING
    RETURNING table_id`;

  // Set-once: a second writer is told plainly rather than silently ignored.
  if (rows.length === 0) {
    return NextResponse.json({ error: "already named" }, { status: 409 });
  }
  return NextResponse.json({ stored: true });
}
