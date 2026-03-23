'use strict';

const { app }      = require('@azure/functions');
const { FIELD_MAP } = require('../models/loanMapping');

/**
 * GET /api/field-map
 *
 * Returns the complete mapping of camelCase JSON field names
 * to their original Excel column header equivalents.
 *
 * Useful for callers building loan objects from Excel data.
 *
 * Response:
 * {
 *   "loanNumber": "Trans Details Loan #",
 *   "loanAmount": "Trans Details Total Loan Amt (w/ MIP/FF)",
 *   ...
 * }
 */
app.http('field-map', {
  methods:   ['GET'],
  authLevel: 'anonymous',
  handler:   async (_request, _context) => {
    return {
      status:  200,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(FIELD_MAP, null, 2),
    };
  },
});
