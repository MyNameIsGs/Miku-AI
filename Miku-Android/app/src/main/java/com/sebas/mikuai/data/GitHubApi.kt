package com.sebas.mikuai.data

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val GH_OWNER  = "MyNameIsGs"
private const val GH_REPO   = "Miku-AI"
private const val GH_BRANCH = "main"

class GitHubApi(private val token: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun getFile(path: String): GitHubFile = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("https://api.github.com/repos/$GH_OWNER/$GH_REPO/contents/$path?ref=$GH_BRANCH")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Accept", "application/vnd.github.v3+json")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw IOException("GitHub ${response.code}: $path")

        val obj  = JSONObject(response.body!!.string())
        val raw  = obj.getString("content").replace("\n", "")
        GitHubFile(
            content = String(Base64.decode(raw, Base64.DEFAULT), Charsets.UTF_8),
            sha     = obj.getString("sha")
        )
    }

    // sha nulo = crear un archivo nuevo (la API de contenidos de GitHub lo
    // exige para SOBREESCRIBIR uno existente, pero lo rechaza si se manda
    // en la creación de uno que no existe todavía).
    suspend fun putFile(
        path: String,
        content: String,
        sha: String?,
        message: String
    ): String = withContext(Dispatchers.IO) {
        val encoded = Base64.encodeToString(content.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val bodyJson = JSONObject().apply {
            put("message", message)
            put("content", encoded)
            if (sha != null) put("sha", sha)
            put("branch", GH_BRANCH)
        }.toString().toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("https://api.github.com/repos/$GH_OWNER/$GH_REPO/contents/$path")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Accept", "application/vnd.github.v3+json")
            .put(bodyJson)
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw IOException("GitHub PUT ${response.code}: ${response.body?.string()}")
        }
        JSONObject(response.body!!.string())
            .getJSONObject("content")
            .getString("sha")
    }
}