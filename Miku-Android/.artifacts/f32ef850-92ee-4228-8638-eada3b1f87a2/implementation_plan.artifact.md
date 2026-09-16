# Implementation Plan — Miku-AI Android

Implement a native Android app in Kotlin + Jetpack Compose that allows chatting with Miku, provides bidirectional memory via GitHub API, and shows periodic notifications.

## Proposed Changes

### Configuration & Manifest

#### [MODIFY] [build.gradle.kts](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/build.gradle.kts)
- Update dependencies block with:
    - `androidx.compose.material:material-icons-extended`
    - `androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7`
    - `androidx.navigation:navigation-compose:2.8.5`
    - `androidx.work:work-runtime-ktx:2.9.1`
    - `androidx.security:security-crypto:1.1.0-alpha06`
    - `com.squareup.okhttp3:okhttp:4.12.0`
    - `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1`

#### [MODIFY] [AndroidManifest.xml](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/AndroidManifest.xml)
- Add permissions: `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`.
- Update `<application>` with `android:name=".MikuApp"`.
- Add `ForceStopRunnable$BroadcastReceiver`.

### Application & Main Activity

#### [NEW] [MikuApp.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/MikuApp.kt)
- Create notification channel.

#### [MODIFY] [MainActivity.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/MainActivity.kt)
- Implement navigation between `SetupScreen` and `ChatScreen`.
- Handle notification permissions and schedule `MikuNotificationWorker`.

### Data Layer

#### [NEW] [Models.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/Models.kt)
- Define `ChatMessage`, `GitHubFile`, `MikuMemory`, and `ParsedResponse`.

#### [NEW] [SecurePrefs.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/SecurePrefs.kt)
- Manage encrypted credentials and pending notification messages.

#### [NEW] [GitHubApi.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/GitHubApi.kt)
- Implement `GET` and `PUT` calls to GitHub Contents API.

#### [NEW] [OpenRouterApi.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/OpenRouterApi.kt)
- Implement chat completion calls to OpenRouter.

#### [NEW] [Prompts.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/Prompts.kt)
- Constructors for chat and idle system prompts.

#### [NEW] [MarkerParser.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/MarkerParser.kt)
- Extract memory/personality markers and clean response text.

#### [NEW] [MikuRepository.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/MikuRepository.kt)
- Coordinate data operations.

### Background Worker

#### [NEW] [MikuNotificationWorker.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/worker/MikuNotificationWorker.kt)
- Periodically check for idle messages and show notifications.

### UI Layer

#### [NEW] [Color.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/ui/theme/Color.kt)
- Define Miku-themed color palette.

#### [NEW] [Theme.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/ui/theme/Theme.kt)
- Configure `MikuTheme`.

#### [NEW] [ChatViewModel.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/ui/ChatViewModel.kt)
- Manage chat state, message history, and memory persistence.

#### [NEW] [SetupScreen.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/ui/SetupScreen.kt)
- UI for entering API keys.

#### [NEW] [ChatScreen.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/ui/ChatScreen.kt)
- Main chat interface with typing indicator and settings.

### Resources

#### [NEW] [ic_notification.xml](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/res/drawable/ic_notification.xml)
- Vector icon for notifications.

## Verification Plan

### Automated Tests
- Run `gradle build` to ensure project compiles.

### Manual Verification
- Deploy to device/emulator.
- Verify navigation to `SetupScreen`.
- Enter credentials and verify transition to `ChatScreen`.
- Send messages and check for Miku's response.
- Verify GitHub commits for memory/personality updates.
- Test notification triggering (with reduced interval if needed).
