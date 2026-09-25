// Punto 7 del plan: soltar un archivo sobre Miku para que lo mire o lo lea.
// Llega como File de HTML5 (dragDropEnabled está apagado en tauri.conf.json
// a propósito: el arrastre nativo de Tauri rompía el drag-and-drop del
// panel de apps). No hace falta la ruta: se lee el contenido directo.

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const TEXT_MAX_BYTES = 512 * 1024;
// Lo que se le pasa del texto (queda en el historial de la charla).
const TEXT_MAX_CHARS = 12000;
const TEXT_EXTENSIONS = ["txt", "md", "json", "csv", "log", "js", "ts", "tsx", "jsx", "py", "rs", "kt", "html", "css", "xml", "yaml", "yml", "ini", "toml", "srt"];

export type DroppedContent = { message: string; imageDataUrl: string | null } | { error: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function readDroppedFile(file: File): Promise<DroppedContent> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type.startsWith("image/")) {
    if (file.size > IMAGE_MAX_BYTES) return { error: `la imagen pesa ${(file.size / 1048576).toFixed(1)} MB (máximo 8)` };
    return {
      message: `(Sebastián te soltó una imagen encima: "${file.name}".)`,
      imageDataUrl: await readAsDataUrl(file),
    };
  }
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.includes(ext)) {
    if (file.size > TEXT_MAX_BYTES) return { error: `el archivo pesa ${(file.size / 1024).toFixed(0)} KB (máximo 512)` };
    const text = await file.text();
    const cut = text.length > TEXT_MAX_CHARS;
    return {
      message: `(Sebastián te soltó un archivo encima: "${file.name}"${cut ? `; es largo, acá va el principio (${TEXT_MAX_CHARS} de ${text.length} caracteres)` : ""}.)\n\n${text.slice(0, TEXT_MAX_CHARS)}`,
      imageDataUrl: null,
    };
  }
  return { error: `no sé leer archivos .${ext || "(sin extensión)"} (solo imágenes y texto)` };
}
