# Slack Finance RAG Bot

A Slack slash command that lets staff ask finance questions and get instant, sourced answers from a company knowledge base — built using n8n and Claude AI.

Type `/finance who approves invoices over £5k?` in Slack and get back a cited answer in seconds.

---

## What It Does

Staff type a finance question using the `/finance` slash command. The bot searches a knowledge base of finance documents and returns a concise answer with a source citation — directly in the Slack channel.

**Example:**

> `/finance what are our standard payment terms with suppliers?`
>
> ✅ Standard payment terms are 30 days from the date of invoice. Different terms must be agreed in writing and approved by the Finance Director.
> 📋 Source: Supplier Payment Policy (v3.1), Standard Payment Terms

## Demo

**Watch it in action**

[![Watch the demo](https://cdn.loom.com/sessions/thumbnails/52153f1cb027435ab6d19c026da6eaef-owner-portrait.jpg)](https://www.loom.com/share/52153f1cb027435ab6d19c026da6eaef)

---

**VAT lookup**

![Slack Finance Assistant VAT answer](assets/slack-demo-vat-answer.png)

**Invoice approval policy lookup**

![Slack Finance Assistant invoice approval answer](assets/slack-demo-invoice-approval.png)

---

## Architecture

```
Slack /finance command
        │
        ▼
[n8n Webhook: raw request body]
        │
        ▼
[Prepare verification] ── validates timestamp, signature format, and raw body
        │
        ▼
[Crypto: HMAC-SHA256] ── reads the signing secret from encrypted n8n credentials
        │
        ▼
[Constant-time compare]
        │
        ├── invalid ──► [HTTP 403: Reject Request]
        │
        ▼ valid
[Respond to Webhook] ── sends ":mag: looking that up..." immediately
        │
        ▼
[Set: Prepare Claude Request]
  extracts question, response_url from Slack payload
  loads full knowledge base as system prompt
        │
        ▼
[HTTP Request: Ask Claude]  ──► Anthropic API (claude-haiku-4-5)
        │                              │
        │ (on error)                   │
        ▼                              ▼
[Post Error to Slack]        [Set: Format Answer]
                                       │
                                       ▼
                             [HTTP Request: Post Answer to Slack]
                               POSTs to Slack response_url
```

**Why the two-step Slack response?** Slack requires a 200 HTTP response within 3 seconds or it shows a timeout error to the user. Claude API calls take longer than that. The solution: the webhook immediately acknowledges the request, then posts the real answer asynchronously to Slack's `response_url`.

---

## Stack

| Component | Tool |
|---|---|
| Workflow orchestration | n8n (self-hosted) |
| LLM | Claude Haiku 4.5 via Anthropic API |
| Slack integration | Slash command + response_url pattern |
| Request authentication | HMAC-SHA256 with an n8n Crypto credential |
| Knowledge base | Static markdown documents, loaded as system prompt |

---

## Knowledge Base

Four documents covering Hartwell Building Supplies Ltd (fictional company used for demo purposes):

| File | Contents |
|---|---|
| `finance-faq.md` | Common staff questions on invoices, payments, expenses |
| `supplier-payment-policy.md` | Approval thresholds, payment terms, fraud prevention |
| `month-end-checklist.md` | Close schedule, task list, sign-off deadlines |
| `chart-of-accounts.md` | Full nominal code list (4000–9520) |

All company data is fictional and used for demonstration purposes only.

---

## Demo Questions

Use questions that are covered by the fictional Hartwell knowledge base. These prompts are good for a live walkthrough:

```text
/finance who approves invoices over £5k?
/finance what are our standard payment terms with suppliers?
/finance when are payment runs processed?
/finance do I need a purchase order before buying something?
/finance what is the bank reconciliation deadline?
/finance when does the month-end pack need to be submitted?
/finance what is our VAT number?
/finance can I reclaim VAT on client entertainment?
```

Questions about revenue, profit, cash balances, or financial statements intentionally return a fallback response because those figures are not included in the demo knowledge base.

---

## Setup

### Prerequisites

- n8n (self-hosted or cloud)
- Anthropic API key
- A Slack app with a `/finance` slash command

### Steps

1. **Import the workflow** — in n8n, go to Workflows → Import → upload `workflow/slack-finance-rag.json`

2. **Add your Anthropic credential** — in n8n, go to Credentials → New → Anthropic → paste your API key. Name it `Anthropic`.

3. **Add the Slack signing credential** — in n8n, go to Credentials → New → Crypto. Name it `Slack Signing Secret - Finance RAG`, paste the Slack app's signing secret into **Hmac Secret**, and leave the other Crypto fields empty. Open the `Calculate Slack HMAC` node and select that credential.

4. **Configure the Slack slash command** — in your Slack app settings, set the `/finance` Request URL to:
   ```
   https://your-domain-or-ngrok-url/webhook/finance
   ```

5. **Activate the workflow** — toggle the workflow active in n8n

6. **Test it** — type `/finance what are our payment terms?` in Slack

### Environment

The Slack signing secret and Anthropic API key belong in n8n's encrypted credential store, not in a project `.env` file. For self-hosted n8n, the signature comparison Code node needs Node's built-in `crypto` module to be allowed in the task runner:

```env
NODE_FUNCTION_ALLOW_BUILTIN=crypto
N8N_BLOCK_ENV_ACCESS_IN_NODE=true
```

The `Calculate Slack HMAC` Crypto node reads the secret directly from its credential, so the secret is never copied into workflow item data, execution output, or the public workflow export.

---

## Security Notes

- This repository contains only fictional Hartwell Building Supplies Ltd data.
- No real Slack tokens, Anthropic keys, n8n credential IDs, MCP tokens, encryption keys, or live webhook URLs are committed.
- `.env`, local Claude/Codex context files, logs, and workflow backup exports are ignored by git.
- The exported workflow includes Slack request signing verification using HMAC-SHA256, constant-time comparison, and a five-minute replay window.
- The exported Crypto node contains only a placeholder credential ID. Select your own credential after importing the workflow.
- Keep this webhook workflow unavailable as an MCP tool; its intended entry point is Slack's signed HTTP request only.

Run the dependency-free workflow checks before publishing changes:

```powershell
node scripts/validate-workflow.mjs
```

---

## Project Notes

- The knowledge base is embedded directly in the workflow as a system prompt. For larger document sets, replace the `Prepare Claude Request` node with a vector search step (e.g. Qdrant + embeddings).
- The workflow uses Claude Haiku for speed. Swap to Sonnet in the `Ask Claude` node for more complex reasoning tasks.
- No Slack Bot Token required — the `response_url` pattern is self-contained and authenticated by Slack's own request signing.

## Verification state (16 October 2026)

The exported workflow structure and synthetic signature cases pass the dependency-free validation script. This is static/local evidence: n8n is stopped on the maintainer device, and this revision has not been imported, activated or tested through a live Slack request. Verify the Crypto credential and raw-body handling on the target n8n version before activation.
