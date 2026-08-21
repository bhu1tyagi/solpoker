#!/usr/bin/env python3
"""
Check the vendored IDL still matches the program.

Re-vendoring after a deploy is not optional: account layouts and the error list
live in that file, and a stale copy makes the client send the wrong accounts and
decode the wrong bytes. This is what stops that shipping unnoticed.

The one thing it has to forgive is the program id. `anchor build` on a fresh
checkout writes itself a new program keypair, because the real one is the
upgrade authority and is not in the repository. So a CI build always resolves a
different id from the committed one, and it appears both as a base58 string and
as raw bytes inside PDA seeds. Everything else, instructions, accounts, types,
errors and every other address, is compared exactly.

    python3 tools/verify-idl.py target/idl/solpoker.json app/src/lib/idl/solpoker.json
"""
import json
import sys

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s: str) -> list[int]:
    n = 0
    for ch in s:
        n = n * 58 + B58.index(ch)
    out = []
    while n:
        out.append(n & 0xFF)
        n >>= 8
    out.reverse()
    # Leading '1's are leading zero bytes.
    return [0] * (len(s) - len(s.lstrip("1"))) + out


def normalise(node, built_id: str, canonical_id: str, built_bytes, canonical_bytes):
    """Rewrite the build machine's throwaway program id to the committed one."""
    if isinstance(node, dict):
        return {k: normalise(v, built_id, canonical_id, built_bytes, canonical_bytes)
                for k, v in node.items()}
    if isinstance(node, list):
        if node == built_bytes:
            return canonical_bytes
        return [normalise(v, built_id, canonical_id, built_bytes, canonical_bytes)
                for v in node]
    if node == built_id:
        return canonical_id
    return node


def main() -> int:
    built_path, vendored_path = sys.argv[1], sys.argv[2]
    built = json.load(open(built_path))
    vendored = json.load(open(vendored_path))

    built_id, canonical_id = built["address"], vendored["address"]
    built = normalise(built, built_id, canonical_id,
                      b58decode(built_id), b58decode(canonical_id))

    if built == vendored:
        print(f"IDL is current ({len(vendored['instructions'])} instructions, "
              f"{len(vendored.get('errors', []))} errors)")
        if built_id != canonical_id:
            print(f"  ignored the build's throwaway program id {built_id}")
        return 0

    # Say what actually changed rather than dumping thousands of lines of JSON.
    def names(idl, key):
        return {x["name"] for x in idl.get(key, [])}

    for key in ("instructions", "accounts", "types", "errors"):
        added = names(built, key) - names(vendored, key)
        gone = names(vendored, key) - names(built, key)
        if added:
            print(f"  {key}: in the program but not the vendored IDL: {sorted(added)}")
        if gone:
            print(f"  {key}: in the vendored IDL but not the program: {sorted(gone)}")

    print(
        "\nThe vendored IDL is stale. Re-run:\n"
        "  cp target/idl/solpoker.json app/src/lib/idl/solpoker.json\n"
        "  cp target/types/solpoker.ts  app/src/lib/idl/solpoker.ts",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
