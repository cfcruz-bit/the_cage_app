"""grupos ADUCTORES, ANTEBRAZO y CARDIO en el catalogo

Tres grupos nuevos, salidos de la libreta del coach:

- **ADUCTORES** y **ANTEBRAZO** son musculos que faltaban. Hasta ahora sus
  ejercicios no tenian donde ir: un Copenhagen acababa en gluteos y un death
  hang en biceps, que es justo donde nadie los busca.
- **CARDIO** no es un musculo, igual que BASICOS. Son los circuitos
  metabolicos (burpees, box jumps, thrusters). Van aparte porque el motor NO
  los autorregula: no progresan por carga sino por tiempo y densidad. Contarlos
  como volumen de un musculo haria que el conteo semanal sumara series que no
  son series.

Solo cambia el CHECK que limita `exercise_catalog.muscle`. No hay datos que
convertir: ninguna fila usa todavia los valores nuevos.

ESCRITO A MANO, como el de BASICOS: Alembic no detecta un cambio en la LISTA de
valores de un CHECK, ve el mismo nombre en los dos lados y lo da por igual.

Revision ID: f4a9c2b6e7d8
Revises: e5b2c8a7d1f3
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "f4a9c2b6e7d8"
down_revision: str | None = "e5b2c8a7d1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Sin prefijo: dentro de `batch_alter_table` la convencion ya antepone
#: `ck_<tabla>_`. Fuera haria falta `op.f(...)` con el nombre completo.
TOKEN = "musculo_valido"

ANTES = (
    "muscle IN ('BASICOS', 'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', "
    "'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'ABS')"
)
DESPUES = (
    "muscle IN ('BASICOS', 'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', "
    "'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'ABS', 'ADUCTORES', "
    "'ANTEBRAZO', 'CARDIO')"
)

#: A donde va cada grupo al revertir. Un ejercicio mal clasificado se arregla
#: en dos clics; una migracion que no se puede revertir sin borrar el trabajo
#: del coach, no. Los aductores caen en gluteos y el antebrazo en biceps
#: porque es lo mas cercano; el cardio no tiene equivalente y va a abdomen,
#: que es el grupo donde menos estorba.
AL_REVERTIR = {"ADUCTORES": "GLUTES", "ANTEBRAZO": "BICEPS", "CARDIO": "ABS"}


def upgrade() -> None:
    with op.batch_alter_table("exercise_catalog", schema=None) as batch_op:
        batch_op.drop_constraint(TOKEN, type_="check")
        batch_op.create_check_constraint(TOKEN, DESPUES)


def downgrade() -> None:
    for nuevo, viejo in AL_REVERTIR.items():
        op.execute(f"UPDATE exercise_catalog SET muscle = '{viejo}' WHERE muscle = '{nuevo}'")

    with op.batch_alter_table("exercise_catalog", schema=None) as batch_op:
        batch_op.drop_constraint(TOKEN, type_="check")
        batch_op.create_check_constraint(TOKEN, ANTES)
