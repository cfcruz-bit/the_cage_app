"""carga por porcentaje del 1RM en las prescripciones

Anade `prescriptions.load_percent`: el coach puede fijar la carga de una
semana como % del 1RM vigente del atleta en vez de kilos fijos, y el servidor
la resuelve contra `one_rep_maxes` (bloque 2).

Dos CHECK escritos a mano, porque Alembic no los detecta en una columna
anadida a una tabla existente:

- `pct_razonable`: el mismo rango que ya validaba `app/services/records.py`
  para no volver a montar el limite en dos sitios que puedan discrepar.
- `carga_o_porcentaje`: kilos y porcentaje nunca conviven en la misma fila,
  o no habria forma de saber cual manda al resolver.

Revision ID: c2f6b0d4e8a1
Revises: 939441e39196
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c2f6b0d4e8a1"
down_revision: str | None = "939441e39196"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("prescriptions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("load_percent", sa.Float(), nullable=True))
        batch_op.create_check_constraint(
            "pct_razonable",
            "load_percent IS NULL OR (load_percent >= 30 AND load_percent <= 110)",
        )
        batch_op.create_check_constraint(
            "carga_o_porcentaje", "load_kg IS NULL OR load_percent IS NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("prescriptions", schema=None) as batch_op:
        batch_op.drop_constraint("carga_o_porcentaje", type_="check")
        batch_op.drop_constraint("pct_razonable", type_="check")
        batch_op.drop_column("load_percent")
