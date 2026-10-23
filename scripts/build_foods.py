"""Build foods.json from the USDA National Nutrient Database for Standard
Reference, Release 28 (public domain).

The SR28 ASCII files ABBREV.txt and FOOD_DES.txt are available in the
fda-nutrient-database npm package (data/ folder) or from USDA directly.

    python3 scripts/build_foods.py path/to/sr28/data > foods.json

Output: a JSON array of [name, kcal per 100 g, [[portion, grams], ...], common],
where common is 1 for everyday foods that should rank first in search (2 for
the first choice among them, e.g. brewed coffee over espresso for "coffee",
and 3 for meals, which rank first only when their name's words were typed).
Coffee-shop lattes, which USDA doesn't list, are added from USDA milk values.
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
    "Pork, cured, bacon, cooked, baked",
    "Bread, white, commercially prepared, toasted",
    "Fast foods, submarine sandwich, cold cut on white bread with lettuce and tomato",
    "PIZZA HUT 14\" Cheese Pizza, Hand-Tossed Crust",
    "Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled (Hamburger)",
    "Beverages, carbonated, cola, regular (soft drink, pop, soda)",
    "Beverages, coffee, brewed, espresso, restaurant-prepared",
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
    "Beverages, coffee, brewed, espresso, restaurant-prepared": [["1 shot (1 fl oz)", 30], ["2 shots (double)", 60]],
    "Beverages, tea, black, brewed, prepared with tap water": [["1 cup (8 fl oz)", 237], ["1 mug (12 fl oz)", 355]],
    "Chicken, broilers or fryers, breast, meat only, cooked, roasted": [["1/2 breast, bone and skin removed", 86], ["3 oz", 85]],
    "Egg, whole, cooked, hard-boiled": [["1 large", 50]],
    "Bread, white, commercially prepared, toasted": [["1 slice", 23], ["2 slices", 46]],
    "Water, bottled, generic": [["1 bottle (16.9 fl oz)", 500]],
}
FIRST_CHOICE = {"Beverages, coffee, brewed, prepared with tap water", "Rice, white, long-grain, regular, enriched, cooked"}

# Lattes: espresso plus milk. Milk per cup size is estimated so a 2% latte
# matches typical coffee-shop numbers (about 130 cal for a 16 oz iced latte,
# 190 for 16 oz hot); iced cups hold less milk because of the ice.
ESPRESSO = "Beverages, coffee, brewed, espresso, restaurant-prepared"
LATTE_MILKS = {
    "whole milk": "Milk, whole, 3.25% milkfat, with added vitamin D",
    "2% milk": "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D",
    "skim milk": "Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)",
    "oat milk": None,  # not in SR28; see OAT_MILK_KCAL
    "almond milk, unsweetened": "Beverages, almond milk, unsweetened, shelf stable",
    "soy milk": "Soymilk (all flavors), unsweetened, with added calcium, vitamins A and D",
}
# The median of 106 oat milks in Open Food Facts (about 120 cal per cup).
OAT_MILK_KCAL = 50
LATTE_SIZES = {  # cup size: fl oz of milk
    "iced": [("Small, 12 oz", 6.5), ("Regular, 16 oz", 8.5), ("Large, 20 oz", 11)],
    "hot": [("Small, 12 oz", 10), ("Regular, 16 oz", 12.5), ("Large, 20 oz", 16)],
}
ML_PER_FL_OZ = 29.57
SHOTS_GRAMS = 60  # two shots of espresso


def lattes(kcal_of):
    """Latte foods for each temperature and milk, sized in grams of milk plus espresso."""
    foods = []
    for temp, sizes in LATTE_SIZES.items():
        for milk, usda_name in LATTE_MILKS.items():
            milk_kcal = kcal_of[usda_name] if usda_name else OAT_MILK_KCAL
            portions, total_kcal, total_grams = [], 0, 0
            for size, fl_oz in sizes:
                milk_g = fl_oz * ML_PER_FL_OZ * 1.03  # milk weighs about 1.03 g per ml
                kcal = milk_g * milk_kcal / 100 + SHOTS_GRAMS * kcal_of[ESPRESSO] / 100
                portions.append([f"{size} cup (about {fl_oz:g} fl oz milk, 2 shots)", round(milk_g + SHOTS_GRAMS, 1)])
                total_kcal, total_grams = total_kcal + kcal, total_grams + milk_g + SHOTS_GRAMS
            # Regular first: it's what most people order.
            portions = [portions[1], portions[0], portions[2]]
            foods.append([f"Latte, {temp}, {milk}", round(total_kcal / total_grams * 100), portions, 1])
    # Black iced coffee and cold brew: brewed coffee, about 2 cal per 16 oz.
    coffee = kcal_of["Beverages, coffee, brewed, prepared with tap water"]
    cups = [["Regular, 16 oz cup (about 12 fl oz coffee, the rest ice)", 355], ["Small, 12 oz cup", 266], ["Large, 20 oz cup", 444]]
    foods.append(["Coffee, iced, black", coffee, cups, 1])
    foods.append(["Cold brew coffee, black", coffee, cups, 1])
    return foods


# Everyday meals USDA's SR28 doesn't list, built from its ingredients:
# name, serving label, [(USDA food, grams), ...]. The part of the name before
# any comma is what must be typed for the meal to rank first ("burrito bowl").
WHITE_BREAD = "Bread, white, commercially prepared (includes soft bread crumbs)"  # 29 g a slice
WHEAT_BREAD = "Bread, whole-wheat, commercially prepared"  # 32 g a slice
CHICKEN = "Chicken, broilers or fryers, breast, meat only, cooked, roasted"
WHITE_RICE = "Rice, white, long-grain, regular, enriched, cooked"
MILK_2 = "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D"
COFFEE = "Beverages, coffee, brewed, prepared with tap water"
AMERICAN = "Cheese, pasteurized process, American, without added vitamin D"  # 21 g a slice
MAYO = "Salad dressing, mayonnaise, regular"
LETTUCE = "Lettuce, iceberg (includes crisphead types), raw"
TOMATO = "Tomatoes, red, ripe, raw, year round average"
CHEDDAR = "Cheese, cheddar"
SALSA = "Sauce, salsa, ready-to-serve"
BEANS = "Beans, black, mature seeds, cooked, boiled, without salt"
FLOUR_TORTILLA = "Tortillas, ready-to-bake or -fry, flour, refrigerated"
PASTA = "Pasta, cooked, enriched, without added salt (macaroni product, spaghetti, elbow macaroni, rotini, lasagna, farfalle, shells, penne)"
MARINARA = "Sauce, pasta, spaghetti/marinara, ready-to-serve"
RANCH = "Salad dressing, ranch dressing, regular"
SALAD = [(LETTUCE, 100), (TOMATO, 60), ("Cucumber, with peel, raw", 50), ("Carrots, raw", 30)]
MEALS = [
    ("Cereal with milk", "1 bowl (1 cup cereal, 1/2 cup 2% milk)", [("Cereals ready-to-eat, GENERAL MILLS, CHEERIOS", 28), (MILK_2, 122)]),
    ("Oatmeal, made with water", "1 bowl (1/2 cup dry oats)", [("Cereals, oats, regular and quick, not fortified, dry (oatmeal, old-fashioned oats, rolled oats)", 40)]),
    ("Oatmeal, made with milk", "1 bowl (1/2 cup dry oats, 1 cup 2% milk)", [("Cereals, oats, regular and quick, not fortified, dry (oatmeal, old-fashioned oats, rolled oats)", 40), (MILK_2, 244)]),
    ("Eggs and toast", "2 fried eggs, 2 slices buttered toast", [("Egg, whole, cooked, fried", 92), (WHITE_BREAD, 58), ("Butter, salted", 10)]),
    ("Peanut butter and jelly sandwich (PB&J)", "1 sandwich", [(WHITE_BREAD, 58), ("Peanut butter, smooth style, with salt", 32), ("Jams and preserves", 20)]),
    ("Turkey sandwich", "1 sandwich", [(WHITE_BREAD, 58), ("Turkey breast, sliced, prepackaged", 56), (MAYO, 14), (LETTUCE, 10), (TOMATO, 20)]),
    ("Turkey and cheese sandwich", "1 sandwich", [(WHITE_BREAD, 58), ("Turkey breast, sliced, prepackaged", 56), (AMERICAN, 21), (MAYO, 14), (LETTUCE, 10)]),
    ("Ham and cheese sandwich", "1 sandwich", [(WHITE_BREAD, 58), ("Ham, sliced, regular (approximately 11% fat)", 56), (AMERICAN, 21), (MAYO, 14)]),
    ("Grilled cheese, sandwich", "1 sandwich", [(WHITE_BREAD, 58), (AMERICAN, 42), ("Butter, salted", 10)]),
    ("BLT, sandwich", "1 sandwich", [("Bread, white, commercially prepared, toasted", 46), ("Pork, cured, bacon, cooked, baked", 24), (LETTUCE, 10), (TOMATO, 30), (MAYO, 14)]),
    ("Avocado toast", "1 slice", [(WHEAT_BREAD, 32), ("Avocados, raw, all commercial varieties", 50)]),
    ("Bagel with cream cheese", "1 bagel, 2 tbsp cream cheese", [("Bagels, plain, enriched, with calcium propionate (includes onion, poppy, sesame)", 99), ("Cheese, cream", 29)]),
    ("Greek yogurt with granola", "1 container, 1/4 cup granola", [("Yogurt, Greek, plain, nonfat", 170), ("Cereals ready-to-eat, granola, homemade", 30)]),
    ("Protein shake, made with water", "1 scoop whey", [("Beverages, Protein powder whey based", 32)]),
    ("Protein shake, made with milk", "1 scoop whey, 1 cup 2% milk", [("Beverages, Protein powder whey based", 32), (MILK_2, 244)]),
    ("Chicken and rice", "1 plate (5 oz chicken breast, 1 cup rice)", [(CHICKEN, 140), (WHITE_RICE, 158)]),
    ("Salmon with rice and broccoli", "1 plate (5 oz salmon, 1 cup rice, 1/2 cup broccoli)", [("Fish, salmon, Atlantic, farmed, cooked, dry heat", 140), (WHITE_RICE, 158), ("Broccoli, cooked, boiled, drained, without salt", 78)]),
    ("Steak and potato", "1 plate (6 oz sirloin, baked potato, 1 tbsp butter)", [("Beef, top sirloin, steak, separable lean and fat, trimmed to 0\" fat, all grades, cooked, broiled (Sirloin strip, Sirloin steak)", 170), ("Potatoes, baked, flesh and skin, without salt", 173), ("Butter, salted", 14)]),
    ("Salad, garden, with ranch", "1 bowl, 2 tbsp ranch", SALAD + [(RANCH, 30)]),
    ("Salad, grilled chicken, with ranch", "1 bowl, 3 oz chicken, 2 tbsp ranch", SALAD + [(CHICKEN, 85), (RANCH, 30)]),
    ("Spaghetti with meat sauce", "1 plate (1 1/2 cups pasta)", [(PASTA, 186), (MARINARA, 132), ("Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned (ground round, hamburger)", 56)]),
    ("Spaghetti with marinara", "1 plate (1 1/2 cups pasta)", [(PASTA, 186), (MARINARA, 132)]),
    ("Tacos, beef", "2 tacos", [("Tortillas, ready-to-bake or -fry, corn, without added salt", 52), ("Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned (hamburger)", 70), (CHEDDAR, 20), (LETTUCE, 20), (SALSA, 30)]),
    ("Burrito bowl, chicken", "1 bowl (rice, chicken, beans, cheese, salsa)", [(WHITE_RICE, 150), (CHICKEN, 113), (BEANS, 86), (CHEDDAR, 28), (SALSA, 60), (LETTUCE, 30)]),
    ("Burrito, chicken", "1 burrito", [(FLOUR_TORTILLA, 100), (WHITE_RICE, 100), (CHICKEN, 113), (BEANS, 86), (CHEDDAR, 28), (SALSA, 30)]),
    ("Cheese quesadilla", "1 quesadilla", [(FLOUR_TORTILLA, 70), (CHEDDAR, 56)]),
    ("Hamburger, homemade", "1 burger", [("Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled (Hamburger)", 77), ("Rolls, hamburger or hotdog, plain", 44), ("Catsup (Ketchup)", 17), (LETTUCE, 10), (TOMATO, 20)]),
    ("Cheeseburger, homemade", "1 burger", [("Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled (Hamburger)", 77), ("Rolls, hamburger or hotdog, plain", 44), (AMERICAN, 21), ("Catsup (Ketchup)", 17), (LETTUCE, 10)]),
    ("Coffee with milk", "1 mug (12 oz coffee, 2 oz 2% milk)", [(COFFEE, 355), (MILK_2, 60)]),
    ("Coffee with cream", "1 mug (12 oz coffee, 2 tbsp half and half)", [(COFFEE, 355), ("Cream, fluid, half and half", 30)]),
    ("Coffee with cream and sugar", "1 mug (12 oz coffee, 2 tbsp half and half, 2 tsp sugar)", [(COFFEE, 355), ("Cream, fluid, half and half", 30), ("Sugars, granulated (sucrose)", 8.4)]),
]


def meals(kcal_of):
    foods = []
    for name, serving, parts in MEALS:
        missing = [n for n, _ in parts if n not in kcal_of]
        if missing:
            sys.exit(f"Unknown ingredients in {name}: {missing}")
        grams = sum(g for _, g in parts)
        kcal = sum(kcal_of[n] * g / 100 for n, g in parts)
        foods.append([name, round(kcal / grams * 100), [[serving, round(grams, 1)]], 3])
    return foods


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
        foods.append([name, round(float(kcal)), portions, 2 if name in FIRST_CHOICE else int(name in COMMON)])

    names = {f[0] for f in foods}
    missing = (COMMON | EXTRA_PORTIONS.keys() | LATER_PORTIONS.keys()) - names
    if missing:
        sys.exit(f"Unknown foods in COMMON/EXTRA_PORTIONS: {sorted(missing)}")
    kcal_of = {f[0]: f[1] for f in foods}
    foods += lattes(kcal_of) + meals(kcal_of)
    foods.sort(key=lambda f: f[0].lower())
    json.dump(foods, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1])
