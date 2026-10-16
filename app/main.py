import mimetypes
import random
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import planner, storage
from .seed import DEFAULT_EMOJI, DEFAULT_SHELF_LIFE_DAYS

STATIC = Path(__file__).resolve().parent.parent / "static"
mimetypes.add_type("application/manifest+json", ".webmanifest")
Meal = Literal["breakfast", "lunch", "dinner"]

rng = random.Random()


@asynccontextmanager
async def lifespan(_app):
    storage.ensure_data()
    yield


app = FastAPI(title="Meal Planner", lifespan=lifespan)


# ---- helpers ----------------------------------------------------------------

def _ctx() -> planner.Context:
    return planner.Context(
        storage.load("plans"), storage.load("dishes"), storage.load("ingredients"), storage.load("rules")
    )


def _check_date(d: str) -> str:
    try:
        return planner.parse(d).isoformat()
    except ValueError:
        raise HTTPException(400, f"Not a date: {d}")


def _clean_ingredients(items: list[str]) -> list[str]:
    seen, out = set(), []
    for i in items:
        n = re.sub(r"\s+", " ", i.strip().lower())
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _clean_tags(items: list[str]) -> list[str]:
    return _clean_ingredients(items)


def _register_ingredients(names: list[str]) -> None:
    ingredients = storage.load("ingredients")
    pantry = storage.load("pantry")
    changed = False
    for n in names:
        if n not in ingredients:
            ingredients[n] = {"perishable": False, "shelf_life_days": DEFAULT_SHELF_LIFE_DAYS}
            changed = True
        if n not in pantry:
            pantry[n] = False
            changed = True
    if changed:
        storage.save("ingredients", ingredients)
        storage.save("pantry", pantry)


def _week_payload(start: date) -> dict:
    ctx = _ctx()
    staples = set(storage.load("staples"))
    days = []
    for d in planner.week_dates(start):
        meals = {}
        for m in planner.MEALS:
            s = planner.peek_slot(ctx.plans, d, m) or planner.empty_slot()
            dish = ctx.dishes.get(s["dish_id"]) if s["dish_id"] else None
            meals[m] = {
                **s,
                "dish_name": dish["name"] if dish else (None if not s["dish_id"] else "Deleted dish"),
                "emoji": dish.get("emoji") if dish else None,
                "staple_hints": sorted(set(dish["ingredients"]) & staples) if dish else [],
                "flags": planner.slot_flags(ctx, d, m),
                "rule_notes": ctx.rule_notes(d, m) if s["dish_id"] and not s["leftover"] else [],
            }
        days.append({"date": d, "meals": meals})
    return {"start": start.isoformat(), "today": date.today().isoformat(), "days": days}


def _mutate_slot(d: str, fn) -> dict:
    d = _check_date(d)
    with storage.transaction():
        ctx = _ctx()
        fn(ctx, d)
        storage.save("plans", ctx.plans)
    return _week_payload(planner.week_start(planner.parse(d)))


# ---- plan -------------------------------------------------------------------

@app.get("/api/week")
def get_week(start: str | None = None):
    base = planner.parse(_check_date(start)) if start else date.today()
    return _week_payload(planner.week_start(base))


class GenerateBody(BaseModel):
    start: str


@app.post("/api/week/generate")
def generate(body: GenerateBody):
    start = planner.week_start(planner.parse(_check_date(body.start)))
    with storage.transaction():
        ctx = _ctx()
        planner.generate_week(ctx, start, rng)
        storage.save("plans", ctx.plans)
    return _week_payload(start)


@app.post("/api/slot/{d}/{meal}/regenerate")
def regenerate(d: str, meal: Meal):
    return _mutate_slot(d, lambda ctx, d: planner.regenerate_slot(ctx, d, meal, rng))


class DishChoice(BaseModel):
    dish_id: str


@app.put("/api/slot/{d}/{meal}/dish")
def choose_dish(d: str, meal: Meal, body: DishChoice):
    def fn(ctx, d):
        if body.dish_id not in ctx.dishes:
            raise HTTPException(404, "Dish not found")
        planner.set_dish(ctx, d, meal, body.dish_id, rng)
    return _mutate_slot(d, fn)


@app.get("/api/slot/{d}/{meal}/options")
def dish_options(d: str, meal: Meal):
    d = _check_date(d)
    return _ctx().options(d, meal)


class SlotRef(BaseModel):
    date: str
    meal: Meal


class SwapBody(BaseModel):
    a: SlotRef
    b: SlotRef


@app.post("/api/swap")
def swap(body: SwapBody):
    a = (_check_date(body.a.date), body.a.meal)
    b = (_check_date(body.b.date), body.b.meal)
    if a == b:
        raise HTTPException(400, "Pick two different meals")
    with storage.transaction():
        ctx = _ctx()
        try:
            planner.swap_slots(ctx, a, b, rng)
        except planner.SwapError as e:
            raise HTTPException(400, str(e))
        storage.save("plans", ctx.plans)
    return _week_payload(planner.week_start(planner.parse(a[0])))


class ExtraBody(BaseModel):
    made_extra: bool


@app.put("/api/slot/{d}/{meal}/extra")
def made_extra(d: str, meal: Meal, body: ExtraBody):
    return _mutate_slot(d, lambda ctx, d: planner.set_made_extra(ctx, d, meal, body.made_extra, rng))


class StatusBody(BaseModel):
    status: Literal["planned", "cooked", "skipped"]
    finished: list[str] = Field(default_factory=list)


@app.put("/api/slot/{d}/{meal}/status")
def set_status(d: str, meal: Meal, body: StatusBody):
    def fn(ctx, d):
        slot = planner.get_slot(ctx.plans, d, meal)
        if not slot["dish_id"]:
            raise HTTPException(400, "This meal has no dish yet")
        planner.set_status(ctx, d, meal, body.status, rng)
        if body.status == "cooked" and body.finished:
            pantry = storage.load("pantry")
            for n in body.finished:
                if n in pantry:
                    pantry[n] = False
            storage.save("pantry", pantry)
        if body.status in ("cooked", "skipped"):
            dish = ctx.dishes.get(slot["dish_id"])
            history = storage.load("history")
            history.append({
                "date": d,
                "meal": meal,
                "dish_id": slot["dish_id"],
                "dish_name": dish["name"] if dish else None,
                "status": body.status,
                "leftover": slot["leftover"],
                "finished": body.finished if body.status == "cooked" else [],
                "recorded_at": datetime.now().isoformat(timespec="seconds"),
            })
            storage.save("history", history)
    return _mutate_slot(d, fn)


# ---- grocery ----------------------------------------------------------------

@app.get("/api/grocery")
def grocery(range: Literal["tomorrow", "week"] = "tomorrow"):
    today = date.today()
    if range == "tomorrow":
        dates = [today + timedelta(days=1)]
    else:
        dates = [today + timedelta(days=i) for i in range(7)]
    ctx = _ctx()
    pantry = storage.load("pantry")
    staples = set(storage.load("staples"))
    items: dict[str, list[str]] = {}
    hints: dict[str, list[str]] = {}
    for day in dates:
        d = day.isoformat()
        for m in planner.MEALS:
            s = planner.peek_slot(ctx.plans, d, m)
            if not s or not s["dish_id"] or s["leftover"] or s["status"] != "planned":
                continue
            dish = ctx.dishes.get(s["dish_id"])
            if not dish:
                continue
            label = {"date": d, "meal": m, "dish": dish["name"]}
            for ing in dish["ingredients"]:
                if ing in staples:
                    hints.setdefault(ing, []).append(label)
                elif not pantry.get(ing, False):
                    items.setdefault(ing, []).append(label)
    return {
        "range": range,
        "dates": [d.isoformat() for d in dates],
        "items": [{"name": k, "for": v} for k, v in sorted(items.items())],
        "staple_hints": [{"name": k, "for": v} for k, v in sorted(hints.items())],
    }


# ---- dishes -----------------------------------------------------------------

class DishBody(BaseModel):
    name: str = Field(min_length=1)
    emoji: str = Field(default="", max_length=16)
    meal_types: list[Meal] = Field(min_length=1)
    ingredients: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


def _dish_fields(body: DishBody) -> dict:
    return {
        "name": body.name.strip(),
        "emoji": body.emoji.strip() or DEFAULT_EMOJI,
        "meal_types": list(dict.fromkeys(body.meal_types)),
        "ingredients": _clean_ingredients(body.ingredients),
        "tags": _clean_tags(body.tags),
    }


@app.get("/api/dishes")
def list_dishes():
    return storage.load("dishes")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "dish"


@app.post("/api/dishes", status_code=201)
def add_dish(body: DishBody):
    with storage.transaction():
        dishes = storage.load("dishes")
        base = f"{body.meal_types[0][0]}-{_slug(body.name)}"
        ids = {d["id"] for d in dishes}
        new_id, n = base, 2
        while new_id in ids:
            new_id, n = f"{base}-{n}", n + 1
        dish = {"id": new_id, **_dish_fields(body)}
        dishes.append(dish)
        storage.save("dishes", dishes)
        _register_ingredients(dish["ingredients"])
    return dish


@app.put("/api/dishes/{dish_id}")
def edit_dish(dish_id: str, body: DishBody):
    with storage.transaction():
        dishes = storage.load("dishes")
        for d in dishes:
            if d["id"] == dish_id:
                d.update(_dish_fields(body))
                storage.save("dishes", dishes)
                _register_ingredients(d["ingredients"])
                return d
    raise HTTPException(404, "Dish not found")


@app.delete("/api/dishes/{dish_id}", status_code=204)
def delete_dish(dish_id: str):
    with storage.transaction():
        dishes = storage.load("dishes")
        kept = [d for d in dishes if d["id"] != dish_id]
        if len(kept) == len(dishes):
            raise HTTPException(404, "Dish not found")
        storage.save("dishes", kept)


# ---- pantry / ingredients ---------------------------------------------------

@app.get("/api/ingredients")
def list_ingredients():
    ingredients = storage.load("ingredients")
    pantry = storage.load("pantry")
    staples = set(storage.load("staples"))
    dishes = storage.load("dishes")
    used = {}
    for d in dishes:
        for i in d["ingredients"]:
            used[i] = used.get(i, 0) + 1
    return [
        {
            "name": n,
            "perishable": meta.get("perishable", False),
            "shelf_life_days": meta.get("shelf_life_days", DEFAULT_SHELF_LIFE_DAYS),
            "in_stock": pantry.get(n, False),
            "staple": n in staples,
            "used_in": used.get(n, 0),
        }
        for n, meta in sorted(ingredients.items())
    ]


class IngredientBody(BaseModel):
    in_stock: bool | None = None
    perishable: bool | None = None
    shelf_life_days: int | None = Field(default=None, ge=1, le=365)
    staple: bool | None = None


@app.put("/api/ingredients/{name}")
def edit_ingredient(name: str, body: IngredientBody):
    with storage.transaction():
        ingredients = storage.load("ingredients")
        if name not in ingredients:
            raise HTTPException(404, "Ingredient not found")
        if body.perishable is not None:
            ingredients[name]["perishable"] = body.perishable
        if body.shelf_life_days is not None:
            ingredients[name]["shelf_life_days"] = body.shelf_life_days
        storage.save("ingredients", ingredients)
        if body.in_stock is not None:
            pantry = storage.load("pantry")
            pantry[name] = body.in_stock
            storage.save("pantry", pantry)
        if body.staple is not None:
            staples = [s for s in storage.load("staples") if s != name]
            if body.staple:
                staples.append(name)
            storage.save("staples", sorted(staples))
    return {"ok": True}


# ---- rules ------------------------------------------------------------------

class MatchBody(BaseModel):
    type: Literal["dish", "ingredient", "tag"]
    values: list[str] = Field(min_length=1)


class WhenBody(BaseModel):
    meal: Meal
    match: MatchBody


class ThenBody(BaseModel):
    meal: Meal
    day_offset: Literal[0, 1] = 0
    effect: Literal["prefer", "avoid"] = "prefer"
    match: MatchBody


class RuleBody(BaseModel):
    enabled: bool = True
    when: WhenBody
    then: ThenBody


def _rule_fields(body: RuleBody) -> dict:
    if body.then.day_offset == 0 and planner.MEALS.index(body.then.meal) <= planner.MEALS.index(body.when.meal):
        raise HTTPException(400, "On the same day, the second meal has to come after the first")
    data = body.model_dump()
    for side in ("when", "then"):
        m = data[side]["match"]
        m["values"] = [v.strip() for v in m["values"] if v.strip()]
        if m["type"] != "dish":
            m["values"] = _clean_ingredients(m["values"])
        if not m["values"]:
            raise HTTPException(400, "Each side of a rule needs at least one value")
    return data


@app.get("/api/rules")
def list_rules():
    return storage.load("rules")


@app.post("/api/rules", status_code=201)
def add_rule(body: RuleBody):
    with storage.transaction():
        rules = storage.load("rules")
        ids = {r["id"] for r in rules}
        n = len(rules) + 1
        while f"r-{n}" in ids:
            n += 1
        rule = {"id": f"r-{n}", **_rule_fields(body)}
        rules.append(rule)
        storage.save("rules", rules)
    return rule


@app.put("/api/rules/{rule_id}")
def edit_rule(rule_id: str, body: RuleBody):
    with storage.transaction():
        rules = storage.load("rules")
        for r in rules:
            if r["id"] == rule_id:
                r.update(_rule_fields(body))
                storage.save("rules", rules)
                return r
    raise HTTPException(404, "Rule not found")


@app.delete("/api/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: str):
    with storage.transaction():
        rules = storage.load("rules")
        kept = [r for r in rules if r["id"] != rule_id]
        if len(kept) == len(rules):
            raise HTTPException(404, "Rule not found")
        storage.save("rules", kept)


# ---- UI ---------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
