'use strict';

const { app }              = require('@azure/functions');
const { normalizeLoan }    = require('../models/loanMapping');
const { EligibilityAgent } = require('../services/eligibilityAgent');

/**
 * POST /api/evaluate-loan
 *
 * Evaluates a single loan application against the guidelines PDF.
 *
 * Request body (JSON):
 * {
 *   "loan": { "loanNumber": "...", "loanAmount": 750000, ... },
 *   "pdfBase64": "<base64-encoded PDF bytes>"
 * }
 */
app.http('evaluate-loan', {
  methods:   ['POST'],
  authLevel: 'anonymous',
  handler:   async (request, context) => {

    context.log('evaluate-loan: request received');

    // ── Parse body ──────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'Request body must be valid JSON');
    }

    const { loan: rawLoan, pdfBase64 } = body;

    if (!rawLoan || typeof rawLoan !== 'object') {
      return errorResponse(400, 'Missing required field: "loan" (object)');
    }
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return errorResponse(400, 'Missing required field: "pdfBase64" (base64 string)');
    }

    // ── Normalise ───────────────────────────────────────────────
    const loan = normalizeLoan(rawLoan);
    if (!loan.loanNumber) {
      return errorResponse(400, 'Loan must include a loan number (loanNumber or "Trans Details Loan #")');
    }

    // ── Init agent ──────────────────────────────────────────────
    let agent;
    try {
      agent = new EligibilityAgent();
    } catch (err) {
      context.log(`ERROR: Agent init failed: ${err.message}`);
      return errorResponse(500, `Configuration error: ${err.message}`);
    }

    // ── Evaluate ────────────────────────────────────────────────
    let result;
    try {
      result = await agent.evaluateLoan(loan, pdfBase64);
    } catch (err) {
      context.log(`ERROR: Evaluation failed: ${err.message}`);
      return errorResponse(502, `LLM evaluation error: ${err.message}`);
    }

    return {
      status:  200,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...result, provider: agent.providerName }),
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
