"""top set y back-offs en los basicos

Anade el back-off a `prescriptions` (lo que pauta el coach, en kg o % del 1RM)
y a `session_exercises` (lo congelado al generar la sesion, ya en kilos).

Todos los CHECK van escritos a mano: Alembic no los detecta en columnas
anadidas a una tabla existente.

- `backoff_completo` / `backoff_congelado`: un back-off va entero (sets,
  reps y una carga) o no va. A medias no hay forma de pintar la serie.
- En `prescriptions` la carga es kg O porcentaje, igual que la del top.

Las columnas son NULL en todas las filas existentes, asi que ni la subida ni
la bajada necesitan tocar datos: bajar solo pierde los back-offs pautados.

Revision ID: b8d3f1a6c2e9
Revises: f4a9c2b6e7d8
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8d3f1a6c2e9"
down_revision: str | None = "f4a9c2b6e7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("prescriptions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("backoff_sets", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("backoff_reps", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("backoff_load_kg", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("backoff_load_percent", sa.Float(), nullable=True))
        batch_op.create_check_constraint(
            "backoff_completo",
            "(backoff_sets IS NULL AND backoff_reps IS NULL"
            " AND backoff_load_kg IS NULL AND backoff_load_percent IS NULL) OR "
            "(backoff_sets >= 1 AND backoff_reps >= 1"
            " AND (backoff_load_kg IS NULL) <> (backoff_load_percent IS NULL))",
        )
        batch_op.create_check_constraint(
            "backoff_carga_positiva", "backoff_load_kg IS NULL OR backoff_load_kg > 0"
        )
        batch_op.create_check_constraint(
            "backoff_pct_razonable",
            "backoff_load_percent IS NULL OR "
            "(backoff_load_percent >= 30 AND backoff_load_percent <= 110)",
        )

    with op.batch_alter_table("session_exercises", schema=None) as batch_op:
        batch_op.add_column(sa.Column("backoff_sets", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("backoff_reps", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("backoff_load_kg", sa.Float(), nullable=True))
        batch_op.create_check_constraint(
            "backoff_congelado",
            "(backoff_sets IS NULL AND backoff_reps IS NULL AND backoff_load_kg IS NULL) OR "
            "(backoff_sets >= 1 AND backoff_reps >= 1 AND backoff_load_kg > 0)",
        )


def downgrade() -> None:
    with op.batch_alter_table("session_exercises", schema=None) as batch_op:
        batch_op.drop_constraint("backoff_congelado", type_="check")
        batch_op.drop_column("backoff_load_kg")
        batch_op.drop_column("backoff_reps")
        batch_op.drop_column("backoff_sets")

    with op.batch_alter_table("prescriptions", schema=None) as batch_op:
        batch_op.drop_constraint("backoff_pct_razonable", type_="check")
        batch_op.drop_constraint("backoff_carga_positiva", type_="check")
        batch_op.drop_constraint("backoff_completo", type_="check")
        batch_op.drop_column("backoff_load_percent")
        batch_op.drop_column("backoff_load_kg")
        batch_op.drop_column("backoff_reps")
        batch_op.drop_column("backoff_sets")
