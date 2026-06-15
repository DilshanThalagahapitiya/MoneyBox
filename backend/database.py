import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "app.db")

DEFAULT_CONFIG = {
    "start_value": 40,
    "gap_value": 40,
    "button_count": 100,
    "columns": 10,
    "same_value": False,
    "selection_type": "index",
    "partial_payments": {},
    "lock_time_minutes": 0,
    "selected_timestamps": {},
}

DEFAULT_COLOR_RULES = [
    {"min_value": 5000, "color": "#dc2626"},
    {"min_value": 1000, "color": "#16a34a"},
    {"min_value": 0, "color": "#eab308"},
]

MIN_COLOR_RULES = 3
MAX_COLOR_RULES = 5
EXTRA_DEFAULT_COLORS = ["#f97316", "#8b5cf6"]


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def get_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS collection_selections (
                user_id INTEGER PRIMARY KEY,
                selected_json TEXT NOT NULL,
                config_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
            """
        )
        _migrate_collection_table(connection)
        _migrate_users_table(connection)

def _migrate_users_table(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()}
    if "is_admin" not in columns:
        connection.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    if "status" not in columns:
        connection.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'")


def _migrate_collection_table(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(collection_selections)").fetchall()
    }

    if "config_json" not in columns:
        connection.execute(
            """
            ALTER TABLE collection_selections
            ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'
            """
        )
        connection.execute(
            """
            UPDATE collection_selections
            SET config_json = ?
            WHERE config_json = '{}' OR config_json IS NULL
            """,
            (json.dumps(DEFAULT_CONFIG),),
        )


def create_user(name: str, email: str, password_hash: str, is_admin: int = 0, status: str = "pending") -> dict:
    created_at = _utc_now()

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO users (name, email, password_hash, created_at, is_admin, status)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (name.strip(), email.strip().lower(), password_hash, created_at, is_admin, status),
        )
        user_id = cursor.lastrowid
        connection.execute(
            """
            INSERT INTO collection_selections (user_id, selected_json, config_json, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, "[]", json.dumps(DEFAULT_CONFIG), created_at),
        )

    return {
        "id": user_id,
        "name": name.strip(),
        "email": email.strip().lower(),
        "created_at": created_at,
    }


def get_user_by_id(user_id: int) -> Optional[dict]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, name, email, created_at, is_admin, status FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None


def get_user_by_email(email: str) -> Optional[dict]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, name, email, password_hash, created_at, is_admin, status FROM users WHERE email = ?",
            (email.strip().lower(),),
        ).fetchone()
        return dict(row) if row else None

def get_all_users() -> list:
    with get_connection() as connection:
        rows = connection.execute("SELECT id, name, email, created_at, is_admin, status FROM users ORDER BY id DESC").fetchall()
        return [dict(row) for row in rows]

def update_user_status(user_id: int, status: str) -> None:
    with get_connection() as connection:
        connection.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))

def delete_user(user_id: int) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (user_id,))
        connection.execute("DELETE FROM collection_selections WHERE user_id = ?", (user_id,))
        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))

def update_user_details(user_id: int, name: str, is_admin: int, password_hash: str = None) -> None:
    with get_connection() as connection:
        if password_hash:
            connection.execute(
                "UPDATE users SET name = ?, is_admin = ?, password_hash = ? WHERE id = ?",
                (name.strip(), is_admin, password_hash, user_id),
            )
        else:
            connection.execute(
                "UPDATE users SET name = ?, is_admin = ? WHERE id = ?",
                (name.strip(), is_admin, user_id),
            )


def update_user_password(user_id: int, password_hash: str) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hash, user_id),
        )


def create_password_reset_token(user_id: int, hours_valid: int = 1) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=hours_valid)

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, token, expires_at.replace(microsecond=0).isoformat(), _utc_now()),
        )

    return token


def get_valid_reset_token(token: str) -> Optional[dict]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id, user_id, token, expires_at, used
            FROM password_reset_tokens
            WHERE token = ?
            """,
            (token,),
        ).fetchone()

        if not row or row["used"]:
            return None

        expires_at = datetime.fromisoformat(row["expires_at"])
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at < datetime.now(timezone.utc):
            return None

        return dict(row)


def mark_reset_token_used(token_id: int) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE id = ?",
            (token_id,),
        )


def _normalize_color_rules(rules: list) -> list:
    if not isinstance(rules, list) or len(rules) < MIN_COLOR_RULES:
        return [rule.copy() for rule in DEFAULT_COLOR_RULES]

    trimmed_rules = rules[:MAX_COLOR_RULES]
    normalized = []

    for index, rule in enumerate(trimmed_rules):
        fallback_color = (
            DEFAULT_COLOR_RULES[min(index, len(DEFAULT_COLOR_RULES) - 1)]["color"]
            if index < len(DEFAULT_COLOR_RULES)
            else EXTRA_DEFAULT_COLORS[index - len(DEFAULT_COLOR_RULES)]
            if index - len(DEFAULT_COLOR_RULES) < len(EXTRA_DEFAULT_COLORS)
            else DEFAULT_COLOR_RULES[2]["color"]
        )
        color = str(rule.get("color", fallback_color)).strip()
        if not color.startswith("#"):
            color = fallback_color
        normalized.append(
            {
                "min_value": int(rule.get("min_value", 0)),
                "color": color,
            }
        )

    normalized.sort(key=lambda rule: rule["min_value"], reverse=True)
    normalized[-1]["min_value"] = 0

    if len(normalized) < MIN_COLOR_RULES:
        return [rule.copy() for rule in DEFAULT_COLOR_RULES]

    return normalized


def _normalize_config(config: dict) -> dict:
    merged = {**DEFAULT_CONFIG, **(config or {})}
    
    # Normalize partial_payments: ensure keys are strings representing ints, and values are ints
    raw_partials = merged.get("partial_payments", {})
    partial_payments = {}
    if isinstance(raw_partials, dict):
        for k, v in raw_partials.items():
            try:
                partial_payments[str(int(k))] = int(v)
            except (ValueError, TypeError):
                pass

    # Normalize selected_timestamps: keys strings, values ints (unix timestamp)
    raw_timestamps = merged.get("selected_timestamps", {})
    selected_timestamps = {}
    if isinstance(raw_timestamps, dict):
        for k, v in raw_timestamps.items():
            try:
                selected_timestamps[str(int(k))] = int(v)
            except (ValueError, TypeError):
                pass

    return {
        "start_value": int(merged["start_value"]),
        "gap_value": int(merged["gap_value"]),
        "button_count": int(merged["button_count"]),
        "columns": int(merged["columns"]),
        "same_value": bool(merged.get("same_value", False)),
        "selection_type": "index",
        "color_rules": _normalize_color_rules(merged.get("color_rules", DEFAULT_COLOR_RULES)),
        "partial_payments": partial_payments,
        "lock_time_minutes": int(merged.get("lock_time_minutes", 0)),
        "selected_timestamps": selected_timestamps,
    }


def _value_at_index(config: dict, index: int) -> int:
    normalized = _normalize_config(config)
    if normalized["same_value"]:
        return normalized["start_value"]
    return normalized["start_value"] + index * normalized["gap_value"]


def _build_values(config: dict) -> list[int]:
    normalized = _normalize_config(config)
    return [_value_at_index(normalized, index) for index in range(normalized["button_count"])]


def _values_to_indices(selected: list, config: dict) -> list[int]:
    values = _build_values(config)
    indices = []
    used = set()

    for item in selected:
        value = int(item)
        for index, grid_value in enumerate(values):
            if grid_value == value and index not in used:
                indices.append(index)
                used.add(index)
                break

    return sorted(indices)


def _normalize_selected(selected: list, config: dict) -> list[int]:
    normalized = _normalize_config(config)
    count = normalized["button_count"]

    if not selected:
        return []

    int_selected = [int(item) for item in selected]
    legacy_type = (config or {}).get("selection_type", "value")

    if normalized["same_value"] or legacy_type == "index":
        return sorted({item for item in int_selected if 0 <= item < count})

    if any(item >= count for item in int_selected):
        return _values_to_indices(int_selected, config)

    if all(item in set(_build_values(normalized)) for item in int_selected):
        return _values_to_indices(int_selected, config)

    return sorted({item for item in int_selected if 0 <= item < count})


def get_collection_state(user_id: int) -> dict:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT selected_json, config_json FROM collection_selections WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if not row:
            return {"selected": [], "config": DEFAULT_CONFIG.copy()}

        config = _normalize_config(json.loads(row["config_json"]))
        selected = _normalize_selected(json.loads(row["selected_json"]), config)

        return {"selected": selected, "config": config}


def get_collection(user_id: int) -> list[int]:
    return get_collection_state(user_id)["selected"]


def save_collection(user_id: int, selected: list[int]) -> None:
    state = get_collection_state(user_id)
    save_collection_state(user_id, selected, state["config"])


def save_collection_state(user_id: int, selected: list[int], config: dict) -> None:
    normalized_config = _normalize_config(config)
    cleaned_selected = _normalize_selected(selected, normalized_config)

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO collection_selections (user_id, selected_json, config_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                selected_json = excluded.selected_json,
                config_json = excluded.config_json,
                updated_at = excluded.updated_at
            """,
            (
                user_id,
                json.dumps(cleaned_selected),
                json.dumps(normalized_config),
                _utc_now(),
            ),
        )
