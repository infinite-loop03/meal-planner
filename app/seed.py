"""Default data written to data/ the first time the app starts.

Ingredients are typical ones for each dish. Salt, oil, water and everyday
spices (haldi, mirchi, jeera, rai, garam masala) are left out on purpose,
so the grocery list only shows things worth ordering. Edit anything from
the Dishes and Pantry screens.
"""

BREAKFAST = {
    "Poha": ["poha", "onion", "peanuts", "curry leaves", "green chilli", "lemon", "coriander"],
    "Mushroom Toast": ["bread", "mushroom", "onion", "butter", "cheese"],
    "Malai Sandwich": ["bread", "malai", "cucumber", "tomato"],
    "Paneer Sandwich": ["bread", "paneer", "capsicum", "onion", "butter"],
    "Dhokla": ["besan", "curd", "eno", "curry leaves", "green chilli"],
    "Moong Cheela": ["moong dal", "onion", "tomato", "ginger", "coriander"],
    "Besan Cheela": ["besan", "onion", "tomato", "coriander", "green chilli"],
    "Boiled Chana": ["kala chana", "onion", "tomato", "lemon", "coriander"],
    "Vermicelli": ["vermicelli", "onion", "carrot", "peas", "curry leaves"],
    "Upama": ["sooji", "onion", "carrot", "peas", "curry leaves"],
    "Sprouts": ["sprouted moong", "onion", "tomato", "lemon", "coriander"],
    "Bread Poha": ["bread", "onion", "peanuts", "curry leaves", "green chilli"],
    "Handwa": ["handwa flour", "lauki", "curd", "sesame seeds"],
    "Appe": ["sooji", "curd", "onion", "capsicum", "eno"],
    "Sabudana Khichadi": ["sabudana", "potato", "peanuts", "green chilli"],
    "Pancakes": ["maida", "milk", "sugar", "butter", "baking powder"],
    "Overnight Oats": ["oats", "milk", "chia seeds", "banana", "honey"],
}

LUNCH = {
    "Bhindi": ["bhindi", "onion"],
    "Achari Aloo": ["potato", "achar masala"],
    "Phool gobi": ["cauliflower", "potato", "tomato"],
    "Patta gobi": ["cabbage", "peas"],
    "Paneer": ["paneer", "onion", "tomato", "capsicum", "cream"],
    "Aloo palak": ["potato", "palak", "garlic"],
    "Palak paneer": ["palak", "paneer", "onion", "tomato", "cream"],
    "Aloo methi": ["potato", "methi", "garlic"],
    "Shimla mirch besan": ["capsicum", "besan"],
    "Chole": ["kabuli chana", "onion", "tomato", "chole masala"],
    "Rajma": ["rajma", "onion", "tomato", "ginger", "garlic"],
    "Arbi": ["arbi", "ajwain"],
    "Arbi patte besan": ["arbi leaves", "besan", "tamarind"],
    "Chawli": ["chawli", "onion", "tomato"],
    "Aloo pyaaz": ["potato", "onion"],
    "Aloo shimla mirch": ["potato", "capsicum"],
    "Methi Paratha": ["atta", "methi", "curd"],
    "Corn Palak": ["sweet corn", "palak", "onion", "cream"],
    "Pav Bhaji": ["pav", "potato", "cauliflower", "capsicum", "peas", "tomato", "onion", "butter", "pav bhaji masala"],
    "Idli sambhar": ["idli batter", "toor dal", "tomato", "drumstick", "sambhar masala", "coconut"],
    "Dal Dhokli": ["toor dal", "atta", "peanuts", "jaggery", "tamarind"],
    "Aloo matar gravy": ["potato", "peas", "onion", "tomato"],
    "Methi matar masala": ["methi", "peas", "onion", "cream"],
    "Lauki Kofte": ["lauki", "besan", "onion", "tomato", "cream"],
    "Dum Aloo": ["baby potato", "curd", "onion", "tomato"],
    "Kadhi Pakoda": ["curd", "besan", "onion"],
}

DINNER = {
    "Oats": ["oats", "onion", "carrot", "peas"],
    "Pulao": ["rice", "peas", "carrot", "beans", "onion"],
    "Khichadi": ["rice", "moong dal", "ghee"],
    "Quinoa": ["quinoa", "onion", "capsicum", "carrot"],
    "Dalia": ["dalia", "peas", "carrot", "onion"],
    "Maggi": ["maggi", "onion", "peas"],
    "White sauce pasta": ["penne pasta", "milk", "butter", "maida", "cheese", "capsicum", "sweet corn"],
    "Macaroni": ["macaroni", "tomato", "onion", "capsicum", "cheese"],
    "Noodles": ["noodles", "cabbage", "capsicum", "carrot", "soy sauce"],
    "Sev Tamatar": ["sev", "tomato", "onion"],
    "Rajma salad": ["rajma", "onion", "tomato", "cucumber", "lemon"],
    "Roll": ["wraps", "paneer", "onion", "capsicum", "cabbage", "mayonnaise"],
}

# Perishables used by the spacing rule. Everyday aromatics (tomato, onion,
# coriander, green chilli, ginger, lemon) are left non-perishable by default
# because they are in almost every dish and would block nearly every plan.
PERISHABLE = {
    "bread", "mushroom", "malai", "cucumber", "paneer", "capsicum", "cheese",
    "sprouted moong", "lauki", "banana", "bhindi", "cauliflower", "cabbage",
    "palak", "methi", "arbi", "arbi leaves", "chawli", "sweet corn", "pav",
    "idli batter", "drumstick", "coconut", "carrot", "peas", "beans",
    "baby potato", "cream", "wraps", "curry leaves",
}

STAPLES = ["milk", "curd"]

EMOJI = {
    "Poha": "🥣", "Mushroom Toast": "🍄", "Malai Sandwich": "🥪", "Paneer Sandwich": "🥪",
    "Dhokla": "🍘", "Moong Cheela": "🥞", "Besan Cheela": "🥞", "Boiled Chana": "🫘",
    "Vermicelli": "🍜", "Upama": "🥣", "Sprouts": "🌱", "Bread Poha": "🍞", "Handwa": "🍘",
    "Appe": "🧆", "Sabudana Khichadi": "🥣", "Pancakes": "🥞", "Overnight Oats": "🥣",
    "Bhindi": "🥒", "Achari Aloo": "🥔", "Phool gobi": "🥦", "Patta gobi": "🥬", "Paneer": "🧀",
    "Aloo palak": "🥬", "Palak paneer": "🥬", "Aloo methi": "🌿", "Shimla mirch besan": "🫑",
    "Chole": "🫘", "Rajma": "🫘", "Arbi": "🥔", "Arbi patte besan": "🍃", "Chawli": "🫘",
    "Aloo pyaaz": "🧅", "Aloo shimla mirch": "🫑", "Methi Paratha": "🫓", "Corn Palak": "🌽",
    "Pav Bhaji": "🥘", "Idli sambhar": "🍥", "Dal Dhokli": "🍲", "Aloo matar gravy": "🫛",
    "Methi matar masala": "🫛", "Lauki Kofte": "🧆", "Dum Aloo": "🥔", "Kadhi Pakoda": "🍛",
    "Oats": "🥣", "Pulao": "🍚", "Khichadi": "🍲", "Quinoa": "🥗", "Dalia": "🥣", "Maggi": "🍜",
    "White sauce pasta": "🍝", "Macaroni": "🍝", "Noodles": "🍜", "Sev Tamatar": "🍅",
    "Rajma salad": "🥗", "Roll": "🌯",
}
DEFAULT_EMOJI = "🍽️"

TAGS = {
    "Dal Dhokli": ["dal"],
    "Idli sambhar": ["dal"],
    "Khichadi": ["dal", "rice"],
    "Pulao": ["rice"],
}

DEFAULT_SHELF_LIFE_DAYS = 7


def _slug(name: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")


def default_dishes() -> list[dict]:
    dishes = []
    for meal, table in (("breakfast", BREAKFAST), ("lunch", LUNCH), ("dinner", DINNER)):
        for name, ingredients in table.items():
            dishes.append({
                "id": f"{meal[0]}-{_slug(name)}",
                "name": name,
                "emoji": EMOJI.get(name, DEFAULT_EMOJI),
                "meal_types": [meal],
                "ingredients": ingredients,
                "tags": list(TAGS.get(name, [])),
            })
    return dishes


def default_rules() -> list[dict]:
    # Your example: dal at lunch, so dinner leans to khichadi, quinoa or rice.
    return [{
        "id": "r-dal-lunch",
        "enabled": True,
        "when": {"meal": "lunch", "match": {"type": "tag", "values": ["dal"]}},
        "then": {
            "meal": "dinner",
            "day_offset": 0,
            "effect": "prefer",
            "match": {"type": "dish", "values": ["d-khichadi", "d-quinoa", "d-pulao"]},
        },
    }]


def default_ingredients() -> dict:
    names = sorted({i for d in default_dishes() for i in d["ingredients"]} | set(STAPLES))
    return {
        n: {"perishable": n in PERISHABLE, "shelf_life_days": DEFAULT_SHELF_LIFE_DAYS}
        for n in names
    }


def default_pantry() -> dict:
    # Everything starts out of stock; you mark what you already have.
    return {n: False for n in default_ingredients()}
