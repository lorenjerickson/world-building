import { basename } from 'path';
import type {
  ChatHistoryItem,
  Llama,
  LlamaGrammar,
  LlamaModel,
} from 'node-llama-cpp';
import { LlmClient, LlmCompletion, LlmCompletionRequest } from './llm.types';

type NodeLlamaCppModule = typeof import('node-llama-cpp');

const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<NodeLlamaCppModule>;

interface NodeLlamaCppOptions {
  modelPath: string;
  contextSize: number;
  gpuLayers: 'auto' | 'max' | number;
  maxTokens: number;
}

interface LoadedRuntime {
  module: NodeLlamaCppModule;
  llama: Llama;
  model: LlamaModel;
  jsonGrammar?: LlamaGrammar;
}

export class NodeLlamaCppClient implements LlmClient {
  readonly provider = 'node-llama-cpp' as const;
  readonly model: string;
  private runtime?: Promise<LoadedRuntime>;

  constructor(private readonly options: NodeLlamaCppOptions) {
    this.model = basename(options.modelPath);
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const finalMessage = request.messages.at(-1);
    if (!finalMessage || finalMessage.role !== 'user') {
      throw new Error('node-llama-cpp completions require a final user message.');
    }

    const runtime = await this.loadRuntime();
    const context = await runtime.model.createContext({
      contextSize: this.options.contextSize,
    });
    const session = new runtime.module.LlamaChatSession({
      contextSequence: context.getSequence(),
    });

    try {
      const history = this.toChatHistory(request.messages.slice(0, -1));
      if (history.length > 0) session.setChatHistory(history);

      const grammar = request.responseFormat === 'json'
        ? await this.getJsonGrammar(runtime)
        : undefined;
      const result = await session.promptWithMeta(finalMessage.content, {
        grammar,
        maxTokens: request.maxTokens ?? this.options.maxTokens,
        temperature: request.temperature,
        signal: request.signal,
      });

      if (!result.responseText) throw new Error('node-llama-cpp returned an empty text completion.');

      return {
        text: result.responseText,
        provider: this.provider,
        model: this.model,
        finishReason: result.stopReason,
      };
    } finally {
      session.dispose();
      await context.dispose();
    }
  }

  async dispose(): Promise<void> {
    const runtime = await this.runtime?.catch(() => undefined);
    this.runtime = undefined;
    if (!runtime) return;

    await runtime.model.dispose();
    await runtime.llama.dispose();
  }

  private toChatHistory(messages: LlmCompletionRequest['messages']): ChatHistoryItem[] {
    return messages.map((message): ChatHistoryItem => {
      if (message.role === 'system') return { type: 'system', text: message.content };
      if (message.role === 'user') return { type: 'user', text: message.content };
      return { type: 'model', response: [message.content] };
    });
  }

  private async loadRuntime(): Promise<LoadedRuntime> {
    if (!this.runtime) {
      const loading = (async () => {
        const module = await importEsm('node-llama-cpp');
        const llama = await module.getLlama();
        try {
          const model = await llama.loadModel({
            modelPath: this.options.modelPath,
            gpuLayers: this.options.gpuLayers,
          });
          return { module, llama, model };
        } catch (error) {
          await llama.dispose();
          throw error;
        }
      })();
      this.runtime = loading;
      loading.catch(() => {
        if (this.runtime === loading) this.runtime = undefined;
      });
    }
    return this.runtime;
  }

  private async getJsonGrammar(runtime: LoadedRuntime): Promise<LlamaGrammar> {
    if (!runtime.jsonGrammar) runtime.jsonGrammar = await runtime.llama.getGrammarFor('json');
    return runtime.jsonGrammar;
  }
}
