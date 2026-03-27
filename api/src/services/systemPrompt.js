'use strict';

/**
 * System prompt and loan message formatter.
 * Fully program-agnostic — the LLM derives all tests and rules from the PDF.
 * Works for any eligibility matrix: Alt Plus, FNMA, FHLMC, FHA, VA, USDA, etc.
 *
 * Changes vs. previous version:
 *   NEW  selfEmployed field added to Borrower section
 *   NEW  Derogatory Credit History section (conditional — only rendered when relevant)
 *   NEW  bankruptcyIndicator, bankruptcyType, bankruptcyDate, bankruptcyStatus
 *   NEW  foreclosureIndicator, foreclosureDate
 */

const SYSTEM_PROMPT = `You are an expert mortgage underwriter. You will be given:
1. The official loan program eligibility guidelines as a PDF document
2. A loan application to evaluate

Your job is to carefully read the guidelines PDF and apply those rules
to determine whether the loan application is eligible.

## Status Definitions
- **Pass**    – The loan clearly meets this requirement based on the guidelines.
- **Warning** – Data is missing, ambiguous, or cannot be definitively determined. Manual review needed.
- **Fail**    – The loan clearly violates a requirement in the guidelines. Hard stop.

## Important Instructions
- Base ALL decisions strictly on the rules in the attached PDF document.
- Do NOT rely on prior knowledge — if the PDF says something different from what you know, follow the PDF.
- Derive the eligibility tests directly from the PDF. Use the section headings, matrix rows, and notes
  in the document to determine what tests are relevant for this loan scenario.
- For each test, reference the specific value or rule from the matrix
  (e.g. "LTV 88% exceeds max 85% per matrix: Investment Property / Purchase / 1 Unit / FRM").
- overall_status rules:
    - "Fail"    if ANY test status is "Fail"
    - "Warning" if no Fails but ANY test status is "Warning"
    - "Pass"    only if ALL tests are "Pass"

## Required Output Format
Respond with ONLY a valid JSON object — no markdown fences, no explanation outside the JSON:

{
  "loan_number": "string",
  "overall_status": "Pass" | "Warning" | "Fail",
  "summary": "One sentence explaining the overall eligibility result",
  "program": "Name of the program/matrix applied (e.g. FNMA Standard DU, Alt Plus 30)",
  "tests": [
    {
      "test_name": "Short descriptive name for this eligibility check",
      "status": "Pass" | "Warning" | "Fail",
      "reason": "Concise explanation referencing the specific matrix value or rule"
    }
  ]
}

The number of tests is determined by the PDF — include every relevant check for this loan scenario.
Do not invent tests that are not in the guidelines PDF.`;

/**
 * Format a normalised loan record as a structured user message.
 * Includes all fields relevant to conventional (FNMA/FHLMC), non-QM (Alt Plus, DSCR),
 * government (FHA, VA, USDA), and derogatory-credit scenarios.
 *
 * @param {object} loan - normalised loan record from encompassMapper / normalizeLoan
 * @returns {string}
 */
function formatLoanMessage(loan) {
  const val = (v) => (v === undefined || v === null || v === '') ? '(not provided)' : String(v);

  // Build the derogatory credit block conditionally — only include when relevant
  const derogsBlock = buildDerogatoryBlock(loan);

  return `The attached PDF contains the official loan program eligibility guidelines.
Please read it carefully and evaluate the following loan application.

## Loan Application

**Loan Number:** ${val(loan.loanNumber)}
**Loan Program:** ${val(loan.loanProgram)}
**Loan Amount:** $${Number(loan.loanAmount || 0).toLocaleString()}
**Loan Purpose:** ${val(loan.loanPurpose)}
**Loan Type / Amortization:** ${val(loan.loanType)} / ${val(loan.amortType)}
**Occupancy:** ${val(loan.occupancyStatus)}
**Underwriting Method:** ${val(loan.riskAssessType)}

## Borrower
**FICO Score:** ${val(loan.ficoScore)}
**Citizenship:** ${val(loan.citizenship)}
**Credit Event:** ${val(loan.creditEvent)}
**Housing / Payment History:** ${val(loan.housingHistory)}
**Income Doc Type:** ${val(loan.incomeDocType)}
**Loan Qualification Type:** ${val(loan.loanQualificationType)}
**Self-Employed:** ${val(loan.selfEmployed)}
**First-Time Home Buyer:** ${val(loan.firstTimeHomeBuyer)}
**Non-Occupant Borrower:** ${val(loan.nonOccupantBorrower)}
**Number of Financed Properties:** ${val(loan.numFinancedProperties)}
${derogsBlock}
## Property
**Property Type:** ${val(loan.propertyType)}
**Number of Units:** ${val(loan.units)}
**State:** ${val(loan.state)}
**Is Rural:** ${val(loan.isRural)}
**Is Condotel:** ${val(loan.isCondotel)}
**Is Non-Warrantable Condo:** ${val(loan.isNonWarrantable)}
**Is Manufactured Housing:** ${val(loan.isManufactured)}
**Is High-Balance Loan:** ${val(loan.isHighBalance)}
**Subordinate / Community Seconds Financing:** ${val(loan.subordinateFinancing)}

## Financials
**LTV:** ${val(loan.ltv)}%
**CLTV:** ${val(loan.cltv)}%
**HCLTV:** ${val(loan.hcltv)}%
**DTI (Front / Back):** ${val(loan.dtiTop)}% / ${val(loan.dtiBottom)}%
**Reserves (months):** ${val(loan.reservesMonths)}
**Interest Rate:** ${val(loan.interestRate)}%
**Term:** ${val(loan.termMonths)} months

## Loan Features
**Interest Only:** ${val(loan.interestOnlyIndicator)}  IO Months: ${val(loan.interestOnlyMonths)}
**Prepayment Penalty:** ${val(loan.prepaymentPenalty)}  Period: ${val(loan.prepaymentPeriod)} months
**Escrow:** ${val(loan.escrow)}
**Buydown:** ${val(loan.buydown)}
**DSCR Ratio:** ${val(loan.dscrRatio)}

Evaluate this loan against all applicable sections of the guidelines PDF and return only the JSON response.`;
}

/**
 * Build the Derogatory Credit History section of the prompt.
 * Returns an empty string when both bankruptcyIndicator and foreclosureIndicator are absent/N
 * so clean-credit loans don't carry unnecessary waiting-period sections.
 *
 * @param {object} loan
 * @returns {string}
 */
function buildDerogatoryBlock(loan) {
  const hasBk = loan.bankruptcyIndicator === 'Y';
  const hasFc = loan.foreclosureIndicator === 'Y';

  if (!hasBk && !hasFc) return '';

  const val  = (v) => (v === undefined || v === null || v === '') ? '(not provided)' : String(v);
  const lines = ['\n## Derogatory Credit History'];

  if (hasBk) {
    lines.push('**Bankruptcy:** Yes');
    if (loan.bankruptcyType)   lines.push(`**Bankruptcy Chapter:** ${val(loan.bankruptcyType)}`);
    if (loan.bankruptcyStatus) lines.push(`**Bankruptcy Status:** ${val(loan.bankruptcyStatus)}`);
    if (loan.bankruptcyDate)   lines.push(`**Bankruptcy Date:** ${val(loan.bankruptcyDate)}`);
  }

  if (hasFc) {
    lines.push('**Foreclosure:** Yes');
    if (loan.foreclosureDate)  lines.push(`**Foreclosure Date:** ${val(loan.foreclosureDate)}`);
  }

  return lines.join('\n') + '\n';
}

module.exports = { SYSTEM_PROMPT, formatLoanMessage };
