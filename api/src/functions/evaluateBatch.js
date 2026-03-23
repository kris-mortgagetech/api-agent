'use strict';

const { app }              = require('@azure/functions');
const { normalizeLoan }    = require('../models/loanMapping');
const { EligibilityAgent } = require('../services/eligibilityAgent');

/**
 * POST /api/evaluate-batch
 *
 * Evaluates a batch of loans against the guidelines PDF.
 * Processed sequentially with a delay between calls to respect rate limits.
 *
 * Request body (JSON):
 * {
 *   "loans": [ { ...loan1 }, { ...loan2 } ],
 *   "pdfBase64": "<base64-encoded PDF bytes>"
 * }
 */
app.http('evaluate-batch', {
  methods:   ['POST'],
  authLevel: 'anonymous',
  handler:   async (request, context) => {

    context.log('evaluate-batch: request received');

    // ── Parse body ──────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'Request body must be valid JSON');
    }

    const { loans: rawLoans, pdfBase64 } = body;

    if (!Array.isArray(rawLoans) || rawLoans.length === 0) {
      return errorResponse(400, 'Missing or empty required field: "loans" (array)');
    }
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return errorResponse(400, 'Missing required field: "pdfBase64" (base64 string)');
    }

    const MAX_BATCH = 100;
    if (rawLoans.length > MAX_BATCH) {
      return errorResponse(400, `Batch size ${rawLoans.length} exceeds maximum of ${MAX_BATCH}`);
    }

    // ── Normalise ───────────────────────────────────────────────
    const loans   = rawLoans.map(normalizeLoan);
    const missing = loans.filter(l => !l.loanNumber);
    if (missing.length > 0) {
      return errorResponse(400,
        `${missing.length} loan(s) are missing a loan number. ` +
        'Include "loanNumber" or "Trans Details Loan #" in each loan object.');
    }

    // ── Init agent ──────────────────────────────────────────────
    let agent;
    try {
      agent = new EligibilityAgent();
    } catch (err) {
      context.log(`ERROR: Agent init failed: ${err.message}`);
      return errorResponse(500, `Configuration error: ${err.message}`);
    }

    context.log(`evaluate-batch: evaluating ${loans.length} loans via ${agent.providerName}`);

    // ── Evaluate ────────────────────────────────────────────────
    let results;
    try {
      results = await agent.evaluateAll(
        loans,
        pdfBase64,
        (done, total, result) => {
          context.log(`  [${done}/${total}] Loan ${result.loan_number} -> ${result.overall_status}`);
        }
      );
    } catch (err) {
      context.log(`ERROR: Batch evaluation failed: ${err.message}`);
      return errorResponse(502, `LLM evaluation error: ${err.message}`);
    }

    // ── Summarise ───────────────────────────────────────────────
    const summary = {
      pass:    results.filter(r => r.overall_status === 'Pass').length,
      warning: results.filter(r => r.overall_status === 'Warning').length,
      fail:    results.filter(r => r.overall_status === 'Fail').length,
    };

    return {
      status:  200,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ provider: agent.providerName, total: results.length, summary, results }),
    };
  },
});

function errorResponse(status, message) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ error: message }),
  };
}
