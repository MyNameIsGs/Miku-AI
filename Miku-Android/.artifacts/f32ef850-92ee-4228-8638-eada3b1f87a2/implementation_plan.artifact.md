# Implementation Plan — Add Vision (Photo) Support to Miku-AI Android

Enable users to send photos to Hatsune Miku within the chat interface, taking advantage of the already configured `deepseek/deepseek-v4-flash-vision-exp` model on OpenRouter.

## Proposed Changes

### Data Layer

#### [MODIFY] [Models.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/Models.kt)
- Support a list of content parts or a separate attribute for base64 image data in `ChatMessage` or update serialization strategy for OpenRouter messages.
- Add an optional `imageUri: String?` property to `UiMessage` to display images in the message log UI.

#### [MODIFY] [OpenRouterApi.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/OpenRouterApi.kt)
- Refactor the `chat` method to support multimodal message structures when an image is present.
- Support sending content arrays following the standard OpenAI/OpenRouter Vision API standard:
  ```json
  "content": [
    { "type": "text", "text": "What is this?" },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
  ]
  ```

#### [MODIFY] [MikuRepository.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/data/MikuRepository.kt)
- Update the `chat` delegation signature to pass the optional image data to the `OpenRouterApi`.

### UI Layer

#### [MODIFY] [ChatViewModel.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/ui/ChatViewModel.kt)
- Update `UiMessage` declaration to hold an optional `imageUri` or `bitmap`.
- Expand `sendMessage` to accept an optional image Uri or Base64 string, converting the selected image into a scaled base64 payload to ensure it stays within request limits.

#### [MODIFY] [ChatScreen.kt](file:///C:/Users/sebas/MikuAI-Project/Miku-Android/app/src/main/java/com/sebas/mikuai/ui/ChatScreen.kt)
- Integrate an **Attachment/Image Picker** button next to the text input field utilizing `rememberLauncherForActivityResult` with `ActivityResultContracts.PickVisualMedia()`.
- Render a preview box of the selected image above the input text field with a "Remove" option.
- Update `MessageBubble` to check for `imageUri` and display the image cleanly above or inside the user message bubble using a basic `AsyncImage` equivalent or loading from ContentResolver to local view state.

## Verification Plan

### Automated Tests
- Run `gradle build` to ensure project compiles and contains no broken Compose layout definitions.

### Manual Verification
- Deploy to Redmagic.
- Open chat screen, click the attachment button, select a photo from the gallery.
- Observe the image preview. Type a prompt like *"¿Qué opinas de esta imagen?"* and send.
- Ensure Miku analyzes the image content correctly in her response text.
