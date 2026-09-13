"""Rebuild owner-supplied EPWA and EPKK/EPKT boundaries, retaining exact endpoints.

Requires pyproj==3.7.2 and shapely==2.1.2. Run from any directory.
Use --check to validate reproducibility without writing files.
"""
import argparse
import json
import math
import re
from pathlib import Path

from pyproj import Geod
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[1]
GEOD = Geod(ellps="WGS84")
SOURCE = ROOT / "assets/sources/tma-epwa-epkk.json"


def dms(text):
    lat, lon = text.split()
    def decimal(value, digits, hemispheres):
        assert re.fullmatch(r"\d{" + str(digits + 4) + r"}[" + hemispheres + r"]", value), value
        degrees, minutes, seconds = int(value[:digits]), int(value[digits:digits+2]), int(value[digits+2:-1])
        assert minutes < 60 and seconds < 60
        return (degrees + minutes / 60 + seconds / 3600) * (-1 if value[-1] in "SW" else 1)
    return [decimal(lon, 3, "EW"), decimal(lat, 2, "NS")]


def altitude(text):
    value, unit = text.split()
    return {"value": int(value), "unit": unit, "ref": "STD" if unit == "FL" else "AMSL"}


def arc_points(start, end, arc):
    center = dms(arc["center"])
    begin, _, start_radius = GEOD.inv(*center, *start)
    finish, _, end_radius = GEOD.inv(*center, *end)
    assert arc["direction"] == "clockwise"
    sweep = (finish - begin) % 360
    # At most 500 m per chord; below 2 m sagitta at the smaller radius.
    steps = math.ceil(math.radians(sweep) * arc["radius_m"] / 500)
    points = [list(GEOD.fwd(*center, begin + sweep * i / steps, arc["radius_m"])[:2]) for i in range(1, steps)]
    print(f"  arc: {sweep:.3f} degrees clockwise; endpoint radius deviations {start_radius-arc['radius_m']:.1f}/{end_radius-arc['radius_m']:.1f} m")
    return points


def fir_path(start, end):
    data = json.loads((ROOT / "assets/geojson/flightmap_europe_fir_uir.json").read_text())
    feature = next(f for f in data["features"] if f["properties"].get("AV_AIRSPAC") == "EPWWFIR")
    ring = feature["geometry"]["coordinates"][0]
    # A local metre-scale plane is sufficient to select existing boundary segments.
    scale = math.cos(math.radians(50))
    project = lambda p: (p[0] * scale, p[1])
    line = LineString([project(p) for p in ring])
    a, b = (line.project(Point(project(p))) for p in (start, end))
    pa, pb = (line.interpolate(t) for t in (a, b))
    pa, pb = [pa.x / scale, pa.y], [pb.x / scale, pb.y]
    cumulative = [0.0]
    for p, q in zip(ring, ring[1:]):
        cumulative.append(cumulative[-1] + math.dist(project(p), project(q)))
    length = line.length
    forward = (b-a) % length
    if forward <= length / 2:
        selected = sorted(((t-a) % length, p) for t, p in zip(cumulative[:-1], ring[:-1]) if 0 < (t-a) % length < forward)
    else:
        selected = sorted(((a-t) % length, p) for t, p in zip(cumulative[:-1], ring[:-1]) if 0 < (a-t) % length < length-forward)
    print(f"  FIR: {len(selected)} stored vertices; endpoint connectors {GEOD.inv(*start,*pa)[2]:.1f}/{GEOD.inv(*pb,*end)[2]:.1f} m")
    return [pa] + [p for _, p in selected] + [pb]


def build(sector):
    print(sector["id"])
    points = [dms(p) for p in sector["points"].split(";")]
    assert points[0] == points[-1], "Source must explicitly close its boundary"
    if sector.get("arc"):
        i = sector["arc"]["after"]
        points[i+1:i+1] = arc_points(points[i], points[i+1], sector["arc"])
    if sector.get("follow_fir"):
        points[-1:-1] = fir_path(points[-2], points[-1])
    polygon = Polygon(points)
    assert polygon.is_valid and polygon.area > 0, f"{sector['id']}: {explain_validity(polygon)}"
    # RFC 7946 exterior winding; do not simplify or repair supplied coordinates.
    ring = [list(p) for p in orient(polygon, sign=1).exterior.coords]
    props = {"tma_id": sector["id"], "icao": sector["icao"], "tma": sector["group"],
             "sector": sector["sector"], "name": sector.get("name", f"{sector['group']} {sector['sector']}"),
             "vertical": sector.get("vertical", "TMA"), "class": "C",
             "vertical_bands": [{"floor": altitude(sector["floor"]), "ceiling": altitude(sector["ceiling"])}]}
    return {"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [ring]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    sectors = json.loads(SOURCE.read_text())["sectors"]
    features = [build(s) for s in sectors]
    for filename, group in [("epwa_tma_all.geojson", features[:7]), ("epkk_epkt_tma_utma_fixed.geojson", features[7:])]:
        data = {"type": "FeatureCollection", "features": group}
        path = ROOT / "assets/geojson" / filename
        if args.check:
            assert json.loads(path.read_text()) == data, f"Regenerate {filename}"
        else:
            path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"{filename}: {len(group)} valid polygons")


if __name__ == "__main__":
    main()
