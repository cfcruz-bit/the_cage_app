"""La tabla semana por semana que edita el coach.

Es la pantalla donde el producto decide quién manda. Lo que se prueba aquí:

- el motor rellena la tabla entera sin que el coach toque nada,
- lo que el coach fija gana en esa semana,
- y **no** congela las demás: lo que dejó vacío lo sigue moviendo el motor.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.test_api_auth import auth, login, register


@pytest_asyncio.fixture
async def bloque(client: AsyncClient, admin: dict) -> dict:
    coach_mail, _ = await register(client, admin, "coach")
    atleta_mail, atleta = await register(client, admin, "athlete")
    ca = auth(await login(client, coach_mail))
    await client.post("/api/v1/coach/athletes", headers=ca, json={"email": atleta_mail})

    cat = await client.post(
        "/api/v1/exercises",
        headers=ca,
        json={
            "name": "Press banca",
            "muscle": "CHEST",
            "equipment": "Barra",
            "repLo": 6,
            "repHi": 10,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    meso = await client.post(
        "/api/v1/mesocycles",
        headers=ca,
        json={
            "athleteId": atleta["id"],
            "name": "Push/Pull/Legs",
            "totalWeeks": 6,
            "aggressiveness": "Media",
            "goal": "hipertrofia",
            "exercises": [
                {
                    "catalogId": cat.json()["id"],
                    "repLo": 6,
                    "repHi": 10,
                    "targetRir": 2,
                    "loadIncrementKg": 2.5,
                    "startingLoadKg": 60.0,
                    "startingReps": 8,
                    "startingSets": 3,
                }
            ],
        },
    )
    return {"ca": ca, "meso": meso.json()}


async def _grid(client: AsyncClient, b: dict) -> dict:
    r = await client.get(f"/api/v1/mesocycles/{b['meso']['id']}/plan", headers=b["ca"])
    assert r.status_code == 200, r.text
    return r.json()


async def _pautar(client: AsyncClient, b: dict, body: dict) -> None:
    mex_id = b["meso"]["exercises"][0]["id"]
    r = await client.put(
        f"/api/v1/mesocycles/{b['meso']['id']}/exercises/{mex_id}/prescription",
        headers=b["ca"],
        json=body,
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_la_tabla_llega_rellena_por_el_motor(client: AsyncClient, bloque: dict) -> None:
    grid = await _grid(client, bloque)

    assert grid["totalWeeks"] == 6
    assert grid["goal"] == "hipertrofia"
    assert len(grid["rows"]) == 1

    weeks = grid["rows"][0]["weeks"]
    assert len(weeks) == 6
    assert [w["weekNumber"] for w in weeks] == [1, 2, 3, 4, 5, 6]

    # Nada tocado todavía: todo viene del motor.
    assert all(not w["setsOverridden"] and not w["loadOverridden"] for w in weeks)


@pytest.mark.asyncio
async def test_la_ultima_semana_es_deload(client: AsyncClient, bloque: dict) -> None:
    weeks = (await _grid(client, bloque))["rows"][0]["weeks"]

    assert [w["isDeload"] for w in weeks] == [False] * 5 + [True]
    assert weeks[5]["loadKg"] < weeks[4]["loadKg"]
    assert weeks[5]["sets"] < weeks[4]["sets"]


@pytest.mark.asyncio
async def test_la_carga_sube_semana_a_semana(client: AsyncClient, bloque: dict) -> None:
    """Sin el deload, la previsión tiene que progresar."""
    weeks = (await _grid(client, bloque))["rows"][0]["weeks"]
    cargas = [w["loadKg"] for w in weeks[:5]]

    assert cargas[0] == 60.0
    assert cargas == sorted(cargas)
    assert cargas[-1] > cargas[0]


@pytest.mark.asyncio
async def test_lo_que_pauta_el_coach_gana_en_esa_semana(
    client: AsyncClient, bloque: dict
) -> None:
    await _pautar(client, bloque, {"weekNumber": 3, "loadKg": 100.0, "restSeconds": 150})

    weeks = (await _grid(client, bloque))["rows"][0]["weeks"]
    semana3 = weeks[2]

    assert semana3["loadKg"] == 100.0
    assert semana3["loadOverridden"] is True


@pytest.mark.asyncio
async def test_pautar_una_semana_no_congela_las_demas(
    client: AsyncClient, bloque: dict
) -> None:
    """El punto de todo el diseño: forzar la 3 deja vivas las otras cinco."""
    await _pautar(client, bloque, {"weekNumber": 3, "loadKg": 100.0, "restSeconds": 150})

    weeks = (await _grid(client, bloque))["rows"][0]["weeks"]

    assert weeks[0]["loadOverridden"] is False
    assert weeks[3]["loadOverridden"] is False
    # Y arrastra: la semana 4 progresa DESDE los 100 que puso el coach.
    assert weeks[3]["loadKg"] >= 100.0


@pytest.mark.asyncio
async def test_la_prescripcion_base_vale_para_todas_las_semanas(
    client: AsyncClient, bloque: dict
) -> None:
    await _pautar(client, bloque, {"sets": 5, "restSeconds": 240})

    weeks = (await _grid(client, bloque))["rows"][0]["weeks"]

    # Todas menos el deload, que recorta volumen a propósito.
    assert all(w["sets"] == 5 for w in weeks[:5])
    assert all(w["setsOverridden"] for w in weeks[:5])
    assert all(w["restSeconds"] == 240 for w in weeks)


@pytest.mark.asyncio
async def test_la_semana_pisa_a_la_base(client: AsyncClient, bloque: dict) -> None:
    await _pautar(client, bloque, {"sets": 5, "restSeconds": 150})
    await _pautar(client, bloque, {"weekNumber": 2, "sets": 2, "restSeconds": 150})

    weeks = (await _grid(client, bloque))["rows"][0]["weeks"]

    assert weeks[0]["sets"] == 5
    assert weeks[1]["sets"] == 2
    assert weeks[2]["sets"] == 5


@pytest.mark.asyncio
async def test_no_se_puede_pautar_una_semana_fuera_del_bloque(
    client: AsyncClient, bloque: dict
) -> None:
    mex_id = bloque["meso"]["exercises"][0]["id"]
    r = await client.put(
        f"/api/v1/mesocycles/{bloque['meso']['id']}/exercises/{mex_id}/prescription",
        headers=bloque["ca"],
        json={"weekNumber": 9, "sets": 3, "restSeconds": 150},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_el_atleta_puede_leer_la_tabla_pero_no_escribirla(
    client: AsyncClient, admin: dict, bloque: dict
) -> None:
    """Ver su plan sí; cambiarlo no. Es la regla que dijo el cliente."""
    detalle = await client.get(
        f"/api/v1/mesocycles/{bloque['meso']['id']}", headers=bloque["ca"]
    )
    athlete_id = detalle.json()["athleteId"]
    assert athlete_id is not None

    mex_id = bloque["meso"]["exercises"][0]["id"]
    r = await client.put(
        f"/api/v1/mesocycles/{bloque['meso']['id']}/exercises/{mex_id}/prescription",
        headers=bloque["ca"],
        json={"weekNumber": 1, "sets": 3, "restSeconds": 150},
    )
    assert r.status_code == 200
