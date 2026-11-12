"""Synthetic failure-mode tests for the private-to-public field projection."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "build-public-snapshot.py"
spec = importlib.util.spec_from_file_location("public_snapshot_builder", MODULE_PATH)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def source(**changes):
    row = {
        "house_reg_id": "1111-222222-3", "house_no": "22/9 ก.", "road": "ถนน แสนสุข",
        "community": "ชุมชน แสนสุข", "place_type": "บ้าน", "lat": "13.2", "lon": "100.9",
        "radius_m": "100", "tier": "D", "confidence_band": "D ค่าประมาณกลุ่ม",
        "status": "approximate-unverified", "geom_level": "soi_road", "owner1_name": "PRIVATE PERSON",
    }
    row.update(changes)
    return row


def candidate(**changes):
    row = {
        "house_reg_id": "1111-222222-3", "original_lat": "13.2", "original_lon": "100.9", "old_tier": "D",
        "candidate_status": "candidate-unverified", "can_auto_apply": False, "proposal_action": "compare-only-no-autoapply",
        "candidate_inside_source_polygon": True, "source_ltax_sha256": builder.LTAX_SHA256,
        "source_new_buildings_sha256": builder.BUILDINGS_SHA256, "parcel_relation": "old_parcel_blank",
        "auxiliary_structure_candidate": False, "other_nonresidential_type_candidate": False,
        "candidate_parcel_lat": 13.21, "candidate_parcel_lon": 100.91, "shift_m": 1000.0,
        "building_id": "PRIVATE-BUILDING", "new_tax_parcel_code": "PRIVATE-PARCEL",
    }
    row.update(changes)
    return row


class ProjectionTests(unittest.TestCase):
    def test_allowlist_drops_private_source_and_candidate_fields(self):
        projected = builder.project_records([source()], [candidate()])[0]
        self.assertEqual(set(projected), builder.ROW_FIELDS)
        self.assertEqual(set(projected["candidate"]), builder.CANDIDATE_FIELDS)
        self.assertNotIn("PRIVATE", str(projected))
        self.assertEqual(projected["house_no"], "22/9 ก.")
        self.assertEqual(projected["house_reg_id"], source()["house_reg_id"])
        self.assertEqual(projected["lat"], 13.2)
        self.assertEqual(projected["candidate"]["lat"], 13.21)

    def test_unknown_free_text_place_type_cannot_leak_into_public_data(self):
        with self.assertRaises(ValueError):
            builder.project_records([source(place_type="PRIVATE PERSON")], [])

    def test_unknown_road_cannot_leak_into_public_data(self):
        with self.assertRaises(ValueError):
            builder.project_records([source(road="PRIVATE ADDRESS")], [])

    def test_house_number_grammar_preserves_source_spelling_and_rejects_other_identifiers(self):
        for value in ("123", "22/9 ก.", "4//44", "73 ข", "20/15ค"):
            self.assertEqual(builder.project_records([source(house_no=value)], [])[0]["house_no"], value)
        for value in ("PRIVATE PERSON", "1111-222222-3", "0812345678", "123<script>", "123\n456", "", None):
            with self.assertRaises(ValueError):
                builder.project_records([source(house_no=value)], [])

    def test_registry_identifier_is_an_exact_formatted_source_string(self):
        for value in ("1111-222222-3", "0001-000001-0"):
            self.assertEqual(builder.project_records([source(house_reg_id=value)], [])[0]["house_reg_id"], value)
        for value in ("11112222223", 11112222223, "1111-222222-33", "1.1112222223e10", "PRIVATE PERSON", "", None):
            with self.assertRaises(ValueError):
                builder.project_records([source(house_reg_id=value)], [])

    def test_previous_public_migration_adds_only_registry_identifier_and_keeps_candidates_unchanged(self):
        previous_row = builder.project_records([source()], [candidate()])[0]
        del previous_row["house_reg_id"]
        previous = {"schema_version": "saensuk-public-points-2", "release_id": "public-20261112", "snapshot": {}, "summary": {}, "records": [previous_row]}
        original = copy.deepcopy(previous)
        migrated = builder.migrate_records([source()], previous)[0]
        self.assertEqual(migrated["house_reg_id"], source()["house_reg_id"])
        self.assertEqual({key: value for key, value in migrated.items() if key != "house_reg_id"}, previous_row)
        self.assertEqual(previous, original)
        self.assertIsNot(migrated["candidate"], previous_row["candidate"])

    def test_previous_public_migration_rejects_changed_source_values_or_order(self):
        previous_row = builder.project_records([source()], [candidate()])[0]
        del previous_row["house_reg_id"]
        for field, changed in (("public_id", "P000002"), ("house_no", "23/9 ก."), ("lon", 101.1), ("radius_m", 200), ("status", "needs-review"), ("place_type", "ร้านค้า")):
            previous = {"schema_version": "saensuk-public-points-2", "release_id": "public-20261112", "snapshot": {}, "summary": {}, "records": [{**previous_row, field: changed}]}
            with self.assertRaises(ValueError):
                builder.migrate_records([source()], previous)

    def test_duplicate_source_and_candidate_join_keys_fail(self):
        with self.assertRaises(ValueError):
            builder.project_records([source(), source()], [])
        with self.assertRaises(ValueError):
            builder.project_records([source()], [candidate(), candidate()])

    def test_candidate_original_must_equal_pinned_display_row(self):
        with self.assertRaises(ValueError):
            builder.project_records([source()], [candidate(original_lat="14.2")])

    def test_verified_or_autoapply_candidate_fails_closed(self):
        for changes in ({"candidate_status": "verified"}, {"can_auto_apply": True}, {"candidate_inside_source_polygon": False}):
            with self.assertRaises(ValueError):
                builder.project_records([source()], [candidate(**changes)])

    def test_inputs_and_original_coordinates_are_never_mutated(self):
        rows, proposals = [source()], [candidate()]
        original = copy.deepcopy((rows, proposals))
        builder.project_records(rows, proposals)
        self.assertEqual((rows, proposals), original)

    def test_null_coordinates_remain_null_while_candidate_is_separate(self):
        projected = builder.project_records([source(lat="", lon="", tier="C1", confidence_band="C ยังไม่มีพิกัด ต้องตรวจ", geom_level="review", status="needs-review")], [candidate(original_lat="", original_lon="", old_tier="C1", shift_m=None)])[0]
        self.assertIsNone(projected["lat"])
        self.assertIsNone(projected["lon"])
        self.assertIsNotNone(projected["candidate"]["lat"])
        self.assertIsNone(projected["candidate"]["shift_m"])

    def test_approved_registry_id_is_rejected_outside_its_dedicated_field(self):
        payload = json.dumps({"records": [{"house_reg_id": source()["house_reg_id"], "debug": "prefix1111-222222-3suffix"}]}).encode()
        with self.assertRaises(ValueError):
            builder.assert_approved_identifier_projection(payload, [source()], [])

    def test_published_registry_identifiers_must_match_source_once_each(self):
        for records in ([], [{"house_reg_id": "1111-222222-4"}], [{"house_reg_id": source()["house_reg_id"]}] * 2):
            with self.assertRaises(ValueError):
                builder.assert_approved_identifier_projection(json.dumps({"records": records}).encode(), [source()], [])

    def test_actual_parcel_and_building_id_leaks_fail(self):
        for field in ("new_tax_parcel_code", "building_id"):
            private = candidate()
            payload = json.dumps({"records": [{"house_reg_id": source()["house_reg_id"]}], "debug": private[field]}).encode()
            with self.assertRaises(ValueError):
                builder.assert_approved_identifier_projection(payload, [source()], [private])

    def test_identifier_scan_accepts_approved_registry_field_and_rejects_object_uuid(self):
        payload = {"records": [{"house_reg_id": source()["house_reg_id"], "public_id": "P000001", "lat": 13.2}]}
        builder.assert_approved_identifier_projection(json.dumps(payload).encode(), [source()], [candidate()])
        payload["debug"] = "12345678-1234-1234-1234-123456789abc"
        with self.assertRaises(ValueError):
            builder.assert_approved_identifier_projection(json.dumps(payload).encode(), [source()], [])


if __name__ == "__main__":
    unittest.main()
