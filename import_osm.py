"""Convert public OSM XML to geometry only; omit contributor account metadata."""
import json, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
nodes = {n.attrib['id']: {'lat': float(n.attrib['lat']), 'lon': float(n.attrib['lon'])} for n in root.findall('node')}
elements = []
way_keys = ('building', 'highway', 'landuse', 'leisure', 'natural', 'barrier')
for way in root.findall('way'):
    tags = {t.attrib['k']: t.attrib['v'] for t in way.findall('tag')}
    if not any(t in tags for t in way_keys):
        continue
    geom = [nodes[n.attrib['ref']] for n in way.findall('nd') if n.attrib['ref'] in nodes]
    if len(geom) < 2:
        continue
    elements.append({'id': way.attrib['id'], 'type': 'way', 'tags': tags, 'geometry': geom})
for node in root.findall('node'):
    tags = {t.attrib['k']: t.attrib['v'] for t in node.findall('tag')}
    if tags.get('natural') != 'tree':
        continue
    elements.append({'id': node.attrib['id'], 'type': 'node', 'lat': float(node.attrib['lat']), 'lon': float(node.attrib['lon']), 'tags': tags})
with open(sys.argv[2], 'w') as f:
    json.dump({'source': 'OpenStreetMap contributors', 'license': 'ODbL-1.0', 'fetched': '2026-09-19', 'elements': elements}, f, separators=(',', ':'))
print(json.dumps({
    'ways': sum(e['type'] == 'way' for e in elements),
    'buildings': sum('building' in e.get('tags', {}) for e in elements),
    'roads': sum('highway' in e.get('tags', {}) for e in elements),
    'barriers': sum('barrier' in e.get('tags', {}) for e in elements),
    'trees': sum(e['type'] == 'node' for e in elements),
}))
