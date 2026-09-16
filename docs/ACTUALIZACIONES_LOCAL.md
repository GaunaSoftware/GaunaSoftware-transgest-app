# Actualizaciones de la instalación local

La web en la nube, el servidor local y el cliente de escritorio parten del mismo
código, pero son instalaciones independientes. Publicar cambios en Vercel/Render
no actualiza el servidor de oficina ni un ejecutable ya distribuido.

## Qué debe actualizarse

| Uso del cliente | Actualización necesaria |
| --- | --- |
| Navegador conectado a la nube | Desplegar frontend y API compatibles; migraciones correspondientes. |
| Navegador conectado al servidor de oficina | Actualizar las imágenes de frontend y API del servidor local y aplicar/verificar migraciones. |
| TransGest.exe conectado a nube u oficina | Distribuir una compilación nueva del ejecutable para cambios de interfaz; actualizar también el servidor al que se conecta cuando cambie la API. |

No hay un actualizador automático del ejecutable ni sincronización automática
entre la base de datos local y la nube. Mantener una única base principal por
instalación. La URL del servidor se elige en el acceso; cambiarla cierra la sesión
y limpia los datos almacenados del servidor anterior.

## Procedimiento de entrega y actualización

1. Identificar la versión exacta (commit), productos contratados, URL del servidor,
   integraciones y configuración de la instalación. Evitar mezclar API, interfaz
   y ejecutable de versiones no probadas juntas.
2. Copiar la base con `TransGest-Local.ps1 Backup` y conservar el `.env` con las
   claves de cifrado en almacenamiento protegido separado del servidor.
3. Restaurar la copia en un entorno de prueba independiente. Comprobar documentos,
   imágenes y credenciales cifradas antes de considerar recuperable la copia.
4. Revisar las migraciones entre versiones y probarlas sobre esa restauración.
   `install_completo.sql` solo inicializa una base nueva: no actualiza un volumen
   existente. Parte del esquema actual se crea al usar módulos de la API; el
   arranque o `/health` por sí solos no validan todos los módulos.
5. Compilar desde la versión acordada con `Preparar` e iniciar con `Iniciar`,
   siguiendo `transgest-bloque6-backend/deploy/local/README.md`. Para un servidor
   aislado, exportar/importar previamente las imágenes del mismo paquete.
6. Regenerar el cliente de escritorio con `npm run desktop:portable` cuando proceda.
   Distribuir la carpeta completa; conservar las versiones anteriores hasta
   superar la aceptación. No sustituir solo el archivo `.exe`.
7. Probar login, permisos de cada perfil, productos, pedidos (crear, asignar,
   desasignar y guardar), Planner, facturación, archivos y copias. Repetir con
   reinicio del servidor y con un corte de Internet controlado.
8. Programar la actualización real y su ventana de mantenimiento. Una reversión
   del código puede requerir restaurar la base compatible, con pérdida de cambios
   posteriores a la copia: debe planificarse antes de actualizar.

## Integraciones y límites

La operativa almacenada reside en el servidor local. Mapas, geocodificación,
tráfico/GPS en directo, correo, WhatsApp, fiscalidad externa y servicios de IA
necesitan conexión y credenciales propias. Probar sus URLs, permisos, certificados
y callbacks desde la red del cliente. Un portal externo o una app fuera de la
oficina necesita acceso seguro al servidor; no basta una IP privada de la LAN.

El paquete local no incluye el módulo contable independiente. Si se contrata,
requiere su despliegue y pruebas de integración por separado.

## Verificación del cambio de asignación rápida

Se añaden pruebas del formulario, conservación de tarifas, limpieza completa de
recursos y navegación de escritorio a `/planner`. Este cambio de interfaz utiliza
campos que ya existen en la API; no añade una migración de base de datos.

En este equipo el motor Docker no está disponible (no existe la tubería
`dockerDesktopLinuxEngine`). Quedan pendientes el arranque integral del paquete,
la actualización de una base existente, restauración de una copia, pruebas sin
Internet y conexiones reales del cliente. No se considera una instalación local
certificada para entrega hasta completar esas pruebas.
