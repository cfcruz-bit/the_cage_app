"""Mesociclos y prescripciones.

Regla de producto que gobierna todo el archivo, dicha por el cliente: **el
atleta no puede anadir mesociclos ni cambiar su plan**. Puede leerlo y
ejecutarlo. Crear, editar y prescribir son del coach.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import (
    ActiveUser,
    CoachUser,
    SessionDep,
    coach_leads_athlete,
    readable_mesocycle,
    writable_mesocycle,
)
from app.api.dto import (
    MesocycleExerciseOut,
    MesocycleIn,
    MesocycleOut,
    MesocycleSummaryOut,
    PlanCellOut,
    PlanGridOut,
    PlanRowOut,
    PrescriptionIn,
    PrescriptionOut,
)
from app.domain.schemas import Aggressiveness, MuscleGroup
from app.models import (
    CoachAthlete,
    ExerciseCatalog,
    Mesocycle,
    MesocycleExercise,
    MesocycleStatus,
    Prescription,
    User,
    UserRole,
)
from app.services.planning import last_performance, project_grid, to_domain_exercise
from app.services.records import Mark, current_mark, current_marks

router = APIRouter(prefix="/mesocycles", tags=["mesocycles"])

ReadableMeso = Annotated[Mesocycle, Depends(readable_mesocycle)]
WritableMeso = Annotated[Mesocycle, Depends(writable_mesocycle)]


async def _load_full(session: SessionDep, meso_id: uuid.UUID) -> Mesocycle:
    """Recarga el mesociclo con todo lo que la respuesta necesita.

    `selectinload` en vez de acceso perezoso: en una sesion asincrona un lazy
    load fuera de contexto lanza MissingGreenlet, y con 20 ejercicios serian 40
    consultas (el problema N+1 de manual).
    """
    found = await session.execute(
        select(Mesocycle)
        .where(Mesocycle.id == meso_id)
        .options(
            selectinload(Mesocycle.exercises).selectinload(MesocycleExercise.catalog),
            selectinload(Mesocycle.exercises).selectinload(MesocycleExercise.prescriptions),
        )
    )
    return found.scalar_one()


def _to_prescription_out(
    mex_id: uuid.UUID, p: Prescription | None, mark: Mark | None
) -> PrescriptionOut | None:
    if p is None:
        return None
    return PrescriptionOut(
        mesocycle_exercise_id=mex_id,
        week_number=p.week_number,
        sets=p.sets,
        load_kg=p.load_kg,
        load_percent=p.load_percent,
        rep_lo=p.rep_lo,
        rep_hi=p.rep_hi,
        target_rir=p.target_rir,
        rest_seconds=p.rest_seconds,
        one_rm_kg=mark.value_kg if mark is not None else None,
        needs_one_rm=p.load_percent is not None and mark is None,
    )


async def _to_out(session: SessionDep, meso: Mesocycle) -> MesocycleOut:
    marks = await current_marks(session, meso.athlete_id)
    return MesocycleOut(
        id=meso.id,
        athlete_id=meso.athlete_id,
        coach_id=meso.coach_id,
        name=meso.name,
        total_weeks=meso.total_weeks,
        current_week_index=meso.current_week_index,
        aggressiveness=meso.aggressiveness,
        goal=meso.goal,
        status=meso.status,
        exercises=[
            MesocycleExerciseOut(
                id=mex.id,
                position=mex.position,
                name=mex.catalog.name,
                muscle=mex.catalog.muscle,
                equipment=mex.catalog.equipment,
                rep_lo=mex.rep_lo,
                rep_hi=mex.rep_hi,
                target_rir=mex.target_rir,
                load_increment_kg=mex.load_increment_kg,
                starting_load_kg=mex.starting_load_kg,
                starting_reps=mex.starting_reps,
                starting_sets=mex.starting_sets,
                prescription=_to_prescription_out(
                    mex.id, mex.base_prescription, marks.get(mex.catalog_id)
                ),
            )
            for mex in meso.exercises
        ],
    )


@router.post("", response_model=MesocycleOut, status_code=status.HTTP_201_CREATED)
async def create_mesocycle(
    body: MesocycleIn, coach: CoachUser, session: SessionDep
) -> MesocycleOut:
    if not await coach_leads_athlete(session, coach.id, body.athlete_id):
        # 404 y no 403: confirmar que ese atleta existe ya seria informacion.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese atleta no esta en tu cartera",
        )

    ids = {e.catalog_id for e in body.exercises}
    found = await session.execute(
        select(ExerciseCatalog.id, ExerciseCatalog.muscle, ExerciseCatalog.name).where(
            ExerciseCatalog.id.in_(ids)
        )
    )
    catalog = {row.id: (row.muscle, row.name) for row in found.all()}
    if set(catalog) != ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hay ejercicios que no existen en el catalogo",
        )

    meso = Mesocycle(
        athlete_id=body.athlete_id,
        coach_id=coach.id,
        name=body.name,
        total_weeks=body.total_weeks,
        current_week_index=0,
        aggressiveness=body.aggressiveness.value,
        goal=body.goal.value,
        status=MesocycleStatus.ACTIVE.value,
    )
    session.add(meso)
    await session.flush()

    for position, item in enumerate(body.exercises):
        if item.rep_hi < item.rep_lo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El tope del rango de reps no puede ser menor que el suelo",
            )

        week_numbers = [w.week_number for w in item.weeks]
        if len(set(week_numbers)) != len(week_numbers):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Hay semanas repetidas en la carga semana a semana de un ejercicio",
            )

        muscle, name = catalog[item.catalog_id]
        if muscle == MuscleGroup.BASICOS.value:
            con_carga = {
                w.week_number
                for w in item.weeks
                if w.load_kg is not None or w.load_percent is not None
            }
            faltantes = sorted(set(range(1, body.total_weeks + 1)) - con_carga)
            if faltantes:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=(
                        f"A {name} le falta la carga (kg o %) en la(s) semana(s) "
                        f"{', '.join(str(w) for w in faltantes)}"
                    ),
                )

        mex = MesocycleExercise(
            mesocycle_id=meso.id,
            catalog_id=item.catalog_id,
            position=position,
            rep_lo=item.rep_lo,
            rep_hi=item.rep_hi,
            target_rir=item.target_rir,
            load_increment_kg=item.load_increment_kg,
            starting_load_kg=item.starting_load_kg,
            starting_reps=item.starting_reps,
            starting_sets=item.starting_sets,
        )
        session.add(mex)
        await session.flush()

        for week in item.weeks:
            session.add(
                Prescription(
                    mesocycle_exercise_id=mex.id,
                    week_number=week.week_number,
                    sets=week.sets,
                    load_kg=week.load_kg,
                    load_percent=week.load_percent,
                    rep_lo=week.rep_lo,
                    rep_hi=week.rep_hi,
                    target_rir=week.target_rir,
                    set_by_id=coach.id,
                )
            )

    await session.commit()
    return await _to_out(session, await _load_full(session, meso.id))


@router.get("", response_model=list[MesocycleSummaryOut])
async def list_mesocycles(
    session: SessionDep,
    user: ActiveUser,
    # Ver la nota de `current_session`: sin el alias, `athleteId` llega None.
    athlete_id: Annotated[uuid.UUID | None, Query(alias="athleteId")] = None,
) -> list[MesocycleSummaryOut]:
    """Los mesociclos que este usuario puede ver.

    El atleta ve los suyos y solo los suyos; el filtro `athleteId` se ignora
    para el, porque si se respetara podria sondear la existencia de otros
    atletas comparando respuestas vacias.

    El coach ve los de su cartera. Si pide uno concreto que no lleva, la lista
    vuelve vacia en vez de dar 403: no hay nada que confirmarle.
    """
    counts = (
        select(
            MesocycleExercise.mesocycle_id.label("meso_id"),
            func.count(MesocycleExercise.id).label("n"),
        )
        .group_by(MesocycleExercise.mesocycle_id)
        .subquery()
    )

    query = (
        select(Mesocycle, User.display_name, func.coalesce(counts.c.n, 0))
        .join(User, User.id == Mesocycle.athlete_id)
        .outerjoin(counts, counts.c.meso_id == Mesocycle.id)
        .order_by(Mesocycle.created_at.desc())
    )

    if user.role == UserRole.ATHLETE:
        query = query.where(Mesocycle.athlete_id == user.id)
    else:
        mine = select(CoachAthlete.athlete_id).where(CoachAthlete.coach_id == user.id)
        query = query.where(Mesocycle.athlete_id.in_(mine))
        if athlete_id is not None:
            query = query.where(Mesocycle.athlete_id == athlete_id)

    found = await session.execute(query)
    return [
        MesocycleSummaryOut(
            id=meso.id,
            athlete_id=meso.athlete_id,
            athlete_name=athlete_name,
            name=meso.name,
            total_weeks=meso.total_weeks,
            current_week_index=meso.current_week_index,
            aggressiveness=meso.aggressiveness,
            goal=meso.goal,
            status=meso.status,
            exercise_count=int(count),
        )
        for meso, athlete_name, count in found.all()
    ]


@router.get("/{mesocycle_id}", response_model=MesocycleOut)
async def get_mesocycle(meso: ReadableMeso, session: SessionDep) -> MesocycleOut:
    return await _to_out(session, await _load_full(session, meso.id))


@router.get("/{mesocycle_id}/plan", response_model=PlanGridOut)
async def plan_grid(meso: ReadableMeso, session: SessionDep) -> PlanGridOut:
    """El bloque entero como tabla: ejercicios x semanas.

    Es lo que el coach edita celda a celda. Cada celda dice ademas si el numero
    lo puso el o lo calculo el motor, que es lo unico que le permite saber que
    esta a punto de pisar.
    """
    found = await session.execute(
        select(MesocycleExercise)
        .where(MesocycleExercise.mesocycle_id == meso.id)
        .order_by(MesocycleExercise.position)
        .options(
            selectinload(MesocycleExercise.catalog),
            selectinload(MesocycleExercise.prescriptions),
        )
    )
    aggressiveness = Aggressiveness(meso.aggressiveness)
    marks = await current_marks(session, meso.athlete_id)

    rows: list[PlanRowOut] = []
    for mex in found.scalars():
        last = await last_performance(session, mex)
        exercise = (
            to_domain_exercise(
                mex, last, mex.catalog.name, mex.catalog.muscle, mex.catalog.equipment
            )
            if last is not None
            else None
        )
        mark = marks.get(mex.catalog_id)
        cells = project_grid(
            exercise,
            mex,
            aggressiveness,
            meso.total_weeks,
            one_rm_kg=mark.value_kg if mark is not None else None,
        )

        rows.append(
            PlanRowOut(
                mesocycle_exercise_id=mex.id,
                name=mex.catalog.name,
                muscle=mex.catalog.muscle,
                equipment=mex.catalog.equipment,
                weeks=[PlanCellOut(**cell) for cell in cells],
            )
        )

    return PlanGridOut(
        mesocycle_id=meso.id,
        name=meso.name,
        goal=meso.goal,
        total_weeks=meso.total_weeks,
        current_week_index=meso.current_week_index,
        rows=rows,
    )


@router.put(
    "/{mesocycle_id}/exercises/{exercise_id}/prescription",
    response_model=PrescriptionOut,
)
async def set_prescription(
    exercise_id: uuid.UUID,
    body: PrescriptionIn,
    meso: WritableMeso,
    session: SessionDep,
    coach: CoachUser,
) -> PrescriptionOut:
    """Fija (o limpia) lo que manda el coach para un ejercicio.

    Sin `weekNumber` se toca la prescripcion BASE, que vale para todo el
    bloque. Con `weekNumber` se toca solo esa semana, sin pisar la base: es
    como el coach fuerza la semana 3 y deja que el motor siga decidiendo las
    otras cinco.

    Un campo a `null` devuelve ese aspecto al motor. Es como se vuelve a
    automatico sin borrar la fila entera, que perderia tambien el descanso.
    """
    if (body.rep_lo is None) != (body.rep_hi is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El rango de reps va entero o vacio",
        )
    if body.rep_lo is not None and body.rep_hi is not None and body.rep_hi < body.rep_lo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El tope del rango de reps no puede ser menor que el suelo",
        )

    found = await session.execute(
        select(MesocycleExercise)
        .where(
            MesocycleExercise.id == exercise_id,
            MesocycleExercise.mesocycle_id == meso.id,
        )
        .options(selectinload(MesocycleExercise.prescriptions))
    )
    mex = found.scalar_one_or_none()
    if mex is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese ejercicio no esta en este mesociclo",
        )

    if body.week_number is not None and body.week_number > meso.total_weeks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esa semana esta fuera del mesociclo",
        )

    existing = (
        mex.base_prescription
        if body.week_number is None
        else mex.prescription_for(body.week_number)
    )
    p = existing or Prescription(mesocycle_exercise_id=mex.id, week_number=body.week_number)
    p.sets = body.sets
    p.load_kg = body.load_kg
    p.load_percent = body.load_percent
    p.rep_lo = body.rep_lo
    p.rep_hi = body.rep_hi
    p.target_rir = body.target_rir
    p.rest_seconds = body.rest_seconds
    p.set_by_id = coach.id
    session.add(p)

    await session.commit()
    mark = await current_mark(session, meso.athlete_id, mex.catalog_id)
    out = _to_prescription_out(mex.id, p, mark)
    assert out is not None
    return out
