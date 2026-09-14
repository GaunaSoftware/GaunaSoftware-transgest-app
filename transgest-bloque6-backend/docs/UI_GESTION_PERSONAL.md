# Gestión del personal

Diseño común de Nóminas, Hojas de ruta y Control horario, con navegación entre secciones, tarjetas y tablas adaptables. Se conservan los accesos del lateral y los logos existentes.

Hojas de ruta incorpora un listado por vehículo y conductor con búsqueda, filtro de actividad, paginación y acceso al detalle. Los indicadores usan los vehículos y viajes recibidos de la API. No se inventan estados de validación, vacaciones ni horas extra de la imagen de referencia.

Subventanas cubiertas: combustible/precios, repostajes, noches/dietas, configuración del conductor, preparación y reimpresión de nóminas, ajuste de fichajes. Historial y transparencia salarial mantienen sus funciones y usan el mismo estilo. Los cálculos salariales y las APIs no cambian. Un error al guardar precios de combustible conserva el formulario abierto.

Validación: compilación de producción, eslint de los archivos modificados y prueba de navegador con API simulada en Edge a 390, 768 y 1672 px, temas claro y oscuro. Incluye navegación, filtros, subventanas, ajuste de fichaje, impresión de hoja y exportación CSV. No se han modificado datos de producción.

Despliegue: frontend desde main; sin migraciones de base de datos.
