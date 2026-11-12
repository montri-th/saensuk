#!/usr/bin/env python3
"""Build selected public code-change examples from exact private source bytes.

The owner requested old/new tax-code examples. Stable building identifiers are
used internally for comparison and never projected. Historical LTAX coordinates
are comparison references only; this builder never changes household points.
"""
import argparse
import collections
import csv
import hashlib
import json
import math
import re
from pathlib import Path

import openpyxl

SCHEMA_VERSION = 'saensuk-parcel-code-change-examples-1'
RELEASE_ID = 'parcel-code-changes-20261112'
EXPECTED_HASHES = {
    'old_buildings_sha256': '4a6070ff73f4e2f1775deac140ec92b0f8c34f59e77decf821d00cfad9c72283',
    'new_buildings_sha256': '36b5c91e8de4f587468e20c00175dba18cba2d8b4f38e62779abe7c6f1cb4a66',
    'ltax_sha256': '38e4d737533f7e639ce0ff43c631c13bc471bbe19cd44f76bcb225a5ec12eb06',
}
ROADS = (
    'ลงหาดบางแสน', 'สุขุมวิท', 'บางแสนสาย 4 ใต้', 'บางแสนสาย 4 เหนือ',
    'บางแสนสาย 2', 'บางแสนล่าง', 'แสนสุข', 'เปรมใจราษฎร์', 'มาบมะยม',
    'เทศบาลพัฒนา 1', 'เนตรดี', 'บางแสนสาย 3', 'บางแสนสาย 1', 'สันติเกษม',
    'มิตรสัมพันธ์', 'บางแสน-อ่างศิลา', 'เทศบาลพัฒนา 2', 'รอบเขาสามมุข',
    'ข้าวหลาม', 'หลังวัดกลางดอน',
)
STATUSES = ('code-not-found', 'point-missing', 'point-outside-geometry', 'point-inside-geometry')
GROUPS = ('same-address-missing-new-code', 'changed-address', 'both-historical-points',
          'one-or-no-historical-point', 'large-historical-separation')
RECORD_FIELDS = frozenset((
    'sample_id', 'house_no_before', 'house_no_after', 'road_before', 'road_after',
    'old_parcel_code', 'new_parcel_code', 'address_changed', 'old_ltax_point',
    'new_ltax_point', 'old_ltax_status', 'new_ltax_status',
    'historical_point_separation_m', 'group',
))
CODE_RE = re.compile(r'^[0-9]{1,3}[A-Z][0-9]{1,6}(?:[/_][0-9]{1,6})*$')
HOUSE_TOKEN = r'[0-9]{1,6}(?:/[0-9]{1,6})?[ก-ฮ]?'
HOUSE_RE = re.compile(rf'^{HOUSE_TOKEN}(?:\s*[-, ]\s*{HOUSE_TOKEN})*$')


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def normalized_road(value):
    value = value.replace('ถนน', '').replace('ถ.', '')
    return re.sub(r'[\s\.\-–_*]+', '', value).replace('ฏ', 'ฎ')


ROAD_KEYS = frozenset(normalized_road(road) for road in ROADS)


def safe_road(value):
    return len(value) <= 40 and (not value or normalized_road(value) in ROAD_KEYS)


def safe_house(value):
    return len(value) <= 48 and re.fullmatch(r'[0-9]{4}-[0-9]{6}-[0-9]', value) is None and (not value or HOUSE_RE.fullmatch(value) is not None)


def ring_location(point, ring):
    """Return -1 outside, 0 boundary, 1 inside; boundary is never accepted.

    Ray crossing supports concave rings. The small coordinate tolerance makes
    boundary rejection conservative; it does not move a source point.
    """
    if len(ring) < 4 or ring[0][:2] != ring[-1][:2]:
        raise ValueError('Unsupported unclosed or short source ring')
    px, py = point
    inside = False
    for start, end in zip(ring, ring[1:]):
        ax, ay = map(float, start[:2]); bx, by = map(float, end[:2])
        if not all(math.isfinite(v) for v in (ax, ay, bx, by)):
            raise ValueError('Non-finite source geometry')
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            if math.hypot(px - ax, py - ay) <= 1e-10:
                return 0
            continue
        cross = (px - ax) * dy - (py - ay) * dx
        if abs(cross) <= 1e-10 * math.hypot(dx, dy) and min(ax, bx) - 1e-10 <= px <= max(ax, bx) + 1e-10 and min(ay, by) - 1e-10 <= py <= max(ay, by) + 1e-10:
            return 0
        if (ay > py) != (by > py):
            intersection_x = ax + (py - ay) * dx / dy
            if px < intersection_x:
                inside = not inside
    return 1 if inside else -1


def strict_inside(point, geometry):
    if geometry.get('type') == 'Polygon':
        polygons = [geometry['coordinates']]
    elif geometry.get('type') == 'MultiPolygon':
        polygons = geometry['coordinates']
    else:
        raise ValueError('Unsupported source geometry type')
    for polygon in polygons:
        if not polygon:
            continue
        outer = ring_location(point, polygon[0])
        if outer == 0:
            return False
        if outer == 1:
            holes = [ring_location(point, ring) for ring in polygon[1:]]
            if any(location == 0 for location in holes):
                return False
            if not any(location == 1 for location in holes):
                return True
    return False


def point_for_code(code, parcels):
    source = parcels.get(code)
    if source is None:
        return None, 'code-not-found'
    try:
        lat, lon = float(source['map_lat']), float(source['map_long'])
    except (TypeError, ValueError):
        return None, 'point-missing'
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        return None, 'point-missing'
    geometry = json.loads(source['geometry_geojson'])
    if not strict_inside((lon, lat), geometry):
        return None, 'point-outside-geometry'
    return {'lat': lat, 'lon': lon}, 'point-inside-geometry'


def separation(a, b):
    if a is None or b is None:
        return None
    # Great-circle point separation; this is not building movement or accuracy.
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    dla = lat2 - lat1; dlo = math.radians(b['lon'] - a['lon'])
    h = math.sin(dla / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlo / 2) ** 2
    return round(6371008.8 * 2 * math.asin(min(1, math.sqrt(h))), 2)


def read_buildings(old_path, new_path):
    with Path(old_path).open(encoding='utf-8-sig', newline='') as handle:
        old_rows = list(csv.DictReader(handle))
    workbook = openpyxl.load_workbook(new_path, read_only=True, data_only=True)
    values = workbook.active.iter_rows(values_only=True)
    headers = next(values)
    new_rows = [dict(zip(headers, ('' if value is None else str(value).strip() for value in row))) for row in values]
    workbook.close()
    old_rows = [{key: (value or '').strip() for key, value in row.items()} for row in old_rows]
    old = {row['รหัสสิ่งปลูกสร้าง']: (index + 2, row) for index, row in enumerate(old_rows)}
    new = {row['รหัสสิ่งปลูกสร้าง']: (index + 2, row) for index, row in enumerate(new_rows)}
    if len(old) != len(old_rows) or len(new) != len(new_rows):
        raise ValueError('Duplicate stable building identifier')
    if (len(old), len(new)) != (14577, 16953):
        raise ValueError('Unexpected source counts')
    return old, new


def record_group(record):
    distance = record['historical_point_separation_m']
    if distance is not None and distance > 50:
        return 'large-historical-separation'
    if record['address_changed']:
        return 'changed-address'
    if record['new_ltax_status'] == 'code-not-found':
        return 'same-address-missing-new-code'
    if record['old_ltax_point'] is not None and record['new_ltax_point'] is not None:
        return 'both-historical-points'
    return 'one-or-no-historical-point'


def validate_record(record):
    if set(record) != RECORD_FIELDS or not re.fullmatch(r'R[0-9]{3}', record['sample_id']):
        raise ValueError('Invalid public example fields')
    for field in ('old_parcel_code', 'new_parcel_code'):
        if len(record[field]) > 32 or CODE_RE.fullmatch(record[field]) is None:
            raise ValueError('Unreviewed code grammar')
    if record['old_parcel_code'] == record['new_parcel_code']:
        raise ValueError('Unchanged code in examples')
    if not all(safe_house(record[field]) for field in ('house_no_before', 'house_no_after')):
        raise ValueError('Unreviewed house-number text')
    if not all(safe_road(record[field]) for field in ('road_before', 'road_after')):
        raise ValueError('Unreviewed road text')
    changed = (record['house_no_before'], record['road_before']) != (record['house_no_after'], record['road_after'])
    if type(record['address_changed']) is not bool or changed != record['address_changed']:
        raise ValueError('Address comparison mismatch')
    for prefix in ('old', 'new'):
        status = record[f'{prefix}_ltax_status']; point = record[f'{prefix}_ltax_point']
        if status not in STATUSES or (point is not None) != (status == 'point-inside-geometry'):
            raise ValueError('Invalid point status')
        if point is not None and (set(point) != {'lat', 'lon'} or not (13.0 < point['lat'] < 13.6 and 100.5 < point['lon'] < 101.3)):
            raise ValueError('Unexpected historical point region')
    if record['historical_point_separation_m'] != separation(record['old_ltax_point'], record['new_ltax_point']):
        raise ValueError('Historical separation mismatch')
    if record['group'] not in GROUPS or record['group'] != record_group(record):
        raise ValueError('Example group mismatch')


def select_examples(changes, count=40):
    eligible = [entry for entry in changes if all(safe_house(entry['record'][f]) for f in ('house_no_before', 'house_no_after'))
                and all(safe_road(entry['record'][f]) for f in ('road_before', 'road_after'))
                and all(len(entry['record'][f]) <= 32 and CODE_RE.fullmatch(entry['record'][f]) for f in ('old_parcel_code', 'new_parcel_code'))]
    by_group = {group: [] for group in GROUPS}
    for entry in eligible:
        by_group[entry['record']['group']].append(entry)
    for group, entries in by_group.items():
        entries.sort(key=lambda entry: (-(entry['record']['historical_point_separation_m'] or 0) if group == 'large-historical-separation' else 0,
                                        hashlib.sha256(entry['building_id'].encode()).hexdigest()))
    quotas = {'same-address-missing-new-code': 14, 'changed-address': 10, 'both-historical-points': 10,
              'one-or-no-historical-point': 4, 'large-historical-separation': 4}
    chosen = []; seen_roads = set(); seen_cells = set()
    def take(group):
        entries = by_group[group]
        if not entries:
            return False
        def diversity(entry):
            record = entry['record']; point = record['old_ltax_point'] or record['new_ltax_point']
            cell = (round(point['lat'] / 0.002), round(point['lon'] / 0.002)) if point else None
            road = normalized_road(record['road_after'] or record['road_before'])
            return (road not in seen_roads, cell is not None and cell not in seen_cells)
        # Large-separation group deliberately retains largest distances first.
        pick = entries[0] if group == 'large-historical-separation' else max(entries, key=diversity)
        entries.remove(pick); chosen.append(pick)
        record = pick['record']; point = record['old_ltax_point'] or record['new_ltax_point']
        seen_roads.add(normalized_road(record['road_after'] or record['road_before']))
        if point:
            seen_cells.add((round(point['lat'] / 0.002), round(point['lon'] / 0.002)))
        return True
    # Seed every available condition before filling deterministic group quotas.
    for group in GROUPS:
        take(group)
    while len(chosen) < count:
        progressed = False
        for group in GROUPS:
            if len(chosen) >= count:
                break
            have = sum(entry['record']['group'] == group for entry in chosen)
            if have < quotas[group] and take(group):
                progressed = True
        if not progressed:
            for group in GROUPS:
                if len(chosen) < count:
                    progressed = take(group) or progressed
        if not progressed:
            raise ValueError('Insufficient safe examples')
    return chosen, len(eligible)


def build(old_path, new_path, ltax_path, output_root, lineage_output):
    paths = {'old_buildings_sha256': old_path, 'new_buildings_sha256': new_path, 'ltax_sha256': ltax_path}
    hashes = {key: sha256(path) for key, path in paths.items()}
    if hashes != EXPECTED_HASHES:
        raise ValueError('Exact private source hashes required')
    old, new = read_buildings(old_path, new_path)
    with Path(ltax_path).open(encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle))
    parcels = {row['parcel_no'].strip(): row for row in rows if row['parcel_no'].strip()}
    nonempty_code_rows = sum(bool(row['parcel_no'].strip()) for row in rows)
    if len(rows) != 30110 or len(parcels) != nonempty_code_rows:
        raise ValueError('Historical parcel code must be unique')
    point_cache = {}
    def lookup(code):
        if code not in point_cache:
            point_cache[code] = point_for_code(code, parcels)
        return point_cache[code]
    changes = []
    for building_id in sorted(old.keys() & new.keys()):
        old_row, before = old[building_id]; new_row, after = new[building_id]
        old_code, new_code = before['รหัสแปลงที่ดิน'], after['รหัสแปลงที่ดิน']
        if old_code == new_code:
            continue
        old_point, old_status = lookup(old_code); new_point, new_status = lookup(new_code)
        record = {
            'sample_id': '', 'house_no_before': before['บ้านเลขที่'], 'house_no_after': after['บ้านเลขที่'],
            'road_before': before['ถนน'], 'road_after': after['ถนน'],
            'old_parcel_code': old_code, 'new_parcel_code': new_code,
            'address_changed': (before['บ้านเลขที่'], before['ถนน']) != (after['บ้านเลขที่'], after['ถนน']),
            'old_ltax_point': old_point, 'new_ltax_point': new_point,
            'old_ltax_status': old_status, 'new_ltax_status': new_status,
            'historical_point_separation_m': separation(old_point, new_point), 'group': '',
        }
        record['group'] = record_group(record)
        changes.append({'building_id': building_id, 'old_source_row': old_row, 'new_source_row': new_row, 'record': record})
    if len(changes) != 5069 or sum(not entry['record']['address_changed'] for entry in changes) != 4943:
        raise ValueError('Source delta does not reconcile')
    selected, eligible_count = select_examples(changes)
    records = []
    lineage = []
    for index, entry in enumerate(selected, 1):
        record = dict(entry['record']); record['sample_id'] = f'R{index:03d}'
        validate_record(record); records.append(record)
        lineage.append({'sample_id': record['sample_id'], 'stable_building_id': entry['building_id'],
                        'old_source_row': entry['old_source_row'], 'new_source_row': entry['new_source_row']})
    distances = [entry['record']['historical_point_separation_m'] for entry in changes if entry['record']['historical_point_separation_m'] is not None]
    old_statuses = collections.Counter(entry['record']['old_ltax_status'] for entry in changes)
    new_statuses = collections.Counter(entry['record']['new_ltax_status'] for entry in changes)
    groups = collections.Counter(record['group'] for record in records)
    summary = {
        'retained_building_ids': len(old.keys() & new.keys()), 'changed_parcel_codes': len(changes),
        'address_unchanged': sum(not entry['record']['address_changed'] for entry in changes),
        'address_changed': sum(entry['record']['address_changed'] for entry in changes),
        'old_ltax_code_found': sum(entry['record']['old_ltax_status'] != 'code-not-found' for entry in changes),
        'new_ltax_code_found': sum(entry['record']['new_ltax_status'] != 'code-not-found' for entry in changes),
        'new_ltax_code_not_found': sum(entry['record']['new_ltax_status'] == 'code-not-found' for entry in changes),
        'old_ltax_status_counts': {status: old_statuses[status] for status in STATUSES},
        'new_ltax_status_counts': {status: new_statuses[status] for status in STATUSES},
        'both_historical_points': len(distances), 'both_historical_points_over_50m': sum(d > 50 for d in distances),
        'both_historical_points_over_500m': sum(d > 500 for d in distances),
        'both_historical_points_max_separation_m': max(distances) if distances else None,
        'example_count': len(records), 'example_groups': {group: groups[group] for group in GROUPS},
    }
    payload = {'schema_version': SCHEMA_VERSION, 'release_id': RELEASE_ID, 'summary': summary,
               'source_hashes': hashes, 'records': records}
    serialized = (json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    text = serialized.decode()
    if re.search(r'[0-9]{4}-[0-9]{6}-[0-9]', text):
        raise ValueError('Household identifier grammar leaked')
    if any(entry['building_id'] in text for entry in selected):
        raise ValueError('Stable building identifier leaked')
    digest = hashlib.sha256(serialized).hexdigest()
    relative = f'assets/data/parcel-code-change-examples-{digest[:12]}.json'
    target = Path(output_root) / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() != serialized:
        raise ValueError('Immutable output collision')
    target.write_bytes(serialized)
    lineage_doc = {'source_hashes': hashes, 'records': lineage}
    Path(lineage_output).parent.mkdir(parents=True, exist_ok=True)
    Path(lineage_output).write_text(json.dumps(lineage_doc, ensure_ascii=False, indent=2) + '\n')
    governance = {
        'schema_version': 'saensuk-parcel-code-change-assessment-1', 'release_id': RELEASE_ID,
        'owner_authorization': 'owner-request:2026-11-12:examples-of-parcel-code-changes-on-existing-public-web',
        'public_asset': {'path': relative, 'sha256': digest, 'bytes': len(serialized), 'mime_type': 'application/json'},
        'source_hashes': hashes, 'summary': summary,
        'selection': {'sample_count': len(records), 'safe_eligible_changes': eligible_count,
                      'method': 'Deterministic condition groups with road and historical coordinate-cell variety; includes largest historical point separations. Not a random statistical sample.'},
        'provenance': {'internal_match': 'Exact stable building identifier retained between the September and November registers; raw key excluded from public projection.',
                       'parcel_lookup': 'Exact old/new tax parcel code lookup into the same historical LTAX export; municipality remains scoped to Saensuk.',
                       'coordinate_rule': 'Original LTAX map coordinates only when strictly inside Polygon/MultiPolygon exterior and outside holes; boundary excluded. Never synthesized or snapped.'},
        'checks': {'source_hashes_match': True, 'all_5069_changes_reconciled': True,
                   'selected_sample_lineage_checked': len(records), 'strict_field_allowlist': True,
                   'coordinate_containment_checked': sum(record[p] is not None for record in records for p in ('old_ltax_point', 'new_ltax_point')),
                   'household_dataset_unchanged': True},
        'limitations': ['Current parcel geometry was not supplied by the November workbook.',
                        'Two historical code-associated point locations do not demonstrate that a building moved.',
                        'Historical point separation is neither survey displacement nor measured accuracy improvement.',
                        'Strict ring containment was checked for released points; this release does not claim a new formal topology-validity audit.'],
        'fields_allowed': sorted(RECORD_FIELDS),
        'fields_excluded': ['owner_names', 'resident_names', 'contact_details', 'house_reg_id', 'building_id', 'parcel_uuid', 'private_source_rows'],
    }
    governance_path = Path(output_root) / 'governance/parcel-code-change-assessment.json'
    governance_path.parent.mkdir(parents=True, exist_ok=True)
    governance_path.write_text(json.dumps(governance, ensure_ascii=False, indent=2) + '\n')
    return governance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old-buildings', type=Path, required=True)
    parser.add_argument('--new-buildings', type=Path, required=True)
    parser.add_argument('--ltax', type=Path, required=True)
    parser.add_argument('--output-root', type=Path, required=True)
    parser.add_argument('--lineage-output', type=Path, required=True)
    args = parser.parse_args()
    root = args.output_root.resolve()
    for path in (args.old_buildings, args.new_buildings, args.ltax, args.lineage_output):
        if path.resolve() == root or root in path.resolve().parents:
            parser.error('Private sources and lineage must remain outside publication root')
    result = build(args.old_buildings, args.new_buildings, args.ltax, root, args.lineage_output)
    print(json.dumps({'public_asset': result['public_asset'], 'summary': result['summary']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
