# FINAL_SURGICAL_AUDIT_REPORT

- Generated: 2026-04-24T00:31:26.693Z
- Mode: runtime
- Decision: RED
- Integrity Score: 75%
- Summary: Critical findings were detected.

## Severity Counts

- Critical: 1
- High: 0
- Medium: 0
- Low: 0
- Info: 0


## Runtime Checks

- PASS health-endpoint (status=200)
- PASS metrics-auth-without-token (status=401)
- PASS metrics-auth-with-token (status=200)
- PASS cors-allowed-origin
- PASS cors-denied-origin (status=500)
- PASS protected-endpoint-without-session (status=401)
- PASS auth-cookie-flags (status=201)
- FAIL socket-rejects-anonymous-connection
- PASS socket-rejects-disallowed-origin

## Top Findings

1. [CRITICAL] Socket.IO namespace accepted an anonymous connection | evidence: /realtime via /socket.io

## Stage Status

- Static findings: 0
- Runtime findings: 1
