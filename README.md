# PII Redaction Tool — Node.js

## Overview

This solution processes the supplied Red Herring Prospectus DOCX and replaces personally identifiable information with deterministic fake alternatives. The implementation is written in JavaScript/Node.js and does not require third-party npm packages.

The assignment requires detection of:
- Full names
- Email addresses
- Phone numbers
- Company names
- Physical/mailing addresses
- Social Security Numbers (SSNs)
- Credit card numbers
- Dates of birth
- IP addresses

## Approach

The solution uses a **hybrid regex + contextual detection** strategy.

1. **Regex detectors** identify structured PII such as emails, phone numbers, SSNs, credit cards, dates of birth and IPv4 addresses.
2. **Luhn validation** is applied to credit-card candidates to reduce false positives from ordinary financial numbers.
3. **Contextual rules** detect names when they appear after labels such as `Contact Person`, `Name`, `being`, or `namely`, and before/after common executive roles.
4. **Company detection** uses legal-entity suffixes such as `Limited`, `Private Limited`, `LLP`, `Inc.` and `Corporation`.
5. **Address detection** is conservative and looks for address-like text together with an Indian-style PIN code and location/address terms.
6. A small first-name/last-name lexicon is used as a model-free fallback for likely person names.
7. Each original PII value receives a stable fake replacement, so repeated occurrences of the same value map to the same fake value.

## DOCX handling

A DOCX file is a ZIP archive containing WordprocessingML XML. The script extracts the archive, processes Word text nodes in paragraphs/tables/headers/footers, and rebuilds the DOCX. It uses the operating system's `unzip`/`zip` commands on Linux/macOS and PowerShell `Expand-Archive`/`Compress-Archive` on Windows.

No npm package is required.

## Run

```bash
node redact_pii.js "Red Herring Prospectus.docx" "redacted_output.docx"
```

Optional deterministic seed:

```bash
node redact_pii.js "Red Herring Prospectus.docx" "redacted_output.docx" 2025
```

On Windows PowerShell:

```powershell
node .\redact_pii.js ".\Red Herring Prospectus.docx" ".\redacted_output.docx"
```

## Evaluation

The evaluation benchmark contains 128 labelled examples and 108 gold PII spans, covering all nine required PII categories. Matching is performed at the entity-span level: a predicted span is a true positive when its type matches a gold span and the spans overlap. Unmatched predictions are false positives and unmatched gold spans are false negatives.

Run:

```bash
node evaluate.js eval_benchmark.json
```

Evaluation run used for this submission:

- Gold spans: **108**
- Predicted spans: **111**
- True positives: **108**
- False positives: **3**
- False negatives: **0**
- Precision: **97.30%**
- Recall: **100.00%**
- Span-level extraction accuracy: **97.30%**

The per-category results are documented in `evaluation_report.docx`.

## Tradeoffs / limitations

A regex/contextual system is lightweight and easy to extend, but it is not a full natural-language NER system. It can miss unusual names or addresses that do not follow expected patterns, and title-cased words can sometimes look like names. The benchmark evaluation demonstrates the behaviour on the labelled test cases, while the production document is treated as an additional real-document run.

The solution intentionally does **not** redact generic order/ticket/reference numbers unless they match one of the requested PII patterns. This avoids turning ordinary business identifiers into false positives.

## Extending the solution

To add a new PII type:

1. Add the label to `TYPES`.
2. Add a detector regex/context rule inside `PIIRedactor.detect()`.
3. Add a fake replacement pool to `FAKE`.
4. Add representative examples to `eval_benchmark.json`.
5. Re-run `node evaluate.js eval_benchmark.json`.

## Files

- `redact_pii.js` — main redaction implementation
- `evaluate.js` — evaluation implementation
- `eval_benchmark.json` — labelled evaluation set
- `eval_results_js.json` — results from the recorded run
- `redacted_output.docx` — redacted prospectus
- `evaluation_report.docx` — evaluation report
- `package.json` — Node.js project metadata
