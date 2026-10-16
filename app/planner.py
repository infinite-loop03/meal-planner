"""Planning rules.

Spacing rules (applied within one meal type only):
  * a dish appears at most twice in a Monday–Sunday week, never on consecutive days;
  * dishes sharing a perishable ingredient are never on consecutive days;
  * a perishable already opened earlier in the week (and still within its
    shelf life) makes dishes that use it again more likely, so it gets finished.
If no dish satisfies every spacing rule, the one breaking the fewest is picked and flagged.

Pairing rules (made in the Rules screen) only change the odds among dishes that
already pass the spacing rules: "prefer" makes matching dishes much more likely,
"avoid" leaves matching dishes out unless nothing else fits. They never override
the spacing rules.
"""

import random
from datetime import date, timedelta

MEALS = ["breakfast", "lunch", "dinner"]
MAX_PER_WEEK = 2
REUSE_WEIGHT = 3.0
REPEAT_WEIGHT = 0.5
PREFER_WEIGHT = 10.0
AVOID_WEIGHT = 0.05


def parse(d: str) -> date:
    return date.fromisoformat(d)


def iso(d: date) -> str:
    return d.isoformat()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_dates(start: date) -> list[str]:
    return [iso(start + timedelta(days=i)) for i in range(7)]


def empty_slot() -> dict:
    return {
        "dish_id": None,
        "status": "planned",      # planned | cooked | skipped
        "made_extra": False,
        "leftover": False,
        "leftover_from": None,    # "YYYY-MM-DD|meal"
    }


def get_slot(plans: dict, d: str, meal: str) -> dict:
    day = plans.setdefault(d, {})
    if meal not in day:
        day[meal] = empty_slot()
    return day[meal]


def peek_slot(plans: dict, d: str, meal: str):
    return plans.get(d, {}).get(meal)


def next_slot_key(d: str, meal: str) -> tuple[str, str]:
    i = MEALS.index(meal)
    if i < len(MEALS) - 1:
        return d, MEALS[i + 1]
    return iso(parse(d) + timedelta(days=1)), MEALS[0]


def _active(slot) -> bool:
    """A slot that represents real cooking with a dish (counts for the rules)."""
    return bool(slot and slot.get("dish_id") and not slot.get("leftover") and slot.get("status") != "skipped")


def matches(dish: dict, match: dict) -> bool:
    values = set(match.get("values", []))
    kind = match.get("type")
    if kind == "dish":
        return dish["id"] in values
    if kind == "ingredient":
        return bool(values & set(dish.get("ingredients", [])))
    if kind == "tag":
        return bool(values & set(dish.get("tags", [])))
    return False


class Context:
    def __init__(self, plans, dishes, ingredients, rules=None):
        self.plans = plans
        self.dishes = {d["id"]: d for d in dishes}
        self.ingredients = ingredients
        self.rules = [r for r in (rules or []) if r.get("enabled", True)]

    # ---- pairing rules -------------------------------------------------
    def active_rules(self, d: str, meal: str):
        """Rules whose 'when' side is met by an earlier meal, for this slot."""
        for r in self.rules:
            then = r["then"]
            if then["meal"] != meal:
                continue
            src_date = iso(parse(d) - timedelta(days=int(then.get("day_offset", 0))))
            src = peek_slot(self.plans, src_date, r["when"]["meal"])
            if not src or not src.get("dish_id") or src.get("status") == "skipped":
                continue
            src_dish = self.dishes.get(src["dish_id"])
            if src_dish and matches(src_dish, r["when"]["match"]):
                yield r, src_dish

    def rule_effect(self, d: str, meal: str, dish: dict) -> str | None:
        effect = None
        for r, _ in self.active_rules(d, meal):
            if matches(dish, r["then"]["match"]):
                if r["then"]["effect"] == "avoid":
                    return "avoid"
                effect = "prefer"
        return effect

    def describe_match(self, match: dict) -> str:
        vals = match.get("values", [])
        if match.get("type") == "dish":
            names = [self.dishes[v]["name"] if v in self.dishes else v for v in vals]
            return _join(names)
        if match.get("type") == "ingredient":
            return f"anything with {_join(vals)}"
        return f"anything tagged {_join(vals)}"

    def rule_notes(self, d: str, meal: str) -> list[dict]:
        s = peek_slot(self.plans, d, meal)
        dish = self.dishes.get(s["dish_id"]) if s and s.get("dish_id") else None
        notes = []
        for r, src in self.active_rules(d, meal):
            then = r["then"]
            hit = bool(dish and matches(dish, then["match"]))
            prefer = then["effect"] == "prefer"
            when = "yesterday's" if int(then.get("day_offset", 0)) else ""
            src_txt = f"{src['name']} at {when + ' ' if when else ''}{r['when']['meal']}"
            verb = "suggests" if prefer else "avoids"
            notes.append({
                "rule_id": r["id"],
                "effect": then["effect"],
                "followed": hit if prefer else not hit,
                "text": f"{src_txt} {verb} {self.describe_match(then['match'])}",
            })
        return notes

    def perishables(self, dish) -> set[str]:
        return {i for i in dish["ingredients"] if self.ingredients.get(i, {}).get("perishable")}

    def shelf_life(self, ingredient: str) -> int:
        return int(self.ingredients.get(ingredient, {}).get("shelf_life_days", 7))

    def candidates(self, meal: str) -> list[dict]:
        return [d for d in self.dishes.values() if meal in d["meal_types"]]

    # ---- rules ---------------------------------------------------------
    def violations(self, d: str, meal: str, dish: dict) -> list[str]:
        out = []
        day = parse(d)
        count = 0
        for wd in week_dates(week_start(day)):
            for m in MEALS:
                if (wd, m) == (d, meal):
                    continue
                s = peek_slot(self.plans, wd, m)
                if _active(s) and s["dish_id"] == dish["id"]:
                    count += 1
        if count >= MAX_PER_WEEK:
            out.append(f"{dish['name']} is already planned {MAX_PER_WEEK} times this week")

        mine = self.perishables(dish)
        for delta in (-1, 1):
            nd = day + timedelta(days=delta)
            s = peek_slot(self.plans, iso(nd), meal)
            if not _active(s):
                continue
            other = self.dishes.get(s["dish_id"])
            if not other:
                continue
            when = "yesterday" if delta < 0 else "the next day"
            if other["id"] == dish["id"]:
                out.append(f"Same dish {when}")
                continue
            shared = sorted(mine & self.perishables(other))
            if shared:
                out.append(f"Shares {', '.join(shared)} with {other['name']} {when}")
        return out

    def weight(self, d: str, meal: str, dish: dict) -> float:
        w = 1.0
        day = parse(d)
        start = week_start(day)
        # Prefer finishing a perishable that was opened earlier this week.
        for p in self.perishables(dish):
            for back in range(2, self.shelf_life(p)):
                pd = day - timedelta(days=back)
                if pd < start:
                    break
                s = peek_slot(self.plans, iso(pd), meal)
                if _active(s):
                    other = self.dishes.get(s["dish_id"])
                    if other and p in other["ingredients"]:
                        w = REUSE_WEIGHT
                        break
        # Pairing rules from the Rules screen.
        effect = self.rule_effect(d, meal, dish)
        if effect == "prefer":
            w *= PREFER_WEIGHT
        elif effect == "avoid":
            w *= AVOID_WEIGHT
        # Mild preference for dishes not yet used this week.
        for wd in week_dates(start):
            s = peek_slot(self.plans, wd, meal)
            if wd != d and _active(s) and s["dish_id"] == dish["id"]:
                w *= REPEAT_WEIGHT
        return w

    def choose(self, d: str, meal: str, rng: random.Random, avoid: str | None = None) -> str | None:
        pool = self.candidates(meal)
        if avoid and len(pool) > 1:
            pool = [x for x in pool if x["id"] != avoid]
        if not pool:
            return None
        scored = [(x, self.violations(d, meal, x)) for x in pool]
        fewest = min(len(v) for _, v in scored)
        best = [x for x, v in scored if len(v) == fewest]
        # "Avoid" rules exclude a dish whenever something else fits.
        not_avoided = [x for x in best if self.rule_effect(d, meal, x) != "avoid"]
        best = not_avoided or best
        weights = [self.weight(d, meal, x) for x in best]
        return rng.choices(best, weights=weights, k=1)[0]["id"]


    def options(self, d: str, meal: str) -> list[dict]:
        out = []
        for x in self.candidates(meal):
            out.append({
                "id": x["id"],
                "name": x["name"],
                "emoji": x.get("emoji"),
                "violations": self.violations(d, meal, x),
                "rule": self.rule_effect(d, meal, x),
            })
        rank = {"prefer": 0, None: 1, "avoid": 2}
        out.sort(key=lambda o: (bool(o["violations"]), rank[o["rule"]], o["name"].lower()))
        return out


def _join(items: list[str]) -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " or " + items[-1]


# ---- operations on plans --------------------------------------------------

def _clear(slot: dict) -> None:
    slot.update(dish_id=None, made_extra=False, leftover=False, leftover_from=None, status="planned")


def _locked(slot: dict) -> bool:
    return slot["status"] in ("cooked", "skipped")


def generate_week(ctx: Context, start: date, rng: random.Random) -> None:
    """Refill every planned slot of the week. Cooked/skipped meals are kept,
    and so are leftovers whose source meal is kept."""
    dates = week_dates(start)
    keep = set()
    for d in dates:
        for m in MEALS:
            s = get_slot(ctx.plans, d, m)
            if _locked(s):
                keep.add(f"{d}|{m}")
    for d in dates:
        for m in MEALS:
            s = get_slot(ctx.plans, d, m)
            if _locked(s):
                continue
            src = s.get("leftover_from")
            src_kept = src and (src in keep or src.split("|")[0] not in dates)
            if s.get("leftover") and src_kept:
                continue
            _clear(s)
    for d in dates:
        for m in MEALS:
            s = get_slot(ctx.plans, d, m)
            if s["dish_id"] is None and not _locked(s):
                s["dish_id"] = ctx.choose(d, m, rng)


def regenerate_slot(ctx: Context, d: str, meal: str, rng: random.Random) -> None:
    s = get_slot(ctx.plans, d, meal)
    current = s["dish_id"]
    s.update(leftover=False, leftover_from=None, dish_id=None, status="planned")
    s["dish_id"] = ctx.choose(d, meal, rng, avoid=current)
    _sync_leftover(ctx, d, meal, rng)


def set_dish(ctx: Context, d: str, meal: str, dish_id: str, rng: random.Random) -> None:
    s = get_slot(ctx.plans, d, meal)
    s.update(dish_id=dish_id, leftover=False, leftover_from=None, status="planned")
    _sync_leftover(ctx, d, meal, rng)


def set_made_extra(ctx: Context, d: str, meal: str, on: bool, rng: random.Random) -> None:
    s = get_slot(ctx.plans, d, meal)
    s["made_extra"] = bool(on)
    _sync_leftover(ctx, d, meal, rng)


def _sync_leftover(ctx: Context, d: str, meal: str, rng: random.Random) -> None:
    """Keep the next meal in step with this meal's 'made extra' flag."""
    s = get_slot(ctx.plans, d, meal)
    key = f"{d}|{meal}"
    nd, nm = next_slot_key(d, meal)
    n = get_slot(ctx.plans, nd, nm)
    if s["made_extra"] and s["dish_id"] and s["status"] != "skipped":
        if not _locked(n):
            n.update(dish_id=s["dish_id"], leftover=True, leftover_from=key, made_extra=False)
    elif n.get("leftover_from") == key and not _locked(n):
        n.update(leftover=False, leftover_from=None, dish_id=None)
        n["dish_id"] = ctx.choose(nd, nm, rng)


def set_status(ctx: Context, d: str, meal: str, status: str, rng: random.Random) -> None:
    s = get_slot(ctx.plans, d, meal)
    s["status"] = status
    if s["made_extra"]:
        _sync_leftover(ctx, d, meal, rng)


def slot_flags(ctx: Context, d: str, meal: str) -> list[str]:
    s = peek_slot(ctx.plans, d, meal)
    if not _active(s):
        return []
    dish = ctx.dishes.get(s["dish_id"])
    return ctx.violations(d, meal, dish) if dish else []


class SwapError(ValueError):
    pass


def swap_slots(ctx: Context, a: tuple[str, str], b: tuple[str, str], rng: random.Random) -> None:
    sa, sb = get_slot(ctx.plans, *a), get_slot(ctx.plans, *b)
    for s in (sa, sb):
        if not s["dish_id"]:
            raise SwapError("Both meals need a dish to swap")
        if _locked(s):
            raise SwapError("Cooked or skipped meals can't be moved")
        if s["leftover"]:
            raise SwapError("Leftovers can't be moved")
    da, db = ctx.dishes.get(sa["dish_id"]), ctx.dishes.get(sb["dish_id"])
    if not da or not db:
        raise SwapError("One of these dishes was deleted")
    if b[1] not in da["meal_types"] or a[1] not in db["meal_types"]:
        raise SwapError(f"{da['name'] if b[1] not in da['meal_types'] else db['name']} isn't set up for that meal")
    sa["dish_id"], sb["dish_id"] = sb["dish_id"], sa["dish_id"]
    _sync_leftover(ctx, *a, rng)
    _sync_leftover(ctx, *b, rng)
