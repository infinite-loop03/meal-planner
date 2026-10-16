"""JSON file storage. Each file is read and written whole; writes are atomic."""

import json
import os
import tempfile
import threading
from pathlib import Path

from . import seed

DATA_DIR = Path(os.environ.get("MEAL_PLANNER_DATA", Path(__file__).resolve().parent.parent / "data"))

_lock = threading.RLock()

DEFAULTS = {
    "dishes": seed.default_dishes,
    "ingredients": seed.default_ingredients,
    "pantry": seed.default_pantry,
    "staples": lambda: list(seed.STAPLES),
    "plans": dict,      # { "YYYY-MM-DD": { "breakfast": slot, "lunch": slot, "dinner": slot } }
    "history": list,    # cooked / skipped log, kept for Phase 2
    "rules": seed.default_rules,
}


def _path(name: str) -> Path:
    return DATA_DIR / f"{name}.json"


def ensure_data() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name, factory in DEFAULTS.items():
        if not _path(name).exists():
            save(name, factory())
    _migrate_dishes()


def _migrate_dishes() -> None:
    """Give dishes saved by an older version their emoji and tags."""
    with _lock:
        dishes = load("dishes")
        changed = False
        for d in dishes:
            if "emoji" not in d:
                d["emoji"] = seed.EMOJI.get(d["name"], seed.DEFAULT_EMOJI)
                changed = True
            if "tags" not in d:
                d["tags"] = list(seed.TAGS.get(d["name"], []))
                changed = True
        if changed:
            save("dishes", dishes)


def load(name: str):
    with _lock:
        p = _path(name)
        if not p.exists():
            save(name, DEFAULTS[name]())
        with p.open(encoding="utf-8") as f:
            return json.load(f)


def save(name: str, data) -> None:
    with _lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, _path(name))


def transaction():
    """Hold the lock across a read-modify-write of several files."""
    return _lock
