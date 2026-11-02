import pytest
from fastapi.testclient import TestClient

from avrora.api import main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AVRORA_LLM", "none")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "d.sqlite")
    main._briefing.cache_clear()
    return TestClient(main.app)


def test_overview(client):
    o = client.get("/api/overview").json()
    assert o["products"] == 200 and o["stockout_risks"] == 8


def test_briefing_has_five(client):
    b = client.get("/api/briefing").json()
    assert len(b["priorities"]) == 5 and b["source"] == "rules"
    assert b["notices"][0]["facts"]["cause"] == "power_outage"


def test_product_detail_and_404(client):
    pid = client.get("/api/actions").json()[0]["product_id"]
    d = client.get(f"/api/products/{pid}").json()
    assert d["history"] and d["history"][-1]["forecast"] is not None
    assert client.get("/api/products/NOPE").status_code == 404


def test_decision_roundtrip(client):
    aid = client.get("/api/actions").json()[0]["id"]
    assert client.post("/api/decisions", json={"action_id": aid, "decision": "change"}).status_code == 422
    assert client.post("/api/decisions", json={"action_id": aid, "decision": "approve"}).status_code == 200
    assert client.get("/api/decisions").json()[0]["action_id"] == aid
    client.delete(f"/api/decisions/{aid}")
    assert client.get("/api/decisions").json() == []
    assert client.post("/api/decisions", json={"action_id": "X", "decision": "approve"}).status_code == 404


def test_evaluation(client):
    e = client.get("/api/evaluation").json()
    assert e["found"] == e["planted"] == 20
