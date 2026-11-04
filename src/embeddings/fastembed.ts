import { EmbeddingModel, FlagEmbedding } from 'fastembed';

import type { EmbeddingProvider } from '../interfaces.js';

export interface FastEmbedOptions {
    model?: Exclude<EmbeddingModel, EmbeddingModel.CUSTOM>;
    cacheDir?: string;
    showDownloadProgress?: boolean;
}

/**
 * Default zero-cost embedding provider. Runs a quantized ONNX model locally
 * (no API key, no network after the first model download).
 */
export class FastEmbedProvider implements EmbeddingProvider {
    private model: FlagEmbedding | null = null;
    private cachedDimensions: number | null = null;

    constructor(private readonly options: FastEmbedOptions = {}) {}

    async init(): Promise<void> {
        if (this.model) return;
        this.model = await FlagEmbedding.init({
            model: this.options.model ?? EmbeddingModel.BGESmallENV15,
            ...(this.options.cacheDir !== undefined ? { cacheDir: this.options.cacheDir } : {}),
            showDownloadProgress: this.options.showDownloadProgress ?? false,
        });
    }

    private async ensure(): Promise<FlagEmbedding> {
        await this.init();
        if (!this.model) throw new Error('FastEmbedProvider failed to initialize');
        return this.model;
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        const model = await this.ensure();
        const out: number[][] = [];
        for await (const batch of model.embed(texts, 64)) {
            out.push(...batch);
        }
        return out;
    }

    async embedQuery(text: string): Promise<number[]> {
        const model = await this.ensure();
        return model.queryEmbed(text);
    }

    async getDimensions(): Promise<number> {
        if (this.cachedDimensions !== null) return this.cachedDimensions;
        const probe = await this.embedQuery('dimension probe');
        this.cachedDimensions = probe.length;
        return this.cachedDimensions;
    }
}
