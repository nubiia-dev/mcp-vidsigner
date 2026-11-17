#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VidSignerMgmtClient } from './client/mgmt-client.js';
import { Redactor, createLogger } from './client/logger.js';
import { VidSignerClient } from './client/vidsigner-client.js';
import { ConfigError, loadConfig } from './config.js';
import { createServer } from './server.js';
import { prepareDirectories } from './startup.js';
import { FileService } from './tools/files.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.subscriptionName || !config.subscriptionPass) {
    throw new ConfigError(
      'VIDSIGNER_SUBSCRIPTION_NAME and VIDSIGNER_SUBSCRIPTION_PASS are missing (subscription credentials).',
    );
  }

  // All known secrets are registered so that no log or error ever shows them.
  const redactor = new Redactor();
  redactor.addBasicPair(config.subscriptionName, config.subscriptionPass);
  redactor.addBasicPair(config.clientId, config.clientSecret);
  redactor.addBasicPair(config.mgmt.clientId, config.mgmt.clientSecret);
  redactor.addBasicPair(config.mgmt.partnerUser, config.mgmt.partnerPass);
  const logger = createLogger({ level: config.logLevel, redactor });

  const common = {
    timeoutMs: config.http.timeoutMs,
    maxRetries: config.http.maxRetries,
    environment: config.security.environment,
    logger,
  };

  const rest = new VidSignerClient({
    ...common,
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    subscriptionName: config.subscriptionName,
    subscriptionPass: config.subscriptionPass,
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

  await prepareDirectories(config.files, logger);

  const { server, registered, skipped } = createServer({
    security: config.security,
    rest,
    mgmt,
    files,
    recipients: config.recipients,
    logger,
  });

  const sec = config.security;
  logger.info(`mcp-vidsigner v${VERSION} started`, {
    env: sec.environment,
    tools: registered.length,
    skipped: skipped.length,
    write: sec.allowWrite,
    destructive: sec.allowDestructive,
    markDownloaded: sec.allowMarkDownloaded,
    signingLinks: sec.allowSigningLinks,
    credentialReads: sec.allowCredentialReads,
    inputDirs: config.files.allowedInputDirs.length,
    emailLists: config.recipients.emailDomains.length,
    phoneLists: config.recipients.phonePrefixes.length,
    webhookLists: config.recipients.notificationHosts.length,
    assetLists: config.recipients.assetHosts.length,
    mgmt: sec.enableMgmt,
    jwt: rest.canWrite,
  });
  for (const warning of config.warnings) logger.warn(warning);
  if (!rest.canWrite && sec.allowWrite) {
    logger.warn(
      'Without VIDSIGNER_CLIENT_ID/SECRET, writes will fail (the API requires a JWT). Only reads will work.',
    );
  }

  const rcp = config.recipients;
  if (
    sec.environment === 'pro' &&
    sec.allowWrite &&
    (rcp.emailDomains.length === 0 ||
      rcp.notificationHosts.length === 0 ||
      rcp.assetHosts.length === 0)
  ) {
    logger.warn(
      'Production with writes enabled and incomplete allowlists: define VIDSIGNER_ALLOWED_EMAIL_DOMAINS, VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS and VIDSIGNER_ALLOWED_ASSET_HOSTS (and VIDSIGNER_ALLOWED_PHONE_PREFIXES) to limit who the model can write to and which URLs it can make signers see.',
    );
  }

  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[mcp-vidsigner] FATAL: ${msg}`);
  process.exit(1);
});
