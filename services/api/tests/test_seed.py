"""El catalogo sembrado.

Un error de dedo en un nombre de musculo no se ve leyendo la lista, pero
revienta el INSERT contra el CHECK de la base. Estos tests lo cazan sin
levantar nada.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.schemas import MuscleGroup
from app.models import ExerciseCatalog
from scripts.seed_exercises import CATALOG


def test_los_musculos_existen_en_el_enum() -> None:
    valid = {m.value for m in MuscleGroup}
    malos = sorted({s.muscle for s in CATALOG} - valid)
    assert not malos, f"musculos que la base rechazara: {malos}"


def test_los_rangos_de_reps_son_coherentes() -> None:
    malos = [s.name for s in CATALOG if s.rep_hi < s.rep_lo or s.rep_lo < 1]
    assert not malos


def test_el_rir_esta_en_rango() -> None:
    malos = [s.name for s in CATALOG if not 0 <= s.target_rir <= 10]
    assert not malos


def test_los_incrementos_son_positivos() -> None:
    malos = [s.name for s in CATALOG if s.load_increment_kg <= 0]
    assert not malos


def test_no_hay_ejercicios_repetidos() -> None:
    """La clave de idempotencia del seed es (nombre, equipo)."""
    claves = [(s.name, s.equipment) for s in CATALOG]
    assert len(claves) == len(set(claves))


def test_hay_al_menos_un_ejercicio_por_musculo() -> None:
    """Un coach tiene que poder montar un plan de cuerpo completo."""
    cubiertos = {s.muscle for s in CATALOG}
    faltan = sorted({m.value for m in MuscleGroup} - cubiertos)
    assert not faltan, f"musculos sin ningun ejercicio: {faltan}"


@pytest.mark.asyncio
async def test_el_catalogo_entra_en_la_base_sin_violar_ningun_check(
    session: AsyncSession,
) -> None:
    """La prueba de verdad: que la base los acepte."""
    for item in CATALOG:
        session.add(
            ExerciseCatalog(
                name=item.name,
                muscle=item.muscle,
                equipment=item.equipment,
                rep_lo=item.rep_lo,
                rep_hi=item.rep_hi,
                target_rir=item.target_rir,
                load_increment_kg=item.load_increment_kg,
            )
        )
    await session.flush()

    count = await session.execute(select(ExerciseCatalog))
    assert len(list(count.scalars())) >= len(CATALOG)


# ── El grupo BASICOS ─────────────────────────────────────────────────────────


BASICOS_ESPERADOS = {
    "Press banca competicion",
    "Press banca tempo",
    "Press banca agarre medio",
    "Press banca agarre cerrado",
    "Press banca 5ct",
    "Press banca 3ct",
    "Press banca larsen",
    "Sentadilla lowbar",
    "Sentadilla highbar",
    "Sentadilla SSB",
    "Sentadilla tempo",
    "Peso muerto pausa",
}


def test_los_basicos_de_la_libreta_estan_todos() -> None:
    """La lista salio de la libreta del coach; que no se pierda ninguno."""
    sembrados = {s.name for s in CATALOG if s.muscle == MuscleGroup.BASICOS}
    faltan = sorted(BASICOS_ESPERADOS - sembrados)
    assert not faltan, f"basicos que faltan en el catalogo: {faltan}"


def test_los_basicos_son_todos_de_barra() -> None:
    """Un basico de competicion sin barra no es un basico.

    Si aparece uno con mancuerna o maquina, es que se clasifico mal: el sitio
    de esa variante es su musculo, no este grupo.
    """
    intrusos = [
        s.name for s in CATALOG if s.muscle == MuscleGroup.BASICOS and s.equipment != "Barra"
    ]
    assert not intrusos, f"basicos que no son de barra: {intrusos}"


def test_los_basicos_tienen_rangos_de_fuerza() -> None:
    """Rangos cortos: un basico programado a 15 repeticiones es un accesorio.

    El limite de 10 no es dogma, es una red: coge el error de haber copiado el
    rango de un accesorio al anadir una variante nueva.
    """
    largos = [
        f"{s.name} ({s.rep_lo}-{s.rep_hi})"
        for s in CATALOG
        if s.muscle == MuscleGroup.BASICOS and s.rep_hi > 10
    ]
    assert not largos, f"basicos con rango de accesorio: {largos}"


@pytest.mark.asyncio
async def test_la_base_acepta_basicos_y_rechaza_un_grupo_inventado(
    session: AsyncSession,
) -> None:
    """El CHECK de la migracion, comprobado contra la base de verdad.

    La primera mitad fallaria si faltara la migracion; la segunda, si alguien
    la escribiera sin la lista completa.
    """
    from sqlalchemy.exc import IntegrityError

    session.add(
        ExerciseCatalog(
            name="Sentadilla de prueba",
            muscle=MuscleGroup.BASICOS.value,
            equipment="Barra",
            rep_lo=1,
            rep_hi=5,
            target_rir=2,
            load_increment_kg=2.5,
        )
    )
    await session.flush()

    session.add(
        ExerciseCatalog(
            name="Ejercicio imposible",
            muscle="PECTORALES",
            equipment="Barra",
            rep_lo=1,
            rep_hi=5,
            target_rir=2,
            load_increment_kg=2.5,
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


# ── La segunda tanda: la libreta completa ────────────────────────────────────


def test_los_grupos_nuevos_tienen_ejercicios() -> None:
    """ADUCTORES, ANTEBRAZO y CARDIO no pueden quedarse vacios.

    Un grupo vacio en el selector es peor que no tenerlo: el coach lo abre,
    no hay nada y no sabe si es un fallo o es que no hay.
    """
    por_grupo = {s.muscle for s in CATALOG}
    for grupo in ("ADUCTORES", "ANTEBRAZO", "CARDIO"):
        assert grupo in por_grupo, f"{grupo} se quedo sin ejercicios"


def test_el_cardio_no_lleva_rangos_de_fuerza() -> None:
    """Los circuitos son densidad, no carga.

    Si alguien anade un thruster a 3 repeticiones es que lo esta tratando como
    un basico, y el conteo de volumen dejara de significar lo que dice.
    """
    cortos = [
        f"{s.name} ({s.rep_lo}-{s.rep_hi})"
        for s in CATALOG
        if s.muscle == "CARDIO" and s.rep_hi < 10
    ]
    assert not cortos, f"cardio con rango de fuerza: {cortos}"


def test_las_variantes_del_mismo_ejercicio_no_se_fusionaron() -> None:
    """Bulgara con mancuernas y en Smith son DOS ejercicios.

    Es una decision explicita del coach: cada una lleva su propio historial de
    cargas, y en una Smith se mueve mucho mas peso. Fusionarlas haria que el
    motor propusiera cargas imposibles al alternar entre ellas.
    """
    nombres = {s.name for s in CATALOG}
    for familia in ("Bulgara", "Farmer carry", "Jalon al pecho"):
        variantes = [n for n in nombres if n.startswith(familia)]
        assert len(variantes) >= 2, f"{familia} deberia tener variantes: {variantes}"


def test_ningun_ejercicio_repite_nombre_con_el_mismo_equipo() -> None:
    """Ya lo cubre el test de claves, pero con 215 filas el mensaje importa.

    Si dos filas comparten (nombre, equipo), el seed actualiza una y deja la
    otra huerfana, y el coach ve el mismo ejercicio dos veces sin saber cual
    es cual.
    """
    from collections import Counter

    repetidos = [k for k, c in Counter((s.name, s.equipment) for s in CATALOG).items() if c > 1]
    assert not repetidos, f"claves repetidas: {repetidos}"
