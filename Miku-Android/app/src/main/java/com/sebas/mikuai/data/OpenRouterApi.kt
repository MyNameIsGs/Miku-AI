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

private const val MODEL = "deepseek/deepseek-v4-flash-vision-exp"
private const val OR_URL = "https://openrouter.ai/api/v1/chat/completions"
private const val REFERER = "https://github.com/MyNameIsGs/Miku-AI"

class OpenRouterApi(private val apiKey: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    suspend fun chat(
        systemPrompt: String,
        history: List<ChatMessage>,
        userMessage: String,
        attempt: Int = 1
    ): String = withContext(Dispatchers.IO) {
        val messages = JSONArray().apply {
            put(JSONObject().apply { put("role", "system"); put("content", systemPrompt) })
            history.forEach { msg ->
                put(JSONObject().apply { put("role", msg.role); put("content", msg.content) })
            }
            put(JSONObject().apply { put("role", "user"); put("content", userMessage) })
        }

        val bodyJson = JSONObject().apply {
            put("model", MODEL)
            put("max_tokens", 1000)
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
            return@withContext chat(systemPrompt, history, userMessage, attempt + 1)
        }
        if (!response.isSuccessful) throw IOException("OpenRouter ${response.code}")

        JSONObject(response.body!!.string())
            .getJSONArray("choices")
            .getJSONObject(0)
            .getJSONObject("message")
            .getString("content")
    }
}