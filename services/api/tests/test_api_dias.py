"""Bloque 7: los dias de entrenamiento dentro del mesociclo.

El reparto es fijo para todo el bloque: el dia 2 lleva los mismos ejercicios las
seis semanas. Lo que se prueba aqui es (1) que el reparto se guarda y se valida,
(2) que una sesion trae SOLO los ejercicios de su dia, y (3) que el servidor
calcula que dia le toca al atleta, incluido el atleta que abre el suyo solo.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Membership
from tests.test_api_auth import auth, login, register

API = "/api/v1"


async def _catalogo(client: AsyncClient, ca: dict, nombre: str) -> str:
    r = await client.post(
        f"{API}/exercises",
        headers=ca,
        json={
            "name": nombre,
            "muscle": "CHEST",
            "equipment": "Barra",
            "repLo": 6,
            "repHi": 10,
            "targetRir": 2,
            "loadIncrementKg": 2.5,
        },
    )
    return r.json()["id"]


def _ej(cat_id: str, dia: int | None = None) -> dict:
    ej = {
        "catalogId": cat_id,
        "repLo": 6,
        "repHi": 10,
        "targetRir": 2,
        "loadIncrementKg": 2.5,
        "startingLoadKg": 60.0,
        "startingReps": 8,
        "startingSets": 3,
    }
    if dia is not None:
        ej["dayNumber"] = dia
    return ej


async def _atleta(client: AsyncClient, admin: dict, ca: dict) -> tuple[dict, dict]:
    mail, atleta = await register(client, admin, "athlete")
    aa = auth(await login(client, mail))
    await client.post(f"{API}/coach/athletes", headers=ca, json={"email": mail})
    return aa, atleta


async def _meso(client: AsyncClient, ca: dict, atleta_id: str, cuerpo: dict) -> object:
    return await client.post(
        f"{API}/mesocycles",
        headers=ca,
        json={"athleteId": atleta_id, "name": "Bloque", "totalWeeks": 2, **cuerpo},
    )


@pytest_asyncio.fixture
async def mundo(client: AsyncClient, admin: dict) -> dict:
    """3 dias, 2 semanas. D1 Empuje: banca, fondos. D2: sentadilla, prensa. D3 Tiron."""
    coach_mail, _ = await register(client, admin, "coach")
    ca = auth(await login(client, coach_mail))
    aa, atleta = await _atleta(client, admin, ca)

    cats = {
        n: await _catalogo(client, ca, n)
        for n in ("Banca", "Fondos", "Sentadilla", "Prensa", "Remo")
    }
    # El orden del cuerpo dentro de cada dia es el orden de la sesion: en el
    # dia 2 va "Prensa" ANTES que "Sentadilla" para que no coincida con el
    # orden en que se crearon en el catalogo.
    meso = await _meso(
        client,
        ca,
        atleta["id"],
        {
            "daysPerWeek": 3,
            "days": [{"dayNumber": 1, "name": "Empuje"}, {"dayNumber": 3, "name": "Tirón"}],
            "exercises": [
                _ej(cats["Banca"], 1),
                _ej(cats["Fondos"], 1),
                _ej(cats["Prensa"], 2),
                _ej(cats["Sentadilla"], 2),
                _ej(cats["Remo"], 3),
            ],
        },
    )
    assert meso.status_code == 201, meso.text
    return {"ca": ca, "aa": aa, "atleta": atleta, "cats": cats, "meso": meso.json()}


async def _abrir(client: AsyncClient, m: dict, semana: int, dia: int, **extra) -> object:
    return await client.post(
        f"{API}/mesocycles/{m['meso']['id']}/sessions",
        headers=m["ca"],
        json={"weekNumber": semana, "dayNumber": dia, **extra},
    )


async def _hacer(client: AsyncClient, m: dict, semana: int, dia: int) -> str:
    """Genera y completa un dia. Devuelve el id de la sesion."""
    r = await _abrir(client, m, semana, dia)
    assert r.status_code in (200, 201), r.text
    sid = r.json()["id"]
    c = await client.post(f"{API}/sessions/{sid}/complete", headers=m["aa"])
    assert c.status_code == 200, c.text
    return sid


async def _toca(client: AsyncClient, m: dict) -> dict:
    r = await client.get(f"{API}/sessions/current", headers=m["aa"])
    assert r.status_code == 200, r.text
    return r.json()


# ── Crear: el reparto se guarda y se valida ──────────────────────────────────


@pytest.mark.asyncio
async def test_la_sesion_de_un_dia_trae_solo_sus_ejercicios_en_orden(
    client: AsyncClient, mundo: dict
) -> None:
    assert mundo["meso"]["daysPerWeek"] == 3
    assert mundo["meso"]["days"] == [
        {"dayNumber": 1, "name": "Empuje"},
        {"dayNumber": 3, "name": "Tirón"},
    ]
    assert [e["dayNumber"] for e in mundo["meso"]["exercises"]] == [1, 1, 2, 2, 3]

    r = await _abrir(client, mundo, 1, 2)
    assert r.status_code == 201, r.text
    assert [e["name"] for e in r.json()["exercises"]] == ["Prensa", "Sentadilla"]
    assert r.json()["dayNumber"] == 2


@pytest.mark.asyncio
async def test_un_ejercicio_en_un_dia_que_no_existe_es_422(
    client: AsyncClient, admin: dict, mundo: dict
) -> None:
    r = await _meso(
        client,
        mundo["ca"],
        mundo["atleta"]["id"],
        {
            "daysPerWeek": 3,
            "exercises": [_ej(mundo["cats"]["Banca"], 1), _ej(mundo["cats"]["Remo"], 4)],
        },
    )
    assert r.status_code == 422
    assert "Remo (dia 4)" in r.json()["detail"]


@pytest.mark.asyncio
async def test_un_dia_sin_ejercicios_es_422_y_dice_cual(
    client: AsyncClient, mundo: dict
) -> None:
    r = await _meso(
        client,
        mundo["ca"],
        mundo["atleta"]["id"],
        {
            "daysPerWeek": 3,
            "exercises": [_ej(mundo["cats"]["Banca"], 1), _ej(mundo["cats"]["Remo"], 3)],
        },
    )
    assert r.status_code == 422
    assert "dia 2" in r.json()["detail"]


@pytest.mark.asyncio
async def test_un_nombre_para_un_dia_que_no_existe_es_422(
    client: AsyncClient, mundo: dict
) -> None:
    r = await _meso(
        client,
        mundo["ca"],
        mundo["atleta"]["id"],
        {
            "daysPerWeek": 1,
            "days": [{"dayNumber": 2, "name": "Pierna"}],
            "exercises": [_ej(mundo["cats"]["Banca"], 1)],
        },
    )
    assert r.status_code == 422
    assert "dia 2" in r.json()["detail"]


@pytest.mark.asyncio
async def test_un_mesociclo_de_antes_de_los_dias_sigue_funcionando(
    client: AsyncClient, mundo: dict
) -> None:
    """Sin daysPerWeek ni dayNumber: un dia, sin nombres, todo en la misma sesion."""
    r = await _meso(
        client,
        mundo["ca"],
        mundo["atleta"]["id"],
        {"exercises": [_ej(mundo["cats"]["Banca"]), _ej(mundo["cats"]["Remo"])]},
    )
    assert r.status_code == 201, r.text
    assert r.json()["daysPerWeek"] == 1 and r.json()["days"] == []

    s = await client.post(
        f"{API}/mesocycles/{r.json()['id']}/sessions",
        headers=mundo["ca"],
        json={"weekNumber": 1, "dayNumber": 1},
    )
    assert s.status_code == 201, s.text
    assert [e["name"] for e in s.json()["exercises"]] == ["Banca", "Remo"]
    assert s.json()["dayLabel"] == "Día 1"


@pytest.mark.asyncio
async def test_day_label_es_el_nombre_del_dia_o_dia_n(client: AsyncClient, mundo: dict) -> None:
    con_nombre = await _abrir(client, mundo, 1, 1)
    sin_nombre = await _abrir(client, mundo, 1, 2)
    assert con_nombre.json()["dayLabel"] == "Empuje"
    assert sin_nombre.json()["dayLabel"] == "Día 2"


@pytest.mark.asyncio
async def test_un_day_label_explicito_gana(client: AsyncClient, mundo: dict) -> None:
    r = await _abrir(client, mundo, 1, 1, dayLabel="Especial")
    assert r.json()["dayLabel"] == "Especial"


@pytest.mark.asyncio
async def test_un_dia_fuera_del_mesociclo_al_generar_es_400(
    client: AsyncClient, mundo: dict
) -> None:
    assert (await _abrir(client, mundo, 1, 4)).status_code == 400


# ── Editar el reparto ────────────────────────────────────────────────────────


async def _put_days(client: AsyncClient, m: dict, cuerpo: dict, headers: dict | None = None):
    return await client.put(
        f"{API}/mesocycles/{m['meso']['id']}/days", headers=headers or m["ca"], json=cuerpo
    )


@pytest.mark.asyncio
async def test_bajar_los_dias_con_ejercicios_huerfanos_es_422_y_no_mueve_nada(
    client: AsyncClient, mundo: dict
) -> None:
    r = await _put_days(client, mundo, {"daysPerWeek": 2})
    assert r.status_code == 422
    assert "Remo (dia 3)" in r.json()["detail"]

    despues = await client.get(f"{API}/mesocycles/{mundo['meso']['id']}", headers=mundo["ca"])
    assert despues.json()["daysPerWeek"] == 3
    assert [e["dayNumber"] for e in despues.json()["exercises"]] == [1, 1, 2, 2, 3]
    assert len(despues.json()["days"]) == 2


@pytest.mark.asyncio
async def test_el_coach_reasigna_ejercicios_y_renombra_los_dias(
    client: AsyncClient, mundo: dict
) -> None:
    remo = next(e for e in mundo["meso"]["exercises"] if e["name"] == "Remo")
    fondos = next(e for e in mundo["meso"]["exercises"] if e["name"] == "Fondos")
    banca = next(e for e in mundo["meso"]["exercises"] if e["name"] == "Banca")

    # Remo pasa al dia 2 y el dia 3 desaparece. Ademas Banca y Fondos
    # intercambian posiciones: el UNIQUE no puede romperse a mitad de camino.
    r = await _put_days(
        client,
        mundo,
        {
            "daysPerWeek": 2,
            "days": [{"dayNumber": 2, "name": "Pierna"}],
            "exercises": [
                {"exerciseId": remo["id"], "dayNumber": 2, "position": 2},
                {"exerciseId": banca["id"], "dayNumber": 1, "position": 1},
                {"exerciseId": fondos["id"], "dayNumber": 1, "position": 0},
            ],
        },
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["daysPerWeek"] == 2
    assert out["days"] == [{"dayNumber": 2, "name": "Pierna"}]
    assert [(e["name"], e["dayNumber"]) for e in out["exercises"]] == [
        ("Fondos", 1),
        ("Banca", 1),
        ("Prensa", 2),
        ("Sentadilla", 2),
        ("Remo", 2),
    ]
    # Y la sesion del dia 2 ya refleja el nuevo reparto y el nuevo nombre.
    s = await _abrir(client, mundo, 1, 2)
    assert [e["name"] for e in s.json()["exercises"]] == ["Prensa", "Sentadilla", "Remo"]
    assert s.json()["dayLabel"] == "Pierna"


@pytest.mark.asyncio
async def test_editar_el_reparto_dejando_un_dia_vacio_es_422(
    client: AsyncClient, mundo: dict
) -> None:
    remo = next(e for e in mundo["meso"]["exercises"] if e["name"] == "Remo")
    # Remo era lo unico del dia 3: sacarlo lo deja vacio.
    r = await _put_days(
        client,
        mundo,
        {
            "daysPerWeek": 3,
            "exercises": [{"exerciseId": remo["id"], "dayNumber": 1, "position": 5}],
        },
    )
    assert r.status_code == 422
    assert "dia 3" in r.json()["detail"]


@pytest.mark.asyncio
async def test_permisos_de_editar_el_reparto(
    client: AsyncClient, admin: dict, mundo: dict
) -> None:
    cuerpo = {"daysPerWeek": 3}  # valido: si no, el 422 taparia el permiso

    r = await _put_days(client, mundo, cuerpo, headers=mundo["aa"])
    assert r.status_code == 403

    otro_mail, _ = await register(client, admin, "coach")
    otro = auth(await login(client, otro_mail))
    r = await _put_days(client, mundo, cuerpo, headers=otro)
    assert r.status_code == 404

    assert (await _put_days(client, mundo, cuerpo)).status_code == 200


@pytest.mark.asyncio
async def test_la_tabla_sale_ordenada_por_dia_y_trae_los_nombres(
    client: AsyncClient, mundo: dict
) -> None:
    r = await client.get(f"{API}/mesocycles/{mundo['meso']['id']}/plan", headers=mundo["aa"])
    assert r.status_code == 200
    assert [(f["dayNumber"], f["name"]) for f in r.json()["rows"]] == [
        (1, "Banca"),
        (1, "Fondos"),
        (2, "Prensa"),
        (2, "Sentadilla"),
        (3, "Remo"),
    ]
    assert r.json()["daysPerWeek"] == 3
    assert r.json()["days"][0] == {"dayNumber": 1, "name": "Empuje"}


# ── Qué toca ─────────────────────────────────────────────────────────────────


def _next(w: int, d: int, nombre: str | None) -> dict:
    return {"weekNumber": w, "dayNumber": d, "dayName": nombre}


@pytest.mark.asyncio
async def test_sin_sesiones_toca_semana_1_dia_1(client: AsyncClient, mundo: dict) -> None:
    r = await _toca(client, mundo)
    assert r["session"] is None and r["finished"] is False
    assert r["next"] == _next(1, 1, "Empuje")


@pytest.mark.asyncio
async def test_tras_completar_el_dia_1_toca_el_2(client: AsyncClient, mundo: dict) -> None:
    await _hacer(client, mundo, 1, 1)
    assert (await _toca(client, mundo))["next"] == _next(1, 2, None)


@pytest.mark.asyncio
async def test_completada_la_semana_entera_toca_la_siguiente(
    client: AsyncClient, mundo: dict
) -> None:
    for d in (1, 2, 3):
        await _hacer(client, mundo, 1, d)
    assert (await _toca(client, mundo))["next"] == _next(2, 1, "Empuje")


@pytest.mark.asyncio
async def test_un_dia_saltado_se_sigue_ofreciendo(client: AsyncClient, mundo: dict) -> None:
    await _hacer(client, mundo, 1, 1)
    await _hacer(client, mundo, 1, 3)  # se salta el 2
    assert (await _toca(client, mundo))["next"] == _next(1, 2, None)


@pytest.mark.asyncio
async def test_todo_completado_es_next_null_y_finished(
    client: AsyncClient, mundo: dict
) -> None:
    for w in (1, 2):  # la semana 2 es la ultima (deload) y se comporta igual
        for d in (1, 2, 3):
            await _hacer(client, mundo, w, d)
    r = await _toca(client, mundo)
    assert r["next"] is None and r["session"] is None and r["finished"] is True


@pytest.mark.asyncio
async def test_una_sesion_abierta_sale_en_session_y_no_se_duplica(
    client: AsyncClient, mundo: dict
) -> None:
    creada = await _abrir(client, mundo, 1, 2)
    assert creada.status_code == 201

    r = await _toca(client, mundo)
    assert r["session"]["id"] == creada.json()["id"]
    assert r["next"] is None

    otra = await _abrir(client, mundo, 1, 2)
    assert otra.status_code == 200
    assert otra.json()["id"] == creada.json()["id"]


# ── POST /sessions/next: el atleta abre su día ───────────────────────────────


@pytest.mark.asyncio
async def test_el_atleta_abre_su_dia_y_recibe_sus_ejercicios(
    client: AsyncClient, mundo: dict
) -> None:
    await _hacer(client, mundo, 1, 1)
    r = await client.post(f"{API}/sessions/next", headers=mundo["aa"])
    assert r.status_code == 201, r.text
    assert (r.json()["weekNumber"], r.json()["dayNumber"]) == (1, 2)
    assert [e["name"] for e in r.json()["exercises"]] == ["Prensa", "Sentadilla"]


@pytest.mark.asyncio
async def test_abrir_dos_veces_devuelve_la_misma_sesion(
    client: AsyncClient, mundo: dict
) -> None:
    a = await client.post(f"{API}/sessions/next", headers=mundo["aa"])
    b = await client.post(f"{API}/sessions/next", headers=mundo["aa"])
    assert (a.status_code, b.status_code) == (201, 200)
    assert a.json()["id"] == b.json()["id"]


@pytest.mark.asyncio
async def test_con_la_membresia_vencida_es_402(
    client: AsyncClient, mundo: dict, session: AsyncSession
) -> None:
    fila = (
        await session.execute(
            select(Membership).where(Membership.athlete_id == uuid.UUID(mundo["atleta"]["id"]))
        )
    ).scalar_one()
    fila.starts_on = date.today() - timedelta(days=40)
    fila.ends_on = date.today() - timedelta(days=1)
    await session.commit()

    r = await client.post(f"{API}/sessions/next", headers=mundo["aa"])
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_con_el_mesociclo_terminado_es_409(client: AsyncClient, mundo: dict) -> None:
    for w in (1, 2):
        for d in (1, 2, 3):
            await _hacer(client, mundo, w, d)
    r = await client.post(f"{API}/sessions/next", headers=mundo["aa"])
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_un_coach_no_puede_abrir_sessions_next(client: AsyncClient, mundo: dict) -> None:
    r = await client.post(f"{API}/sessions/next", headers=mundo["ca"])
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_lo_que_abre_el_atleta_es_identico_a_lo_que_genera_el_coach(
    client: AsyncClient, admin: dict, mundo: dict
) -> None:
    """Dos atletas con el mismo bloque: uno por cada puerta, mismo resultado."""
    aa2, atleta2 = await _atleta(client, admin, mundo["ca"])
    meso2 = await _meso(
        client,
        mundo["ca"],
        atleta2["id"],
        {
            "daysPerWeek": 3,
            "days": [{"dayNumber": 1, "name": "Empuje"}, {"dayNumber": 3, "name": "Tirón"}],
            "exercises": [
                _ej(mundo["cats"]["Banca"], 1),
                _ej(mundo["cats"]["Fondos"], 1),
                _ej(mundo["cats"]["Prensa"], 2),
                _ej(mundo["cats"]["Sentadilla"], 2),
                _ej(mundo["cats"]["Remo"], 3),
            ],
        },
    )
    assert meso2.status_code == 201, meso2.text

    por_coach = (await _abrir(client, mundo, 1, 1)).json()
    por_atleta = (await client.post(f"{API}/sessions/next", headers=aa2)).json()

    def huella(s: dict) -> list:
        cabecera = [s["weekNumber"], s["dayNumber"], s["dayLabel"], s["isDeload"]]
        filas = [
            [
                e["name"],
                e["plannedLoadKg"],
                e["plannedSets"],
                e["restSeconds"],
                e["policyVersion"],
                e["why"],
                [(p["targetWeightKg"], p["targetReps"]) for p in e["sets"]],
            ]
            for e in s["exercises"]
        ]
        return [cabecera, filas]

    assert huella(por_atleta) == huella(por_coach)
    assert por_coach["exercises"][0]["plannedLoadKg"] == 60.0  # no es una comparacion de Nones


@pytest.mark.asyncio
async def test_la_semana_en_curso_es_la_del_ultimo_dia_completado(
    client: AsyncClient, mundo: dict
) -> None:
    """Se empieza la semana 2 sin haber hecho nada de la 1: lo de la 1 se abandona."""
    await _hacer(client, mundo, 2, 1)
    assert (await _toca(client, mundo))["next"] == _next(2, 2, None)
