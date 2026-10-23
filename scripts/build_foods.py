"""Build foods.json from the USDA National Nutrient Database for Standard
Reference, Release 28 (public domain).

The SR28 ASCII files ABBREV.txt and FOOD_DES.txt are available in the
fda-nutrient-database npm package (data/ folder) or from USDA directly.

    python3 scripts/build_foods.py path/to/sr28/data > foods.json

Output: a JSON array of [name, kcal per 100 g, [[portion, grams], ...], common],
where common is 1 for everyday foods that should rank first in search.
"""
import json
import re
import sys
from pathlib import Path

# Food groups left out because they clutter search for an adult food log.
SKIP_GROUPS = {
    "0300",  # Baby foods
    "3500",  # American Indian/Alaska Native foods (mostly raw game and fish parts)
}


# Everyday foods, ranked first in search.
COMMON = {
    "Alcoholic beverage, beer, light",
    "Alcoholic beverage, beer, regular, all",
    "Alcoholic beverage, wine, table, red",
    "Alcoholic beverage, wine, table, white",
    "Apples, raw, with skin",
    "Avocados, raw, all commercial varieties",
    "Bagels, plain, enriched, with calcium propionate (includes onion, poppy, sesame)",
    "Bananas, raw",
    "Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled (Hamburger)",
    "Beverages, carbonated, cola, regular (soft drink, pop, soda)",
    "Beverages, coffee, brewed, prepared with tap water",
    "Beverages, tea, black, brewed, prepared with tap water",
    "Blueberries, raw",
    "Bread, white, commercially prepared (includes soft bread crumbs)",
    "Bread, whole-wheat, commercially prepared",
    "Broccoli, cooked, boiled, drained, without salt",
    "Butter, salted",
    "Carrots, raw",
    "Cereals, oats, regular and quick, not fortified, dry (oatmeal, old-fashioned oats, rolled oats)",
    "Cheese, cheddar",
    "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
    "Chocolate, dark, 70-85% cacao solids",
    "Cream, fluid, half and half",
    "Egg, whole, cooked, fried",
    "Egg, whole, cooked, hard-boiled",
    "Egg, whole, cooked, scrambled",
    "Fast Foods, Fried Chicken, Breast, meat and skin and breading",
    "Fast foods, cheeseburger; single, regular patty; plain",
    "Fast foods, chicken, breaded and fried, boneless pieces, plain (nuggets)",
    "Fast foods, hamburger; single, regular patty; plain",
    "Fast foods, potato, french fried in vegetable oil",
    "Frankfurter, meat",
    "Honey",
    "Ice creams, vanilla",
    "Lettuce, cos or romaine, raw",
    "Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D",
    "Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)",
    "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D",
    "Milk, whole, 3.25% milkfat, with added vitamin D",
    "Oil, olive, salad or cooking",
    "Orange juice, chilled, includes from concentrate",
    "Oranges, raw, navels",
    "Pasta, cooked, enriched, without added salt (macaroni product, spaghetti, elbow macaroni, rotini, lasagna, farfalle, shells, penne)",
    "Peanut butter, smooth style, with salt",
    "Potatoes, baked, flesh and skin, without salt",
    "Rice, brown, long-grain, cooked",
    "Rice, white, long-grain, regular, enriched, cooked",
    "Strawberries, raw",
    "Sugars, granulated (sucrose)",
    "Tomatoes, red, ripe, raw, year round average",
    "Water, bottled, generic",
    "Yogurt, Greek, plain, nonfat",
}

# Everyday portions missing from ABBREV.txt, which lists at most two per food.
# These are offered first; LATER_PORTIONS are offered after USDA's own.
EXTRA_PORTIONS = {
    "Bananas, raw": [["1 medium (7\" to 8\" long)", 118], ["1 large (8\" to 9\" long)", 136], ["1 small (6\" to 7\" long)", 101]],
    "Apples, raw, with skin": [["1 medium (3\" dia)", 182], ["1 large (3-1/4\" dia)", 223], ["1 small (2-3/4\" dia)", 149]],
    "Beverages, coffee, brewed, prepared with tap water": [["1 cup (8 fl oz)", 237], ["1 mug (12 fl oz)", 355], ["1 large (16 fl oz)", 474]],
    "Beverages, tea, black, brewed, prepared with tap water": [["1 cup (8 fl oz)", 237], ["1 mug (12 fl oz)", 355]],
    "Chicken, broilers or fryers, breast, meat only, cooked, roasted": [["1/2 breast, bone and skin removed", 86], ["3 oz", 85]],
    "Egg, whole, cooked, hard-boiled": [["1 large", 50]],
    "Water, bottled, generic": [["1 bottle (16.9 fl oz)", 500]],
}
LATER_PORTIONS = {
    "Beverages, carbonated, cola, regular (soft drink, pop, soda)": [["1 bottle (20 fl oz)", 616]],
    "Alcoholic beverage, beer, regular, all": [["1 pint (16 fl oz)", 474]],
    "Alcoholic beverage, beer, light": [["1 pint (16 fl oz)", 472]],
}

# USDA bookkeeping that means nothing to someone logging food, e.g.
# "(Includes USDA commodity food A343)".
NOISE = re.compile(r"\s*\([^()]*commodit[^()]*\)", re.IGNORECASE)


SMALL_UNIT = re.compile(r"^1 (fl oz|oz|tbsp|tsp|g)$")


def read(path):
    with open(path, encoding="latin-1") as f:
        for line in f:
            yield [field.strip("~") for field in line.rstrip("\r\n").split("^")]


def main(src):
    src = Path(src)
    descriptions = {}
    for row in read(src / "FOOD_DES.txt"):
        ndb, group, long_desc, _short, common_name = row[:5]
        if group in SKIP_GROUPS:
            continue
        name = long_desc
        if common_name and common_name.lower() not in long_desc.lower():
            name = f"{long_desc} ({common_name})"
        name = NOISE.sub("", name)
        if "usda commodity" in name.lower():
            continue  # school-lunch program items
        descriptions[ndb] = name

    foods = []
    for row in read(src / "ABBREV.txt"):
        ndb, kcal = row[0], row[3]
        if ndb not in descriptions or kcal == "":
            continue
        name = descriptions[ndb]
        portions = list(EXTRA_PORTIONS.get(name, []))
        for grams, desc in ((row[48], row[49]), (row[50], row[51])):
            if grams and desc and float(grams) > 0:
                portions.append([desc, round(float(grams), 1)])
        portions += LATER_PORTIONS.get(name, [])
        # Offer real servings ("1 can") before tiny units ("1 fl oz").
        portions.sort(key=lambda p: bool(SMALL_UNIT.match(p[0])))
        foods.append([name, round(float(kcal)), portions, int(name in COMMON)])

    names = {f[0] for f in foods}
    missing = (COMMON | EXTRA_PORTIONS.keys() | LATER_PORTIONS.keys()) - names
    if missing:
        sys.exit(f"Unknown foods in COMMON/EXTRA_PORTIONS: {sorted(missing)}")
    foods.sort(key=lambda f: f[0].lower())
    json.dump(foods, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1])
