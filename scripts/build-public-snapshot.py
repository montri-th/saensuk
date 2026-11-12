#!/usr/bin/env python3
"""Build the owner-authorized public point projection from private local inputs.

Private inputs are never copied into the release tree. Household-to-candidate
joins happen only while building. The owner separately approved publication of
the source household registry identifier; public_id remains a display sequence.
Every parcel candidate remains unverified.
"""

import argparse
import collections
import csv
import gzip
import hashlib
import json
import math
import re
from pathlib import Path

SCHEMA_VERSION = "saensuk-public-points-3"
RELEASE_ID = "public-20261112-registry"
DISPLAY_SHA256 = "a57f1462fdc5b23f88d90856b0e2556d2d231d6e0b17af3468e133ed2770d8f5"
CANDIDATE_SHA256 = "bb68abbca7bea680b7f1d40bb72d51f3feabf45b9077a6e227ee3dbb4bc1ae03"
PREVIOUS_PUBLIC_SHA256 = "74080982aded398033ab40f71062557539fec09829d54df95db9a6e3cf3fd54f"
LTAX_SHA256 = "38e4d737533f7e639ce0ff43c631c13bc471bbe19cd44f76bcb225a5ec12eb06"
BUILDINGS_SHA256 = "36b5c91e8de4f587468e20c00175dba18cba2d8b4f38e62779abe7c6f1cb4a66"

ROADS = frozenset((
    "ถนน บางแสนสาย 2", "ถนน ลงหาดบางแสน", "ถนน สุขุมวิท", "ถนน แสนสุข",
    "ถนน บางแสนสาย 4 ใต้", "ถนน สันติเกษม", "ถนน บางแสนล่าง", "ถนน เนตรดี",
    "ถนน รอบเขาสามมุข", "ถนน มิตรสัมพันธ์", "ถนน บางแสน-อ่างศิลา", "ถนน บางแสนสาย 3",
    "ถนน บางแสนสาย 1", "ถนน เปรมใจราษฎร์", "ถนน มาบมะยม", "ถนน หลังวัดกลางดอน",
    "ถนน บางแสนสาย 4 เหนือ", "ถนน ข้าวหลาม", "ถนน เทศบาลพัฒนา 1", "ถนน เทศบาลพัฒนา 2",
))
COMMUNITIES = frozenset((
    "ชุมชน สมใจนึก", "ชุมชน หน้ามอโชคดี", "ชุมชน วัดแสนสุข", "ชุมชน บางแสนบน",
    "ชุมชน หาดวอนนภา", "ชุมชน ตาลล้อม 2", "ชุมชน ดอนบน", "ชุมชน มณีแก้ว",
    "ชุมชน ร่วมใจพัฒนา", "ชุมชน ท้ายตลาด", "ชุมชน บ้านเหมือง", "ชุมชน แสนสุข",
    "ชุมชน มุขแสนเจริญ", "ชุมชน เขาสามมุข", "ชุมชน วัดกลางดอน", "ชุมชน บางเป้ง",
    "ชุมชน บ้านแหลมแท่น", "ชุมชน หน้าเทศบาล", "ชุมชน ตาลล้อม 1", "ชุมชน บางแสนทาวเวอร์",
    "ชุมชน มาบมะยม", "ชุมชน พัฒนา 2", "ชุมชน ดอนนารา",
))
PLACE_TYPES = frozenset((
    "บ้าน", "สถานที่ราชการ", "บ้านพักข้าราชการ", "บ้านแฝด", "สำนักสงฆ์", "วัด", "สำนักงาน",
    "อาคารชุด", "โรงแรม", "ตึกแถว", "ร้านค้า", "อาคาร", "อื่นๆ", "โรงพยาบาล", "หอพัก",
    "ทาวน์โฮม", "โกดัง", "ทะเบียนบ้านชั่วคราว", "ตึก", "รัฐวิสาหกิจ", "เรือ", "สถานศึกษา",
    "ทาวน์เฮ้าส์", "ห้องแถว", "-", "สโมสร", "บริษัท", "โรงงาน", "อาคารอเนกประสงค์",
    "คลังสินค้า-อยู่อาศัย", "เรือนจำ", "แฟลต",
))
CONFIDENCE = {
    "A0 สำรวจสิ่งปลูกสร้างของเทศบาล": "A0",
    "A จับคู่จากที่อยู่เจ้าของ": "A",
    "B จับคู่แบบมีเงื่อนไข": "B",
    "C ยังไม่มีพิกัด ต้องตรวจ": "C",
    "D ค่าประมาณกลุ่ม": "D",
}
STATUSES = frozenset(("prototype-unverified", "needs-review", "approximate-unverified", "building-lookup-pending", "desk-lookup-unverified"))
GEOMETRIES = frozenset(("parcel", "review", "cluster", "soi_road", "interpolated", "building", "community"))
TIERS = frozenset(("A0", "A1", "A2", "B2", "B3", "B4", "B5", "B6", "B7", "C1", "C2", "C3", "C4", "C5", "D"))
ROW_FIELDS = frozenset(("public_id", "house_reg_id", "house_no", "road", "community", "place_type", "lat", "lon", "radius_m", "tier", "confidence_band", "status", "geom_level", "candidate"))
CANDIDATE_FIELDS = frozenset(("lat", "lon", "shift_m", "conflict", "auxiliary", "nonresidential"))
TOP_FIELDS = frozenset(("schema_version", "release_id", "snapshot", "summary", "records"))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def finite_number(value, *, nullable=False):
    if value in (None, "") and nullable:
        return None
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite public numeric value")
    return number


def controlled(value, values, label):
    if value not in values:
        raise ValueError(f"Unexpected {label}; cannot release unreviewed free text")
    return value


def house_number(value):
    # Retain the exact approved source spelling, including double slashes and ก.
    # This bounded house-number grammar cannot carry owner names or registry IDs.
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,6}(?:/{1,2}[0-9]{1,6})?(?: ?[ก-ฮ]\.?)?", value):
        raise ValueError("Unexpected house number; cannot release free text")
    return value


def house_registry_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{6}-[0-9]", value):
        raise ValueError("Unexpected house registry identifier; preserve the approved source string")
    return value


def public_candidate(row):
    if row.get("candidate_status") != "candidate-unverified" or row.get("can_auto_apply") is not False:
        raise ValueError("Parcel candidates may not be marked verified or auto-applied")
    if row.get("proposal_action") != "compare-only-no-autoapply" or row.get("candidate_inside_source_polygon") is not True:
        raise ValueError("Parcel candidate is not an approved comparison-only source point")
    if row.get("source_ltax_sha256") != LTAX_SHA256 or row.get("source_new_buildings_sha256") != BUILDINGS_SHA256:
        raise ValueError("Parcel candidate source hash mismatch")
    relation = controlled(row.get("parcel_relation"), ("old_parcel_blank", "different_old_parcel"), "parcel relation")
    flags = (row.get("auxiliary_structure_candidate"), row.get("other_nonresidential_type_candidate"))
    if any(type(flag) is not bool for flag in flags):
        raise ValueError("Candidate flags must be booleans")
    return {
        "lat": finite_number(row["candidate_parcel_lat"]),
        "lon": finite_number(row["candidate_parcel_lon"]),
        "shift_m": finite_number(row.get("shift_m"), nullable=True),
        "conflict": relation == "different_old_parcel",
        "auxiliary": flags[0],
        "nonresidential": flags[1],
    }


def project_records(source_rows, private_candidates):
    by_id = {}
    for candidate in private_candidates:
        private_id = candidate["house_reg_id"]
        if private_id in by_id:
            raise ValueError("Duplicate private candidate join key")
        by_id[private_id] = candidate
    records = []
    seen_ids = set()
    for row in source_rows:
        private_id = row["house_reg_id"]
        if not private_id or private_id in seen_ids:
            raise ValueError("Missing or duplicate private source join key")
        seen_ids.add(private_id)
        candidate = by_id.get(private_id)
        if candidate:
            for old_field, source_field in (("original_lat", "lat"), ("original_lon", "lon"), ("old_tier", "tier")):
                if str(candidate[old_field]) != str(row[source_field]):
                    raise ValueError("Candidate original source does not match display snapshot")
        record = {
            "public_id": "",
            "house_reg_id": house_registry_id(private_id),
            "house_no": house_number(row["house_no"]),
            "road": controlled(row["road"], ROADS, "road"),
            "community": controlled(row["community"], COMMUNITIES, "community"),
            "place_type": controlled(row["place_type"], PLACE_TYPES, "place type"),
            "lat": finite_number(row["lat"], nullable=True),
            "lon": finite_number(row["lon"], nullable=True),
            "radius_m": finite_number(row["radius_m"], nullable=True),
            "tier": controlled(row["tier"], TIERS, "tier"),
            "confidence_band": controlled(row["confidence_band"], CONFIDENCE, "confidence band"),
            "status": controlled(row["status"], STATUSES, "status"),
            "geom_level": controlled(row["geom_level"], GEOMETRIES, "geometry level"),
            "candidate": public_candidate(candidate) if candidate else None,
        }
        records.append(record)
    if not set(by_id).issubset(seen_ids):
        raise ValueError("Candidate is absent from source snapshot")
    # Order is geographic/category display order, not private source-file order.
    records.sort(key=lambda r: (r["community"], r["road"], r["lat"] is None, r["lat"] or 0, r["lon"] or 0, r["tier"], r["place_type"]))
    for index, record in enumerate(records, 1):
        record["public_id"] = f"P{index:06d}"
    return records


def migrate_records(source_rows, previous_snapshot):
    """Add only approved registry identifiers while retaining the public mapping.

    The caller pins the compressed input hash. Every source-derived public field
    must also match after the identical stable geographic/category sort, so a
    changed source, ordering or coordinate cannot attach a candidate to a new row.
    """
    if set(previous_snapshot) != TOP_FIELDS or previous_snapshot["schema_version"] != "saensuk-public-points-2" or previous_snapshot["release_id"] != "public-20261112":
        raise ValueError("Unexpected previous public snapshot")
    records = project_records(source_rows, [])
    previous_records = previous_snapshot["records"]
    if not isinstance(previous_records, list) or len(previous_records) != len(records):
        raise ValueError("Previous public record count mismatch")
    for record, previous in zip(records, previous_records):
        if set(previous) != ROW_FIELDS - {"house_reg_id"}:
            raise ValueError("Previous public record field mismatch")
        current_source = {key: value for key, value in record.items() if key not in ("house_reg_id", "candidate")}
        previous_source = {key: value for key, value in previous.items() if key != "candidate"}
        if current_source != previous_source:
            raise ValueError("Previous public record does not match exact source projection")
        record["candidate"] = dict(previous["candidate"]) if previous["candidate"] is not None else None
    return records


def validate_snapshot(snapshot):
    if set(snapshot) != TOP_FIELDS or snapshot["schema_version"] != SCHEMA_VERSION or snapshot["release_id"] != RELEASE_ID:
        raise ValueError("Invalid public snapshot header")
    if snapshot["snapshot"] != {"source_date": "2026-09-08", "rules": "1.9.0", "buildings_received_date": "2026-11-11"}:
        raise ValueError("Invalid public snapshot dates")
    counts = collections.Counter()
    ids = set()
    registry_ids = set()
    bands = collections.Counter()
    for index, row in enumerate(snapshot["records"], 1):
        if set(row) != ROW_FIELDS or row["public_id"] != f"P{index:06d}" or row["public_id"] in ids:
            raise ValueError("Invalid public record fields or identifier")
        ids.add(row["public_id"])
        source_id = house_registry_id(row["house_reg_id"])
        if source_id in registry_ids:
            raise ValueError("Duplicate public house registry identifier")
        registry_ids.add(source_id)
        house_number(row["house_no"])
        for field, values in (("road", ROADS), ("community", COMMUNITIES), ("place_type", PLACE_TYPES), ("tier", TIERS), ("confidence_band", CONFIDENCE), ("status", STATUSES), ("geom_level", GEOMETRIES)):
            controlled(row[field], values, field)
        if (row["lat"] is None) != (row["lon"] is None):
            raise ValueError("Partial source coordinate pair")
        if row["lat"] is not None and not (-90 <= finite_number(row["lat"]) <= 90 and -180 <= finite_number(row["lon"]) <= 180):
            raise ValueError("Invalid source coordinates")
        if row["radius_m"] is not None and not (0 <= finite_number(row["radius_m"]) <= 100000):
            raise ValueError("Invalid source radius")
        counts["rows"] += 1
        counts["with_coordinates" if row["lat"] is not None else "without_coordinates"] += 1
        bands[CONFIDENCE[row["confidence_band"]]] += 1
        candidate = row["candidate"]
        if candidate is not None:
            if set(candidate) != CANDIDATE_FIELDS:
                raise ValueError("Invalid public candidate fields")
            if not (-90 <= finite_number(candidate["lat"]) <= 90 and -180 <= finite_number(candidate["lon"]) <= 180):
                raise ValueError("Invalid parcel candidate coordinate")
            if any(type(candidate[k]) is not bool for k in ("conflict", "auxiliary", "nonresidential")):
                raise ValueError("Invalid parcel candidate flag")
            if candidate["shift_m"] is not None and finite_number(candidate["shift_m"]) < 0:
                raise ValueError("Invalid candidate distance")
            if (row["lat"] is None) != (candidate["shift_m"] is None):
                raise ValueError("Candidate distance missingness mismatch")
            if row["tier"] != "D" and not row["tier"].startswith("C"):
                raise ValueError("Candidate may not override stronger source tiers")
            counts["parcel_candidates"] += 1
            counts["parcel_candidates_conflict" if candidate["conflict"] else "parcel_candidates_no_known_conflict"] += 1
    summary = {**dict(counts), "confidence_counts": dict(sorted(bands.items()))}
    expected = {"rows": 42524, "with_coordinates": 40236, "without_coordinates": 2288, "parcel_candidates": 70, "parcel_candidates_no_known_conflict": 68, "parcel_candidates_conflict": 2, "confidence_counts": {"A0": 10114, "A": 1855, "B": 744, "C": 2288, "D": 27523}}
    if summary != expected or snapshot["summary"] != expected:
        raise ValueError("Public snapshot aggregate mismatch")
    return summary


def assert_approved_identifier_projection(payload, source_rows, candidates):
    """Permit exact approved registry IDs only in their dedicated record field.

    Owner/contact and source parcel/building identifiers remain excluded. The
    allowlist validator runs before this independent identifier-integrity scan.
    """
    source_ids = {house_registry_id(row["house_reg_id"]) for row in source_rows}
    id_pattern = r"[0-9]{4}-[0-9]{6}-[0-9]"
    decoded = json.loads(payload.decode("utf-8"))
    if not isinstance(decoded, dict) or not isinstance(decoded.get("records"), list):
        raise ValueError("Missing public records for identifier verification")
    published_ids = [row.pop("house_reg_id", None) for row in decoded["records"]]
    if any(not isinstance(value, str) for value in published_ids) or len(published_ids) != len(source_rows) or len(set(published_ids)) != len(published_ids) or set(published_ids) != source_ids:
        raise ValueError("Approved registry identifiers must equal the exact source once each")
    if re.search(id_pattern, json.dumps(decoded, ensure_ascii=False)):
        raise ValueError("House registry identifiers may appear only in their approved field")
    if re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", payload.decode("utf-8"), flags=re.I):
        raise ValueError("Excluded source object UUID in public projection")
    for candidate in candidates:
        for field in ("original_source_parcel_id", "new_source_parcel_id", "new_tax_parcel_code", "building_id"):
            value = candidate.get(field)
            if value and str(value).encode("utf-8") in payload:
                raise ValueError("Private parcel/building identifier leaked into projection")


def display_coordinate_policy(records):
    eligible = []
    for record in records:
        candidate = record["candidate"]
        if not candidate or any(candidate[key] for key in ("conflict", "auxiliary", "nonresidential")):
            continue
        eligible_D = record["tier"] == "D" and candidate["shift_m"] is not None and record["radius_m"] is not None and candidate["shift_m"] <= 500 and candidate["shift_m"] <= record["radius_m"]
        eligible_C = record["tier"].startswith("C") and record["lat"] is None and record["lon"] is None
        if eligible_D or eligible_C:
            eligible.append(record)
    from_D = sum(record["tier"] == "D" for record in eligible)
    from_C = sum(record["tier"].startswith("C") for record in eligible)
    if (len(eligible), from_D, from_C) != (34, 30, 4):
        raise ValueError("Display-coordinate policy count mismatch")
    return {
        "mode": "best_available_working_position",
        "default_view": "all_records",
        "default_record_count": 42524,
        "source_coordinates_immutable": True,
        "source_tier_status_immutable": True,
        "source_coordinate_records": 40236,
        "source_missing_coordinate_records": 2288,
        "working_position_records": 40240,
        "working_missing_position_records": 2284,
        "source_priority_bands": ["A0", "A", "B"],
        "candidate_status": "candidate-unverified",
        "candidate_geometry_level": "parcel",
        "candidate_guards": {
            "no_known_prior_parcel_conflict": True,
            "exclude_auxiliary_structures": True,
            "exclude_other_nonresidential_types": True,
            "D_requires_finite_shift_and_source_radius": True,
            "D_maximum_shift_m": 500,
            "D_shift_must_not_exceed_source_radius": True,
            "C_requires_both_original_coordinates_missing": True,
            "A0_A_B_source_positions_never_replaced": True,
        },
        "working_parcel_fallback_records": 34,
        "working_parcel_fallback_from_D": 30,
        "working_parcel_fallback_from_C": 4,
        "remaining_candidates_comparison_only": 36,
        "radius_policy": "Original radius is source evidence context, not a calibrated accuracy estimate for a parcel working point.",
        "claim_boundary": "A working parcel position is not a verified dwelling, entrance, occupancy or measured accuracy improvement.",
        "automatic_source_updates": False,
    }


def build(display_path, candidates_path, output_root, previous_public_path=None):
    if sha256(display_path) != DISPLAY_SHA256:
        raise ValueError("Private input hash mismatch; do not mix snapshots")
    if (candidates_path is None) == (previous_public_path is None):
        raise ValueError("Provide exactly one approved candidate or previous public input")
    with Path(display_path).open(encoding="utf-8-sig", newline="") as handle:
        source_rows = list(csv.DictReader(handle))
    if previous_public_path is not None:
        if sha256(previous_public_path) != PREVIOUS_PUBLIC_SHA256:
            raise ValueError("Previous public input hash mismatch")
        previous = json.loads(gzip.decompress(Path(previous_public_path).read_bytes()).decode("utf-8"))
        records = migrate_records(source_rows, previous)
        candidates = []
    else:
        if sha256(candidates_path) != CANDIDATE_SHA256:
            raise ValueError("Private candidate input hash mismatch")
        candidates = json.loads(Path(candidates_path).read_text(encoding="utf-8"))
        records = project_records(source_rows, candidates)
    summary = {"rows": 42524, "with_coordinates": 40236, "without_coordinates": 2288, "confidence_counts": {"A0": 10114, "A": 1855, "B": 744, "C": 2288, "D": 27523}, "parcel_candidates": 70, "parcel_candidates_no_known_conflict": 68, "parcel_candidates_conflict": 2}
    snapshot = {"schema_version": SCHEMA_VERSION, "release_id": RELEASE_ID, "snapshot": {"source_date": "2026-09-08", "rules": "1.9.0", "buildings_received_date": "2026-11-11"}, "summary": summary, "records": records}
    validate_snapshot(snapshot)
    payload = (json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    # Verify source registry IDs exactly once, and all other excluded keys absent.
    assert_approved_identifier_projection(payload, source_rows, candidates)
    decoded_digest = hashlib.sha256(payload).hexdigest()
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    digest = hashlib.sha256(compressed).hexdigest()
    relative_path = f"assets/data/public-housepoints-{digest[:12]}.json.gz"
    destination = Path(output_root) / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.read_bytes() != compressed:
        raise ValueError("Immutable public asset collision")
    destination.write_bytes(compressed)
    manifest = {
        "schema_version": "saensuk-public-data-review-3",
        "release_id": RELEASE_ID,
        "owner_authorization": "owner-message:2026-11-12:public-house-number-and-house-registry-id-approved",
        "previous_owner_authorization": "owner-message:2026-11-12:public-house-number-and-road-approved",
        "audience": "public",
        "public_asset": {"path": relative_path, "sha256": digest, "bytes": len(compressed), "mime_type": "application/gzip", "stored_compression": "gzip", "decoded": {"sha256": decoded_digest, "bytes": len(payload), "mime_type": "application/json"}},
        "snapshot": snapshot["snapshot"],
        "summary": summary,
        "source_hashes": {"display_v3_sha256": DISPLAY_SHA256, "private_candidate70_sha256": CANDIDATE_SHA256, "ltax_sha256": LTAX_SHA256, "buildings_received_sha256": BUILDINGS_SHA256, **({"previous_public_sha256": PREVIOUS_PUBLIC_SHA256} if previous_public_path is not None else {})},
        "fields_allowed": sorted(ROW_FIELDS),
        "candidate_fields_allowed": sorted(CANDIDATE_FIELDS),
        "fields_excluded": ["owner_names", "contact_details", "trok", "soi", "source_parcel_id", "tax_parcel_codes", "building_id", "business_names", "reviewer_metadata", "review_notes"],
        "disclosure": "Contains original source house numbers and 11-digit household registry identifiers in their original formatted strings, controlled road/community labels, household point coordinates and separate unverified parcel candidate coordinates under explicit owner authorization. These public addresses, identifiers and coordinates can identify a location; owner names, contact details and source parcel/building identifiers remain excluded from this point dataset.",
        "public_id_meaning": "Snapshot-specific display sequence after geographic/category sorting; not a municipal registry identifier.",
        "candidate_policy": {"status": "candidate-unverified", "auto_apply": False, "source_fields_unchanged": True, "newly_field_verified": 0},
        "display_coordinate_policy": display_coordinate_policy(records),
        "checks": {"approved_house_registry_ids_preserved_from_exact_source": len(source_rows), "approved_house_registry_ids_unique": len({row["house_reg_id"] for row in records}), "registry_identifiers_only_in_approved_field": True, "private_candidate_parcel_and_building_ids_absent": 70, "candidate_identifier_check": "inherited hash-pinned public projection; all candidate values unchanged" if previous_public_path is not None else "actual private candidate identifiers scanned", "strict_field_allowlist": True, "controlled_text_vocabularies": True, "strict_house_number_grammar": True, "house_numbers_preserved_from_exact_source": len(source_rows), "source_hashes_match": True, "aggregate_counts_match": True, **({"previous_public_source_fields_equal": len(records), "only_added_record_field": "house_reg_id"} if previous_public_path is not None else {})},
    }
    manifest_path = Path(output_root) / "governance/public-data-release.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--display", type=Path, required=True, help="Approved private display v3 CSV outside publication root")
    candidate_input = parser.add_mutually_exclusive_group(required=True)
    candidate_input.add_argument("--candidates", type=Path, help="Private reviewed candidate70 JSON outside publication root")
    candidate_input.add_argument("--previous-public-snapshot", type=Path, help="Exact approved public v2 gzip; candidate fields are retained unchanged after full source parity")
    parser.add_argument("--output-root", type=Path, required=True, help="Existing public repository root")
    arguments = parser.parse_args()
    root = arguments.output_root.resolve()
    for path in [arguments.display.resolve()] + ([arguments.candidates.resolve()] if arguments.candidates is not None else []):
        if path == root or root in path.parents:
            parser.error("Private inputs must be outside the public repository")
    result = build(arguments.display, arguments.candidates, root, arguments.previous_public_snapshot)
    print(json.dumps({"public_asset": result["public_asset"], "summary": result["summary"], "checks": result["checks"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
