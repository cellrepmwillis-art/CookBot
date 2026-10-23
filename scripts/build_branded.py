"""Build branded.json from Open Food Facts (https://world.openfoodfacts.org),
a free database of packaged foods available under the Open Database License.

Input is a tab-separated extract of US products from the Open Food Facts CSV
export (en.openfoodfacts.org.products.csv.gz) with these columns:
code, name, brands, serving_size, serving_quantity, kcal, kj, protein, carbs,
fat, alcohol, scans, completeness, errors, quantity, modified, categories
(all nutrients per 100 g).

    python3 scripts/build_branded.py us.tsv > branded.json

Output: a JSON array of [name, kcal per 100 g, [[portion, grams], ...], 0, barcodes],
the same shape as foods.json plus barcodes: space-separated, without leading
zeros, so UPC-A ("012345678905") and EAN-13 ("0012345678905") match.
"""
import csv
import json
import re
import sys

# How many products to include beyond the priority brands, most-scanned first.
TOP_N = 40000

# Brands always included: fitness and protein brands, and natural/organic
# brands sold at stores like Thrive Market. Matched against the start of the
# product's first listed brand, ignoring case and punctuation.
PRIORITY_BRANDS = """
fairlife, core power, barebells, quest, premier protein, pure protein, muscle milk,
optimum nutrition, gold standard, dymatize, isopure, bsn, cellucor, c4, ghost, alani nu,
celsius, bang, reign, monster, red bull, prime, liquid i v, body armor, bodyarmor,
built, built bar, one, oh yeah, think, thinkthin, rxbar, rx bar, kind, clif, luna,
larabar, perfect bar, g2g, misfits, grenade, myprotein, legendary foods, magic spoon,
catalina crunch, kodiak, kodiak cakes, birch benders, lenny larry, lenny larrys,
chobani, oikos, fage, siggi, siggis, two good, ratio, icelandic provisions, skyr,
halo top, enlightened, rebel, nicks, yasso, arctic zero,
thrive market, siete, primal kitchen, simple mills, kettle fire, kettle and fire,
epic, chomps, country archer, jack links, stryve, paleovalley, vital proteins,
orgain, garden of life, vega, ka chava, huel, soylent, ensure, owyn, koia,
lesser evil, skinny pop, skinnypop, boom chicka pop, angies, popcornopolis,
hu, lily s, lilys, unreal, smart sweets, smartsweets, sour strips, olipop, poppi,
spindrift, la croix, lacroix, bubly, waterloo, zevia, health ade, gt s, gts,
califia, califia farms, oatly, silk, elmhurst, three trees, malk, so delicious,
ripple, chobani oat, planet oat, almond breeze, blue diamond,
daves killer bread, dave s killer bread, ezekiel, food for life, base culture,
mission carb balance, la banderita, ole xtreme, tumaro s, cut da carb,
banza, barilla protein, explore cuisine, ancient harvest, lundberg, seeds of change,
annie s, annies, amy s, amys, applegate, bell evans, just egg, beyond meat,
impossible, quorn, gardein, morningstar, dr praeger s, hilary s, caulipower,
real good foods, trader joe s, kirkland signature, good culture, nancy s,
tillamook, kerrygold, vital farms, pete and gerry s, egglife, crepini,
nature s bakery, bobo s, made good, that s it, bare, peeled snacks,
justin s, rx nut butter, nuttzo, wild friends, once again, maranatha,
bulletproof, laird superfood, nutpods, chobani coffee creamer, califia farms creamer,
starbucks, dunkin, la colombe, stok, high brew, super coffee, slate, chobani protein,
""".replace("\n", " ")
PRIORITY = [b.strip() for b in PRIORITY_BRANDS.split(",") if b.strip()]

norm = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def is_priority(brand):
    b = norm(brand)
    return any(b == p or b.startswith(p + " ") for p in PRIORITY)


def number(value):
    try:
        return float(value)
    except ValueError:
        return None


DRINK = re.compile(r"\b(shake|drink|milk|juice|soda|coffee|latte|tea|smoothie|kombucha|lemonade|water)\b", re.IGNORECASE)
CORPORATE = re.compile(r"\b(inc|llc|corp|corporation|co|company|brands|ltd)\b\.?", re.IGNORECASE)
# A parent company at the start of a product name: "Fair Oaks Farms Brands Inc. Fairlife, ..."
COMPANY_PREFIX = re.compile(r"^[^,]{0,40}?\b(?:inc|llc|corp|ltd)\b\.?,?\s+", re.IGNORECASE)


def real_barcode(code):
    """False for placeholders like 12345678905 (the sample UPC) or 999999999."""
    if not code.isdigit() or len(code) < 6:
        return False
    body = code[:-1]  # without the check digit
    return len(set(body)) > 2 and body not in "123456789012345678901234567890" and body not in "987654321098765432109876543210"


def calories_add_up(kcal, row):
    """Whether calories roughly match 4 kcal/g protein and carbs, 9 fat, 7 alcohol.

    Catches typos and mixed-up units. The range is wide because US labels
    count fiber and sugar alcohols as carbs, which have fewer calories.
    """
    protein, carbs, fat = (number(row[k]) for k in ("protein", "carbs", "fat"))
    if None in (protein, carbs, fat):
        return True  # can't tell
    expected = 4 * protein + 4 * carbs + 9 * fat + 7 * (number(row["alcohol"]) or 0)
    if expected < 20 and kcal < 30:
        return True  # water, diet drinks, black coffee
    return expected > 0 and 0.65 <= kcal / expected <= 1.35


def tidy(text):
    text = re.sub(r"\s+", " ", text).strip(" ,-")
    text = re.sub(r"^(\d{4,}\s+)+", "", text)  # leading store codes like "0000495"
    # SHOUTED NAMES read badly; title-case them.
    if text.isupper() and len(text) > 4:
        text = text.title()
    return text


def main(path):
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))

    candidates = {}
    for row in rows:
        kcal = number(row["kcal"])
        if kcal is None and number(row["kj"]) is not None:
            kcal = number(row["kj"]) / 4.184
        if kcal is None or not 0 <= kcal <= 900:
            continue  # missing or impossible (fat is 900 kcal per 100 g)
        if "energy" in row["errors"] or not calories_add_up(kcal, row):
            continue  # flagged by Open Food Facts, or calories don't match the macros
        brands = [tidy(b) for b in row["brands"].replace("fa!rlife", "fairlife").split(",") if tidy(b)]
        name = tidy(row["name"].replace("fa!rlife", "fairlife"))
        name = COMPANY_PREFIX.sub("", name) or name
        if not brands or len(name) < 2:
            continue
        # The consumer brand, not the parent company ("Fair Oaks Farms Brands Inc.").
        brand = next((b for b in brands if not CORPORATE.search(b)), brands[0])
        named = any(norm(b) and norm(b) in norm(name) for b in brands)
        if CORPORATE.search(brand) and len(name.split()) >= 2:
            named = True  # "Fair Oaks Farms Brands Inc." adds nothing to "Fairlife, Purely Nutritious Milk"
        display = (name if named else f"{brand} {name}")[:90]

        portions = []
        grams = number(row["serving_quantity"])
        if grams and 1 <= grams <= 1500:
            label = tidy(row["serving_size"])[:40] or f"1 serving ({grams:g} g)"
            if not re.match(r"^[\d./½¼¾]", label):
                label = f"1 serving, {label}"
            portions.append([label, round(grams, 1)])
            # A full-size drink over 130 kcal per 100 ml almost always means the
            # per-serving number was typed in as per-100 ml (a 325 ml protein
            # shake at "160" is 160 per bottle, not 520).
            drink = re.search(r"\bml\b|fl\.? ?oz", label, re.IGNORECASE) or "Beverages" in row["categories"] or DRINK.search(name)
            if grams >= 200 and kcal > 130 and drink:
                kcal = kcal * 100 / grams

        scans = number(row["scans"]) or 0
        priority = any(is_priority(b) for b in brands)
        # One entry per product name. Copies often disagree on calories
        # (someone typed per-serving numbers as per-100 g); the most-scanned
        # copy is the one most people have checked.
        key = norm(display)
        best = candidates.get(key)
        rank = (scans, bool(portions))
        code = row["code"].lstrip("0")
        codes = (best["codes"] if best else []) + ([code] if real_barcode(code) else [])
        if best is None or rank > best["rank"]:
            best = candidates[key] = {"food": [display, round(kcal), portions], "scans": scans, "priority": priority, "rank": rank}
        best["codes"] = codes

    chosen = [c for c in candidates.values() if c["priority"]]
    others = sorted((c for c in candidates.values() if not c["priority"]), key=lambda c: -c["scans"])
    chosen += [c for c in others[:TOP_N] if c["scans"] > 0]
    for c in chosen:
        c["food"] += [0, " ".join(dict.fromkeys(c["codes"][:8]))]
    foods = sorted((c["food"] for c in chosen), key=lambda f: f[0].lower())
    print(f"{len(rows)} rows, {len(candidates)} unique, {sum(c['priority'] for c in chosen)} priority-brand, {len(foods)} kept", file=sys.stderr)
    json.dump(foods, sys.stdout, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
