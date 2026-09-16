# Task List — Miku-AI Android Implementation

- [ ] **Etapa 1 — Sync y compilación base**
    - [ ] Add new dependencies to `app/build.gradle.kts`
    - [ ] Sync project with Gradle files
- [ ] **Etapa 2 — AndroidManifest y Recursos**
    - [ ] Replace `app/src/main/AndroidManifest.xml`
    - [ ] Create `app/src/main/res/drawable/ic_notification.xml`
- [ ] **Etapa 3 — Archivos Kotlin**
    - [ ] Create `MikuApp.kt`
    - [ ] Replace `MainActivity.kt`
    - [ ] Create data layer files (`Models.kt`, `SecurePrefs.kt`, `GitHubApi.kt`, `OpenRouterApi.kt`, `Prompts.kt`, `MarkerParser.kt`, `MikuRepository.kt`)
    - [ ] Create background worker file (`MikuNotificationWorker.kt`)
    - [ ] Create UI layer files (`Color.kt`, `Theme.kt`, `ChatViewModel.kt`, `SetupScreen.kt`, `ChatScreen.kt`)
- [ ] **Etapa 4 — Compilación y Verificación**
    - [ ] Run Build / Make Project
