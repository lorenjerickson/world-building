import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { loadLlmConfig, LlmConfig } from './llm.config';
import { LlmClient, LlmCompletion, LlmCompletionRequest, LlmProvider } from './llm.types';
import { NodeLlamaCppClient } from './node-llama-cpp.client';
import { OpenAiLlmClient } from './openai-llm.client';

@Injectable()
export class LlmService implements OnApplicationShutdown {
  private readonly logger = new Logger(LlmService.name);
  private readonly config: LlmConfig = loadLlmConfig();
  private readonly client?: LlmClient;

  constructor() {
    this.client = this.createClient();
    if (this.client) {
      this.logger.log(`Configured ${this.client.provider} text generation with model ${this.client.model}.`);
    } else {
      this.logger.warn(`${this.config.provider} text generation is selected but not configured.`);
    }
  }

  get provider(): LlmProvider {
    return this.config.provider;
  }

  get isConfigured(): boolean {
    return this.client !== undefined;
  }

  complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    if (!this.client) {
      const requiredSetting = this.config.provider === 'openai'
        ? 'OPENAI_API_KEY'
        : 'LLAMA_MODEL_PATH';
      throw new Error(`${this.config.provider} is selected but ${requiredSetting} is not configured.`);
    }
    return this.client.complete(request);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.dispose?.();
  }

  private createClient(): LlmClient | undefined {
    if (this.config.provider === 'openai') {
      if (!this.config.openai.apiKey) return undefined;
      return new OpenAiLlmClient(
        this.config.openai.apiKey,
        this.config.openai.model,
        this.config.maxTokens,
      );
    }

    if (!this.config.nodeLlamaCpp.modelPath) return undefined;
    return new NodeLlamaCppClient({
      modelPath: this.config.nodeLlamaCpp.modelPath,
      contextSize: this.config.nodeLlamaCpp.contextSize,
      gpuLayers: this.config.nodeLlamaCpp.gpuLayers,
      maxTokens: this.config.maxTokens,
    });
  }
}
