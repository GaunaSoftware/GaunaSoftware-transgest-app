param(
  [ValidateSet('Preparar','Iniciar','Parar','Estado','ExportarOffline','ImportarOffline','Backup','CrearAdministrador')]
  [string]$Accion = 'Estado',
  [string]$Url = 'http://localhost:8088'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
function Invoke-CheckedDocker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw 'Docker no pudo completar la operacion. No se han eliminado datos.' }
}
if ($Accion -eq 'Preparar') {
  & node (Join-Path $PSScriptRoot 'configure.cjs') $Url
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la configuracion.' }
  Invoke-CheckedDocker compose -f compose.yml build
  Invoke-CheckedDocker compose -f compose.yml pull postgres
} elseif ($Accion -eq 'Iniciar') {
  Invoke-CheckedDocker compose -f compose.yml up -d --no-build --pull never --wait --wait-timeout 180
} elseif ($Accion -eq 'Parar') {
  Invoke-CheckedDocker compose -f compose.yml stop
} elseif ($Accion -eq 'ExportarOffline') {
  Invoke-CheckedDocker image save -o transgest-local-images.tar transgest-local-api:1.0.0 transgest-local-web:1.0.0 postgres:16-alpine
} elseif ($Accion -eq 'ImportarOffline') {
  Invoke-CheckedDocker image load -i transgest-local-images.tar
} elseif ($Accion -eq 'Backup') {
  $file = 'transgest-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump'
  Invoke-CheckedDocker compose -f compose.yml exec -T postgres pg_dump -U transgest -d transgest -Fc -f /tmp/transgest-backup.dump
  Invoke-CheckedDocker compose -f compose.yml cp postgres:/tmp/transgest-backup.dump $file
  Write-Host "Copia creada: $file"
} elseif ($Accion -eq 'CrearAdministrador') {
  Invoke-CheckedDocker compose -f compose.yml exec api node scripts/crear_superadmin.js
} else {
  Invoke-CheckedDocker compose -f compose.yml ps
}
