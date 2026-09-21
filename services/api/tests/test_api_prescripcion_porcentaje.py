"""Bloque 3: prescribir la carga como % del 1RM en vez de kilos fijos.

El caso que gobierna todo el archivo: un básico se pauta "75%" en la semana,
el servidor lo resuelve contra la marca vigente del atleta y lo redondea al
salto montable. Sin marca, la celda no inventa un peso: se queda en blanco y
generar la sesión se niega, en vez de arrancar con un dato que nadie dio.
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
            "name": "Sentadilla lowbar",
            "muscle": "BASICOS",
            "equipment": "Barra",
            "repLo": 1,
            "repHi": 5,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    catalog_id = cat.json()["id"]

    meso = await client.post(
        "/api/v1/mesocycles",
        headers=ca,
        json={
            "athleteId": atleta["id"],
            "name": "Bloque de fuerza",
            "totalWeeks": 6,
            "aggressiveness": "Media",
            "goal": "fuerza",
            "exercises": [
                {
                    "catalogId": catalog_id,
                    "repLo": 1,
                    "repHi": 5,
                    "targetRir": 2,
                    "loadIncrementKg": 2.5,
                    "startingLoadKg": 100.0,
                    "startingReps": 3,
                    "startingSets": 3,
                    # Un basico exige carga en TODAS las semanas (bloque 4).
                    # Cada test que pauta la semana 3 la pisa con la suya.
                    "weeks": [{"weekNumber": w, "loadKg": 100.0} for w in range(1, 7)],
                }
            ],
        },
    )
    return {
        "ca": ca,
        "meso": meso.json(),
        "catalog_id": catalog_id,
        "athlete_id": atleta["id"],
    }


async def _pautar(client: AsyncClient, b: dict, body: dict) -> dict:
    mex_id = b["meso"]["exercises"][0]["id"]
    r = await client.put(
        f"/api/v1/mesocycles/{b['meso']['id']}/exercises/{mex_id}/prescription",
        headers=b["ca"],
        json=body,
    )
    return r


async def _marca(client: AsyncClient, b: dict, kg: float, dia: str = "2026-09-01") -> None:
    r = await client.post(
        f"/api/v1/athletes/{b['athlete_id']}/records",
        headers=b["ca"],
        json={
            "exerciseId": b["catalog_id"],
            "valueKg": kg,
            "achievedOn": dia,
            "source": "test",
        },
    )
    assert r.status_code == 201, r.text


async def _grid(client: AsyncClient, b: dict) -> dict:
    r = await client.get(f"/api/v1/mesocycles/{b['meso']['id']}/plan", headers=b["ca"])
    assert r.status_code == 200, r.text
    return r.json()


async def _sesion(client: AsyncClient, b: dict, semana: int = 3) -> object:
    return await client.post(
        f"/api/v1/mesocycles/{b['meso']['id']}/sessions",
        headers=b["ca"],
        json={"weekNumber": semana, "dayLabel": "Sentadilla"},
    )


# ── Resolución a kilos ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_75_por_ciento_de_140_con_incremento_2_5_son_105(
    client: AsyncClient, bloque: dict
) -> None:
    await _marca(client, bloque, 140.0)
    r = await _pautar(client, bloque, {"weekNumber": 3, "loadPercent": 75, "restSeconds": 150})
    assert r.status_code == 200, r.text

    weeks = (await _grid(client, bloque))["rows"][0]["weeks"]
    semana3 = weeks[2]

    assert semana3["loadPercent"] == 75
    assert semana3["loadKg"] == 105.0
    assert semana3["oneRmKg"] == 140.0
    assert semana3["needsOneRm"] is False
    assert semana3["loadOverridden"] is True


@pytest.mark.asyncio
async def test_72_por_ciento_de_140_se_redondea_a_100_no_100_8(
    client: AsyncClient, bloque: dict
) -> None:
    await _marca(client, bloque, 140.0)
    await _pautar(client, bloque, {"weekNumber": 3, "loadPercent": 72, "restSeconds": 150})

    semana3 = (await _grid(client, bloque))["rows"][0]["weeks"][2]
    assert semana3["loadKg"] == 100.0


# ── Sin marca ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_porcentaje_sin_marca_deja_la_celda_en_blanco(
    client: AsyncClient, bloque: dict
) -> None:
    await _pautar(client, bloque, {"weekNumber": 3, "loadPercent": 75, "restSeconds": 150})

    semana3 = (await _grid(client, bloque))["rows"][0]["weeks"][2]
    assert semana3["loadKg"] is None
    assert semana3["needsOneRm"] is True


@pytest.mark.asyncio
async def test_generar_sesion_sin_marca_responde_409_y_nombra_el_ejercicio(
    client: AsyncClient, bloque: dict
) -> None:
    await _pautar(client, bloque, {"weekNumber": 3, "loadPercent": 75, "restSeconds": 150})

    r = await _sesion(client, bloque, semana=3)
    assert r.status_code == 409, r.text
    assert "Sentadilla lowbar" in r.text
    assert "75" in r.text


@pytest.mark.asyncio
async def test_registrar_la_marca_despues_resuelve_la_celda(
    client: AsyncClient, bloque: dict
) -> None:
    await _pautar(client, bloque, {"weekNumber": 3, "loadPercent": 80, "restSeconds": 150})
    assert (await _grid(client, bloque))["rows"][0]["weeks"][2]["loadKg"] is None

    await _marca(client, bloque, 150.0)

    semana3 = (await _grid(client, bloque))["rows"][0]["weeks"][2]
    assert semana3["loadKg"] == 120.0
    assert semana3["needsOneRm"] is False


# ── El historico no se reescribe ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_subir_la_marca_cambia_la_tabla_pero_no_una_sesion_ya_generada(
    client: AsyncClient, bloque: dict
) -> None:
    await _marca(client, bloque, 140.0, "2026-08-01")
    await _pautar(client, bloque, {"weekNumber": 3, "loadPercent": 75, "restSeconds": 150})

    sesion = await _sesion(client, bloque, semana=3)
    assert sesion.status_code == 201, sesion.text
    assert sesion.json()["exercises"][0]["plannedLoadKg"] == 105.0

    # Sube la marca: la tabla se mueve...
    await _marca(client, bloque, 160.0, "2026-09-01")
    semana3 = (await _grid(client, bloque))["rows"][0]["weeks"][2]
    assert semana3["loadKg"] == 120.0

    # ...pero la sesion ya congelada sigue con el peso de la marca vieja.
    releida = await client.get(f"/api/v1/sessions/{sesion.json()['id']}", headers=bloque["ca"])
    assert releida.json()["exercises"][0]["plannedLoadKg"] == 105.0


# ── Validación ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_carga_en_kilos_y_en_porcentaje_a_la_vez_es_422(
    client: AsyncClient, bloque: dict
) -> None:
    r = await _pautar(client, bloque, {"loadKg": 100.0, "loadPercent": 75, "restSeconds": 150})
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("pct", [25, 120])
async def test_porcentaje_fuera_de_30_110_es_422(
    client: AsyncClient, bloque: dict, pct: int
) -> None:
    r = await _pautar(client, bloque, {"loadPercent": pct, "restSeconds": 150})
    assert r.status_code == 422, r.text
