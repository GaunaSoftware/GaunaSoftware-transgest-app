# Desplegar el modulo de Contabilidad

La contabilidad son DOS apps separadas del TMS:

- `transgest-accounting-api` (Node/Express)  -> se despliega en **Render**
- `transgest-accounting-frontend` (React CRA) -> se despliega en **Vercel**

El TMS abre la contabilidad por SSO: genera un token y redirige a la URL del
frontend contable. Hoy "Abrir Contabilidad" cae a `http://localhost:8080` porque
esas apps no estan publicadas y falta la variable `ACCOUNTING_FRONTEND_URL` en el
backend TMS. Sigue estos pasos una sola vez.

> Puedes usar **la misma base de datos Postgres del TMS**. La contabilidad vive en
> su propio esquema (`accounting`) y no toca las tablas del TMS.

---

## Paso 1 - Elegir dos secretos

Genera dos cadenas largas y aleatorias (por ejemplo con un gestor de contrasenas):

- `SECRETO_SSO`   -> se pone IGUAL en el TMS y en la api contable.
- `SECRETO_INGEST` -> se pone IGUAL en el TMS y en la api contable (para el push de facturas).

Guardalos; los usaras en los pasos 2 y 4.

---

## Paso 2 - Desplegar la API contable (Render)

1. Render -> New -> **Web Service** -> conecta este repositorio.
2. **Root Directory**: `transgest-bloque6-backend/transgest-accounting-api`
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. **Environment** (ver `.env.example` de esa carpeta):
   - `ACCOUNTING_SSO_JWT_SECRET` = `SECRETO_SSO`
   - `ACCOUNTING_JWT_SECRET`     = otro secreto largo (solo contabilidad)
   - `ACCOUNTING_INGEST_KEY`     = `SECRETO_INGEST`
   - `ACCOUNTING_CORS_ORIGINS`   = (la URL de Vercel del paso 3; puedes volver a rellenarla luego)
   - Base de datos (copia la conexion del Postgres del TMS en Render):
     `ACCOUNTING_DB_HOST`, `ACCOUNTING_DB_PORT`, `ACCOUNTING_DB_NAME`,
     `ACCOUNTING_DB_USER`, `ACCOUNTING_DB_PASSWORD`, `ACCOUNTING_DB_SSL=true`,
     `ACCOUNTING_DB_SCHEMA=accounting`
6. Deploy. Cuando este arriba, apunta su URL (ej. `https://transgest-accounting-api.onrender.com`).
7. **Migraciones** (una vez): en la pestana **Shell** del servicio en Render:
   ```
   npm run migrate
   ```
   Esto crea el esquema `accounting` con todas sus tablas (incluye 025-028: IBAN,
   mandatos SEPA, provincia de terceros y libro de IVA por factura).

---

## Paso 3 - Desplegar el frontend contable (Vercel)

1. Vercel -> Add New -> **Project** -> importa este repositorio.
2. **Root Directory**: `transgest-bloque6-backend/transgest-accounting-frontend`
3. El build ya esta fijado en `vercel.json` (`CI=false react-scripts build`).
4. **Environment Variables**:
   - `REACT_APP_ACCOUNTING_API_URL` = la URL de la api del paso 2
5. Deploy. Apunta su URL (ej. `https://transgest-contabilidad.vercel.app`).
6. Vuelve a Render (api contable) y pon esa URL en `ACCOUNTING_CORS_ORIGINS`.
   Guarda -> se redepliega.

---

## Paso 4 - Enlazar el backend TMS (Render, servicio que ya tienes)

En el servicio `transgest-backend` de Render, anade/edita estas variables:

- `ACCOUNTING_FRONTEND_URL` = la URL de Vercel del paso 3  **(la clave que faltaba)**
- `ACCOUNTING_SSO_JWT_SECRET` = `SECRETO_SSO`  (el mismo del paso 2)
- `ACCOUNTING_API_URL` = la URL de la api del paso 2      (para el push de facturas)
- `ACCOUNTING_INGEST_KEY` = `SECRETO_INGEST`               (para el push de facturas)

Guarda -> redeploy del backend TMS.

---

## Paso 5 - Probar

1. Entra en el TMS con un usuario con permiso de **contabilidad**.
2. Abre el modulo Contabilidad -> boton **Abrir Contabilidad**.
3. Debe abrir el frontend de Vercel ya logueado (canjea el token SSO en
   `/auth/sso/exchange`). Si da error de token: revisa que `ACCOUNTING_SSO_JWT_SECRET`
   es identico en el TMS y en la api. Si el navegador bloquea CORS: revisa que la URL
   de Vercel esta en `ACCOUNTING_CORS_ORIGINS` de la api.

El token SSO caduca a los 2 minutos: es normal, se genera uno nuevo cada vez.
