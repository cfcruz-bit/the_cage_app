"""semana en curso segun las sesiones abiertas

`current_week_index` se fijaba en 0 al crear el mesociclo y nada lo movia, asi
que todo bloque decia "semana 1" aunque fuera por la cuarta. Desde ahora lo
avanza la generacion de sesiones; esto corrige los bloques que ya existen con
la semana mas alta que tienen abierta.

Solo toca datos. Bajar no deshace nada: el valor anterior era el error.

Revision ID: c5e2a7d9f1b3
Revises: b8d3f1a6c2e9
Create Date: 2026-10-19
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "c5e2a7d9f1b3"
down_revision: str | None = "b8d3f1a6c2e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE mesocycles
        SET current_week_index = (
            SELECT MAX(t.week_number) - 1
            FROM training_sessions t
            WHERE t.mesocycle_id = mesocycles.id
        )
        WHERE EXISTS (
            SELECT 1 FROM training_sessions t WHERE t.mesocycle_id = mesocycles.id
        )
        """
    )


def downgrade() -> None:
    pass
