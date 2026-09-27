CREATE TABLE IF NOT EXISTS grupos_empresariales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS grupo_empresas (
 grupo_id uuid NOT NULL REFERENCES grupos_empresariales(id), empresa_id uuid NOT NULL REFERENCES empresas(id), PRIMARY KEY(grupo_id,empresa_id)
);
CREATE TABLE IF NOT EXISTS usuario_empresas (
 usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 empresa_id uuid NOT NULL REFERENCES empresas(id), rol text NOT NULL, permisos jsonb NOT NULL DEFAULT '{}',
 activo boolean NOT NULL DEFAULT true, perfil text, trafico_config jsonb NOT NULL DEFAULT '{}',
 cliente_id uuid, chofer_id uuid, colaborador_id uuid, bi_consolidado boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(usuario_id,empresa_id)
);
CREATE INDEX IF NOT EXISTS usuario_empresas_company ON usuario_empresas(empresa_id,activo);
CREATE TABLE IF NOT EXISTS multiempresa_eventos (
 id bigserial PRIMARY KEY, usuario_id uuid, empresa_id uuid, actor text NOT NULL,
 accion text NOT NULL, detalle jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO usuario_empresas(usuario_id,empresa_id,rol,permisos,perfil,trafico_config,cliente_id,chofer_id,colaborador_id)
 SELECT id,empresa_id,rol,COALESCE(NULLIF(to_jsonb(u)->'permisos','null'::jsonb),'{}'),to_jsonb(u)->>'perfil',COALESCE(NULLIF(to_jsonb(u)->'trafico_config','null'::jsonb),'{}'),
 NULLIF(to_jsonb(u)->>'cliente_id','')::uuid,NULLIF(to_jsonb(u)->>'chofer_id','')::uuid,NULLIF(to_jsonb(u)->>'colaborador_id','')::uuid
 FROM usuarios u WHERE empresa_id IS NOT NULL ON CONFLICT DO NOTHING;
-- Maintain legacy user writers without granting membership on login/read.
CREATE OR REPLACE FUNCTION sync_primary_usuario_empresa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE data jsonb := to_jsonb(NEW); olddata jsonb; changed boolean := TG_OP='INSERT';
BEGIN
 IF TG_OP='UPDATE' THEN
  olddata:=to_jsonb(OLD);
  changed:= (data->'empresa_id',data->'rol',data->'permisos',data->'perfil',data->'trafico_config',data->'cliente_id',data->'chofer_id',data->'colaborador_id') IS DISTINCT FROM
            (olddata->'empresa_id',olddata->'rol',olddata->'permisos',olddata->'perfil',olddata->'trafico_config',olddata->'cliente_id',olddata->'chofer_id',olddata->'colaborador_id');
  IF OLD.empresa_id IS DISTINCT FROM NEW.empresa_id THEN
   UPDATE usuario_empresas SET activo=false,revision=revision+1,updated_at=now() WHERE usuario_id=NEW.id AND empresa_id=OLD.empresa_id;
  END IF;
 END IF;
 IF changed AND NEW.empresa_id IS NOT NULL THEN
  INSERT INTO usuario_empresas(usuario_id,empresa_id,rol,permisos,perfil,trafico_config,cliente_id,chofer_id,colaborador_id)
  VALUES(NEW.id,NEW.empresa_id,NEW.rol,COALESCE(NULLIF(data->'permisos','null'::jsonb),'{}'),data->>'perfil',COALESCE(NULLIF(data->'trafico_config','null'::jsonb),'{}'),NULLIF(data->>'cliente_id','')::uuid,NULLIF(data->>'chofer_id','')::uuid,NULLIF(data->>'colaborador_id','')::uuid)
  ON CONFLICT(usuario_id,empresa_id) DO UPDATE SET rol=EXCLUDED.rol,permisos=EXCLUDED.permisos,perfil=EXCLUDED.perfil,trafico_config=EXCLUDED.trafico_config,
  cliente_id=EXCLUDED.cliente_id,chofer_id=EXCLUDED.chofer_id,colaborador_id=EXCLUDED.colaborador_id,revision=usuario_empresas.revision+1,updated_at=now();
  INSERT INTO multiempresa_eventos(usuario_id,empresa_id,actor,accion) VALUES(NEW.id,NEW.empresa_id,'legacy_user_writer','primary_membership_sync');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS usuarios_membership_sync ON usuarios;
CREATE TRIGGER usuarios_membership_sync AFTER INSERT OR UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION sync_primary_usuario_empresa();
