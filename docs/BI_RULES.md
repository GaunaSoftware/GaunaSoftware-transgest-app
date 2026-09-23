# Reglas del proyecto BI

Estas reglas complementan las instrucciones del repositorio; no las sustituyen.

- Fase activa: 6, auditoría y validación integral de las fases 1–5. La única ampliación funcional autorizada en esta fase es el informe semanal de flota solicitado por gerencia.
- Trabajar en rama/worktree aislado; conservar cambios ajenos.
- La instrucción actual autoriza el push de la rama aislada tras las comprobaciones; no autoriza fusionar, desplegar ni modificar producción. El usuario autorizó posteriormente una comprobación de acceso **solo de lectura** con su cuenta de Asensi para preparar el envío semanal; esta excepción no autoriza enviar informes desde producción ni alterar suscripciones allí.
- No alterar facturas históricas, precios ni capacidades de planes; no migraciones destructivas.
- Mantener stack, identidad, navegación y autorización de empresa, rol y plan en servidor.
- Reutilizar servicios, tablas y componentes. No añadir servicios de pago innecesarios.
- Datos sintéticos exclusivamente en pruebas identificadas, aisladas de producción.
- Reproducir contra la rama actual antes de corregir; implementar y verificar.
- Documentar fórmula, fuente, unidad, impuestos, periodo, corte, estados, costes,
  denominador, cobertura y permisos. Diferenciar error de ausencia de datos.
- No confundir ingresos realizados, emisión, tesorería, saldo y resultados con
  distintos perímetros de coste. No convertir costes desconocidos en ceros confirmados.
- Ejecutar scripts reales de pruebas y build; identificar limitaciones y fallos previos.

## Punto de partida

Worktree `tmp/bi-phase1`, rama `codex/bi-phase1-reliability`, base
`6b9a65eb1ddc7c11b029074fcf2d60faa4fc7e60`. La referencia `97973a7` es histórica.
No se han encontrado instrucciones AGENTS.md aplicables en los ancestros ni
en los directorios versionados de esta rama. El checkout principal y el trabajo
fiscal de otros worktrees se conservan.
