'use strict';

/**
 * Maps an Encompass v3 loan JSON object to the normalised loan shape
 * used by the eligibility agent.
 *
 * Supports all three common Encompass JSON formats:
 *   - Single loan object  { "loanNumber": "...", ... }
 *   - Array of loans      [ { ... }, { ... } ]
 *   - Wrapper object      { "loans": [ ... ] }
 *
 * Field mapping priority for each value:
 *   v3 entity path  →  common alias  →  flat fields.XXX shorthand  →  custom CX fields
 *
 * Changes vs. previous version:
 *   FIX  property.state added to state path list
 *   FIX  property.financedNumberOfUnits added to units path list
 *   FIX  loanProgramName added as primary path for loanProgram
 *   FIX  property.loanPurposeType added as primary path for loanPurpose
 *   FIX  mortgageType added as primary path for loanType
 *   FIX  loanProductData.gsePropertyType added as primary path for propertyType
 *   FIX  FarmersHomeAdministration → USDA in mapLoanType
 *   FIX  HELOC added explicitly to mapLoanType
 *   FIX  firstTimeHomebuyersIndicator (with 's') checked for firstTimeHomeBuyer
 *   FIX  combinedLtv added to cltv path list
 *   NEW  selfEmployed field — walks employment arrays for selfEmployedIndicator
 *   NEW  bankruptcyIndicator, bankruptcyType, bankruptcyDate, bankruptcyStatus fields
 *   NEW  foreclosureIndicator, foreclosureDate fields
 *   NEW  creditEvent auto-built from structured derogatory fields when CX field absent
 */

// ── Path navigator ────────────────────────────────────────────────

/**
 * Navigate dot-notation path with array index support.
 * e.g. "applications[0].borrower.middleFicoScore"
 */
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const segments = path.split('.');
  let current = obj;

  for (const seg of segments) {
    if (current == null) return undefined;

    const bracket = seg.indexOf('[');
    if (bracket > 0) {
      const prop = seg.slice(0, bracket);
      const idx  = parseInt(seg.slice(bracket + 1, seg.indexOf(']')), 10);
      current = current[prop];
      if (Array.isArray(current) && idx < current.length) {
        current = current[idx];
      } else {
        return undefined;
      }
    } else {
      if (typeof current !== 'object') return undefined;
      // Case-insensitive key lookup
      const key = Object.keys(current).find(
        k => k.toLowerCase() === seg.toLowerCase()
      );
      current = key ? current[key] : undefined;
    }
  }
  return current;
}

function str(obj, ...paths) {
  for (const p of paths) {
    const v = getByPath(obj, p);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function num(obj, ...paths) {
  for (const p of paths) {
    const v = getByPath(obj, p);
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function boolYN(obj, ...paths) {
  for (const p of paths) {
    const v = String(getByPath(obj, p) ?? '').trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(v)) return 'Y';
    if (['false', 'no', 'n', '0'].includes(v)) return 'N';
  }
  return '';
}

// ── Custom field lookup ────────────────────────────────────────────
// Encompass stores custom data in customFields: [{ fieldName: "CX.X", value: "..." }]

function cx(loan, ...fieldNames) {
  const arr = loan.customFields;
  if (!Array.isArray(arr)) return '';
  for (const name of fieldNames) {
    const found = arr.find(f => f.fieldName?.toLowerCase() === name.toLowerCase());
    if (found?.value != null && String(found.value).trim() !== '')
      return String(found.value).trim();
  }
  return '';
}

// ── Value normalisers ──────────────────────────────────────────────

function mapLoanType(raw) {
  if (!raw) return '';
  switch (raw.toLowerCase().replace(/[\s_-]/g, '')) {
    case 'conventional':
    case 'conv':
      return 'Conventional';
    case 'fha':
      return 'FHA';
    case 'va':
      return 'VA';
    case 'usda':
    case 'rhs':
    // FIX: FarmersHomeAdministration is the v3 enum value for USDA loans
    case 'farmershomeadministration':
      return 'USDA';
    case 'jumbo':
      return 'Jumbo';
    // FIX: HELOC is a valid mortgageType in Encompass v3
    case 'heloc':
      return 'HELOC';
    default:
      return raw;
  }
}

function mapLoanPurpose(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (r === 'purchase')                                                        return 'Purchase';
  if (['nocashoutrefinance', 'limitedcashoutrefinance',
       'ratetermrefinance', 'refinance'].includes(r))                          return 'Limited Cash-Out Refinance';
  if (['cashoutrefinance', 'cashout', 'cash-outrefinance'].includes(r))       return 'Cash-Out Refinance';
  if (r === 'constructiontopermanent')                                         return 'Construction-to-Permanent';
  if (r === 'constructiononly')                                                return 'Construction Only';
  return raw;
}

function mapOccupancy(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (['primaryresidence', 'primary', 'owneroccupied',
       'principalresidence', 'principal'].includes(r))                         return 'Principal Residence';
  if (['secondhome', 'second', 'vacationhome'].includes(r))                   return 'Second Home';
  if (['investmentproperty', 'investment', 'investor',
       'nonowneroccupied'].includes(r))                                        return 'Investment Property';
  return raw;
}

function mapAmortType(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (['fixed', 'frm', 'fixedrate'].includes(r)) return 'Fixed';
  if (['arm', 'adjustable', 'adjustablerate'].includes(r)) return 'ARM';
  if (['gpm', 'gparm'].includes(r)) return 'GPM';
  return raw;
}

function mapPropertyType(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (['singlefamilyresidence', 'sfr', 'singlefamily', 'detached'].includes(r))
    return 'Single Family';
  if (['plannedunitdevelopment', 'pud', 'attachedpud', 'detachedpud'].includes(r))
    return 'PUD';
  if (['condominium', 'condo', 'lowrisecondo', 'highrisecondo',
       'highrisecondomi nium'].includes(r))
    return 'Condo';
  if (['twotofourfamilydwelling', '24unit', 'multifamily',
       'twofour', 'twounit', 'threeunit', 'fourunit'].includes(r))
    return '2-4 Unit';
  if (['manufacturedhome', 'manufactured', 'mobilehome',
       'manufacturedhousing', 'mhadvantage', 'mhselect',
       'mhchoice', 'mhhomechoice'].includes(r))
    return 'Manufactured Home';
  if (['cooperative', 'coop'].includes(r)) return 'Co-op';
  return raw;
}

function mapEscrow(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (['true', 'yes', 'y', 'fullescrow'].includes(r)) return 'Y';
  if (['false', 'no', 'n', 'noescrow', 'waived'].includes(r)) return 'Waived';
  return raw;
}

function mapRiskAssess(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (['du', 'desktopunderwriter', 'fanniemae', 'do'].includes(r))
    return 'DU (Desktop Underwriter)';
  if (['lp', 'loanprospector', 'loancollateraladvisor', 'freddiemac'].includes(r))
    return 'LP (Loan Prospector)';
  if (['manual', 'manualunderwrite', 'manualunderwriting'].includes(r))
    return 'Manual Underwriting';
  return raw;
}

// ── Composite field builders ───────────────────────────────────────

/**
 * Build a human-readable creditEvent string from structured derogatory fields.
 * Falls back to the CX.CREDIT.EVENT custom field when present.
 */
function buildCreditEvent(raw) {
  // Prefer explicit CX custom field
  const cxVal = cx(raw, 'CX.CREDIT.EVENT');
  if (cxVal) return cxVal;

  const parts = [];

  const bkInd = boolYN(raw,
    'applications[0].borrower.bankruptcyIndicator',
    'applications[0].coborrower.bankruptcyIndicator');

  if (bkInd === 'Y') {
    const bkType   = str(raw, 'applications[0].borrower.priorBankruptcy2',
                              'applications[0].borrower.openBankruptcy2');
    const bkStatus = str(raw, 'applications[0].borrower.bankruptcyStatus');
    const bkDate   = str(raw, 'applications[0].borrower.bankruptcyDate');

    let desc = 'Bankruptcy';
    if (bkType)   desc += ` Ch.${bkType}`;
    if (bkStatus) desc += ` (${bkStatus})`;
    if (bkDate)   desc += ` ${bkDate}`;
    parts.push(desc);
  }

  const fcInd = boolYN(raw,
    'applications[0].borrower.propertyForeclosedPastSevenYearsIndicator',
    'applications[0].borrower.priorForeclosure',
    'applications[0].coborrower.propertyForeclosedPastSevenYearsIndicator');

  if (fcInd === 'Y') {
    const fcDate = str(raw, 'applications[0].borrower.foreclosureDate');
    let desc = 'Foreclosure';
    if (fcDate) desc += ` ${fcDate}`;
    parts.push(desc);
  }

  return parts.join('; ');
}

/**
 * Returns 'Y' if any borrower or coborrower employment entry has selfEmployedIndicator = true.
 */
function buildSelfEmployed(raw) {
  // Check rate lock flags first (fastest path)
  const rlFlag = boolYN(raw,
    'rateLock.employmentBorrowerSelfEmployedIndicator1',
    'rateLock.employmentBorrowerSelfEmployedIndicator2');
  if (rlFlag === 'Y') return 'Y';

  // Walk borrower employment array
  const bEmp = getByPath(raw, 'applications[0].borrower.employment');
  if (Array.isArray(bEmp)) {
    for (const emp of bEmp) {
      const flag = String(emp?.selfEmployedIndicator ?? '').trim().toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(flag)) return 'Y';
    }
  }

  // Walk coborrower employment array
  const cEmp = getByPath(raw, 'applications[0].coborrower.employment');
  if (Array.isArray(cEmp)) {
    for (const emp of cEmp) {
      const flag = String(emp?.selfEmployedIndicator ?? '').trim().toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(flag)) return 'Y';
    }
  }

  return '';
}

// ── Main mapper ────────────────────────────────────────────────────

/**
 * Map a single raw Encompass loan JSON object → normalised loan record.
 */
function mapLoan(raw) {
  const loan = {};

  // ── Identity ────────────────────────────────────────────────
  loan.loanNumber  = str(raw, 'loanNumber', 'loanName', 'encompassId') ||
                     cx(raw, 'CUST72FV');

  // FIX: loanProgramName is the standard v3 field; loanProgram is the legacy alias
  loan.loanProgram = str(raw, 'loanProgramName', 'loanProgram', 'productName') ||
                     cx(raw, 'CX.LOAN.PROGRAM', 'CX.PCW.LOANTYPE');

  loan.loanAmount  = num(raw, 'baseLoanAmount', 'loanAmount', 'totalLoanAmount',
                         'borrowerRequestedLoanAmount');

  // FIX: mortgageType is the standard v3 field name
  loan.loanType    = mapLoanType(str(raw, 'mortgageType', 'loanType', 'fields.1172'));

  // FIX: property.loanPurposeType is the standard v3 path
  loan.loanPurpose = mapLoanPurpose(
    str(raw,
        'property.loanPurposeType',
        'loanPurpose',
        'applications[0].propertyPurpose',
        'property.loanPurposeTypeUrla',
        'fields.19')
  );

  loan.amortType  = mapAmortType(str(raw, 'loanAmortizationType', 'amortizationType', 'fields.608'));
  loan.termMonths = num(raw, 'loanAmortizationTermMonths', 'requestedLoanAmortizationTermMonths') || 360;
  loan.interestRate = num(raw, 'requestedInterestRatePercent', 'initialInterestRate', 'noteRatePercent', 'fields.3');

  // ── Occupancy ───────────────────────────────────────────────
  loan.occupancyStatus = mapOccupancy(
    str(raw,
        'applications[0].propertyUsageType',
        'propertyUsageType',
        'occupancyType',
        'fields.1811')
  );

  // ── Underwriting method ─────────────────────────────────────
  loan.riskAssessType = mapRiskAssess(
    str(raw, 'ausTrackingLogs[0].ausSystem', 'riskAssessmentType', 'underwritingType', 'fields.1543') ||
    cx(raw, 'CX.UW.METHOD', 'CX.AUS.TYPE')
  );

  // ── Property ────────────────────────────────────────────────
  // FIX: loanProductData.gsePropertyType is the correct v3 path for the Fannie Mae property type
  loan.propertyType = mapPropertyType(
    str(raw,
        'loanProductData.gsePropertyType',
        'gsePropertyType',
        'propertyType',
        'fields.1041',
        'property.gsePropertyType')
  );

  // FIX: property.financedNumberOfUnits is the standard v3 path
  loan.units = num(raw,
    'property.financedNumberOfUnits',
    'subjectPropertyNumberOfUnits',
    'numberOfUnits',
    'fields.16') || 1;

  // FIX: property.state is the standard v3 path
  loan.state = (str(raw, 'property.state', 'subjectPropertyState', 'propertyState', 'fields.14') || '').toUpperCase();

  loan.isHighBalance    = boolYN(raw, 'isHighBalance', 'highBalance', 'fields.2680');
  loan.isManufactured   = boolYN(raw, 'isManufacturedHome', 'isManufactured');
  loan.isCondotel       = boolYN(raw, 'isCondotel', 'fields.MORNET.X102');
  loan.isNonWarrantable = boolYN(raw, 'isNonWarrantableCondo', 'isNonWarrantable', 'fields.MORNET.X67');
  loan.isRural          = boolYN(raw, 'isRuralProperty', 'isRural', 'fields.USDA.X41');

  // ── Borrower / credit ───────────────────────────────────────
  const bScore  = num(raw,
    'applications[0].borrower.middleFicoScore',
    'applications[0].borrower.middleCreditScore',
    'applications[0].borrower.creditScore',
    'applications[0].borrower.equifaxScore');
  const coScore = num(raw,
    'applications[0].coborrower.middleFicoScore',
    'applications[0].coborrower.middleCreditScore',
    'applications[0].coborrower.creditScore',
    'applications[0].coborrower.equifaxScore');
  loan.ficoScore = coScore > 0 ? Math.min(bScore, coScore) : bScore;

  if (!loan.ficoScore) {
    loan.ficoScore = num(raw, 'creditScoreToUse', 'vaLoanData.creditScore', 'fields.977') ||
                     parseInt(cx(raw, 'CX.PAIR1.BORROWER.FICO', 'CX.MIDAVG', 'CX.BORMID', 'CX.ALLMID')) || 0;
  }

  loan.citizenship = str(raw,
    'applications[0].borrower.citizenshipResidencyType',
    'applications[0].borrower.citizenship',
    'fields.1754');

  // FIX: also check firstTimeHomebuyersIndicator (with 's') used in standard v3 JSON exports
  loan.firstTimeHomeBuyer  = boolYN(raw,
    'firstTimeHomebuyersIndicator',
    'firstTimeHomeBuyer',
    'applications[0].borrower.firstTimeHomeBuyer',
    'fields.934');

  loan.nonOccupantBorrower = boolYN(raw, 'nonOccupantCoBorrower', 'nonOccupantBorrower', 'fields.MORNET.X6');

  loan.numFinancedProperties = str(raw,
    'applications[0].borrower.numberOfFinancedProperties',
    'numberOfFinancedProperties',
    'fields.CASASRN.X167') ||
    cx(raw, 'CX.REO.COUNT');

  loan.incomeDocType  = str(raw,
    'incomeDocumentationType',
    'loanProductData.loanDocumentationType',
    'altDocType',
    'fields.4763') ||
    cx(raw, 'CX.INCOME.DOC.TYPE');

  loan.housingHistory = cx(raw, 'CX.HOUSING.HISTORY') ||
                        str(raw, 'lateMortgagePaymentCount', 'mortgageRatingType');

  // FIX: build creditEvent from structured derogatory fields when CX field is absent
  loan.creditEvent = buildCreditEvent(raw);

  // ── Self-employed ───────────────────────────────────────────
  // NEW: walks employment arrays for selfEmployedIndicator
  loan.selfEmployed = buildSelfEmployed(raw);

  // ── Derogatory credit details ───────────────────────────────
  // NEW: expose individual derogatory fields so the LLM can apply waiting-period rules
  //     (FHA: 2yr BK, 3yr FC; Conventional: 4yr BK, 7yr FC)
  loan.bankruptcyIndicator = boolYN(raw,
    'applications[0].borrower.bankruptcyIndicator',
    'applications[0].coborrower.bankruptcyIndicator');

  loan.bankruptcyType = str(raw,
    'applications[0].borrower.priorBankruptcy2',
    'applications[0].borrower.openBankruptcy2');

  loan.bankruptcyDate = str(raw,
    'applications[0].borrower.bankruptcyDate');

  loan.bankruptcyStatus = str(raw,
    'applications[0].borrower.bankruptcyStatus');

  loan.foreclosureIndicator = boolYN(raw,
    'applications[0].borrower.propertyForeclosedPastSevenYearsIndicator',
    'applications[0].borrower.priorForeclosure',
    'applications[0].coborrower.propertyForeclosedPastSevenYearsIndicator');

  loan.foreclosureDate = str(raw,
    'applications[0].borrower.foreclosureDate');

  // ── Financials ──────────────────────────────────────────────
  loan.ltv    = num(raw, 'ltv', 'lTV', 'loanToValue', 'fannieMae.ltv', 'freddieMac.ltv', 'fields.353');
  // FIX: combinedLtv is the standard v3 field name for CLTV
  loan.cltv   = num(raw, 'combinedLtv', 'cltv', 'cltV', 'combinedLTV', 'fannieMae.cltv', 'freddieMac.tltv', 'fields.976');
  loan.hcltv  = num(raw, 'hcltv', 'hcltV', 'hcltvHtltv', 'fannieMae.hcltv', 'fields.1540');
  loan.tltv   = num(raw, 'tltv', 'tltV', 'freddieMac.tltv', 'fields.MORNET.X75');

  loan.dtiTop    = num(raw, 'applications[0].topRatioPercent', 'qualifyingRatioPercent', 'fields.736');
  loan.dtiBottom = num(raw, 'applications[0].bottomRatioPercent', 'debtToIncomeRatio', 'fields.737');

  loan.reservesMonths = str(raw, 'reservesMonths', 'applications[0].reservesMonthCount', 'fields.1512') ||
                        cx(raw, 'CX.RESERVES.MONTHS', 'CX.TOTAL.REQ.RESERVES');

  // ── Loan features ───────────────────────────────────────────
  loan.interestOnlyIndicator = boolYN(raw, 'interestOnlyIndicator', 'fields.2982');
  loan.interestOnlyMonths    = str(raw, 'interestOnlyTermMonths', 'fields.2983');
  loan.prepaymentPenalty     = boolYN(raw, 'prepaymentPenaltyIndicator', 'fields.432');
  loan.prepaymentPeriod      = str(raw, 'prepaymentPenaltyTermMonths', 'fields.1451');
  loan.escrow                = mapEscrow(str(raw, 'impoundType', 'escrowAccountIndicator', 'fields.1657'));
  loan.dscrRatio             = cx(raw, 'CX.DSCR.RATIO', 'CX.DSC.PRA.FINAL') ||
                               str(raw, 'dscrRatio', 'debtServiceCoverageRatio');
  loan.loanQualificationType = cx(raw, 'CX.LOAN.QUAL.TYPE') || str(raw, 'qualificationType');
  loan.buydown               = str(raw, 'buydownType', 'fields.2984');
  loan.subordinateFinancing  = cx(raw, 'CX.SUBORDINATE.FINANCING') ||
                               str(raw, 'communitySecondsIndicator', 'subFinancing', 'fields.MORNET.X76');

  return loan;
}

/**
 * Parse a raw JSON string or object into one or more normalised loan records.
 * Accepts: single object, array, or { loans: [...] } wrapper.
 * Test-case metadata keys (_testCaseId, _description, _expectedOutcome) are ignored
 * by the mapper since they don't match any field paths — no stripping needed.
 */
function mapFromJson(input) {
  let parsed = typeof input === 'string' ? JSON.parse(input) : input;

  if (Array.isArray(parsed))  return parsed.map(mapLoan);
  if (parsed.loans)           return parsed.loans.map(mapLoan);
  return [mapLoan(parsed)];
}

module.exports = { mapLoan, mapFromJson };
