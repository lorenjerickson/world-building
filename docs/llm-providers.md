# Text LLM providers

NestJS text generation uses an application-owned `LlmService` and provider-neutral request/response types. OpenAI and `node-llama-cpp` are adapters behind that boundary; generation code must not import either vendor SDK directly.

OpenAI remains the default for backward compatibility:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_LLM_MODEL=gpt-4o-mini
LLM_MAX_TOKENS=2048
```

To run a local GGUF instruction model, place it in the repository's ignored `models/` directory and configure:

```dotenv
LLM_PROVIDER=node-llama-cpp
LLAMA_MODEL_PATH=/models/your-model.gguf
LLAMA_CONTEXT_SIZE=8192
LLAMA_GPU_LAYERS=auto
LLM_MAX_TOKENS=2048
```

`LLAMA_MODEL_PATH` is the path visible to the backend process. Docker Compose mounts the repository's `models/` directory read-only at `/models`. For a backend running directly on the host, use an absolute host path instead.

`LLAMA_GPU_LAYERS` accepts `auto`, `max`, or a non-negative integer. The model and native runtime are loaded lazily on the first local completion, and the loaded model is reused. Each request gets an isolated context and chat session. JSON requests use llama.cpp's JSON grammar, while OpenAI uses JSON response mode.

If the selected provider lacks its required credential or model path, world and element generation retain the existing procedural fallback. Provider failures and malformed JSON also fall back without changing the public API response. OpenAI image generation is intentionally separate: `node-llama-cpp` is a text LLM adapter and does not replace the portrait/token image endpoints or their OpenAI image-model settings.

New text-generation features should depend on `LlmService` and use `LlmCompletionRequest`. Do not access `process.env`, instantiate `OpenAI`, or import `node-llama-cpp` from feature services.
