'use strict';

/**
 * Builds the system prompt and formats individual loan messages.
 * All eligibility rules come from the PDF — nothing is hardcoded here.
 */

const SYSTEM_PROMPT = `You are an expert mortgage underwriter. You will be given:
1. The official loan program guidelines as a PDF document
2. A loan application to evaluate

Your job is to carefully read the guidelines PDF and apply those rules
to determine whether the loan application is eligible.

## Status Definitions
- **Pass**    – The loan clearly meets this requirement based on the guidelines.
- **Warning** – Data is missing, ambiguous, or cannot be definitively determined.
- **Fail**    – The loan clearly violates a requirement in the guidelines.

## Important Instructions
- Base ALL decisions strictly on the rules in the attached PDF document.
- If the PDF is updated with new rules, apply those new rules — do not rely on prior knowledge.
- Reference specific values from the matrix when explaining your reasoning
  (e.g. "CLTV 85% exceeds max 80% per matrix: FICO 700-719 / $1M / Cash-Out / Investor").
- overall_status must be "Fail" if ANY test is Fail, "Warning" if ANY test is Warning
  (and no Fails), "Pass" only if ALL tests Pass.

## Required Output Format
Respond with ONLY a valid JSON object — no markdown fences, no explanation outside JSON:

{
  "loan_number": "string",
  "overall_status": "Pass" | "Warning" | "Fail",
  "summary": "One sentence explaining the overall result",
  "tests": [
    { "test_name": "Loan Amount",         "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "FICO Score",           "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "DTI",                  "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "Property Type",        "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "Credit Event",         "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "Payment History",      "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "Max CLTV",             "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "State Restrictions",   "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "Prepayment Penalty",   "status": "Pass|Warning|Fail", "reason": "..." },
    { "test_name": "Occupancy/Purpose",    "status": "Pass|Warning|Fail", "reason": "..." }
  ]
}`;

/**
 * Format a single normalised loan object as a markdown user message.
 * @param {object} loan
 * @returns {string}
 */
function formatLoanMessage(loan) {
  const val = (v) => (v === undefined || v === null || v === '') ? '(not provided)' : String(v);

  return `The attached PDF contains the official loan program guidelines. Please read it
carefully and evaluate the following loan application against those guidelines.

## Loan Application

**Loan Number:** ${val(loan.loanNumber)}
**Loan Program:** ${val(loan.loanProgram)}
**Loan Amount:** $${Number(loan.loanAmount || 0).toLocaleString()}
**Loan Type:** ${val(loan.loanType)}
**Loan Purpose:** ${val(loan.loanPurpose)}
**Occupancy:** ${val(loan.occupancyStatus)}
**Amortization Type:** ${val(loan.amortType)}

**FICO Score:** ${val(loan.ficoScore)}
**Credit Event:** ${val(loan.creditEvent)}
**Housing/Payment History:** ${val(loan.housingHistory)}
**Citizenship:** ${val(loan.citizenship)}

**Property Type:** ${val(loan.propertyType)}
**Units:** ${val(loan.units)}
**State:** ${val(loan.state)}
**Is Rural:** ${val(loan.isRural)}
**Is Condotel:** ${val(loan.isCondotel)}
**Is Non-Warrantable Condo:** ${val(loan.isNonWarrantable)}

**LTV:** ${val(loan.ltv)}%
**CLTV:** ${val(loan.cltv)}%
**DTI Front:** ${val(loan.dtiTop)}%
**DTI Back:** ${val(loan.dtiBottom)}%
**Interest Rate:** ${val(loan.interestRate)}%
**Term:** ${val(loan.termMonths)} months

**Interest Only:** ${val(loan.interestOnlyIndicator)}  IO Months: ${val(loan.interestOnlyMonths)}
**Income Doc Type:** ${val(loan.incomeDocType)}
**Prepayment Penalty:** ${val(loan.prepaymentPenalty)}  Period: ${val(loan.prepaymentPeriod)} months
**Escrow:** ${val(loan.escrow)}
**DSCR Ratio:** ${val(loan.dscrRatio)}

Evaluate all 10 tests and return only the JSON response.`;
}

module.exports = { SYSTEM_PROMPT, formatLoanMessage };
