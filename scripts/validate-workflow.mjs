import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../workflow/slack-finance-rag.json', import.meta.url);
const workflowText = await readFile(workflowUrl, 'utf8');
const workflow = JSON.parse(workflowText);

const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
const node = (name) => {
  assert(nodeByName.has(name), `Missing workflow node: ${name}`);
  return nodeByName.get(name);
};

const nextNode = (name) => workflow.connections?.[name]?.main?.[0]?.[0]?.node;
assert.equal(nextNode('Receive Slack Command'), 'Prepare Slack Verification');
assert.equal(nextNode('Prepare Slack Verification'), 'Calculate Slack HMAC');
assert.equal(nextNode('Calculate Slack HMAC'), 'Verify Slack Signature');
assert.equal(nextNode('Verify Slack Signature'), 'Signature Valid');

const webhook = node('Receive Slack Command');
assert.equal(webhook.parameters?.options?.rawBody, true, 'Webhook must retain the raw request body');

const cryptoNode = node('Calculate Slack HMAC');
assert.equal(cryptoNode.type, 'n8n-nodes-base.crypto');
assert.equal(cryptoNode.typeVersion, 2);
assert.deepEqual(cryptoNode.parameters, {
  action: 'hmac',
  binaryData: false,
  type: 'SHA256',
  value: '={{ $json.slack_signature_base }}',
  dataPropertyName: 'expected_signature_hex',
  encoding: 'hex',
});
assert.deepEqual(cryptoNode.credentials, {
  crypto: {
    id: 'YOUR_CRYPTO_CREDENTIAL_ID',
    name: 'Slack Signing Secret - Finance RAG',
  },
});

for (const forbidden of [
  '$env.SLACK_SIGNING_SECRET',
  'slack_signing_secret',
  'N8N_' + 'ENCRYPTION_KEY=',
  'N8N_' + 'MCP_TOKEN=',
  'xox' + 'b-',
  'sk-' + 'ant-',
]) {
  assert(!workflowText.includes(forbidden), `Forbidden secret path or token marker found: ${forbidden}`);
}

// Function cannot await inside the n8n Code-node body, so supply the synchronous module directly.
const cryptoModule = await import('node:crypto');
const executeCode = (name, item) => Function('$input', 'require', node(name).parameters.jsCode)(
  { item },
  (specifier) => {
    assert.equal(specifier, 'crypto');
    return cryptoModule;
  },
);

const secret = 'synthetic-test-secret-not-used-at-runtime';
const rawBody = 'command=%2Ffinance&text=what+are+our+payment+terms%3F';
const timestamp = String(Math.floor(Date.now() / 1000));
const signatureBase = `v0:${timestamp}:${rawBody}`;
const signature = `v0=${createHmac('sha256', secret).update(signatureBase).digest('hex')}`;

const incoming = {
  json: {
    headers: {
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
    },
    rawBody,
    body: { text: 'what are our payment terms?' },
  },
};

const prepared = executeCode('Prepare Slack Verification', incoming);
assert.equal(prepared.json.verification_prerequisites_valid, true);
assert.equal(prepared.json.slack_signature_base, signatureBase);

const calculated = {
  json: {
    ...prepared.json,
    expected_signature_hex: createHmac('sha256', secret).update(prepared.json.slack_signature_base).digest('hex'),
  },
  binary: prepared.binary,
};
const verified = executeCode('Verify Slack Signature', calculated);
assert.equal(verified.json.signature_valid, true, 'Valid Slack signature must pass');
for (const transient of [
  'slack_signature_base',
  'supplied_slack_signature',
  'verification_prerequisites_valid',
  'expected_signature_hex',
]) {
  assert(!(transient in verified.json), `Transient verification field was not removed: ${transient}`);
}

const badSignature = executeCode('Prepare Slack Verification', {
  json: {
    ...incoming.json,
    headers: {
      ...incoming.json.headers,
      'X-Slack-Signature': `v0=${'0'.repeat(64)}`,
    },
  },
});
const badVerified = executeCode('Verify Slack Signature', {
  json: {
    ...badSignature.json,
    expected_signature_hex: calculated.json.expected_signature_hex,
  },
});
assert.equal(badVerified.json.signature_valid, false, 'Invalid Slack signature must fail');

const staleTimestamp = String(Number(timestamp) - 301);
const staleBase = `v0:${staleTimestamp}:${rawBody}`;
const staleSignature = `v0=${createHmac('sha256', secret).update(staleBase).digest('hex')}`;
const stalePrepared = executeCode('Prepare Slack Verification', {
  json: {
    ...incoming.json,
    headers: {
      'x-slack-request-timestamp': staleTimestamp,
      'x-slack-signature': staleSignature,
    },
  },
});
assert.equal(stalePrepared.json.verification_prerequisites_valid, false, 'Replayed request must fail');
const staleVerified = executeCode('Verify Slack Signature', {
  json: {
    ...stalePrepared.json,
    expected_signature_hex: createHmac('sha256', secret).update(staleBase).digest('hex'),
  },
});
assert.equal(staleVerified.json.signature_valid, false, 'Replayed request must remain rejected');

const missingBody = executeCode('Prepare Slack Verification', {
  json: { headers: incoming.json.headers },
});
assert.equal(missingBody.json.verification_prerequisites_valid, false, 'Missing raw body must fail');

const malformedSignature = executeCode('Prepare Slack Verification', {
  json: {
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': 'v0=not-hex',
    },
    rawBody,
  },
});
assert.equal(malformedSignature.json.verification_prerequisites_valid, false, 'Malformed signature must fail');

for (const edgeBody of [
  'command=%2Ffinance&text=%C2%A3100+%26+VAT',
  'command=/finance&text=£100 and café',
]) {
  const edgeBase = `v0:${timestamp}:${edgeBody}`;
  const edgeSignature = `v0=${createHmac('sha256', secret).update(edgeBase).digest('hex')}`;
  const edgePrepared = executeCode('Prepare Slack Verification', {
    json: {
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': edgeSignature,
      },
    },
    binary: {
      data: { data: Buffer.from(edgeBody, 'utf8').toString('base64') },
    },
  });
  assert.equal(edgePrepared.json.slack_signature_base, edgeBase, 'Raw body bytes must be preserved');
  const edgeVerified = executeCode('Verify Slack Signature', {
    json: {
      ...edgePrepared.json,
      expected_signature_hex: createHmac('sha256', secret).update(edgeBase).digest('hex'),
    },
    binary: edgePrepared.binary,
  });
  assert.equal(edgeVerified.json.signature_valid, true, 'Encoded and Unicode request bodies must verify');
}

console.log('Workflow structure and synthetic Slack signature checks passed.');
