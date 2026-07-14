"""Unit tests for the pure-logic layers (no DB/network required).

Covers: password hashing + JWT, role hierarchy, AI output normalisation, and
chat-log response-time metrics.
"""
from app.models.user import ROLE_RANK, User, UserRole
from app.rbac import has_min_role, is_assigned_to_client
from app.services import ai_service
from app.services.auth_service import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.services.metrics_service import compute_response_times


# ---------------------------------------------------------------- auth
def test_password_hash_roundtrip():
    h = hash_password("s3cret!")
    assert h != "s3cret!"
    assert verify_password("s3cret!", h)
    assert not verify_password("wrong", h)


def test_jwt_roundtrip():
    token = create_access_token(42, {"role": "admin"})
    payload = decode_access_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "admin"


def test_jwt_invalid_returns_none():
    assert decode_access_token("not-a-token") is None


# ---------------------------------------------------------------- rbac
def test_role_hierarchy_ordering():
    assert ROLE_RANK[UserRole.super_admin] > ROLE_RANK[UserRole.admin]
    assert ROLE_RANK[UserRole.admin] > ROLE_RANK[UserRole.team_lead]
    assert ROLE_RANK[UserRole.team_lead] > ROLE_RANK[UserRole.employee]


def test_has_min_role():
    admin = User(name="A", email="a@x.com", password_hash="", role=UserRole.admin)
    emp = User(name="E", email="e@x.com", password_hash="", role=UserRole.employee)
    assert has_min_role(admin, UserRole.team_lead)
    assert not has_min_role(emp, UserRole.team_lead)


def test_assignment_visibility():
    class FakeClient:
        assignees = []

    lead = User(id=7, name="L", email="l@x.com", password_hash="", role=UserRole.team_lead)
    admin = User(id=1, name="A", email="a@x.com", password_hash="", role=UserRole.admin)
    client = FakeClient()
    assert not is_assigned_to_client(lead, client)  # not assigned
    client.assignees = [lead]
    assert is_assigned_to_client(lead, client)
    assert is_assigned_to_client(admin, client)  # admins see everything


# ---------------------------------------------------------------- ai normalise
def test_ai_normalize_coerces_types():
    raw = {
        "summary": "ok",
        "key_points": "single point",       # not a list -> wrapped
        "pending_actions": ["do x", "do y"],
        "follow_ups": None,                  # -> []
        "sentiment": "positive",
        "sentiment_score": "0.8",            # str -> float
    }
    out = ai_service._normalize(raw, "gpt-4o-mini")
    assert out["key_points"] == ["single point"]
    assert out["follow_ups"] == []
    assert out["pending_actions"] == ["do x", "do y"]
    assert out["sentiment_score"] == 0.8
    assert out["model"] == "gpt-4o-mini"


# ---------------------------------------------------------------- metrics
def test_response_time_metrics():
    log = (
        "[2024-01-02 13:45] Alice: hi there\n"
        "[2024-01-02 13:47] Bob: hello, how can I help?\n"
        "[2024-01-02 13:50] Alice: I need a quote\n"
    )
    m = compute_response_times(log)
    assert m["available"] is True
    assert m["turns"] == 3
    # Bob replied 2 min after Alice; Alice replied 3 min after Bob -> avg 2.5 min
    assert m["avg_response_minutes"] == 2.5


def test_metrics_insufficient_data():
    assert compute_response_times("no timestamps here").get("available") is False
