package com.sebas.mikuai.voice

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlin.math.min

/**
 * Orquestador de la conversión de voz RVC completa (equivalente en rol a
 * `WakeWordEngine` pero para esta cadena de 3 modelos) -- puerto de
 * `Pipeline.pipeline()` en `vc/pipeline.py`. Toma audio fuente a 16kHz
 * (ya decodificado/resampleado del MP3 de Edge-TTS) y devuelve el waveform
 * final con la voz de Miku a 48kHz.
 *
 * Simplificaciones deliberadas respecto a producción (documentadas en el
 * plan, no bugs):
 * - Sin chunking: producción solo trocea audio de más de ~65s, algo que
 *   nunca pasa con una respuesta de voz de Miku.
 * - Sin el blending "protect" voiced/unvoiced de `pipeline.py`: solo tiene
 *   efecto cuando se usa el índice de retrieval FAISS, que producción NUNCA
 *   usa (confirmado, ver memoria del proyecto) -- ahí es matemáticamente un
 *   no-op.
 * - High-pass de un solo pasada en vez del `filtfilt` zero-phase de scipy
 *   (ver [HighPassFilter]).
 *
 * RMVPE y HuBERT corren en paralelo (son independientes entre sí, ambos
 * calculados directo sobre el audio fuente) -- son sesiones ONNX distintas,
 * seguro correrlas concurrentemente. El generador sí depende de los dos
 * resultados, así que ese sigue después, secuencial.
 */
class RvcPipeline private constructor(
    private val hubert: HubertEngine,
    private val rmvpe: RmvpeEngine,
    private val generator: RvcGeneratorEngine,
) {

    fun close() {
        hubert.close()
        rmvpe.close()
        generator.close()
    }

    /** Convierte [source16k] (mono, 16kHz, float32) a la voz de Miku, devuelve el waveform a 48kHz. */
    suspend fun convert(source16k: FloatArray): FloatArray = coroutineScope {
        val normalized = AudioMath.peakNormalize(source16k, 0.95)
        val filtered = HighPassFilter.apply(normalized, SOURCE_SR)
        val padded = AudioMath.reflectPad(filtered, T_PAD)

        val salienceDeferred = async(Dispatchers.Default) { rmvpe.salience(padded) }
        val phoneFullDeferred = async(Dispatchers.Default) { hubert.extractFeatures(padded) }

        val (pitchCoarseFull, nsff0Full) = PitchMath.decode(salienceDeferred.await())
        val phoneFull = phoneFullDeferred.await()

        val pLen = min(phoneFull.size, pitchCoarseFull.size)
        val phone = if (phoneFull.size == pLen) phoneFull else phoneFull.copyOfRange(0, pLen)
        val pitchCoarse = if (pitchCoarseFull.size == pLen) pitchCoarseFull else pitchCoarseFull.copyOfRange(0, pLen)
        val nsff0 = if (nsff0Full.size == pLen) nsff0Full else nsff0Full.copyOfRange(0, pLen)

        val generated = generator.infer(phone, pitchCoarse, nsff0)

        val cropped = cropEdges(generated, T_PAD_TGT)
        val mixed = RmsMixer.mix(filtered, SOURCE_SR, cropped, TARGET_SR)
        AudioMath.peakNormalize(mixed, 0.99)
    }

    private fun cropEdges(signal: FloatArray, amount: Int): FloatArray {
        if (signal.size <= 2 * amount) return signal.copyOf() // defensivo, no debería pasar con un enunciado normal
        return signal.copyOfRange(amount, signal.size - amount)
    }

    companion object {
        private const val SOURCE_SR = 16000
        private const val TARGET_SR = 48000

        // x_pad=1 (equivalente a la rama "no is_half"/CPU de Config.device_config
        // en vc/config.py -- Android siempre corre en CPU) -> t_pad = sr*x_pad,
        // t_pad_tgt = tgt_sr*x_pad.
        private const val T_PAD = SOURCE_SR * 1
        private const val T_PAD_TGT = TARGET_SR * 1

        fun create(context: Context): RvcPipeline = RvcPipeline(
            hubert = HubertEngine(RvcModelPaths.hubert(context)),
            rmvpe = RmvpeEngine(RvcModelPaths.melspectrogram(context), RvcModelPaths.rmvpe(context)),
            generator = RvcGeneratorEngine(RvcModelPaths.generator(context)),
        )
    }
}
