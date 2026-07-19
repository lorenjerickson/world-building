import { LlmProvider } from './llm.types';

export interface LlmConfig {
  provider: LlmProvider;
  maxTokens: number;
  openai: {
    apiKey?: string;
    model: string;
  };
  nodeLlamaCpp: {
    modelPath?: string;
    contextSize: number;
    gpuLayers: 'auto' | 'max' | number;
  };
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!optionalValue(value)) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function gpuLayers(value: string | undefined): 'auto' | 'max' | number {
  const configured = optionalValue(value) ?? 'auto';
  if (configured === 'auto' || configured === 'max') return configured;

  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('LLAMA_GPU_LAYERS must be "auto", "max", or a non-negative integer.');
  }
  return parsed;
}

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = optionalValue(env.LLM_PROVIDER) ?? 'openai';
  if (provider !== 'openai' && provider !== 'node-llama-cpp') {
    throw new Error('LLM_PROVIDER must be either "openai" or "node-llama-cpp".');
  }

  return {
    provider,
    maxTokens: positiveInteger(env.LLM_MAX_TOKENS, 2048, 'LLM_MAX_TOKENS'),
    openai: {
      apiKey: optionalValue(env.OPENAI_API_KEY),
      model: optionalValue(env.OPENAI_LLM_MODEL) ?? 'gpt-4o-mini',
    },
    nodeLlamaCpp: {
      modelPath: optionalValue(env.LLAMA_MODEL_PATH),
      contextSize: positiveInteger(env.LLAMA_CONTEXT_SIZE, 8192, 'LLAMA_CONTEXT_SIZE'),
      gpuLayers: gpuLayers(env.LLAMA_GPU_LAYERS),
    },
  };
}
