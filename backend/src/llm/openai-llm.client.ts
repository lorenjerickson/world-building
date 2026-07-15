import OpenAI from 'openai';
import { LlmClient, LlmCompletion, LlmCompletionRequest } from './llm.types';

export class OpenAiLlmClient implements LlmClient {
  readonly provider = 'openai' as const;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly defaultMaxTokens: number,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_tokens: request.maxTokens ?? this.defaultMaxTokens,
        temperature: request.temperature,
        response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      },
      { signal: request.signal },
    );

    const choice = completion.choices[0];
    const text = choice?.message?.content;
    if (!text) throw new Error('OpenAI returned an empty text completion.');

    return {
      text,
      provider: this.provider,
      model: this.model,
      finishReason: choice.finish_reason ?? undefined,
    };
  }
}
