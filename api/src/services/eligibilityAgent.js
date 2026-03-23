'use strict';

const { AnthropicClient } = require('./anthropicClient');
const { OpenAiClient }    = require('./openAiClient');

const DELAY_BETWEEN_CALLS_MS = 1500;

/**
 * Provider-agnostic eligibility agent.
 * Resolves the correct LLM client from environment variables.
 *
 * Supported providers (set LLM_PROVIDER):
 *   "anthropic"  — uses ANTHROPIC_API_KEY + ANTHROPIC_MODEL
 *   "openai"     — uses AZURE_OPENAI_API_KEY (Azure OpenAI endpoint is
 *                  hardcoded in openAiClient.js per deployment config)
 */
class EligibilityAgent {
  constructor() {
    const provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();

    if (provider === 'anthropic') {
      const key   = process.env.ANTHROPIC_API_KEY;
      const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-5';
      if (!key) throw new Error('ANTHROPIC_API_KEY environment variable is not set');
      this.client       = new AnthropicClient(key, model);
      this.providerName = `Anthropic (${model})`;
    } else {
      // Default: Azure OpenAI
      const key = process.env.AZURE_OPENAI_API_KEY;
      if (!key) throw new Error('AZURE_OPENAI_API_KEY environment variable is not set');
      this.client       = new OpenAiClient(key);
      this.providerName = 'Azure OpenAI (gpt-4o)';
    }
  }

  /**
   * Evaluate a single loan.
   * @param {object} loan      — normalised loan record
   * @param {string} pdfBase64 — base64-encoded PDF
   * @returns {Promise<object>}
   */
  async evaluateLoan(loan, pdfBase64) {
    return this.client.evaluateLoan(loan, pdfBase64);
  }

  /**
   * Evaluate a batch of loans sequentially with a delay between calls.
   * @param {object[]} loans
   * @param {string}   pdfBase64
   * @param {function} [onProgress]  (index, total, result)
   * @returns {Promise<object[]>}
   */
  async evaluateAll(loans, pdfBase64, onProgress) {
    const results = [];

    for (let i = 0; i < loans.length; i++) {
      if (i > 0) await sleep(DELAY_BETWEEN_CALLS_MS);

      const result = await this.client.evaluateLoan(loans[i], pdfBase64);
      results.push(result);

      if (onProgress) onProgress(i + 1, loans.length, result);
    }

    return results;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { EligibilityAgent };
