"""Top set + back-offs en los basicos.

El coach pauta la semana como "1x3 al 85%" (top) y "3x5 al 75%" (back-off).
Decision del dueno: la carga del back-off es FIJA, en kg o % del 1RM, y no
depende de lo que salga el top ese dia.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests import test_api_prescripcion_porcentaje as porcentaje
from tests.test_api_prescripcion_porcentaje import _grid, _marca, _pautar, _sesion

#: El mismo bloque de sentadilla que los tests de porcentaje.
bloque = porcentaje.bloque

TOP_Y_BACKOFF = {
    "weekNumber": 3,
    "sets": 1,
    "repLo": 3,
    "repHi": 3,
    "loadPercent": 85,
    "backoffSets": 3,
    "backoffReps": 5,
    "backoffLoadPercent": 75,
}


@pytest.mark.asyncio
async def test_la_tabla_resuelve_top_y_back_off_contra_la_marca(
    client: AsyncClient, bloque: dict
) -> None:
    await _marca(client, bloque, 140.0)
    r = await _pautar(client, bloque, TOP_Y_BACKOFF)
    assert r.status_code == 200, r.text
    assert r.json()["backoffLoadPercent"] == 75

    celda = (await _grid(client, bloque))["rows"][0]["weeks"][2]
    # 85% de 140 = 119 -> 120; 75% de 140 = 105. Redondeo al salto de 2.5.
    assert (celda["sets"], celda["loadKg"]) == (1, 120.0)
    assert (celda["backoffSets"], celda["backoffReps"], celda["backoffLoadKg"]) == (3, 5, 105.0)
    assert celda["backoffNeedsOneRm"] is False

    # Las demas semanas no llevan back-off.
    assert (await _grid(client, bloque))["rows"][0]["weeks"][1]["backoffSets"] is None


@pytest.mark.asyncio
async def test_la_sesion_pone_los_back_offs_detras_del_top(
    client: AsyncClient, bloque: dict
) -> None:
    await _marca(client, bloque, 140.0)
    await _pautar(client, bloque, TOP_Y_BACKOFF)

    r = await _sesion(client, bloque, semana=3)
    assert r.status_code == 201, r.text
    ex = r.json()["exercises"][0]
    series = ex["sets"]

    assert (ex["plannedSets"], ex["backoffSets"], ex["backoffLoadKg"]) == (1, 3, 105.0)
    assert [s["index"] for s in series] == [0, 1, 2, 3]
    assert [s["backoff"] for s in series] == [False, True, True, True]
    assert (series[0]["targetWeightKg"], series[0]["targetReps"]) == (120.0, 3)
    assert all((s["targetWeightKg"], s["targetReps"]) == (105.0, 5) for s in series[1:])


@pytest.mark.asyncio
async def test_back_off_por_porcentaje_sin_marca_no_genera_la_sesion(
    client: AsyncClient, bloque: dict
) -> None:
    """Aunque el top vaya en kilos: el back-off tambien necesita la marca."""
    body = {**TOP_Y_BACKOFF, "loadPercent": None, "loadKg": 120.0}
    assert (await _pautar(client, bloque, body)).status_code == 200

    celda = (await _grid(client, bloque))["rows"][0]["weeks"][2]
    assert celda["backoffLoadKg"] is None
    assert celda["backoffNeedsOneRm"] is True

    r = await _sesion(client, bloque, semana=3)
    assert r.status_code == 409, r.text
    assert "75%" in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "roto",
    [
        {"backoffReps": None},
        {"backoffLoadPercent": None},
        {"backoffLoadKg": 100.0},
        {"backoffLoadPercent": 20},
    ],
)
async def test_un_back_off_incompleto_o_invalido_es_422(
    client: AsyncClient, bloque: dict, roto: dict
) -> None:
    r = await _pautar(client, bloque, {**TOP_Y_BACKOFF, **roto})
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_los_back_offs_no_cuentan_como_historico_del_motor(
    client: AsyncClient, bloque: dict
) -> None:
    """El motor progresa sobre el top set: los back-offs van a otra carga y
    sumarian series que el no pauto."""
    await _marca(client, bloque, 140.0)
    await _pautar(client, bloque, TOP_Y_BACKOFF)
    s3 = (await _sesion(client, bloque, semana=3)).json()
    ex = s3["exercises"][0]

    sets = [
        {
            "clientId": f"cliente-{i:04d}",
            "sessionExerciseId": ex["id"],
            "index": i,
            "weightKg": 120.0 if i == 0 else 105.0,
            "reps": "3" if i == 0 else "5",
            "done": True,
        }
        for i in range(4)
    ]
    r = await client.post(
        f"/api/v1/sessions/{s3['id']}/sets", headers=bloque["ca"], json={"sets": sets}
    )
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/sessions/{s3['id']}/complete", headers=bloque["ca"])
    assert r.status_code == 200, r.text

    s4 = (await _sesion(client, bloque, semana=4)).json()
    last = s4["exercises"][0]["exercise"]["last"]
    assert (last["weightKg"], last["reps"], last["sets"]) == (120.0, 3, 1)


@pytest.mark.asyncio
async def test_back_off_solo_en_basicos(client: AsyncClient, bloque: dict) -> None:
    cat = await client.post(
        "/api/v1/exercises",
        headers=bloque["ca"],
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
    meso = await client.post(
        "/api/v1/mesocycles",
        headers=bloque["ca"],
        json={
            "athleteId": bloque["athlete_id"],
            "name": "Brazo",
            "totalWeeks": 4,
            "aggressiveness": "Media",
            "goal": "hipertrofia",
            "exercises": [
                {
                    "catalogId": cat.json()["id"],
                    "repLo": 8,
                    "repHi": 12,
                    "targetRir": 2,
                    "loadIncrementKg": 2.5,
                    "startingReps": 10,
                    "startingSets": 3,
                    "weeks": [
                        {
                            "weekNumber": 1,
                            "backoffSets": 2,
                            "backoffReps": 12,
                            "backoffLoadKg": 10.0,
                        }
                    ],
                }
            ],
        },
    )
    assert meso.status_code == 422, meso.text
    assert "Curl biceps" in meso.text


@pytest.mark.asyncio
async def test_el_alta_guarda_sets_reps_y_back_off_de_cada_semana(
    client: AsyncClient, bloque: dict
) -> None:
    mex = bloque["meso"]["exercises"][0]
    meso = await client.post(
        "/api/v1/mesocycles",
        headers=bloque["ca"],
        json={
            "athleteId": bloque["athlete_id"],
            "name": "Ondulante",
            "totalWeeks": 3,
            "aggressiveness": "Media",
            "goal": "fuerza",
            "exercises": [
                {
                    "catalogId": bloque["catalog_id"],
                    "repLo": mex["repLo"],
                    "repHi": mex["repHi"],
                    "targetRir": 2,
                    "loadIncrementKg": 2.5,
                    "startingReps": 3,
                    "startingSets": 3,
                    "weeks": [
                        {"weekNumber": 1, "sets": 5, "repLo": 5, "repHi": 5, "loadKg": 100.0},
                        {"weekNumber": 2, "sets": 4, "repLo": 3, "repHi": 3, "loadKg": 110.0},
                        {
                            "weekNumber": 3,
                            "sets": 1,
                            "repLo": 1,
                            "repHi": 1,
                            "loadKg": 130.0,
                            "backoffSets": 2,
                            "backoffReps": 3,
                            "backoffLoadKg": 110.0,
                        },
                    ],
                }
            ],
        },
    )
    assert meso.status_code == 201, meso.text

    r = await client.get(f"/api/v1/mesocycles/{meso.json()['id']}/plan", headers=bloque["ca"])
    semanas = r.json()["rows"][0]["weeks"]
    assert [(w["sets"], w["repLo"], w["loadKg"]) for w in semanas] == [
        (5, 5, 100.0),
        (4, 3, 110.0),
        (1, 1, 130.0),
    ]
    assert (semanas[2]["backoffSets"], semanas[2]["backoffLoadKg"]) == (2, 110.0)
