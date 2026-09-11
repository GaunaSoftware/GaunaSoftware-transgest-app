# Organización de la navegación

Se aplica el esquema facilitado por el usuario y su aclaración sobre Colaboradores, Nóminas, Hojas de ruta y Objetivos. El estilo toma como referencia la barra oscura de la segunda captura. Los logos, sus archivos y su renderizado no cambian. Soporte y Cerrar sesión permanecen abajo; el perfil permanece solo en la cabecera.

La composición final y la entrada inicial por Resumen se detallan en [UI_FACTURACION_RESUMEN_FINAL.md](UI_FACTURACION_RESUMEN_FINAL.md).

## Jerarquía

```text
Dashboard
Agenda
TransGest Intelligence
Operaciones
  Pedidos / tráfico
  Mesa de tráfico
  Control Tower
  Peticiones de viaje
  Calculador de portes
  Plan diario (según perfil)
  Excepciones operativas
Clientes
  Clientes
  Rutas y tarifas
    Rutas
    Tarifas
  Gestión de almacén
Flota
  Conductores
  Vehículos
    Tractoras
    Remolques
  Taller
  Colaboradores
Finanzas
  Resumen
  Facturas
  Cobros
  Pagos
  Tesorería
  Fiscal (AEAT)
  Informes
    Informes de gestión
    Explotación
    Objetivos
  Contabilidad (según flag existente)
  Gastos de estructura
  Nóminas
  Hojas de ruta
Gestión
  Control horario
  Configuración
    Avisos
    Mi empresa
    Usuarios y roles
    Importación
    Mi cuenta
  Trazabilidad
  Documentación (según perfil)
```

Los accesos adicionales no incluidos en el dibujo se mantienen en grupos relacionados y se han comunicado al usuario. No se habilitan módulos nuevos para un perfil: cada rama desaparece si no contiene opciones autorizadas. Los portales de cliente, conductor, colaborador y taller conservan su estructura anterior.

## Implementación

- `utils/sidebarNavigation.js` reorganiza la lista que App ya ha filtrado por rol, plan, permiso y feature flag. No cambia App ni las reglas de autorización. Las hojas desconocidas futuras siguen accesibles en Más opciones.
- Layout muestra el árbol recursivamente, conserva los contadores de incidencias y añade `aria-expanded`, `aria-controls` y `aria-current`. Abrir un grupo estando plegado expande el menú; elegir una hoja en móvil cierra el panel.
- `services/financeNavigation.js` sincroniza menú y pestañas de Finanzas. Los seis accesos usan la ruta existente `facturacion`, con selección de pestaña en memoria. No se crean endpoints ni permisos paralelos.
- Resumen presenta los indicadores, señales, viajes pendientes y previsión ya calculados. No calcula nuevas métricas ni cambia la lógica de carga, emisión o cobro.
- `components/sidebar.css` modifica solo el aspecto de la navegación: superficie de marca, iconos suaves, niveles indentados, estados activos y controles móviles de 44 px. Conserva la paleta de empresa y el breakpoint lateral de 1024 px.

## Verificación

`node scripts/sidebar_navigation_check.cjs` comprueba conservación de rutas para ocho perfiles, los destinos acordados y accesos con un único permiso. `scripts/finance_browser_check.cjs` comprueba navegación financiera en ambos sentidos, submenús anidados, modo plegado/móvil y el resto de los flujos financieros con API simulada. `scripts/finance_preservation_check.cjs` comprueba que 37 cálculos y handlers financieros no cambian.

Los cambios previos ajenos del workspace se excluyen de esta entrega. La validación del navegador no sustituye una prueba de los binarios Electron o las aplicaciones nativas.

Resultado final: build y check correctos; 146 comprobaciones de navegador, 34 de jerarquía/permisos y 37 de preservación financiera superadas. Sin errores de consola ni avisos nuevos de compilación; permanecen los dos avisos previos de hooks en GestionTrafico y MiCuenta. Las acciones de la prueba usan API simulada.
