"""Containment, source-lineage and privacy checks for code-change examples."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('code_change_builder', ROOT / 'scripts/build-parcel-code-change-examples.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def square(x0=0, y0=0, x1=10, y1=10):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]


class StrictContainmentTests(unittest.TestCase):
    def test_concavity_holes_and_boundaries_are_not_confused_with_inside(self):
        geometry = {'type': 'Polygon', 'coordinates': [square(), square(3, 3, 7, 7)]}
        self.assertTrue(builder.strict_inside((1, 1), geometry))
        for point in ((5, 5), (0, 5), (0, 0), (3, 5), (3, 3), (12, 5)):
            self.assertFalse(builder.strict_inside(point, geometry), point)
        concave = {'type': 'Polygon', 'coordinates': [[[0, 0], [10, 0], [10, 3], [3, 3], [3, 10], [0, 10], [0, 0]]]}
        self.assertTrue(builder.strict_inside((2, 8), concave))
        self.assertFalse(builder.strict_inside((8, 8), concave))
        self.assertFalse(builder.strict_inside((3, 8), concave))

    def test_disjoint_multipolygons_and_reversed_ring_orientation(self):
        geometry = {'type': 'MultiPolygon', 'coordinates': [[square()], [list(reversed(square(20, 20, 30, 30)))]]}
        self.assertTrue(builder.strict_inside((25, 25), geometry))
        self.assertFalse(builder.strict_inside((15, 15), geometry))
        self.assertFalse(builder.strict_inside((20, 25), geometry))

    def test_missing_outside_and_boundary_points_are_withheld_not_repaired(self):
        source = {'map_lat': '5', 'map_long': '0', 'geometry_geojson': json.dumps({'type': 'Polygon', 'coordinates': [square()]})}
        self.assertEqual(builder.point_for_code('missing', {}), (None, 'code-not-found'))
        self.assertEqual(builder.point_for_code('A', {'A': source}), (None, 'point-outside-geometry'))
        for missing in ('', 'nan', 'inf', 'not a coordinate'):
            self.assertEqual(builder.point_for_code('A', {'A': {**source, 'map_lat': missing}}), (None, 'point-missing'))
        original = copy.deepcopy(source)
        point, status = builder.point_for_code('A', {'A': {**source, 'map_long': '5'}})
        self.assertEqual((point, status), ({'lat': 5.0, 'lon': 5.0}, 'point-inside-geometry'))
        self.assertEqual(source, original)


class PublicArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.governance = json.loads((ROOT / 'governance/parcel-code-change-assessment.json').read_text())
        cls.asset = ROOT / cls.governance['public_asset']['path']
        cls.payload = json.loads(cls.asset.read_text())

    def test_asset_integrity_and_full_population_totals_are_separate_from_sample(self):
        metadata = self.governance['public_asset']
        self.assertEqual(hashlib.sha256(self.asset.read_bytes()).hexdigest(), metadata['sha256'])
        self.assertEqual(self.asset.stat().st_size, metadata['bytes'])
        summary = self.payload['summary']
        self.assertEqual(summary['changed_parcel_codes'], 5069)
        self.assertEqual(summary['address_unchanged'] + summary['address_changed'], 5069)
        self.assertEqual(summary['new_ltax_code_found'] + summary['new_ltax_code_not_found'], 5069)
        self.assertEqual(sum(summary['old_ltax_status_counts'].values()), 5069)
        self.assertEqual(sum(summary['new_ltax_status_counts'].values()), 5069)
        self.assertEqual(summary['example_count'], len(self.payload['records']))
        self.assertEqual(sum(summary['example_groups'].values()), 40)

    def test_allowlist_and_grammars_reject_person_and_registry_data(self):
        for record in self.payload['records']:
            builder.validate_record(record)
        record = self.payload['records'][0]
        for field, value in (('house_reg_id', '1111-222222-3'), ('building_id', 'PRIVATE-BUILDING'), ('owner_name', 'PRIVATE PERSON')):
            with self.assertRaises(ValueError):
                builder.validate_record({**record, field: value})
        for value in ('1111-222222-3', '0812345678', 'PRIVATE PERSON', '<script>'):
            self.assertFalse(builder.safe_house(value))
        self.assertFalse(builder.safe_road('PRIVATE PERSON'))
        self.assertTrue(builder.safe_house('6/1-5'))
        self.assertTrue(builder.safe_house('4-4/6'))

    def test_source_lineage_reproducibility_and_containment_when_sources_available(self):
        base = Path('/Users/montri/Downloads')
        old_path = base / 'รายการสิ่งปลูกสร้าง_04-09-2026_14-00-40.csv'
        new_path = base / 'รายการสิ่งปลูกสร้าง_11-11-2026_09-59-29.xlsx'
        ltax_path = base / 'ltax_saensuk_04200103.csv'
        if not all(path.exists() for path in (old_path, new_path, ltax_path)):
            self.skipTest('Private exact sources unavailable in this environment')
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            rebuilt = builder.build(old_path, new_path, ltax_path, temp / 'public', temp / 'private-lineage.json')
            actual = (temp / 'public' / rebuilt['public_asset']['path']).read_bytes()
            self.assertEqual(actual, self.asset.read_bytes())
            lineage = json.loads((temp / 'private-lineage.json').read_text())
            old, new = builder.read_buildings(old_path, new_path)
            self.assertEqual(len(lineage['records']), 40)
            for expected, link in zip(self.payload['records'], lineage['records']):
                old_row, before = old[link['stable_building_id']]
                new_row, after = new[link['stable_building_id']]
                self.assertEqual((old_row, new_row), (link['old_source_row'], link['new_source_row']))
                self.assertEqual(expected['old_parcel_code'], before['รหัสแปลงที่ดิน'])
                self.assertEqual(expected['new_parcel_code'], after['รหัสแปลงที่ดิน'])
                self.assertEqual(expected['house_no_before'], before['บ้านเลขที่'])
                self.assertEqual(expected['house_no_after'], after['บ้านเลขที่'])
                self.assertNotIn(link['stable_building_id'], self.asset.read_text())


if __name__ == '__main__':
    unittest.main()
