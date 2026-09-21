"""grupo BASICOS en el catalogo de ejercicios

Los tres movimientos de competicion y sus variantes dejan de repartirse entre
pecho, cuadriceps y espalda y pasan a un grupo propio. El motivo esta en el
docstring de `MuscleGroup.BASICOS`: es como se programa fuerza, no como se
agrupa anatomia.

Aqui solo cambia el CHECK que limita `exercise_catalog.muscle`. No hay datos
que convertir: ninguna fila usa todavia el valor nuevo, y las que existen
siguen siendo validas. Los ejercicios nuevos los mete `scripts.seed_exercises`,
que es idempotente.

ESCRITO A MANO. Alembic no detecta un cambio en la LISTA de valores de un
CHECK: ve una restriccion con el mismo nombre en los dos lados y la da por
igual. Si esta migracion no existiera, la base seguiria rechazando 'BASICOS'
con un error de integridad en el primer INSERT del seed, ya desplegado.

Revision ID: a1c7d3e4b592
Revises: 9a1c36985ffd
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "a1c7d3e4b592"
down_revision: str | None = "9a1c36985ffd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: El nombre sin el prefijo. Dentro de `batch_alter_table` se pasa el token
#: pelado, porque la convencion de nombres ya le antepone `ck_<tabla>_`; fuera
#: haria falta `op.f(...)` con el nombre completo. Mezclarlos produce
#: `ck_exercise_catalog_ck_exercise_catalog_musculo_valido`.
TOKEN = "musculo_valido"

ANTES = (
    "muscle IN ('CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', "
    "'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'ABS')"
)
DESPUES = (
    "muscle IN ('BASICOS', 'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', "
    "'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'ABS')"
)


def upgrade() -> None:
    with op.batch_alter_table("exercise_catalog", schema=None) as batch_op:
        batch_op.drop_constraint(TOKEN, type_="check")
        batch_op.create_check_constraint(TOKEN, DESPUES)


def downgrade() -> None:
    # Al revertir, cualquier ejercicio en BASICOS violaria el CHECK viejo. Se
    # devuelven a pecho antes de restaurarlo: es el grupo del que salieron los
    # basicos de banca, y prefiero un ejercicio mal clasificado a una migracion
    # que no se puede revertir sin borrar datos del coach.
    op.execute("UPDATE exercise_catalog SET muscle = 'CHEST' WHERE muscle = 'BASICOS'")

    with op.batch_alter_table("exercise_catalog", schema=None) as batch_op:
        batch_op.drop_constraint(TOKEN, type_="check")
        batch_op.create_check_constraint(TOKEN, ANTES)
