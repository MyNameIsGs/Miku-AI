package com.sebas.mikuai.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

// Tarea 6.0b: mismo modelo que el lado desktop (OPENROUTER_MODEL en
// config/constants.ts) -- cambiado a v4.1-flash tras probar compatibilidad
// con scripts/tarea-6.0-test-tools.mjs, misma Miku en los dos lados.
private const val MODEL = "deepseek/deepseek-v4.1-flash"
private const val OR_URL = "https://openrouter.ai/api/v1/chat/completions"
private const val REFERER = "https://github.com/MyNameIsGs/Miku-AI"

// Tope de vueltas de tool calling, mismo valor y mismo motivo que
// MAX_TOOL_CALL_ROUNDS en lib/openrouter.ts del lado desktop: corta con
// error en vez de encadenarse indefinidamente si el modelo no da una
// respuesta final.
private const val MAX_TOOL_CALL_ROUNDS = 3

class OpenRouterApi(private val apiKey: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun buildMessageJson(role: String, content: String, imageBase64: String?): JSONObject {
        return if (imageBase64 != null) {
            val contentArray = JSONArray().apply {
                put(JSONObject().apply { put("type", "text"); put("text", content) })
                put(JSONObject().apply {
                    put("type", "image_url")
                    put("image_url", JSONObject().apply {
                        put("url", "data:image/jpeg;base64,$imageBase64")
                    })
                })
            }
            JSONObject().apply { put("role", role); put("content", contentArray) }
        } else {
            JSONObject().apply { put("role", role); put("content", content) }
        }
    }

    suspend fun chat(
        systemPrompt: String,
        history: List<ChatMessage>,
        userMessage: String,
        userImageBase64: String? = null,
        attempt: Int = 1
    ): String = withContext(Dispatchers.IO) {
        val messages = JSONArray().apply {
            put(JSONObject().apply { put("role", "system"); put("content", systemPrompt) })
            history.forEach { msg -> put(buildMessageJson(msg.role, msg.content, msg.imageUrlBase64)) }
            put(buildMessageJson("user", userMessage, userImageBase64))
        }

        val bodyJson = JSONObject().apply {
            put("model", MODEL)
            // No hardcodeamos max_tokens para evitar truncamiento, o usamos un límite alto si el modelo lo requiere.
            // Al removerlo o subirlo, permitimos respuestas completas y detalladas.
            put("max_tokens", 4000)
            put("messages", messages)
        }.toString().toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url(OR_URL)
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("HTTP-Referer", REFERER)
            .post(bodyJson)
            .build()

        val response = client.newCall(request).execute()

        if (response.code == 429 && attempt < 4) {
            delay(1500L * attempt)
            return@withContext chat(systemPrompt, history, userMessage, userImageBase64, attempt + 1)
        }
        if (!response.isSuccessful) throw IOException("OpenRouter ${response.code}")

        JSONObject(response.body!!.string())
            .getJSONArray("choices")
            .getJSONObject(0)
            .getJSONObject("message")
            .getString("content")
    }

    // Tarea 6.3 en Android (ver BuscarEnWeb.kt): llamada APARTE con el
    // plugin `{ id: "web" }` en el body, nunca como `plugins` de la
    // conversación principal -- con el modelo actual el plugin busca en
    // CADA mensaje que lo lleva (verificado en desktop, hasta "2+2"). Así
    // solo se busca cuando Miku llama la tool. Devuelve el texto tal cual
    // (puede venir vacío); el formato para el modelo lo arma BuscarEnWeb.
    suspend fun webSearch(
        systemPrompt: String,
        consulta: String,
        maxResults: Int,
        attempt: Int = 1
    ): String = withContext(Dispatchers.IO) {
        val messages = JSONArray().apply {
            put(JSONObject().apply { put("role", "system"); put("content", systemPrompt) })
            put(JSONObject().apply { put("role", "user"); put("content", consulta) })
        }

        val bodyJson = JSONObject().apply {
            put("model", MODEL)
            put("max_tokens", 4000)
            put("messages", messages)
            put("plugins", JSONArray().put(JSONObject().apply {
                put("id", "web")
                put("max_results", maxResults)
            }))
        }.toString().toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url(OR_URL)
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("HTTP-Referer", REFERER)
            .post(bodyJson)
            .build()

        val response = client.newCall(request).execute()

        // Mismo reintento ante 429 que chat() (y que
        // fetchOpenRouterWithRetry del lado desktop).
        if (response.code == 429 && attempt < 4) {
            delay(1500L * attempt)
            return@withContext webSearch(systemPrompt, consulta, maxResults, attempt + 1)
        }
        if (!response.isSuccessful) throw IOException("OpenRouter ${response.code}")

        val message = JSONObject(response.body!!.string())
            .getJSONArray("choices")
            .getJSONObject(0)
            .getJSONObject("message")
        // isNull primero: en Android, optString sobre un null de JSON
        // devuelve el texto "null", no el fallback.
        if (message.isNull("content")) "" else message.getString("content")
    }

    // Primer paso de tool calling en Android -- mismo protocolo nativo de
    // OpenRouter que runToolCallingCycle en lib/openrouter.ts del lado
    // desktop: manda tools + tool_choice="auto", detecta
    // finish_reason == "tool_calls", ejecuta cada tool (puede venir más de
    // una por vuelta, nunca asumir una sola -- ver 6.16 del contexto),
    // agrega los resultados como mensajes "tool", y vuelve a preguntar.
    // executeTool queda inyectado desde afuera para no acoplar esta clase
    // a qué tools existen (mismo desacople que lib/tools/index.ts allá).
    suspend fun chatWithTools(
        systemPrompt: String,
        history: List<ChatMessage>,
        userMessage: String,
        userImageBase64: String?,
        tools: JSONArray,
        executeTool: suspend (name: String, argumentsJson: String) -> String,
    ): String = withContext(Dispatchers.IO) {
        val messages = JSONArray().apply {
            put(JSONObject().apply { put("role", "system"); put("content", systemPrompt) })
            history.forEach { msg -> put(buildMessageJson(msg.role, msg.content, msg.imageUrlBase64)) }
            put(buildMessageJson("user", userMessage, userImageBase64))
        }

        repeat(MAX_TOOL_CALL_ROUNDS) {
            val bodyJson = JSONObject().apply {
                put("model", MODEL)
                put("max_tokens", 4000)
                put("messages", messages)
                put("tools", tools)
                put("tool_choice", "auto")
            }.toString().toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url(OR_URL)
                .addHeader("Authorization", "Bearer $apiKey")
                .addHeader("HTTP-Referer", REFERER)
                .post(bodyJson)
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) throw IOException("OpenRouter ${response.code}")

            val choice = JSONObject(response.body!!.string()).getJSONArray("choices").getJSONObject(0)
            val message = choice.getJSONObject("message")
            val finishReason = choice.optString("finish_reason")
            val toolCalls = message.optJSONArray("tool_calls")

            if (finishReason != "tool_calls" || toolCalls == null || toolCalls.length() == 0) {
                return@withContext message.optString("content", "")
            }

            // Se agrega el mensaje del assistant TAL CUAL vino, con su
            // tool_calls intacto -- OpenRouter lo exige en la vuelta
            // siguiente.
            messages.put(message)

            for (i in 0 until toolCalls.length()) {
                val toolCall = toolCalls.getJSONObject(i)
                val function = toolCall.getJSONObject("function")
                // function.arguments llega como STRING JSON, no como
                // objeto -- se parsea recién adentro de executeTool.
                val result = executeTool(function.getString("name"), function.getString("arguments"))
                messages.put(JSONObject().apply {
                    put("role", "tool")
                    put("tool_call_id", toolCall.getString("id"))
                    put("content", result)
                })
            }
        }

        throw IOException("Se alcanzó el límite de $MAX_TOOL_CALL_ROUNDS vueltas de tool calling sin llegar a una respuesta final.")
    }
}
