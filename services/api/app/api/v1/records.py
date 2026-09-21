"""Marcas de fuerza (1RM) de un atleta.

Quien puede que:

- **El coach que lo lleva**: leer, registrar y borrar.
- **El admin**: leer, registrar y borrar, de cualquiera.
- **El atleta**: leer las suyas. No escribir. Es la misma regla que rige todo
  lo demas en esta API: el atleta reporta lo que hizo, no pauta lo que hara, y
  su marca es el numero del que salen todos sus pesos del bloque.
- **Cualquier otro**: 404. Ni siquiera confirmamos que el atleta exista.

Un apunte sobre el borrado: borrar una marca NO reescribe los mesociclos ya
programados con ella, porque los pesos se resuelven al leer contra la marca
vigente de ese momento. Borrar la vigente hace que mande la anterior, que es
exactamente lo que se espera al deshacer un dedazo.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import (
    NO_ENCONTRADO,
    ActiveUser,
    SessionDep,
    coach_leads_athlete,
)
from app.api.dto import OneRepMaxIn, OneRepMaxOut
from app.models import ExerciseCatalog, OneRepMax, User, UserRole
from app.services.records import current_marks

router = APIRouter(prefix="/athletes", tags=["marcas"])

SOLO_LECTURA = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Un atleta no registra sus propias marcas",
)


async def _readable_athlete(session: SessionDep, user: User, athlete_id: uuid.UUID) -> User:
    """El atleta, si este usuario tiene derecho a ver sus marcas.

    404 y no 403 para lo ajeno: un 403 confirmaria que ese atleta existe.
    """
    if user.role == UserRole.ATHLETE:
        if user.id != athlete_id:
            raise NO_ENCONTRADO
        return user

    athlete = await session.get(User, athlete_id)
    if athlete is None or athlete.role != UserRole.ATHLETE:
        raise NO_ENCONTRADO

    if user.role == UserRole.ADMIN:
        return athlete
    if not await coach_leads_athlete(session, user.id, athlete_id):
        raise NO_ENCONTRADO
    return athlete


async def _writable_athlete(session: SessionDep, user: User, athlete_id: uuid.UUID) -> User:
    """Igual, pero para escribir. El atleta recibe 403, no 404.

    Sabe perfectamente que existe —es el mismo—, asi que ocultarselo no
    protegeria nada y solo confundiria.
    """
    if user.role == UserRole.ATHLETE:
        raise SOLO_LECTURA if user.id == athlete_id else NO_ENCONTRADO
    return await _readable_athlete(session, user, athlete_id)


def _to_out(row: OneRepMax, catalog: ExerciseCatalog, current: bool) -> OneRepMaxOut:
    return OneRepMaxOut(
        id=row.id,
        exercise_id=row.exercise_id,
        exercise_name=catalog.name,
        muscle=catalog.muscle,
        value_kg=row.value_kg,
        achieved_on=row.achieved_on,
        source=row.source,
        note=row.note,
        current=current,
    )


@router.get("/{athlete_id}/records", response_model=list[OneRepMaxOut])
async def list_records(
    athlete_id: uuid.UUID,
    session: SessionDep,
    user: ActiveUser,
    # El alias va explicito. El `alias_generator` de los DTO convierte a
    # camelCase el CUERPO de la peticion, no los parametros de query: sin esto
    # `?onlyCurrent=false` se ignora en silencio y siempre salen las vigentes.
    # Es el mismo fallo que ya se colo una vez con `?athleteId=`.
    only_current: Annotated[bool, Query(alias="onlyCurrent")] = True,
) -> list[OneRepMaxOut]:
    """Las marcas del atleta.

    Por defecto solo las vigentes —una por ejercicio—, que es lo que necesita
    la pantalla de programar. Con `onlyCurrent=false` sale el historial
    completo, que es lo que necesita la de ver progresion.
    """
    await _readable_athlete(session, user, athlete_id)

    rows = (
        (
            await session.execute(
                select(OneRepMax, ExerciseCatalog)
                .join(ExerciseCatalog, ExerciseCatalog.id == OneRepMax.exercise_id)
                .where(OneRepMax.athlete_id == athlete_id)
                .order_by(OneRepMax.achieved_on.desc(), OneRepMax.created_at.desc())
            )
        )
        .tuples()
        .all()
    )

    vigentes = await current_marks(session, athlete_id)
    salida: list[OneRepMaxOut] = []
    for row, catalog in rows:
        marca = vigentes.get(row.exercise_id)
        es_vigente = marca is not None and (
            marca.value_kg == row.value_kg and marca.achieved_on == row.achieved_on.isoformat()
        )
        if only_current and not es_vigente:
            continue
        salida.append(_to_out(row, catalog, es_vigente))
    return salida


@router.post(
    "/{athlete_id}/records",
    response_model=OneRepMaxOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_record(
    athlete_id: uuid.UUID,
    body: OneRepMaxIn,
    session: SessionDep,
    user: ActiveUser,
) -> OneRepMaxOut:
    """Registra una marca.

    Si ya hay una de ese ejercicio ese MISMO dia, se sobrescribe en vez de
    fallar contra el UNIQUE: repetir la fecha es corregir un numero mal
    escrito, no registrar un segundo test.
    """
    await _writable_athlete(session, user, athlete_id)

    catalog = await session.get(ExerciseCatalog, body.exercise_id)
    if catalog is None:
        raise NO_ENCONTRADO

    existente = await session.execute(
        select(OneRepMax).where(
            OneRepMax.athlete_id == athlete_id,
            OneRepMax.exercise_id == body.exercise_id,
            OneRepMax.achieved_on == body.achieved_on,
        )
    )
    row = existente.scalar_one_or_none()

    if row is None:
        row = OneRepMax(
            athlete_id=athlete_id,
            exercise_id=body.exercise_id,
            value_kg=body.value_kg,
            achieved_on=body.achieved_on,
            source=body.source,
            note=body.note,
            set_by_id=user.id,
        )
        session.add(row)
    else:
        row.value_kg = body.value_kg
        row.source = body.source
        row.note = body.note
        row.set_by_id = user.id

    await session.flush()
    await session.commit()

    vigentes = await current_marks(session, athlete_id)
    marca = vigentes.get(body.exercise_id)
    es_vigente = marca is not None and marca.achieved_on == body.achieved_on.isoformat()
    return _to_out(row, catalog, es_vigente)


@router.delete(
    "/{athlete_id}/records/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_record(
    athlete_id: uuid.UUID,
    record_id: uuid.UUID,
    session: SessionDep,
    user: ActiveUser,
) -> None:
    await _writable_athlete(session, user, athlete_id)

    row = await session.get(OneRepMax, record_id)
    # La comprobacion del atleta no es redundante: sin ella, un coach podria
    # borrar la marca de un atleta ajeno pasando el id de uno suyo en la ruta.
    if row is None or row.athlete_id != athlete_id:
        raise NO_ENCONTRADO

    await session.delete(row)
    await session.commit()
