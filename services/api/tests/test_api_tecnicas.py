"""Tecnicas de intensidad en el ultimo set: rest-pause, drop set, myo-reps.

Son opcionales: un ejercicio sin tecnica se comporta exactamente como antes.
Lo que se prueba es que la pauta del coach se congela en la sesion de su
semana, que el deload la ignora y que las partes del set viajan aparte de las
reps, para que el motor siga progresando con la primera.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from tests.test_api_sessions import _nueva_sesion, entorno  # noqa: F401

API = "/api/v1"

RP = {"technique": "rest_pause", "techniqueRounds": 2, "techniqueAmount": 15}


async def _pautar(client: AsyncClient, e: dict, semana: int | None, **cuerpo) -> object:
    meso = e["meso"]
    return await client.put(
        f"{API}/mesocycles/{meso['id']}/exercises/{meso['exercises'][0]['id']}/prescription",
        headers=e["ca"],
        json={"weekNumber": semana, **cuerpo},
    )


@pytest.mark.asyncio
async def test_sin_tecnica_todo_sigue_igual(client: AsyncClient, entorno: dict) -> None:  # noqa: F811
    s = await _nueva_sesion(client, entorno)
    ex = s["exercises"][0]
    assert ex["technique"] is None
    assert ex["techniqueRounds"] is None
    assert ex["techniqueAmount"] is None


@pytest.mark.asyncio
async def test_la_tecnica_de_una_semana_llega_solo_a_esa_semana(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    r = await _pautar(client, entorno, 2, **RP)
    assert r.status_code == 200, r.text
    assert r.json()["technique"] == "rest_pause"

    grid = await client.get(
        f"{API}/mesocycles/{entorno['meso']['id']}/plan", headers=entorno["ca"]
    )
    semanas = grid.json()["rows"][0]["weeks"]
    assert semanas[0]["technique"] is None
    assert (semanas[1]["technique"], semanas[1]["techniqueRounds"]) == ("rest_pause", 2)

    s1 = await _nueva_sesion(client, entorno, semana=1)
    s2 = await _nueva_sesion(client, entorno, semana=2)
    assert s1["exercises"][0]["technique"] is None
    ex = s2["exercises"][0]
    assert (ex["technique"], ex["techniqueRounds"], ex["techniqueAmount"]) == (
        "rest_pause",
        2,
        15,
    )


@pytest.mark.asyncio
async def test_el_deload_no_lleva_tecnica_aunque_sea_de_todo_el_bloque(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    r = await _pautar(
        client, entorno, None, technique="drop_set", techniqueRounds=2, techniqueAmount=25
    )
    assert r.status_code == 200, r.text

    grid = await client.get(
        f"{API}/mesocycles/{entorno['meso']['id']}/plan", headers=entorno["ca"]
    )
    semanas = grid.json()["rows"][0]["weeks"]
    assert semanas[0]["technique"] == "drop_set"
    assert semanas[-1]["isDeload"] is True
    assert semanas[-1]["technique"] is None

    deload = await _nueva_sesion(client, entorno, semana=6)
    assert deload["exercises"][0]["technique"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "cuerpo",
    [
        {"technique": "rest_pause", "techniqueRounds": 2, "techniqueAmount": 90},
        {"technique": "drop_set", "techniqueRounds": 9, "techniqueAmount": 25},
        {"technique": "myo_reps", "techniqueRounds": 3},
        {"techniqueRounds": 2, "techniqueAmount": 15},
        {"technique": "superserie", "techniqueRounds": 2, "techniqueAmount": 15},
    ],
)
async def test_una_tecnica_a_medias_o_fuera_de_rango_se_rechaza(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
    cuerpo: dict,
) -> None:
    r = await _pautar(client, entorno, 2, **cuerpo)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_las_partes_del_set_viajan_aparte_de_las_reps(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    await _pautar(client, entorno, 1, **RP)
    s = await _nueva_sesion(client, entorno, semana=1)
    ultimo = s["exercises"][0]["sets"][-1]["index"]

    r = await client.post(
        f"{API}/sessions/{s['id']}/sets",
        headers=entorno["aa"],
        json={
            "sets": [
                {
                    "clientId": str(uuid.uuid4()),
                    "sessionExerciseId": s["exercises"][0]["id"],
                    "index": ultimo,
                    "weightKg": 60.0,
                    "reps": "8",
                    "rpe": None,
                    "subSets": "4+3",
                    "done": True,
                }
            ]
        },
    )
    assert r.status_code == 200, r.text

    leida = await client.get(f"{API}/sessions/{s['id']}", headers=entorno["aa"])
    hecho = leida.json()["exercises"][0]["sets"][-1]
    assert (hecho["loggedReps"], hecho["loggedSubSets"]) == ("8", "4+3")

    await client.post(f"{API}/sessions/{s['id']}/complete", headers=entorno["aa"])
    s2 = await _nueva_sesion(client, entorno, semana=2)
    hist = await client.get(
        f"{API}/sessions/{s2['id']}/exercises/{s2['exercises'][0]['id']}/history",
        headers=entorno["aa"],
    )
    assert hist.json()[0]["sets"] == [{"weightKg": 60.0, "reps": "8", "subSets": "4+3"}]
