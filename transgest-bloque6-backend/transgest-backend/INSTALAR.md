# TransGest TMS Pro — Guía de instalación

## Requisitos
- Docker Desktop instalado y corriendo
- Puerto 80 libre
- 2 GB RAM mínimo

---

## Instalación nueva (primer cliente)

### Paso 1 — Descargar y preparar
```
# Coloca las carpetas así:
transgest/
  ├── transgest-backend/
  └── transgest-frontend/
```

### Paso 2 — Configurar variables de entorno
Edita `transgest-backend/.env`:
```
DB_HOST=postgres
DB_PORT=5432
DB_NAME=transgest
DB_USER=transgest_user
DB_PASS=transgest_pass_2025
JWT_SECRET=cambia_esto_por_algo_muy_seguro_32chars
JWT_EXPIRES_IN=8h
PORT=3001
```

### Paso 3 — Arrancar la base de datos
```cmd
cd transgest-backend
docker-compose up -d postgres
```
Espera 10 segundos a que arranque.

### Paso 4 — Crear la estructura de BD
```cmd
docker cp scripts\install_completo.sql transgest_db:/tmp/install.sql
docker-compose exec postgres psql -U transgest_user -d transgest -f /tmp/install.sql
```
Debe mostrar: `TransGest instalado correctamente`

### Paso 5 — Crear el superadmin
```cmd
docker-compose up -d api
docker-compose exec api node scripts/crear_superadmin.js
```
Te pedirá email y contraseña. Guárdalos bien.

### Paso 6 — Arrancar todo
```cmd
docker-compose up -d
```

### Paso 7 — Verificar
Abre http://localhost y entra con `gerente@empresa.com` / `demo1234`

---

## Actualización de instalación existente

Si ya tienes TransGest instalado y quieres actualizar:

```cmd
# 1. Para los contenedores
docker-compose down

# 2. Extrae los nuevos archivos sobre las carpetas existentes

# 3. Ejecuta el script de instalación (es seguro en BD existente)
docker cp scripts\install_completo.sql transgest_db:/tmp/install.sql
docker-compose up -d postgres
docker-compose exec postgres psql -U transgest_user -d transgest -f /tmp/install.sql

# 4. Reconstruye y arranca
docker-compose build --no-cache api
docker-compose build --no-cache frontend
docker-compose up -d
```

---

## Para cada nuevo cliente

1. Entrar en http://tudominio.com/superadmin
2. Clic en "+ Nueva empresa"
3. Rellenar: nombre empresa, CIF, email del gerente, contraseña, plan
4. El sistema crea automáticamente:
   - La empresa con su espacio de datos aislado
   - El usuario gerente con la contraseña indicada
   - 14 días de prueba

---

## Preguntas frecuentes

**¿Los datos de cada cliente están separados?**
Sí. Cada empresa tiene su `empresa_id` único. Ningún cliente puede ver datos de otro.

**¿Qué pasa si un cliente no paga?**
A los 7 días de vencer la suscripción el acceso queda bloqueado automáticamente. Los datos se conservan 30 días más.

**¿Cómo hago backup?**
```cmd
docker-compose exec postgres pg_dump -U transgest_user transgest > backup_$(date +%Y%m%d).sql
```

**¿Cómo restauro un backup?**
```cmd
docker-compose exec -i postgres psql -U transgest_user transgest < backup_20250101.sql
```
