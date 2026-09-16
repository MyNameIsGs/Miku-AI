package com.sebas.mikuai

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.work.*
import com.sebas.mikuai.data.SecurePrefs
import com.sebas.mikuai.ui.ChatScreen
import com.sebas.mikuai.ui.SetupScreen
import com.sebas.mikuai.ui.theme.MikuTheme
import com.sebas.mikuai.worker.MikuNotificationWorker
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* resultado ignorado — el usuario puede denegar */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestNotificationPermissionIfNeeded()
        scheduleNotificationWorker()

        setContent {
            MikuTheme {
                val navController = rememberNavController()
                val prefs = remember { SecurePrefs(applicationContext) }
                val startRoute = if (prefs.hasCredentials()) "chat" else "setup"

                NavHost(navController = navController, startDestination = startRoute) {
                    composable("setup") {
                        SetupScreen(
                            onCredentialsSaved = {
                                navController.navigate("chat") {
                                    popUpTo("setup") { inclusive = true }
                                }
                            }
                        )
                    }
                    composable("chat") {
                        ChatScreen(
                            onLogout = {
                                navController.navigate("setup") {
                                    popUpTo("chat") { inclusive = true }
                                }
                            }
                        )
                    }
                }
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun scheduleNotificationWorker() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = PeriodicWorkRequestBuilder<MikuNotificationWorker>(6, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "miku_idle_check",
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }
}