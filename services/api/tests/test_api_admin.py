"""El panel de administracion, contra la API real.

Lo que se prueba aqui es el modelo de negocio: quien puede crear cuentas, que
pasa cuando vence un mes, y que renovar suma en vez de tirar dias.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models import Membership, User, UserRole
from app.services.membership import add_months
from tests.test_api_auth import PASSWORD, auth, login

ADMIN_PASSWORD = "clave-del-admin-123"


@pytest_asyncio.fixture
async def admin(client: AsyncClient, session: AsyncSession) -> dict:
    """Un administrador creado por el camino real: directo en la base.

    Es lo que hace `scripts/create_admin.py`, y es el unico modo: las cuentas
    las crea un admin, asi que el primero no puede venir de la API.
    """
    email = f"admin-{uuid.uuid4().hex[:8]}@cage-test.com"
    session.add(
        User(
            email=email,
            password_hash=hash_password(ADMIN_PASSWORD),
            display_name="Camilo",
            role=UserRole.ADMIN.value,
        )
    )
    await session.commit()

    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": ADMIN_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"email": email, "headers": auth(r.json())}


async def _coach(client: AsyncClient, admin: dict) -> dict:
    r = await client.post(
        "/api/v1/admin/coaches",
        headers=admin["headers"],
        json={
            "email": f"coach-{uuid.uuid4().hex[:8]}@cage-test.com",
            "displayName": "Entrenador",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _athlete(client: AsyncClient, admin: dict, coach_id: str, months: int = 1) -> dict:
    r = await client.post(
        "/api/v1/admin/athletes",
        headers=admin["headers"],
        json={
            "email": f"atleta-{uuid.uuid4().hex[:8]}@cage-test.com",
            "displayName": "Sebastian",
            "coachId": coach_id,
            "months": months,
            "note": "efectivo",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


# ── Quien puede crear cuentas ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_el_registro_publico_esta_cerrado(client: AsyncClient) -> None:
    """Cualquiera podia crearse una cuenta de coach. Ya no."""
    r = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "intruso@cage-test.com",
            "password": PASSWORD,
            "displayName": "Intruso",
            "role": "coach",
        },
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_un_coach_no_puede_dar_altas(client: AsyncClient, admin: dict) -> None:
    coach = await _coach(client, admin)
    creds = await _first_login(client, coach)

    r = await client.post(
        "/api/v1/admin/coaches",
        headers=creds,
        json={"email": "otro@cage-test.com", "displayName": "Otro"},
    )
    assert r.status_code == 403


async def _first_login(client: AsyncClient, created: dict) -> dict[str, str]:
    """Entra con la provisional y la cambia, que es lo que hara el usuario."""
    email = created["user"]["email"]
    temporary = created["temporaryPassword"]

    tokens = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": temporary}
    )
    headers = auth(tokens.json())

    changed = await client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"currentPassword": temporary, "newPassword": PASSWORD},
    )
    assert changed.status_code == 200, changed.text

    # Cambiar la contrasena revoca las sesiones abiertas: hay que volver a entrar.
    return auth(await login(client, email))


# ── Alta de atleta ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_el_alta_crea_cuenta_membresia_y_asignacion(
    client: AsyncClient, admin: dict
) -> None:
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"], months=1)

    assert created["user"]["role"] == "athlete"
    assert created["user"]["mustChangePassword"] is True
    assert len(created["temporaryPassword"]) == 12

    # Un mes desde hoy, con el ultimo dia inclusive.
    esperado = add_months(date.today(), 1) - timedelta(days=1)
    assert created["user"]["accessEndsOn"] == esperado.isoformat()

    # Y su coach ya lo ve, sin hacer nada.
    creds = await _first_login(client, coach)
    cartera = await client.get("/api/v1/coach/athletes", headers=creds)
    assert created["user"]["id"] in {u["id"] for u in cartera.json()}


@pytest.mark.asyncio
async def test_la_contrasena_provisional_es_dictable(client: AsyncClient, admin: dict) -> None:
    """Sin caracteres que se confundan al pasarla por WhatsApp."""
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
    prohibidos = set("O0lI1")
    assert not (set(created["temporaryPassword"]) & prohibidos)


@pytest.mark.asyncio
async def test_no_se_puede_asignar_a_alguien_que_no_es_coach(
    client: AsyncClient, admin: dict
) -> None:
    coach = await _coach(client, admin)
    atleta = await _athlete(client, admin, coach["user"]["id"])

    r = await client.post(
        "/api/v1/admin/athletes",
        headers=admin["headers"],
        json={
            "email": "otro@cage-test.com",
            "displayName": "Otro",
            "coachId": atleta["user"]["id"],
            "months": 1,
        },
    )
    assert r.status_code == 400


# ── La contrasena provisional ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_con_la_provisional_solo_se_puede_cambiar_la_contrasena(
    client: AsyncClient, admin: dict
) -> None:
    """Es lo que hace que el admin deje de conocer la contrasena del cliente."""
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])

    tokens = await client.post(
        "/api/v1/auth/login",
        json={
            "email": created["user"]["email"],
            "password": created["temporaryPassword"],
        },
    )
    headers = auth(tokens.json())

    bloqueado = await client.get("/api/v1/exercises", headers=headers)
    assert bloqueado.status_code == 403

    # /me si responde: el movil necesita saber POR QUE no puede seguir.
    yo = await client.get("/api/v1/auth/me", headers=headers)
    assert yo.status_code == 200
    assert yo.json()["mustChangePassword"] is True


@pytest.mark.asyncio
async def test_cambiar_la_contrasena_cierra_las_demas_sesiones(
    client: AsyncClient, admin: dict
) -> None:
    """Si alguien se hizo con la provisional, cambiarla tiene que echarlo."""
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
    email = created["user"]["email"]
    temporary = created["temporaryPassword"]

    intruso = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": temporary}
    )
    robado = intruso.json()["refreshToken"]

    duenio = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": temporary}
    )
    await client.post(
        "/api/v1/auth/change-password",
        headers=auth(duenio.json()),
        json={"currentPassword": temporary, "newPassword": PASSWORD},
    )

    muerto = await client.post("/api/v1/auth/refresh", json={"refreshToken": robado})
    assert muerto.status_code == 401


@pytest.mark.asyncio
async def test_hace_falta_la_contrasena_actual_para_cambiarla(
    client: AsyncClient, admin: dict
) -> None:
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
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
        json={"currentPassword": "la-que-no-es", "newPassword": PASSWORD},
    )
    assert r.status_code == 400


# ── Vencimiento y renovacion ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_un_atleta_vencido_recibe_402(
    client: AsyncClient, admin: dict, session: AsyncSession
) -> None:
    """402 Payment Required: el movil lo trata como caso propio."""
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
    creds = await _first_login(client, created)

    # Se empuja el periodo al pasado, como si hubiera vencido ayer.
    found = await session.execute(
        select(Membership).where(Membership.athlete_id == uuid.UUID(created["user"]["id"]))
    )
    row = found.scalar_one()
    row.starts_on = date.today() - timedelta(days=40)
    row.ends_on = date.today() - timedelta(days=1)
    await session.commit()

    r = await client.get("/api/v1/exercises", headers=creds)
    assert r.status_code == 402
    assert r.json()["detail"] == "Necesita renovar su pago"


@pytest.mark.asyncio
async def test_el_login_del_vencido_funciona_y_me_explica_por_que(
    client: AsyncClient, admin: dict, session: AsyncSession
) -> None:
    """Si el login fallara, seria indistinguible de una contrasena mal puesta."""
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
    creds = await _first_login(client, created)

    found = await session.execute(
        select(Membership).where(Membership.athlete_id == uuid.UUID(created["user"]["id"]))
    )
    row = found.scalar_one()
    row.starts_on = date.today() - timedelta(days=40)
    row.ends_on = date.today() - timedelta(days=1)
    await session.commit()

    yo = await client.get("/api/v1/auth/me", headers=creds)
    assert yo.status_code == 200
    assert yo.json()["daysLeft"] is None
    assert yo.json()["accessEndsOn"] == (date.today() - timedelta(days=1)).isoformat()


@pytest.mark.asyncio
async def test_el_coach_no_caduca(client: AsyncClient, admin: dict) -> None:
    coach = await _coach(client, admin)
    creds = await _first_login(client, coach)

    yo = await client.get("/api/v1/auth/me", headers=creds)
    assert yo.json()["accessEndsOn"] is None
    assert yo.json()["renewalWarning"] is False

    r = await client.get("/api/v1/exercises", headers=creds)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_renovar_antes_de_vencer_suma_dias(client: AsyncClient, admin: dict) -> None:
    """El cliente puntual no pierde dias por pagar a tiempo."""
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"], months=1)
    fin_original = date.fromisoformat(created["user"]["accessEndsOn"])

    r = await client.post(
        f"/api/v1/admin/athletes/{created['user']['id']}/renew",
        headers=admin["headers"],
        json={"months": 1, "note": "transferencia"},
    )
    assert r.status_code == 200

    nuevo_fin = date.fromisoformat(r.json()["accessEndsOn"])
    esperado = add_months(fin_original + timedelta(days=1), 1) - timedelta(days=1)
    assert nuevo_fin == esperado
    assert nuevo_fin > fin_original


@pytest.mark.asyncio
async def test_el_historial_guarda_cada_pago(client: AsyncClient, admin: dict) -> None:
    """Una sola fecha en `users` no dejaria rastro de quien pago que mes."""
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
    await client.post(
        f"/api/v1/admin/athletes/{created['user']['id']}/renew",
        headers=admin["headers"],
        json={"months": 2, "note": "dos meses juntos"},
    )

    r = await client.get(
        f"/api/v1/admin/athletes/{created['user']['id']}/memberships",
        headers=admin["headers"],
    )
    historial = r.json()
    assert len(historial) == 2
    assert {h["note"] for h in historial} == {"efectivo", "dos meses juntos"}


@pytest.mark.asyncio
async def test_el_aviso_salta_a_cinco_dias(
    client: AsyncClient, admin: dict, session: AsyncSession
) -> None:
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
    creds = await _first_login(client, created)

    found = await session.execute(
        select(Membership).where(Membership.athlete_id == uuid.UUID(created["user"]["id"]))
    )
    row = found.scalar_one()
    row.ends_on = date.today() + timedelta(days=4)
    await session.commit()

    yo = (await client.get("/api/v1/auth/me", headers=creds)).json()
    assert yo["daysLeft"] == 5
    assert yo["renewalWarning"] is True


# ── Panel ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_la_tabla_del_panel_resume_el_estado(client: AsyncClient, admin: dict) -> None:
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])

    r = await client.get("/api/v1/admin/users", headers=admin["headers"])
    assert r.status_code == 200

    por_id = {row["id"]: row for row in r.json()}
    atleta = por_id[created["user"]["id"]]
    assert atleta["status"] == "activo"
    assert atleta["coachName"] == "Entrenador"

    entrenador = por_id[coach["user"]["id"]]
    assert entrenador["status"] == "no caduca"


@pytest.mark.asyncio
async def test_desactivar_impide_entrar(client: AsyncClient, admin: dict) -> None:
    coach = await _coach(client, admin)
    created = await _athlete(client, admin, coach["user"]["id"])
    email = created["user"]["email"]
    temporary = created["temporaryPassword"]

    r = await client.post(
        f"/api/v1/admin/users/{created['user']['id']}/active?active=false",
        headers=admin["headers"],
    )
    assert r.status_code == 200

    fallo = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": temporary}
    )
    assert fallo.status_code == 401


@pytest.mark.asyncio
async def test_no_se_puede_desactivar_al_administrador(
    client: AsyncClient, admin: dict, session: AsyncSession
) -> None:
    found = await session.execute(select(User).where(User.email == admin["email"]))
    yo = found.scalar_one()

    r = await client.post(
        f"/api/v1/admin/users/{yo.id}/active?active=false",
        headers=admin["headers"],
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_la_pagina_del_panel_se_sirve(client: AsyncClient) -> None:
    """Comparte origen con la API: sin CORS y sin un despliegue aparte."""
    r = await client.get("/admin")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "THE CAGE" in r.text


@pytest.mark.asyncio
async def test_la_pagina_es_publica_pero_los_datos_no(client: AsyncClient) -> None:
    """Que cualquiera pueda abrir el HTML no es un agujero: la autorizacion
    esta en los endpoints, no en quien puede ver un formulario."""
    assert (await client.get("/admin")).status_code == 200
    assert (await client.get("/api/v1/admin/users")).status_code == 401
