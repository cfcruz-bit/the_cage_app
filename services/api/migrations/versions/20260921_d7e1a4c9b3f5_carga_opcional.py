"""ningun peso inventado: starting_load_kg y planned_load_kg pasan a opcionales

El producto ya no permite que la API rellene un peso que nadie dio. Los
accesorios se dejan de forzar con un arranque de 20 kg (`NewMesoSheet.tsx`,
bloque 4 del handoff); ahora se puede crear un ejercicio sin ninguna carga y
el motor no corre para el hasta que exista un peso real -de arranque, de una
sesion completada, o de una prescripcion por kilos o por porcentaje-.

Dos columnas pasan a NULL, con sus CHECK reescritos a mano (no los detecta un
--autogenerate sobre una columna existente):

- `mesocycle_exercises.starting_load_kg`
- `session_exercises.planned_load_kg`

El downgrade no puede dejar NULL en una columna que vuelve a NOT NULL, y
tampoco hay ningun peso real que inventar retroactivamente para esas filas.
Se rellenan con el `load_increment_kg` del ejercicio -el salto minimo montable,
el numero menos arbitrario disponible- antes de restaurar el NOT NULL: es
preferible un peso de arranque bajo y corregible a un downgrade que no corre.

Revision ID: d7e1a4c9b3f5
Revises: c2f6b0d4e8a1
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7e1a4c9b3f5"
down_revision: str | None = "c2f6b0d4e8a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("mesocycle_exercises", schema=None) as batch_op:
        batch_op.drop_constraint("carga_inicial_positiva", type_="check")
        batch_op.alter_column("starting_load_kg", existing_type=sa.Float(), nullable=True)
        batch_op.create_check_constraint(
            "carga_inicial_positiva", "starting_load_kg IS NULL OR starting_load_kg > 0"
        )

    with op.batch_alter_table("session_exercises", schema=None) as batch_op:
        batch_op.drop_constraint("carga_planificada", type_="check")
        batch_op.alter_column("planned_load_kg", existing_type=sa.Float(), nullable=True)
        batch_op.create_check_constraint(
            "carga_planificada", "planned_load_kg IS NULL OR planned_load_kg > 0"
        )


def downgrade() -> None:
    op.execute(
        "UPDATE mesocycle_exercises SET starting_load_kg = load_increment_kg "
        "WHERE starting_load_kg IS NULL"
    )
    op.execute(
        "UPDATE session_exercises SET planned_load_kg = ("
        "  SELECT load_increment_kg FROM mesocycle_exercises "
        "  WHERE mesocycle_exercises.id = session_exercises.mesocycle_exercise_id"
        ") WHERE planned_load_kg IS NULL"
    )

    with op.batch_alter_table("session_exercises", schema=None) as batch_op:
        batch_op.drop_constraint("carga_planificada", type_="check")
        batch_op.alter_column("planned_load_kg", existing_type=sa.Float(), nullable=False)
        batch_op.create_check_constraint("carga_planificada", "planned_load_kg > 0")

    with op.batch_alter_table("mesocycle_exercises", schema=None) as batch_op:
        batch_op.drop_constraint("carga_inicial_positiva", type_="check")
        batch_op.alter_column("starting_load_kg", existing_type=sa.Float(), nullable=False)
        batch_op.create_check_constraint("carga_inicial_positiva", "starting_load_kg > 0")
