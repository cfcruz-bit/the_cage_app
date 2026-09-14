"""El ciclo completo de una sesion, con el motor de por medio.

Lo que se prueba aqui es la union entre las tres capas: la base guarda, el
motor calcula y la API reparte permisos. Los tests del motor (1 766) ya
garantizan que los numeros son correctos; estos garantizan que llegan enteros
hasta el JSON y que el historico se lee bien.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.test_api_auth import auth, login, register


@pytest_asyncio.fixture
async def entorno(client: AsyncClient, admin: dict) -> dict:
    coach_mail, _ = await register(client, admin, "coach")
    atleta_mail, atleta = await register(client, admin, "athlete")
    ca = auth(await login(client, coach_mail))
    aa = auth(await login(client, atleta_mail))

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
    return {"ca": ca, "aa": aa, "meso": meso.json()}


async def _nueva_sesion(client: AsyncClient, e: dict, semana: int = 1) -> dict:
    r = await client.post(
        f"/api/v1/mesocycles/{e['meso']['id']}/sessions",
        headers=e["ca"],
        json={"weekNumber": semana, "dayLabel": "Push A"},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_la_primera_sesion_arranca_donde_dijo_el_coach(
    client: AsyncClient, entorno: dict
) -> None:
    """Sin historico, el motor parte de la carga inicial y no inventa nada."""
    s = await _nueva_sesion(client, entorno)
    ex = s["exercises"][0]

    assert ex["plannedLoadKg"] == 60.0
    assert ex["plannedSets"] == 3
    assert ex["restSeconds"] == 150
    assert len(ex["sets"]) == 3
    assert ex["policyVersion"] == "2026.09"


@pytest.mark.asyncio
async def test_la_prescripcion_del_coach_gana_al_motor(
    client: AsyncClient, entorno: dict
) -> None:
    """'el coach es el que pauta que tantas series hara el atleta'."""
    mex_id = entorno["meso"]["exercises"][0]["id"]
    r = await client.put(
        f"/api/v1/mesocycles/{entorno['meso']['id']}/exercises/{mex_id}/prescription",
        headers=entorno["ca"],
        json={"sets": 5, "loadKg": 80.0, "restSeconds": 240},
    )
    assert r.status_code == 200

    s = await _nueva_sesion(client, entorno)
    ex = s["exercises"][0]

    assert ex["plannedLoadKg"] == 80.0
    assert ex["plannedSets"] == 5
    assert ex["restSeconds"] == 240
    assert ex["why"] == "carga y volumen pautados por tu coach"


@pytest.mark.asyncio
async def test_dejar_la_prescripcion_en_null_devuelve_el_mando_al_motor(
    client: AsyncClient, entorno: dict
) -> None:
    mex_id = entorno["meso"]["exercises"][0]["id"]
    url = f"/api/v1/mesocycles/{entorno['meso']['id']}/exercises/{mex_id}/prescription"
    await client.put(url, headers=entorno["ca"], json={"sets": 5, "restSeconds": 240})
    await client.put(url, headers=entorno["ca"], json={"restSeconds": 240})

    s = await _nueva_sesion(client, entorno)
    ex = s["exercises"][0]
    assert ex["plannedSets"] == 3  # el arranque del coach, via motor
    assert ex["restSeconds"] == 240  # el descanso NO tiene modo automatico


@pytest.mark.asyncio
async def test_el_atleta_registra_sets_y_el_mismo_clientid_no_duplica(
    client: AsyncClient, entorno: dict
) -> None:
    """El caso real: la cola sin cobertura reenvia el mismo set tres veces."""
    s = await _nueva_sesion(client, entorno)
    se_id = s["exercises"][0]["id"]
    cid = str(uuid.uuid4())

    payload = {
        "sets": [
            {
                "clientId": cid,
                "sessionExerciseId": se_id,
                "index": 0,
                "weightKg": 60.0,
                "reps": "8",
                "rpe": "8",
                "done": True,
            }
        ]
    }

    primera = await client.post(
        f"/api/v1/sessions/{s['id']}/sets", headers=entorno["aa"], json=payload
    )
    assert primera.status_code == 200
    assert primera.json() == {"accepted": 1, "updated": []}

    segunda = await client.post(
        f"/api/v1/sessions/{s['id']}/sets", headers=entorno["aa"], json=payload
    )
    assert segunda.status_code == 200
    assert segunda.json()["updated"] == [cid]

    leida = await client.get(f"/api/v1/sessions/{s['id']}", headers=entorno["aa"])
    marcados = [x for x in leida.json()["exercises"][0]["sets"] if x["done"]]
    assert len(marcados) == 1


@pytest.mark.asyncio
async def test_no_se_pueden_colar_sets_de_otra_sesion(
    client: AsyncClient, entorno: dict
) -> None:
    s = await _nueva_sesion(client, entorno)
    r = await client.post(
        f"/api/v1/sessions/{s['id']}/sets",
        headers=entorno["aa"],
        json={
            "sets": [
                {
                    "clientId": str(uuid.uuid4()),
                    "sessionExerciseId": str(uuid.uuid4()),
                    "index": 0,
                    "reps": "8",
                    "done": True,
                }
            ]
        },
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_el_feedback_del_atleta_mueve_la_semana_siguiente(
    client: AsyncClient, entorno: dict
) -> None:
    """La prueba de que el motor esta enchufado de verdad.

    El atleta cierra a RIR 1 (RPE 9) con el tope de reps y reporta volumen
    insuficiente. La semana que viene tiene que subir carga Y ganar un set.
    """
    s1 = await _nueva_sesion(client, entorno)
    se_id = s1["exercises"][0]["id"]

    await client.post(
        f"/api/v1/sessions/{s1['id']}/sets",
        headers=entorno["aa"],
        json={
            "sets": [
                {
                    "clientId": str(uuid.uuid4()),
                    "sessionExerciseId": se_id,
                    "index": i,
                    "weightKg": 60.0,
                    "reps": "10",
                    "rpe": "9",
                    "done": True,
                }
                for i in range(3)
            ]
        },
    )
    await client.post(
        f"/api/v1/sessions/{s1['id']}/feedback",
        headers=entorno["aa"],
        json={
            "sessionExerciseId": se_id,
            "feedback": {
                "joint": "Ninguno",
                "soreness": "Se fue justo a tiempo",
                "pump": "Moderado",
                "volume": "Insuficiente",
            },
        },
    )
    await client.post(f"/api/v1/sessions/{s1['id']}/complete", headers=entorno["aa"])

    s2 = await _nueva_sesion(client, entorno, semana=2)
    ex = s2["exercises"][0]

    assert ex["plannedLoadKg"] > 60.0, "cerro con holgura de RIR y en el tope de reps"
    assert ex["plannedSets"] == 4, "reporto volumen insuficiente"


@pytest.mark.asyncio
async def test_una_sesion_sin_cerrar_no_cuenta_como_historico(
    client: AsyncClient, entorno: dict
) -> None:
    """Progresar sobre un entrenamiento que el atleta abandono seria subir
    cargas por un dato que no representa lo que puede levantar."""
    s1 = await _nueva_sesion(client, entorno)
    se_id = s1["exercises"][0]["id"]

    await client.post(
        f"/api/v1/sessions/{s1['id']}/sets",
        headers=entorno["aa"],
        json={
            "sets": [
                {
                    "clientId": str(uuid.uuid4()),
                    "sessionExerciseId": se_id,
                    "index": 0,
                    "weightKg": 100.0,
                    "reps": "12",
                    "rpe": "6",
                    "done": True,
                }
            ]
        },
    )
    # No se llama a /complete.

    s2 = await _nueva_sesion(client, entorno, semana=2)
    assert s2["exercises"][0]["plannedLoadKg"] == 60.0


@pytest.mark.asyncio
async def test_la_semana_fuera_del_bloque_se_rechaza(
    client: AsyncClient, entorno: dict
) -> None:
    r = await client.post(
        f"/api/v1/mesocycles/{entorno['meso']['id']}/sessions",
        headers=entorno["ca"],
        json={"weekNumber": 9, "dayLabel": "Push A"},
    )
    assert r.status_code == 400
