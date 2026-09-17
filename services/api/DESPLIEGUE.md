# Desplegar la API en Fly.io

Una sola vez de configuración, y después `fly deploy` cada vez que quieras
subir cambios.

> **Antes de empezar.** Este documento es el único de todo el repo que **no
> está verificado ejecutándose**. El resto del código se probó antes de
> entregarlo; esto no se puede, porque necesita una cuenta tuya y una tarjeta.
> Está escrito con cuidado y los comandos son los oficiales de Fly, pero
> asumí que algo va a fallar la primera vez: al final hay una sección con los
> tropiezos que espero.

## 1. Instalar Fly

```powershell
iwr https://fly.io/install.ps1 -useb | iex
fly auth signup   # o `fly auth login` si ya tienes cuenta
```

Pide tarjeta aunque no cobre: es su control anti-abuso.

## 2. Crear la app

Desde `services/api`:

```powershell
fly launch --no-deploy
```

Te preguntará cosas. **Responde que NO a todo lo que ofrezca crear**
(Postgres, Redis, desplegar ya): el `fly.toml` de este repo ya tiene la
configuración, y `--no-deploy` evita que suba nada antes de tiempo.

Si el nombre `the-cage-api` está ocupado, elige otro y cámbialo también en la
primera línea de `fly.toml`.

## 3. Crear la base de datos

```powershell
fly postgres create --name the-cage-db --region scl
fly postgres attach the-cage-db --app the-cage-api
```

`attach` inyecta `DATABASE_URL` en la app. Llega como `postgres://...`, que
SQLAlchemy resolvería al driver **síncrono** psycopg2 — que esta app no
instala. `app/core/config.py` lo reescribe a `postgresql+asyncpg://` al
arrancar, así que no tienes que tocar nada.

## 4. La clave de firma

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
fly secrets set JWT_SECRET="lo-que-imprimió"
```

**No lo saltes.** La app se niega a arrancar en producción con la clave de
ejemplo — precisamente para que este paso no se olvide.

## 5. Desplegar

```powershell
fly deploy
```

`fly.toml` corre `alembic upgrade head` **antes** de que entre tráfico a la
versión nueva. Si una migración falla, el despliegue se aborta y la versión
anterior sigue sirviendo. Es lo que evita que una migración rota tire el
gimnasio entero.

## 6. Sembrar el catálogo y crear el administrador

```powershell
fly ssh console --command "python -m scripts.seed_exercises"
fly ssh console --pty --command "python -m scripts.create_admin"
```

El segundo necesita `--pty` porque pide la contraseña por teclado.

## 7. Apuntar la app al servidor

En `apps/mobile/app.json`:

```json
"extra": { "apiUrl": "https://the-cage-api.fly.dev" }
```

Con `apiUrl` puesto, la detección automática de la IP local deja de aplicarse
— que es lo que queremos: en producción no hay Metro del que deducir nada.

El panel de administración queda en
`https://the-cage-api.fly.dev/admin`, ahora **sí sobre HTTPS**. Eso cierra el
aviso que te di cuando lo montamos: hasta hoy tu contraseña de admin viajaba
en claro por la red local.

## Después

```powershell
fly logs                  # en vivo
fly status                # estado de las máquinas
fly deploy                # subir cambios
fly ssh console --pty     # una shell dentro del contenedor
```

## Lo que espero que falle

**`fly launch` te ofrece crear Postgres.** Dile que no y usa el paso 3. El que
crea `launch` a veces queda sin `attach`, y entonces `DATABASE_URL` no existe
y el contenedor arranca contra SQLite — dentro de un disco que se borra en
cada despliegue. Los datos desaparecerían sin ningún error visible.

**El despliegue falla en `release_command`.** Es una migración que no corre en
Postgres. Lo más probable: algo que en SQLite pasó y en Postgres no.
`fly logs` te da el error exacto. La versión anterior sigue en pie mientras lo
arreglas.

**Sale 502 justo después de desplegar.** Dale treinta segundos: la máquina
está arrancando y el health check todavía no pasó.

**La app móvil dice "sin conexión" contra el servidor nuevo.** Comprueba que
`apiUrl` empieza por `https://` y **sin barra final**.

**El primer login tarda un segundo.** Es Argon2 haciendo su trabajo en una
máquina compartida. Es el precio de que una contraseña robada no se pueda
probar a lo bruto.

## Lo que NO está resuelto

- **Copias de seguridad.** Fly hace snapshots diarios de Postgres, pero nadie
  ha probado restaurar uno. Una copia que no se ha restaurado nunca no es una
  copia de seguridad; es una esperanza. Vale la pena hacer ese ensayo antes de
  tener clientes de verdad dentro.
- **Errores en producción.** Hoy solo están en `fly logs`, que se rotan. Sentry
  u otro agregador es el siguiente paso cuando haya gente usándolo.
- **Dominio propio.** `the-cage-api.fly.dev` funciona. Un `api.thecage.ni` se
  configura con `fly certs add`.
