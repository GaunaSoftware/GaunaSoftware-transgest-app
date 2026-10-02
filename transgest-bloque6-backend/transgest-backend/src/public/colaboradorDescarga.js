(() => {
  const button = document.getElementById("send");
  const filesInput = document.getElementById("files");
  const notesInput = document.getElementById("notas");
  const message = document.getElementById("msg");
  if (!button || !filesInput || !notesInput || !message) return;

  const readBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}. Vuelve a seleccionarlo.`));
    reader.readAsDataURL(file);
  });

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    const files = Array.from(filesInput.files || []);
    if (!files.length) {
      message.textContent = "Selecciona al menos un albarán firmado antes de confirmar la descarga.";
      return;
    }
    if (files.length > 8 || files.some(file => file.size > 6 * 1024 * 1024) || files.reduce((total, file) => total + file.size, 0) > 8 * 1024 * 1024) {
      message.textContent = "Admite hasta 8 archivos PDF, JPG, PNG o WebP: máximo 6 MB por archivo y 8 MB en total.";
      return;
    }
    button.disabled = true;
    message.textContent = "Subiendo albaranes. Mantén esta página abierta…";
    try {
      const documentos = [];
      for (const file of files) {
        documentos.push({ nombre: file.name, file_mime: file.type, file_base64: await readBase64(file) });
      }
      const response = await fetch(button.dataset.uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notas: notesInput.value, documentos }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `No se pudo subir el albarán (HTTP ${response.status}).`);
      const main = document.querySelector("main");
      if (main) main.innerHTML = result.html || "<h1>Descarga registrada</h1><p>Hemos recibido los albaranes.</p>";
    } catch (error) {
      message.textContent = error?.message || "No se pudo enviar. Revisa la conexión y vuelve a intentarlo.";
      button.disabled = false;
    }
  });
})();
