# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through
GitHub: **Security → Report a vulnerability**
(<https://github.com/cipansor/cipansor/security/advisories/new>). Only the
maintainers see it until a fix is ready and you agree to disclose it.

Include, as far as you know: what is affected (a URL or a module), the steps to
reproduce, the impact, and any proof of concept. A partial report is still
useful — send what you have rather than waiting for a complete one.

The same form is offered from the "New issue" page so that a blank issue is not
mistaken for a safe place to publish a vulnerability.

## Contact

For anything outside a vulnerability report — questions about this policy, the
advisory process, or how a report is handled — write to
**admin@cipansor.or.id**.

## What to expect

- An acknowledgement within a few days.
- A private advisory where the fix is prepared and discussed with you.
- Credit in the advisory, unless you ask to stay anonymous.

## Supported versions

Only the deployed `production` build is supported. A fix ships as a normal
release; there are no backports to older builds.

## For maintainers

Automations that handle untrusted content (issues, pull requests, comments) run
with a least-privilege secret allowlist and treat that content as data, not as
instructions. See `docs/IDEAS.md` and `docs/SDLC-FLOW.md` for the guardrails
each automation keeps.
