'use strict';

/**
 * Canonical field names used throughout the API.
 * These map directly from the Excel column headers to JSON keys.
 *
 * Callers may send either the canonical key (camelCase) OR
 * the original Excel column header — both are accepted.
 */
const FIELD_MAP = {
  // ── Identity ──────────────────────────────────────────────────
  loanNumber:           'Trans Details Loan #',
  loanProgram:          'Trans Details Loan Program',
  loanAmount:           'Trans Details Total Loan Amt (w/ MIP/FF)',
  loanType:             'Trans Details Loan Type',
  loanPurpose:          'Trans Details Loan Purpose',
  occupancyStatus:      'Subject Property Occupancy Status',
  amortType:            'Trans Details Amort Type',

  // ── Credit / Borrower ─────────────────────────────────────────
  ficoScore:            'VA Loan Summ Credit Score',
  creditEvent:          'Credit Event',
  housingHistory:       'Housing History',
  citizenship:          'Citizenship',

  // ── Property ──────────────────────────────────────────────────
  propertyType:         'Subject Property Type Fannie Mae',
  units:                'Subject Property # Units',
  state:                'Subject Property State',
  isRural:              'Property Info Is Rural Area',
  isCondotel:           'Property Info Is Condotel',
  isNonWarrantable:     'Property Info Is Non-Warrantable Project',
  isUnderservedArea:    'ATR\\QM Management Tool - Basic Info - Subject Property is in an Underserved Area',

  // ── Financials ────────────────────────────────────────────────
  ltv:                  'Freddie Mac Loan To Value (LTV)',
  cltv:                 'Trans Details Comb Loan to Value (CLTV)',
  tltv:                 'Freddie Mac Total Loan to Value (TLTV)',
  hcltv:                'Trans Details HCLTV/HTLTV',
  dtiTop:               'Trans Details Qual Ratio Top',
  dtiBottom:            'Trans Details Qual Ratio Bottom',
  interestRate:         'Trans Details Interest Rate',
  termMonths:           'Trans Details Term (Mos)',

  // ── Loan features ─────────────────────────────────────────────
  interestOnlyIndicator: 'Trans Details Interest Only Indicator',
  interestOnlyMonths:   'Trans Details Interest Only Mos',
  incomeDocType:        'Income Doc Type',
  prepaymentPenalty:    'Prepayment Penalty',
  prepaymentPeriod:     'MLDS Prepymt Penalty Period',
  pppTerm:              'PPP Term',
  escrow:               'Underwriting Escrow',
  dscrRatio:            'DSCR Ratio',
  loanQualificationType: 'Loan Qualification Type',
  riskAssessType:       'Underwriting Risk Assess Type',
  buydown:              'Loan Info Buydown',
  unitsADU:             'Units ADU',
  reduceReserve:        'Reduce Reserve',
};

// Reverse map: Excel header → camelCase key
const EXCEL_TO_CAMEL = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([camel, excel]) => [excel.toLowerCase(), camel])
);

/**
 * Normalise a raw loan object (from JSON body) into a consistent shape.
 * Accepts both camelCase keys and original Excel header strings.
 *
 * @param {Record<string,any>} raw
 * @returns {import('./loanRecord').LoanRecord}
 */
function normalizeLoan(raw) {
  const out = {};

  for (const [key, value] of Object.entries(raw)) {
    // Already camelCase?
    if (key in FIELD_MAP) {
      out[key] = value;
      continue;
    }
    // Excel header? Map to camelCase.
    const mapped = EXCEL_TO_CAMEL[key.toLowerCase()];
    if (mapped) {
      out[mapped] = value;
    }
    // Unknown keys are passed through as-is
  }

  // Coerce numeric fields
  const numericFields = ['loanAmount','ficoScore','units','ltv','cltv','tltv',
                         'hcltv','dtiTop','dtiBottom','interestRate','termMonths'];
  for (const f of numericFields) {
    if (out[f] !== undefined && out[f] !== null && out[f] !== '') {
      out[f] = Number(out[f]) || 0;
    }
  }

  return out;
}

module.exports = { FIELD_MAP, normalizeLoan };
