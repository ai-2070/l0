# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in L0, please report it by emailing:

**makerseven7@gmail.com**

Please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes (optional)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Resolution target**: Within 30 days for critical issues

## Scope

This security policy covers:

- The L0 runtime library (`l0` npm package)
- All code in this repository

## Out of Scope

- Vulnerabilities in dependencies (report to the respective maintainers)
- Vulnerabilities in LLM providers (OpenAI, Anthropic, etc.)
- Issues that require physical access to a user's machine

## Disclosure Policy

We follow coordinated disclosure. Please allow us reasonable time to address the issue before public disclosure.

## Security Best Practices

When using L0 in production:

1. **Keep dependencies updated** - Run `npm audit` regularly
2. **Use guardrails** - Enable `recommendedGuardrails` or `strictGuardrails` to catch malformed output
3. **Validate structured output** - Always use Zod schemas with `structured()` for type-safe parsing
4. **Handle errors gracefully** - Use `isL0Error()` to catch and log failures appropriately
5. **Set timeouts** - Configure `initialToken` and `interTokenTimeout` to prevent hanging requests
