#!/usr/bin/env python3
"""Generate the Issue #8 spike scenario-massing fixture (WGS84 GeoJSON).

The fixture represents what the #7 solver is expected to emit for #9 Forge:
per-scenario massing volumes in graph coordinates (WGS84), heights in feet,
plus the mission intent they were computed against. It is INPUT to the spatial
scene adapter, never to the graph itself.

The projection here duplicates the canonical formula implemented in
src/adapters/spatial/projection.ts (local ENU feet anchored at the parcel
ring's shoelace centroid). tests/spatial/scene-adapter.test.ts asserts the
fixture's volumes actually fall inside the derived mission envelope, which is
what catches drift between this generator and the canonical projection.

Run:  python scripts/generate_forge_spike_massing.py
Writes: src/adapters/spatial/fixtures/forge-spike-massing.json
"""

import json
import math
import os
import sys

FT_PER_M = 3.280839895

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH = os.path.join(
    REPO, "docs", "benchmarks", "calvary-memorial-philadelphia"
)
OUT = os.path.join(
    REPO, "src", "adapters", "spatial", "fixtures", "forge-spike-massing.json"
)


def load_ring(path, index=0):
    doc = json.load(open(path, encoding="utf-8"))
    geom = doc["geometry"] if "geometry" in doc else doc["features"][index]["geometry"]
    coords = geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        coords = coords[0]
    return [(p[0], p[1]) for p in coords[0]]


def shoelace_centroid(ring):
    a = cx = cy = 0.0
    n = len(ring) - 1
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    a *= 0.5
    return cx / (6 * a), cy / (6 * a)


def meters_per_degree(lat_deg):
    lat = math.radians(lat_deg)
    mlon = 111412.84 * math.cos(lat) - 93.5 * math.cos(3 * lat) + 0.118 * math.cos(5 * lat)
    mlat = 111132.954 - 559.822 * math.cos(2 * lat) + 1.175 * math.cos(4 * lat)
    return mlon, mlat


class Frame:
    def __init__(self, ring):
        (self.clon, self.clat) = shoelace_centroid(ring)
        mlon, mlat = meters_per_degree(self.clat)
        self.fx = mlon * FT_PER_M  # ft per degree lon
        self.fy = mlat * FT_PER_M  # ft per degree lat

    def to_local(self, lon, lat):
        return ((lon - self.clon) * self.fx, (lat - self.clat) * self.fy)

    def to_wgs84(self, x, y):
        return (self.clon + x / self.fx, self.clat + y / self.fy)


def signed_area(pts):
    s = 0.0
    for i in range(len(pts) - 1):
        s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return s / 2


def point_in_poly(pt, poly):
    x, y = pt
    inside = False
    n = len(poly) - 1
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[i + 1]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xin > x:
                inside = not inside
    return inside


def seg_intersects_rect(a, b, rect):
    """Segment vs axis-aligned or arbitrary rect (4 pts) via bounding + cross tests."""
    # conservative: sample segment densely and test point-in-poly
    for t in [i / 60 for i in range(61)]:
        p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        if point_in_poly(p, rect + [rect[0]]):
            return True
    return False


def main():
    parcel_ring = load_ring(os.path.join(BENCH, "parcel.geojson"))
    struct_ring = load_ring(
        os.path.join(BENCH, "raw", "gis", "footprints-parcel-494018.json")
    )
    frame = Frame(parcel_ring)
    parcel = [frame.to_local(*p) for p in parcel_ring]
    sanctuary = [frame.to_local(*p) for p in struct_ring]

    # --- Scenario A volume 1: north-east bar, axis-aligned — east of the
    # sanctuary's north apex (14, 75), below the serrated north chain.
    bar1 = [(46.0, 62.0), (150.0, 62.0), (150.0, 112.0), (46.0, 112.0)]

    # --- Scenario A volume 2: east wing in the zone bounded west by the
    # sanctuary's northeast face (max x ~132), north by the serrated chain,
    # east by the Roosevelt frontage, and south of the north bar. The
    # mission parking field owns the south triangle, so this wing sits
    # between the north bar and the NE parcel edge.
    bar2 = [(155.0, 40.0), (200.0, 40.0), (200.0, 115.0), (155.0, 115.0)]

    # --- Scenario B: deliberately invalid optimistic mass — taller than the
    # 38 ft legal limit, taller than the 28 ft mission cap, and intruding
    # into the protected sanctuary footprint.
    massB = [(-80.0, -40.0), (120.0, -40.0), (120.0, 120.0), (-80.0, 120.0)]

    def check(name, rect):
        problems = []
        closed = rect + [rect[0]]
        if signed_area(closed) < 0:
            rect[:] = list(reversed(rect))
            closed = rect + [rect[0]]
        for pt in rect:
            if not point_in_poly(pt, parcel + [parcel[0]]):
                problems.append(f"{name}: corner {pt} outside parcel")
        for i in range(len(rect)):
            a, b = closed[i], closed[i + 1]
            hits = [
                (
                    round(a[0] + (b[0] - a[0]) * (j / 60), 1),
                    round(a[1] + (b[1] - a[1]) * (j / 60), 1),
                )
                for j in range(61)
                if point_in_poly(
                    (a[0] + (b[0] - a[0]) * (j / 60), a[1] + (b[1] - a[1]) * (j / 60)),
                    sanctuary,
                )
            ]
            if hits:
                problems.append(f"{name}: edge {i} intersects sanctuary at {hits[:3]}")
        print(f"{name}: area={abs(signed_area(closed)):.0f} ft2")
        return problems

    problems = []
    problems += check("bar1", bar1)
    problems += check("bar2", bar2)
    # massB is INTENDED to intrude into the sanctuary; only check parcel bounds.
    for pt in massB:
        if not point_in_poly(pt, parcel + [parcel[0]]):
            problems.append(f"massB: corner {pt} outside parcel")
    print(f"massB: area={abs(signed_area(massB + [massB[0]])):.0f} ft2")

    if problems:
        for p in problems:
            print("PROBLEM:", p)
        sys.exit(1)

    def to_feature(rect, close=True):
        pts = rect + ([rect[0]] if close else [])
        return [[list(frame.to_wgs84(x, y)) for x, y in pts]]

    fixture = {
        "$schema": "acrevia.spatial.spike-massing.v1",
        "description": "Issue #8 spike fixture: representative solver-output massings for the canonical Calvary benchmark. Generated by scripts/generate_forge_spike_massing.py; validated against the derived envelopes by tests/spatial/scene-adapter.test.ts.",
        "scenarios": [
            {
                "scenarioId": "phl:scenario:homes-24",
                "volumes": [
                    {
                        "volumeId": "phl:scenario:homes-24:north-bar",
                        "label": "North bar — 12 homes",
                        "geometry": {"type": "Polygon", "coordinates": to_feature(bar1)},
                        "heightFt": 28,
                    },
                    {
                        "volumeId": "phl:scenario:homes-24:east-wing",
                        "label": "East wing — 12 homes",
                        "geometry": {"type": "Polygon", "coordinates": to_feature(bar2)},
                        "heightFt": 28,
                    },
                ],
            },
            {
                "scenarioId": "phl:scenario:optimistic-tower",
                "volumes": [
                    {
                        "volumeId": "phl:scenario:optimistic-tower:mass",
                        "label": "Optimistic six-story mass",
                        "geometry": {"type": "Polygon", "coordinates": to_feature(massB)},
                        "heightFt": 45,
                    },
                ],
            },
        ],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(fixture, fh, indent=2)
        fh.write("\n")
    print("wrote", os.path.relpath(OUT, REPO))


if __name__ == "__main__":
    main()
