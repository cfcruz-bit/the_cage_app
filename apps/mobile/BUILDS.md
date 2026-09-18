# Compilar la app

`eas.json` no admite comentarios, asi que las decisiones estan aqui.

## Perfiles

| Perfil | Qué produce | Para qué |
|---|---|---|
| `development` | APK con cliente de desarrollo | Depurar con Metro pero sin Expo Go, cuando hace falta codigo nativo que Expo Go no trae |
| `preview` | **APK instalable** | Lo que le pasas a un atleta para que lo instale a mano. Es el que usas hoy |
| `production` | AAB (Android App Bundle) | El unico formato que acepta Google Play. No se instala a mano |

## Por qué `preview` produce APK y no AAB

Un AAB no se instala en un telefono: es un paquete que Google Play abre para
generar el APK concreto de cada dispositivo. Para repartir la app a mano
—mandarsela a alguien por WhatsApp, instalarla tu mismo— hace falta un APK.
Por eso `preview` lleva `"buildType": "apk"` explicito.

## `appVersionSource: "remote"`

El numero de version de Android (`versionCode`) tiene que subir en cada envio a
Play, y llevarlo a mano en `app.json` termina en conflictos de git y en envios
rechazados. Con `remote`, lo lleva EAS.

## A que servidor apunta cada build

A ninguno que se decida aqui: lo decide `extra.apiUrl` de `app.json`, y en
cualquier build (dev o no) gana esa direccion, porque `__DEV__` es false fuera
de Metro. Hoy apunta a https://the-cage-api.fly.dev

## Compilar

    npx eas login
    npx eas init          # una sola vez: crea el proyecto y escribe extra.eas.projectId
    npx eas build --platform android --profile preview

Se compila en los servidores de Expo. Al terminar da un enlace de descarga y un
QR: abres ese enlace desde el telefono, Android pide permiso para instalar de
origen desconocido, y listo.

## Al actualizar la app

Vuelves a correr el mismo `eas build` y repartes el APK nuevo. No hay
actualizacion automatica salvo que montes EAS Update, que es otro tema.
