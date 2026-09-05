# Conformance 2026-07-28 : serveur nu contre serveur instrumente

Genere par `scripts/conformance.sh`. Suite : `@modelcontextprotocol/conformance@0.2.0-alpha.11`, `--requirements 2026-07-28`.

Scenarios : 50. Identiques : 50. Divergents : 0.

| Scenario | Nu | Instrumente | Identique |
| --- | --- | --- | --- |
| caching | PASS (8 ok, 0 ko) | PASS (8 ok, 0 ko) | oui |
| completion-complete | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| dns-rebinding-protection | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| http-custom-header-server-validation | FAIL (1 ok, 5 ko) | FAIL (1 ok, 5 ko) | oui |
| http-header-validation | PASS (14 ok, 0 ko) | PASS (14 ok, 0 ko) | oui |
| input-required-result-basic-elicitation | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |
| input-required-result-basic-list-roots | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |
| input-required-result-basic-sampling | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |
| input-required-result-capability-check | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| input-required-result-ignore-extra-params | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| input-required-result-missing-input-response | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| input-required-result-multi-round | PASS (4 ok, 0 ko) | PASS (4 ok, 0 ko) | oui |
| input-required-result-multiple-input-requests | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |
| input-required-result-non-tool-request | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |
| input-required-result-request-state | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |
| input-required-result-result-type | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| input-required-result-tampered-state | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| input-required-result-unsupported-methods | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| input-required-result-validate-input | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |
| json-schema-2020-12 | FAIL (1 ok, 1 ko) | FAIL (1 ok, 1 ko) | oui |
| prompts-get-embedded-resource | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| prompts-get-simple | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| prompts-get-with-args | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| prompts-get-with-image | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| prompts-list | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| resources-list | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| resources-read-binary | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| resources-read-text | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| resources-templates-read | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| sep-2164-resource-not-found | PASS (4 ok, 0 ko) | PASS (4 ok, 0 ko) | oui |
| server-sse-multiple-streams | PASS (1 ok, 0 ko) | PASS (1 ok, 0 ko) | oui |
| server-stateless | PASS (28 ok, 0 ko) | PASS (28 ok, 0 ko) | oui |
| tasks-capability-negotiation | FAIL (1 ok, 4 ko) | FAIL (1 ok, 4 ko) | oui |
| tasks-dispatch-and-envelope | FAIL (3 ok, 6 ko) | FAIL (3 ok, 6 ko) | oui |
| tasks-lifecycle | FAIL (1 ok, 8 ko) | FAIL (1 ok, 8 ko) | oui |
| tasks-mrtr-composition | FAIL (1 ok, 1 ko) | FAIL (1 ok, 1 ko) | oui |
| tasks-mrtr-input | FAIL (1 ok, 3 ko) | FAIL (1 ok, 3 ko) | oui |
| tasks-request-headers | FAIL (2 ok, 3 ko) | FAIL (2 ok, 3 ko) | oui |
| tasks-request-state-removal | FAIL (1 ok, 1 ko) | FAIL (1 ok, 1 ko) | oui |
| tasks-required-task-error | FAIL (1 ok, 1 ko) | FAIL (1 ok, 1 ko) | oui |
| tasks-status-notifications | PASS (0 ok, 0 ko) | PASS (0 ok, 0 ko) | oui |
| tasks-wire-fields | FAIL (1 ok, 3 ko) | FAIL (1 ok, 3 ko) | oui |
| tools-call-audio | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| tools-call-embedded-resource | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| tools-call-error | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| tools-call-image | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| tools-call-mixed-content | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| tools-call-simple-text | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| tools-call-with-progress | PASS (2 ok, 0 ko) | PASS (2 ok, 0 ko) | oui |
| tools-list | PASS (3 ok, 0 ko) | PASS (3 ok, 0 ko) | oui |

## Checks en echec des deux cotes

Trous du serveur d exemple, pas de l instrumentation : le meme check echoue a l identique sur les deux runs.

| Scenario | Check | Raison |
| --- | --- | --- |
| http-custom-header-server-validation | sep-2243-server-no-xmcp-tool | Not testable: server exposes no tool with x-mcp-header annotations, so none of the custom-header validation requirements could be exercised |
| http-custom-header-server-validation | sep-2243-server-decode-base64 | Not testable: server exposes no tool with x-mcp-header annotations |
| http-custom-header-server-validation | sep-2243-server-validate-param-match | Not testable: server exposes no tool with x-mcp-header annotations |
| http-custom-header-server-validation | sep-2243-server-reject-invalid-param-chars | Not testable: server exposes no tool with x-mcp-header annotations |
| http-custom-header-server-validation | sep-2243-server-reject-param-mismatch | Not testable: server exposes no tool with x-mcp-header annotations |
| json-schema-2020-12 | json-schema-2020-12-tool-found | Tool 'json_schema_2020_12_tool' not found. Available tools: test_simple_text, test_image_content, test_audio_content, test_embedded_resource, test_multiple_content_types, test_tool_with_logging, test_logging_tool, test_t |
| tasks-capability-negotiation | tasks-extension-advertised | capabilities.extensions MUST be advertised |
| tasks-capability-negotiation | sep-2663-tasks-methods-non-declaring | tasks/get MUST return -32021; got -32601; tasks/update MUST return -32021; got -32601; tasks/cancel MUST return -32021; got -32601 |
| tasks-capability-negotiation | sep-2663-server-rejects-undeclared-client | Tool slow_compute not found |
| tasks-capability-negotiation | tasks-per-request-meta-opt-in | Tool slow_compute not found |
| tasks-dispatch-and-envelope | tasks-server-directed-creation-no-hint | Tool failing_job not found |
| tasks-dispatch-and-envelope | sep-2663-legacy-task-param-ignored | Tool greet not found |
| tasks-dispatch-and-envelope | tasks-immediate-result-shortcut | Tool slow_compute not found |
| tasks-dispatch-and-envelope | tasks-result-type-complete-on-non-task-responses | Tool greet not found |
| tasks-dispatch-and-envelope | sep-2663-durable-create-strong-consistency | Tool slow_compute not found |
| tasks-dispatch-and-envelope | sep-2663-tasks-get-invalid-task-id-32602 | expected -32602; got -32601 (if the server is otherwise compliant, verify it does not validate other dimensions - routing headers, _meta, params shape - before method dispatch) |
| tasks-lifecycle | tasks-sync-tool-call | Tool greet not found |
| tasks-lifecycle | sep-2663-result-type-task-on-create | Tool slow_compute not found |
| tasks-lifecycle | sep-2663-tasks-get-status-working | Not testable: no task was created by the preceding step, so this check could not be exercised |
| tasks-lifecycle | sep-2663-tasks-get-status-completed | Not testable: no task was created by the preceding step, so this check could not be exercised |
| tasks-lifecycle | sep-2663-tool-error-uses-completed-status | Tool failing_job not found |
| tasks-lifecycle | sep-2663-tasks-get-status-failed | Tool protocol_error_job not found |
| tasks-lifecycle | sep-2663-cancel-ack-empty-result | Tool slow_compute not found |
| tasks-lifecycle | tasks-cancel-terminal-idempotent-ack | Tool slow_compute not found |
| tasks-mrtr-composition | sep-2663-mrtr-synchronous-before-task-creation | Tool test_tool_with_task not found |
| tasks-mrtr-input | sep-2663-tasks-get-status-input-required | Tool confirm_delete not found |
| tasks-mrtr-input | tasks-mrtr-tasks-update-resumes | Tool confirm_delete not found |
| tasks-mrtr-input | tasks-mrtr-partial-fulfillment | Tool multi_input not found |
| tasks-request-headers | tasks-headers-tolerate-mcp-method-on-tools-call | Tool greet not found |
| tasks-request-headers | sep-2663-routing-headers-accepted-on-tasks-get | Tool slow_compute not found |
| tasks-request-headers | sep-2663-server-rejects-mismatched-mcp-name-on-tasks-get | routing-task fixture from Check 2 unavailable; cannot drive negative-path probe |
| tasks-request-state-removal | tasks-request-state-removal-setup | Tool slow_compute not found |
| tasks-required-task-error | sep-2663-server-returns-missing-capability-when-required | tools/call for failing_job returned error code -32602; spec requires -32021. |
| tasks-wire-fields | tasks-wire-field-renames | Tool slow_compute not found |
| tasks-wire-fields | tasks-no-early-ttl-expiry | Not testable: no task was created by the preceding step, so this check could not be exercised |
| tasks-wire-fields | tasks-no-related-task-meta-on-inlined-result | Tool slow_compute not found |

## Checks en echec du seul cote instrumente

Aucun. L instrumentation ne casse aucun scenario.
