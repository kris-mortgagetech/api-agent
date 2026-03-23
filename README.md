# Alt Plus Loan Eligibility — Azure SWA API

Node.js Azure Functions (v4 programming model) deployed as an Azure Static Web Apps API.

The LLM reads the guidelines PDF on every call — rules update automatically when the PDF changes.

---

## Project Structure

```
AltPlusEligibilityAPI/
├── src/
│   └── index.html                    # Frontend UI (single file, vanilla JS)
├── staticwebapp.config.json          # SWA routing config
├── api/
│   ├── host.json
│   ├── local.settings.json           # Local env vars (not deployed)
│   ├── package.json
│   └── src/
│       ├── index.js                  # Registers all functions
│       ├── functions/
│       │   ├── evaluateLoan.js       # POST /api/evaluate-loan  (single)
│       │   ├── evaluateBatch.js      # POST /api/evaluate-batch (many)
│       │   └── fieldMap.js           # GET  /api/field-map
│       ├── models/
│       │   └── loanMapping.js        # Excel column ↔ JSON field map
│       └── services/
│           ├── systemPrompt.js       # LLM role + output format prompt
│           ├── anthropicClient.js    # Anthropic API (native PDF block + caching)
│           ├── openAiClient.js       # Azure OpenAI (PDF rendered to PNG via pdfjs)
│           └── eligibilityAgent.js   # Provider-agnostic orchestrator
```

---

## Local Setup

```bash
cd api
npm install   # installs @azure/functions, pdfjs-dist, canvas

# Edit local.settings.json — fill in AZURE_OPENAI_API_KEY (or ANTHROPIC_API_KEY)
# Set LLM_PROVIDER to "openai" (default) or "anthropic"

npm start
# API available at http://localhost:7071/api/

# To run with the frontend:
npx @azure/static-web-apps-cli start src --api-location api
# → http://localhost:4280
```

> **Note on `canvas`:** The `canvas` package requires native build tools.
> On Windows run `npm install --global windows-build-tools` first,
> or use WSL2. On macOS: `brew install pkg-config cairo pango libpng`.

---

## Azure Deployment — Required App Settings

Set these in **Azure Portal → Static Web Apps → Configuration → Application settings**:

| Name | Value | Required for |
|---|---|---|
| `LLM_PROVIDER` | `openai` or `anthropic` | Both |
| `AZURE_OPENAI_API_KEY` | Your Azure OpenAI key | OpenAI mode |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Anthropic mode |
| `ANTHROPIC_MODEL` | `claude-opus-4-5` *(optional)* | Anthropic mode |

The Azure OpenAI endpoint and deployment name are set in `openAiClient.js`:
```
AZURE_ENDPOINT  = 'https://smart-advisor-ai.openai.azure.com'
DEPLOYMENT_NAME = 'gpt-4o'
API_VERSION     = '2024-12-01-preview'
```

---

## How the PDF is Processed

### Azure OpenAI (default)
Each PDF page is rendered to a PNG image at 2x scale (≈144 DPI) using
**pdfjs-dist** + **canvas** (pure Node.js, no native tools at runtime).
Pages are sent as `image_url` vision blocks so GPT-4o reads the document visually.

### Anthropic
The PDF is sent as a native `document` content block with `cache_control: ephemeral`.
Anthropic processes it server-side and caches it for ~5 minutes — ~90% token savings
on repeated calls against the same PDF.

---

## API Reference

### `GET /api/field-map`
Returns the JSON field name ↔ Excel column header mapping.

### `POST /api/evaluate-loan`
Evaluates a single loan.

**Request:**
```json
{
  "loan": {
    "loanNumber": "2025-001",
    "loanAmount": 750000,
    "ficoScore": 720,
    "loanPurpose": "Purchase",
    "occupancyStatus": "PrimaryResidence",
    "cltv": 80,
    "dtiBottom": 42,
    "state": "CA",
    "creditEvent": "N/A",
    "housingHistory": "0x30x12",
    "prepaymentPenalty": "N"
  },
  "pdfBase64": "<base64-encoded PDF bytes>"
}
```

**Response:**
```json
{
  "loan_number": "2025-001",
  "overall_status": "Pass",
  "summary": "Loan meets all Alt Plus eligibility requirements.",
  "provider": "Azure OpenAI (gpt-4o)",
  "tests": [
    { "test_name": "Loan Amount",  "status": "Pass", "reason": "$750,000 within $150K–$3M range" },
    { "test_name": "FICO Score",   "status": "Pass", "reason": "FICO 720 meets minimum 660" },
    ...
  ]
}
```

### `POST /api/evaluate-batch`
Evaluates an array of loans sequentially.

```json
{
  "loans": [ { ...loan1 }, { ...loan2 } ],
  "pdfBase64": "<base64>"
}
```

---

## Sending the PDF from the Frontend

```javascript
// Browser
const file = document.getElementById('pdfInput').files[0];
const reader = new FileReader();
reader.onload = e => {
  const pdfBase64 = e.target.result.split(',')[1]; // strip data URL prefix
};
reader.readAsDataURL(file);
```
