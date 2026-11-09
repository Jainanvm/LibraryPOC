#!/usr/bin/env python3
"""Import selected use-case drafts into data/use-cases.json."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
USE_CASES_FILE = ROOT / "data" / "use-cases.json"
SCHEMA_FILE = ROOT / "data" / "schema.json"


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read {path}: {exc}") from exc


def import_drafts(drafts_file, requested_ids):
    if not requested_ids:
        raise ValueError("Select at least one draft with --ids.")
    if len(set(requested_ids)) != len(requested_ids):
        raise ValueError("--ids contains duplicate values.")

    draft_data = load_json(drafts_file)
    selected = {
        draft.get("useCase", {}).get("id"): draft
        for draft in draft_data.get("drafts", [])
        if isinstance(draft, dict) and isinstance(draft.get("useCase"), dict)
    }
    missing = sorted(set(requested_ids) - selected.keys())
    if missing:
        raise ValueError("Draft id(s) not found: " + ", ".join(missing))

    catalog = load_json(USE_CASES_FILE)
    schema = load_json(SCHEMA_FILE)
    try:
        from jsonschema import Draft7Validator
    except ImportError as exc:
        raise ValueError("Missing dependency. Run: pip install jsonschema") from exc

    validator = Draft7Validator(schema)
    existing_ids = {item.get("id") for item in catalog.get("useCases", [])}
    existing_titles = {item.get("title", "").strip().casefold() for item in catalog.get("useCases", [])}
    additions = []

    for use_case_id in requested_ids:
        draft = selected[use_case_id]
        use_case = dict(draft["useCase"])
        if use_case_id in existing_ids:
            raise ValueError(f"Use-case id already exists in the live catalog: {use_case_id}")
        title_key = use_case.get("title", "").strip().casefold()
        if title_key in existing_titles:
            raise ValueError(f"Use-case title already exists in the live catalog: {use_case.get('title')}")
        source = draft.get("source")
        source_url = source.get("url") if isinstance(source, dict) else None
        if not isinstance(source_url, str) or not re.match(r"^https?://", source_url):
            raise ValueError(f"{use_case_id} is missing a valid HTTP(S) source URL.")
        source_data = {
            "title": source.get("title", ""),
            "url": source_url,
            "retrievedAt": source.get("retrievedAt", ""),
        }
        source_summary = draft.get("sourceSummary")
        source_evidence = draft.get("sourceEvidence")
        if source_summary is not None or source_evidence is not None:
            if not isinstance(source_summary, str) or not source_summary.strip():
                raise ValueError(f"{use_case_id} is missing its source-grounded summary.")
            if not isinstance(source_evidence, list) or not source_evidence:
                raise ValueError(f"{use_case_id} is missing source evidence.")
            source_data["summary"] = source_summary
            source_data["evidence"] = source_evidence
        use_case["source"] = source_data
        errors = list(validator.iter_errors(use_case))
        if errors:
            details = "; ".join(
                f"{'.'.join(str(part) for part in error.path) or '(root)'}: {error.message}"
                for error in errors[:5]
            )
            raise ValueError(f"{use_case_id} failed schema validation: {details}")
        additions.append(use_case)
        existing_ids.add(use_case_id)
        existing_titles.add(title_key)

    catalog.setdefault("useCases", []).extend(additions)
    catalog["lastUpdated"] = datetime.now().date().isoformat()
    return catalog, additions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("drafts", type=Path, help="Draft bundle created by crawl_use_cases.py")
    parser.add_argument("--ids", nargs="+", required=True, help="Draft use-case ids to import")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without changing the catalog")
    args = parser.parse_args()

    catalog, additions = import_drafts(args.drafts, args.ids)
    print("Validated use case(s): " + ", ".join(item["id"] for item in additions))
    if args.dry_run:
        print("Dry run — the live catalog was not changed.")
        return

    serialized = json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", dir=USE_CASES_FILE.parent, delete=False
    ) as temporary:
        temporary.write(serialized)
        temp_path = Path(temporary.name)
    try:
        temp_path.replace(USE_CASES_FILE)
    except OSError:
        temp_path.unlink(missing_ok=True)
        raise
    print(f"Imported {len(additions)} use case(s) into data/use-cases.json.")
    print("Run python scripts/validate.py to check the full catalog.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
