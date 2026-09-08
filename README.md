# Farm2Market

Farm2Market is a runnable Flask + SQLite prototype for direct farmer-to-buyer connections. It is intentionally a **demo environment**: seeded listings and market prices are labelled as demo data, and no payment, government identity, SMS, or external market API is claimed.

## Run locally

Prerequisites: Python 3.11+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:FLASK_APP="backend.app:app"
flask run --debug
```

Open http://127.0.0.1:5000. The database is created at `instance/farm2market.db` and demo rows are seeded on first run.

Demo accounts (local only):

* Farmer: `farmer@demo.local` / `demo123`
* Buyer: `buyer@demo.local` / `demo123`
* Admin/verifier: `admin@farm2market.local` / `demo-admin-change-me`

Set `ADMIN_PASSWORD` before first run to change the demo admin password. Never use these credentials in production.

## Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

`DATABASE_PATH`, `SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optional `MARKET_API_URL`, `MARKET_API_KEY`, `MARKET_API_TIMEOUT` are configurable. The `market_prices` table and `/api/prices` endpoint provide a provider seam for a future external `MarketPriceProvider`; stale/demo values remain explicitly labelled.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/csrf`, `/api/auth/me` | Health/session |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Password authentication |
| GET/POST | `/api/products` | Search or create listings |
| GET | `/api/my/products` | Authenticated farmer listings |
| GET/PUT/DELETE | `/api/products/<id>` | Product detail and farmer CRUD |
| GET | `/api/prices` | Demo market ranges |
| POST | `/api/verification/request` | Farmer submits verification |
| GET/PUT | `/api/admin/verifications[/<id>]` | Authorized review workflow |
| GET/POST | `/api/buyer/requests` | Buyer purchase interest and request history |
| GET | `/api/farmer/requests` | Authenticated farmer request inbox |
| GET/PATCH | `/api/notifications[/<id>/read]` | User notifications |
| GET | `/api/dashboard` | Role dashboard stats |

Role workspaces are also deep-linkable at `/farmer/dashboard`, `/buyer/dashboard`, and
`/verifier/dashboard`. Cookie-authenticated mutations require the CSRF token returned
by `/api/csrf`; the browser client handles this automatically.

Passwords are Werkzeug-hashed, SQL uses parameterized queries, uploads accept images only and are size-limited, roles are checked server-side, and security headers are applied. For a production deployment add HTTPS, a reverse proxy, a managed PostgreSQL database, CSRF middleware for cookie-authenticated mutations, rate limiting, object storage, and real identity/payment providers.

## Tests

```powershell
pytest -q
```

The frontend is mobile-first, keyboard-friendly, reduced-motion aware, installable as a basic PWA, and includes English/Telugu/Hindi language architecture plus Web Speech API controls. External map/chart services are intentionally omitted from the offline demo to keep it reliable on low-cost networks.
