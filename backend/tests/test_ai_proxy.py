import json

import httpx
import pytest
from fastapi.testclient import TestClient

from avrora.ai import provider
from avrora.api import ai, main

MSGS = [{"role": "system", "content": "Answer in JSON."}, {"role": "user", "content": "hi"}]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AVRORA_LLM", "none")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "d.sqlite")
    ai._hits.clear()
    for k in ("AI_BASE_URL", "AI_MODEL", "AI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    return TestClient(main.app)


@pytest.fixture()
def upstream(monkeypatch):
    """Configures a fake provider and records what the proxy sends it."""
    monkeypatch.setenv("AI_BASE_URL", "https://ai.example.test/v1/")
    monkeypatch.setenv("AI_MODEL", "test-model")
    monkeypatch.setenv("AI_API_KEY", "test-secret")
    calls: list[dict] = []
    replies: list[httpx.Response] = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append({"url": url, "headers": headers, "json": json})
        r = replies.pop(0) if replies else httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}}]})
        r.request = httpx.Request("POST", url)
        return r

    monkeypatch.setattr(provider.httpx, "post", fake_post)
    return calls, replies


def test_unconfigured(client):
    assert client.get("/api/ai/status").json() == {"configured": False, "model": None}
    r = client.post("/api/ai/chat", json={"messages": MSGS})
    assert r.status_code == 503


def test_status_never_shows_key(client, upstream):
    r = client.get("/api/ai/status")
    assert r.json() == {"configured": True, "model": "test-model"}
    assert "test-secret" not in r.text


def test_forwards_to_provider(client, upstream):
    calls, _ = upstream
    r = client.post("/api/ai/chat", json={"messages": MSGS, "schema": {"type": "object"}, "max_tokens": 99999})
    assert r.status_code == 200
    assert r.json() == {"content": '{"ok": true}', "model": "test-model"}
    assert "test-secret" not in r.text
    (call,) = calls
    assert call["url"] == "https://ai.example.test/v1/chat/completions"
    assert call["headers"] == {"Authorization": "Bearer test-secret"}
    assert call["json"]["model"] == "test-model"
    assert call["json"]["max_tokens"] == provider.MAX_TOKENS
    assert call["json"]["response_format"]["type"] == "json_schema"


def test_retries_with_json_mode(client, upstream):
    calls, replies = upstream
    replies.append(httpx.Response(400, json={"error": "no json_schema"}))
    assert client.post("/api/ai/chat", json={"messages": MSGS, "schema": {"type": "object"}}).status_code == 200
    assert [c["json"]["response_format"]["type"] for c in calls] == ["json_schema", "json_object"]


@pytest.mark.parametrize("reply", [httpx.Response(401, json={}), httpx.Response(200, json={"choices": []})])
def test_provider_failure_is_502(client, upstream, reply, monkeypatch):
    monkeypatch.setattr(provider, "RETRY_PAUSE_S", 0)
    upstream[1].extend([reply, reply])  # an empty answer gets one more try
    r = client.post("/api/ai/chat", json={"messages": MSGS})
    assert r.status_code == 502
    assert "test-secret" not in r.text


def test_unreachable_is_502(client, upstream, monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(provider.httpx, "post", boom)
    assert client.post("/api/ai/chat", json={"messages": MSGS}).status_code == 502


@pytest.mark.parametrize("body", [{}, {"messages": []}, {"messages": [{"role": "tool", "content": "x"}]}, {"messages": MSGS * 3}])
def test_bad_body(client, upstream, body):
    assert client.post("/api/ai/chat", json=body).status_code == 422


def test_size_limit(client, upstream):
    big = [{"role": "user", "content": "x" * (ai.MAX_BODY + 10)}]
    assert client.post("/api/ai/chat", content=json.dumps({"messages": big})).status_code == 413


def test_rate_limit(client, upstream):
    codes = [client.post("/api/ai/chat", json={"messages": MSGS}).status_code for _ in range(ai.PER_WINDOW + 1)]
    assert codes[-1] == 429 and set(codes[:-1]) == {200}


def test_briefing_uses_store_ai(upstream, monkeypatch):
    from avrora.ai import briefing

    monkeypatch.delenv("AVRORA_LLM", raising=False)
    assert briefing.default_drafter() is not None


def test_falls_back_to_the_next_model(client, upstream, monkeypatch):
    """A busy or retired model hands over to the next one in AI_MODEL; the reply names who answered."""
    monkeypatch.setenv("AI_MODEL", "retired, busy ,good")
    monkeypatch.setenv("AI_REASONING_EFFORT", "low")
    calls, replies = upstream
    replies += [httpx.Response(404, json={}), httpx.Response(503, json={})]
    assert client.get("/api/ai/status").json()["model"] == "retired"
    r = client.post("/api/ai/chat", json={"messages": MSGS})
    assert r.status_code == 200 and r.json()["model"] == "good"
    assert [c["json"]["model"] for c in calls] == ["retired", "busy", "good"]
    assert all(c["json"]["reasoning_effort"] == "low" for c in calls)


def test_empty_answer_tries_the_next_model(client, upstream, monkeypatch):
    monkeypatch.setenv("AI_MODEL", "a,b")
    upstream[1].append(httpx.Response(200, json={"choices": [{"message": {"content": None}}]}))
    r = client.post("/api/ai/chat", json={"messages": MSGS})
    assert r.status_code == 200 and r.json()["model"] == "b"


def test_auth_error_does_not_fall_back(client, upstream, monkeypatch):
    """A wrong key fails the same on every model: answer at once instead of trying them all."""
    monkeypatch.setenv("AI_MODEL", "a,b")
    calls, replies = upstream
    replies.append(httpx.Response(401, json={}))
    assert client.post("/api/ai/chat", json={"messages": MSGS}).status_code == 502
    assert len(calls) == 1


def test_second_pass_when_every_model_was_busy(client, upstream, monkeypatch):
    monkeypatch.setenv("AI_MODEL", "a,b")
    monkeypatch.setattr(provider, "RETRY_PAUSE_S", 0)
    calls, replies = upstream
    replies += [httpx.Response(503, json={}), httpx.Response(429, json={})]
    r = client.post("/api/ai/chat", json={"messages": MSGS})
    assert r.status_code == 200 and r.json()["model"] == "a"
    assert [c["json"]["model"] for c in calls] == ["a", "b", "a"]
