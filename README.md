# VIDsigner MCP Server

[![CI](https://github.com/nubiia-dev/mcp-vidsigner/actions/workflows/ci.yml/badge.svg)](https://github.com/nubiia-dev/mcp-vidsigner/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40nubiia%2Fmcp-vidsigner.svg)](https://www.npmjs.com/package/@nubiia/mcp-vidsigner)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![by Nubiia](https://img.shields.io/badge/by-Nubiia-6C4EE3)](https://nubiia.es)

A Model Context Protocol (MCP) server for the **VIDsigner** electronic signature API. It lets AI assistants such as Claude create documents to sign, follow every signer, download signed PDFs and evidence reports, send certified e-deliveries and, optionally, manage partners, customers, subscriptions and VIDmobile users, through **81 tools** that cover the VIDsigner signature API (VIDcloud 3.0) and management API (MGMT 1.0).

> **Unofficial, community-maintained MCP server for the VIDsigner API. Not affiliated with, endorsed or sponsored by Validated ID. VIDsigner is a trademark of Validated ID, S.L.**
> You need your own VIDsigner subscription to use it. This project does not redistribute the documentation of Validated ID.

> Built and maintained by **[Nubiia](https://nubiia.es)**: AI automation and integrations for businesses (MCP, Holded, Pipedrive and more). Want something like this for your company? Get in touch at **[nubiia.es](https://nubiia.es)**.

## Why this server

- **Safe by default.** Production starts **read-only**. Writes, destructive operations, signing links, credential reads and the management API each sit behind their own flag; a tool that is not enabled is not even registered, so the model cannot see it.
- **Built against prompt injection.** Files are read only from allow-listed folders, recipients and webhook hosts can be restricted to your own domains, and downloads are written to disk (the model gets a path, never the base64 content). Subscription passwords and tokens are never returned to the model.
- **Strict, documented schemas.** Request bodies use the exact VIDsigner field names, are validated strictly (a typo such as `Emial` is rejected with a suggestion instead of being silently dropped) and every parameter, nested ones included, has a description.
- **Complete.** 35 signature operations + 46 management operations, a typed TypeScript client for each one, typed errors with the VIDsigner error catalog, retries only where they are safe, and typed webhook payloads.
- **Tested.** Hundreds of tests run against a mocked `fetch` (authentication and renewal, empty-list 404s, error mapping, retries, pagination, gates, end-to-end MCP over an in-memory transport).

## Quick start

You need Node.js 20.11 or higher and a VIDsigner subscription (pre-production or production). Reads work with the subscription name and password only; **writes also need the OAuth client ID and secret that Validated ID issues** (writes require a JWT).

```bash
# Claude Code: read-only against pre-production
claude mcp add vidsigner \
  -e VIDSIGNER_ENV=pre \
  -e VIDSIGNER_SUBSCRIPTION_NAME=your-subscription \
  -e VIDSIGNER_SUBSCRIPTION_PASS=your-password \
  -- npx -y @nubiia/mcp-vidsigner@latest
```

Then ask your assistant things like:

- "Which documents are still pending signature?"
- "What is the status of document `0b6f1d0e-...` and of each signer?"
- "Download the signed PDF and the evidence report of that document."

## Installation

```bash
# Run without installing (recommended for MCP clients)
npx -y @nubiia/mcp-vidsigner@latest

# Or install globally
npm install -g @nubiia/mcp-vidsigner
```

From source:

```bash
git clone https://github.com/nubiia-dev/mcp-vidsigner.git
cd mcp-vidsigner
npm install
npm run build
```

## Configuration

Everything is configured through environment variables (see [`.env.example`](.env.example); never commit your `.env`).

| Variable                               | Description                                                                                                                                                                                                                                             | Default                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `VIDSIGNER_ENV`                        | `pre` (pre-production) or `pro` (production)                                                                                                                                                                                                            | `pre`                         |
| `VIDSIGNER_BASE_URL`                   | Override of the signature API base URL: `https:`, no user, port or query, the signature API host of the environment and the exact path `/api/v3.0`. Normalised (host case and trailing dot)                                                             | per environment               |
| `VIDSIGNER_CLIENT_ID`                  | OAuth client ID issued by Validated ID. **Required to write** (writes need a JWT)                                                                                                                                                                       | empty                         |
| `VIDSIGNER_CLIENT_SECRET`              | OAuth client secret                                                                                                                                                                                                                                     | empty                         |
| `VIDSIGNER_SUBSCRIPTION_NAME`          | Subscription name (required)                                                                                                                                                                                                                            | -                             |
| `VIDSIGNER_SUBSCRIPTION_PASS`          | Subscription password (required)                                                                                                                                                                                                                        | -                             |
| `VIDSIGNER_ALLOW_WRITE`                | Registers the write tools                                                                                                                                                                                                                               | `true` in pre, `false` in pro |
| `VIDSIGNER_ALLOW_DESTRUCTIVE`          | Registers DELETE, `PUT .../expire` and the management operations that amount to removing an account (also requires `ALLOW_WRITE`)                                                                                                                       | always `false`                |
| `VIDSIGNER_ALLOW_MARK_DOWNLOADED`      | Registers `vidsigner_download_signed_document` (it marks the document as downloaded)                                                                                                                                                                    | `true` in pre, `false` in pro |
| `VIDSIGNER_ALLOW_SIGNING_LINKS`        | Registers `vidsigner_get_signature_url` (whoever opens the link can sign). It does not cover the VIDmobile token or the enrollment codes                                                                                                                | `true` in pre, `false` in pro |
| `VIDSIGNER_ALLOW_CREDENTIAL_READS`     | Registers `vidsigner_mgmt_get_vidmobile_user_token` and `vidsigner_mgmt_list_enrollment_codes` (bearer credentials of the subscription)                                                                                                                 | `true` in pre, `false` in pro |
| `VIDSIGNER_ENABLE_MGMT`                | Registers the management API tools (`vidsigner_mgmt_*`)                                                                                                                                                                                                 | `false`                       |
| `VIDSIGNER_MGMT_BASE_URL`              | Override of the management API URL (same rules, management API host and the exact path `/api`)                                                                                                                                                          | per environment               |
| `VIDSIGNER_MGMT_CLIENT_ID`             | Management OAuth client ID (falls back to `VIDSIGNER_CLIENT_ID`)                                                                                                                                                                                        | empty                         |
| `VIDSIGNER_MGMT_CLIENT_SECRET`         | Management OAuth client secret (falls back to `VIDSIGNER_CLIENT_SECRET`)                                                                                                                                                                                | empty                         |
| `VIDSIGNER_MGMT_PARTNER_USER`          | Partner user (scope `partner`: partners, customers, subscriptions, enrollment codes)                                                                                                                                                                    | empty                         |
| `VIDSIGNER_MGMT_PARTNER_PASS`          | Partner password                                                                                                                                                                                                                                        | empty                         |
| `VIDSIGNER_ALLOW_LOCAL_HOSTS`          | Accepts `localhost` and `127.0.0.1` (also over `http:`) as base URL and as the target of `NotificationURL` and `returnUrl`, for test servers and local webhooks. **Only with `VIDSIGNER_ENV=pre`**; with `pro` the server refuses to start              | `false`                       |
| `VIDSIGNER_OUTPUT_DIR`                 | Folder for downloads and credentials (files are written with mode 0600). Absolute path; `~` is expanded. Created with 0700 if missing; **if it exists it must be yours and closed to group and others (0700)**, otherwise nothing is saved              | `<tmp>/vidsigner-mcp`         |
| `VIDSIGNER_ALLOWED_INPUT_DIRS`         | Comma-separated folders from which files may be read for upload. Absolute paths; `~` and `~/` are expanded. **There is always a list**: never the whole disk; `/` and the home directory are rejected. A missing folder is reported at startup          | `~/vidsigner-mcp/in`          |
| `VIDSIGNER_ALLOWED_EMAIL_DOMAINS`      | Allow-list of recipient email domains (comma-separated; `example.com`, `*.example.com`). Empty = no restriction                                                                                                                                         | empty                         |
| `VIDSIGNER_ALLOWED_PHONE_PREFIXES`     | Allow-list of phone prefixes (comma-separated; `+34`). Empty = no restriction                                                                                                                                                                           | empty                         |
| `VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS` | Allow-list of hosts for `NotificationURL` and `returnUrl` (comma-separated). Empty = no host restriction (the `https:` scheme is always required). It also bounds the URLs found in free-text fields                                                    | empty                         |
| `VIDSIGNER_ALLOWED_ASSET_HOSTS`        | Allow-list of hosts for resource URLs: `Appearance.APP.Logo` (and `App`), `EmailNotification.CorporateLogo` and `CustomerURL`. **A separate list** from the notification one. Empty = no restriction. It also bounds the URLs found in free-text fields | empty                         |
| `VIDSIGNER_MAX_UPLOAD_MB`              | Maximum upload size in MB                                                                                                                                                                                                                               | `20`                          |
| `VIDSIGNER_TIMEOUT_MS`                 | Timeout of each HTTP request (1000 to 300000)                                                                                                                                                                                                           | `30000`                       |
| `VIDSIGNER_MAX_RETRIES`                | Retries of idempotent requests on 5xx or network errors (0 to 10)                                                                                                                                                                                       | `2`                           |
| `VIDSIGNER_LOG_LEVEL`                  | `debug`, `info`, `warn`, `error`, `silent` (written to stderr)                                                                                                                                                                                          | `info`                        |
| `VIDSIGNER_IT`                         | Tests only: `1` enables the **read-only** integration test against pre-production (`npm run test:it`)                                                                                                                                                   | empty                         |
| `VIDSIGNER_IT_ENV_FILE`                | Tests only: path of the `.env` file used by the integration test                                                                                                                                                                                        | `./.env`                      |

`VIDSIGNER_BASE_URL` and `VIDSIGNER_MGMT_BASE_URL` are validated at startup: `https:` scheme, **no credentials in the URL**, no port (except 443), no query or fragment, the **exact host** of THEIR API and environment (an allow-list; host case and the trailing dot are normalised, and the signature and management APIs are not interchangeable) and the **exact path** (`/api/v3.0` and `/api`). If they do not comply, or point at the other environment's host, the server does not start. `localhost` and `127.0.0.1` (also over `http:`) are only accepted with `VIDSIGNER_ALLOW_LOCAL_HOSTS=true` and `VIDSIGNER_ENV=pre`.

Folder paths must be absolute after expanding `~` and `~/` (a `.env` file does not expand `$HOME`). At startup the output folder is created with mode 0700 and, if an input folder does not exist, a warning is logged (it is not created). Boolean variables accept `true`, `1` or `yes` (and `false`, `0` or `no`).

### Claude Desktop

Add the server to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vidsigner": {
      "command": "npx",
      "args": ["-y", "@nubiia/mcp-vidsigner@latest"],
      "env": {
        "VIDSIGNER_ENV": "pre",
        "VIDSIGNER_SUBSCRIPTION_NAME": "your-subscription",
        "VIDSIGNER_SUBSCRIPTION_PASS": "your-password",
        "VIDSIGNER_CLIENT_ID": "your-oauth-client-id",
        "VIDSIGNER_CLIENT_SECRET": "your-oauth-client-secret"
      }
    }
  }
}
```

If you installed from source, use `"command": "node"` and `"args": ["/path/to/mcp-vidsigner/dist/index.js"]`.

### Claude Code

Read-only against production (recommended for looking things up):

```bash
claude mcp add vidsigner-pro \
  -e VIDSIGNER_ENV=pro \
  -e VIDSIGNER_SUBSCRIPTION_NAME=... -e VIDSIGNER_SUBSCRIPTION_PASS=... \
  -- npx -y @nubiia/mcp-vidsigner@latest
```

Pre-production with writes (needs the OAuth client ID and secret):

```bash
claude mcp add vidsigner-pre \
  -e VIDSIGNER_ENV=pre \
  -e VIDSIGNER_CLIENT_ID=... -e VIDSIGNER_CLIENT_SECRET=... \
  -e VIDSIGNER_SUBSCRIPTION_NAME=... -e VIDSIGNER_SUBSCRIPTION_PASS=... \
  -- npx -y @nubiia/mcp-vidsigner@latest
```

### Cursor, Windsurf, VS Code and other MCP clients

Any client that launches stdio MCP servers works with the same command and environment. For example, in Cursor (`~/.cursor/mcp.json`) or Windsurf (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "vidsigner": {
      "command": "npx",
      "args": ["-y", "@nubiia/mcp-vidsigner@latest"],
      "env": {
        "VIDSIGNER_SUBSCRIPTION_NAME": "your-subscription",
        "VIDSIGNER_SUBSCRIPTION_PASS": "your-password"
      }
    }
  }
}
```

In VS Code, add the same `command`, `args` and `env` to a `vidsigner` entry under `servers` in `.vscode/mcp.json`.

With a `.env` file you can also run `node --env-file=.env dist/index.js`.

### Safety gates

Every tool has a risk, and it is registered only if its gate is open. A tool that is not registered does not exist for the model.

| Risk                                                | Flag that enables it                                          | In `pre` | In `pro` |
| --------------------------------------------------- | ------------------------------------------------------------- | -------- | -------- |
| read                                                | none                                                          | yes      | yes      |
| write                                               | `VIDSIGNER_ALLOW_WRITE`                                       | yes      | no       |
| destructive                                         | `VIDSIGNER_ALLOW_WRITE` **and** `VIDSIGNER_ALLOW_DESTRUCTIVE` | no       | no       |
| marks as downloaded                                 | `VIDSIGNER_ALLOW_MARK_DOWNLOADED`                             | yes      | no       |
| sensitive read (signing link)                       | `VIDSIGNER_ALLOW_SIGNING_LINKS`                               | yes      | no       |
| credential read (VIDmobile token, enrollment codes) | `VIDSIGNER_ALLOW_CREDENTIAL_READS`                            | yes      | no       |
| any `vidsigner_mgmt_*` tool                         | also `VIDSIGNER_ENABLE_MGMT`                                  | no       | no       |

#### Environment x flags x visible tools matrix

Computed with the real policy (regenerated by `scripts/gen-docs.mjs` into [`docs/TOOLS.md`](docs/TOOLS.md)).

| Configuration                                                         | Signature | Management | Total |
| --------------------------------------------------------------------- | --------- | ---------- | ----- |
| pre, default                                                          | 30        | 0          | 30    |
| pre + `VIDSIGNER_ENABLE_MGMT`                                         | 30        | 33         | 63    |
| pre + management + `VIDSIGNER_ALLOW_DESTRUCTIVE`                      | 35        | 46         | 81    |
| pro, default (read-only)                                              | 18        | 0          | 18    |
| pro + `VIDSIGNER_ENABLE_MGMT`                                         | 18        | 16         | 34    |
| pro + `VIDSIGNER_ALLOW_WRITE`                                         | 28        | 0          | 28    |
| pro + `ALLOW_WRITE` + `ALLOW_MARK_DOWNLOADED` + `ALLOW_SIGNING_LINKS` | 30        | 0          | 30    |
| pro + management + `ALLOW_CREDENTIAL_READS`                           | 18        | 18         | 36    |
| pro with every flag                                                   | 35        | 46         | 81    |

The visibility of each tool (which flag it needs) is in the detail of [`docs/TOOLS.md`](docs/TOOLS.md). The MCP annotations (`readOnlyHint`, `destructiveHint`) reflect the risk (a sensitive or credential read does **not** carry `readOnlyHint`, because clients may auto-approve read-only tools), and every description ends with a risk notice that names its flag.

### Defences against prompt injection

What the model reads (a PDF, a signer name, an email) may contain instructions. So that an injection cannot exfiltrate files or send documents to third parties:

- **Files by path**: `filePath` only reads inside `VIDSIGNER_ALLOWED_INPUT_DIRS` (default `~/vidsigner-mcp/in`; checked with `realpath`, extension included). Copy there whatever you want to upload.
- **Output folder**: `VIDSIGNER_OUTPUT_DIR` stores signed PDFs and rotated passwords. If it already exists it must be **owned by your user and closed to group and others (0700)**; otherwise startup warns and nothing is saved until you fix it (`chmod 700 <folder>`). If it does not exist it is created with 0700.
- **Recipients**: the **format** is always validated, with or without lists: every email or phone must be **one single** address or number (`a@example.org;b@example.com`, a comma, a space or a line break, `+34600111222,+1555000111` and `+346001112221+15551234` are rejected). **Mandatory emails** (recipients, VIDmobile users, forwards, `RecipientEmailAddress`, `NotificationEmails`, `CustomerEmail` when given) **accept neither empty nor `null`**; only a signer's email keeps the absence that the manual documents (`null`, `""` or `"null"`), and an empty phone is accepted with `AllowEmptyPhoneNumber`. The trimmed value is what gets sent: emails without spaces and phones without separators. With `VIDSIGNER_ALLOWED_EMAIL_DOMAINS`, `VIDSIGNER_ALLOWED_PHONE_PREFIXES`, `VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS` and `VIDSIGNER_ALLOWED_ASSET_HOSTS` set, any email, phone, `NotificationURL`, `returnUrl`, logo or `CustomerURL` outside the list is rejected **before** calling the API. **In `pro` you should always set them** (the server warns at startup when writes are enabled and they are missing).
- **URLs**: `NotificationURL` and `returnUrl` require `https:`, no user or password in the URL and no `\`, **even without lists** (`http://localhost` only with `VIDSIGNER_ALLOW_LOCAL_HOSTS=true` in pre, to test webhooks). Logos and `CustomerURL` use **their own** list (`VIDSIGNER_ALLOWED_ASSET_HOSTS`) and, when set, the same requirements: a logo CDN is not a webhook destination.
- **Free text** (`eMailBody`, `eMailSubject`, `Description`, `SignatureReason`, reminder subjects and bodies, the `EmailNotification` of the link forward...): if **any** host list is set (notification or assets), every URL in the text (`http(s)://...` and `www....`) must have its host in one of the two. Without lists nothing changes. It does not detect scheme-less or obfuscated addresses.
- **Sensitive and credential reads**: `vidsigner_get_signature_url` (whoever opens the link can sign) needs `VIDSIGNER_ALLOW_SIGNING_LINKS`; `vidsigner_mgmt_get_vidmobile_user_token` and `vidsigner_mgmt_list_enrollment_codes` (subscription credentials) need `VIDSIGNER_ALLOW_CREDENTIAL_READS`. In `pro` they are off by default and none of them carries `readOnlyHint`.
- **Unexpected errors**: they do not return their message to the model (it may contain paths); the detail goes to the log, redacted.

## Tools and risk levels

Risks: **read**; **sensitive read** (a GET that returns a link that lets someone act: the signing link); **credential read** (a GET that returns a bearer credential: the token of a VIDmobile user and the device enrollment codes); **write** (creates or modifies, or sends real emails/SMS); **destructive** (irreversible, or equivalent to removing someone's account: DELETE, expire, and in management changing a VIDmobile user's password, email or state, or updating/activating/deactivating a subscription); **marks as downloaded** (a GET with a side effect).

Conventions: bodies use the exact field names of the API (PascalCase) and are **validated strictly**: an unknown key is rejected with the closest known spelling (`Unknown field "Emial": did you mean "Email"?`) instead of being dropped or forwarded; uploads accept `filePath` (a local path) or `contentBase64`; downloads (PDFs, reports, images, certificates) are saved to disk and the tool returns the path, never the base64. Subscription passwords and tokens are never returned: they are shown as `[hidden]` or saved to a 0600 file.

Every tool is documented in three places: in the code (an English description for the model with "Use when", the flag that enables it, the side effects and, for write tools, a usage example; plus the description of every parameter, nested ones included), in [`docs/TOOLS.md`](docs/TOOLS.md) (per tool: operation, risk, flag, summary, main parameters, notes and example) and in the tables below. A test (`tests/tools/tool-docs.test.ts`) fails if a tool has no description, no "Use when", no valid example (write tools) or a parameter without a `description`.

### Signature API (35 tools)

| Tool                                        | Endpoint                                   | Risk                |
| ------------------------------------------- | ------------------------------------------ | ------------------- |
| `vidsigner_create_document`                 | `POST /documents`                          | write               |
| `vidsigner_get_document`                    | `GET /documents/{id}`                      | read                |
| `vidsigner_delete_document`                 | `DELETE /documents/{id}`                   | destructive         |
| `vidsigner_get_document_log`                | `GET /documents/{id}/loginfo`              | read                |
| `vidsigner_expire_document`                 | `PUT /documents/{docGuid}/expire`          | destructive         |
| `vidsigner_get_document_report`             | `GET /documents/{id}/report/{lang}`        | read                |
| `vidsigner_get_document_info`               | `GET /documentinfo/{guid}`                 | read                |
| `vidsigner_list_documents`                  | `GET /documentlist/{filter}`               | read                |
| `vidsigner_list_documents_by_device`        | `GET /documentsbydevice`                   | read                |
| `vidsigner_list_signed_documents`           | `GET /signeddocuments`                     | read                |
| `vidsigner_download_signed_document`        | `GET /signeddocuments/{id}`                | marks as downloaded |
| `vidsigner_delete_signed_document`          | `DELETE /signeddocuments/{id}`             | destructive         |
| `vidsigner_get_signature_url`               | `GET /signature/{SignerGUID}/vidremoteurl` | sensitive read      |
| `vidsigner_send_signature_url`              | `PUT /signature/{SignerGUID}/vidremoteurl` | write               |
| `vidsigner_add_signature_attachment`        | `POST /signature/{SignerGUID}/attachments` | write               |
| `vidsigner_update_signer_data`              | `PUT /signature/{SignerGUID}/signerdata`   | write               |
| `vidsigner_get_signature_metadata`          | `GET /signature/{id}/signaturedata`        | read                |
| `vidsigner_get_signature_evidence`          | `GET /signature/{id}/evidence`             | read                |
| `vidsigner_get_vidmobile_signature_request` | `GET /vidmobileuser/signaturerequest/{id}` | read                |
| `vidsigner_create_batch`                    | `POST /documentbatch`                      | write               |
| `vidsigner_add_document_to_batch`           | `POST /documentbatch/{batchGuid}/document` | write               |
| `vidsigner_close_batch`                     | `PUT /documentbatch/{batchGuid}/status`    | write               |
| `vidsigner_get_batch_info`                  | `GET /documentbatchinfo/{batchGuid}`       | read                |
| `vidsigner_delete_batch`                    | `DELETE /documentbatch/{batchGuid}`        | destructive         |
| `vidsigner_create_edelivery`                | `POST /edeliveries`                        | write               |
| `vidsigner_list_edeliveries`                | `GET /edeliveries`                         | read                |
| `vidsigner_get_edelivery`                   | `GET /edeliveries/{guid}`                  | read                |
| `vidsigner_delete_edelivery`                | `DELETE /edeliveries/{guid}`               | destructive         |
| `vidsigner_get_edelivery_report`            | `GET /edeliveries/{guid}/report/{lang}`    | read                |
| `vidsigner_send_edelivery_reminder`         | `PUT /edeliveries/{guid}/reminders`        | write               |
| `vidsigner_search_edeliveries`              | `POST /edeliveries/search`                 | read                |
| `vidsigner_list_devices`                    | `GET /devices`                             | read                |
| `vidsigner_list_enrollment_code_devices`    | `GET /enrollmentcodes/{id}/devices`        | read                |
| `vidsigner_search`                          | `POST /search`                             | read                |
| `vidsigner_sign_xml`                        | `POST /xml/sign`                           | write               |

### Management API (46 tools, `VIDSIGNER_ENABLE_MGMT=true`)

| Tool                                                   | Endpoint                                              | Risk            |
| ------------------------------------------------------ | ----------------------------------------------------- | --------------- |
| `vidsigner_mgmt_list_partners`                         | `GET /partners`                                       | read            |
| `vidsigner_mgmt_get_partner`                           | `GET /partners/{partnerguid}`                         | read            |
| `vidsigner_mgmt_list_customers`                        | `GET /partners/{partnerguid}/customers`               | read            |
| `vidsigner_mgmt_create_customer`                       | `POST /partners/{partnerguid}/customers`              | write           |
| `vidsigner_mgmt_get_customer`                          | `GET /customers/{customerguid}`                       | read            |
| `vidsigner_mgmt_update_customer`                       | `PUT /customers/{customerguid}`                       | write           |
| `vidsigner_mgmt_delete_customer`                       | `DELETE /customers/{customerguid}`                    | destructive     |
| `vidsigner_mgmt_list_subscriptions`                    | `GET /customers/{customerguid}/subscriptions`         | read            |
| `vidsigner_mgmt_create_subscription`                   | `POST /customers/{customerguid}/subscriptions`        | write           |
| `vidsigner_mgmt_get_subscription`                      | `GET /subscriptions/{id}`                             | read            |
| `vidsigner_mgmt_update_subscription`                   | `PUT /subscription/{subscriptionguid}`                | destructive     |
| `vidsigner_mgmt_set_subscription_status`               | `PUT /subscription/{guid}/status/{status}`            | destructive     |
| `vidsigner_mgmt_delete_subscription`                   | `DELETE /subscription/{subscriptionguid}`             | destructive     |
| `vidsigner_mgmt_list_enrollment_codes`                 | `GET /subscription/{guid}/enrollmentcode`             | credential read |
| `vidsigner_mgmt_create_enrollment_code`                | `POST /subscription/{guid}/enrollmentcode`            | write           |
| `vidsigner_mgmt_update_enrollment_code`                | `PUT /enrollmentcodes/{guid}`                         | write           |
| `vidsigner_mgmt_delete_enrollment_code`                | `DELETE /enrollmentcodes/{guid}`                      | destructive     |
| `vidsigner_mgmt_list_subscription_vidmobile_users`     | `GET /subscription/{guid}/vidmobileusers`             | read            |
| `vidsigner_mgmt_list_subscription_vidstamper_users`    | `GET /subscription/{guid}/vidstamperusers`            | read            |
| `vidsigner_mgmt_list_vidmobile_users`                  | `GET /vidmobileusers`                                 | read            |
| `vidsigner_mgmt_get_vidmobile_user`                    | `GET /vidmobileusers/{legalid}`                       | read            |
| `vidsigner_mgmt_get_vidmobile_user_token`              | `GET /vidmobileusers/{legalid}/token`                 | credential read |
| `vidsigner_mgmt_get_vidmobile_user_personal_data`      | `GET /vidmobileusers/{legalid}/personaldata`          | read            |
| `vidsigner_mgmt_create_vidmobile_user`                 | `POST /vidmobileusers`                                | write           |
| `vidsigner_mgmt_delete_vidmobile_user`                 | `DELETE /vidmobileusers/{legalid}`                    | destructive     |
| `vidsigner_mgmt_update_vidmobile_user_name`            | `PUT /vidmobileusers/{id}/username`                   | write           |
| `vidsigner_mgmt_update_vidmobile_user_signature_image` | `PUT /vidmobileusers/{id}/signatureimage`             | write           |
| `vidsigner_mgmt_update_vidmobile_user_password`        | `PUT /vidmobileusers/{id}/password`                   | destructive     |
| `vidsigner_mgmt_update_vidmobile_user_email`           | `PUT /vidmobileusers/{id}/email`                      | destructive     |
| `vidsigner_mgmt_send_vidmobile_user_password_reminder` | `PUT /vidmobileusers/{legalid}/remindpasswordrequest` | write           |
| `vidsigner_mgmt_set_vidmobile_user_state`              | `PUT /vidmobileusers/{legalid}/state/{state}`         | destructive     |
| `vidsigner_mgmt_list_vidmobile_user_certificates`      | `GET /vidmobileusers/{legalid}/certs`                 | read            |
| `vidsigner_mgmt_add_vidmobile_user_certificate`        | `POST /vidmobileusers/{legalid}/certs`                | write           |
| `vidsigner_mgmt_delete_vidmobile_user_certificate`     | `DELETE /vidmobileusers/{legalid}/certs/{certid}`     | destructive     |
| `vidsigner_mgmt_set_vidmobile_user_cert_types`         | `PUT /vidmobileusers/{legalid}/certstype`             | write           |
| `vidsigner_mgmt_list_stamp_certificates`               | `GET /subscription/{guid}/stampcertificates`          | read            |
| `vidsigner_mgmt_add_stamp_certificate`                 | `POST /subscription/{guid}/stampcertificates`         | write           |
| `vidsigner_mgmt_search_statistics`                     | `POST /subscription/{guid}/stats/search`              | read            |
| `vidsigner_mgmt_update_device`                         | `PUT /devices/{DeviceName}`                           | write           |
| `vidsigner_mgmt_delete_device`                         | `DELETE /devices/{DeviceName}`                        | destructive     |
| `vidsigner_mgmt_list_tsystems_doctypes`                | `GET /subscription/{guid}/tsystemsdoctypes`           | read            |
| `vidsigner_mgmt_create_tsystems_doctype`               | `POST /subscription/{guid}/tsystemsdoctypes`          | write           |
| `vidsigner_mgmt_delete_tsystems_doctype`               | `DELETE /tsystemsdocumenttype/{guid}`                 | destructive     |
| `vidsigner_mgmt_list_tsystems_bookcodes`               | `GET /subscription/{guid}/tsystemsbookcodes`          | read            |
| `vidsigner_mgmt_create_tsystems_bookcode`              | `POST /subscription/{guid}/tsystemsbookcode`          | write           |
| `vidsigner_mgmt_delete_tsystems_bookcode`              | `DELETE /tsystemsbookcodes/{guid}`                    | destructive     |

## Example flows

The calls are those of an MCP client; GUIDs and paths are made up. In all of them `docGuid` is the `DocGUI` returned when the document is created.

### 1. Check the status of a document

Reads only: it works in `pro` without enabling anything.

```text
vidsigner_search              {"additionaldata": "ORDER-2026-0001", "elementtype": "document"}
  -> { "count": 1, "items": [{ "DocGUI": "0b6f1d0e-..." }] }          # the DocGUI
vidsigner_get_document_info   {"docGuid": "0b6f1d0e-..."}
  -> status of the document and of each signature: SignerGUID, SignatureStatus, evidence
vidsigner_get_document_log    {"docGuid": "0b6f1d0e-..."}           # optional: operations trace
```

If you do not know the `AdditionalData`, use `vidsigner_list_documents` (flow 4). Sending `elementtype` on its own only yields 400/10608: always send `additionaldata`.

### 2. Create a document with your own signing link (no VIDsigner email)

Needs `VIDSIGNER_CLIENT_ID/SECRET` (JWT), `VIDSIGNER_ALLOW_WRITE=true` (the default in pre) and `VIDSIGNER_ALLOW_SIGNING_LINKS=true` (the default in pre). The subscription needs the `AllowSkipEmail` permission (otherwise 409/40111).

```text
1. vidsigner_create_document   {"filePath": "~/vidsigner-mcp/in/contract.pdf",
                                "IssuerName": "Acme",
                                "SignersGroups": [{"Signers": [{
                                  "SignatureType": "emailandsms", "SkipSignatureEmail": true,
                                  "SignerName": "Jane Doe", "Email": "jane@example.com",
                                  "PhoneNumber": "+34600111222", "Language": "es"}]}]}
   -> { "DocGUI": "0b6f1d0e-..." }
2. vidsigner_get_document_info {"docGuid": "0b6f1d0e-..."}           # read the SignerGUID
3. vidsigner_get_signature_url {"signerGuid": "5c1e8a42-...", "returnUrl": "https://app.example.com/signed"}
   -> { "url": "https://...", "returnUrlAppended": true }
```

The link is a bearer credential: hand it only to the signer, through your own channel. If the signer was not created with `SkipSignatureEmail=true`, step 3 answers 409/16601. Use test signers only in pre.

### 3. Download the signed document and the evidence report

```text
vidsigner_get_document_info     {"docGuid": "0b6f1d0e-..."}          # check that it is signed
vidsigner_get_document          {"docGuid": "0b6f1d0e-...", "outputFileName": "contract-signed"}
  -> { "savedTo": "<output>/20261117-101500-ab12cd34-contract-signed.pdf", "sha256": "..." }
vidsigner_get_document_report   {"docGuid": "0b6f1d0e-...", "lang": "en"}
  -> { "savedTo": "<output>/...-report-0b6f1d0e-...-en.pdf" }
```

`vidsigner_get_document` does **not** mark the document as downloaded; `vidsigner_download_signed_document` does (and takes it out of the queue of signed-but-not-downloaded documents that other integrations of the same subscription may be consuming), which is why in `pro` it only exists with `VIDSIGNER_ALLOW_MARK_DOWNLOADED=true`. The report of an unsigned document that has not expired answers 409/50013. Files are saved with mode 0600 in `VIDSIGNER_OUTPUT_DIR`; the tools return the path, never the content.

### 4. Walk through the pending documents with pagination

```text
vidsigner_list_documents {"filter": "unsigned", "pageNumber": 1, "pageSize": 50,
                          "orderBy": "UploadTime", "orderType": "desc"}
  -> { "count": 50, "items": [...], "pageNumber": 1, "totalPages": 3, "hasNext": true }
vidsigner_list_documents {"filter": "unsigned", "pageNumber": 2, "pageSize": 50, ...}
  -> ... until hasNext = false
```

`pageSize` goes from 1 to 99 (with 100 or more the API answers 400). To fetch everything at once: `{"filter": "unsigned", "fetchAll": true, "maxPages": 50}`; **if the answer carries `truncated: true`, the list is incomplete**: raise `maxPages` or filter. `orderType` accepts `asc`, `des` and `desc` (`des` is what is sent). An empty list comes back as `[]`.

## Known restrictions (verified in pre-production, 16/11/2026)

- **Writes require a JWT.** `POST /documents` with Basic answers 401 "Token not found". With the subscription alone you can read. You need to ask Validated ID for a client ID and secret. Without them, writes fail in the client before anything is sent.
- **`SkipSignatureEmail` and `AllowSkipEmail`.** `GET /signature/{SignerGUID}/vidremoteurl` only works if the signer was created with `SkipSignatureEmail=true` (otherwise 409/16601). The subscription needs the `AllowSkipEmail` permission (otherwise 409/40111). `url_return` is appended to the URL in base64.
- **`documentlist` pagination.** `pageNumber` starts at 1 and `pageSize` must be greater than 0 and less than 100. If any pagination parameter is sent, the API requires both: the client fills in `pageNumber=1` and `pageSize=50` by default.
- **Empty lists answer 404, not `[]`.** `GET /documentlist` (50002) and `GET /devices` (70001) are normalised to an empty list by their code. `GET /signeddocuments` and the management listings answer 404 with no body (or "list is empty", or a bare "Elements not found") for an empty collection: those are normalised too. A 404 that names a resource ("Element not found. No vidmobile user...", "Customer not exist") **is an error**, not an empty list.
- **`documentlist`**: `searchText` of 3 to 10 characters (400/10601); `orderBy` only `FileName`, `DocStatus`, `Downloaded`, `AdditionalData` or `UploadTime` (the server also advertises `DocGUI` but answers 400/10500); `orderType` is `asc`, `des` or `desc`: the server only understands `asc` and `des` (with `desc` it answers 400/10521, checked in pre with a GET on 16/11/2026), so `desc` is accepted and sent as `des`. `fetchAll` returns `truncated: true` if it stops at `maxPages`.
- **Spellings that differ between the OpenAPI and the manual** (`eMail`/`Email`, `APP`/`App`, `CertificateGUI`/`CertificateGUID`, `WhatsApp`/`whatsapp`, `SignersGroups`/`SignerGroups`, `BatchGUI`/`Guid`, `DocGUI`/`GUID`): the tools accept both, normalise them and, where there is a real doubt, send both. The decision lives in `src/tools/aliases.ts` and is **pending verification in pre-production with a ClientID** (writes require a JWT).
- **`GET /signeddocuments/{id}` marks the document as downloaded** (manual 14.7). Other integrations of the same subscription may consume that queue. In `pro` the tool requires `VIDSIGNER_ALLOW_MARK_DOWNLOADED=true`; to read a document without side effects use `vidsigner_get_document` (`GET /documents/{id}`).
- **`vidsigner_mgmt_update_subscription`** takes no `SubscriptionPass`: by default it re-sends the current password (read server-side) and with `rotatePassword=true` it generates a 20-character one, **saves it first** to a 0600 file (after checking that the output folder is writable) and only then does the PUT; it returns only the path. If the PUT fails, the file is renamed to `.failed` and the error says so: on a 4xx it says the password was **not** applied and can be deleted; on a network error, a timeout or a 5xx it says it is unknown whether the password was applied and that you must NOT delete the file (it may be the only copy of the password in force). If it could not be renamed, the message gives the real path of the file. **A rotated password invalidates the credentials of this MCP (if it is the same subscription) and those of any other consumer of the same credentials (for example your backend) until their environment is updated**; the answer warns about it. The password never goes through the model.
- **Empty lists without a code**: a 404 without a catalog code (empty body or "list is empty") is normalised to an empty list and leaves a `warn` in the log, to detect a missing parent resource mistaken for an empty one.
- **`null` fields**: where the manual documents it (`SignerName` = `SignerFullNameOrNULL`, `PhoneNumber` with `AllowEmptyPhoneNumber`, `DeviceName`, `Email`, `SignaturePolicy` = `FacturaeOrNull`, and the optional fields of customers and subscriptions) the tools accept `null` and send it.
- **Reading files**: "does not exist", "not accessible" and "outside the allowed folders" give the same message (there is no existence oracle) and only regular files are read (FIFOs, devices and folders are rejected). Requires Node >= 20.11.
- **`POST /search`**: the accepted terms are `additionaldata` and `elementtype`. `elementtype` sent **alone** (without `additionaldata`) is rejected with 400/10608; always send `additionaldata` (`elementtype` is optional in combination). A search with no results returns `[]`.
- **E-Delivery** is not enabled in the demo subscription (409/40008).
- POSTs that create resources and PUTs that send notices are **not retried** (a retry would duplicate documents or emails).
- The server sometimes echoes the authentication header in the error message (20103); the client redacts it.

## Known limitations and open questions

What the server does **not** do, or cannot guarantee today:

- **Passwords and PINs as arguments.** `vidsigner_mgmt_create_vidmobile_user` and `vidsigner_mgmt_update_vidmobile_user_password` receive the user's password, and `vidsigner_mgmt_add_vidmobile_user_certificate`, `vidsigner_mgmt_add_stamp_certificate` and `vidsigner_sign_xml` the certificate PIN, as an argument of the call: they go through the model's context. Only the subscription password is resolved on the server (`update_subscription`).
- **Free text without schema or list.** The URL check in `eMailBody`, `Description`... detects `http(s)://` and `www.`; it does not detect scheme-less or obfuscated addresses, nor links that the email client builds.
- **Size of `tools/list`.** With all 81 tools enabled the listing is around 160 KB; the schemas of `create_document`, `add_document_to_batch` and `create_batch` account for about 68 KB of that. To reduce it, do not enable management or writes if you do not need them.
- **Without a ClientID you cannot write** (nor verify the writes): see the first point of the restrictions.

Open questions, **pending confirmation with Validated ID or with full credentials**:

1. **Spellings to verify with a ClientID.** The ones that differ between the OpenAPI and the manual (`eMail`/`Email` in signers and recipients, `APP`/`App`, `CertificateGUI`/`CertificateGUID`, `WhatsApp`/`whatsapp`) are accepted and, where there is a real doubt, both are sent. Which spelling each endpoint really accepts can only be verified with a real `POST` (it needs a JWT). The full table, with its status, is at the end of [`docs/TOOLS.md`](docs/TOOLS.md).
2. **Format of the VIDmobile token response** (`GET /vidmobileusers/{legalid}/token`): the manual lists it without a detail section. It is saved as is to a 0600 file.
3. **Valid values of `state`** in `PUT /vidmobileusers/{legalid}/state/{state}`: undocumented (probably `active` and `inactive`). Try it only in pre.
4. **`DELETE /documentbatch/{id}`** only appears in Annex III of the manual: it may not exist in your version.
5. **`PUT /subscription/{guid}/status/{status}`**: the manual is inconsistent (`status` versus `state` in the example).
6. **E-Delivery** is not enabled in the demo subscription (409/40008), so its writes have not been exercised.
7. **`POST /oauth/code`** (changelog of the management manual v1.17) has no section or format: it is not implemented.

## TypeScript client without MCP

The package also exports the typed HTTP client, so you can use it from your own backend without going through MCP.

```ts
import { VidSignerClient } from '@nubiia/mcp-vidsigner';

const client = new VidSignerClient({
  environment: 'pre',
  clientId: process.env.VIDSIGNER_CLIENT_ID,
  clientSecret: process.env.VIDSIGNER_CLIENT_SECRET,
  subscriptionName: process.env.VIDSIGNER_SUBSCRIPTION_NAME!,
  subscriptionPass: process.env.VIDSIGNER_SUBSCRIPTION_PASS!,
});
const pending = await client.listAllDocuments('unsigned');
```

The webhook types (Annex I) are imported from `@nubiia/mcp-vidsigner/webhooks` (`DocumentNotificationPayload`, `BatchNotificationPayload`, `parseWebhookPath`...).

## Development

```bash
npm install
npm run lint && npm run typecheck && npm run build && npm test
```

The tests use a mocked `fetch` (authentication and renewal, empty-list 404s, error mapping, retries, pagination, gates, end-to-end MCP over an in-memory transport). They need no network, no credentials and no vendor documentation. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

**Parameter completeness test** (`tests/tools/param-completeness.test.ts`): for all 81 tools it cross-checks what is documented (API surface + manual-only extras; the management manual) against the schema the model sees and against the request that reaches the wire, by calling every tool with every parameter filled in. It fails if a documented parameter is not visible (with its description) or is not sent, and it checks that the client types every body field. `VIDSIGNER_MATRIX_OUT=matrix.json npx vitest run tests/tools/param-completeness.test.ts` writes the coverage summary.

Optional integration test, **reads only**, against pre-production:

```bash
VIDSIGNER_IT=1 npm run test:it                      # uses ./.env
VIDSIGNER_IT=1 VIDSIGNER_IT_ENV_FILE=/path/.env npm run test:it
```

It only runs if `VIDSIGNER_IT=1`, the `.env` file with credentials exists and the environment is `pre`. It never creates or sends anything.

### Commits and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:`; `!` or a `BREAKING CHANGE:` footer for breaking changes). Releases are automated with [semantic-release](https://semantic-release.gitbook.io/): merging `development` into `main` runs the `Release` workflow, which derives the version from the commits (`feat` is a minor bump, `fix` and `perf` a patch, a breaking change a major one; other types do not release), updates `CHANGELOG.md`, publishes to npm with provenance, creates the `vX.Y.Z` tag and the GitHub release, and publishes `server.json` to the MCP Registry. The version in `package.json` and `server.json` is managed by the release commit: do not edit it by hand. The full flow is in [`CONTRIBUTING.md`](CONTRIBUTING.md#releasing-maintainers); the history of released versions is in [`CHANGELOG.md`](CHANGELOG.md).

### Vendor documentation and regenerating the generated files

The VIDsigner OpenAPI document and the REST and management manuals are the property of Validated ID and are available to its customers. **This repository does not redistribute them**: it versions only the artifacts generated from them (TypeScript types, zod schemas, the error catalog, an API surface file with operation, parameter and property names, and the field-name fixtures used by the tests). The tests that compare those artifacts against the vendor documents are skipped, with a warning, unless you provide it.

To regenerate, put `VIDsignerOpenAPI_Lastest.json` and `VIDsignerAPI_Rest_Lastest.txt` (the manual as text, for example from `pdftotext`) in a directory and point `VIDSIGNER_SPEC_DIR` at it (or pass `--spec-dir <dir>`). Without it, the generators exit with "requires the VIDsigner OpenAPI/manual, available to Validated ID customers".

| Command                                 | Reads                                                                                 | Writes                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run gen:types`                     | OpenAPI                                                                               | `src/client/generated/vidsigner-api.ts` (descriptive text of the vendor document is stripped)               |
| `npm run gen:schemas`                   | OpenAPI + `data/manual-extras.json` + `data/field-docs.json` + `src/tools/aliases.ts` | `data/openapi-surface.json`, `src/tools/generated/body-schemas.ts`, `src/client/generated/manual-extras.ts` |
| `npm run gen:schemas -- --from-surface` | the versioned surface and the same hand-written inputs (no vendor documents needed)   | the two generated source files                                                                              |
| `npm run gen:manual-fields`             | REST manual text                                                                      | `tests/fixtures/rest-manual-fields.ts` (`-- --check` fails if it does not match)                            |
| `npm run gen:errors`                    | REST manual text (Annex III)                                                          | `src/client/errors/catalog.generated.ts`                                                                    |
| `npm run gen:docs`                      | the compiled tools                                                                    | `docs/TOOLS.md`                                                                                             |

The management API DTOs are hand-written in `src/client/mgmt-types.ts` (there is no management OpenAPI).

## Docker

```bash
docker build -t mcp-vidsigner .
docker run -i --rm -e VIDSIGNER_SUBSCRIPTION_NAME=... -e VIDSIGNER_SUBSCRIPTION_PASS=... mcp-vidsigner
```

The transport is stdio (`-i`).

## Security

- Keep your subscription credentials and OAuth client secret out of version control; prefer a dedicated subscription user for this server.
- Start with `VIDSIGNER_ENV=pre` and test signers. Production is read-only until you open each gate.
- Set the recipient and host allow-lists in production.
- Report vulnerabilities privately: see [`SECURITY.md`](SECURITY.md).

## FAQ

**Is this an official Validated ID product?**
No. It is an unofficial, community-maintained project, not affiliated with, endorsed or sponsored by Validated ID. VIDsigner is a trademark of Validated ID, S.L.

**Do I need a VIDsigner account?**
Yes. You need your own VIDsigner subscription (pre-production or production). To create or change anything you also need the OAuth client ID and secret that Validated ID issues for your subscription.

**Can the model send documents to anyone?**
Only if you let it. Production starts read-only, writes need `VIDSIGNER_ALLOW_WRITE`, and the recipient allow-lists (`VIDSIGNER_ALLOWED_EMAIL_DOMAINS`, `VIDSIGNER_ALLOWED_PHONE_PREFIXES`, hosts) restrict who can be contacted.

**Why are some tools missing from my assistant?**
Tools that are not enabled are not registered. See the [safety gates](#safety-gates) and the visibility matrix.

**Which MCP clients work?**
Any client that runs stdio MCP servers: Claude Desktop, Claude Code, Cursor, Windsurf, VS Code and others.

**Does it work with the VIDsigner management API?**
Yes, set `VIDSIGNER_ENABLE_MGMT=true` and the partner credentials. The 46 management tools are described in [`docs/TOOLS.md`](docs/TOOLS.md).

## License

[MIT](LICENSE). The license covers the code of this repository only; it grants no rights over VIDsigner, its documentation or its trademarks.

## Related

- [`@nubiia/mcp-signaturit`](https://github.com/nubiia-dev/mcp-signaturit): MCP server for the Signaturit e-signature API.
- [`@nubiia/mcp-holded`](https://github.com/nubiia-dev/mcp-holded): MCP server for the Holded invoicing and accounting API.
