// Cargo nunca borra compilaciones viejas de src-tauri/target: cada cambio de dependencia,
// feature o versión de Rust deja otra copia al lado. Corre antes de `tauri dev`/`tauri build`
// y, si un perfil (debug/release) pasó el límite, lo borra entero para que se recompile limpio.
// Revisa como mucho una vez al día, porque medir la carpeta tarda unos segundos.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIMITE_GB = 20;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "target");
const marca = path.join(target, ".ultima-revision");

function tamano(dir) {
  let total = 0;
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entradas) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) total += tamano(ruta);
    else {
      try {
        total += fs.statSync(ruta).size;
      } catch {}
    }
  }
  return total;
}

try {
  if (Date.now() - fs.statSync(marca).mtimeMs < UN_DIA_MS) process.exit(0);
} catch {}

if (!fs.existsSync(target)) process.exit(0);

for (const perfil of ["debug", "release"]) {
  const dir = path.join(target, perfil);
  const gb = tamano(dir) / 1024 ** 3;
  if (gb < LIMITE_GB) continue;
  console.log(`[limpiar-target] target/${perfil} pesa ${gb.toFixed(1)} GB (límite ${LIMITE_GB}); se borra y se recompila de cero.`);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // Típicamente un .exe de Miku dev todavía abierto; se reintenta en la próxima revisión.
    console.warn(`[limpiar-target] no se pudo borrar target/${perfil} entero: ${err.message}`);
    process.exit(0);
  }
}

fs.writeFileSync(marca, "");
