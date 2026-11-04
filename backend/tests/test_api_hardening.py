import httpx
import pytest
from fastapi.testclient import TestClient

from avrora.ai import provider
from avrora.api import main, wartime, workforce


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AVRORA_LLM", "none")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "d.sqlite")
    main._briefing.cache_clear()
    workforce._replan_limiter.hits.clear()
    return TestClient(main.app)


def test_unknown_host_is_rejected(client):
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert client.get("/api/health", headers={"Host": "localhost:8000"}).status_code == 200


def test_cross_origin_writes_are_rejected(client):
    action = main._plan().actions[0].id
    body = {"action_id": action, "decision": "approve"}
    assert client.post("/api/decisions", json=body, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/decisions", json=body, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.delete(f"/api/decisions/{action}", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/decisions").json() == []
    ok = client.post("/api/decisions", json=body, headers={"Origin": "http://localhost:3000", "Sec-Fetch-Site": "same-site"})
    assert ok.status_code == 200
    assert client.post("/api/decisions", json=body).status_code == 200  # no Origin: curl, tests
    # reads and preflights stay open to the allowed origin only through CORS
    assert client.get("/api/health", headers={"Origin": "https://evil.example"}).status_code == 200


def test_decision_value_must_be_finite(client):
    action = main._plan().actions[0].id
    for v in ("Infinity", "NaN"):
        r = client.post("/api/decisions", content=f'{{"action_id": "{action}", "decision": "change", "value": {v}}}',
                        headers={"content-type": "application/json"})
        assert r.status_code == 422


def test_days_is_bounded(client):
    pid = main._plan().metrics["product_id"].iloc[0]
    for days in (0, -1, 366, 10**9):
        assert client.get(f"/api/products/{pid}", params={"days": days}).status_code == 422
    assert client.get(f"/api/products/{pid}", params={"days": 365}).status_code == 200


def test_replan_is_rate_limited_and_capped(client):
    big = {"event": {"kind": "x" * 5000}}
    assert client.post("/api/workforce/replan", json=big).status_code == 413
    bad = {"event": {"kind": "nope"}}
    codes = [client.post("/api/workforce/replan", json=bad).status_code for _ in range(31)]
    assert codes[-1] == 429 and set(codes[:-1]) == {422}


@pytest.mark.parametrize("base", ["http://ai.example.test/v1", "ftp://ai.example.test", "file:///etc"])
def test_ai_base_url_needs_https(monkeypatch, base):
    monkeypatch.setenv("AI_BASE_URL", base)
    monkeypatch.setenv("AI_MODEL", "m")
    assert provider.config() is None


@pytest.mark.parametrize("base", ["https://ai.example.test/v1", "http://localhost:11434/v1", "http://127.0.0.1:8080/v1"])
def test_ai_base_url_allowed(monkeypatch, base):
    monkeypatch.setenv("AI_BASE_URL", base)
    monkeypatch.setenv("AI_MODEL", "m")
    assert provider.config() is not None


def test_upstream_answers_are_size_capped(monkeypatch):
    big = httpx.Response(200, content=b"x" * 2000)
    monkeypatch.setattr(provider.httpx, "stream", lambda *a, **k: _ctx(big))
    with pytest.raises(provider.ResponseTooLarge):
        provider.fetch("GET", "https://x.test", max_bytes=1000)
    assert provider.fetch("GET", "https://x.test", max_bytes=5000).content == b"x" * 2000
    monkeypatch.setattr(provider.httpx, "stream", lambda *a, **k: _ctx(httpx.Response(200, headers={"content-length": "99999"}, content=b"x")))
    with pytest.raises(provider.ResponseTooLarge):
        provider.fetch("GET", "https://x.test", max_bytes=1000)


def _ctx(r):
    import contextlib

    @contextlib.contextmanager
    def cm():
        r.request = httpx.Request("GET", "https://x.test")
        yield r

    return cm()


def test_wartime_non_dict_payloads(client, monkeypatch):
    out = wartime.summarise_threats([1, "x", None, {"id": 1, "status": "active", "lat": 1.0, "lon": 2.0}], 1e30)
    assert [t["id"] for t in out["threats"]] == ["1"] and out["connected"]
    for payload in ([], "x", {"objects": "x"}):
        monkeypatch.setattr(wartime, "fetch", lambda *a, p=payload, **k: httpx.Response(200, json=p, request=httpx.Request("GET", "https://x.test")))
        body = client.get("/api/wartime/threats").json()
        assert body == {"connected": False, "reason": "unavailable"} or body["threats"] == []


def test_alerts_non_dict_payloads(client, monkeypatch):
    monkeypatch.setenv("ALERTS_IN_UA_TOKEN", "t")
    assert main.summarise_alerts([1, None, {"location_title": ["x"], "location_type": "oblast"}], "t")["oblasts"] == []
    for payload in ([], {"alerts": "x"}, {"alerts": [1, None]}):
        monkeypatch.setattr(main, "fetch", lambda *a, p=payload, **k: httpx.Response(200, json=p, request=httpx.Request("GET", "https://x.test")))
        assert client.get("/api/wartime/alerts").json()["connected"] is True
