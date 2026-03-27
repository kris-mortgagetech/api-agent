'use strict';

const { app }              = require('@azure/functions');
const { mapFromJson }      = require('../services/encompassMapper');
const { EligibilityAgent } = require('../services/eligibilityAgent');

/**
 * POST /api/evaluate-encompass
 *
 * Accepts a raw Encompass v3 loan JSON (single loan, array, or {loans:[...]} wrapper)
 * and maps it to the normalised loan shape before evaluating eligibility.
 *
 * Request body:
 * {
 *   "encompassLoan": { ...raw Encompass loan object... },
 *   "pdfBase64": "<base64-encoded PDF bytes>"
 * }
 *
 * Or for a batch (paste straight from Encompass export):
 * {
 *   "encompassLoan": [ { ...loan 1... }, { ...loan 2... } ],
 *   "pdfBase64": "..."
 * }
 */
app.http('evaluate-encompass', {
  methods:   ['POST'],
  authLevel: 'anonymous',
  handler:   async (request, context) => {

    context.log('evaluate-encompass: request received');

    let body;
    try {
      body = await request.json();
    } catch {
      return err(400, 'Request body must be valid JSON');
    }

    const { encompassLoan, pdfBase64 } = body;

    if (!encompassLoan) return err(400, 'Missing required field: "encompassLoan"');
    if (!pdfBase64)     return err(400, 'Missing required field: "pdfBase64"');

    // ── Map Encompass → normalised loans ──────────────────────────
    let loans;
    try {
      loans = mapFromJson(encompassLoan);
    } catch (e) {
      return err(400, `Encompass JSON mapping failed: ${e.message}`);
    }

    if (!loans.length) return err(400, 'No loans found in encompassLoan payload');

    // ── Init agent ────────────────────────────────────────────────
    let agent;
    try {
      agent = new EligibilityAgent();
    } catch (e) {
      return err(500, `Configuration error: ${e.message}`);
    }

    // ── Evaluate (single or batch) ────────────────────────────────
    try {
      if (loans.length === 1) {
        const result = await agent.evaluateLoan(loans[0], pdfBase64);
        return ok({ ...result, provider: agent.providerName, mapped_fields: loans[0] });
      }

      // Batch with delay between calls
      const results = [];
      for (let i = 0; i < loans.length; i++) {
        if (i > 0) await sleep(1500);
        context.log(`evaluate-encompass: loan ${i + 1}/${loans.length} — ${loans[i].loanNumber || 'unknown'}`);
        const result = await agent.evaluateLoan(loans[i], pdfBase64);
        results.push({ ...result, mapped_fields: loans[i] });
      }

      return ok({ results, total: results.length, provider: agent.providerName });

    } catch (e) {
      context.log(`ERROR: ${e.message}`);
      return err(502, `LLM evaluation error: ${e.message}`);
    }
  },
});

function ok(data) {
  return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
function err(status, message) {
  return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
