"""Mesociclos y prescripciones.

Regla de producto que gobierna todo el archivo, dicha por el cliente: **el
atleta no puede anadir mesociclos ni cambiar su plan**. Puede leerlo y
ejecutarlo. Crear, editar y prescribir son del coach.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import (
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
    PrescriptionIn,
    PrescriptionOut,
)
from app.models import (
    ExerciseCatalog,
    Mesocycle,
    MesocycleExercise,
    MesocycleStatus,
    Prescription,
)

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
            selectinload(Mesocycle.exercises).selectinload(MesocycleExercise.prescription),
        )
    )
    return found.scalar_one()


def _to_out(meso: Mesocycle) -> MesocycleOut:
    return MesocycleOut(
        id=meso.id,
        athlete_id=meso.athlete_id,
        coach_id=meso.coach_id,
        name=meso.name,
        total_weeks=meso.total_weeks,
        current_week_index=meso.current_week_index,
        aggressiveness=meso.aggressiveness,
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
                prescription=(
                    PrescriptionOut(
                        mesocycle_exercise_id=mex.id,
                        sets=mex.prescription.sets,
                        load_kg=mex.prescription.load_kg,
                        rep_lo=mex.prescription.rep_lo,
                        rep_hi=mex.prescription.rep_hi,
                        target_rir=mex.prescription.target_rir,
                        rest_seconds=mex.prescription.rest_seconds,
                    )
                    if mex.prescription is not None
                    else None
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
    found = await session.execute(select(ExerciseCatalog.id).where(ExerciseCatalog.id.in_(ids)))
    known = set(found.scalars())
    if known != ids:
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
        session.add(
            MesocycleExercise(
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
        )

    await session.commit()
    return _to_out(await _load_full(session, meso.id))


@router.get("/{mesocycle_id}", response_model=MesocycleOut)
async def get_mesocycle(meso: ReadableMeso, session: SessionDep) -> MesocycleOut:
    return _to_out(await _load_full(session, meso.id))


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

    Un campo a `null` devuelve ese aspecto al motor. Es como el coach vuelve a
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
        .options(selectinload(MesocycleExercise.prescription))
    )
    mex = found.scalar_one_or_none()
    if mex is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese ejercicio no esta en este mesociclo",
        )

    p = mex.prescription or Prescription(mesocycle_exercise_id=mex.id)
    p.sets = body.sets
    p.load_kg = body.load_kg
    p.rep_lo = body.rep_lo
    p.rep_hi = body.rep_hi
    p.target_rir = body.target_rir
    p.rest_seconds = body.rest_seconds
    p.set_by_id = coach.id
    session.add(p)

    await session.commit()
    return PrescriptionOut(
        mesocycle_exercise_id=mex.id,
        sets=p.sets,
        load_kg=p.load_kg,
        rep_lo=p.rep_lo,
        rep_hi=p.rep_hi,
        target_rir=p.target_rir,
        rest_seconds=p.rest_seconds,
    )
