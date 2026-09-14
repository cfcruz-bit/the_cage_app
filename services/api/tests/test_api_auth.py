"""Registro, login y ciclo de tokens."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

PASSWORD = "contrasena-larga-123"


def _email() -> str:
    return f"{uuid.uuid4().hex[:10]}@cage-test.com"


async def create_coach(client: AsyncClient, admin: dict, email: str | None = None) -> dict:
    r = await client.post(
        "/api/v1/admin/coaches",
        headers=admin["headers"],
        json={"email": email or _email(), "displayName": "Test"},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def adopt(client: AsyncClient, created: dict) -> str:
    """Entra con la provisional y la cambia por PASSWORD.

    Es lo que hara cualquier usuario la primera vez. Dejar la cuenta con la
    provisional haria que el resto de tests chocaran con el bloqueo de
    "cambia tu contrasena", que es justo lo que queremos que exista.
    """
    email = created["user"]["email"]
    temporary = created["temporaryPassword"]

    first = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": temporary}
    )
    changed = await client.post(
        "/api/v1/auth/change-password",
        headers=auth(first.json()),
        json={"currentPassword": temporary, "newPassword": PASSWORD},
    )
    assert changed.status_code == 200, changed.text
    return email


async def register(
    client: AsyncClient,
    admin: dict,
    role: str = "athlete",
    email: str | None = None,
) -> tuple[str, dict]:
    """Crea una cuenta por el camino real y la deja lista para usar.

    Los atletas necesitan un entrenador asignado y un periodo pagado, asi que
    se crea un coach de la casa la primera vez y se reutiliza. No afecta a los
    tests de permisos: ese coach no es ninguno de los que ellos crean.
    """
    if role == "coach":
        created = await create_coach(client, admin, email)
        return await adopt(client, created), created["user"]

    house = admin.get("_house_coach")
    if house is None:
        house = (await create_coach(client, admin))["user"]["id"]
        admin["_house_coach"] = house

    r = await client.post(
        "/api/v1/admin/athletes",
        headers=admin["headers"],
        json={
            "email": email or _email(),
            "displayName": "Test",
            "coachId": house,
            # Doce meses: ningun test tiene que pensar en el vencimiento salvo
            # los que lo prueban a proposito.
            "months": 12,
        },
    )
    assert r.status_code == 201, r.text
    return await adopt(client, r.json()), r.json()["user"]


async def login(client: AsyncClient, email: str) -> dict:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def auth(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['accessToken']}"}


@pytest.mark.asyncio
async def test_registro_y_login(client: AsyncClient, admin: dict) -> None:
    email, user = await register(client, admin)
    assert user["role"] == "athlete"
    assert "passwordHash" not in user and "password_hash" not in user

    tokens = await login(client, email)
    me = await client.get("/api/v1/auth/me", headers=auth(tokens))
    assert me.status_code == 200
    assert me.json()["email"] == email


@pytest.mark.asyncio
async def test_el_email_se_normaliza_a_minusculas(client: AsyncClient, admin: dict) -> None:
    """El CHECK de la base lo exige; el DTO lo normaliza antes de llegar."""
    mail = _email().upper()
    created = await create_coach(client, admin, mail)
    assert created["user"]["email"] == mail.lower()


@pytest.mark.asyncio
async def test_no_se_repite_el_email(client: AsyncClient, admin: dict) -> None:
    email, _ = await register(client, admin, "coach")
    r = await client.post(
        "/api/v1/admin/coaches",
        headers=admin["headers"],
        json={"email": email, "displayName": "Otro"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_la_contrasena_corta_se_rechaza(client: AsyncClient, admin: dict) -> None:
    """Ya no hay registro publico: se prueba en el cambio de contrasena."""
    created = await create_coach(client, admin)
    tokens = await client.post(
        "/api/v1/auth/login",
        json={
            "email": created["user"]["email"],
            "password": created["temporaryPassword"],
        },
    )
    r = await client.post(
        "/api/v1/auth/change-password",
        headers=auth(tokens.json()),
        json={
            "currentPassword": created["temporaryPassword"],
            "newPassword": "corta",
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_el_login_no_distingue_usuario_de_contrasena(
    client: AsyncClient, admin: dict
) -> None:
    """Las dos respuestas tienen que ser identicas, o se puede enumerar quien
    tiene cuenta."""
    email, _ = await register(client, admin)

    mala = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "otra-cosa-larga"}
    )
    inexistente = await client.post(
        "/api/v1/auth/login", json={"email": _email(), "password": PASSWORD}
    )

    assert mala.status_code == inexistente.status_code == 401
    assert mala.json() == inexistente.json()


@pytest.mark.asyncio
async def test_sin_token_no_se_entra(client: AsyncClient) -> None:
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_un_token_inventado_no_vale(client: AsyncClient) -> None:
    r = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer no.es.un.jwt"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_el_refresh_no_sirve_como_access(client: AsyncClient, admin: dict) -> None:
    """Sin esta comprobacion, un token de un mes valdria para entrar y
    revocarlo dejaria de servir de nada."""
    email, _ = await register(client, admin)
    tokens = await login(client, email)

    r = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['refreshToken']}"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_el_refresh_rota_y_revoca_el_anterior(client: AsyncClient, admin: dict) -> None:
    email, _ = await register(client, admin)
    tokens = await login(client, email)

    first = await client.post(
        "/api/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]}
    )
    assert first.status_code == 200

    # El mismo refresh token, otra vez: ya esta revocado.
    second = await client.post(
        "/api/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]}
    )
    assert second.status_code == 401


@pytest.mark.asyncio
async def test_el_logout_revoca_el_refresh(client: AsyncClient, admin: dict) -> None:
    email, _ = await register(client, admin)
    tokens = await login(client, email)

    out = await client.post(
        "/api/v1/auth/logout", json={"refreshToken": tokens["refreshToken"]}
    )
    assert out.status_code == 204

    again = await client.post(
        "/api/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]}
    )
    assert again.status_code == 401
