import random
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import storage
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    from app.main import app
    with TestClient(app) as c:
        yield c


MONDAY = date(2026, 10, 19).isoformat()


def _slots(week):
    for day in week["days"]:
        for meal, s in day["meals"].items():
            yield day["date"], meal, s


def test_generate_fills_21_meals(client):
    week = client.post("/api/week/generate", json={"start": MONDAY}).json()
    assert len(week["days"]) == 7
    assert all(s["dish_id"] for _, _, s in _slots(week))


def test_rules_hold_across_many_generations(client):
    dishes = {d["id"]: d for d in client.get("/api/dishes").json()}
    perishable = {i["name"] for i in client.get("/api/ingredients").json() if i["perishable"]}
    for _ in range(30):
        week = client.post("/api/week/generate", json={"start": MONDAY}).json()
        by_meal = {}
        for d, m, s in _slots(week):
            by_meal.setdefault(m, []).append(s)
        for meal, slots in by_meal.items():
            counts = {}
            for s in slots:
                counts[s["dish_id"]] = counts.get(s["dish_id"], 0) + 1
            assert max(counts.values()) <= 2
            for a, b in zip(slots, slots[1:]):
                if a["flags"] or b["flags"]:
                    continue  # relaxed and flagged
                assert a["dish_id"] != b["dish_id"]
                pa = set(dishes[a["dish_id"]]["ingredients"]) & perishable
                pb = set(dishes[b["dish_id"]]["ingredients"]) & perishable
                assert not (pa & pb), (meal, a["dish_name"], b["dish_name"])


def test_leftover_goes_to_next_meal_and_back(client):
    client.post("/api/week/generate", json={"start": MONDAY})
    week = client.put(f"/api/slot/{MONDAY}/dinner/extra", json={"made_extra": True}).json()
    mon_dinner = week["days"][0]["meals"]["dinner"]
    tue_breakfast = week["days"][1]["meals"]["breakfast"]
    assert tue_breakfast["leftover"] and tue_breakfast["dish_id"] == mon_dinner["dish_id"]
    week = client.put(f"/api/slot/{MONDAY}/dinner/extra", json={"made_extra": False}).json()
    assert not week["days"][1]["meals"]["breakfast"]["leftover"]


def test_cooked_marks_finished_items_out_and_logs_history(client):
    client.put("/api/ingredients/bread", json={"in_stock": True})
    client.put(f"/api/slot/{MONDAY}/breakfast/dish", json={"dish_id": "b-paneer-sandwich"})
    client.put(f"/api/slot/{MONDAY}/breakfast/status", json={"status": "cooked", "finished": ["bread"]})
    bread = next(i for i in client.get("/api/ingredients").json() if i["name"] == "bread")
    assert bread["in_stock"] is False
    from app import storage
    assert storage.load("history")[-1]["status"] == "cooked"


def test_generate_keeps_cooked_meals(client):
    client.put(f"/api/slot/{MONDAY}/lunch/dish", json={"dish_id": "l-rajma"})
    client.put(f"/api/slot/{MONDAY}/lunch/status", json={"status": "cooked"})
    week = client.post("/api/week/generate", json={"start": MONDAY}).json()
    assert week["days"][0]["meals"]["lunch"]["dish_id"] == "l-rajma"


def test_grocery_skips_staples_and_stocked_items(client):
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    client.put(f"/api/slot/{tomorrow}/lunch/dish", json={"dish_id": "l-kadhi-pakoda"})
    client.put("/api/ingredients/besan", json={"in_stock": True})
    g = client.get("/api/grocery?range=tomorrow").json()
    names = {i["name"] for i in g["items"]}
    assert "onion" in names and "besan" not in names and "curd" not in names
    assert any(h["name"] == "curd" for h in g["staple_hints"])


def test_manual_pick_that_breaks_a_rule_is_flagged(client):
    tue = (date.fromisoformat(MONDAY) + timedelta(days=1)).isoformat()
    client.put(f"/api/slot/{MONDAY}/breakfast/dish", json={"dish_id": "b-mushroom-toast"})
    week = client.put(f"/api/slot/{tue}/breakfast/dish", json={"dish_id": "b-paneer-sandwich"}).json()
    assert any("bread" in f for f in week["days"][1]["meals"]["breakfast"]["flags"])


def test_dish_crud_registers_new_ingredients(client):
    d = client.post("/api/dishes", json={"name": "Thepla", "meal_types": ["breakfast"], "ingredients": ["Atta", " methi "]}).json()
    assert d["ingredients"] == ["atta", "methi"]
    client.post("/api/dishes", json={"name": "Misal", "meal_types": ["lunch"], "ingredients": ["matki"]})
    assert any(i["name"] == "matki" for i in client.get("/api/ingredients").json())
    assert client.delete(f"/api/dishes/{d['id']}").status_code == 204


# ---- pairing rules, swap, options ------------------------------------------

def _rule(when_meal, when_type, when_vals, then_meal, effect, then_type, then_vals, offset=0):
    return {
        "when": {"meal": when_meal, "match": {"type": when_type, "values": when_vals}},
        "then": {"meal": then_meal, "day_offset": offset, "effect": effect,
                 "match": {"type": then_type, "values": then_vals}},
    }


def test_seeded_dal_rule_steers_dinner(client):
    hits = 0
    for _ in range(40):
        client.put(f"/api/slot/{MONDAY}/lunch/dish", json={"dish_id": "l-dal-dhokli"})
        week = client.post(f"/api/slot/{MONDAY}/dinner/regenerate").json()
        dinner = week["days"][0]["meals"]["dinner"]
        if dinner["dish_id"] in {"d-khichadi", "d-quinoa", "d-pulao"}:
            hits += 1
            assert dinner["rule_notes"] and dinner["rule_notes"][0]["followed"]
    assert hits >= 20  # by chance alone it would be about 10 of 40


def test_avoid_rule_and_validation(client):
    bad = _rule("dinner", "tag", ["x"], "lunch", "prefer", "tag", ["y"])
    assert client.post("/api/rules", json=bad).status_code == 400
    r = client.post("/api/rules", json=_rule("lunch", "ingredient", ["rajma"], "dinner", "avoid", "ingredient", ["rajma"])).json()
    for _ in range(40):
        client.put(f"/api/slot/{MONDAY}/lunch/dish", json={"dish_id": "l-rajma"})
        week = client.post(f"/api/slot/{MONDAY}/dinner/regenerate").json()
        assert week["days"][0]["meals"]["dinner"]["dish_id"] != "d-rajma-salad"
    r["enabled"] = False
    assert client.put(f"/api/rules/{r['id']}", json=r).json()["enabled"] is False
    assert client.delete(f"/api/rules/{r['id']}").status_code == 204


def test_options_mark_rule_and_violations(client):
    client.put(f"/api/slot/{MONDAY}/lunch/dish", json={"dish_id": "l-dal-dhokli"})
    opts = client.get(f"/api/slot/{MONDAY}/dinner/options").json()
    assert opts[0]["rule"] == "prefer"
    assert {o["id"] for o in opts} >= {"d-khichadi", "d-maggi"}


def test_swap_moves_dishes_and_rejects_wrong_meal(client):
    tue = (date.fromisoformat(MONDAY) + timedelta(days=1)).isoformat()
    client.put(f"/api/slot/{MONDAY}/lunch/dish", json={"dish_id": "l-rajma"})
    client.put(f"/api/slot/{tue}/lunch/dish", json={"dish_id": "l-chole"})
    client.put(f"/api/slot/{tue}/dinner/dish", json={"dish_id": "d-maggi"})
    week = client.post("/api/swap", json={"a": {"date": MONDAY, "meal": "lunch"}, "b": {"date": tue, "meal": "lunch"}}).json()
    assert week["days"][0]["meals"]["lunch"]["dish_id"] == "l-chole"
    assert week["days"][1]["meals"]["lunch"]["dish_id"] == "l-rajma"
    r = client.post("/api/swap", json={"a": {"date": MONDAY, "meal": "lunch"}, "b": {"date": tue, "meal": "dinner"}})
    assert r.status_code == 400


def test_old_dishes_get_emoji_and_tags(tmp_path, monkeypatch):
    import json
    from app import storage
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    (tmp_path / "dishes.json").write_text(json.dumps([{"id": "d-pulao", "name": "Pulao", "meal_types": ["dinner"], "ingredients": ["rice"]}]))
    storage.ensure_data()
    d = storage.load("dishes")[0]
    assert d["emoji"] == "🍚" and d["tags"] == ["rice"]
