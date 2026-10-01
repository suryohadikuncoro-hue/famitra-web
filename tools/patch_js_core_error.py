#!/usr/bin/env python3
"""Show backend error details instead of hiding them behind HTTP status 500.

Usage:
    python3 tools/patch_js_core_error.py public/js_core.js
    python3 tools/patch_js_core_error.py public/js_core.js --check
"""

from __future__ import annotations

import argparse
from pathlib import Path


OLD = """    .then(function (r) {
      if (!r.ok) throw new Error('Gagal menghubungi server (HTTP ' + r.status + ').');
      return r.json();
    })
"""

NEW = """    .then(async function (r) {
      var body = null;
      try {
        body = await r.json();
      } catch (_) {
        // Response bukan JSON; gunakan pesan HTTP sebagai fallback.
      }
      if (!r.ok) {
        throw new Error(
          body && body.error
            ? body.error
            : 'Gagal menghubungi server (HTTP ' + r.status + ').'
        );
      }
      return body;
    })
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Path ke public/js_core.js")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Hanya periksa apakah perubahan sudah diterapkan; jangan menulis file.",
    )
    args = parser.parse_args()

    path = args.path
    if not path.is_file():
        parser.error(f"File tidak ditemukan: {path}")

    content = path.read_text(encoding="utf-8")
    if NEW in content:
        print(f"Sudah diperbarui: {path}")
        return 0
    if OLD not in content:
        raise SystemExit(
            "Blok handler yang diharapkan tidak ditemukan; file tidak diubah "
            "untuk mencegah penggantian yang keliru."
        )
    if args.check:
        print(f"Belum diperbarui: {path}")
        return 1

    path.write_text(content.replace(OLD, NEW, 1), encoding="utf-8")
    print(f"Berhasil diperbarui: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
