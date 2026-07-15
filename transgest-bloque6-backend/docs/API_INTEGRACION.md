# Integración con la API de TransGest

Guía para integrar programas externos (ERP, TMS, software a medida) con TransGest
mediante **API keys de empresa**.

## 1. Obtener una API key

En TransGest, un usuario con rol **gerencia** entra en **Mi cuenta → Integraciones
API** y crea una clave:

- **Nombre**: identifica la integración (p. ej. "ERP Contable").
- **Módulos (scopes)**: qué puede tocar la clave (ver tabla abajo).
- **Caducidad** (días) y **límite por hora** (por defecto 1000 peticiones/hora).

La clave (`tgk_...`) **solo se muestra en claro al crearla**. Guárdala de forma
segura; en la base de datos solo se almacena su hash SHA-256. Puedes revocarla en
cualquier momento desde la misma pantalla.

## 2. Autenticación

Envía la clave en la cabecera `Authorization` de cada petición:

```
Authorization: Bearer tgk_xxxxxxxxxxxxxxxxxxxxxxxx
```

Base URL de la API: `https://transgest-backend.onrender.com/api/v1`

Ejemplo:

```bash
curl -H "Authorization: Bearer tgk_xxxx" \
     https://transgest-backend.onrender.com/api/v1/pedidos
```

## 3. Scopes disponibles

Cada scope es un módulo (acceso lectura+escritura) o `modulo:read` / `modulo:write`.

| Scope base | Da acceso a |
|---|---|
| `pedidos` | Pedidos / tráfico |
| `clientes` | Clientes |
| `vehiculos` | Vehículos |
| `choferes` | Choferes |
| `colaboradores` | Colaboradores |
| `facturacion` | Facturación |
| `rutas` | Rutas y tarifas |
| `palets` | Palets |
| `agenda` | Agenda |
| `documentos` | Documentos |
| `informes` | Informes / KPIs |
| `control_horario` | Control horario |
| `plan_diario` | Plan diario |

Ejemplos: `pedidos` (lectura y escritura), `clientes:read` (solo lectura),
`facturacion:write` (lectura + escritura).

Consulta los scopes vigentes en: `GET /api/v1/api-keys/scopes` (con sesión de gerencia).

## 4. Límites y errores

- **Rate limit por clave**: configurable por hora (cabecera `X-RateLimit-Remaining`
  en cada respuesta). Al superarlo se devuelve `429` con `retry_after_seconds`.
- La clave respeta el **plan** de la empresa y los permisos por módulo: un scope no
  concedido devuelve `403`; un módulo no incluido en el plan devuelve `403 upgrade_required`.

| Código | Significado |
|---|---|
| `401` | Clave inválida, revocada o caducada |
| `402` | La cuenta de la empresa no está activa |
| `403` | Sin permiso para ese módulo o no incluido en el plan |
| `429` | Límite horario superado (reintenta tras `retry_after_seconds`) |

## 5. Notas

- Las claves son **por empresa** (no por usuario): la integración actúa sobre los
  datos de esa empresa.
- Toda acción con API key queda **auditada** (`audit_log_saas`).
- Para el portal de un cliente concreto existe además el token `tedi_` (manifest/feed);
  las claves `tgk_` son para integración operativa a nivel de empresa.
