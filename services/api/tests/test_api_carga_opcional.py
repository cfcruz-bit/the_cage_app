"""Bloque 4: ningun peso inventado.

Los accesorios se pueden crear sin arranque; los básicos exigen carga (kg o
%) en TODAS las semanas del bloque. Sin ningún peso previo -ni arranque, ni
histórico- el motor no corre: la sesión sale en blanco y el atleta escribe el
suyo, sin ceros inventados de por medio.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.test_api_auth import auth, login, register


@pytest_asyncio.fixture
async def mundo(client: AsyncClient, admin: dict) -> dict:
    coach_mail, _ = await register(client, admin, "coach")
    atleta_mail, atleta = await register(client, admin, "athlete")
    ca = auth(await login(client, coach_mail))
    await client.post("/api/v1/coach/athletes", headers=ca, json={"email": atleta_mail})

    cat = await client.post(
        "/api/v1/exercises",
        headers=ca,
        json={
            "name": "Curl biceps",
            "muscle": "BICEPS",
            "equipment": "Mancuerna",
            "repLo": 8,
            "repHi": 12,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    return {"ca": ca, "athleteId": atleta["id"], "catalogId": cat.json()["id"]}


def _accesorio(m: dict, **overrides: object) -> dict:
    body = {
        "catalogId": m["catalogId"],
        "repLo": 8,
        "repHi": 12,
        "targetRir": 2,
        "loadIncrementKg": 2.5,
        "startingReps": 10,
        "startingSets": 3,
    }
    body.update(overrides)
    return body


async def _crear_meso(
    client: AsyncClient, m: dict, exercises: list[dict], total_weeks: int = 6
):
    return await client.post(
        "/api/v1/mesocycles",
        headers=m["ca"],
        json={
            "athleteId": m["athleteId"],
            "name": "Bloque",
            "totalWeeks": total_weeks,
            "aggressiveness": "Media",
            "goal": "hipertrofia",
            "exercises": exercises,
        },
    )


async def _sesion(client: AsyncClient, m: dict, meso_id: str, semana: int = 1):
    return await client.post(
        f"/api/v1/mesocycles/{meso_id}/sessions",
        headers=m["ca"],
        json={"weekNumber": semana, "dayLabel": "Brazo"},
    )


# ── Creacion: básicos exigen cobertura, accesorios son libres ───────────────


@pytest.mark.asyncio
async def test_un_basico_sin_carga_en_todas_las_semanas_es_422(
    client: AsyncClient, mundo: dict
) -> None:
    cat = await client.post(
        "/api/v1/exercises",
        headers=mundo["ca"],
        json={
            "name": "Sentadilla lowbar",
            "muscle": "BASICOS",
            "equipment": "Barra",
            "repLo": 1,
            "repHi": 5,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    r = await _crear_meso(
        client,
        mundo,
        [
            {
                "catalogId": cat.json()["id"],
                "repLo": 1,
                "repHi": 5,
                "targetRir": 2,
                "loadIncrementKg": 2.5,
                "startingReps": 3,
                "startingSets": 3,
                # Cubre 1..5 y deja fuera la 6 a proposito.
                "weeks": [{"weekNumber": w, "loadKg": 100.0} for w in range(1, 6)],
            }
        ],
    )
    assert r.status_code == 422, r.text
    assert "Sentadilla lowbar" in r.text
    assert "6" in r.text


@pytest.mark.asyncio
async def test_un_basico_con_las_seis_semanas_cubiertas_se_crea(
    client: AsyncClient, mundo: dict
) -> None:
    cat = await client.post(
        "/api/v1/exercises",
        headers=mundo["ca"],
        json={
            "name": "Sentadilla lowbar",
            "muscle": "BASICOS",
            "equipment": "Barra",
            "repLo": 1,
            "repHi": 5,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    r = await _crear_meso(
        client,
        mundo,
        [
            {
                "catalogId": cat.json()["id"],
                "repLo": 1,
                "repHi": 5,
                "targetRir": 2,
                "loadIncrementKg": 2.5,
                "startingReps": 3,
                "startingSets": 3,
                "weeks": [{"weekNumber": w, "loadPercent": 70 + w} for w in range(1, 6)]
                + [{"weekNumber": 6, "loadKg": 60.0}],
            }
        ],
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_un_accesorio_sin_carga_se_crea_y_la_tabla_sale_en_blanco(
    client: AsyncClient, mundo: dict
) -> None:
    r = await _crear_meso(client, mundo, [_accesorio(mundo)])
    assert r.status_code == 201, r.text
    meso = r.json()
    assert meso["exercises"][0]["startingLoadKg"] is None

    grid = await client.get(f"/api/v1/mesocycles/{meso['id']}/plan", headers=mundo["ca"])
    weeks = grid.json()["rows"][0]["weeks"]
    assert all(w["loadKg"] is None for w in weeks)


# ── Sesiones sin peso ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_primera_sesion_de_accesorio_sin_carga_sale_en_blanco(
    client: AsyncClient, mundo: dict
) -> None:
    meso = (await _crear_meso(client, mundo, [_accesorio(mundo)])).json()

    r = await _sesion(client, mundo, meso["id"])
    assert r.status_code == 201, r.text
    ex = r.json()["exercises"][0]

    assert ex["plannedLoadKg"] is None
    assert ex["exercise"] is None
    assert "Primera sesión" in ex["why"]
    assert len(ex["sets"]) == 3
    assert all(s["targetWeightKg"] is None for s in ex["sets"])


@pytest.mark.asyncio
async def test_completar_con_peso_alimenta_la_siguiente_sesion(
    client: AsyncClient, mundo: dict
) -> None:
    meso = (await _crear_meso(client, mundo, [_accesorio(mundo)])).json()
    s1 = (await _sesion(client, mundo, meso["id"], semana=1)).json()
    se_id = s1["exercises"][0]["id"]

    await client.post(
        f"/api/v1/sessions/{s1['id']}/sets",
        headers=mundo["ca"],
        json={
            "sets": [
                {
                    "clientId": str(uuid.uuid4()),
                    "sessionExerciseId": se_id,
                    "index": 0,
                    "weightKg": 40.0,
                    "reps": "10",
                    "done": True,
                }
            ]
        },
    )
    await client.post(f"/api/v1/sessions/{s1['id']}/complete", headers=mundo["ca"])

    s2 = (await _sesion(client, mundo, meso["id"], semana=2)).json()
    ex2 = s2["exercises"][0]
    assert ex2["plannedLoadKg"] is not None
    assert ex2["plannedLoadKg"] > 0
    assert ex2["exercise"] is not None


@pytest.mark.asyncio
async def test_completar_sin_registrar_peso_deja_la_siguiente_en_blanco(
    client: AsyncClient, mundo: dict
) -> None:
    meso = (await _crear_meso(client, mundo, [_accesorio(mundo)])).json()
    s1 = (await _sesion(client, mundo, meso["id"], semana=1)).json()

    await client.post(f"/api/v1/sessions/{s1['id']}/complete", headers=mundo["ca"])

    s2 = (await _sesion(client, mundo, meso["id"], semana=2)).json()
    assert s2["exercises"][0]["plannedLoadKg"] is None
    assert "Primera sesión" in s2["exercises"][0]["why"]
