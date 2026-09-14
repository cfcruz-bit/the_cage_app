"""Quien tiene acceso, hasta cuando, y cuando avisar.

La regla de negocio, en una frase: **un atleta entra mientras hoy caiga dentro
de un periodo pagado.** Los coaches y el admin no caducan.

Las fechas son inclusivas por los dos extremos. El ultimo dia pagado cuenta
entero: nadie pierde el entrenamiento del dia que vence por una comparacion
estricta, y explicar "tu mes termina el 30" es mas facil que "termina el 30 a
las 00:00".

Todo lo que decide se calcula sobre `date.today()`, no sobre datetimes con zona
horaria. Un mes de gimnasio es una unidad de calendario, no de reloj.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Membership, User, UserRole

#: Con cuantos dias de antelacion se avisa al atleta de que le toca pagar.
WARN_DAYS_BEFORE: int = 5

#: Lo que ve el atleta cuando se le venció. Es texto de producto: si lo cambias,
#: cambialo tambien en la app.
EXPIRED_MESSAGE = "Necesita renovar su pago"


@dataclass(frozen=True)
class AccessStatus:
    """Estado de acceso de un usuario, resuelto para HOY."""

    allowed: bool
    #: Ultimo dia pagado. None si nunca pago o si el rol no caduca.
    ends_on: date | None
    #: Dias que quedan, incluido hoy. None si no aplica. Negativo si vencio.
    days_left: int | None
    #: True cuando toca enseñarle el aviso de renovacion.
    warn: bool

    @property
    def reason(self) -> str | None:
        return None if self.allowed else EXPIRED_MESSAGE


#: Los roles que no caducan: son personal del gimnasio, no clientes.
NEVER_EXPIRES = frozenset({UserRole.ADMIN.value, UserRole.COACH.value})


async def current_period_end(
    session: AsyncSession, athlete_id: uuid.UUID, today: date | None = None
) -> date | None:
    """Hasta cuando llega el acceso CONTINUO que empieza hoy.

    No es "el periodo que contiene hoy": es la cadena entera. Quien renueva
    antes de que se le acabe el mes tiene dos periodos encadenados, y lo que
    quiere ver —y lo que hay que cobrarle desde— es el final del segundo.

    Se encadenan los periodos que se solapan o que son consecutivos. Un hueco
    de un solo dia corta la cadena: ese dia no esta pagado, y la cadena tiene
    que reflejar solo dias con acceso real.

    Devuelve None si hoy no cae en ningun periodo. Un atleta que pago enero y
    vuelve en marzo tiene historial, pero no acceso.
    """
    reference = today or date.today()

    found = await session.execute(
        select(Membership.starts_on, Membership.ends_on)
        .where(
            Membership.athlete_id == athlete_id,
            Membership.ends_on >= reference,
        )
        .order_by(Membership.starts_on)
    )
    periods = found.all()

    covered: date | None = None
    for starts_on, ends_on in periods:
        if covered is None:
            # Todavia no hay cadena: solo arranca un periodo que cubra hoy.
            if starts_on <= reference:
                covered = ends_on
            else:
                break
        elif starts_on <= covered + timedelta(days=1):
            covered = max(covered, ends_on)
        else:
            # Hueco: lo que venga despues es otro bloque, no esta cadena.
            break

    return covered


async def last_period_end(session: AsyncSession, athlete_id: uuid.UUID) -> date | None:
    """El final del ultimo periodo que tuvo, vigente o no.

    Sirve para decirle "tu acceso vencio el 12 de marzo" en vez de un escueto
    "sin acceso".
    """
    found = await session.execute(
        select(Membership.ends_on)
        .where(Membership.athlete_id == athlete_id)
        .order_by(Membership.ends_on.desc())
        .limit(1)
    )
    return found.scalar_one_or_none()


async def access_status(
    session: AsyncSession, user: User, today: date | None = None
) -> AccessStatus:
    """Si este usuario puede entrar hoy, y que avisarle."""
    if user.role in NEVER_EXPIRES:
        return AccessStatus(allowed=True, ends_on=None, days_left=None, warn=False)

    reference = today or date.today()
    ends_on = await current_period_end(session, user.id, reference)

    if ends_on is None:
        return AccessStatus(
            allowed=False,
            ends_on=await last_period_end(session, user.id),
            days_left=None,
            warn=False,
        )

    # +1 porque el ultimo dia cuenta entero: si vence hoy, le queda 1 dia.
    days_left = (ends_on - reference).days + 1
    return AccessStatus(
        allowed=True,
        ends_on=ends_on,
        days_left=days_left,
        warn=days_left <= WARN_DAYS_BEFORE,
    )


async def grant(
    session: AsyncSession,
    athlete_id: uuid.UUID,
    *,
    months: int,
    created_by_id: uuid.UUID | None,
    note: str = "",
    today: date | None = None,
) -> Membership:
    """Registra un pago de `months` meses.

    Si el atleta todavia tiene periodo vigente, el nuevo empieza al dia
    siguiente de que termine el actual: pagar antes de tiempo SUMA dias en vez
    de tirarlos. Si ya vencio, empieza hoy.
    """
    reference = today or date.today()
    vigente = await current_period_end(session, athlete_id, reference)

    starts_on = vigente + timedelta(days=1) if vigente is not None else reference
    ends_on = add_months(starts_on, months) - timedelta(days=1)

    row = Membership(
        athlete_id=athlete_id,
        starts_on=starts_on,
        ends_on=ends_on,
        created_by_id=created_by_id,
        note=note,
    )
    session.add(row)
    return row


def add_months(start: date, months: int) -> date:
    """Suma meses de calendario, recortando al ultimo dia valido.

    El 31 de enero mas un mes es el 28 de febrero, no el 3 de marzo. `timedelta`
    no sabe de meses y usar 30 dias haria que un cliente de enero pagara mas
    dias que uno de febrero.
    """
    if months < 1:
        raise ValueError("months debe ser >= 1")

    total = start.month - 1 + months
    year = start.year + total // 12
    month = total % 12 + 1
    day = min(start.day, _days_in_month(year, month))
    return date(year, month, day)


def _days_in_month(year: int, month: int) -> int:
    import calendar

    return calendar.monthrange(year, month)[1]
