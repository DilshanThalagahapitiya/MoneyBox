import os

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from backend.database import (
    DEFAULT_COLOR_RULES,
    MAX_COLOR_RULES,
    MIN_COLOR_RULES,
    create_password_reset_token,
    create_user,
    get_collection_state,
    get_user_by_email,
    get_user_by_id,
    get_valid_reset_token,
    init_db,
    get_all_users,
    update_user_status,
    delete_user,
    update_user_details,
    save_collection_state,
    update_user_password,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
PASSWORD_HASH_METHOD = "pbkdf2:sha256"
HEX_COLOR_PATTERN = __import__("re").compile(r"^#[0-9A-Fa-f]{6}$")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    init_db()

    def current_user():
        user_id = session.get("user_id")
        if not user_id:
            return None
        return get_user_by_id(user_id)

    def login_required():
        user = current_user()
        if not user:
            return None, (jsonify({"error": "Authentication required"}), 401)
        return user, None

    @app.get("/")
    def home():
        return send_from_directory(PUBLIC_DIR, "index.html")



    @app.get("/api/auth/me")
    def auth_me():
        user = current_user()
        if not user:
            return jsonify({"authenticated": False})
        return jsonify({"authenticated": True, "user": user})

    @app.post("/api/auth/signup")
    def auth_signup():
        payload = request.get_json(silent=True) or {}
        name = (payload.get("name") or "").strip()
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""

        if not name or not email or not password:
            return jsonify({"error": "Name, email, and password are required"}), 400

        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        if get_user_by_email(email):
            return jsonify({"error": "An account with this email already exists"}), 409

        user = create_user(name, email, generate_password_hash(password, method=PASSWORD_HASH_METHOD))
        if profile_picture:
            update_user_details(user["id"], name, 0, None, profile_picture)
        return jsonify({"ok": True, "message": "Account created. Please wait for admin approval."})

    @app.post("/api/auth/admin-signup")
    def auth_admin_signup():
        payload = request.get_json(silent=True) or {}
        name = (payload.get("name") or "").strip()
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""
        profile_picture = payload.get("profile_picture")

        if not name or not email or not password:
            return jsonify({"error": "Name, email, and password are required"}), 400

        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        if get_user_by_email(email):
            return jsonify({"error": "An account with this email already exists"}), 409

        user = create_user(name, email, generate_password_hash(password, method=PASSWORD_HASH_METHOD), is_admin=1, status="approved")
        if profile_picture:
            update_user_details(user["id"], name, 1, None, profile_picture)
        session.clear()
        session["user_id"] = user["id"]
        return jsonify({"ok": True, "user": user})

    @app.post("/api/auth/login")
    def auth_login():
        payload = request.get_json(silent=True) or {}
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""

        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400

        user = get_user_by_email(email)
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Invalid email or password"}), 401

        if user.get("status") == "pending":
            return jsonify({"error": "Account pending admin approval"}), 403
        if user.get("status") == "blocked":
            return jsonify({"error": "Account is blocked"}), 403

        session.clear()
        session["user_id"] = user["id"]
        return jsonify(
            {
                "ok": True,
                "user": {
                    "id": user["id"],
                    "name": user["name"],
                    "email": user["email"],
                    "created_at": user["created_at"],
                    "is_admin": user.get("is_admin", 0),
                    "status": user.get("status", "approved"),
                    "profile_picture": user.get("profile_picture"),
                },
            }
        )

    @app.post("/api/auth/logout")
    def auth_logout():
        session.clear()
        return jsonify({"ok": True})

    @app.post("/api/auth/forgot-password")
    def auth_forgot_password():
        payload = request.get_json(silent=True) or {}
        email = (payload.get("email") or "").strip().lower()

        if not email:
            return jsonify({"error": "Email is required"}), 400

        user = get_user_by_email(email)
        reset_url = None
        if user:
            token = create_password_reset_token(user["id"])
            reset_url = f"{request.host_url.rstrip('/')}/reset-password.html?token={token}"
            print(f"Password reset link for {email}: {reset_url}")

        return jsonify(
            {
                "ok": True,
                "message": "If that email exists, a reset link has been created.",
                "reset_url": reset_url if user else None,
            }
        )

    @app.post("/api/auth/reset-password")
    def auth_reset_password():
        payload = request.get_json(silent=True) or {}
        token = (payload.get("token") or "").strip()
        password = payload.get("password") or ""

        if not token or not password:
            return jsonify({"error": "Token and new password are required"}), 400

        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        reset_token = get_valid_reset_token(token)
        if not reset_token:
            return jsonify({"error": "Invalid or expired reset link"}), 400

        update_user_password(reset_token["user_id"], generate_password_hash(password, method=PASSWORD_HASH_METHOD))
        mark_reset_token_used(reset_token["id"])
        return jsonify({"ok": True, "message": "Password updated. You can sign in now."})

    @app.get("/api/admin/users")
    def admin_get_users():
        user, err = login_required()
        if err: return err
        if not user.get("is_admin"):
            return jsonify({"error": "Forbidden"}), 403
        return jsonify({"ok": True, "users": get_all_users()})

    @app.post("/api/admin/users/<int:user_id>/status")
    def admin_update_user_status(user_id):
        user, err = login_required()
        if err: return err
        if not user.get("is_admin"):
            return jsonify({"error": "Forbidden"}), 403
            
        payload = request.get_json(silent=True) or {}
        status = payload.get("status")
        if status not in ["approved", "pending", "blocked"]:
            return jsonify({"error": "Invalid status"}), 400
            
        update_user_status(user_id, status)
        return jsonify({"ok": True, "message": f"User status updated to {status}"})

    @app.delete("/api/admin/users/<int:user_id>")
    def admin_delete_user(user_id):
        user, err = login_required()
        if err: return err
        if not user.get("is_admin"): return jsonify({"error": "Forbidden"}), 403
        if user_id == user["id"]: return jsonify({"error": "Cannot delete yourself"}), 400
        delete_user(user_id)
        return jsonify({"ok": True, "message": "User deleted"})

    @app.put("/api/admin/users/<int:user_id>")
    def admin_update_user(user_id):
        user, err = login_required()
        if err: return err
        if not user.get("is_admin"): return jsonify({"error": "Forbidden"}), 403
        
        payload = request.get_json(silent=True) or {}
        name = (payload.get("name") or "").strip()
        is_admin = int(payload.get("is_admin", 0))
        password = payload.get("password") or ""
        profile_picture = payload.get("profile_picture")
        
        if not name: return jsonify({"error": "Name is required"}), 400
        
        password_hash = generate_password_hash(password, method=PASSWORD_HASH_METHOD) if password else None
        
        # If profile_picture wasn't included in payload (e.g., standard edit), we preserve existing
        if "profile_picture" not in payload:
            target_user = get_user_by_id(user_id)
            if target_user:
                profile_picture = target_user.get("profile_picture")
                
        update_user_details(user_id, name, is_admin, password_hash, profile_picture)
        
        return jsonify({"ok": True, "message": "User updated successfully"})

    @app.put("/api/user/profile-picture")
    def update_own_profile_picture():
        user, err = login_required()
        if err: return err
        
        payload = request.get_json(silent=True) or {}
        profile_picture = payload.get("profile_picture")
        
        if not profile_picture:
            return jsonify({"error": "No profile picture provided"}), 400
            
        update_user_details(user["id"], user["name"], user["is_admin"], None, profile_picture)
        return jsonify({"ok": True, "message": "Profile picture updated"})

    def validate_color_rules(rules):
        if not isinstance(rules, list) or len(rules) < MIN_COLOR_RULES or len(rules) > MAX_COLOR_RULES:
            return None, f"Color rules must be between {MIN_COLOR_RULES} and {MAX_COLOR_RULES}"

        normalized = []
        try:
            for rule in rules:
                normalized.append(
                    {
                        "min_value": int(rule.get("min_value", 0)),
                        "color": str(rule.get("color", "")).strip(),
                    }
                )
        except (TypeError, ValueError, AttributeError):
            return None, "Color rule values must be valid"

        normalized.sort(key=lambda rule: rule["min_value"], reverse=True)
        normalized[-1]["min_value"] = 0

        for index in range(len(normalized) - 1):
            if normalized[index]["min_value"] <= normalized[index + 1]["min_value"]:
                return None, "Each range value must be greater than the next lower range"

        for rule in normalized:
            if not HEX_COLOR_PATTERN.match(rule["color"]):
                return None, "Colors must be valid hex values like #dc2626"

        return normalized, None

    def validate_config(config):
        if not isinstance(config, dict):
            return None, "Config must be an object"

        try:
            start_value = int(config.get("start_value", 40))
            gap_value = int(config.get("gap_value", 40))
            button_count = int(config.get("button_count", 100))
            columns = int(config.get("columns", 10))
            same_value = bool(config.get("same_value", False))
            lock_time_minutes = int(config.get("lock_time_minutes", 0))
        except (TypeError, ValueError):
            return None, "Config values must be valid numbers"

        if start_value < 0:
            return None, "Starting value cannot be negative"
        if not same_value and gap_value <= 0:
            return None, "Gap value must be greater than 0"
        if button_count < 1 or button_count > 500:
            return None, "Button count must be between 1 and 500"
        if columns < 1 or columns > 20:
            return None, "Columns must be between 1 and 20"

        color_rules, color_error = validate_color_rules(config.get("color_rules", DEFAULT_COLOR_RULES))
        if color_error:
            return None, color_error

        raw_partials = config.get("partial_payments", {})
        partial_payments = {}
        if isinstance(raw_partials, dict):
            for k, v in raw_partials.items():
                try:
                    partial_payments[str(int(k))] = int(v)
                except (ValueError, TypeError):
                    pass

        raw_timestamps = config.get("selected_timestamps", {})
        selected_timestamps = {}
        if isinstance(raw_timestamps, dict):
            for k, v in raw_timestamps.items():
                try:
                    selected_timestamps[str(int(k))] = int(v)
                except (ValueError, TypeError):
                    pass

        return {
            "start_value": start_value,
            "gap_value": gap_value if not same_value else max(gap_value, 1),
            "button_count": button_count,
            "columns": columns,
            "same_value": same_value,
            "selection_type": "index",
            "color_rules": color_rules,
            "partial_payments": partial_payments,
            "lock_time_minutes": lock_time_minutes,
            "selected_timestamps": selected_timestamps,
        }, None

    @app.get("/api/data")
    def get_data():
        user, error = login_required()
        if error:
            return error

        return jsonify(get_collection_state(user["id"]))

    @app.post("/api/data")
    def post_data():
        user, error = login_required()
        if error:
            return error

        payload = request.get_json(silent=True) or {}
        state = get_collection_state(user["id"])
        selected = state["selected"]
        config = state["config"]

        if "selected" in payload:
            if not isinstance(payload["selected"], list):
                return jsonify({"error": "Selected values must be a list"}), 400
            selected = sorted({int(value) for value in payload["selected"]})

        if "config" in payload:
            merged_config = {**state["config"], **payload["config"]}
            validated_config, config_error = validate_config(merged_config)
            if config_error:
                return jsonify({"error": config_error}), 400
            config = validated_config

        save_collection_state(user["id"], selected, config)
        return jsonify(get_collection_state(user["id"]))

    @app.post("/api/color-rules")
    def save_color_rules():
        user, error = login_required()
        if error:
            return error

        payload = request.get_json(silent=True) or {}
        color_rules, color_error = validate_color_rules(payload.get("color_rules", []))
        if color_error:
            return jsonify({"error": color_error}), 400

        state = get_collection_state(user["id"])
        config = {**state["config"], "color_rules": color_rules}
        save_collection_state(user["id"], state["selected"], config)

        return jsonify(
            {
                "ok": True,
                "message": f"Successfully saved {len(color_rules)} color ranges",
                "color_rules": color_rules,
                "config": config,
            }
        )

    @app.get("/<path:filename>")
    def public_files(filename):
        return send_from_directory(PUBLIC_DIR, filename)

    return app
