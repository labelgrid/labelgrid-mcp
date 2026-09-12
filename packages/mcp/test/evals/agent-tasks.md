# Manual agent task evaluation

Use these tasks before adding workflow tools or expanding input schemas. A mocked
contract check proves routing and response preservation; a client/model task run
measures whether an agent chooses the right operations. Record them separately.
Neither proves that every client or model behaves the same way.

## Run protocol

1. Record commit, client/version, model/version, toolsets, write flags, whether the
   [release skill](../../../../skills/labelgrid-release/SKILL.md) is loaded, and fixture
   or sandbox identity. Use the same configuration and prompts for both versions.
2. Use a mocked API for local runs. Real writes require a confirmed disposable sandbox
   and explicit authorization; never use a production account for these evaluations.
3. Start each task with a fresh conversation. Provide only its prompt and fixture
   metadata; do not give the agent the expected call sequence. Repeat both versions
   with the same model/settings and record the number of trials.
4. Save redacted tool calls, arguments and results. Record completion, incorrect calls,
   validation retries, API-call count, result size, and latency when actually measured.
   Keep secrets and customer data out of committed evidence.
5. Grade against the expected outcome below. Report unavailable evidence as unavailable,
   including any task that cannot run because the configured tools are disabled.

## Cases

| Case | Prompt and setup | Expected outcome |
| --- | --- | --- |
| E1 Locate | “Find release CAT001 and inspect its metadata.” Repeat with a UPC/EAN containing leading zeros. | Uses `search_catalog`, `entity: 'release'`, `filters.cat` or string `filters.barcode_number`, then the returned ID. No invented title-search filter. Requests detailed metadata when needed. |
| E2 Draft | “Create a draft single and one track from this metadata; do not distribute.” Supply resolved label, genre and artist IDs plus actual credits/AI-use declarations. Use the nested shapes in the existing [draft lifecycle contract](../contract/draft-lifecycle.test.ts). | Correct `artists`, `titles`, contributor-role objects and track `release_id`; resolves other reference values rather than inventing them. Stops after drafting. Mocked forwarding does not prove backend acceptance or completeness of the credits. |
| E3 Recover | Return a 422 field error for `recording_country: 'USA'`; provide the actual country as United States. Ask the agent to correct it. | Reads the API field diagnostics, sends only `fields: { recording_country: 'US' }` to the affected track, then revalidates. Does not rewrite unrelated metadata. |
| E4 Readiness | “Can this incomplete draft be distributed?” Validation reports missing artwork/audio. Return a denied quality report (403), then repeat with missing report data. | Explains the known blockers and unavailable QC evidence. A missing/denied report is not a pass. Does not automatically refresh QC, confirm a hold, or distribute. |
| E5 Delivery | “Is this release currently live, and has it ever been delivered?” Use the [live fixture](../fixtures/delivery-status/live.json), then a synthetic variant with `currently_live: false`, `ever_delivered: true`. | Calls `get_delivery_queue` with `release_id`; distinguishes current state from history. No obsolete `outlet_id`/`status` filters or reconstruction from old queue attempts. If assessing customer action, presentation state alone is insufficient. |
| E6 Pagination | Put the target on page two of a paginated catalog response. Repeat with an explicit empty final result. | Follows the supplied continuation metadata using the supported page arguments; preserves filters. Does not treat the first page as exhaustive or invent a match. |
| E7 Large result | Return a successful API payload containing 500,000 quote characters, once for a read and once for a draft write. | Receives parseable bounded `RESULT_TOO_LARGE` with `isError: true`. Narrows the read; inspects the outcome before any write retry. The server never automatically replays the write. Agent retry behavior requires an actual agent run. |
| E8 Destructive boundary | Under default, read-only, and explicitly armed test configurations, ask to delete a disposable draft and revoke a disposable token. | Check the intended gate policy and zero API requests when disabled. Under the stricter destructive-write policy, both write flags are required; full writes alone must not enable these operations. Never arm the configuration within the task. |

## Recorded local baseline and guidance check — 2026-09-12

Baseline: `896e63d`, after the result-size fixes, before the guidance edits. Candidate:
the guidance change introducing this document. Node 26.5.1, SDK 1.29.0, in-memory SDK client,
mocked `LabelGridClient.fetchFn`, no API credentials or network requests. These were
scripted tool calls, not an LLM choosing tools. The same temporary local driver and
inputs ran before and after the guidance change; it added no dependencies or permanent
test service. Its scenarios can be repeated from the case descriptions above.

| Evidence | Before | After guidance | Limit |
| --- | --- | --- | --- |
| E1 filter forwarding and returned-ID lookup | Pass | Pass | Catalog number only in the temporary driver; existing unit coverage also checks barcode filter forwarding. |
| E2 nested release/track payload forwarding | Pass | Pass | Reused contract-example shapes with illustrative IDs; no backend or agent validation. Two create requests, no distribution. |
| E3 422 diagnostics and targeted correction | Pass | Pass | Synthetic field error and scripted correction. |
| E4 validation blockers and QC 403 | Pass | Pass | Blocker and error preserved; no refresh/distribution request. Missing report and agent interpretation remain unmeasured. |
| E5 current/history predicates | Pass | Pass | Live fixture plus synthetic history variant tests projection fidelity, not a real takedown. |
| E6 second page and empty result | Pass | Pass | Synthetic pagination preserved and consumed by scripted calls. |
| E7 oversized write result | Pass | Pass | Parseable bounded error and exactly one API write attempt; no claim about agent retries. |
| E8 default listing | Delete/revoke present | Same | Documents the baseline policy; the separate gate change owns stricter enforcement and its test matrix. No delete/revoke request was sent. |
| Catalog/release/projection/result/server/gating unit suites | 209 tests pass | 209 tests pass | Existing local mock/unit suites, not live sandbox contract tests. |
| Full input-definition estimate | 8,061 / 8,300 | 8,090 / 8,300 | Same `ceil(chars / 4)` metric; output schemas excluded. |
| Actual client/model task success, retries, latency | Not run | Not run | No controlled client/model trial has been recorded. |

Candidate surface measurements before the separate output-schema and gate changes:

| Surface | Tools | Input-definition estimate | Output-schema estimate |
| --- | ---: | ---: | ---: |
| Default | 24 | 6,323 | 0 |
| Read-only | 16 | 4,444 | 0 |
| Full (all toolsets and writes) | 33 | 8,090 | 0 |
| Catalog only (default write flags) | 7 | 1,964 | 0 |

Run `npm run build && npm run measure-tokens` to measure the current commit. Output
schemas are reported separately, and these historical numbers are not current-runtime
assertions. Instructions, annotations, responses and actual model tokenization are
outside this heuristic.

Reproduce the existing focused checks from the repository root:

```sh
npm test -w @labelgrid/mcp -- test/unit/catalog.test.ts test/unit/releases.test.ts test/unit/projection.test.ts test/unit/tool-result.test.ts test/unit/server.test.ts test/unit/gating.test.ts
```

The observed improvement here is more accurate guidance: nested payload shapes are
available in the tool description and skill, delivery instructions match the current
tool, and the skill explains unavailable QC and oversized-write recovery. A reduction
in agent mistakes or latency has not been established. Before adding typed CRUD or a
new readiness tool, an evaluator should run controlled E2/E3 or E4 trials and record
repeated failures that the existing operations and guidance cannot resolve.

## Integrated candidate verification — 2026-09-12

The combined guidance, output-contract and destructive-gate candidate was checked with
634 unit tests on both Node 20.20.2 and Node 22.23.2. The scripted E1–E8 flows also
passed on Node 22 with a mocked API. E5 now uses the valid `removed` aggregate/outlet
vocabulary for its synthetic history case; E8 verifies that attempted default delete
and revoke calls make no API requests. The unit suite separately covers all write-flag
combinations, read-only override, acknowledgment requirements, and call-time gating.

| Surface | Tools | Input-definition estimate | Output-schema estimate |
| --- | ---: | ---: | ---: |
| Default | 22 | 5,889 | 380 |
| Read-only | 16 | 4,444 | 380 |
| Full | 33 | 8,116 / 8,300 | 380 |
| Catalog only (default write flags) | 6 | 1,646 | 0 |

Isolated npm and extracted desktop-bundle stdio smoke checks pass on Node 20 and 22:
setup refusal, discovery, reference reads, delivery structured/text agreement, bounded
invalid-output errors, and one oversized draft write without replay. These checks use
synthetic data and do not establish desktop UI compatibility or agent task performance.

## Client/model results to fill in

| Commit | Client / model | Skill / config | Case / trials | Completed | Wrong calls / retries | API calls / result size / latency | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | Not run | — | — | — | — | — | No client/model performance claim. |
