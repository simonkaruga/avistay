#!/usr/bin/env python3
"""
Avistay SEO Rank Checker
==============================
Checks where avistay.com appears on Bing for target Naivasha
accommodation keywords. Bing is used because it allows non-JS scraping
without heavy bot-detection.

Usage:
    pip install -r requirements.txt
    python rank_checker.py

Output:
    - Console summary with colour-coded positions
    - rank_report_YYYYMMDD_HHMM.csv  ← saved in the same folder
    - Recommendations on what to fix

Run it weekly (or add to a cron job) to track progress.
"""
import asyncio
import csv
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

TARGET = "avistay.com"

# ── Keywords that potential guests actually type ───────────────────────────────

KEYWORDS = [
    # High-intent booking queries
    "Naivasha accommodation",
    "Naivasha holiday homes",
    "Naivasha vacation rentals",
    "book accommodation Naivasha",
    "holiday homes near Lake Naivasha",
    "Naivasha villas for rent",
    "cottages Naivasha Kenya",
    # Attraction-linked
    "Hell's Gate accommodation Kenya",
    "accommodation near Hell's Gate",
    "Lake Naivasha holiday homes",
    "Lake Naivasha cottages",
    # Type-specific
    "Naivasha camping sites",
    "Naivasha conference venues",
    "luxury villas Naivasha",
    "cheap accommodation Naivasha",
    "Naivasha cottages with swimming pool",
    # Weekend / travel intent
    "weekend getaway Naivasha Nairobi",
    "Naivasha airbnb",
    "Naivasha guest house",
    # M-Pesa / local angle
    "Naivasha accommodation book M-Pesa",
    "vacation rental Kenya Naivasha",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.bing.com/",
}

# ── ANSI colours ──────────────────────────────────────────────────────────────

def green(s):  return f"\033[92m{s}\033[0m"
def yellow(s): return f"\033[93m{s}\033[0m"
def red(s):    return f"\033[91m{s}\033[0m"
def bold(s):   return f"\033[1m{s}\033[0m"
def grey(s):   return f"\033[90m{s}\033[0m"


def fmt_pos(pos) -> str:
    if not isinstance(pos, int):
        return red(str(pos))
    if pos == 1:
        return green(f"#{pos} 🥇")
    if pos <= 3:
        return green(f"#{pos}")
    if pos <= 10:
        return yellow(f"#{pos}")
    return red(f"#{pos}")


# ── Bing scraper ──────────────────────────────────────────────────────────────

async def search_bing(client: httpx.AsyncClient, keyword: str) -> list[dict]:
    """Return up to 50 Bing organic results for the keyword."""
    url = f"https://www.bing.com/search?q={keyword.replace(' ', '+')}&count=50&setlang=en-KE"
    try:
        r = await client.get(url, headers=HEADERS, follow_redirects=True, timeout=20)
        r.raise_for_status()
    except Exception as e:
        return [{"pos": 0, "url": f"ERROR: {e}", "title": ""}]

    soup = BeautifulSoup(r.text, "lxml")
    results = []
    for pos, li in enumerate(soup.select("li.b_algo"), start=1):
        a = li.select_one("h2 a")
        if a and a.get("href"):
            results.append({
                "pos":   pos,
                "url":   a["href"],
                "title": a.get_text(strip=True),
            })
    return results


async def check_keyword(client: httpx.AsyncClient, keyword: str) -> dict:
    results = await search_bing(client, keyword)

    our_pos  = None
    our_url  = ""
    top3_str = ""

    for r in results:
        if TARGET in r["url"] and our_pos is None:
            our_pos = r["pos"]
            our_url = r["url"]

    top3 = results[:3]
    top3_str = " | ".join(
        f"{r['pos']}. {r['url'][:55]}" for r in top3
    )

    competitors = [
        r["url"] for r in results[:10]
        if TARGET not in r["url"]
    ]

    return {
        "keyword":        keyword,
        "our_position":   our_pos if our_pos else "Not in top 50",
        "our_url":        our_url,
        "top_3":          top3_str,
        "competitors_top10": ", ".join(competitors[:5]),
    }


# ── Content-gap analyser ──────────────────────────────────────────────────────

async def analyse_top_result(client: httpx.AsyncClient, url: str) -> dict:
    """Fetch the #1 result and extract word count + H1/H2 headings."""
    if not url.startswith("http"):
        return {}
    try:
        r = await client.get(url, headers={**HEADERS, "Referer": "https://www.bing.com/"}, timeout=15)
        soup = BeautifulSoup(r.text, "lxml")
        text  = soup.get_text(" ", strip=True)
        words = len(text.split())
        h1    = [t.get_text(strip=True) for t in soup.find_all("h1")][:2]
        h2    = [t.get_text(strip=True) for t in soup.find_all("h2")][:5]
        return {"words": words, "h1": h1, "h2": h2}
    except Exception:
        return {}


# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    print(bold("\n" + "═" * 62))
    print(bold("  Avistay — SEO Rank Report"))
    print(f"  Target  : {TARGET}")
    print(f"  Date    : {datetime.now().strftime('%A, %d %B %Y  %H:%M')}")
    print(f"  Engine  : Bing (Kenya region)")
    print(bold("═" * 62) + "\n")

    results = []
    async with httpx.AsyncClient(timeout=25) as client:
        for i, kw in enumerate(KEYWORDS):
            sys.stdout.write(f"  [{i+1:02d}/{len(KEYWORDS)}] {kw[:48]:<48} ")
            sys.stdout.flush()

            result = await check_keyword(client, kw)
            results.append(result)

            pos = result["our_position"]
            sys.stdout.write(fmt_pos(pos) + "\n")
            sys.stdout.flush()

            if i < len(KEYWORDS) - 1:
                await asyncio.sleep(2.5)   # be polite — avoid rate limiting

    # ── Summary ──────────────────────────────────────────────────────────────
    ranked   = [r for r in results if isinstance(r["our_position"], int)]
    top1     = [r for r in ranked if r["our_position"] == 1]
    top3     = [r for r in ranked if r["our_position"] <= 3]
    top10    = [r for r in ranked if r["our_position"] <= 10]
    unranked = [r for r in results if not isinstance(r["our_position"], int)]

    print("\n" + bold("═" * 62))
    print(bold("  SUMMARY"))
    print(bold("═" * 62))
    print(f"  {green(f'#1 position')}   : {len(top1)} keyword{'s' if len(top1) != 1 else ''}")
    print(f"  {green('Top 3')}          : {len(top3)} keywords")
    print(f"  {yellow('Top 10 (page 1)')}: {len(top10)} keywords")
    print(f"  {red('Not ranked')}      : {len(unranked)} keywords\n")

    if top10:
        print(bold("  Ranking on page 1 for:"))
        for r in top10:
            print(f"    {fmt_pos(r['our_position'])}  {r['keyword']}")

    if unranked:
        print(bold(f"\n  Not yet ranking for {len(unranked)} keywords — focus content on:"))
        for r in unranked[:8]:
            print(f"    • {r['keyword']}")

    # ── Actionable advice ─────────────────────────────────────────────────────
    print("\n" + bold("  WHAT TO DO NEXT"))
    print("  ─────────────────────────────────────────────────────")

    if not ranked:
        print(yellow("  ⚠  No rankings yet — the site may not be indexed."))
        print("     1. Go to https://search.google.com/search-console")
        print("        and submit https://avistay.com/sitemap.xml")
        print("     2. Use 'URL Inspection' to request indexing of the homepage")
        print("     3. Share the site on social media to attract first backlinks")
    else:
        score = len(top10) / len(KEYWORDS) * 100
        if score < 30:
            print(yellow("  Low page-1 coverage. Priority actions:"))
        elif score < 60:
            print(yellow("  Good start. To reach the top:"))
        else:
            print(green("  Strong coverage! To dominate:"))

        print("  1. Add more property listings with keyword-rich descriptions")
        print("     e.g. 'Cottage near Hell's Gate, Naivasha with lake views'")
        print("  2. Write a blog post: 'Top 10 Things to Do in Naivasha'")
        print("     (target the keywords you're not ranking for)")
        print("  3. Get listed on:")
        print("     - magicalkenya.com")
        print("     - tripadvisor.com (create a business page)")
        print("     - facebook.com/groups/NaivashaHolidayHomes")
        print("     - google.com/business (Google Maps listing)")
        print("  4. Ask property owners to share their listing URLs on")
        print("     WhatsApp groups — signals to Google this is a real site")
        print("  5. Make sure sitemap is submitted:")
        print("     https://avistay.com/sitemap.xml")

    # ── Save CSV ──────────────────────────────────────────────────────────────
    out = Path(__file__).parent / f"rank_report_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "keyword", "our_position", "our_url", "top_3", "competitors_top10"
        ])
        writer.writeheader()
        writer.writerows(results)

    print(f"\n  Full report saved to: {bold(str(out))}\n")


if __name__ == "__main__":
    asyncio.run(main())
