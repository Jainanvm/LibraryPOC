#!/usr/bin/env python3
"""
Bulk-import personalization use cases from a CSV file into data/use-cases.json.

This is the "easy maintainability at scale" path: instead of hand-editing
JSON, fill in scripts/import_template.csv (e.g. in Excel/Google Sheets,
export as CSV) and run this script. Existing ids are updated in place;
new ids are appended. The result is validated automatically before saving.

Usage:
    python3 scripts/import_csv.py path/to/your_cases.csv
    python3 scripts/import_csv.py path/to/your_cases.csv --dry-run

CSV columns (see scripts/import_template.csv for a filled-in example):
    id, title, oneLiner, channels, funnelStage, personalizationTactic,
    cdpDataUsed, businessProblems, dataMaturity, complexity, quickWin, journey,
    exampleBefore, exampleAfter, kpiPrimary, kpiSecondary, toolsNeeded, tags

List-type columns (channels, cdpDataUsed, businessProblems, kpiSecondary,
toolsNeeded, tags) use "|" as the separator between multiple values in a
single cell, e.g.:
    channels:         web|email
    cdpDataUsed:      Purchase history|Loyalty tier|Email engagement score
    businessProblems: low-loyalty-engagement|generic-experience
                       (must match ids in data/business-problems.json)
    quickWin:         true / false / yes / no
"""
import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "use-cases.json"

LIST_FIELDS = {"channels", "cdpDataUsed", "businessProblems", "kpiSecondary", "toolsNeeded", "tags"}
BOOL_FIELDS = {"quickWin"}
REQUIRED_COLUMNS = [
    "id", "title", "oneLiner", "channels", "funnelStage", "personalizationTactic",
    "cdpDataUsed", "businessProblems", "dataMaturity", "complexity", "quickWin", "journey",
    "exampleBefore", "exampleAfter", "kpiPrimary", "kpiSecondary", "toolsNeeded", "tags",
]


def parse_bool(value):
    return str(value).strip().lower() in {"true", "yes", "y", "1"}


def row_to_use_case(row):
    missing = [c for c in REQUIRED_COLUMNS if c not in row]
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")

    uc = {}
    for key, value in row.items():
        value = (value or "").strip()
        if key in LIST_FIELDS:
            uc[key] = [v.strip() for v in value.split("|") if v.strip()]
        elif key in BOOL_FIELDS:
            uc[key] = parse_bool(value)
        else:
            uc[key] = value

    # kpiPrimary / kpiSecondary flatten into the nested `kpis` object
    uc["kpis"] = {"primary": uc.pop("kpiPrimary"), "secondary": uc.pop("kpiSecondary")}
    return uc


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_path", type=Path, help="Path to the CSV file to import")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing the file")
    args = parser.parse_args()

    if not args.csv_path.exists():
        print(f"❌ File not found: {args.csv_path}")
        sys.exit(1)

    with args.csv_path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        print("❌ CSV has no data rows.")
        sys.exit(1)

    new_cases = [row_to_use_case(r) for r in rows]

    data = json.loads(DATA_FILE.read_text())
    existing = {uc["id"]: i for i, uc in enumerate(data["useCases"])}

    added, updated = 0, 0
    for uc in new_cases:
        if uc["id"] in existing:
            data["useCases"][existing[uc["id"]]] = uc
            updated += 1
        else:
            data["useCases"].append(uc)
            added += 1

    print(f"{added} use case(s) to add, {updated} to update.")

    if args.dry_run:
        print("Dry run — no files written. Remove --dry-run to apply.")
        return

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"✅ Wrote {DATA_FILE.relative_to(ROOT)}")
    print("Now run: python3 scripts/validate.py")


if __name__ == "__main__":
    main()
