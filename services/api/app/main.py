"""Punto de entrada de la API.

    uvicorn app.main:app --reload

La documentacion interactiva queda en /docs. En produccion se apaga: es un
mapa completo de la superficie de ataque y no le hace falta a nadie que no sea
del equipo.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.v1 import admin, auth, catalog, coach, mesocycles, sessions
from app.core.config import get_settings
from app.db.session import dispose_engine

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Cerrar el pool al apagar evita conexiones colgadas en Postgres tras un
    # redespliegue.
    await dispose_engine()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

API_V1 = "/api/v1"
for router in (
    admin.router,
    auth.router,
    coach.router,
    catalog.router,
    mesocycles.router,
    sessions.router,
):
    app.include_router(router, prefix=API_V1)


ADMIN_PAGE = Path(__file__).parent / "web" / "admin.html"


@app.get("/admin", include_in_schema=False)
async def admin_page() -> FileResponse:
    """El panel de administracion.

    Se sirve desde la propia API para que comparta origen: sin CORS, sin
    despliegue aparte y sin un dominio mas que mantener. La autorizacion no la
    da esta ruta —la pagina es publica— sino los endpoints /admin/*, que exigen
    un token de administrador.
    """
    return FileResponse(ADMIN_PAGE, media_type="text/html")


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Sonda para el balanceador. No toca la base a proposito: si respondiera
    500 cuando Postgres parpadea, el balanceador tiraria instancias sanas."""
    return {"status": "ok", "environment": settings.environment}
