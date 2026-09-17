# Imagen de produccion de la API.
#
# Construccion en dos etapas: la primera instala las dependencias, la segunda
# se queda solo con lo instalado y el codigo. Asi el compilador de C que hacen
# falta asyncpg y argon2 no viaja a produccion — menos peso y menos superficie
# de ataque.

# ── Etapa 1: dependencias ────────────────────────────────────────────────────
FROM python:3.13-slim AS builder

# gcc y los headers de Python los necesitan asyncpg y argon2-cffi para compilar
# sus extensiones nativas. Se quedan en esta etapa.
RUN apt-get update \
    && apt-get install --no-install-recommends -y gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Se copia SOLO el manifiesto, con un paquete `app` vacio para que setuptools
# pueda construir. Mientras no cambien las dependencias, Docker reutiliza esta
# capa y el despliegue no vuelve a compilar asyncpg ni argon2.
COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir . \
    # Se desinstala el paquete, no las dependencias. El codigo real corre
    # desde /srv y no desde site-packages; dejar ahi el `app` vacio de esta
    # etapa seria un paquete fantasma capaz de tapar al de verdad segun desde
    # donde se arranque.
    && pip uninstall --yes cage-api

# ── Etapa 2: lo que corre ────────────────────────────────────────────────────
FROM python:3.13-slim AS runtime

# Un usuario sin privilegios. Si alguien consigue ejecutar codigo dentro del
# contenedor, que no sea root.
RUN useradd --create-home --uid 10001 cage

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv
COPY --chown=cage:cage app ./app
COPY --chown=cage:cage migrations ./migrations
COPY --chown=cage:cage scripts ./scripts
COPY --chown=cage:cage alembic.ini pyproject.toml ./

USER cage
EXPOSE 8000

# --forwarded-allow-ips: detras del proxy de Fly, sin esto uvicorn ve la IP del
# proxy en vez de la del cliente y construye las URLs como http en vez de https.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
