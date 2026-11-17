import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VidSignerClient } from '../../src/client/vidsigner-client.js';
import { VidSignerMgmtClient } from '../../src/client/mgmt-client.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createServer } from '../../src/server.js';
import { FileService } from '../../src/tools/files.js';
import { noSleep } from './mock-fetch.js';

export interface Harness {
  client: Client;
  config: Config;
  outputDir: string;
  /** The only folder from which tools may read files by path. */
  inputDir: string;
  registered: string[];
  skipped: Array<{ name: string; reason: string; enableWith?: string }>;
  toolNames: () => Promise<string[]>;
  call: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ isError: boolean; text: string; json: unknown }>;
}

/** Starts a real MCP server connected to an MCP client over an in-memory transport. */
export async function startHarness(opts: {
  env?: Record<string, string>;
  fetch: typeof fetch;
}): Promise<Harness> {
  const outputDir = mkdtempSync(join(tmpdir(), 'vidsigner-test-'));
  const inputDir = mkdtempSync(join(tmpdir(), 'vidsigner-in-'));
  const config = loadConfig({
    VIDSIGNER_SUBSCRIPTION_NAME: 'SubDemo',
    VIDSIGNER_SUBSCRIPTION_PASS: 'pass-demo-1234',
    VIDSIGNER_OUTPUT_DIR: outputDir,
    VIDSIGNER_ALLOWED_INPUT_DIRS: inputDir,
    ...opts.env,
  } as NodeJS.ProcessEnv);

  const common = {
    fetch: opts.fetch,
    sleep: noSleep,
    retryBaseDelayMs: 1,
    environment: config.security.environment,
  };
  const rest = new VidSignerClient({
    ...common,
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    subscriptionName: config.subscriptionName as string,
    subscriptionPass: config.subscriptionPass as string,
  });
  const mgmt = config.security.enableMgmt
    ? new VidSignerMgmtClient({
        ...common,
        baseUrl: config.mgmtBaseUrl,
        clientId: config.mgmt.clientId,
        clientSecret: config.mgmt.clientSecret,
        partnerUser: config.mgmt.partnerUser,
        partnerPass: config.mgmt.partnerPass,
        subscriptionName: config.subscriptionName,
        subscriptionPass: config.subscriptionPass,
      })
    : undefined;
  const files = new FileService({
    outputDir: config.files.outputDir,
    allowedInputDirs: config.files.allowedInputDirs,
    maxUploadBytes: config.files.maxUploadBytes,
  });

  const created = createServer({
    security: config.security,
    rest,
    mgmt,
    files,
    recipients: config.recipients,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([created.server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    config,
    outputDir,
    inputDir,
    registered: created.registered,
    skipped: created.skipped,
    toolNames: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
    call: async (name, args = {}) => {
      const res = await client.callTool({ name, arguments: args });
      const content = res.content as Array<{ type: string; text?: string }>;
      const text = content.map((c) => c.text ?? '').join('\n');
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // plain text
      }
      return { isError: res.isError === true, text, json: parsed };
    },
  };
}
