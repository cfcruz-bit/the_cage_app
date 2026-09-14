"""Biblioteca de ejercicios.

Leer lo puede cualquiera autenticado. Crear, solo un coach: el catalogo es
material de trabajo suyo, y dejar que cada atleta invente ejercicios llenaria
la tabla de duplicados en una semana.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select

from app.api.deps import ActiveUser, CoachUser, SessionDep
from app.api.dto import ExerciseCatalogIn, ExerciseCatalogOut
from app.models import ExerciseCatalog

router = APIRouter(prefix="/exercises", tags=["catalog"])


@router.get("", response_model=list[ExerciseCatalogOut])
async def list_exercises(user: ActiveUser, session: SessionDep) -> list[ExerciseCatalog]:
    """Los del sistema (created_by NULL) mas los propios de este usuario."""
    found = await session.execute(
        select(ExerciseCatalog)
        .where(
            or_(
                ExerciseCatalog.created_by_id.is_(None),
                ExerciseCatalog.created_by_id == user.id,
            )
        )
        .order_by(ExerciseCatalog.muscle, ExerciseCatalog.name)
    )
    return list(found.scalars())


@router.post("", response_model=ExerciseCatalogOut, status_code=status.HTTP_201_CREATED)
async def create_exercise(
    body: ExerciseCatalogIn, coach: CoachUser, session: SessionDep
) -> ExerciseCatalog:
    if body.rep_hi < body.rep_lo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El tope del rango de reps no puede ser menor que el suelo",
        )

    row = ExerciseCatalog(
        name=body.name,
        muscle=body.muscle.value,
        equipment=body.equipment,
        rep_lo=body.rep_lo,
        rep_hi=body.rep_hi,
        target_rir=body.target_rir,
        load_increment_kg=body.load_increment_kg,
        created_by_id=coach.id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
