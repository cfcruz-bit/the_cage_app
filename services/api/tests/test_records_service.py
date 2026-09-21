"""`current_marks`, probado con las fechas controladas a mano.

Existe aparte del test de la API por un motivo concreto. El test de extremo a
extremo escribe dos marcas seguidas y `created_at` lo pone la base con
resolucion de SEGUNDO, asi que las dos caen en el mismo instante y el desempate
queda indefinido: ese test pasaba igual aunque se ordenara mal. Aqui las
marcas se insertan con `created_at` puesto a mano, y entonces si se distingue
ordenar por la fecha del test de ordenar por la de escritura.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ExerciseCatalog, OneRepMax, User
from app.services.records import current_mark, current_marks


async def _escenario(session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    atleta = User(
        email=f"{uuid.uuid4().hex}@thecage.ni",
        password_hash="x",
        display_name="Atleta",
        role="athlete",
    )
    ejercicio = ExerciseCatalog(
        name=f"Sentadilla {uuid.uuid4().hex[:6]}",
        muscle="BASICOS",
        equipment="Barra",
        rep_lo=1,
        rep_hi=5,
        target_rir=2,
        load_increment_kg=2.5,
    )
    session.add_all([atleta, ejercicio])
    await session.flush()
    return atleta.id, ejercicio.id


def _marca(
    atleta: uuid.UUID, ejercicio: uuid.UUID, kg: float, dia: str, escrita: str
) -> OneRepMax:
    return OneRepMax(
        athlete_id=atleta,
        exercise_id=ejercicio,
        value_kg=kg,
        achieved_on=date.fromisoformat(dia),
        source="test",
        created_at=datetime.fromisoformat(escrita).replace(tzinfo=UTC),
        updated_at=datetime.fromisoformat(escrita).replace(tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_manda_la_fecha_del_test_no_la_de_escritura(session: AsyncSession) -> None:
    """El caso real: el lunes apuntas la marca del sabado.

    La del sabado se ESCRIBE despues pero OCURRIO antes, asi que no debe
    desplazar a la del domingo. Si esto se ordenara por `created_at`, el atleta
    pasaria a entrenar con porcentajes de una marca vieja y nadie lo notaria
    hasta que la barra no subiera.
    """
    atleta, ejercicio = await _escenario(session)
    session.add_all(
        [
            # Ocurrio el domingo, se escribio el domingo.
            _marca(atleta, ejercicio, 180, "2026-09-13", "2026-09-13T20:00:00"),
            # Ocurrio el sabado, se escribio el lunes: la mas RECIENTE de
            # escritura, pero la mas VIEJA de las dos.
            _marca(atleta, ejercicio, 175, "2026-09-12", "2026-09-14T09:00:00"),
        ]
    )
    await session.flush()

    marca = await current_mark(session, atleta, ejercicio)
    assert marca is not None
    assert marca.value_kg == 180, "gano la escrita al final en vez de la mas reciente"
    assert marca.achieved_on == "2026-09-13"


@pytest.mark.asyncio
async def test_cada_ejercicio_tiene_su_propia_vigente(session: AsyncSession) -> None:
    """El mapa no puede mezclar ejercicios.

    Sin la clave por ejercicio, la marca de sentadilla acabaria mandando sobre
    los porcentajes de banca.
    """
    atleta, banca = await _escenario(session)
    sentadilla = ExerciseCatalog(
        name=f"Sentadilla lowbar {uuid.uuid4().hex[:6]}",
        muscle="BASICOS",
        equipment="Barra",
        rep_lo=1,
        rep_hi=5,
        target_rir=2,
        load_increment_kg=2.5,
    )
    session.add(sentadilla)
    await session.flush()

    session.add_all(
        [
            _marca(atleta, banca, 120, "2026-09-01", "2026-09-01T10:00:00"),
            _marca(atleta, banca, 125, "2026-09-15", "2026-09-15T10:00:00"),
            _marca(atleta, sentadilla.id, 200, "2026-09-02", "2026-09-02T10:00:00"),
        ]
    )
    await session.flush()

    marcas = await current_marks(session, atleta)
    assert marcas[banca].value_kg == 125
    assert marcas[sentadilla.id].value_kg == 200


@pytest.mark.asyncio
async def test_sin_marcas_no_se_inventa_ninguna(session: AsyncSession) -> None:
    """Un atleta nuevo no tiene 1RM, y eso es un dato, no un hueco que rellenar."""
    atleta, ejercicio = await _escenario(session)
    assert await current_mark(session, atleta, ejercicio) is None
    assert await current_marks(session, atleta) == {}


# ── De porcentaje a kilos ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "one_rm, percent, incremento, esperado",
    [
        # Redondo: el 75% de 140 son 105 clavados.
        (140, 75, 2.5, 105.0),
        # No redondo: 72% de 140 son 100.8, y eso no se monta en ninguna barra.
        (140, 72, 2.5, 100.0),
        # Con discos de 1.25 el mismo caso cae en otro sitio.
        (140, 72, 1.25, 101.25),
        # Supramaximal: existe y se programa (excentricas, walkouts).
        (200, 105, 2.5, 210.0),
        # Maquina de placas de 5: el redondeo es mucho mas basto.
        (100, 67, 5.0, 65.0),
    ],
)
def test_el_porcentaje_se_redondea_al_salto_real_del_gimnasio(
    one_rm: float, percent: float, incremento: float, esperado: float
) -> None:
    """Un peso prescrito que no se puede montar no es una prescripcion.

    Devolver el numero exacto seria correcto y practicamente inutil: el atleta
    tendria que redondear de cabeza en cada serie, y cada uno redondearia
    distinto. El redondeo lo hace el servidor, una vez y para todos.
    """
    from app.services.records import load_from_percent

    assert load_from_percent(one_rm, percent, incremento) == esperado


def test_la_vuelta_a_porcentaje_no_inventa_precision() -> None:
    """Para pintar "102.5 kg · 73%". Un decimal basta.

    Mas precision seria ruido: el propio peso ya viene redondeado al salto de
    la barra, asi que los decimales de mas describen el redondeo, no al atleta.
    """
    from app.services.records import percent_from_load

    assert percent_from_load(140, 105) == 75.0
    assert percent_from_load(140, 100) == 71.4
    # Sin marca no hay porcentaje que calcular, y dividir por cero seria un 500.
    assert percent_from_load(0, 100) == 0.0
