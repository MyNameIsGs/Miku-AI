package com.sebas.mikuai.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.providers.NNAPIFlags
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.EnumSet

/**
 * Generador RVC (`generator_int8.onnx`, `SynthesizerTrnMs768NSFsid.infer()`
 * en `infer_pack/models.py`) -- la última etapa del pipeline, produce el
 * waveform final a 48kHz a partir del contenido (HuBERT) y el pitch (RMVPE).
 */
class RvcGeneratorEngine(modelPath: File) {

    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession = env.createSession(
        modelPath.absolutePath,
        OrtSession.SessionOptions().apply {
            // 6 hilos: perfilado con ONNX Runtime confirmó que el 91% del
            // tiempo del generador es Conv/ConvTranspose normales (NO la
            // generación de armónicos NSF, que es <0.15% -- se descartó
            // reexportar el grafo por esto). El costo es inherente a
            // generar el audio final a 48kHz en el CPU del teléfono; más
            // hilos es la única palanca barata que queda (Redmagic 11 Pro,
            // 8 núcleos -- ver conversación sobre la demora de la voz real).
            setIntraOpNumThreads(6)
            setInterOpNumThreads(1)
            // NNAPI (DSP/NPU del teléfono en vez de solo CPU) como intento
            // de acortar más la latencia -- experimental, no confirmado
            // que ayude (el grafo tiene bastante control de flujo/ops raras
            // de la fuente armónica NSF que NNAPI puede no soportar y
            // terminar corriendo en CPU igual). try/catch porque NNAPI no
            // existe en Android <8.1 (API 27) y `addNnapi` puede tirar si
            // el dispositivo no lo soporta -- si falla, sigue solo con CPU.
            try {
                addNnapi(EnumSet.noneOf(NNAPIFlags::class.java))
            } catch (e: Exception) {
            }
        }
    )

    fun close() = session.close()

    /**
     * [phone] contenido HuBERT `[p_len][768]`, [pitchCoarse]/[nsff0] pitch
     * `[p_len]` (coarse bins 1..255 / Hz continuos). `sid=0` (modelo de un
     * solo hablante, Miku). Devuelve el waveform float32 a 48kHz, SIN
     * recortar el padding todavía (eso lo hace `RvcPipeline`).
     */
    fun infer(phone: Array<FloatArray>, pitchCoarse: IntArray, nsff0: FloatArray): FloatArray {
        val pLen = phone.size
        val channels = phone[0].size

        val phoneFlat = FloatArray(pLen * channels)
        for (i in 0 until pLen) {
            System.arraycopy(phone[i], 0, phoneFlat, i * channels, channels)
        }

        val phoneTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(phoneFlat), longArrayOf(1, pLen.toLong(), channels.toLong()))
        val phoneLengthsTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(pLen.toLong())), longArrayOf(1))
        val pitchTensor = OnnxTensor.createTensor(
            env, LongBuffer.wrap(LongArray(pLen) { pitchCoarse[it].toLong() }), longArrayOf(1, pLen.toLong())
        )
        val nsff0Tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(nsff0), longArrayOf(1, pLen.toLong()))
        val sidTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(0L)), longArrayOf(1))

        phoneTensor.use { p ->
            phoneLengthsTensor.use { pl ->
                pitchTensor.use { pc ->
                    nsff0Tensor.use { f0 ->
                        sidTensor.use { sid ->
                            session.run(
                                mapOf(
                                    "phone" to p,
                                    "phone_lengths" to pl,
                                    "pitch" to pc,
                                    "nsff0" to f0,
                                    "sid" to sid,
                                )
                            ).use { result ->
                                val output = result[0] as OnnxTensor
                                val shape = output.info.shape // [1, 1, T_out] o similar
                                val n = shape[shape.size - 1].toInt()
                                val flat = output.floatBuffer
                                val out = FloatArray(n)
                                flat.get(out)
                                return out
                            }
                        }
                    }
                }
            }
        }
    }
}
