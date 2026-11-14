/// Config patches for credential-request targets (`shared/credential-request.ts`).
Map<String, Object?>? configPatchForCredential(String target, String value) {
  return switch (target) {
    'openaiApiKey' => {
      'openai': {'key': value},
    },
    'anthropicApiKey' => {
      'anthropic': {'key': value, 'everyClaudeBot': false},
    },
    'openrouterApiKey' => {
      'openrouter': {'key': value},
    },
    'xaiApiKey' => {
      'xai': {'key': value},
    },
    'mistralApiKey' => {
      'mistral': {'key': value},
    },
    'cerebrasApiKey' => {
      'cerebras': {'key': value},
    },
    'groqApiKey' => {
      'groq': {'key': value},
    },
    'greenferenceApiKey' => {
      'greenference': {'key': value},
    },
    'metaApiKey' => {
      'meta': {'key': value},
    },
    'kimiApiKey' => {
      'kimi': {'key': value},
    },
    'deepseekApiKey' => {
      'deepseek': {'key': value},
    },
    'opencodeGoApiKey' => {
      'opencodeGo': {'apiKey': value},
    },
    'composioApiKey' => {
      'composio': {'apiKey': value},
    },
    'boxToken' => {
      'box': {'token': value},
    },
    'ttsKey' => {
      'tts': {'key': value},
    },
    'geminiTtsKey' => {
      'tts': {'geminiKey': value},
    },
    'fishAudioKey' => {
      'tts': {'fishKey': value},
    },
    'openaiImageApiKey' => {
      'imageGen': {'key': value},
    },
    _ => null,
  };
}

bool isOnePasswordTarget(String target) => target == 'onePasswordToken';
bool isCustomOrEmailTarget(String target, String? delivery) =>
    target == 'customSecret' || delivery == 'email';
