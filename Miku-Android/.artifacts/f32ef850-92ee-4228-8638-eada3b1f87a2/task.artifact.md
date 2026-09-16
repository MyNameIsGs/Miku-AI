# Task List — Add Vision (Photo) Support to Miku-AI Android

- [x] **Etapa 1 — Actualizar Capa de Datos**
    - [x] Modify `Models.kt` to add `imageBytes` / Base64 attribute to history items if needed, or handle multimodal prompts.
    - [x] Update `OpenRouterApi.kt` to serialize multimodal requests.
    - [x] Update `MikuRepository.kt` to forward optional image parameters.
- [x] **Etapa 2 — Actualizar ViewModel y Lógica de Conversión**
    - [x] Modify `ChatViewModel.kt` to manage selected photo state, convert URI to scaled Base64, and pass to repository.
- [x] **Etapa 3 — Actualizar UI (Pantalla de Chat)**
    - [x] Update `ChatScreen.kt` to add Photo Picker launcher, render selected preview, and render images inside message bubbles.
- [x] **Etapa 4 — Compilación y Verificación**
    - [x] Run Build / Make Project
