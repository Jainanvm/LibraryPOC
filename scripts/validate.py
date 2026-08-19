#!/usr/bin/env python3
"""
Validate data/use-cases.json against data/schema.json.

Run locally:
    pip install jsonschema
    python3 scripts/validate.py

This also runs automatically on every push/PR via
.github/workflows/validate.yml, so a bad entry can't reach the live site.
"""
import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft7Validator
except ImportError:
    print("Missing dependency. Run: pip install jsonschema")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "use-cases.json"
SCHEMA_FILE = ROOT / "data" / "schema.json"


def main():
    errors_found = False

    schema = json.loads(SCHEMA_FILE.read_text())
    validator = Draft7Validator(schema)

    try:
        data = json.loads(DATA_FILE.read_text())
    except json.JSONDecodeError as e:
        print(f"❌ data/use-cases.json is not valid JSON: {e}")
        sys.exit(1)

    use_cases = data.get("useCases", [])
    if not use_cases:
        print("❌ No use cases found under the 'useCases' key.")
        sys.exit(1)

    seen_ids = {}
    for i, uc in enumerate(use_cases):
        label = uc.get("id", f"[entry #{i}] (missing id)")
        errs = sorted(validator.iter_errors(uc), key=lambda e: e.path)
        for err in errs:
            errors_found = True
            path = ".".join(str(p) for p in err.path) or "(root)"
            print(f"❌ {label}: {path} — {err.message}")

        uc_id = uc.get("id")
        if uc_id:
            if uc_id in seen_ids:
                errors_found = True
                print(f"❌ Duplicate id '{uc_id}' (entries {seen_ids[uc_id]} and {i})")
            else:
                seen_ids[uc_id] = i

    if errors_found:
        print(f"\nValidation failed for one or more of {len(use_cases)} use cases.")
        sys.exit(1)

    print(f"✅ All {len(use_cases)} use cases are valid. No duplicate ids.")


if __name__ == "__main__":
    main()
