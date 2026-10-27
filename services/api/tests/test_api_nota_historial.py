"""Lo que el atleta ve alrededor de sus sets: RIR, nota del coach e historial.

Los tres salen del servidor ya resueltos. El RIR tiene que ser el mismo que el
coach ve en su tabla, la nota es solo suya y el historial cruza bloques pero
nunca enseña lo de otro atleta.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from tests.test_api_auth import auth, login, register
from tests.test_api_sessions import _nueva_sesion, entorno  # noqa: F401

API = "/api/v1"


async def _hacer_set(client: AsyncClient, e: dict, s: dict, idx: int, kg: float, reps: str):
    r = await client.post(
        f"{API}/sessions/{s['id']}/sets",
        headers=e["aa"],
        json={
            "sets": [
                {
                    "clientId": str(uuid.uuid4()),
                    "sessionExerciseId": s["exercises"][0]["id"],
                    "index": idx,
                    "weightKg": kg,
                    "reps": reps,
                    "rpe": None,
                    "done": True,
                }
            ]
        },
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_la_sesion_trae_equipo_y_rir_de_la_semana(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    s = await _nueva_sesion(client, entorno)
    ex = s["exercises"][0]
    assert ex["equipment"] == "Barra"
    assert ex["targetRir"] == 2
    assert ex["note"] is None


@pytest.mark.asyncio
async def test_el_rir_del_deload_coincide_con_la_tabla_del_coach(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    s = await _nueva_sesion(client, entorno, semana=6)
    assert s["isDeload"] is True

    grid = await client.get(
        f"{API}/mesocycles/{entorno['meso']['id']}/plan", headers=entorno["ca"]
    )
    celda = grid.json()["rows"][0]["weeks"][5]
    assert s["exercises"][0]["targetRir"] == celda["targetRir"]
    assert celda["targetRir"] != 2


@pytest.mark.asyncio
async def test_el_coach_fija_una_nota_y_el_atleta_la_lee(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    meso = entorno["meso"]
    mex_id = meso["exercises"][0]["id"]
    url = f"{API}/mesocycles/{meso['id']}/exercises/{mex_id}/note"

    r = await client.put(url, headers=entorno["ca"], json={"note": "  Pausa de 1 s abajo  "})
    assert r.status_code == 204, r.text

    s = await _nueva_sesion(client, entorno)
    assert s["exercises"][0]["note"] == "Pausa de 1 s abajo"
    grid = await client.get(f"{API}/mesocycles/{meso['id']}/plan", headers=entorno["ca"])
    assert grid.json()["rows"][0]["note"] == "Pausa de 1 s abajo"

    # Vaciarla es borrarla, no guardar una cadena en blanco.
    await client.put(url, headers=entorno["ca"], json={"note": "   "})
    leida = await client.get(f"{API}/sessions/{s['id']}", headers=entorno["aa"])
    assert leida.json()["exercises"][0]["note"] is None


@pytest.mark.asyncio
async def test_el_atleta_no_escribe_la_nota(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    meso = entorno["meso"]
    url = f"{API}/mesocycles/{meso['id']}/exercises/{meso['exercises'][0]['id']}/note"
    r = await client.put(url, headers=entorno["aa"], json={"note": "me la pongo yo"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_el_historial_trae_las_sesiones_cerradas_sin_la_actual(
    client: AsyncClient,
    entorno: dict,  # noqa: F811
) -> None:
    s1 = await _nueva_sesion(client, entorno, semana=1)
    await _hacer_set(client, entorno, s1, 0, 60.0, "8")
    await _hacer_set(client, entorno, s1, 1, 60.0, "7")
    await client.post(f"{API}/sessions/{s1['id']}/complete", headers=entorno["aa"])

    s2 = await _nueva_sesion(client, entorno, semana=2)
    url = f"{API}/sessions/{s2['id']}/exercises/{s2['exercises'][0]['id']}/history"
    r = await client.get(url, headers=entorno["aa"])
    assert r.status_code == 200, r.text

    hist = r.json()
    assert len(hist) == 1
    assert hist[0]["sessionId"] == s1["id"]
    assert hist[0]["weekNumber"] == 1
    assert hist[0]["otherBlock"] is False
    assert hist[0]["targetRir"] == 2
    assert hist[0]["sets"] == [
        {"weightKg": 60.0, "reps": "8", "subSets": None},
        {"weightKg": 60.0, "reps": "7", "subSets": None},
    ]
    assert hist[0]["feedback"] is None


@pytest.mark.asyncio
async def test_el_historial_no_se_lee_desde_fuera(
    client: AsyncClient,
    admin: dict,
    entorno: dict,  # noqa: F811
) -> None:
    s = await _nueva_sesion(client, entorno)
    url = f"{API}/sessions/{s['id']}/exercises/{s['exercises'][0]['id']}/history"

    otro_mail, _ = await register(client, admin, "athlete")
    otro = auth(await login(client, otro_mail))
    assert (await client.get(url, headers=otro)).status_code == 404

    # Un ejercicio que no es de esa sesion tampoco.
    ajeno = f"{API}/sessions/{s['id']}/exercises/{uuid.uuid4()}/history"
    assert (await client.get(ajeno, headers=entorno["aa"])).status_code == 404
