import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Client ID/Secret de Gmail (cliente OAuth tipo "Aplicación web") --
// viven en local.properties, no en el código, porque el repo es público
// y el Client Secret sí es sensible (a diferencia del Client ID de
// Spotify, que usa PKCE y no necesita secreto). Mismo espíritu que el
// .env del lado desktop.
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) load(file.inputStream())
}

android {
    namespace = "com.sebas.mikuai"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.sebas.mikuai"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // onnxruntime-android (wake-word "Hey Miku") trae binarios nativos
        // para 4 arquitecturas -- este es un APK de uso personal instalado
        // a mano, no Play Store, y el único dispositivo real es un
        // Redmagic 11 Pro (arm64). Sin este filtro el .apk pesa ~100MB.
        ndk {
            abiFilters += listOf("arm64-v8a")
        }

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField(
            "String",
            "GMAIL_WEB_CLIENT_ID",
            "\"${localProperties.getProperty("gmail.webClientId", "")}\"",
        )
        buildConfigField(
            "String",
            "GMAIL_WEB_CLIENT_SECRET",
            "\"${localProperties.getProperty("gmail.webClientSecret", "")}\"",
        )
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)

    // NUEVA — íconos extendidos de Material
    implementation("androidx.compose.material:material-icons-extended")

    // NUEVA — ViewModel + Compose
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // NUEVA — Navegación Compose
    implementation("androidx.navigation:navigation-compose:2.8.5")

    // NUEVA — WorkManager
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // NUEVA — EncryptedSharedPreferences
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // NUEVA — OkHttp (para GitHub API y OpenRouter)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // NUEVA — Coroutines Android
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // NUEVA — Coil (para mostrar imágenes)
    implementation("io.coil-kt:coil-compose:2.7.0")

    // NUEVA — AuthorizationClient de Play Services, para la conexión
    // nativa de Gmail (sin navegador ni redirect -- Google restringe los
    // esquemas de URL personalizados en Android, a diferencia de Spotify)
    implementation("com.google.android.gms:play-services-auth:21.4.0")

    // NUEVA — ONNX Runtime Mobile, para correr en el celular el MISMO
    // modelo entrenado con nanowakeword que usa el wake-word "Hey Miku"
    // en desktop (melspectrogram + embedding + clasificador, los tres
    // .onnx embebidos en assets/wakeword/) -- ver wakeword/WakeWordEngine.kt
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")

    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}