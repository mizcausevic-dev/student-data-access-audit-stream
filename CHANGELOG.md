# Changelog

All notable changes to the Student Data Access Audit Stream.

## [0.1] — 2026-05-29

### Added

- Initial schema (`schema/student-data-access-event.schema.json`) with hash-chained record shape, tokenized subject_student_ref + tokenized resource id, CEDS + Ed-Fi resource type enum, FHIR-aligned action codes, FERPA + COPPA consent-basis enum, records-of-disclosure-status sub-object.
- Reference verifier (`src/verify.mjs`) — re-derives canonical-JSON SHA-256; enforces tokenization anti-leak invariants; enforces FERPA §99.32 logging consistency (school-official-exception carveout requires citation, non-school-official exceptions MUST be logged); enforces COPPA school-as-agent decision-card-ref requirement; enforces Decision Card reference consistency between agent and top-level.
- Hash builder (`src/build-examples.mjs`).
- Two worked examples:
  - `tutorai-reads-sis-grade-record.json` — VendorY TutorAI v3.4 reads tokenized SIS grade record under school-official exception; §99.32 carveout cited.
  - `early-warning-reads-iep-record.json` — VendorZ EarlyWarn 2.1 reads IEP accommodation fields under FERPA parent consent; §99.32 log entry written.
- Cross-spec linkage in `agent`, `decision_card_ref`, `consent_basis.consent_record_uri`.
- Standing public-language guardrail respected in README + the schema's `language_guardrail`-style design.

### Not yet

- AJV-based JSON Schema validation in the verifier (currently structural rules only).
- CEDS Element ID enum + Ed-Fi resource kind enum — currently free-text; enumeration delegated to consumer (Phase 2).
- IDEA / Section 504 consent-basis sub-enum (Phase 2).
- Worked example for a `student.record.deletion-requested` event (Phase 2).
