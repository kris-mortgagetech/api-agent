'use strict';

const { app } = require('@azure/functions');

/**
 * Proxy: POST /api/evaluate-encompass
 * Forwards to kind-grass — same-origin so CSP connect-src 'self' allows it.
 * Deploy to: api/src/functions/evaluateEncompass.js (salmon-flower project)
 */

const UPSTREAM = 'https://kind-grass-048f5d010.2.azurestaticapps.net/api/evaluate-encompass';

app.http('evaluate-encompass', {
  methods:   ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler:   async (request, context) => {

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders(), body: '' };
    }

    context.log('[proxy] evaluate-encompass received — forwarding to kind-grass');

    // Read body as text — works regardless of content-type header quirks
    let bodyText = '';
    try {
      bodyText = await request.text();
      context.log('[proxy] request body length:', bodyText.length);
    } catch (e) {
      context.log('[proxy] ERROR reading body:', e.message);
      return err(400, 'Could not read request body: ' + e.message);
    }

    // Validate it's parseable JSON before forwarding
    try {
      JSON.parse(bodyText);
    } catch (e) {
      context.log('[proxy] ERROR body is not valid JSON:', e.message);
      return err(400, 'Request body is not valid JSON: ' + e.message);
    }

    let upstreamResp;
    try {
      upstreamResp = await fetch(UPSTREAM, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : bodyText,
      });
    } catch (e) {
      context.log('[proxy] ERROR upstream fetch failed:', e.message);
      return err(502, 'Upstream unreachable: ' + e.message);
    }

    context.log('[proxy] upstream status:', upstreamResp.status, upstreamResp.statusText);

    const responseText = await upstreamResp.text();
    context.log('[proxy] upstream response length:', responseText.length);
    context.log('[proxy] upstream response preview:', responseText.slice(0, 300));

    if (!responseText || responseText.trim() === '') {
      context.log('[proxy] ERROR empty response from upstream');
      return err(502, 'Empty response from upstream API (status ' + upstreamResp.status + ')');
    }

    return {
      status : upstreamResp.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body   : responseText,
    };
  },
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function err(status, message) {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body   : JSON.stringify({ error: message }),
  };
}