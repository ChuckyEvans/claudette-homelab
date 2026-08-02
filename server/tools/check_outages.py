#!/usr/bin/env python3
import sys, json, urllib.request

url = 'http://localhost:7654/api/reports/debug/outages'
try:
    with urllib.request.urlopen(url, timeout=20) as r:
        data = json.load(r)
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(2)

outages = data.get('outages') or []
total = data.get('totalOutages', data.get('total', len(outages)))
sample = outages[:5]
print(json.dumps({'total': total, 'sample': sample}, ensure_ascii=False))
