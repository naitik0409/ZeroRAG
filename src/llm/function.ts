import type { ChatMessage, LLMAdapter, LLMOptions } from '../interfaces.js';

export type LLMFunction = (messages: ChatMessage[], opts?: LLMOptions) => string | Promise<string>;

/**
 * Wrap any custom function as an LLM adapter — the escape hatch for
 * Vercel AI SDK (`generateText`), LangChain, in-house gateways, or tests.
 *
 * @example
 * new FunctionAdapter(async (messages) => {
 *   const { text } = await generateText({ model: openai('gpt-4o-mini'), messages });
 *   return text;
 * })
 */
export class FunctionAdapter implements LLMAdapter {
    readonly name: string;

    constructor(
        private readonly fn: LLMFunction,
        name = 'function',
    ) {
        this.name = name;
    }

    async complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string> {
        return this.fn(messages, opts);
    }
}
