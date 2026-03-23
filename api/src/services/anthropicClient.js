'use strict';

const { SYSTEM_PROMPT, formatLoanMessage } = require('./systemPrompt');

const BASE_URL    = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const BETA_HEADER = 'prompt-caching-2024-07-31';

/**
 * Anthropic client.
 * - Attaches the PDF as a native document block with cache_control=ephemeral
 *   so the PDF is processed once and cached for ~5 minutes on Anthropic's servers.
 * - Retries on 429 using the Retry-After response header.
 */
class AnthropicClient {
  /**
   * @param {string} apiKey
   * @param {string} [model]
   */
  constructor(apiKey, model = 'claude-opus-4-5') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  /**
   * @param {object}  loan        — normalised loan record
   * @param {string}  pdfBase64   — base64-encoded PDF bytes
   * @param {object}  [opts]
   * @param {number}  [opts.maxTokens=1500]
   * @param {number}  [opts.maxRetries=6]
   * @returns {Promise<object>}   parsed AgentEligibilityResult
   */
  async evaluateLoan(loan, pdfBase64, { maxTokens = 1500, maxRetries = 6 } = {}) {
    const userMessage = formatLoanMessage(loan);
    const raw = await this._sendWithRetry(userMessage, pdfBase64, maxTokens, maxRetries);
    return parseResponse(raw, loan);
  }

  async _sendWithRetry(userMessage, pdfBase64, maxTokens, maxRetries) {
    const body = buildAnthropicPayload(
      this.model, SYSTEM_PROMPT, userMessage, pdfBase64, maxTokens
    );
    const bodyStr = JSON.stringify(body);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res  = await fetch(BASE_URL, {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-api-key':       this.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-beta':  BETA_HEADER,
        },
        body: bodyStr,
      });

      const text = await res.text();

      if (res.ok) {
        const data = JSON.parse(text);
        return data.content[0].text;
      }

      if (res.status === 429) {
        if (attempt === maxRetries) throw new Error(`Anthropic rate limit after ${maxRetries} retries: ${text}`);
        const wait = getRetryAfter(res, 30 + attempt * 15);
        console.warn(`[Anthropic] Rate limited. Waiting ${wait}s (retry ${attempt + 1}/${maxRetries})`);
        await sleep(wait * 1000);
        continue;
      }

      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function buildAnthropicPayload(model, systemPrompt, userMessage, pdfBase64, maxTokens) {
  const contentParts = [];

  if (pdfBase64) {
    contentParts.push({
      type:   'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
      // Prompt caching — Anthropic reuses the PDF across calls in the same session
      cache_control: { type: 'ephemeral' },
    });
  }

  contentParts.push({ type: 'text', text: userMessage });

  return {
    model,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: contentParts }],
  };
}

function getRetryAfter(res, defaultSec) {
  const raw = res.headers.get('retry-after');
  const n   = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultSec;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Parse the raw LLM text into a structured result object.
 * Strips markdown fences if present.
 */
function parseResponse(raw, loan) {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed  = JSON.parse(cleaned);
    parsed.loanNumber ??= loan.loanNumber;
    return parsed;
  } catch {
    return {
      loan_number:    loan.loanNumber,
      overall_status: 'Warning',
      summary:        'LLM response could not be parsed — manual review required.',
      raw_response:   raw,
      tests: [{
        test_name: 'Parse Error',
        status:    'Warning',
        reason:    `Raw snippet: ${raw.slice(0, 300)}`,
      }],
    };
  }
}

module.exports = { AnthropicClient, parseResponse };
