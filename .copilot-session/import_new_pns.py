#!/usr/bin/env python3
"""Import new D38999 PNs scraped from federalconnectors.com into the secondary source."""
import json
import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/home/barrod/Desktop/dev/d38999_toolbox')
sys.path.insert(0, str(ROOT / 'scripts'))
SCRAPED = ROOT / '.copilot-session/scraped_pns.json'
FC_PATH = ROOT / 'data/d38999_federalconnectors_secondary_source.json'
BVP_PATH = ROOT / 'scripts/build_valid_d38999_pns.py'

spec = importlib.util.spec_from_file_location('bvdpns', BVP_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
decode_part_number = mod.decode_part_number
normalize_part_number = mod.normalize_part_number

with open(SCRAPED) as f:
    scraped = json.load(f)
scraped_pns = set(scraped['part_numbers'])

with open(FC_PATH) as f:
    fc_source = json.load(f)

existing_pns = {e['partNumber'] for e in fc_source.get('entries', [])}
new_pns = sorted(scraped_pns - existing_pns)
print(f"Scraped: {len(scraped_pns)}, existing: {len(existing_pns)}, new: {len(new_pns)}")

new_entries = []
new_overlaps = []
failed_decode = 0

for pn in new_pns:
    decoded = decode_part_number(pn)
    if decoded is None:
        failed_decode += 1
        continue
    if not pn.startswith('D38999/'):
        failed_decode += 1
        continue
    body = pn[len('D38999/'):]
    # query fragment: body minus last char (keying), matches existing convention
    query_fragment = body[:-1]
    pn_without_prefix = body
    entry = {
        "partNumber": pn,
        "sourcePage": f"https://d38999.federalconnectors.com/D38999?{query_fragment}",
        "productUrl": f"https://d38999.federalconnectors.com/Get?pn={pn_without_prefix}",
        "query": query_fragment,
        "normalizedPartNumber": normalize_part_number(pn),
        "decoded": decoded,
        "crossCheck": {
            "matchesVerifiedDataset": False,
            "verifiedManufacturer": "",
            "verifiedSource": "",
            "matchesCatalogSupportedCombination": False,
            "manufacturerSupportSources": [],
            "eligibleImport": True,
        },
    }
    overlap = {
        "partNumber": pn,
        "productUrl": f"https://d38999.federalconnectors.com/Get?pn={pn_without_prefix}",
        "sourcePage": f"https://d38999.federalconnectors.com/D38999?{query_fragment}",
        "decoded": decoded,
        "manufacturerSupportSources": [],
        "alreadyVerified": False,
        "verifiedManufacturer": "",
    }
    new_entries.append(entry)
    new_overlaps.append(overlap)

fc_source.setdefault('entries', []).extend(new_entries)
fc_source.setdefault('importableOverlaps', []).extend(new_overlaps)
crawl = fc_source.setdefault('crawl', {})
crawl['exactPartNumbersFound'] = crawl.get('exactPartNumbersFound', 0) + len(new_entries)
crawl['importableOverlapCount'] = crawl.get('importableOverlapCount', 0) + len(new_overlaps)
fc_source['generated_at'] = datetime.now(timezone.utc).isoformat()

with open(FC_PATH, 'w') as f:
    json.dump(fc_source, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f"Added {len(new_entries)} new entries, {len(new_overlaps)} overlaps")
print(f"Total entries now: {len(fc_source['entries'])}")
print(f"Failed to decode: {failed_decode}")
print("TODO_DONE: update-fc-source")
