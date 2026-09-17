# Desplegar la API en Fly.io

Una sola vez de configuración, y después `fly deploy` cada vez que quieras
subir cambios.

> **Qué está verificado y qué no.** Todo lo que ocurre *dentro* del servidor se
> probó contra un PostgreSQL 16 de verdad, con `ENVIRONMENT=production`: las
> migraciones, el siembrado del catálogo, el alta del administrador, el login
> con Argon2, el corte por membresía vencida y la renovación. Lo que **no** se
> ha podido probar es lo que depende de Fly: la construcción de la imagen
> Docker y los comandos `fly`. El registro de Docker está bloqueado desde donde
> se escribió esto, así que la imagen nunca se construyó. Al final hay una
> sección con los tropiezos que espero.
>
> Esa prueba contra Postgres encontró dos fallos reales que SQLite ocultaba.
> Están corregidos y con tests; se cuentan al final del documento.

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

## Lo que la prueba contra Postgres encontró

Merece la pena contarlo, porque los dos fallos eran invisibles en desarrollo.

**El índice parcial que protege las prescripciones se iba a borrar solo.**
`uq_prescriptions_base` impide que un mismo ejercicio tenga dos prescripciones
base. Existía en la migración pero no estaba declarado en los modelos. En
SQLite no se nota, porque los índices parciales no se reflejan con su
condición y `migrations/env.py` los excluye de la comparación a propósito. En
Postgres sí se reflejan: `alembic check` lo encontraba en la base, no lo veía
en los modelos y proponía **borrarlo**. El día que alguien corriera
`--autogenerate` sin leer el diff, se habría llevado por delante la única
protección contra dos bases simultáneas. Ahora está en `__table_args__` y hay
un test que lo comprueba.

**Se podía crear un administrador incapaz de entrar.** `scripts/create_admin.py`
solo verificaba que el email tuviera una arroba; el endpoint de login valida
con `EmailStr`, que es más estricto y rechaza dominios reservados como
`.test` o `.local`. Un admin creado con uno de esos recibe `422` al intentar
entrar — y como el script se niega a crear un segundo administrador, la única
salida habría sido editar la base a mano desde una consola SSH. Ahora el
script usa el mismo validador que la API y avisa antes de escribir nada.

## Lo que NO está resuelto

- **Copias de seguridad.** Fly hace snapshots diarios de Postgres, pero nadie
  ha probado restaurar uno. Una copia que no se ha restaurado nunca no es una
  copia de seguridad; es una esperanza. Vale la pena hacer ese ensayo antes de
  tener clientes de verdad dentro.
- **Errores en producción.** Hoy solo están en `fly logs`, que se rotan. Sentry
  u otro agregador es el siguiente paso cuando haya gente usándolo.
- **Dominio propio.** `the-cage-api.fly.dev` funciona. Un `api.thecage.ni` se
  configura con `fly certs add`.
