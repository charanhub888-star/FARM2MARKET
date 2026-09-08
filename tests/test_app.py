import tempfile
from pathlib import Path

import pytest

from backend.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app({"TESTING": True, "SECRET_KEY": "test", "DATABASE_PATH": str(tmp_path / "test.db")})
    return app.test_client()


def login(client, identifier, password):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password})


def test_health_and_demo_seed(client):
    assert client.get("/api/health").json["ok"] is True
    products = client.get("/api/products").json["products"]
    assert len(products) >= 2
    assert all("verification_status" in p for p in products)


def test_registration_and_login(client):
    response = client.post("/api/auth/register", json={
        "name": "Test Farmer", "phone": "9000000011", "password": "secret1", "role": "FARMER"
    })
    assert response.status_code == 201
    assert response.json["user"]["role"] == "FARMER"
    client.post("/api/auth/logout")
    assert login(client, "9000000011", "secret1").status_code == 200


def test_farmer_product_crud_and_authorization(client):
    assert login(client, "farmer@demo.local", "demo123").status_code == 200
    result = client.post("/api/products", data={
        "crop": "Chilli", "quantity": "20", "unit": "kg", "price": "100",
        "location": "Guntur", "available_date": "2026-09-08"
    })
    assert result.status_code == 201
    product_id = result.json["product"]["id"]
    assert client.put(f"/api/products/{product_id}", json={"price": 105}).status_code == 200
    assert client.delete(f"/api/products/{product_id}").status_code == 200

    client.post("/api/auth/logout")
    login(client, "buyer@demo.local", "demo123")
    assert client.post("/api/products", json={"crop": "Rice"}).status_code == 403


def test_verification_requires_authorized_reviewer(client):
    login(client, "farmer@demo.local", "demo123")
    assert client.get("/api/admin/verifications").status_code == 403
    client.post("/api/auth/logout")
    login(client, "admin@farm2market.local", "demo-admin-change-me")
    response = client.get("/api/admin/verifications")
    assert response.status_code == 200
    pending = next(v for v in response.json["verifications"] if v["status"] == "PENDING") if any(v["status"] == "PENDING" for v in response.json["verifications"]) else None
    if pending:
        reviewed = client.put(f"/api/admin/verifications/{pending['id']}", json={"status": "APPROVED"})
        assert reviewed.status_code == 200


def test_buyer_request_creates_notification(client):
    login(client, "buyer@demo.local", "demo123")
    product_id = client.get("/api/products").json["products"][0]["id"]
    assert client.post("/api/buyer/requests", json={"product_id": product_id, "message": "Interested"}).status_code == 201
    client.post("/api/auth/logout")
    login(client, "farmer@demo.local", "demo123")
    assert len(client.get("/api/notifications").json["notifications"]) >= 1
