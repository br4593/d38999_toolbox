#!/usr/bin/env python3
"""Async scraper for https://d38999.federalconnectors.com/"""
import asyncio
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import aiohttp

BASE_URL = "https://d38999.federalconnectors.com"
OUTPUT_FILE = Path("/home/barrod/Desktop/dev/d38999_toolbox/.copilot-session/scraped_pns.json")

SEED_SHEETS = ["20", "21", "23", "24", "25", "26", "27", "29", "30", "31",
               "33", "40", "42", "44", "46", "47", "49"]

CONCURRENCY = 8
REQUEST_DELAY = 0.02
MAX_RETRIES = 3

# Navigation links: href="D38999?XXX">D38999/XXX (count)</a>
NAV_RE = re.compile(r'<a[^>]*href="D38999\?([^"]+)"[^>]*>D38999/[^<]*\(\d+\)</a>')
# Leaf links: /Get?pn=... OR target="item" external -> capture the anchor text PN
LEAF_GET_RE = re.compile(r'<a[^>]*href="/Get\?pn=[^"]*"[^>]*>(D38999/[A-Z0-9\-]+)</a>')
LEAF_EXT_RE = re.compile(r'<a[^>]*target="item"[^>]*href="https://federalconnectors\.com/[^"]*"[^>]*>(D38999/[A-Z0-9\-]+)</a>')


async def fetch(session, url, sem):
    for attempt in range(MAX_RETRIES):
        try:
            async with sem:
                await asyncio.sleep(REQUEST_DELAY)
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    if resp.status == 404:
                        return None
                    if resp.status >= 500:
                        await asyncio.sleep(1 + attempt)
                        continue
                    return await resp.text()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            await asyncio.sleep(1 + attempt)
    return None


async def crawl():
    visited = set()
    part_numbers = set()
    pages_done = 0

    connector = aiohttp.TCPConnector(limit=CONCURRENCY * 2)
    sem = asyncio.Semaphore(CONCURRENCY)

    async with aiohttp.ClientSession(connector=connector,
                                     headers={"User-Agent": "Mozilla/5.0 d38999-toolbox-scraper/1.0",
                                              "Accept-Encoding": "gzip, deflate"}) as session:

        async def process(key):
            nonlocal pages_done
            if key in visited:
                return []
            visited.add(key)
            url = f"{BASE_URL}/D38999?{key}"
            html = await fetch(session, url, sem)
            pages_done += 1
            if pages_done % 100 == 0:
                print(f"  pages={pages_done} pns={len(part_numbers)} queue_seen={len(visited)}", flush=True)
            if not html:
                return []

            # Collect leaf PNs
            for m in LEAF_GET_RE.finditer(html):
                part_numbers.add(m.group(1))
            for m in LEAF_EXT_RE.finditer(html):
                part_numbers.add(m.group(1))

            # Collect navigation children (dedup within page)
            children = set()
            for m in NAV_RE.finditer(html):
                child = m.group(1)
                if child != key:
                    children.add(child)
            return list(children)

        # BFS level by level
        current = list(SEED_SHEETS)
        while current:
            results = await asyncio.gather(*(process(k) for k in current))
            next_level = []
            seen_next = set()
            for child_list in results:
                for c in child_list:
                    if c not in visited and c not in seen_next:
                        seen_next.add(c)
                        next_level.append(c)
            current = next_level

    return sorted(part_numbers), pages_done


async def main():
    print(f"Starting crawl with {CONCURRENCY} concurrent requests...", flush=True)
    pns, pages = await crawl()
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "total_count": len(pns),
        "pages_crawled": pages,
        "part_numbers": pns,
    }
    OUTPUT_FILE.write_text(json.dumps(data, indent=2))
    print(f"Done. pages={pages} unique_pns={len(pns)} -> {OUTPUT_FILE}", flush=True)
    print("First 10:", pns[:10], flush=True)


if __name__ == "__main__":
    asyncio.run(main())
