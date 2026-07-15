export type LlmProvider = 'openai' | 'node-llama-cpp';

export type LlmMessageRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmCompletion {
  text: string;
  provider: LlmProvider;
  model: string;
  finishReason?: string;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
  dispose?(): Promise<void>;
}
