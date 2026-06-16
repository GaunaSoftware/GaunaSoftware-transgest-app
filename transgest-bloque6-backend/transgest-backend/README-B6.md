# TransGest TMS — Bloque 6: Backend

## Stack completo
- **Node.js 20** + Express 4 — API REST
- **PostgreSQL 16** — Base de datos
- **Docker + docker-compose** — Contenedores
- **Nginx** — Proxy inverso + HTTPS
- **JWT + bcrypt** — Autenticación segura
- **Nodemailer** — Emails automáticos SMTP
- **Backups automáticos** — pg_dump diario con rotación

---

## Instalación en cualquier servidor

### 1. Instalar Docker (Ubuntu/Debian)
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Reiniciar sesión para aplicar el grupo
docker --version   # Debe mostrar la versión
```

### 2. Instalar Docker (Windows)
Descargar e instalar **Docker Desktop** desde https://docker.com/products/docker-desktop

### 3. Copiar el proyecto al servidor
```bash
# Desde tu máquina local:
scp -r transgest-backend/ usuario@IP_SERVIDOR:/opt/transgest/

# O clonar desde git (cuando lo tengas en repositorio):
git clone https://tu-repositorio.git /opt/transgest
```

### 4. Configurar variables de entorno
```bash
cd /opt/transgest
cp .env.example .env
nano .env    # Editar con los valores reales
```

**Variables OBLIGATORIAS** que debes rellenar:
```
DB_PASSWORD=una_contraseña_larga_y_segura_min_20_chars
JWT_SECRET=un_string_aleatorio_largo_de_al_menos_64_caracteres
```

**Variables para email** (si usas Gmail):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu_cuenta@gmail.com
SMTP_PASS=tu_contraseña_de_aplicacion   # Ver: https://myaccount.google.com/apppasswords
SMTP_FROM="TransGest TMS <tu_cuenta@gmail.com>"
```

### 5. Certificado SSL (HTTPS)

**Opción A: Servidor con dominio (recomendado)**
```bash
# Instalar certbot
apt install certbot
certbot certonly --standalone -d tudominio.com

# Copiar certificados a nginx/ssl/
cp /etc/letsencrypt/live/tudominio.com/fullchain.pem nginx/ssl/cert.pem
cp /etc/letsencrypt/live/tudominio.com/privkey.pem   nginx/ssl/key.pem
```

**Opción B: Red local (autofirmado, para pruebas)**
```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem -out nginx/ssl/cert.pem \
  -subj "/CN=transgest.local"
```

### 6. Actualizar nginx.conf
Editar `nginx/nginx.conf` y cambiar:
```nginx
server_name tudominio.com;   # ← Tu dominio o IP
```

### 7. Arrancar la aplicación
```bash
cd /opt/transgest
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f api

# Ver estado de los contenedores
docker-compose ps
```

### 8. Cargar datos iniciales
```bash
# Solo la primera vez — crea el esquema y usuarios demo
docker-compose exec api node scripts/seed.js
```

---

## Arrancar con modo desarrollo (pgAdmin incluido)
```bash
docker-compose --profile dev up -d
# pgAdmin disponible en http://localhost:5050
# Email: admin@transgest.local / Contraseña: la de .env
```

---

## Endpoints API principales

| Método | Ruta                              | Descripción                  | Rol mínimo      |
|--------|-----------------------------------|------------------------------|-----------------|
| POST   | /api/v1/auth/login                | Login JWT                    | Público         |
| GET    | /api/v1/auth/me                   | Usuario actual               | Autenticado     |
| GET    | /api/v1/clientes?q=texto          | Buscar clientes              | Autenticado     |
| POST   | /api/v1/clientes                  | Crear cliente                | Gerente/Contable|
| GET    | /api/v1/pedidos?estado=pendiente  | Listar pedidos               | Autenticado     |
| POST   | /api/v1/pedidos                   | Crear pedido                 | Gerente/Tráfico |
| PATCH  | /api/v1/pedidos/:id/estado        | Cambiar estado pedido        | Gerente/Tráfico |
| GET    | /api/v1/facturas                  | Listar facturas              | Gerente/Contable|
| POST   | /api/v1/facturas                  | Crear factura                | Gerente/Contable|
| PATCH  | /api/v1/facturas/:id/estado       | Cambiar estado factura       | Gerente/Contable|
| GET    | /api/v1/informes/dashboard        | KPIs gerencia                | Gerente/Contable|
| GET    | /api/v1/informes/choferes         | Rendimiento choferes         | Solo Gerente    |
| GET    | /api/v1/docs/proximos-vencer      | Documentos por vencer        | Autenticado     |
| GET    | /health                           | Health check                 | Público         |

---

## Conectar el Frontend React al backend

En el frontend, crear el archivo `src/services/api.js`:

```javascript
const BASE = process.env.REACT_APP_API_URL || "http://localhost:3001";

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("tms_token");
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

export const login = (email, password) =>
  apiFetch("/auth/login", { method:"POST", body: JSON.stringify({email, password}) });

export const getClientes  = (q="")  => apiFetch(`/clientes?q=${q}`);
export const getPedidos   = (params) => apiFetch(`/pedidos?${new URLSearchParams(params)}`);
export const getFacturas  = (params) => apiFetch(`/facturas?${new URLSearchParams(params)}`);
export const getDashboard = (desde,hasta) => apiFetch(`/informes/dashboard?desde=${desde}&hasta=${hasta}`);
```

---

## Backups

Los backups se crean automáticamente dos veces al día (02:00 y 14:00).
Se guardan en el volumen Docker `backups` y se limpian después de `BACKUP_KEEP_DAYS` días.

**Ver backups existentes:**
```bash
docker-compose exec backup ls -lh /backups/
```

**Restaurar un backup:**
```bash
# Copiar el backup fuera del contenedor
docker cp transgest_backup:/backups/transgest_20250115_020000.sql.gz ./

# Restaurar en PostgreSQL
gunzip transgest_20250115_020000.sql.gz
docker-compose exec -T postgres psql -U transgest_user transgest < transgest_20250115_020000.sql
```

**Backup manual inmediato:**
```bash
docker-compose exec backup sh /backup.sh run
```

---

## Gestión y mantenimiento

```bash
# Ver logs de la API
docker-compose logs -f api --tail=100

# Reiniciar solo la API (sin tocar la BD)
docker-compose restart api

# Actualizar la aplicación (cuando haya cambios)
git pull
docker-compose build api
docker-compose up -d api

# Parar todo
docker-compose down

# Parar todo y borrar datos (¡CUIDADO!)
docker-compose down -v
```

---

## Seguridad implementada

- **Contraseñas** hasheadas con bcrypt (cost factor 12)
- **JWT** firmado con secret configurable, expira en 8h
- **Rate limiting**: 200 req/15min global, 10 intentos/15min en login
- **Helmet**: headers de seguridad HTTP automáticos
- **CORS**: solo acepta peticiones del dominio configurado
- **Roles**: 4 niveles con guards en cada endpoint
- **Audit log**: todos los cambios de estado de facturas quedan registrados con usuario e IP
- **PostgreSQL**: solo accesible desde localhost (no expuesto al exterior)
- **Usuario no-root**: el contenedor Node corre como usuario `nodeapp` (uid 1001)
