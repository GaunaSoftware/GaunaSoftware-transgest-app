function leerArchivoComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function cargarImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function detectarRectanguloPapel(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height, detected: false };
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const lumaAt = (x, y) => {
    const i = (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };
  const corner = Math.max(8, Math.round(Math.min(w, h) * 0.04));
  const bgSamples = [];
  for (let y = 0; y < corner; y += 3) {
    for (let x = 0; x < corner; x += 3) {
      bgSamples.push(lumaAt(x, y), lumaAt(w - 1 - x, y), lumaAt(x, h - 1 - y), lumaAt(w - 1 - x, h - 1 - y));
    }
  }
  const bg = bgSamples.reduce((sum, v) => sum + v, 0) / Math.max(1, bgSamples.length);
  const step = Math.max(3, Math.round(Math.min(w, h) / 260));
  const margin = Math.max(step * 2, Math.round(Math.min(w, h) * 0.02));
  let minX = w, minY = h, maxX = 0, maxY = 0, hits = 0;
  let strongMinX = w, strongMinY = h, strongMaxX = 0, strongMaxY = 0, strongHits = 0;
  for (let y = margin; y < h - margin; y += step) {
    for (let x = margin; x < w - margin; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      const edge = Math.max(Math.abs(lum - lumaAt(x + step, y)), Math.abs(lum - lumaAt(x, y + step)));
      const looksPaper = (lum > 142 && sat < 88 && Math.abs(lum - bg) > 8) || (lum > 188 && sat < 105) || edge > 46;
      if (!looksPaper) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const strongPaper = lum > 166 && sat < 78 && Math.abs(lum - bg) > 14;
      if (strongPaper) {
        strongHits += 1;
        if (x < strongMinX) strongMinX = x;
        if (x > strongMaxX) strongMaxX = x;
        if (y < strongMinY) strongMinY = y;
        if (y > strongMaxY) strongMaxY = y;
      }
    }
  }
  const hitRatio = hits / Math.max(1, ((w - margin * 2) / step) * ((h - margin * 2) / step));
  if (!hits || hitRatio < 0.015) return { x: 0, y: 0, w, h, detected: false };
  const strongArea = strongHits ? ((strongMaxX - strongMinX) * (strongMaxY - strongMinY)) / Math.max(1, w * h) : 0;
  if (strongHits > hits * 0.22 && strongArea > 0.18 && strongArea < 0.96) {
    minX = strongMinX;
    minY = strongMinY;
    maxX = strongMaxX;
    maxY = strongMaxY;
  }
  const pad = Math.round(Math.min(w, h) * 0.004);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w, maxX + pad);
  maxY = Math.min(h, maxY + pad);
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const areaRatio = (bw * bh) / Math.max(1, w * h);
  if (areaRatio < 0.18 || areaRatio > 0.985) return { x: 0, y: 0, w, h, detected: areaRatio > 0.72 };
  return { x: minX, y: minY, w: bw, h: bh, detected: true };
}

function recortarCanvas(canvas, rect) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.w));
  out.height = Math.max(1, Math.round(rect.h));
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
  return out;
}

function limpiarCanvasComoEscaner(canvas) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const normalized = gray > 218 ? 255 : gray < 72 ? 0 : Math.round(((gray - 72) / 146) * 255);
    const scan = gray < 160 ? Math.max(0, normalized - 22) : Math.min(255, normalized + 18);
    d[i] = scan;
    d[i + 1] = scan;
    d[i + 2] = scan;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

async function prepararArchivoEscaner(file) {
  const dataUrl = await leerArchivoComoDataUrl(file);
  if (!file.type?.startsWith("image/")) {
    return {
      preview: "",
      base64: String(dataUrl).split(",")[1] || "",
      mime: file.type || "application/pdf",
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
    };
  }

  const img = await cargarImagen(dataUrl);
  const maxSide = 1350;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "contrast(1.05) brightness(1.02)";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";
  const rect = detectarRectanguloPapel(canvas);
  const recortado = recortarCanvas(canvas, rect);
  const escaneado = limpiarCanvasComoEscaner(recortado);
  let quality = 0.82;
  let out = escaneado.toDataURL("image/jpeg", quality);
  while (out.length > 3600000 && quality > 0.58) {
    quality -= 0.08;
    out = escaneado.toDataURL("image/jpeg", quality);
  }
  return {
    preview: out,
    base64: out.split(",")[1] || "",
    mime: "image/jpeg",
    sizeKb: Math.max(1, Math.round((out.length * 0.75) / 1024)),
    scan_detected: rect.detected,
    scan_crop: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    scan_quality: Math.round(quality * 100) / 100,
  };
}


export { leerArchivoComoDataUrl, cargarImagen, detectarRectanguloPapel, recortarCanvas, limpiarCanvasComoEscaner, prepararArchivoEscaner };
