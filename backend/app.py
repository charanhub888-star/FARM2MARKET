import os
import re
import secrets
import sqlite3
import math
from datetime import date, datetime
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory, session, current_app
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from backend.services.pricing import CachedMarketPriceProvider

try:
    import pymysql
except ImportError:  # SQLite remains usable when the optional MySQL dependency is absent.
    pymysql = None

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schema.sql"
PRICE_PROVIDER = CachedMarketPriceProvider()
DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,) + ((pymysql.err.IntegrityError,) if pymysql else ())


class DatabaseRow(dict):
    """A dict row that also supports SQLite's integer-index access."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


def normalize_row(row):
    if row is None:
        return None
    values = {}
    for key, value in dict(row).items():
        if isinstance(value, (datetime, date)):
            value = value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
        values[key] = value
    return DatabaseRow(values)


class DatabaseCursor:
    def __init__(self, cursor):
        self._cursor = cursor

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def _row(self, row):
        return normalize_row(row)

    def fetchone(self):
        return self._row(self._cursor.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self._cursor.fetchall()]


class DatabaseConnection:
    """Small DB-API adapter shared by SQLite and PyMySQL connections."""

    def __init__(self, connection, backend):
        self._connection = connection
        self.backend = backend

    def execute(self, sql, params=()):
        if self.backend == "mysql":
            sql = sql.replace("?", "%s")
            cursor = self._connection.cursor()
            cursor.execute(sql, params)
            return DatabaseCursor(cursor)
        return DatabaseCursor(self._connection.execute(sql, params))

    def executescript(self, script):
        if self.backend == "sqlite":
            return self._connection.executescript(script)
        for statement in script.split(";"):
            statement = statement.strip()
            if statement:
                cursor = self._connection.cursor()
                try:
                    cursor.execute(statement)
                finally:
                    cursor.close()

    def commit(self):
        self._connection.commit()

    def close(self):
        self._connection.close()


def mysql_connect(config):
    if pymysql is None:
        raise RuntimeError("PyMySQL is required when DATABASE_BACKEND=mysql.")
    return pymysql.connect(
        host=config["MYSQL_HOST"],
        port=int(config["MYSQL_PORT"]),
        user=config["MYSQL_USER"],
        password=config["MYSQL_PASSWORD"],
        database=config["MYSQL_DATABASE"],
        charset=config["MYSQL_CHARSET"],
        connect_timeout=int(config["MYSQL_CONNECT_TIMEOUT"]),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


def create_app(test_config=None):
    app = Flask(__name__, static_folder=str(ROOT / "frontend"), static_url_path="")
    app.config.update(
        # Never use a well-known fallback key.  A process-local key keeps the
        # demo usable while making accidental cookie reuse between deployments
        # impossible; production deployments should still set SECRET_KEY.
        SECRET_KEY=os.getenv("SECRET_KEY") or secrets.token_hex(32),
        DATABASE_PATH=os.getenv("DATABASE_PATH", str(ROOT / "instance" / "farm2market.db")),
        DATABASE_BACKEND=os.getenv("DATABASE_BACKEND", "sqlite").lower(),
        MYSQL_HOST=os.getenv("MYSQL_HOST", "127.0.0.1"),
        MYSQL_PORT=os.getenv("MYSQL_PORT", "3306"),
        MYSQL_DATABASE=os.getenv("MYSQL_DATABASE", "farm2market"),
        MYSQL_USER=os.getenv("MYSQL_USER", "farm2market"),
        MYSQL_PASSWORD=os.getenv("MYSQL_PASSWORD", ""),
        MYSQL_CHARSET=os.getenv("MYSQL_CHARSET", "utf8mb4"),
        MYSQL_CONNECT_TIMEOUT=os.getenv("MYSQL_CONNECT_TIMEOUT", "10"),
        INITIALIZE_DATABASE=True,
        MAX_CONTENT_LENGTH=5 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "0") == "1",
    )
    if test_config:
        app.config.update(test_config)
    app.config["DATABASE_BACKEND"] = str(app.config["DATABASE_BACKEND"]).lower()
    if app.config["DATABASE_BACKEND"] not in {"sqlite", "mysql"}:
        raise ValueError("DATABASE_BACKEND must be either 'sqlite' or 'mysql'.")
    limiter = Limiter(get_remote_address, app=app, default_limits=["300 per minute"], storage_uri="memory://")
    if app.config["DATABASE_BACKEND"] == "sqlite":
        Path(app.config["DATABASE_PATH"]).parent.mkdir(parents=True, exist_ok=True)
    Path(ROOT / "uploads").mkdir(exist_ok=True)
    if app.config["INITIALIZE_DATABASE"]:
        init_db(app)

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Keep browser capabilities available for the explicit camera, location,
        # and voice features; each feature still requires a user gesture and
        # browser permission.
        response.headers["Permissions-Policy"] = "camera=(self), geolocation=(self), microphone=(self)"
        response.headers["Cache-Control"] = "no-store" if request.path.startswith("/api/") else response.headers.get("Cache-Control", "public, max-age=300")
        return response

    @app.before_request
    def protect_mutations():
        if app.config.get("TESTING") or not request.path.startswith("/api/"):
            return
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.path not in {"/api/auth/login", "/api/auth/register"}:
            expected = session.get("csrf")
            if not expected or request.headers.get("X-CSRF-Token") != expected:
                return error("Your session has expired. Refresh and try again.", 403)

    @app.teardown_appcontext
    def close_db(_error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/farmer/dashboard")
    @app.get("/buyer/dashboard")
    @app.get("/verifier/dashboard")
    def dashboard_page():
        # Keep role dashboards deep-linkable without introducing a second
        # frontend bundle; the SPA opens the appropriate workspace after auth.
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/sw.js")
    def service_worker():
        return send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")

    @app.get("/robots.txt")
    def robots():
        return send_from_directory(ROOT, "robots.txt", mimetype="text/plain")

    @app.get("/sitemap.xml")
    def sitemap():
        return send_from_directory(ROOT, "sitemap.xml", mimetype="application/xml")

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "service": "farm2market", "demo": True})

    @app.get("/api/csrf")
    def csrf():
        token = session.setdefault("csrf", secrets.token_urlsafe(24))
        return jsonify({"csrf_token": token})

    @app.post("/api/auth/register")
    @limiter.limit("10 per minute")
    def register():
        data = request.get_json(silent=True) or {}
        name = str(data.get("name")).strip() if data.get("name") is not None else ""
        phone = re.sub(r"\s+", " ", str(data.get("phone")).strip()) if data.get("phone") is not None else ""
        password = str(data.get("password", ""))
        email = str(data.get("email")).strip().lower() if data.get("email") is not None else None
        email = email or None
        role = str(data.get("role", "FARMER")).upper()
        language = str(data.get("language", "en")).lower()
        if role not in {"FARMER", "BUYER"}:
            role = "FARMER"
        if language not in {"en", "te", "hi"}:
            language = "en"
        if len(name) < 2 or len(name) > 120 or not re.fullmatch(r"[0-9+\-\s]{8,20}", phone) or len(password) < 6 or len(password) > 256:
            return error("Please provide a name, valid mobile number and password (6+ characters).", 400)
        if email and (len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
            return error("Please provide a valid email address.", 400)
        db = get_db()
        try:
            cur = db.execute(
                "INSERT INTO users(name, phone, email, password_hash, role, language, location) VALUES(?,?,?,?,?,?,?)",
                (name, phone, email, generate_password_hash(password), role, language, str(data.get("location") or "").strip()[:120]),
            )
            user_id = cur.lastrowid
            if role == "FARMER":
                db.execute("INSERT INTO verifications(farmer_id, status) VALUES(?, 'PENDING')", (user_id,))
            db.commit()
        except DB_INTEGRITY_ERRORS:
            return error("This mobile number or email is already registered.", 409)
        session["user_id"] = user_id
        session["role"] = role
        session["csrf"] = secrets.token_urlsafe(24)
        message = "Account created. Verification is pending." if role == "FARMER" else "Account created. Welcome to Farm2Market."
        return jsonify({"user": user_json(get_user(user_id)), "message": message}), 201

    @app.post("/api/auth/login")
    @limiter.limit("10 per minute")
    def login():
        data = request.get_json(silent=True) or {}
        identifier, password = str(data.get("identifier", data.get("phone", ""))).strip(), str(data.get("password", ""))
        user = get_db().execute("SELECT * FROM users WHERE phone=? OR lower(email)=lower(?)", (identifier, identifier)).fetchone()
        if not user or not user["is_active"] or not check_password_hash(user["password_hash"], password):
            return error("We could not sign you in. Check your details and try again.", 401)
        session["user_id"], session["role"] = user["id"], user["role"]
        session["csrf"] = secrets.token_urlsafe(24)
        return jsonify({"user": user_json(user), "message": "Welcome back."})

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return jsonify({"message": "Signed out"})

    @app.get("/api/auth/me")
    def me():
        user = current_user()
        return jsonify({"user": user_json(user) if user else None})

    @app.get("/api/products")
    def products():
        q, crop, location = request.args.get("q", "").strip(), request.args.get("crop", "").strip(), request.args.get("location", "").strip()
        verified = request.args.get("verified") == "1"
        sql = """SELECT p.*, u.name farmer_name, u.location farmer_location,
                 COALESCE(v.status, 'PENDING') verification_status
                 FROM products p JOIN users u ON u.id=p.farmer_id
                 LEFT JOIN verifications v ON v.farmer_id=p.farmer_id
                 WHERE p.status='ACTIVE'"""
        args = []
        if q:
            sql += " AND (p.crop LIKE ? OR p.category LIKE ? OR p.location LIKE ?)"
            args += [f"%{q}%", f"%{q}%", f"%{q}%"]
        if crop:
            sql += " AND p.crop=?"; args.append(crop)
        if location:
            sql += " AND p.location LIKE ?"; args.append(f"%{location}%")
        if verified:
            sql += " AND v.status='APPROVED'"
        sql += " ORDER BY p.created_at DESC"
        rows = get_db().execute(sql, args).fetchall()
        return jsonify({"products": [product_json(r) for r in rows], "demo": True})

    @app.get("/api/products/<int:product_id>")
    def product(product_id):
        row = get_db().execute("""SELECT p.*,u.name farmer_name,u.location farmer_location,
          COALESCE(v.status,'PENDING') verification_status FROM products p JOIN users u ON u.id=p.farmer_id
          LEFT JOIN verifications v ON v.farmer_id=p.farmer_id WHERE p.id=? AND p.status='ACTIVE'""", (product_id,)).fetchone()
        return jsonify({"product": product_json(row)}) if row else error("Product not found.", 404)

    @app.get("/api/my/products")
    @login_required("FARMER")
    def my_products():
        rows = get_db().execute("""SELECT p.*,u.name farmer_name,u.location farmer_location,
          COALESCE(v.status,'PENDING') verification_status FROM products p JOIN users u ON u.id=p.farmer_id
          LEFT JOIN verifications v ON v.farmer_id=p.farmer_id
          WHERE p.farmer_id=? ORDER BY p.created_at DESC""", (g.user["id"],)).fetchall()
        return jsonify({"products": [product_json(r) for r in rows]})

    @app.post("/api/products")
    @login_required("FARMER")
    def create_product():
        data = request.form if request.form else (request.get_json(silent=True) or {})
        required = ["crop", "quantity", "unit", "price", "location", "available_date"]
        if any(data.get(k) is None or not str(data.get(k, "")).strip() for k in required):
            return error("Please complete all crop details.", 400)
        try:
            quantity, price = float(data["quantity"]), float(data["price"])
            if not math.isfinite(quantity) or not math.isfinite(price) or quantity <= 0 or price < 0:
                raise ValueError
        except (ValueError, TypeError):
            return error("Quantity and price must be valid positive numbers.", 400)
        try:
            available_date = date.fromisoformat(str(data["available_date"]))
        except (TypeError, ValueError):
            return error("Available date must be a valid date.", 400)
        crop = str(data["crop"]).strip()
        location = str(data["location"]).strip()
        unit = str(data["unit"]).strip()
        if not crop or len(crop) > 80 or not location or len(location) > 120 or not unit or len(unit) > 20:
            return error("Please provide valid crop, unit and location details.", 400)
        image_url = None
        image = request.files.get("image")
        if image and image.filename:
            allowed_image_types = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                ".webp": "image/webp", ".gif": "image/gif",
            }
            extension = Path(image.filename).suffix.lower()
            if image.mimetype != allowed_image_types.get(extension):
                return error("Only image files are accepted.", 400)
            filename = f"{secrets.token_hex(8)}-{secure_filename(image.filename)}"
            image.save(ROOT / "uploads" / filename)
            image_url = f"/uploads/{filename}"
        db = get_db()
        cur = db.execute("""INSERT INTO products(farmer_id,crop,category,quantity,unit,price,location,
          available_date,image_url,description) VALUES(?,?,?,?,?,?,?,?,?,?)""",
           (g.user["id"], crop, str(data.get("category") or "Other").strip()[:80] or "Other", quantity,
           unit, price, location, available_date.isoformat(),
           image_url, str(data.get("description") or "").strip()[:1000]))
        db.commit()
        return jsonify({"product": product_json(get_db().execute("SELECT p.*,u.name farmer_name,u.location farmer_location,COALESCE(v.status,'PENDING') verification_status FROM products p JOIN users u ON u.id=p.farmer_id LEFT JOIN verifications v ON v.farmer_id=p.farmer_id WHERE p.id=?", (cur.lastrowid,)).fetchone()), "message": "Your crop is now listed."}), 201

    @app.put("/api/products/<int:product_id>")
    @login_required("FARMER")
    def update_product(product_id):
        row = get_db().execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
        if not row or row["farmer_id"] != g.user["id"]:
            return error("You cannot edit this product.", 403)
        data = request.get_json(silent=True) or {}
        allowed = {k: data[k] for k in ("crop", "category", "quantity", "unit", "price", "location", "available_date", "description", "status") if k in data}
        if not allowed: return error("Nothing to update.", 400)
        if "crop" in allowed:
            allowed["crop"] = str(allowed["crop"]).strip()
            if not allowed["crop"] or len(allowed["crop"]) > 80:
                return error("Crop name is required.", 400)
        if "category" in allowed:
            allowed["category"] = str(allowed["category"]).strip()[:80] or "Other"
        if "unit" in allowed:
            allowed["unit"] = str(allowed["unit"]).strip()[:20]
            if not allowed["unit"]:
                return error("Unit is required.", 400)
        if "location" in allowed:
            allowed["location"] = str(allowed["location"]).strip()[:120]
            if not allowed["location"]:
                return error("Location is required.", 400)
        if "description" in allowed:
            allowed["description"] = str(allowed["description"]).strip()[:1000]
        if "status" in allowed:
            allowed["status"] = str(allowed["status"]).upper()
            if allowed["status"] not in {"ACTIVE", "PAUSED"}:
                return error("Invalid product status.", 400)
        if "available_date" in allowed:
            try:
                date.fromisoformat(str(allowed["available_date"]))
            except (TypeError, ValueError):
                return error("Available date must be a valid date.", 400)
        if "quantity" in allowed or "price" in allowed:
            try:
                quantity = float(allowed.get("quantity", row["quantity"]))
                price = float(allowed.get("price", row["price"]))
                if not math.isfinite(quantity) or not math.isfinite(price) or quantity <= 0 or price < 0:
                    raise ValueError
                if "quantity" in allowed:
                    allowed["quantity"] = quantity
                if "price" in allowed:
                    allowed["price"] = price
            except (TypeError, ValueError):
                return error("Quantity and price must be valid numbers.", 400)
        clause = ", ".join(f"{k}=?" for k in allowed)
        get_db().execute(f"UPDATE products SET {clause} WHERE id=?", (*allowed.values(), product_id))
        get_db().commit()
        updated = get_db().execute("""SELECT p.*,u.name farmer_name,u.location farmer_location,
          COALESCE(v.status,'PENDING') verification_status FROM products p JOIN users u ON u.id=p.farmer_id
          LEFT JOIN verifications v ON v.farmer_id=p.farmer_id WHERE p.id=?""", (product_id,)).fetchone()
        return jsonify({"message": "Product updated", "product": product_json(updated)})

    @app.delete("/api/products/<int:product_id>")
    @login_required("FARMER")
    def delete_product(product_id):
        db = get_db()
        # Requests reference products, so remove the dependent requests first
        # rather than turning a normal farmer action into a 500 FK error.
        db.execute("DELETE FROM buyer_requests WHERE product_id=? AND product_id IN (SELECT id FROM products WHERE farmer_id=?)", (product_id, g.user["id"]))
        cur = db.execute("DELETE FROM products WHERE id=? AND farmer_id=?", (product_id, g.user["id"]))
        db.commit()
        return jsonify({"message": "Product removed"}) if cur.rowcount else error("Product not found.", 404)

    @app.get("/api/prices")
    def prices():
        crop = request.args.get("crop")
        rows = PRICE_PROVIDER.get_prices(get_db(), crop)
        return jsonify({"prices": [dict(r) for r in rows], "demo": True})

    @app.post("/api/verification/request")
    @login_required("FARMER")
    def verification_request():
        db = get_db()
        existing = db.execute("SELECT id FROM verifications WHERE farmer_id=? ORDER BY id DESC LIMIT 1", (g.user["id"],)).fetchone()
        if existing: db.execute("UPDATE verifications SET status='PENDING',submitted_at=CURRENT_TIMESTAMP WHERE id=?", (existing["id"],))
        else: db.execute("INSERT INTO verifications(farmer_id,status) VALUES(?, 'PENDING')", (g.user["id"],))
        db.commit()
        return jsonify({"message": "Your information has been submitted.", "status": "PENDING"})

    @app.get("/api/admin/verifications")
    @login_required("ADMIN", "SUPER_ADMIN", "VERIFIER")
    def admin_verifications():
        rows = get_db().execute("""SELECT v.*,u.name,u.phone,u.location,
          GROUP_CONCAT(p.crop) products FROM verifications v JOIN users u ON u.id=v.farmer_id
          LEFT JOIN products p ON p.farmer_id=u.id GROUP BY v.id ORDER BY v.submitted_at DESC""").fetchall()
        return jsonify({"verifications": [dict(r) for r in rows]})

    @app.put("/api/admin/verifications/<int:verification_id>")
    @login_required("ADMIN", "SUPER_ADMIN", "VERIFIER")
    def review_verification(verification_id):
        data = request.get_json(silent=True) or {}
        status = str(data.get("status", "")).upper()
        if status not in {"APPROVED", "REJECTED", "MORE_INFORMATION_REQUIRED", "UNDER_REVIEW"}:
            return error("Invalid verification status.", 400)
        db = get_db()
        row = db.execute("SELECT * FROM verifications WHERE id=?", (verification_id,)).fetchone()
        if not row: return error("Verification not found.", 404)
        notes = str(data.get("notes", "")).strip()[:1000]
        db.execute("UPDATE verifications SET status=?,notes=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?", (status, notes, g.user["id"], verification_id))
        title = "Seller verification updated"; body = f"Your seller verification is {status.replace('_', ' ').lower()}."
        db.execute("INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)", (row["farmer_id"], title, body))
        db.execute("INSERT INTO audit_logs(actor_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)", (g.user["id"], status, "verification", verification_id, data.get("notes", "")))
        db.commit()
        return jsonify({"message": "Verification status updated.", "status": status})

    @app.post("/api/buyer/requests")
    @login_required("BUYER")
    def buyer_request():
        data = request.get_json(silent=True) or {}
        product_id = data.get("product_id")
        product = get_db().execute("SELECT * FROM products WHERE id=? AND status='ACTIVE'", (product_id,)).fetchone()
        if not product: return error("Product is no longer available.", 404)
        db = get_db()
        existing = db.execute(
            "SELECT id FROM buyer_requests WHERE product_id=? AND buyer_id=? AND status IN ('PENDING','ACCEPTED')",
            (product_id, g.user["id"]),
        ).fetchone()
        if existing:
            return error("You already have an active request for this listing.", 409)
        db.execute("INSERT INTO buyer_requests(product_id,buyer_id,message) VALUES(?,?,?)", (product_id, g.user["id"], str(data.get("message") or "").strip()[:500]))
        db.execute("INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)", (product["farmer_id"], "A buyer is interested", f"{g.user['name']} sent a request for your {product['crop']}."))
        db.commit()
        return jsonify({"message": "Request sent to the farmer."}), 201

    @app.get("/api/buyer/requests")
    @login_required("BUYER")
    def buyer_requests():
        rows = get_db().execute("""SELECT r.*,p.crop,p.quantity,p.unit,p.location,u.name farmer_name
          FROM buyer_requests r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=p.farmer_id
          WHERE r.buyer_id=? ORDER BY r.created_at DESC LIMIT 100""", (g.user["id"],)).fetchall()
        return jsonify({"requests": [dict(r) for r in rows]})

    @app.get("/api/farmer/requests")
    @login_required("FARMER")
    def farmer_requests():
        rows = get_db().execute("""SELECT r.*,p.crop,p.quantity,p.unit,p.location,u.name buyer_name,u.phone buyer_phone
          FROM buyer_requests r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.buyer_id
          WHERE p.farmer_id=? ORDER BY r.created_at DESC LIMIT 100""", (g.user["id"],)).fetchall()
        return jsonify({"requests": [dict(r) for r in rows]})

    @app.get("/api/notifications")
    @login_required()
    def notifications():
        rows = get_db().execute("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30", (g.user["id"],)).fetchall()
        return jsonify({"notifications": [dict(r) for r in rows]})

    @app.patch("/api/notifications/<int:notification_id>/read")
    @login_required()
    def mark_notification_read(notification_id):
        cur = get_db().execute(
            "UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",
            (notification_id, g.user["id"]),
        )
        get_db().commit()
        return jsonify({"message": "Notification marked as read"}) if cur.rowcount else error("Notification not found.", 404)

    @app.get("/api/dashboard")
    @login_required()
    def dashboard():
        db = get_db()
        if g.user["role"] in ("ADMIN", "SUPER_ADMIN", "VERIFIER"):
            stats = {key: db.execute(query).fetchone()[0] for key, query in {
                "farmers": "SELECT COUNT(*) FROM users WHERE role='FARMER'",
                "verified": "SELECT COUNT(*) FROM verifications WHERE status='APPROVED'",
                "pending": "SELECT COUNT(*) FROM verifications WHERE status IN ('PENDING','UNDER_REVIEW')",
                "buyers": "SELECT COUNT(*) FROM users WHERE role='BUYER'",
                "listings": "SELECT COUNT(*) FROM products WHERE status='ACTIVE'",
                "requests": "SELECT COUNT(*) FROM buyer_requests",
            }.items()}
            return jsonify({"stats": stats})
        listing_count = db.execute("SELECT COUNT(*) FROM products WHERE farmer_id=? AND status='ACTIVE'", (g.user["id"],)).fetchone()[0]
        verification = db.execute("SELECT status FROM verifications WHERE farmer_id=? ORDER BY id DESC LIMIT 1", (g.user["id"],)).fetchone()
        return jsonify({"stats": {"listings": listing_count, "verification": verification["status"] if verification else "PENDING"}})

    @app.get("/uploads/<path:filename>")
    def upload(filename):
        return send_from_directory(ROOT / "uploads", filename)

    return app


def get_db():
    if "db" not in g:
        backend = current_app.config["DATABASE_BACKEND"]
        if backend == "mysql":
            g.db = DatabaseConnection(mysql_connect(current_app.config), backend)
        else:
            connection = sqlite3.connect(current_app.config["DATABASE_PATH"], timeout=10)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            g.db = DatabaseConnection(connection, backend)
    return g.db


def init_db(app):
    with app.app_context():
        db = get_db()
        schema = SCHEMA.read_text(encoding="utf-8")
        schema = schema.replace(
            "{{AUTO_INCREMENT}}",
            "AUTOINCREMENT" if app.config["DATABASE_BACKEND"] == "sqlite" else "AUTO_INCREMENT",
        )
        db.executescript(schema)
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            seed_demo(db)
        db.commit()


def seed_demo(db):
    admin_pw = os.getenv("ADMIN_PASSWORD", "demo-admin-change-me")
    demo_pw = "demo123"
    admin = db.execute("INSERT INTO users(name,email,phone,password_hash,role,language,location) VALUES(?,?,?,?,?,?,?)",
        ("Demo Verifier", os.getenv("ADMIN_EMAIL", "admin@farm2market.local"), "9999999999", generate_password_hash(admin_pw), "ADMIN", "en", "Hyderabad")).lastrowid
    farmer = db.execute("INSERT INTO users(name,email,phone,password_hash,role,language,location) VALUES(?,?,?,?,?,?,?)",
        ("Lakshmi Reddy", "farmer@demo.local", "9000000001", generate_password_hash(demo_pw), "FARMER", "te", "Guntur")).lastrowid
    buyer = db.execute("INSERT INTO users(name,email,phone,password_hash,role,language,location) VALUES(?,?,?,?,?,?,?)",
        ("FreshKart Buyer", "buyer@demo.local", "9000000002", generate_password_hash(demo_pw), "BUYER", "en", "Hyderabad")).lastrowid
    db.execute("INSERT INTO verifications(farmer_id,status,reviewed_by) VALUES(?,?,?)", (farmer, "APPROVED", admin))
    db.execute("INSERT INTO products(farmer_id,crop,category,quantity,unit,price,location,available_date,description) VALUES(?,?,?,?,?,?,?,?,?)",
        (farmer, "Tomato", "Vegetables", 1200, "kg", 24, "Guntur", str(date.today()), "Fresh field tomatoes. Demo listing."))
    db.execute("INSERT INTO products(farmer_id,crop,category,quantity,unit,price,location,available_date,description) VALUES(?,?,?,?,?,?,?,?,?)",
        (farmer, "Rice", "Grains", 30, "quintal", 3200, "Warangal", str(date.today()), "Sona masuri rice. Demo listing."))
    for row in [("Tomato","Guntur",18,24,31),("Rice","Warangal",2800,3200,3600),("Chilli","Guntur",90,110,135),("Cotton","Adilabad",6500,7200,7900)]:
        db.execute("INSERT INTO market_prices(crop,location,low,average,high) VALUES(?,?,?,?,?)", row)


def current_user():
    uid = session.get("user_id")
    return get_db().execute("SELECT * FROM users WHERE id=? AND is_active=1", (uid,)).fetchone() if uid else None


def get_user(user_id):
    return get_db().execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()


def user_json(user):
    return {k: user[k] for k in ("id", "name", "email", "phone", "role", "language", "location")} if user else None


def product_json(row):
    if not row: return None
    d = dict(row)
    d["verified"] = d.get("verification_status") == "APPROVED"
    return d


def error(message, status=400):
    return jsonify({"error": message}), status


def login_required(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user: return error("Please sign in to continue.", 401)
            if roles and user["role"] not in roles: return error("You do not have permission for this action.", 403)
            g.user = user
            return fn(*args, **kwargs)
        return wrapped
    return decorator


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_ENV") == "development")
