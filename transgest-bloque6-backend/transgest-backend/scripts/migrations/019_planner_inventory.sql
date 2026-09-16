-- Planner inventory is separate from the reusable-pallet ledger.
CREATE TABLE IF NOT EXISTS planner_articulos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 referencia varchar(80) NOT NULL, descripcion varchar(240) NOT NULL, familia varchar(100) NOT NULL DEFAULT '',
 unidad varchar(20) NOT NULL DEFAULT 'unidad', coste numeric(16,4) NOT NULL DEFAULT 0 CHECK(coste>=0),
 precio_venta numeric(16,4) NOT NULL DEFAULT 0 CHECK(precio_venta>=0), peso_kg numeric(16,4) NOT NULL DEFAULT 0 CHECK(peso_kg>=0),
 unidades_palet numeric(16,3) NOT NULL DEFAULT 1 CHECK(unidades_palet>0), stock_minimo numeric(16,3) NOT NULL DEFAULT 0 CHECK(stock_minimo>=0),
 activo boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(empresa_id,referencia), UNIQUE(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS planner_existencias (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 articulo_id uuid NOT NULL, almacen varchar(120) NOT NULL, ubicacion varchar(120) NOT NULL DEFAULT '', lote varchar(120) NOT NULL DEFAULT '',
 caducidad date, cantidad numeric(16,3) NOT NULL DEFAULT 0 CHECK(cantidad>=0), reservado numeric(16,3) NOT NULL DEFAULT 0 CHECK(reservado>=0 AND reservado<=cantidad),
 FOREIGN KEY(empresa_id,articulo_id) REFERENCES planner_articulos(empresa_id,id),
 UNIQUE(empresa_id,articulo_id,almacen,ubicacion,lote), UNIQUE(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS planner_preparaciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 pedido_id uuid NOT NULL REFERENCES pedidos(id), estado varchar(24) NOT NULL DEFAULT 'preparando' CHECK(estado IN ('preparando','lista','expedida','cancelada')),
 situacion_camion varchar(24) NOT NULL DEFAULT 'pendiente' CHECK(situacion_camion IN ('pendiente','espera_carga','cargando','cargado','salida')),
 version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES usuarios(id), created_at timestamptz NOT NULL DEFAULT now(), expedida_at timestamptz,
 UNIQUE(empresa_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS planner_preparacion_activa ON planner_preparaciones(empresa_id,pedido_id) WHERE estado<>'cancelada';
CREATE TABLE IF NOT EXISTS planner_preparacion_lineas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, preparacion_id uuid NOT NULL,
 existencia_id uuid NOT NULL, cantidad numeric(16,3) NOT NULL CHECK(cantidad>0),
 coste_unitario numeric(16,4) NOT NULL CHECK(coste_unitario>=0), precio_venta numeric(16,4) NOT NULL CHECK(precio_venta>=0),
 referencia varchar(80) NOT NULL, descripcion varchar(240) NOT NULL, unidad varchar(20) NOT NULL, peso_kg numeric(16,4) NOT NULL DEFAULT 0, unidades_palet numeric(16,3) NOT NULL DEFAULT 1 CHECK(unidades_palet>0),
 parada integer NOT NULL DEFAULT 1 CHECK(parada>0), preparada boolean NOT NULL DEFAULT false,
 FOREIGN KEY(empresa_id,preparacion_id) REFERENCES planner_preparaciones(empresa_id,id),
 FOREIGN KEY(empresa_id,existencia_id) REFERENCES planner_existencias(empresa_id,id),
 UNIQUE(preparacion_id,existencia_id,parada)
);
CREATE TABLE IF NOT EXISTS planner_movimientos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, existencia_id uuid NOT NULL,
 tipo varchar(24) NOT NULL CHECK(tipo IN ('recepcion','fabricacion','devolucion','ajuste','reserva','liberacion','expedicion')),
 cantidad numeric(16,3) NOT NULL CHECK(cantidad<>0), saldo numeric(16,3) NOT NULL, reservado numeric(16,3) NOT NULL,
 motivo text NOT NULL, referencia varchar(160) NOT NULL DEFAULT '', preparacion_id uuid,
 created_by uuid REFERENCES usuarios(id), created_at timestamptz NOT NULL DEFAULT now(), operacion uuid NOT NULL,
 FOREIGN KEY(empresa_id,existencia_id) REFERENCES planner_existencias(empresa_id,id),
 UNIQUE(empresa_id,operacion)
);
CREATE INDEX IF NOT EXISTS planner_movimientos_empresa_fecha ON planner_movimientos(empresa_id,created_at DESC);
CREATE TABLE IF NOT EXISTS planner_albaranes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id), preparacion_id uuid NOT NULL,
 numero varchar(80) NOT NULL, datos jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES usuarios(id),
 FOREIGN KEY(empresa_id,preparacion_id) REFERENCES planner_preparaciones(empresa_id,id), UNIQUE(empresa_id,preparacion_id), UNIQUE(empresa_id,numero)
);
CREATE TABLE IF NOT EXISTS planner_muelles (
 id uuid PRIMARY KEY,empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 nombre varchar(120) NOT NULL,almacen varchar(160) NOT NULL,UNIQUE(empresa_id,almacen,nombre)
);
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS horario_inicio time NOT NULL DEFAULT '06:00';
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS horario_fin time NOT NULL DEFAULT '18:00';
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS dias integer[] NOT NULL DEFAULT '{1,2,3,4,5}';
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS capacidad integer NOT NULL DEFAULT 33;
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS duracion_min integer NOT NULL DEFAULT 90;
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS margen_min integer NOT NULL DEFAULT 15;
ALTER TABLE planner_muelles ADD COLUMN IF NOT EXISTS zona_horaria text NOT NULL DEFAULT 'Europe/Madrid';
CREATE TABLE IF NOT EXISTS planner_reservas (
 id uuid PRIMARY KEY,empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 muelle_id uuid NOT NULL REFERENCES planner_muelles(id),pedido_id uuid REFERENCES pedidos(id) ON DELETE SET NULL,
 inicio timestamptz NOT NULL,fin timestamptz NOT NULL,tipo varchar(16) NOT NULL,
 notas text,created_by uuid REFERENCES usuarios(id),CHECK(fin>inicio)
);
CREATE INDEX IF NOT EXISTS planner_reservas_fecha ON planner_reservas(empresa_id,inicio,fin);
CREATE TABLE IF NOT EXISTS planner_solicitudes_hueco (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id), pedido_id uuid NOT NULL REFERENCES pedidos(id),
 colaborador_id uuid NOT NULL REFERENCES colaboradores(id), inicio timestamptz NOT NULL, fin timestamptz NOT NULL CHECK(fin>inicio),
 notas text NOT NULL DEFAULT '', estado varchar(20) NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','asignada','rechazada')),
 reserva_id uuid REFERENCES planner_reservas(id), created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES usuarios(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS planner_solicitud_pendiente ON planner_solicitudes_hueco(empresa_id,pedido_id) WHERE estado='pendiente';
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS planner_preparacion_id uuid REFERENCES planner_preparaciones(id);
CREATE UNIQUE INDEX IF NOT EXISTS planner_factura_venta_unica ON facturas(empresa_id,planner_preparacion_id) WHERE planner_preparacion_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS planner_vehiculos_autorizados (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 colaborador_id uuid REFERENCES colaboradores(id), matricula varchar(20) NOT NULL,tipo varchar(24) NOT NULL,marca varchar(80) NOT NULL DEFAULT '',modelo varchar(100) NOT NULL DEFAULT '',
 estado varchar(20) NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','autorizado','bloqueado')),notas text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(empresa_id,matricula),UNIQUE(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS planner_vehiculo_documentos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL,vehiculo_id uuid NOT NULL,
 tipo varchar(40) NOT NULL,nombre varchar(180) NOT NULL,file_mime varchar(80) NOT NULL,file_base64 text NOT NULL,
 vigente boolean NOT NULL DEFAULT true,vencimiento date,created_by uuid REFERENCES usuarios(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(empresa_id,vehiculo_id) REFERENCES planner_vehiculos_autorizados(empresa_id,id)
);

ALTER TABLE pedidos ALTER COLUMN peso_kg TYPE numeric(16,3) USING peso_kg::numeric;

CREATE TABLE IF NOT EXISTS planner_conexiones_transporte (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id),colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
 transportista_empresa_id uuid NOT NULL REFERENCES empresas(id),cliente_id uuid NOT NULL REFERENCES clientes(id),
 created_by uuid REFERENCES usuarios(id),created_at timestamptz NOT NULL DEFAULT now(),activo boolean NOT NULL DEFAULT true,
 UNIQUE(empresa_id,colaborador_id),CHECK(empresa_id<>transportista_empresa_id)
);
CREATE TABLE IF NOT EXISTS planner_viajes_compartidos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id),pedido_id uuid NOT NULL REFERENCES pedidos(id),
 transportista_empresa_id uuid NOT NULL REFERENCES empresas(id),viaje_id uuid NOT NULL REFERENCES pedidos(id),conexion_id uuid NOT NULL REFERENCES planner_conexiones_transporte(id),
 last_estado_ts timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(empresa_id,pedido_id),UNIQUE(transportista_empresa_id,viaje_id)
);
CREATE TABLE IF NOT EXISTS planner_documentos_compartidos (
 empresa_id uuid NOT NULL REFERENCES empresas(id),enlace_id uuid NOT NULL REFERENCES planner_viajes_compartidos(id),
 documento_origen_id uuid NOT NULL REFERENCES pedido_docs(id),documento_destino_id uuid NOT NULL REFERENCES pedido_docs(id),
 PRIMARY KEY(enlace_id,documento_origen_id)
);

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_colaborador varchar(200);
