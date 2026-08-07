# Universal Scholarship Application Pipeline

The 20-target probe exposed a route-detection problem, not an HTML-form problem. A scholarship
application can be a JavaScript portal, a login-gated workflow, a PDF, an email, a recommendation
process, a nomination, or a form hidden behind several pages. The pipeline therefore treats the
application channel as data and selects an adapter instead of assuming every target is a `<form>`.

## Operating model

Every scholarship follows the same state machine:

`discovered → verified → eligible → prioritized → prepared → needs-review → submitted → confirmed → won/rejected`

The application route is selected separately:

| Channel | Automated work | Human gate |
|---|---|---|
| BigFuture browser | Login-session navigation, requirement extraction, field preparation, essay/attachment staging | Login, attestations, final review, submission |
| Direct browser | Navigate JS pages, detect form/portal, fill supported fields, capture validation errors | Terms/permission, signatures, sensitive fields, final submission |
| Aggregator browser | Prepare profile and application data where permitted | Platform login, bot/ToS boundaries, submission |
| PDF | Download official packet, map fields, produce a completed draft, validate page count | Sign, attach documents, email/mail |
| Email | Prepare recipient, subject, body, attachments, and follow-up date | Send email and handle replies |
| Mail | Produce print-ready packet and checklist | Print, sign, mail, tracking |
| Nomination | Prepare candidate packet and recommendation requests | Nomination, recommendations, institutional approval |
| Portal | Maintain a user-authorized session, checkpoint after each page, save a field ledger | MFA, attestations, signatures, final submission |

## Adapter contract

Each adapter must implement these capabilities independently:

1. `discover` — locate the official source and application entry point.
2. `verify` — capture sponsor, deadline, award terms, eligibility evidence, and current-cycle status.
3. `extract` — record fields, prompts, uploads, signatures, fees, and declarations.
4. `prepare` — select a truthful essay, generate a draft packet, and identify missing evidence.
5. `fill` — populate only fields backed by verified profile facts; report every failed field.
6. `review` — show a field-by-field ledger, evidence links, essay, uploads, and declarations.
7. `submit` — only after the review gate and only when the channel permits automation.
8. `confirm` — save confirmation number, timestamp, screenshot, email, or sent-message record.

No adapter may silently convert “unknown” into “yes.” The universal fallback is a prepared packet plus
a human checklist, not a blind clicker.

## Artifact ledger

Each target should accumulate durable artifacts: source record, requirements snapshot, field ledger,
essay version, resume/transcript references, recommendation status, PDF/email packet, submission proof,
and award notice. This makes a difficult application resumable instead of restarting from the homepage.

## What to build next

1. **BigFuture browser adapter.** Start with the authenticated session. Implement page-by-page
   navigation, requirement capture, field schemas, and checkpointing. Stop before any attestation or
   submit control.
2. **Document adapter.** Support PDF extraction, editable PDF drafts, attachment validation, and
   email/mail packet generation.
3. **Portal adapter.** Support login/MFA pauses, saved checkpoints, DOM snapshots, and recovery after
   a session expires. Do not defeat CAPTCHAs, bot detection, or platform controls.
4. **Profile evidence ledger.** Give every reusable fact a source, date, confidence, and allowed
   wording. Facts without evidence remain review-only.
5. **Application queue.** Replace one-shot screenshots with resumable jobs and artifacts keyed by
   scholarship, application cycle, and channel.
6. **Outcome tracking.** Record confirmation and later sponsor/College Board messages separately;
   the discovery platform cannot guarantee that every sponsor communicates through one inbox.

## Current 20-target interpretation

The existing targets should not be discarded. They should be reclassified: 12 homepage-resolution
cases need browser discovery, 4 need client-side/info-page navigation, 1 needs a logged-in portal,
1 is a broken link, 1 is a fee hard stop, and 1 needs a direct-form/JS investigation. This turns the
probe output into a work queue instead of incorrectly treating every failure as “not automatable.”

