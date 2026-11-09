# Security Policy

## Supported Versions

We release security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 6.x     | :white_check_mark: |
| < 6.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories** (Recommended)
   - Navigate to the [Security tab](../../security)
   - Click "Report a vulnerability"
   - Fill in the details

2. **Email**
   - Send details to the repository maintainers
   - Include "SECURITY" in the subject line

### What to Include

When reporting a vulnerability, please include:

- Type of issue (e.g. buffer overflow, SQL injection, XSS, etc.)
- Full paths of source file(s) related to the issue
- Location of the affected source code (tag/branch/commit/direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: Within 7 days
  - High: Within 30 days
  - Medium: Within 90 days
  - Low: Next regular release

### Disclosure Policy

- We follow a coordinated disclosure process
- Security patches will be released before public disclosure
- We will credit reporters in the security advisory (unless they wish to remain anonymous)

## Security Best Practices for Users

When using this extension:

1. **Keep Updated**: Always use the latest version
2. **Review Files**: Be cautious when opening files from untrusted sources
3. **Check Permissions**: Review extension permissions before installation
4. **Report Issues**: If you notice unusual behavior, report it

## Known Security Considerations

### File Parsing

- Large files may consume significant memory
- Size limits are enforced to prevent memory exhaustion (see ADR-0016)
- Malformed files are handled gracefully without crashes

### Content Security Policy

- Webviews use strict CSP to prevent XSS attacks
- See `src/common/webviewCsp.ts` for details
- Inline scripts are blocked

### Network Requests

- The extension does not make unauthorized network requests
- Remote resources are only loaded for virtual documents via VS Code's API

## Security Updates

Security updates will be announced through:

- GitHub Security Advisories
- GitHub Releases with `[SECURITY]` tag
- Extension marketplace update notes

Thank you for helping keep vscode-office and its users safe!
