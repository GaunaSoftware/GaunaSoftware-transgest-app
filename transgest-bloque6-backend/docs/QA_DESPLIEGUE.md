# QA de despliegue TransGest

Objetivo: detectar rapido si el programa queda inaccesible, si Nginx no sirve la app, si el proxy no llega al API o si los flujos autenticados basicos han roto.

## Checklist corto

1. Compilar frontend:
   `cd transgest-frontend && npm run build`

2. Validar backend:
   `cd transgest-backend && npm run check`

3. Revisar aislamiento multiempresa si se quiere ejecutarlo por separado:
   `cd transgest-backend && npm run audit:tenant:strict`

4. Levantar despliegue:
   `cd transgest-backend && docker compose up -d --build`

5. Confirmar contenedores:
   `docker compose ps`

6. Smoke publico:
   `npm run deploy:smoke`

7. Checklist de arranque diario:
   `npm run daily:ready`

8. QA funcional autenticado por proxy:
   `FUNCTIONAL_BASE_URL=http://localhost npm run functional`

Tambien se puede ejecutar todo lo publico con un solo comando:

`npm run qa:deploy`

En PowerShell:

```powershell
$env:FUNCTIONAL_BASE_URL='http://localhost'
npm run functional
Remove-Item Env:\FUNCTIONAL_BASE_URL
```

## Que cubre ahora

- `/health` publico responde y confirma base de datos conectada.
- La SPA React se sirve desde `http://localhost`.
- El proxy `/api/v1` responde con proteccion de autenticacion esperada.
- Auditoria estatica de aislamiento multiempresa en rutas sensibles (`pedidos`, `facturas`, `clientes`, `vehiculos`, `choferes`, `colaboradores`, documentos y tablas operativas).
- Login demo de gerente.
- Lectura basica de usuario actual, pedidos, alertas de vehiculos, documentos, facturas, taller y backup.
- Fronteras basicas de permisos: API protegida sin token debe devolver 401 y rutas exclusivas de portal cliente deben devolver 403 a un gerente, nunca 500.
- Rutas internas adicionales: solicitudes de portal cliente, colaboradores pendientes de revision y agenda.

## Si falla

- Si falla `health publico`, revisar `docker compose logs --tail=80 api` y conexion PostgreSQL.
- Si falla `frontend publico`, revisar `docker compose logs --tail=80 frontend` y build de React.
- Si falla `api protegida via proxy`, revisar `transgest-frontend/nginx-frontend.conf`.
- Si falla `daily:ready`, no empezar uso operativo hasta revisar health, API protegida y frontend servido.
- Si falla `functional` o `qa:deploy`, revisar primero el mensaje exacto y el `request_id` en logs de API.
