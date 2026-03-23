'use strict';

const { SYSTEM_PROMPT, formatLoanMessage } = require('./systemPrompt');
const { parseResponse } = require('./anthropicClient');

const AZURE_ENDPOINT  = 'https://smart-advisor-ai.openai.azure.com';
const DEPLOYMENT_NAME = 'gpt-4o';
const API_VERSION     = '2024-12-01-preview';
const BASE_URL = `${AZURE_ENDPOINT}/openai/deployments/${DEPLOYMENT_NAME}/chat/completions?api-version=${API_VERSION}`;

// Tuning constants
const RENDER_SCALE    = 1.5;   // 1.5x ≈ 108 DPI — good quality, ~44% less data than 2x
const MAX_PDF_PAGES   = 10;    // cap pages sent to avoid token overload
const REQUEST_TIMEOUT = 120_000; // 2 min timeout on the fetch

// ── pdfjs lazy loader ─────────────────────────────────────────────
let _pdfjs = null;
async function getPdfjs() {
  if (!_pdfjs) {
    _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return _pdfjs;
}

// ── Canvas factory ────────────────────────────────────────────────
// @napi-rs/canvas is bundled inside pdfjs-dist/node_modules — no extra install.
// Its context exposes context.canvas which pdfjs v5 requires.
let _createCanvas = null;
function getCreateCanvas() {
  if (!_createCanvas) {
    try {
      _createCanvas = require('pdfjs-dist/node_modules/@napi-rs/canvas').createCanvas;
    } catch {
      _createCanvas = require('@napi-rs/canvas').createCanvas;
    }
  }
  return _createCanvas;
}

function makeCanvasFactory() {
  const createCanvas = getCreateCanvas();
  return {
    create(w, h)   { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; },
    reset(e, w, h) { e.canvas.width = w; e.canvas.height = h; },
    destroy(e)     { e.canvas.width = 0; e.canvas.height = 0; },
  };
}

/**
 * Azure OpenAI client (GPT-4o).
 * Renders PDF pages to PNG images and sends them as vision blocks.
 */
class OpenAiClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async evaluateLoan(loan, pdfBase64, { maxTokens = 2000, maxRetries = 6 } = {}) {
    const userMessage = formatLoanMessage(loan);
    const pageImages  = await pdfToBase64Images(pdfBase64);
    console.log(`[OpenAI] Sending ${pageImages.length} page image(s) to Azure OpenAI...`);
    const raw = await this._sendWithRetry(userMessage, pageImages, maxTokens, maxRetries);
    return parseResponse(raw, loan);
  }

  async _sendWithRetry(userMessage, pageImages, maxTokens, maxRetries) {
    const body    = buildOpenAiPayload(SYSTEM_PROMPT, userMessage, pageImages, maxTokens);
    const bodyStr = JSON.stringify(body);
    const payloadKb = Math.round(bodyStr.length / 1024);
    console.log(`[OpenAI] Payload size: ${payloadKb} KB`);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      console.log(`[OpenAI] POST attempt ${attempt + 1}/${maxRetries + 1}...`);

      // Abort controller for timeout
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      let res, text;
      try {
        res  = await fetch(BASE_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': this.apiKey },
          body:    bodyStr,
          signal:  controller.signal,
        });
        text = await res.text();
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError')
          throw new Error(`Azure OpenAI request timed out after ${REQUEST_TIMEOUT / 1000}s`);
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const data = JSON.parse(text);
        console.log(`[OpenAI] Response received OK`);
        return data.choices[0].message.content;
      }

      if (res.status === 429) {
        if (attempt === maxRetries)
          throw new Error(`Azure OpenAI rate limit after ${maxRetries} retries: ${text}`);
        const wait = getRetryAfter(res, 30 + attempt * 15);
        console.warn(`[OpenAI] Rate limited. Waiting ${wait}s...`);
        await sleep(wait * 1000);
        continue;
      }

      throw new Error(`Azure OpenAI API error ${res.status}: ${text}`);
    }
  }
}

// ── PDF → PNG pages ────────────────────────────────────────────────

async function pdfToBase64Images(pdfBase64) {
  const pdfjsLib      = await getPdfjs();
  const canvasFactory = makeCanvasFactory();

  const loadingTask = pdfjsLib.getDocument({
    data:           new Uint8Array(Buffer.from(pdfBase64, 'base64')),
    canvasFactory,
    useSystemFonts: true,
    verbosity:      0,
  });

  const pdfDoc   = await loadingTask.promise;
  const numPages = Math.min(pdfDoc.numPages, MAX_PDF_PAGES);
  console.log(`[pdfjs] Rendering ${numPages}/${pdfDoc.numPages} page(s) at ${RENDER_SCALE}x scale...`);

  const pages = [];

  for (let i = 1; i <= numPages; i++) {
    const page     = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const entry    = canvasFactory.create(viewport.width, viewport.height);

    await page.render({ canvasContext: entry.context, viewport }).promise;

    const b64 = entry.canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    pages.push(b64);

    const kb = Math.round(b64.length * 0.75 / 1024);
    console.log(`[pdfjs] Page ${i}: ${Math.round(viewport.width)}x${Math.round(viewport.height)} — ${kb} KB`);

    page.cleanup();
    canvasFactory.destroy(entry);
  }

  return pages;
}

// ── Payload builder ────────────────────────────────────────────────

function buildOpenAiPayload(systemPrompt, userMessage, pageImages, maxTokens) {
  const userContent = [];

  for (const b64 of pageImages) {
    userContent.push({
      type:      'image_url',
      image_url: { url: `data:image/png;base64,${b64}`, detail: 'high' },
    });
  }

  userContent.push({ type: 'text', text: userMessage });

  return {
    max_tokens:  maxTokens,
    temperature: 1.0,
    top_p:       1.0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ],
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function getRetryAfter(res, defaultSec) {
  for (const h of ['retry-after', 'x-ratelimit-reset-requests']) {
    const raw = res.headers.get(h);
    const n   = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return defaultSec;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { OpenAiClient };
