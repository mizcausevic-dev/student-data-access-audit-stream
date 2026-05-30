#!/usr/bin/env node
// verify.mjs — validate a student-data-access event against schema invariants
// and re-derive canonical-JSON SHA-256 to confirm hash consistency.
//
// Usage:
//   node src/verify.mjs examples/tutorai-reads-sis-grade-record.json
//
// Exits 0 on success, 1 on validation failure.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

function fail(msg) { console.error("FAIL:", msg); process.exitCode = 1; }
function ok(msg)   { console.log("OK:  ", msg); }

const path = process.argv[2];
if (!path) {
  console.error("usage: node src/verify.mjs <event.json>");
  process.exit(2);
}

const raw = readFileSync(path, "utf8");
let event;
try { event = JSON.parse(raw); } catch (e) { fail(`JSON parse error: ${e.message}`); process.exit(1); }

// --- hash check
const { hash, ...bodyWithoutHash } = event;
const recomputed = sha256Hex(canonicalJson(bodyWithoutHash));
if (recomputed === hash) {
  ok(`hash matches recomputed canonical SHA-256 (${hash.slice(0, 12)}…)`);
} else {
  fail(`hash mismatch: record claims ${hash}, recomputed ${recomputed} (expected for hand-authored fixtures; use src/build-examples.mjs to recompute)`);
}

// --- prev_hash format
if (!/^[0-9a-f]{64}$/.test(event.prev_hash)) {
  fail(`prev_hash is not 64 hex chars: ${event.prev_hash}`);
} else {
  ok(`prev_hash well-formed (${event.prev_hash === "0".repeat(64) ? "genesis" : "linked"})`);
}

// --- PII anti-leak invariants
if (event.subject_student_ref?.scheme && /raw/i.test(event.subject_student_ref.scheme)) {
  fail("subject_student_ref.scheme appears to be a raw-identifier scheme — raw state-student-id MUST NOT appear in the event");
} else {
  ok("subject_student_ref scheme is tokenized / hashed");
}

if (event.network?.source_ip_hashed && !/^h[0-9]+:/.test(event.network.source_ip_hashed) && /\./.test(event.network.source_ip_hashed)) {
  fail(`network.source_ip_hashed looks like a raw IP address: ${event.network.source_ip_hashed}`);
} else if (event.network?.source_ip_hashed) {
  ok(`network.source_ip_hashed is in tokenized form`);
}

// --- FERPA school-official-exception carveout consistency
const consent = event.consent_basis?.code;
const logged = event.records_of_disclosure_status?.logged_in_99_32;
if (consent === "ferpa-school-official") {
  if (logged === true) {
    ok("school-official-exception access is unusually logged in §99.32 (allowed but not required per §99.32(d)(2))");
  } else if (logged === false && !event.records_of_disclosure_status?.carveout_reason) {
    fail("school-official-exception access not logged but no carveout_reason citation");
  } else {
    ok(`school-official-exception access NOT logged in §99.32 (carveout per §99.32(d)(2)) with citation`);
  }
}

// --- Parent-consent or other non-school-official requires logging
const NON_SO_EXCEPTIONS = new Set(["ferpa-parent-consent", "ferpa-directory-information", "ferpa-judicial-order-or-subpoena", "ferpa-emergency-exception"]);
if (NON_SO_EXCEPTIONS.has(consent) && logged !== true) {
  fail(`Access under '${consent}' MUST be logged_in_99_32 = true per 34 CFR §99.32`);
} else if (NON_SO_EXCEPTIONS.has(consent)) {
  ok(`Access under '${consent}' is logged in §99.32`);
}

// --- COPPA carveout MUST cite school-as-agent OR direct-parental-consent
if (consent === "coppa-school-as-agent" && !event.agent?.ai_decision_card_url) {
  fail("coppa-school-as-agent access requires an ai_decision_card_url naming the LEA's authorization");
}

// --- Decision Card ref consistency between agent + top-level
if (event.agent?.ai_decision_card_url !== event.decision_card_ref) {
  fail(`agent.ai_decision_card_url (${event.agent?.ai_decision_card_url}) does not match decision_card_ref (${event.decision_card_ref})`);
} else {
  ok("agent.ai_decision_card_url matches decision_card_ref");
}

if (process.exitCode === 1) {
  console.error("\nVerification FAILED.");
} else {
  console.log("\nVerification PASSED.");
}
