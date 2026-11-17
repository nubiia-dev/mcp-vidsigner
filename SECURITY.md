# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public issue
2. Use GitHub's private vulnerability reporting on this repository, or email hola@nubiia.es
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to understand and address the issue.

Vulnerabilities in the VIDsigner service itself must be reported to Validated ID. This project is not affiliated with Validated ID.

## Security Best Practices

When using this MCP server:

- Keep your VIDsigner subscription credentials and OAuth client secret secure and never commit them to version control
- Use environment variables for sensitive configuration, and a dedicated subscription user for this server so it can be rotated independently
- Start with `VIDSIGNER_ENV=pre` and test signers. Production starts read-only; open each gate (`VIDSIGNER_ALLOW_*`) only when you need it
- In production, set the recipient allow-lists (`VIDSIGNER_ALLOWED_EMAIL_DOMAINS`, `VIDSIGNER_ALLOWED_PHONE_PREFIXES`, `VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS`, `VIDSIGNER_ALLOWED_ASSET_HOSTS`) so a prompt injection cannot send documents to third parties
- Keep `VIDSIGNER_ALLOWED_INPUT_DIRS` limited to a dedicated folder, and `VIDSIGNER_OUTPUT_DIR` private (mode 0700)
- Treat signing links and VIDmobile tokens as bearer credentials: whoever holds them can act on the subscription
- Regularly update to the latest version for security patches
- Review the permissions granted to the MCP server in your AI assistant
