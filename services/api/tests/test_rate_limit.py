"""El unico test que corre con el limiter prendido a proposito.

El resto de la suite lo apaga (ver conftest.client): comparten la IP del
cliente httpx y un solo escenario de permisos ya hace mas de cinco peticiones
de login. Aqui se prende de vuelta para comprobar que el limite existe de
verdad.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.rate_limit import limiter
from tests.test_api_auth import register


@pytest.mark.asyncio
async def test_el_login_se_bloquea_tras_repetidos_intentos(
    client: AsyncClient, admin: dict
) -> None:
    email, _ = await register(client, admin, "athlete")

    limiter.enabled = True
    try:
        for _ in range(5):
            r = await client.post(
                "/api/v1/auth/login", json={"email": email, "password": "mala"}
            )
            assert r.status_code == 401, r.text

        blocked = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "mala"}
        )
        assert blocked.status_code == 429, blocked.text
    finally:
        limiter.enabled = False
