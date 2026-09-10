# TransGest en la red local

La web y TransGest.exe son dos clientes del mismo servidor. Esta instalacion
aloja API, PostgreSQL, documentos guardados en BD y copias dentro de la oficina.
No requiere Internet para iniciar sesion ni para la operativa que usa esa BD.
La red local y el equipo servidor deben seguir encendidos.

## Requisitos

- Equipo Windows con Docker Desktop (motor Linux) o servidor Linux con Docker Compose.
- Node.js para preparar la configuracion y compilar las imagenes.
- Preparacion inicial con Internet. Las imagenes pueden exportarse para otra
  instalacion sin Internet; Docker debe estar instalado previamente alli.
- Puerto 8088 libre; IP fija/reserva DHCP en el servidor.

## Primera instalacion

Desde esta carpeta, en PowerShell:

```powershell
.\TransGest-Local.ps1 Preparar -Url http://192.168.1.20:8088
.\TransGest-Local.ps1 Iniciar
.\TransGest-Local.ps1 CrearAdministrador
```

Sustituye la IP por la del servidor. No hay usuarios ni empresas demo. Entra
en `/superadmin` con el administrador creado y crea la empresa y su gerente.
Configura plan, fecha de licencia e integraciones. La licencia se verifica
contra la BD local: el corte de Internet no elimina su fecha de vencimiento.

En cada PC, abre TransGest.exe > Servidor e indica la misma URL. En navegador,
abre esa URL directamente. No uses `localhost` desde un PC distinto del servidor.
Al cambiar de servidor en el .exe se cierra la sesion y se limpia la cache de empresa.

HTTP esta previsto solo para una LAN privada de confianza. Antes de exponer
el servidor fuera de ella, configura HTTPS mediante un proxy o VPN. No abras
PostgreSQL a Internet; este compose no publica su puerto. Docker publica el
8088: limita su acceso a la subred de la oficina en el firewall del servidor.

## Arranque sin Internet

```powershell
.\TransGest-Local.ps1 ExportarOffline
# En el servidor de destino, con esta carpeta y transgest-local-images.tar:
node configure.cjs http://192.168.1.20:8088
.\TransGest-Local.ps1 ImportarOffline
.\TransGest-Local.ps1 Iniciar
```

`Iniciar` no reconstruye ni descarga imagenes. Los datos sobreviven a reinicios
y a `Parar`. No ejecutes `docker compose down -v`: eliminaria los volumenes.

## Copias y actualizaciones

```powershell
.\TransGest-Local.ps1 Backup
.\TransGest-Local.ps1 Estado
.\TransGest-Local.ps1 Parar
```

Conserva el `.dump` y `.env` en almacenamiento protegido fuera del servidor.
Sin la clave de cifrado de `.env` no se recuperan las claves API cifradas.
Antes de actualizar: copia, compila las nuevas imagenes con `Preparar` y usa
`Iniciar`. La configuracion existente no se sobrescribe. Prueba la restauracion
en una instalacion aparte; una copia sin probar no garantiza recuperacion.

## Limites claros

- GPS, OpenAI, geocodificacion, teselas de mapas, correo, WhatsApp y servicios
  fiscales externos necesitan Internet. Los datos GPS guardados no son posicion
  en directo durante el corte. La operativa local no debe depender de ellos.
- TransGest Intelligence muestra un error recuperable si el servidor no puede
  conectar con OpenAI. No simula respuestas ni instala un modelo local.
- Este paquete incluye el TMS y su facturacion operativa. El modulo separado
  `transgest-accounting-api` conserva su despliegue propio; no se instala aqui.
- La nube y una BD local independiente NO se sincronizan automaticamente.
  Elige un servidor principal. Migrar los datos de produccion requiere copia,
  restauracion y verificacion programadas; estos scripts no copian datos reales.
- El .exe es un cliente, no instala Docker ni PostgreSQL por si solo. Se distribuye
  con todos los archivos de su carpeta portable, no solo el ejecutable.
- Sin certificado de firma de Windows, SmartScreen puede mostrar una advertencia.

## Estado de verificacion

Se prueban por separado compilacion, cliente de escritorio y contratos de API.
La prueba integral de este compose requiere un motor Docker operativo. No tomar
una compilacion correcta como prueba de funcionamiento sin Internet.
