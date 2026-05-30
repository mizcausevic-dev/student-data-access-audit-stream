# student-data-access-audit-stream

> **Student Data Access Audit Stream v0.1 draft.** Hash-chained append-only ledger of *which AI tool read which student record, when, under what FERPA disclosure exception (or COPPA consent basis for under-13), under which buyer-published Decision Card*. Bridges **CEDS** + **Ed-Fi** resource semantics to the Kinetic Gain Protocol Suite hash-chained audit-stream spine so an LEA's data-protection officer + state ED auditor + IEP team get one verifiable record of AI access — across the SIS, the LMS, the IEP-management system, and any downstream Decision Card-governed surface.

Part of the [Kinetic Gain Protocol Suite](https://suite.kineticgain.com).

> Status: v0.1 draft. Schema at [`schema/student-data-access-event.schema.json`](./schema/student-data-access-event.schema.json), two examples at [`examples/`](./examples/), reference verifier at [`src/verify.mjs`](./src/verify.mjs).

## Why this exists

Three audit surfaces touch student data when an AI tool is in play:

1. **The SIS / LMS / IEP system** (PowerSchool, Infinite Campus, Frontline, Canvas, etc.) emits a per-table access log for each read of student records — but the log's actor is usually a *service account*, not the *AI tool* the buyer's Decision Card actually authorized.
2. **The AI tool itself** (an AI tutor, an early-warning model, an essay-feedback service) logs which records it ingested — but usually to its own private log shape that the LEA's GRC team can't replay or compare to the SIS log.
3. **The Suite's [audit-stream-py](https://github.com/mizcausevic-dev/audit-stream-py)** carries governance events (Decision Card drafted, policy bundle minted, vault-tokenize event) — but doesn't natively understand CEDS / Ed-Fi semantics.

This repo bridges them. It defines a single event shape that:

- Carries the LEA's read-of-student-record semantics — `subject_student_ref` (tokenized), `resource` (CEDS element + Ed-Fi resource kind + tokenized resource id + `fields_accessed[]`), `action` (FHIR AuditEvent-aligned C/R/U/D/E), `outcome` — so an SIS-aware auditor reads it natively.
- Adds the Suite audit-stream invariants (canonical-JSON SHA-256, `prev_hash`, `decision_card_ref`, signature) so the event appends cleanly to the same hash-chained log every other governance event lands on.
- Names the AI tool by reference to its Agent Card / MCP Tool Card AND the Decision Card that authorized the access — so an auditor can trace *which buyer signature permitted this read*.
- Names the **consent basis** under which the access is authorized — FERPA school-official-exception, FERPA parent consent, FERPA directory-information, FERPA judicial-order, FERPA emergency-exception, COPPA school-as-agent, COPPA direct parental consent.
- Tracks **records-of-disclosure status** under 34 CFR §99.32 — whether the access was logged or carved-out per §99.32(d)(2).

The result: one ledger, SIS-shaped, Suite-shaped, hash-chained, signable.

## Event shape

Every event is a single JSON object conforming to [`schema/student-data-access-event.schema.json`](./schema/student-data-access-event.schema.json). Required fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `event_id` | `string` | UUID v7 or similar monotonic ID |
| `timestamp` | `string` (RFC 3339) | When the access happened |
| `kind` | `string` (enum) | `student.record.read` · `student.record.search` · `student.record.write` · `student.record.export` · `student.record.delete` · `student.record.deletion-requested` |
| `source` | `string` | The system that emitted the event (e.g. `springfield-sis-powerschool`, `vendory-tutorai-3.4`) |
| `subject_student_ref` | `object` | `{ scheme: 'state-student-id-tokenized'\|'nces-locale-id'\|'ceds-person-id'\|'internal-tokenized', value: string }` — RAW student ID MUST NOT appear |
| `resource` | `object` | `{ type, ceds_element_id?, ed_fi_resource_kind?, id_tokenized, fields_accessed[] }` |
| `action` | `string` (enum) | FHIR AuditEvent codes: `C` · `R` · `U` · `D` · `E` |
| `outcome` | `string` (enum) | `0` (success) · `4` (minor failure) · `8` (serious failure) · `12` (major failure) |
| `agent` | `object` | `{ ai_tool_card_url, ai_decision_card_url, principal? }` |
| `consent_basis` | `object` | `{ code, citation, consent_record_uri? }` |
| `decision_card_ref` | `string` (URL) | URL to the Decision Card that authorized this access |
| `records_of_disclosure_status` | `object` | `{ logged_in_99_32: bool, log_entry_uri?, carveout_reason? }` |
| `prev_hash` | `string` (64 hex) | Hash of the previous event in the chain (or 64 zeros for the first event) |
| `hash` | `string` (64 hex) | Canonical-JSON SHA-256 of the event body excluding `hash` itself |

Optional fields documented in the schema: `purpose_of_use` (free-text), `redaction_applied[]` (which fields were tokenized per the Decision Card's vault contract before reaching the AI tool), `network` (hashed source IP + TLS version + hashed UA), `signature` (ed25519).

## What the verifier enforces

[`src/verify.mjs`](./src/verify.mjs) is a small Node verifier (~150 lines) that:

1. Re-derives the canonical-JSON SHA-256 of the body and compares to `hash`.
2. Confirms `prev_hash` is well-formed 64-hex.
3. **Anti-leak invariant 1:** `subject_student_ref.scheme` MUST be a tokenized / hashed scheme (raw state-student-id MUST NOT appear).
4. **Anti-leak invariant 2:** `network.source_ip_hashed` MUST be in tokenized form (raw IPv4-pattern detected → fail).
5. **FERPA §99.32 consistency:**
   - `consent_basis.code = ferpa-school-official` → not logging in §99.32 is fine but requires `carveout_reason` citation.
   - `consent_basis.code` ∈ `{ferpa-parent-consent, ferpa-directory-information, ferpa-judicial-order-or-subpoena, ferpa-emergency-exception}` → `logged_in_99_32` MUST be `true`.
6. **COPPA school-as-agent invariant:** access under `coppa-school-as-agent` MUST carry an `ai_decision_card_url` naming the LEA's authorization.
7. **Decision Card consistency:** `agent.ai_decision_card_url` MUST match top-level `decision_card_ref`.

## Examples

| File | Scenario |
| --- | --- |
| [`examples/tutorai-reads-sis-grade-record.json`](./examples/tutorai-reads-sis-grade-record.json) | VendorY TutorAI v3.4 reads a tokenized SIS grade record for personalized next-problem generation. School-official exception per 34 CFR §99.31(a)(1)(i)(B); §99.32 carveout cited; vault-tokenize redaction applied to student name + state ID. |
| [`examples/early-warning-reads-iep-record.json`](./examples/early-warning-reads-iep-record.json) | VendorZ EarlyWarn 2.1 reads an IEP record's accommodation fields under explicit FERPA parent consent for a pre-IEP-meeting risk review. §99.32 log entry written; parental-consent record URI cited. |

Both pass the verifier:

```bash
$ npm run verify-all
OK:   hash matches recomputed canonical SHA-256
OK:   prev_hash well-formed
OK:   subject_student_ref scheme is tokenized / hashed
OK:   network.source_ip_hashed is in tokenized form
OK:   school-official-exception access NOT logged in §99.32 (carveout) with citation
OK:   agent.ai_decision_card_url matches decision_card_ref

Verification PASSED.
```

## Composes with

| Repo | Role |
| --- | --- |
| [`audit-stream-py`](https://github.com/mizcausevic-dev/audit-stream-py) | The base Python implementation that emits + verifies hash-chained governance events |
| [`pii-student-vault-contract-profile`](https://github.com/mizcausevic-dev/pii-student-vault-contract-profile) | The Decision Cards referenced in `agent.ai_decision_card_url` typically conform to this vault contract profile |
| [`ferpa-readiness-evidence-bundle`](https://github.com/mizcausevic-dev/ferpa-readiness-evidence-bundle) | The `records-of-disclosure` evidence in the FERPA bundle is populated by these audit-stream events |
| [`ai-student-record-incident-card-profile`](https://github.com/mizcausevic-dev/ai-student-record-incident-card-profile) | When an unauthorized read occurs, the Incident Card references the offending audit-stream event |
| [`agent-cards-spec`](https://github.com/mizcausevic-dev/agent-cards-spec) | The `agent.ai_tool_card_url` typically points at an Agent Card |
| [`mcp-tool-card-spec`](https://github.com/mizcausevic-dev/mcp-tool-card-spec) | The `agent.ai_tool_card_url` may alternatively point at an MCP Tool Card |
| [`ai-procurement-decision-spec`](https://github.com/mizcausevic-dev/ai-procurement-decision-spec) | The `decision_card_ref` always points at a Decision Card |
| [`fhir-resource-access-audit`](https://github.com/mizcausevic-dev/fhir-resource-access-audit) | Sibling HealthTech repo — same hash-chain shape, FHIR `AuditEvent` semantics instead of CEDS / Ed-Fi |

## Compliance posture

EdTech-readiness scaffolding for student-data-access audit-trail evidence. The schema and reference verifier support an LEA's program toward FERPA records-of-disclosure obligation (34 CFR §99.32), school-official-exception carveout documentation (§99.32(d)(2)), COPPA consent-basis traceability (16 CFR §312), state student-data-privacy audit-trail obligations (IL SOPPA, CA AB 1584, etc.), and US ED PTAC audit-log guidance — does not by itself establish compliance with any of them. Per the standing public-language guardrail: *readiness · evidence · posture · controls · scaffolding* — never "FERPA-compliant" without an external attestation.

## License

MIT — see [`LICENSE`](./LICENSE). Spec + reference-verifier repos in the Suite are MIT-licensed so adopters can implement freely; full reference implementations are AGPL-3.0.
