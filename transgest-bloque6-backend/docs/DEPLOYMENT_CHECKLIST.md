# Checklist de despliegue profesional

## Antes de arrancar

- Copiar `transgest-backend/.env.example` a `transgest-backend/.env`.
- Configurar `JWT_SECRET` con una clave larga y aleatoria.
- Configurar `DB_*` con usuario propio de PostgreSQL.
- Configurar `CORS_ORIGINS` con los dominios reales.
- Configurar `PUBLIC_APP_URL` para enlaces de invitacion y colaborador.
- Configurar `PG_DUMP_BIN` si `pg_dump` no esta disponible en el PATH del servidor.
- Dejar `BACKUP_JSON_FALLBACK=true` solo como contingencia; en produccion se recomienda `pg_dump`.
- Revisar los avisos de entorno que imprime el backend al arrancar.
- Configurar SMTP si se van a enviar emails reales.
- Configurar Stripe solo en el entorno donde se vaya a cobrar.

## Comandos de despliegue

```powershell
cd transgest-backend
npm install
npm run migrate
npm run check
npm run check:env
npm run daily:ready
npm run audit:tenant
npm start
```

```powershell
cd transgest-frontend
npm install
npm run check
npm run audit:alerts
npm run audit:confirms
npm run audit:prompts
npm run build
```

## Comprobaciones despues de arrancar

```powershell
cd transgest-backend
npm run smoke
npm run functional
```

- `GET /health` debe responder `200`.
- `/api/v1/pedidos` sin token debe responder `401`.
- Un enlace publico de colaborador invalido debe responder `404`, no `401`.
- El frontend debe cargar sin pantalla blanca.
- `npm run check:env` debe terminar en `OK env`; si no hay `pg_dump`, el sistema debe indicar modo JSON de contingencia.
- `npm run daily:ready` debe terminar en `DAILY READY OK` antes de empezar uso real.
- `npm run functional` debe autenticar al gerente demo o al usuario definido en `FUNCTIONAL_USER`.

## Puntos que no deben quedar para produccion

- `CORS_ORIGINS` vacio si el backend esta publico.
- `JWT_SECRET` por defecto o corto.
- SMTP sin probar si se usan colaboradores, invitaciones o facturas por email.
- Backups sin probar. En produccion, evitar depender solo del fallback JSON.
- Stripe sin webhook validado.
- Logs sin conservar.

## Produccion app.gauna.es

- Frontend: Vercel (`https://app.gauna.es`). Debe desplegar `transgest-frontend/vercel.json` y conservar `REACT_APP_API_URL=https://transgest-backend.onrender.com`.
- API: Render (`https://transgest-backend.onrender.com`). Configurar `CORS_ORIGINS=https://app.gauna.es,https://gauna.es` y `PUBLIC_APP_URL=https://app.gauna.es`.
- Usar `DB_PASSWORD` de al menos 20 caracteres, `JWT_SECRET` aleatorio de al menos 32 caracteres y `ALLOW_DEMO_SEED=false`.
- Si se ejecuta `superadmin:ensure` en produccion, `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` deben estar definidos expresamente.
- Montar un disco persistente para `BACKUP_DIR`; ademas, replicar backups fuera de Render (S3/B2 u otro proveedor) y probar una restauracion periodicamente.

Comprobacion publica sin credenciales:

```powershell
$env:SECURITY_BASE_URL="https://app.gauna.es"
$env:SECURITY_API_URL="https://transgest-backend.onrender.com"
$env:SECURITY_ALLOWED_ORIGIN="https://app.gauna.es"
npm run security:check

$env:DEPLOY_BASE_URL="https://app.gauna.es"
$env:DEPLOY_API_URL="https://transgest-backend.onrender.com"
$env:DEPLOY_EXPECTED_RELEASE="<sha-del-commit>"
npm run deploy:smoke
```
