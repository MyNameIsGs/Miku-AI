package com.sebas.mikuai.voice

import android.content.Context
import java.io.File

/**
 * Centraliza los paths de los 4 modelos ONNX de la voz real de Miku bajo
 * `filesDir` (privado de la app, no pide permiso en API 26+). Los 4 archivos
 * se descargan una sola vez con [ModelDownloadManager] desde un GitHub
 * Release -- son demasiado grandes (~518MB) para ir en `assets/` del APK,
 * a diferencia de los modelos chicos del wake-word.
 */
object RvcModelPaths {

    private fun dir(context: Context): File = File(context.filesDir, "rvc-models")

    // RMVPE: nombre "_u8" (no "_int8") -- la primera cuantización usaba
    // pesos int8, que junto a las activaciones uint8 de la cuantización
    // dinámica arma una combinación mixta (u8s8) sin kernel de ConvInteger
    // en ARM (confirmado con el error real en el dispositivo). Pesos
    // uint8 (u8u8) lo arregla, y corre rápido (368ms medido en el
    // teléfono).
    //
    // Generador: vuelto a fp32 (no cuantizado), a diferencia de RMVPE.
    // La versión u8u8 SÍ sonaba bien, pero tardaba ~35 SEGUNDOS en el
    // teléfono (medido) -- el generador produce el waveform final a 48kHz
    // (hasta ~144000 muestras), muchísimos más elementos que los ~100fps
    // de frames que procesan HuBERT/RMVPE, y el kernel Conv cuantizado de
    // ARM parece tener un camino mucho menos optimizado que el float32
    // (mismo patrón que ya se vio con HuBERT: 378MB fp32 corre en ~1.1s).
    // Nombres de archivo únicos a propósito (no reusar) para que el
    // teléfono vuelva a descargar solo, sin depender de que el hash no
    // matchee.
    fun generator(context: Context): File = File(dir(context), "generator_fp32.onnx")
    fun hubert(context: Context): File = File(dir(context), "hubert_fp32.onnx")
    fun rmvpe(context: Context): File = File(dir(context), "rmvpe_u8.onnx")
    fun melspectrogram(context: Context): File = File(dir(context), "melspectrogram_fp32.onnx")

    fun all(context: Context): List<File> = listOf(
        generator(context), hubert(context), rmvpe(context), melspectrogram(context)
    )

    fun allReady(context: Context): Boolean = all(context).all { it.exists() && it.length() > 0 }
}
