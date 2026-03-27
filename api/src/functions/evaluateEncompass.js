'use strict';

const { app } = require('@azure/functions');

/**
 * Proxy: POST /api/evaluate-encompass
 *
 * Forwards the request to the AltPlusEligibility API on kind-grass.
 * Lives on the salmon-flower SWA so the browser call is same-origin
 * and bypasses the Content-Security-Policy connect-src restriction.
 *
 * Deploy to: api/src/functions/evaluateEncompass.js  (salmon-flower project)
 */

const UPSTREAM = 'https://kind-grass-048f5d010.2.azurestaticapps.net/api/evaluate-encompass';

app.http('evaluate-encompass', {
  methods:   ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler:   async (request, context) => {

    // CORS preflight (shouldn't be needed for same-origin, but just in case)
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders(), body: '' };
    }

    context.log('[proxy] evaluate-encompass → forwarding to kind-grass');

    let bodyText;
    try {
      bodyText = await request.text();
    } catch (e) {
      return err(400, 'Could not read request body: ' + e.message);
    }

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    bodyText,
      });
    } catch (e) {
      context.log('[proxy] upstream fetch failed: ' + e.message);
      return err(502, 'Upstream unreachable: ' + e.message);
    }

    const responseText = await upstream.text();
    context.log('[proxy] upstream status: ' + upstream.status);

    return {
      status:  upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body:    responseText,
    };
  },
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function err(status, message) {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body:    JSON.stringify({ error: message }),
  };
}