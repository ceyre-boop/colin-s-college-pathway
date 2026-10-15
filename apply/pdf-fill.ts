// PDF application draft-fill — Phase 5 of the gap-close plan, scoped down from the full
// document/portal adapter vision in ApplicationPipeline.md to what's tractable as one increment:
// AcroForm PDFs only. Email/mail packet generation stays out of scope for this pass.
//
// Reuses apply/field-map.ts's mapField() for the actual label→value decision — same hard-block
// list (SSN/password/payment never filled), same decline-to-state rules, same "no value on file"
// honesty. This file's only job is the PDF-specific plumbing: read an AcroForm's field names,
// treat each as a label, fill what mapField() says to fill, and leave everything else for a
// human — same philosophy as apply/fill.ts's web-form path, never a blind submit.
//
// No signature/attachment handling. No submission. The draft is a review artifact, gated by the
// PDF_DRAFT_REVIEW checkpoint (state/checkpoints.js) — same SUBMIT_APPROVAL-style human gate as
// every other channel in this pipeline.

import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown } from "pdf-lib";
import { mapField } from "./field-map";
import type { Applicant } from "./types";

export interface PdfFillResult {
  outPath: string;
  filled: { field: string; path: string }[];
  declined: { field: string; reason: string }[];
  blocked: { field: string; reason: string }[];
  unmapped: string[];
}

/**
 * Fill an AcroForm PDF's text/checkbox/dropdown fields from the Applicant profile via the same
 * mapField() rules the web-form filler uses. Writes a draft PDF to outPath and returns a ledger
 * of what happened to every field — nothing is filled silently, nothing is guessed.
 */
export async function fillPdf(pdfBytes: Uint8Array, applicant: Applicant, outPath: string): Promise<PdfFillResult> {
  const doc = await PDFDocument.load(pdfBytes);
  const form = doc.getForm();
  const fields = form.getFields();

  const result: PdfFillResult = { outPath, filled: [], declined: [], blocked: [], unmapped: [] };

  for (const field of fields) {
    const label = field.getName();
    const m = mapField(label, applicant);

    if (m.kind === "block") {
      result.blocked.push({ field: label, reason: m.reason });
      continue;
    }
    if (m.kind === "decline") {
      result.declined.push({ field: label, reason: m.reason });
      continue;
    }
    if (m.kind === "unmapped") {
      result.unmapped.push(label);
      continue;
    }

    // m.kind === "fill" — write the value using whatever widget type the PDF actually has.
    // Checkboxes/dropdowns can't take an arbitrary string; a mismatch between the label's
    // apparent meaning and its actual widget type is reported as unmapped, not forced.
    try {
      if (field instanceof PDFTextField) {
        field.setText(m.value);
        result.filled.push({ field: label, path: m.path });
      } else if (field instanceof PDFCheckBox) {
        if (/^(yes|true|y|1)$/i.test(m.value)) field.check();
        else field.uncheck();
        result.filled.push({ field: label, path: m.path });
      } else if (field instanceof PDFDropdown) {
        const options = field.getOptions();
        if (options.includes(m.value)) {
          field.select(m.value);
          result.filled.push({ field: label, path: m.path });
        } else {
          result.unmapped.push(`${label} (dropdown has no option matching "${m.value}")`);
        }
      } else {
        result.unmapped.push(`${label} (unsupported widget type)`);
      }
    } catch (err) {
      result.unmapped.push(`${label} (write failed: ${err instanceof Error ? err.message : err})`);
    }
  }

  const outBytes = await doc.save();
  await Bun.write(outPath, outBytes);
  return result;
}

/** True if the PDF has at least one AcroForm field — a PDF with none can't be draft-filled and
 * falls straight to the human path (print/sign, same as before this adapter existed). */
export async function pdfHasFillableFields(pdfBytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(pdfBytes);
    return doc.getForm().getFields().length > 0;
  } catch {
    return false;
  }
}

/** Field names only — used to compute a broker grant (see identity/broker.ts's grantForLabels)
 * before any value is read from the vault, same order-of-operations as the web-form path. */
export async function pdfFieldNames(pdfBytes: Uint8Array): Promise<string[]> {
  try {
    const doc = await PDFDocument.load(pdfBytes);
    return doc.getForm().getFields().map((f) => f.getName());
  } catch {
    return [];
  }
}
