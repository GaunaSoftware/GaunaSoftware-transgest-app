UPDATE usuarios SET permisos='{}'::jsonb
WHERE lower(email)='gerente@empresa.com' AND rol='gerente'
  AND jsonb_typeof(permisos->'modulos')='object'
  AND permisos->'modulos' <> '{}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM jsonb_each(permisos->'modulos') AS p
                  WHERE p.value->>'ver'='true' OR p.value->>'editar'='true');
