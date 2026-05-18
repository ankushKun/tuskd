import {
  BarChart3,
  Check,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileVideo,
  GripVertical,
  Image,
  Link as LinkIcon,
  Lock,
  MessageSquareText,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Star,
  Table2,
  Trash2,
  Wallet,
  AlertCircle,
  ArrowUp,
  Triangle,
  Copy,
  X,
  Search,
  Moon,
  Sun,
  LayoutTemplate,
  LayoutList,
  Columns3,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Upload,
  Filter,
  Calendar,
  Clock,
  FileText,
  Inbox,
  TrendingUp,
  Eye,
  Github,
  MoreHorizontal,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState, createContext, useContext, useRef, useId } from "react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "framer-motion";
import { useCurrentAccount, useCurrentWallet, useDisconnectWallet, useSignAndExecuteTransaction, useSuiClient, ConnectModal } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_TESTNET_CHAIN } from "@mysten/wallet-standard";
import { Sheet } from "./components/Sheet";
import { AddFieldModal } from "./components/AddFieldModal";
import { DropdownPortal } from "./components/DropdownPortal";
import type { BlobReceipt, Field, FieldType, FormSchema, StoredForm, Submission } from "./types";
import { TESTNET_CONFIG, testnetTxUrl } from "./config";
import {
  createDraftForm,
  createDefaultSchema,
  createWalrusSessionSampleSchema,
  deleteForm,
  getForm,
  getForms,
  getSubmissions,
  id,
  normalizeAdminAddresses,
  publishStoredForm,
  readJsonBlob,
  saveDraftForm,
  saveForm,
  saveSubmission,
  updateSubmission,
  uploadFile,
  uploadJson,
  WALRUS_SESSION_SAMPLE_ADMIN,
  walrusJsonReceipt,
} from "./storage";

const fieldTypes: Array<{ type: FieldType; label: string; icon: typeof MessageSquareText }> = [
  { type: "shortText", label: "Short text", icon: MessageSquareText },
  { type: "richText", label: "Rich text", icon: MessageSquareText },
  { type: "dropdown", label: "Dropdown", icon: Settings2 },
  { type: "checkboxes", label: "Checkboxes", icon: Check },
  { type: "rating", label: "Star rating", icon: Star },
  { type: "image", label: "Screenshot", icon: Image },
  { type: "video", label: "Video upload", icon: FileVideo },
  { type: "url", label: "URL", icon: LinkIcon },
];

type SchemaIssue = {
  fieldId?: string;
  message: string;
};

function createField(type: FieldType): Field {
  return {
    id: id("field"),
    type,
    label: fieldTypes.find((item) => item.type === type)?.label ?? "Question",
    required: false,
    helper: "",
    options: type === "dropdown" || type === "checkboxes" ? ["Option A", "Option B"] : undefined,
  };
}

function fieldHint(type: FieldType) {
  const hints: Record<FieldType, string> = {
    shortText: "Best for names, titles, and one-line answers.",
    richText: "Best for bug details, longer feedback, and application notes.",
    dropdown: "Use for a single choice. Add at least one option before publishing.",
    checkboxes: "Use for multiple choices. Add at least one option before publishing.",
    rating: "Collects a one-to-five star score.",
    image: "Accepts screenshots or image attachments.",
    video: "Accepts short videos or screen recordings.",
    url: "Accepts only full http or https links.",
  };
  return hints[type];
}

function validateSchema(schema: FormSchema): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!schema.title.trim()) issues.push({ message: "Form title is required." });
  if (!schema.fields.length) issues.push({ message: "Add at least one field." });

  for (const field of schema.fields) {
    if (!field.label.trim()) {
      issues.push({ fieldId: field.id, message: "Field label is required." });
    }
    if (field.type === "dropdown" || field.type === "checkboxes") {
      const options = normalizeOptions(field.options ?? []);
      if (!options.length) {
        issues.push({ fieldId: field.id, message: `${field.label || "Choice field"} needs at least one option.` });
      }
      if (options.length !== new Set(options.map((option) => option.toLowerCase())).size) {
        issues.push({ fieldId: field.id, message: `${field.label || "Choice field"} has duplicate options.` });
      }
    }
  }

  return issues;
}

function normalizeOptions(options: string[]) {
  return options.map((option) => option.trim()).filter(Boolean);
}

function schemaFingerprint(schema: FormSchema) {
  return JSON.stringify({
    title: schema.title,
    description: schema.description,
    layout: schema.layout,
    admins: normalizeAdminAddresses(schema.admins),
    fields: schema.fields.map(({ id: fieldId, ...field }) => ({ id: fieldId, ...field })),
  });
}

function contractTarget(functionName: "create_form" | "update_form" | "submit" | "set_submission_status") {
  if (!TESTNET_CONFIG.tuskdPackageId) {
    throw new Error("Set VITE_TUSKD_PACKAGE_ID to your published Sui Testnet package ID.");
  }
  return `${TESTNET_CONFIG.tuskdPackageId}::forms::${functionName}`;
}

function contractTypeTarget(name: "Form" | "SubmissionEvent" | "StatusEvent" | "FormAccessEvent") {
  const packageId = TESTNET_CONFIG.tuskdTypePackageId || TESTNET_CONFIG.tuskdPackageId;
  if (!packageId) {
    throw new Error("Set VITE_TUSKD_PACKAGE_ID to your published Sui Testnet package ID.");
  }
  return `${packageId}::forms::${name}`;
}

function contractImplementationTypeTarget(name: "FormAccessEvent") {
  if (!TESTNET_CONFIG.tuskdPackageId) {
    throw new Error("Set VITE_TUSKD_PACKAGE_ID to your published Sui Testnet package ID.");
  }
  return `${TESTNET_CONFIG.tuskdPackageId}::forms::${name}`;
}

function findCreatedFormObjectId(tx: unknown) {
  const changes = (tx as { objectChanges?: Array<{ type?: string; objectType?: string; objectId?: string }> }).objectChanges ?? [];
  const formType = contractTypeTarget("Form").toLowerCase();
  return changes.find((change) => change.type === "created" && change.objectType?.toLowerCase() === formType)?.objectId ?? "";
}

function findSubmissionEventId(tx: unknown) {
  const events = (tx as { events?: Array<{ type?: string; parsedJson?: { submission_id?: string | number } }> }).events ?? [];
  const eventType = contractTypeTarget("SubmissionEvent").toLowerCase();
  const event = events.find((item) => item.type?.toLowerCase() === eventType);
  const value = event?.parsedJson?.submission_id;
  return value === undefined ? "" : String(value);
}

function publicFormId(form: StoredForm) {
  return form.suiObjectId || form.id;
}

function publicFormPath(form: StoredForm) {
  return `/f/${publicFormId(form)}`;
}

function isLocalFormId(value: string) {
  return value.startsWith("form_");
}

function asMoveString(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const fields = (value as { fields?: Record<string, unknown> }).fields;
  if (!fields) return "";
  return asMoveString(fields.contents ?? fields.bytes ?? fields.value);
}

function asMoveAddressList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return normalizeAdminAddresses(value.map((item) => asMoveString(item) || String(item)));
  if (typeof value === "object") {
    const fields = (value as { fields?: Record<string, unknown>; contents?: unknown }).fields;
    if (fields) return asMoveAddressList(fields.contents ?? fields.value ?? fields.bytes);
    if ("contents" in value) return asMoveAddressList((value as { contents?: unknown }).contents);
  }
  return [];
}

function schemaAdmins(schema?: FormSchema) {
  return normalizeAdminAddresses(schema?.admins);
}

function formAdmins(form?: StoredForm | null) {
  return normalizeAdminAddresses([...(form?.admins ?? []), ...schemaAdmins(form?.schema), ...schemaAdmins(form?.draftSchema)]);
}

function canAdministerForm(form: StoredForm, address: string | undefined) {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return form.owner.toLowerCase() === normalized || formAdmins(form).includes(normalized);
}

function parseAdminInput(value: string) {
  return normalizeAdminAddresses(value.split(/[\s,]+/));
}

function formIsVisibleToAccount(form: StoredForm, address: string | undefined) {
  if (!address) return false;
  return canAdministerForm(form, address);
}

function getFormsForAccount(address: string | undefined) {
  return getForms().filter((form) => formIsVisibleToAccount(form, address));
}

function extractSuiObjectId(value: string) {
  return value.match(/0x[0-9a-fA-F]{64}/)?.[0].toLowerCase() ?? "";
}

async function fetchPublishedFormFromSui(formObjectId: string, suiClient: ReturnType<typeof useSuiClient>): Promise<StoredForm> {
  const response = await suiClient.getObject({
    id: formObjectId,
    options: { showContent: true },
  });
  const content = response.data?.content;
  if (!content || content.dataType !== "moveObject") {
    throw new Error("No published TuskD form object was found for this link.");
  }
  if (!content.type.endsWith("::forms::Form")) {
    throw new Error("This Sui object is not a TuskD form.");
  }

  const fields = content.fields as Record<string, unknown>;
  const schemaBlobId = asMoveString(fields.schema_blob_id);
  if (!schemaBlobId) {
    throw new Error("The form object does not include a Walrus schema blob.");
  }

  const schemaBlob = walrusJsonReceipt(schemaBlobId);
  const schema = await readJsonBlob<FormSchema>(schemaBlob);
  const admins = asMoveAddressList(fields.admins);
  const now = new Date().toISOString();
  return {
    id: formObjectId,
    owner: asMoveString(fields.owner) || "",
    admins,
    network: "sui-testnet",
    status: "published",
    draftSchema: { ...schema, admins: schemaAdmins(schema).length ? schemaAdmins(schema) : admins },
    schema: { ...schema, admins: schemaAdmins(schema).length ? schemaAdmins(schema) : admins },
    schemaBlob,
    suiObjectId: formObjectId,
    createdAt: schema.createdAt || now,
    updatedAt: now,
    publishedAt: schema.createdAt || now,
  };
}

async function isCurrentPackageFormObject(formObjectId: string, suiClient: ReturnType<typeof useSuiClient>) {
  const response = await suiClient.getObject({
    id: formObjectId,
    options: { showContent: true },
  });
  const content = response.data?.content;
  return Boolean(
    content &&
      content.dataType === "moveObject" &&
      content.type.toLowerCase() === contractTypeTarget("Form").toLowerCase(),
  );
}

function findCreatedFormObjectIds(tx: unknown) {
  const changes = (tx as { objectChanges?: Array<{ type?: string; objectType?: string; objectId?: string }> }).objectChanges ?? [];
  const formType = contractTypeTarget("Form").toLowerCase();
  return changes
    .filter((change) => change.type === "created" && change.objectType?.toLowerCase() === formType && change.objectId)
    .map((change) => change.objectId as string);
}

async function fetchCreatedFormsForOwner(owner: string, suiClient: ReturnType<typeof useSuiClient>) {
  if (!TESTNET_CONFIG.tuskdPackageId) return [];
  const forms: StoredForm[] = [];
  let cursor: string | null | undefined;
  const seen = new Set<string>();

  for (let page = 0; page < 4; page += 1) {
    const response = await suiClient.queryTransactionBlocks({
      filter: { FromAddress: owner },
      options: { showObjectChanges: true },
      cursor,
      limit: 50,
      order: "descending",
    });

    for (const tx of response.data) {
      const digest = tx.digest;
      for (const objectId of findCreatedFormObjectIds(tx)) {
        if (seen.has(objectId)) continue;
        seen.add(objectId);
        try {
          const form = await fetchPublishedFormFromSui(objectId, suiClient);
          if (form.owner.toLowerCase() === owner.toLowerCase()) {
            forms.push({ ...form, txDigest: digest });
          }
        } catch {
          // Ignore stale/deleted objects or blobs that cannot be read.
        }
      }
    }

    if (!response.hasNextPage || !response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return forms;
}

async function fetchIndexedFormsForAccount(address: string, suiClient: ReturnType<typeof useSuiClient>) {
  if (!TESTNET_CONFIG.tuskdPackageId) return [];
  const normalized = address.toLowerCase();
  const forms: StoredForm[] = [];
  const seen = new Set<string>();

  for (const eventType of formAccessEventTypes()) {
    let cursor: { txDigest: string; eventSeq: string } | null | undefined;

    try {
      for (let page = 0; page < 10; page += 1) {
        const response = await suiClient.queryEvents({
          query: { MoveEventType: eventType },
          cursor,
          limit: 50,
          order: "descending",
        });

        for (const event of response.data as SuiEventLike[]) {
          const parsed = event.parsedJson as FormAccessEvent;
          const formId = normalizeObjectId(parsed.form_id);
          if (!formId || seen.has(formId)) continue;

          const admins = normalizeAdminAddresses(parsed.admins);
          const owner = (parsed.owner ?? "").toLowerCase();
          if (owner !== normalized && !admins.includes(normalized)) continue;

          seen.add(formId);
          try {
            const form = await fetchPublishedFormFromSui(formId, suiClient);
            if (canAdministerForm(form, address)) {
              forms.push({ ...form, txDigest: event.id.txDigest });
            }
          } catch {
            // Ignore stale/deleted objects or blobs that cannot be read.
          }
        }

        if (!response.hasNextPage || !response.nextCursor) break;
        cursor = response.nextCursor;
      }
    } catch {
      // Some RPCs reject an event type until it has been emitted; keep the other candidate type working.
    }
  }

  return forms;
}

const statusCode: Record<Submission["status"], number> = {
  new: 0,
  reviewed: 1,
  prioritized: 2,
  archived: 3,
};

const priorityCode: Record<Submission["priority"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const statusFromCode: Record<string, Submission["status"]> = {
  0: "new",
  1: "reviewed",
  2: "prioritized",
  3: "archived",
};

const priorityFromCode: Record<string, Submission["priority"]> = {
  0: "low",
  1: "medium",
  2: "high",
};

type SubmissionPayload = {
  values?: Submission["values"];
  media?: Record<string, BlobReceipt>;
  fieldSnapshot?: Field[];
  submitter?: string;
  createdAt?: string;
};

type FormSubmissionEvent = {
  form_id?: string;
  submission_id?: string | number;
  submitter?: string;
  submission_blob_id?: string;
};

type FormStatusEvent = {
  form_id?: string;
  submission_id?: string | number;
  status?: string | number;
  priority?: string | number;
};

type FormAccessEvent = {
  form_id?: string;
  owner?: string;
  admins?: string[];
};

type SuiEventLike = {
  id: {
    txDigest: string;
  };
  parsedJson: unknown;
  sender?: string;
  timestampMs?: string | null;
};

function moveEventType(name: "SubmissionEvent" | "StatusEvent") {
  return contractTypeTarget(name);
}

function formAccessEventTypes() {
  return [...new Set([contractTypeTarget("FormAccessEvent"), contractImplementationTypeTarget("FormAccessEvent")])];
}

function normalizeObjectId(value: string | undefined) {
  return (value ?? "").toLowerCase();
}

function formObjectId(form: StoredForm) {
  return form.suiObjectId || (isLocalFormId(form.id) ? "" : form.id);
}

function formSubmissionIds(form: StoredForm) {
  return [form.id, form.suiObjectId].filter(Boolean) as string[];
}

function getStoredSubmissionsForForm(form: StoredForm) {
  return getSubmissions(form.id, form.suiObjectId);
}

function responseCount(form: StoredForm) {
  return getStoredSubmissionsForForm(form).length;
}

function lastSubmissionAt(form: StoredForm) {
  const dates = getStoredSubmissionsForForm(form)
    .map((submission) => submission.createdAt)
    .sort();
  return dates[dates.length - 1];
}

async function fetchStatusUpdatesForFormFromSui(form: StoredForm, suiClient: ReturnType<typeof useSuiClient>) {
  if (!TESTNET_CONFIG.tuskdPackageId) return new Map<string, Pick<Submission, "status" | "priority">>();
  const ids = new Set(formSubmissionIds(form).map(normalizeObjectId));
  const updates = new Map<string, Pick<Submission, "status" | "priority">>();
  let cursor: { txDigest: string; eventSeq: string } | null | undefined;

  for (let page = 0; page < 10; page += 1) {
    const response = await suiClient.queryEvents({
      query: { MoveEventType: moveEventType("StatusEvent") },
      cursor,
      limit: 50,
      order: "descending",
    });

    for (const event of response.data as SuiEventLike[]) {
      const parsed = event.parsedJson as FormStatusEvent;
      const submissionId = parsed.submission_id === undefined ? "" : String(parsed.submission_id);
      if (!ids.has(normalizeObjectId(parsed.form_id)) || !submissionId || updates.has(submissionId)) continue;
      const status = statusFromCode[String(parsed.status)] ?? "new";
      const priority = priorityFromCode[String(parsed.priority)] ?? "medium";
      updates.set(submissionId, { status, priority });
    }

    if (!response.hasNextPage || !response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return updates;
}

async function fetchSubmissionsForFormFromSui(form: StoredForm, suiClient: ReturnType<typeof useSuiClient>) {
  if (!TESTNET_CONFIG.tuskdPackageId) return [];
  const ids = new Set(formSubmissionIds(form).map(normalizeObjectId));
  const statusUpdates = await fetchStatusUpdatesForFormFromSui(form, suiClient);
  const submissions: Submission[] = [];
  let cursor: { txDigest: string; eventSeq: string } | null | undefined;

  for (let page = 0; page < 10; page += 1) {
    const response = await suiClient.queryEvents({
      query: { MoveEventType: moveEventType("SubmissionEvent") },
      cursor,
      limit: 50,
      order: "descending",
    });

    for (const event of response.data as SuiEventLike[]) {
      const parsed = event.parsedJson as FormSubmissionEvent;
      if (!ids.has(normalizeObjectId(parsed.form_id)) || !parsed.submission_blob_id) continue;

      const chainSubmissionId = parsed.submission_id === undefined ? "" : String(parsed.submission_id);
      const submissionBlob = walrusJsonReceipt(parsed.submission_blob_id, "submission.json");
      let payload: SubmissionPayload = {};
      try {
        payload = await readJsonBlob<SubmissionPayload>(submissionBlob);
      } catch {
        payload = {};
      }

      const media = payload.media ?? {};
      const reviewState = chainSubmissionId ? statusUpdates.get(chainSubmissionId) : undefined;
      const createdAt =
        payload.createdAt ||
        (event.timestampMs ? new Date(Number(event.timestampMs)).toISOString() : new Date().toISOString());

      submissions.push({
        id: `chain_${normalizeObjectId(parsed.form_id)}_${chainSubmissionId || event.id.txDigest}`,
        formId: form.id,
        network: "sui-testnet",
        values: { ...(payload.values ?? {}), ...media },
        media,
        fieldSnapshot: payload.fieldSnapshot,
        submissionBlob,
        txDigest: event.id.txDigest,
        chainSubmissionId,
        submitter: parsed.submitter || payload.submitter || event.sender || "",
        createdAt,
        status: reviewState?.status ?? "new",
        priority: reviewState?.priority ?? "medium",
      });
    }

    if (!response.hasNextPage || !response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return submissions;
}

async function fetchRecentSubmissionsForFormsFromSui(forms: StoredForm[], suiClient: ReturnType<typeof useSuiClient>, limit = 5) {
  if (!TESTNET_CONFIG.tuskdPackageId) return [];
  const formById = new Map<string, StoredForm>();
  for (const form of forms) {
    for (const formId of formSubmissionIds(form)) {
      formById.set(normalizeObjectId(formId), form);
    }
  }
  if (!formById.size) return [];

  const submissions: Submission[] = [];
  let cursor: { txDigest: string; eventSeq: string } | null | undefined;

  for (let page = 0; page < 10 && submissions.length < limit; page += 1) {
    const response = await suiClient.queryEvents({
      query: { MoveEventType: moveEventType("SubmissionEvent") },
      cursor,
      limit: 50,
      order: "descending",
    });

    for (const event of response.data as SuiEventLike[]) {
      const parsed = event.parsedJson as FormSubmissionEvent;
      const form = formById.get(normalizeObjectId(parsed.form_id));
      if (!form || !parsed.submission_blob_id) continue;

      const chainSubmissionId = parsed.submission_id === undefined ? "" : String(parsed.submission_id);
      const submissionBlob = walrusJsonReceipt(parsed.submission_blob_id, "submission.json");
      let payload: SubmissionPayload = {};
      try {
        payload = await readJsonBlob<SubmissionPayload>(submissionBlob);
      } catch {
        payload = {};
      }

      const media = payload.media ?? {};
      submissions.push({
        id: `chain_${normalizeObjectId(parsed.form_id)}_${chainSubmissionId || event.id.txDigest}`,
        formId: form.id,
        network: "sui-testnet",
        values: { ...(payload.values ?? {}), ...media },
        media,
        fieldSnapshot: payload.fieldSnapshot,
        submissionBlob,
        txDigest: event.id.txDigest,
        chainSubmissionId,
        submitter: parsed.submitter || payload.submitter || event.sender || "",
        createdAt:
          payload.createdAt ||
          (event.timestampMs ? new Date(Number(event.timestampMs)).toISOString() : new Date().toISOString()),
        status: "new",
        priority: "medium",
      });

      if (submissions.length >= limit) break;
    }

    if (!response.hasNextPage || !response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return submissions;
}

type RecentResponse = {
  form: StoredForm;
  submission: Submission;
};

function recentResponsesForForms(forms: StoredForm[], limit = 5): RecentResponse[] {
  return forms
    .flatMap((form) => getStoredSubmissionsForForm(form).map((submission) => ({ form, submission })))
    .sort((a, b) => b.submission.createdAt.localeCompare(a.submission.createdAt))
    .slice(0, limit);
}

function matchingSubmission(form: StoredForm, candidate: Submission) {
  return getStoredSubmissionsForForm(form).find((submission) => {
    if (submission.id === candidate.id) return true;
    if (submission.txDigest && candidate.txDigest && submission.txDigest === candidate.txDigest) return true;
    return Boolean(
      submission.chainSubmissionId &&
        candidate.chainSubmissionId &&
        submission.chainSubmissionId === candidate.chainSubmissionId,
    );
  });
}

function mergeExistingReviewState(form: StoredForm, submission: Submission) {
  const existing = matchingSubmission(form, submission);
  if (!existing) return submission;
  return {
    ...submission,
    id: existing.id,
    status: existing.status,
    priority: existing.priority,
  };
}

function responsePreview(form: StoredForm, submission: Submission) {
  const schema = form.schema ?? form.draftSchema;
  for (const field of schema.fields) {
    const value = formatValue(submission.values[field.id]);
    if (value) return `${field.label}: ${value}`;
  }
  const archived = archivedAnswerFields(form, schema, submission);
  if (archived.length) {
    const field = archived[0];
    return `${field.label}: ${formatValue(submission.values[field.id])}`;
  }
  const mediaCount = Object.keys(submission.media).length;
  if (mediaCount) return `${mediaCount} file${mediaCount === 1 ? "" : "s"} attached`;
  return "No answer preview";
}

function archivedAnswerFields(form: StoredForm, schema: FormSchema, submission: Submission) {
  const activeIds = new Set(schema.fields.map((field) => field.id));
  const fieldById = new Map<string, Field>();
  for (const field of form.archivedFields ?? []) fieldById.set(field.id, field);
  for (const field of submission.fieldSnapshot ?? []) {
    if (!fieldById.has(field.id)) fieldById.set(field.id, field);
  }

  return Object.keys(submission.values)
    .filter((fieldId) => !activeIds.has(fieldId) && Boolean(formatValue(submission.values[fieldId])))
    .map((fieldId) => fieldById.get(fieldId) ?? archivedFallbackField(fieldId));
}

function archivedFallbackField(fieldId: string): Field {
  return {
    id: fieldId,
    type: "shortText",
    label: `Archived answer ${fieldId.slice(0, 8)}`,
    required: false,
  };
}

function archivedFieldsForSubmissions(form: StoredForm, schema: FormSchema, submissions: Submission[]) {
  const fields = new Map<string, Field>();
  for (const submission of submissions) {
    for (const field of archivedAnswerFields(form, schema, submission)) {
      if (!fields.has(field.id)) fields.set(field.id, field);
    }
  }
  return [...fields.values()];
}

function TuskDMark({ className = "", title = "TuskD" }: { className?: string; title?: string }) {
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bgId = `tuskd-mark-bg-${idBase}`;
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs>
        <linearGradient id={bgId} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2E3440" />
          <stop offset="1" stopColor="#1F2430" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="14" fill={`url(#${bgId})`} />
      <rect x="14" y="14" width="36" height="8" rx="4" fill="#8FBCBB" />
      <rect x="28" y="20" width="8" height="30" rx="4" fill="#ECEFF4" />
      <path d="M43 38L47 42L54 34" fill="none" stroke="#D08770" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formUiStatus(form: StoredForm) {
  if (form.status === "draft") return "draft";
  if (form.schema && schemaFingerprint(form.schema) !== schemaFingerprint(form.draftSchema)) return "dirty";
  return "published";
}

function formStatusLabel(form: StoredForm) {
  const status = formUiStatus(form);
  if (status === "dirty") return "Unpublished edits";
  return status === "published" ? "Published" : "Draft";
}

type Theme = "light" | "dark";
type TestnetDialogState = {
  walletName: string;
  isPhantom: boolean;
};
type SubmissionReviewPatch = Partial<Pick<Submission, "status" | "priority">>;
type PendingSubmissionUpdate = {
  original: Submission;
  next: Submission;
};

const TestnetWalletContext = createContext<{ ensureTestnetWallet: () => Promise<boolean> }>({
  ensureTestnetWallet: async () => true,
});

function walletAccountIsTestnetOnly(account: ReturnType<typeof useCurrentAccount>) {
  const suiChains = (account?.chains ?? []).filter((chain) => chain.startsWith("sui:"));
  return suiChains.length === 1 && suiChains[0] === SUI_TESTNET_CHAIN;
}

function isPhantomWallet(walletName: string) {
  const phantomProvider = (window as unknown as { phantom?: { sui?: { isPhantom?: boolean } } }).phantom?.sui;
  return walletName.toLowerCase().includes("phantom") || Boolean(phantomProvider?.isPhantom);
}

function useTestnetWalletGuard() {
  return useContext(TestnetWalletContext);
}

function useDropdownPosition(
  triggerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  menuRef?: React.RefObject<HTMLElement | null>,
  estimatedHeight = 280,
) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 320, placement: "bottom" as "top" | "bottom" });
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    let raf = 0;
    function update() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const gap = 6;
        const margin = 12;
        const menuHeight = menuRef?.current?.offsetHeight || estimatedHeight;
        const spaceBelow = window.innerHeight - rect.bottom - margin;
        const spaceAbove = rect.top - margin;
        const placement = spaceBelow >= menuHeight || spaceBelow >= spaceAbove ? "bottom" : "top";
        const available = Math.max(120, (placement === "bottom" ? spaceBelow : spaceAbove) - gap);
        const height = Math.min(menuHeight, available);
        const width = rect.width;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
        const top = placement === "bottom"
          ? rect.bottom + gap
          : Math.max(margin, rect.top - height - gap);
        setPos({ top, left, width, maxHeight: available, placement });
      });
    }
    update();
    const timer = window.setTimeout(update, 0);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [estimatedHeight, isOpen, menuRef, triggerRef]);
  return pos;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: "light", toggleTheme: () => {} });

function AppProvider({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const currentWalletState = useCurrentWallet();
  const pendingTestnetResolve = useRef<((confirmed: boolean) => void) | null>(null);
  const pendingTestnetPromise = useRef<Promise<boolean> | null>(null);
  const [testnetDialog, setTestnetDialog] = useState<TestnetDialogState | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("tuskd:theme") ?? localStorage.getItem(`${"tusk"}table:theme`);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    localStorage.setItem("tuskd:theme", theme);
    localStorage.removeItem(`${"tusk"}table:theme`);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = () => setTheme(current => current === "light" ? "dark" : "light");
  const accountChainsKey = (account?.chains ?? []).join(",");
  const walletName = currentWalletState.isConnected ? currentWalletState.currentWallet.name : "wallet";

  const closeTestnetDialog = useCallback((confirmed: boolean) => {
    const resolve = pendingTestnetResolve.current;
    pendingTestnetResolve.current = null;
    pendingTestnetPromise.current = null;
    setTestnetDialog(null);
    resolve?.(confirmed);
  }, []);

  const ensureTestnetWallet = useCallback(() => {
    if (walletAccountIsTestnetOnly(account)) {
      return Promise.resolve(true);
    }
    if (pendingTestnetPromise.current) {
      return pendingTestnetPromise.current;
    }

    const promise = new Promise<boolean>((resolve) => {
      pendingTestnetResolve.current = resolve;
      setTestnetDialog({
        walletName,
        isPhantom: isPhantomWallet(walletName),
      });
    });
    pendingTestnetPromise.current = promise;
    return promise;
  }, [account, accountChainsKey, walletName]);

  const testnetWalletValue = useMemo(() => ({ ensureTestnetWallet }), [ensureTestnetWallet]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <TestnetWalletContext.Provider value={testnetWalletValue}>
        {children}
        <TestnetWalletDialog state={testnetDialog} onCancel={() => closeTestnetDialog(false)} onContinue={() => closeTestnetDialog(true)} />
      </TestnetWalletContext.Provider>
    </ThemeContext.Provider>
  );
}

function TestnetWalletDialog({
  state,
  onCancel,
  onContinue,
}: {
  state: TestnetDialogState | null;
  onCancel: () => void;
  onContinue: () => void;
}) {
  useEffect(() => {
    if (!state) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, onCancel]);

  const steps = state?.isPhantom
    ? "In Phantom, select your profile avatar, open Settings, go to Developer Settings, turn on Testnet Mode, then switch Sui to Testnet before continuing."
    : "Open your wallet network selector, choose Sui Testnet, then return here before continuing.";

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          className="testnet-dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onCancel}
        >
          <motion.div
            className="testnet-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="testnet-dialog-title"
            aria-describedby="testnet-dialog-body"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="testnet-dialog-icon">
              <Lock size={18} />
            </div>
            <div className="testnet-dialog-copy">
              <p className="testnet-dialog-kicker">{state.walletName}</p>
              <h2 id="testnet-dialog-title">Switch wallet to Sui Testnet</h2>
              <p id="testnet-dialog-body">
                TuskD currently runs on Sui Testnet and Walrus Testnet. Mainnet or devnet transactions will fail.
              </p>
              <p>{steps}</p>
            </div>
            <div className="testnet-dialog-actions">
              <button className="secondary" onClick={onCancel}>Cancel</button>
              <button className="primary" onClick={onContinue}>I am on Testnet, continue</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function navigate(next: string) {
    window.history.pushState({}, "", next);
    setPath(next);
  }

  const formMatch = path.match(/^\/f\/([^/]+)/);
  const adminMatch = path.match(/^\/admin\/([^/]+)/);
  const builderMatch = path.match(/^\/builder(?:\/([^/]+))?$/);
  const isWorkspace = path === "/forms";

  const isPublicForm = Boolean(formMatch);

  return (
    <AppProvider>
      <main>
        {isPublicForm ? <FormControls /> : <TopBar navigate={navigate} path={path} />}
        {formMatch ? (
          <PublicForm formId={formMatch[1]} navigate={navigate} />
        ) : adminMatch ? (
          <Dashboard formId={adminMatch[1]} navigate={navigate} />
        ) : builderMatch ? (
          <Builder formId={builderMatch[1]} navigate={navigate} />
        ) : isWorkspace ? (
          <FormsHome navigate={navigate} />
        ) : (
          <LandingPage navigate={navigate} />
        )}
      </main>
    </AppProvider>
  );
}

function WalletPill() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }
  }, [menuOpen]);

  const handleCopy = async () => {
    if (!account?.address) return;
    await navigator.clipboard.writeText(account.address);
    toast.success("Address copied to clipboard");
    setMenuOpen(false);
  };

  if (!account) {
    return (
      <ConnectModal
        trigger={
          <button className="wallet-pill wallet-pill--connect">
            <Wallet size={14} />
            <span className="wallet-label">Connect Wallet</span>
          </button>
        }
      />
    );
  }

  return (
    <div className="wallet-pill-wrapper" ref={menuRef}>
      <button className="wallet-pill" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
        <span className="wallet-dot" />
        <span className="wallet-label">{shortAddress(account.address)}</span>
        <ChevronDown size={12} />
      </button>
      {menuOpen && (
        <div className="wallet-dropdown">
          <div className="wallet-dropdown-item" onClick={handleCopy}>
            <Copy size={14} />
            Copy Address
          </div>
          <div className="wallet-dropdown-sep" />
          <div className="wallet-dropdown-item wallet-dropdown-item--danger" onClick={() => { disconnect(); setMenuOpen(false); }}>
            <X size={14} />
            Disconnect
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({ navigate, path }: { navigate: (path: string) => void; path: string }) {
  const { theme, toggleTheme } = useContext(ThemeContext);

  return (
    <header className="topbar">
      <button className="brand topbar-home-link" onClick={() => navigate("/")}>
        <TuskDMark className="brand-mark" />
        <span className="brand-text">
          <strong>TuskD</strong>
          <small>Forms</small>
        </span>
      </button>
      <div className="topbar-actions">
        {path !== "/forms" && (
          <button className="topbar-link" onClick={() => navigate("/forms")}>
            <Table2 size={14} />
            Workspace
          </button>
        )}
        <WalletPill />
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

function LandingPage({ navigate }: { navigate: (path: string) => void }) {
  const account = useCurrentAccount();
  const [previewMode, setPreviewMode] = useState<"builder" | "form">("builder");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPreviewMode((mode) => (mode === "builder" ? "form" : "builder"));
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="landing-page">
      <section className="landing-hero">
        <motion.div
          className="landing-hero-copy"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <p className="landing-kicker">
            <TuskDMark className="landing-kicker-mark" />
            Sui + Walrus
          </p>
          <div className="landing-logo-lockup">
            <h1>TuskD</h1>
          </div>
          <p className="landing-lede">
            Build forms, collect media-rich responses, and keep publish and submit actions verifiable on testnet.
          </p>
          <div className="landing-actions">
            <button className="primary landing-primary" onClick={() => navigate("/forms")}>
              {account ? "Open workspace" : "Start building"}
              <ArrowRight size={16} />
            </button>
          </div>
        </motion.div>
        <motion.div
          className="landing-hero-preview"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          aria-label="TuskD form preview"
        >
          <div className="landing-preview-shell">
            <div className="landing-preview-top">
              <span className={previewMode === "builder" ? "active" : ""}>Builder</span>
              <span className={previewMode === "form" ? "active" : ""}>Form</span>
            </div>
            <AnimatePresence mode="wait">
              {previewMode === "builder" ? (
                <motion.div
                  key="builder"
                  className="landing-preview-pane"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                >
                  <div className="landing-builder-preview">
                    <div className="landing-preview-sidebar">
                      <span><MessageSquareText size={13} /> Short text</span>
                      <span><Settings2 size={13} /> Dropdown</span>
                      <span><Image size={13} /> Upload</span>
                    </div>
                    <div className="landing-preview-canvas">
                      <div className="landing-preview-question">
                        <small>01</small>
                        <strong>What should we review?</strong>
                        <i />
                      </div>
                      <div className="landing-preview-question compact">
                        <small>02</small>
                        <strong>Pick a category</strong>
                        <em>Bug report</em>
                      </div>
                      <div className="landing-preview-publish">
                        <Lock size={13} />
                        Publish to Walrus
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  className="landing-preview-pane"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                >
                  <div className="landing-form-mode-preview">
                    <div className="landing-form-mode-meta">
                      <span>3 questions</span>
                      <span><TuskDMark className="inline-brand-mark" /> Powered by TuskD</span>
                    </div>
                    <div className="landing-form-mode-question">
                      <small>01</small>
                      <h3>Tell us what happened.</h3>
                      <div />
                    </div>
                    <button className="landing-form-mode-button">OK</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </section>

      <section className="landing-section landing-section-tight" aria-label="TuskD features">
        <div className="landing-feature-grid">
          <article>
            <MessageSquareText size={20} />
            <h3>Create</h3>
            <p>Design focused forms with text, choices, ratings, URLs, images, and video uploads.</p>
          </article>
          <article>
            <Lock size={20} />
            <h3>Publish</h3>
            <p>Store schemas and responses on Walrus with wallet-signed Sui transactions.</p>
          </article>
          <article>
            <BarChart3 size={20} />
            <h3>Review</h3>
            <p>Search submissions, prioritize work, update status, and export the response set.</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-github-section">
        <div>
          <p className="eyebrow">Open source</p>
          <h2>Forms on Sui and Walrus.</h2>
        </div>
        <a
          className="landing-github-link"
          href="https://github.com/ankushKun/tuskd"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={18} />
          github.com/ankushKun/tuskd
          <ExternalLink size={16} />
        </a>
      </section>

      <section className="landing-section landing-cta">
        <div>
          <p className="eyebrow">Start</p>
          <h2>Launch a verifiable form.</h2>
        </div>
        <button className="primary landing-primary" onClick={() => navigate("/forms")}>
          Open workspace
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}

function FormWalletPill() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }
  }, [menuOpen]);

  const handleCopy = async () => {
    if (!account?.address) return;
    await navigator.clipboard.writeText(account.address);
    toast.success("Address copied to clipboard");
    setMenuOpen(false);
  };

  if (!account) {
    return (
      <ConnectModal
        trigger={
          <button className="form-control-pill form-control-pill--connect">
            <Wallet size={12} />
            <span className="form-control-address">Connect</span>
          </button>
        }
      />
    );
  }

  return (
    <div className="wallet-pill-wrapper" ref={menuRef}>
      <button className="form-control-pill" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
        <span className="form-control-dot" />
        <span className="form-control-address">{shortAddress(account.address)}</span>
        <ChevronDown size={12} />
      </button>
      {menuOpen && (
        <div className="wallet-dropdown wallet-dropdown--form">
          <div className="wallet-dropdown-item" onClick={handleCopy}>
            <Copy size={14} />
            Copy Address
          </div>
          <div className="wallet-dropdown-sep" />
          <div className="wallet-dropdown-item wallet-dropdown-item--danger" onClick={() => { disconnect(); setMenuOpen(false); }}>
            <X size={14} />
            Disconnect
          </div>
        </div>
      )}
    </div>
  );
}

function FormControls() {
  const { theme, toggleTheme } = useContext(ThemeContext);
  return (
    <div className="form-controls">
      <FormWalletPill />
      <button className="form-control-theme" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  );
}

function FormsHome({ navigate }: { navigate: (path: string) => void }) {
  const [forms, setForms] = useState<StoredForm[]>([]);
  const [recentResponses, setRecentResponses] = useState<RecentResponse[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "draft" | "published">("all");
  const [copiedId, setCopiedId] = useState("");
  const [syncingForms, setSyncingForms] = useState(false);
  const [syncingResponses, setSyncingResponses] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [importingForm, setImportingForm] = useState(false);
  const account = useCurrentAccount();
  const suiClient = useSuiClient();

  useEffect(() => {
    const nextForms = getFormsForAccount(account?.address);
    setForms(nextForms);
    setRecentResponses(recentResponsesForForms(nextForms));
    setQuery("");
    setFilter("all");
    setRecentOpen(false);
  }, [account?.address]);

  useEffect(() => {
    if (!account?.address) return;
    const address = account.address;
    let cancelled = false;

    async function syncAccessibleForms() {
      setSyncingForms(true);
      try {
        const [createdForms, indexedForms] = await Promise.all([
          fetchCreatedFormsForOwner(address, suiClient),
          fetchIndexedFormsForAccount(address, suiClient).catch(() => []),
        ]);
        const remoteForms = [...createdForms, ...indexedForms];
        if (cancelled) return;

        let changed = false;

        for (const remoteForm of remoteForms) {
          saveForm(remoteForm);
          changed = true;
        }

        const nextForms = getFormsForAccount(address);
        if ((changed || nextForms.length !== forms.length) && !cancelled) setForms(nextForms);
        if (!cancelled) setRecentResponses(recentResponsesForForms(nextForms));
      } catch {
        if (!cancelled) toast.error("Unable to sync forms from Sui right now.");
      } finally {
        if (!cancelled) setSyncingForms(false);
      }
    }

    syncAccessibleForms();
    return () => {
      cancelled = true;
    };
  }, [account?.address, forms.length, suiClient]);

  useEffect(() => {
    if (!forms.length) {
      setRecentResponses([]);
      return;
    }

    setRecentResponses(recentResponsesForForms(forms));
    const publishedForms = forms.filter((form) => form.status === "published" && formObjectId(form));
    if (!publishedForms.length) return;

    let cancelled = false;
    async function syncRecentResponses() {
      setSyncingResponses(true);
      try {
        const remoteSubmissions = await fetchRecentSubmissionsForFormsFromSui(publishedForms, suiClient, 5);
        if (cancelled) return;
        for (const submission of remoteSubmissions) {
          const form = publishedForms.find((item) => item.id === submission.formId);
          if (!form) continue;
          saveSubmission(mergeExistingReviewState(form, submission));
        }
        if (!cancelled) setRecentResponses(recentResponsesForForms(getForms()));
      } catch {
        if (!cancelled) toast.error("Unable to sync recent responses from Sui right now.");
      } finally {
        if (!cancelled) setSyncingResponses(false);
      }
    }

    syncRecentResponses();
    return () => {
      cancelled = true;
    };
  }, [forms, suiClient]);

  const filteredForms = useMemo(() => {
    return forms.filter((form) => {
      const status = formUiStatus(form);
      const matchesFilter = filter === "all" || (filter === "draft" ? status === "draft" || status === "dirty" : status === "published");
      const matchesQuery = `${form.draftSchema.title} ${form.draftSchema.description}`.toLowerCase().includes(query.toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [filter, forms, query]);

  const stats = useMemo(() => {
    const published = forms.filter((f) => formUiStatus(f) === "published").length;
    const drafts = forms.filter((f) => { const s = formUiStatus(f); return s === "draft" || s === "dirty"; }).length;
    const totalResponses = forms.reduce((sum, f) => sum + responseCount(f), 0);
    return { total: forms.length, published, drafts, totalResponses };
  }, [forms, recentResponses]);

  function newForm() {
    if (!account?.address) {
      toast.error("Connect your wallet to create a form.");
      return;
    }
    const form = createDraftForm(undefined, account.address);
    navigate(`/builder/${form.id}`);
  }

  function newSampleForm() {
    if (!account?.address) {
      toast.error("Connect your wallet to create the sample form.");
      return;
    }
    const form = createDraftForm(createWalrusSessionSampleSchema(), account.address);
    navigate(`/builder/${form.id}`);
  }

  async function importPublishedForm() {
    if (!account?.address) {
      toast.error("Connect your wallet to import a form.");
      return;
    }
    const value = window.prompt("Paste a published form object ID or form/admin link");
    if (!value) return;
    const objectId = extractSuiObjectId(value);
    if (!objectId) {
      toast.error("Enter a valid Sui object ID.");
      return;
    }

    setImportingForm(true);
    try {
      const remoteForm = await fetchPublishedFormFromSui(objectId, suiClient);
      if (!canAdministerForm(remoteForm, account.address)) {
        toast.error("This wallet is not the owner or an admin for that form.");
        return;
      }
      saveForm(remoteForm);
      const nextForms = getFormsForAccount(account.address);
      setForms(nextForms);
      setRecentResponses(recentResponsesForForms(nextForms));
      toast.success("Form imported");
      navigate(`/admin/${remoteForm.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to import this form from Sui.");
    } finally {
      setImportingForm(false);
    }
  }

  function copyFormLink(form: StoredForm) {
    if (form.status !== "published") return;
    copy(`${window.location.origin}${publicFormPath(form)}`);
    setCopiedId(form.id);
    toast.success("Link copied to clipboard");
    window.setTimeout(() => setCopiedId(""), 1600);
  }

  function handleDelete(formId: string) {
    if (window.confirm("Are you sure you want to delete this form and all its responses?")) {
      deleteForm(formId);
      setForms(getForms());
      toast.success("Form deleted");
    }
  }

  return (
    <section className="forms-home">
      <div className="forms-home-header">
        <div>
          <h1>Your forms</h1>
          <p className="muted">{syncingForms ? "Syncing forms from Sui..." : "Create, publish, and manage feedback forms on Walrus."}</p>
        </div>
        <div className="forms-home-actions">
          <button className="secondary" onClick={newSampleForm}>
            <LayoutTemplate size={16} />
            Sample form
          </button>
          <button className="secondary" onClick={importPublishedForm} disabled={importingForm}>
            {importingForm ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            Import form
          </button>
          <button className="primary" onClick={newForm}>
            <Plus size={16} />
            New form
          </button>
        </div>
      </div>

      {forms.length > 0 && (
        <div className="forms-stats">
          <div className="forms-stat">
            <div className="forms-stat-icon"><FileText size={18} /></div>
            <div className="forms-stat-value">{stats.total}</div>
            <div className="forms-stat-label">Total forms</div>
          </div>
          <div className="forms-stat">
            <div className="forms-stat-icon published"><Check size={18} /></div>
            <div className="forms-stat-value">{stats.published}</div>
            <div className="forms-stat-label">Published</div>
          </div>
          <div className="forms-stat">
            <div className="forms-stat-icon draft"><Clock size={18} /></div>
            <div className="forms-stat-value">{stats.drafts}</div>
            <div className="forms-stat-label">Drafts</div>
          </div>
          <div className="forms-stat">
            <div className="forms-stat-icon"><Inbox size={18} /></div>
            <div className="forms-stat-value">{stats.totalResponses}</div>
            <div className="forms-stat-label">Responses</div>
          </div>
        </div>
      )}

      {forms.length > 0 && (
        <section className={`recent-responses-panel ${recentOpen ? "open" : ""}`} aria-label="Recent responses">
          <button className="recent-responses-header" onClick={() => setRecentOpen((open) => !open)} aria-expanded={recentOpen}>
            <div>
              <h2>Recent responses</h2>
              <p>
                {syncingResponses
                  ? "Syncing latest Sui events..."
                  : recentResponses.length
                    ? `${recentResponses.length} latest across all forms`
                    : "No responses yet"}
              </p>
            </div>
            <div className="recent-responses-summary">
              {recentResponses[0] && (
                <span>{recentResponses[0].form.draftSchema.title || "Untitled form"}</span>
              )}
              <ChevronDown size={16} />
            </div>
          </button>
          {recentOpen && (
            recentResponses.length ? (
              <div className="recent-responses-list">
                {recentResponses.map(({ form, submission }) => (
                  <button
                    key={`${submission.formId}-${submission.id}`}
                    className="recent-response-row"
                    onClick={() => navigate(`/admin/${form.id}`)}
                  >
                    <span className="recent-response-form">
                      <strong>{form.draftSchema.title || "Untitled form"}</strong>
                      <small>{new Date(submission.createdAt).toLocaleString()}</small>
                    </span>
                    <span className="recent-response-submission">
                      <strong>{responsePreview(form, submission)}</strong>
                      <small>{submission.submitter ? shortAddress(submission.submitter) : "Unknown submitter"}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="recent-responses-empty">
                <MessageSquareText size={18} />
                <span>{syncingResponses ? "Looking for recent submissions..." : "No responses yet."}</span>
              </div>
            )
          )}
        </section>
      )}

      <div className="forms-home-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Search forms..." value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="filter-pills">
          {(["all", "draft", "published"] as const).map((item) => (
            <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              {item === "all" ? `All` : item === "draft" ? `Drafts` : `Published`}
              <span className="filter-pill-count">
                {item === "all" ? stats.total : item === "draft" ? stats.drafts : stats.published}
              </span>
            </button>
          ))}
        </div>
      </div>

      {forms.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="empty-state">
          <div className="empty-state-icon">
            <FileText size={32} />
          </div>
          <h2>No forms yet</h2>
          <p>Create a form, publish it, or import a form where this wallet is an admin.</p>
          <button className="primary" onClick={newForm}>
            <Plus size={16} /> Create your first form
          </button>
          <button className="secondary" onClick={importPublishedForm} disabled={importingForm}>
            {importingForm ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} Import published form
          </button>
        </motion.div>
      ) : filteredForms.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="empty-state">
          <div className="empty-state-icon">
            <Search size={32} />
          </div>
          <h2>No matching forms</h2>
          <p>Clear your search or try a different filter.</p>
          <button className="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>
            <X size={16} /> Clear filters
          </button>
        </motion.div>
      ) : null}

      <div className="forms-grid">
        {filteredForms.map((form) => {
          const status = formUiStatus(form);
          const count = responseCount(form);
          const lastAt = lastSubmissionAt(form);
          return (
            <article className="form-card" key={form.id}>
              <div className="form-card-header">
                <span className={`form-status-badge ${status}`}>{formStatusLabel(form)}</span>
                <div className="form-card-actions">
                  <button onClick={() => navigate(`/builder/${form.id}`)} title="Edit">
                    <Settings2 size={15} />
                  </button>
                  {form.status === "published" && (
                    <>
                      <button onClick={() => navigate(publicFormPath(form))} title="Open form">
                        <ExternalLink size={15} />
                      </button>
                      <button onClick={() => navigate(`/admin/${form.id}`)} title="Responses">
                        <BarChart3 size={15} />
                      </button>
                      <button onClick={() => copyFormLink(form)} title="Copy link">
                        {copiedId === form.id ? <Check size={15} /> : <Clipboard size={15} />}
                      </button>
                    </>
                  )}
                  <button className="danger" onClick={() => handleDelete(form.id)} title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="form-card-body" onClick={() => navigate(`/builder/${form.id}`)}>
                <h2>{form.draftSchema.title || "Untitled form"}</h2>
                <p>{form.draftSchema.description || "No description"}</p>
              </div>
              <div className="form-card-footer">
                <div className="form-card-meta">
                  <span><Inbox size={13} /> {count} response{count === 1 ? "" : "s"}</span>
                  <span><Calendar size={13} /> Updated {new Date(form.updatedAt).toLocaleDateString()}</span>
                </div>
                {lastAt && (
                  <span className="form-card-last"><Clock size={12} /> Last response {new Date(lastAt).toLocaleDateString()}</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Builder({ formId, navigate }: { formId?: string; navigate: (path: string) => void }) {
  const [form, setForm] = useState<StoredForm | null>(() => (formId ? getForm(formId) : null));
  const [schema, setSchema] = useState<FormSchema>(() => getForm(formId ?? "")?.draftSchema ?? createDefaultSchema());
  const [selectedId, setSelectedId] = useState(schema.fields[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"build" | "settings" | "preview">("build");
  const [copied, setCopied] = useState(false);
  const [adminInput, setAdminInput] = useState(() => schemaAdmins(schema).join("\n"));
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalIndex, setAddModalIndex] = useState(0);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [scrollTargetId, setScrollTargetId] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const formTitleRef = useRef<HTMLInputElement>(null);
  const titleFocusedRef = useRef("");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const signAndExecute = useSignAndExecuteTransaction();
  const { ensureTestnetWallet } = useTestnetWalletGuard();

  const schemaIssues = useMemo(() => validateSchema(schema), [schema]);
  const issueByField = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of schemaIssues) {
      if (!issue.fieldId) continue;
      map.set(issue.fieldId, [...(map.get(issue.fieldId) ?? []), issue.message]);
    }
    return map;
  }, [schemaIssues]);
  const dirtySincePublish = Boolean(form?.schema && schemaFingerprint(form.schema) !== schemaFingerprint(schema));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSchema((current) => {
        const oldIndex = current.fields.findIndex((f) => f.id === active.id);
        const newIndex = current.fields.findIndex((f) => f.id === over.id);
        return { ...current, fields: arrayMove(current.fields, oldIndex, newIndex) };
      });
    }
  }

  useEffect(() => {
    if (!formId) {
      if (!account?.address) {
        toast.error("Connect your wallet to create a form.");
        navigate("/forms");
        return;
      }
      const draft = createDraftForm(undefined, account.address);
      setForm(draft);
      setSchema(draft.draftSchema);
      setAdminInput(schemaAdmins(draft.draftSchema).join("\n"));
      setSelectedId(draft.draftSchema.fields[0]?.id ?? "");
      navigate(`/builder/${draft.id}`);
      return;
    }
    const existing = getForm(formId);
    if (existing) {
      setForm(existing);
      setSchema(existing.draftSchema);
      setAdminInput(schemaAdmins(existing.draftSchema).join("\n"));
      setSelectedId(existing.draftSchema.fields[0]?.id ?? "");
      return;
    }
    if (!account?.address) {
      toast.error("Connect your wallet to create a form.");
      navigate("/forms");
      return;
    }
    const draft = createDraftForm(undefined, account.address);
    setForm(draft);
    setSchema(draft.draftSchema);
    setAdminInput(schemaAdmins(draft.draftSchema).join("\n"));
    setSelectedId(draft.draftSchema.fields[0]?.id ?? "");
    navigate(`/builder/${draft.id}`);
  }, [formId]);

  useEffect(() => {
    if (!form) return;
    setForm(saveDraftForm(form.id, schema, form.owner));
  }, [schema]);

  useEffect(() => {
    if (!form || activeTab !== "build" || titleFocusedRef.current === form.id) return;
    const timer = window.setTimeout(() => {
      const input = formTitleRef.current;
      if (!input) return;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      input.focus({ preventScroll: true });
      input.select();
      requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
      titleFocusedRef.current = form.id;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, form?.id]);

  // Beforeunload guard for unsaved changes
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtySincePublish) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtySincePublish]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedId("");
        setMobileEditorOpen(false);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
          if (window.confirm("Delete this question?")) {
            removeField(selectedId);
          }
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  function insertField(type: FieldType, index: number) {
    const field = createField(type);
    setSchema((current) => {
      const fields = [...current.fields];
      fields.splice(index, 0, field);
      return { ...current, fields };
    });
    setSelectedId(field.id);
    setTimeout(() => {
      const el = document.getElementById(`field-${field.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function updateField(fieldId: string, patch: Partial<Field>) {
    setSchema((current) => ({
      ...current,
      fields: current.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    }));
  }

  function removeField(fieldId: string) {
    setSchema((current) => {
      const fields = current.fields.filter((field) => field.id !== fieldId);
      if (selectedId === fieldId) {
        setSelectedId("");
        setMobileEditorOpen(false);
      }
      return { ...current, fields };
    });
  }

  function duplicateField(fieldId: string) {
    const source = schema.fields.find((field) => field.id === fieldId);
    if (!source) return;
    const copyField = { ...source, id: id("field"), label: `${source.label || "Question"} copy` };
    setSchema((current) => {
      const index = current.fields.findIndex((field) => field.id === fieldId);
      const fields = [...current.fields];
      fields.splice(index + 1, 0, copyField);
      return { ...current, fields };
    });
    setSelectedId(copyField.id);
    setScrollTargetId(copyField.id);
  }

  function discardChanges() {
    if (!form?.schema || !dirtySincePublish) return;
    const confirmed = window.confirm("Discard unpublished edits and restore the currently published version?");
    if (!confirmed) return;
    setSchema(form.schema);
    setAdminInput(schemaAdmins(form.schema).join("\n"));
    setSelectedId((current) => form.schema?.fields.some((field) => field.id === current) ? current : form.schema?.fields[0]?.id ?? "");
    setScrollTargetId("");
    setForm(saveDraftForm(form.id, form.schema, form.owner));
    toast.success("Unpublished edits discarded");
  }

  async function publish() {
    if (schemaIssues.length) {
      toast.error("Fix the highlighted field issues before publishing.");
      return;
    }
    if (!account?.address) {
      toast.error("Connect your wallet to publish this form.");
      return;
    }
    setBusy(true);
    try {
      const canUseWallet = await ensureTestnetWallet();
      if (!canUseWallet) return;
      const owner = account.address;
      const current = form ?? createDraftForm(schema, owner);
      let existingObjectId = current.status === "published" ? formObjectId(current) : "";
      let shouldUpdate = Boolean(existingObjectId);
      if (existingObjectId && !(await isCurrentPackageFormObject(existingObjectId, suiClient))) {
        existingObjectId = "";
        shouldUpdate = false;
      }
      if (shouldUpdate && TESTNET_CONFIG.onchainAdmins && !canAdministerForm(current, owner)) {
        toast.error("Connect the form owner or an admin wallet to update this published form.");
        return;
      }
      if (shouldUpdate && !TESTNET_CONFIG.onchainAdmins && current.owner && current.owner.toLowerCase() !== owner.toLowerCase()) {
        toast.error("Connect the form owner wallet to update this published form.");
        return;
      }

      contractTarget(shouldUpdate ? "update_form" : "create_form");
      const now = new Date().toISOString();
      const nextSchema = {
        ...schema,
        admins: schemaAdmins(schema),
        id: current.schema?.id ?? current.draftSchema.id ?? schema.id ?? id("schema"),
        createdAt: current.schema?.createdAt ?? current.draftSchema.createdAt ?? schema.createdAt ?? now,
      };
      const schemaBlob = await uploadJson(nextSchema, "form-schema.json");
      const admins = schemaAdmins(nextSchema);
      const tx = new Transaction();
      if (shouldUpdate) {
        const args = [
          tx.object(existingObjectId),
          tx.pure.string(nextSchema.title),
          tx.pure.string(nextSchema.description),
          tx.pure.string(schemaBlob.id),
        ];
        if (TESTNET_CONFIG.onchainAdmins) args.push(tx.pure.vector("address", admins));
        tx.moveCall({
          target: contractTarget("update_form"),
          arguments: args,
        });
      } else {
        const args = [
          tx.pure.string(nextSchema.title),
          tx.pure.string(nextSchema.description),
          tx.pure.string(schemaBlob.id),
        ];
        if (TESTNET_CONFIG.onchainAdmins) args.push(tx.pure.vector("address", admins));
        tx.moveCall({
          target: contractTarget("create_form"),
          arguments: args,
        });
      }
      const txResult = await signAndExecute.mutateAsync({ transaction: tx, chain: SUI_TESTNET_CHAIN });
      const txDetails = await suiClient.waitForTransaction({
        digest: txResult.digest,
        options: { showObjectChanges: true },
      });
      const suiObjectId = shouldUpdate ? existingObjectId : findCreatedFormObjectId(txDetails);
      if (!suiObjectId) throw new Error("Sui transaction succeeded, but the created form object was not found.");
      const publishedForm = publishStoredForm(current.id, nextSchema, schemaBlob, owner, txResult.digest, suiObjectId);
      setForm(publishedForm);
      setSchema(publishedForm.draftSchema);
      toast.success(shouldUpdate ? "Form updated on Sui Testnet" : "Form published successfully to Walrus Testnet");
      if (!formId) navigate(`/builder/${publishedForm.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to publish this form.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function copyShareLink() {
    if (form?.status !== "published") return;
    copy(`${window.location.origin}${publicFormPath(form)}`);
    setCopied(true);
    toast.success("Link copied to clipboard");
    window.setTimeout(() => setCopied(false), 1600);
  }

  function handleSelectField(fieldId: string) {
    setSelectedId(fieldId);
    if (window.innerWidth < 768) {
      setMobileEditorOpen(true);
    }
  }

  const selectedField = schema.fields.find((f) => f.id === selectedId);

  return (
    <div className="builder-container">
      <header className="builder-header">
        <button onClick={() => navigate("/forms")} className="back-btn builder-back-btn" aria-label="Back to workspace"><ArrowLeft size={18}/></button>
        <div className="builder-tabs" role="tablist" aria-label="Builder tabs">
          <button role="tab" aria-selected={activeTab === "build"} className={activeTab === "build" ? "active" : ""} onClick={() => setActiveTab("build")}>Build</button>
          <button role="tab" aria-selected={activeTab === "settings"} className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>Settings</button>
          <button role="tab" aria-selected={activeTab === "preview"} className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>Preview</button>
        </div>
        <div className="builder-header-right">
          {dirtySincePublish && (
            <button className="secondary discard-changes-btn" onClick={discardChanges}>
              <X size={15}/> Discard
            </button>
          )}
          {form?.status === "published" && (
            <>
              <button className="secondary" onClick={() => navigate(`/admin/${form.id}`)}>
                <BarChart3 size={15}/> Responses
              </button>
              <button className="secondary" onClick={copyShareLink}>
                {copied ? <Check size={15}/> : <LinkIcon size={15}/>} Share
              </button>
            </>
          )}
          <button className="primary" onClick={publish} disabled={busy || schemaIssues.length > 0}>
             {busy ? <><Loader2 size={15} className="spin" /> Publishing</> : (form?.status === "published" && !dirtySincePublish ? "Published" : "Publish")}
          </button>
        </div>
      </header>

      <main className="builder-main" ref={canvasRef}>
        <AnimatePresence mode="wait">
          {activeTab === "build" && (
            <motion.div
              key="build"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="builder-canvas"
            >
              <div className="builder-form-meta">
                <input ref={formTitleRef} className="builder-title" value={schema.title} onChange={e => setSchema({...schema, title: e.target.value})} placeholder="Form title" />
                <span className={`save-status ${dirtySincePublish ? 'dirty' : ''}`}>{dirtySincePublish ? "Unsaved edits" : "Saved"}</span>
              </div>
              <textarea className="builder-desc" value={schema.description} onChange={e => setSchema({...schema, description: e.target.value})} placeholder="Form description or instructions..." />
              
              {schema.fields.length === 0 ? (
                <div className="builder-empty-state">
                  <div className="builder-empty-icon">
                    <LayoutTemplate size={48} />
                  </div>
                  <h2>Start building your form</h2>
                  <p>Add your first question to get started. You can drag questions to reorder them later.</p>
                  <button className="primary" onClick={() => { setAddModalIndex(0); setAddModalOpen(true); }}>
                    <Plus size={18} /> Add first question
                  </button>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={schema.fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                    {schema.fields.map((field, index) => (
                      <React.Fragment key={field.id}>
                        <AddFieldDivider onClick={() => { setAddModalIndex(index); setAddModalOpen(true); }} />
                        <SortableField 
                          field={field} 
                          index={index} 
                          isSelected={selectedId === field.id}
                          onSelect={() => handleSelectField(field.id)}
                          onUpdate={(patch) => updateField(field.id, patch)}
                          onRemove={() => removeField(field.id)}
                          onDuplicate={() => duplicateField(field.id)}
                          issue={issueByField.get(field.id)}
                          scrollIntoView={scrollTargetId === field.id}
                          onScrolled={() => setScrollTargetId("")}
                        />
                      </React.Fragment>
                    ))}
                    <AddFieldDivider bottom onClick={() => { setAddModalIndex(schema.fields.length); setAddModalOpen(true); }} />
                  </SortableContext>
                </DndContext>
              )}
            </motion.div>
          )}
          {activeTab === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="builder-settings-panel"
            >
              <div className="settings-card">
                <p className="eyebrow">Presentation</p>
                <h2>Form Layout</h2>
                <div className="layout-options">
                  <button 
                    className={schema.layout !== "slides" ? "active" : ""} 
                    onClick={() => setSchema({ ...schema, layout: "standard" })}
                  >
                    <LayoutList size={20} />
                    <strong>Standard</strong>
                    <span>Classic vertical scrolling form</span>
                  </button>
                  <button 
                    className={schema.layout === "slides" ? "active" : ""} 
                    onClick={() => setSchema({ ...schema, layout: "slides" })}
                  >
                    <LayoutTemplate size={20} />
                    <strong>Slides</strong>
                    <span>One question at a time</span>
                  </button>
                </div>
              </div>

              <div className="settings-card">
                <p className="eyebrow">Access</p>
                <h2>Admins</h2>
                <p className="settings-copy">Admins can open the response dashboard and sign status or priority updates. Put one Sui address per line.</p>
                <textarea
                  className="admin-addresses-input"
                  value={adminInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAdminInput(value);
                    setSchema((current) => ({ ...current, admins: parseAdminInput(value) }));
                  }}
                  placeholder={WALRUS_SESSION_SAMPLE_ADMIN}
                />
                <div className="admin-address-list">
                  {schemaAdmins(schema).length ? (
                    schemaAdmins(schema).map((admin) => <code key={admin}>{shortAddress(admin)}</code>)
                  ) : (
                    <span>No extra admins</span>
                  )}
                </div>
              </div>

              {schemaIssues.length > 0 && (
                <div className="settings-card">
                  <p className="eyebrow">Validation</p>
                  <h2>Fix before publishing</h2>
                  <div className="issue-list" style={{marginTop: 12}}>
                    {schemaIssues.map((issue) => (
                      <button key={`${issue.fieldId ?? "form"}-${issue.message}`} onClick={() => { setActiveTab("build"); if (issue.fieldId) { setSelectedId(issue.fieldId); setScrollTargetId(issue.fieldId); } }}>
                        <AlertCircle size={14} />
                        {issue.message}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {form?.status === "published" && form.schemaBlob && (
                <div className="settings-card">
                  <p className="eyebrow">Storage Proofs</p>
                  <h2>Receipts</h2>
                  <div className="receipt" style={{marginTop: 12}}>
                    <p>Schema blob</p>
                    <code>{form.schemaBlob.id}</code>
                    {form.txDigest && (
                      <>
                        <p>Sui testnet transaction</p>
                        <a className="proof-link" href={testnetTxUrl(form.txDigest)} target="_blank" rel="noreferrer">
                          {form.txDigest}
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
          {activeTab === "preview" && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="public-wrap"
              style={{width: '100%', margin: 0, border: '1px solid var(--border)'}}
            >
              <PublicFormPreview schema={schema} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AddFieldModal 
        open={addModalOpen} 
        onClose={() => setAddModalOpen(false)} 
        onSelect={(type) => insertField(type as FieldType, addModalIndex)} 
      />

      {selectedField && (
        <Sheet open={mobileEditorOpen} onClose={() => setMobileEditorOpen(false)} title="Edit Question">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <input 
              className="title-input" 
              style={{fontSize: 18, padding: 12}} 
              value={selectedField.label} 
              onChange={e => updateField(selectedField.id, {label: e.target.value})} 
              placeholder="Question..." 
            />
            <textarea 
              className="description-input" 
              style={{minHeight: 60, padding: 12}} 
              value={selectedField.helper ?? ""} 
              onChange={e => updateField(selectedField.id, {helper: e.target.value})} 
              placeholder="Description or instructions (optional)..."
            />
            <FieldEditorInline field={selectedField} updateField={(patch) => updateField(selectedField.id, patch)} />
            <label className="switch-row" style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <input type="checkbox" checked={selectedField.required} onChange={e => updateField(selectedField.id, {required: e.target.checked})} style={{width: 'auto'}} />
              <span style={{fontWeight: 600}}>Required</span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button className="secondary" onClick={() => duplicateField(selectedField.id)}>
                <Copy size={15} /> Duplicate
              </button>
              <button className="danger" onClick={() => { removeField(selectedField.id); setMobileEditorOpen(false); }}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function AddFieldDivider({ onClick, bottom }: { onClick: () => void; bottom?: boolean }) {
  return (
    <div className={`add-field-divider ${bottom ? 'bottom' : ''}`}>
      <button className="add-field-divider-btn" onClick={onClick} aria-label="Add question">
        <Plus size={14} />
      </button>
    </div>
  );
}

function SortableField({
  field,
  index,
  isSelected,
  issue,
  scrollIntoView,
  onScrolled,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate
}: {
  field: Field;
  index: number;
  isSelected: boolean;
  issue?: string[];
  scrollIntoView?: boolean;
  onScrolled?: () => void;
  onSelect: () => void;
  onUpdate: (patch: Partial<Field>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 50, opacity: 0.4 } : {}),
  };

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollIntoView && contentRef.current) {
      contentRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      onScrolled?.();
    }
  }, [onScrolled, scrollIntoView]);

  return (
    <div ref={setNodeRef} style={style} id={`field-${field.id}`}>
      <motion.div 
        layout
        className={`field-card ${isSelected ? "selected" : ""} ${issue?.length ? "has-issue" : ""}`}
        onClick={() => !isSelected && onSelect()}
        initial={false}
        animate={{ 
          boxShadow: isSelected 
            ? "0 0 0 1.5px var(--primary), 0 8px 30px rgba(0,0,0,0.1)" 
            : "0 1px 3px rgba(0,0,0,0.04)",
          y: isSelected ? -1 : 0,
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="field-card-toolbar">
          <div className="field-card-toolbar-left">
            <span className="field-number">{index + 1}</span>
          </div>
          <div className="field-card-toolbar-right">
            <button className="field-card-tool" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicate">
              <Copy size={15}/>
            </button>
            <button className="field-card-tool danger" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Delete">
              <Trash2 size={15}/>
            </button>
            <div className="field-card-tool drag" {...attributes} {...listeners} title="Drag to reorder">
              <GripVertical size={15}/>
            </div>
          </div>
        </div>
        
        <div ref={contentRef}>
          {isSelected ? (
            <motion.div 
              key="editor"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
            >
              <div className="field-card-editor">
                <input 
                  className="field-card-title-input"
                  value={field.label} 
                  onChange={e => onUpdate({label: e.target.value})} 
                  placeholder="Question..." 
                />
                <textarea 
                  className="field-card-desc-input"
                  value={field.helper ?? ""} 
                  onChange={e => onUpdate({helper: e.target.value})} 
                  placeholder="Description or instructions (optional)..."
                  rows={1}
                />
                <FieldEditorInline field={field} updateField={onUpdate} />
                <div className="field-card-footer">
                  <label className="field-card-required">
                    <input type="checkbox" checked={field.required} onChange={e => onUpdate({required: e.target.checked})} />
                    <span>Required</span>
                  </label>
                  {issue && issue.length > 0 && (
                    <span className="field-card-issue"><AlertCircle size={14} />{issue[0]}</span>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <FieldPreview field={field} />
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function FieldEditorInline({ field, updateField }: { field: Field, updateField: (p: Partial<Field>) => void }) {
  const options = field.options ?? [];
  const usesOptions = field.type === "dropdown" || field.type === "checkboxes";
  const [selectOpen, setSelectOpen] = useState(false);
  const selectRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownPos = useDropdownPosition(selectRef, selectOpen, menuRef, 320);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = selectRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setSelectOpen(false);
    }
    if (selectOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectOpen]);

  return (
    <div className="field-inline-editor">
      <div className="field-inline-row">
        <label>Field Type</label>
        <button ref={selectRef} className="field-custom-select" onClick={() => setSelectOpen(!selectOpen)}>
          {(() => {
            const item = fieldTypes.find(i => i.type === field.type);
            return item ? <><item.icon size={16} /> {item.label}</> : field.type;
          })()}
          <ChevronRight size={14} style={{ transform: selectOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s", marginLeft: "auto" }} />
        </button>
        <AnimatePresence>
          {selectOpen && (
            <DropdownPortal>
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="field-custom-select-dropdown"
                style={{ position: "absolute", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, maxHeight: dropdownPos.maxHeight }}
              >
                {fieldTypes.map(item => (
                  <button
                    key={item.type}
                    className={field.type === item.type ? "active" : ""}
                    onClick={() => {
                      updateField({
                        type: item.type,
                        options: (item.type === "dropdown" || item.type === "checkboxes")
                          ? (options.length ? options : ["Option 1", "Option 2"])
                          : undefined
                      });
                      setSelectOpen(false);
                    }}
                  >
                    <item.icon size={16} /> {item.label}
                  </button>
                ))}
              </motion.div>
            </DropdownPortal>
          )}
        </AnimatePresence>
      </div>

      {usesOptions && (
        <div className="field-inline-row">
          <label>Options</label>
          <div className="field-options-list">
            {options.map((opt, i) => (
              <div className="field-option-row" key={i}>
                <div className="field-option-drag"><GripVertical size={14} /></div>
                <input 
                  value={opt} 
                  onChange={e => { const no = [...options]; no[i] = e.target.value; updateField({options: no}) }} 
                  placeholder={`Option ${i+1}`}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      updateField({options: [...options, `Option ${options.length + 1}`]});
                    }
                  }}
                />
                <button className="field-option-remove" onClick={() => updateField({options: options.filter((_, idx) => idx !== i)})}>
                  <X size={14}/>
                </button>
              </div>
            ))}
            <button className="field-option-add" onClick={() => updateField({options: [...options, `Option ${options.length + 1}`]})}>
              <Plus size={14}/> Add Option
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldPreview({ field }: { field: Field }) {
  return (
    <div className="field-preview-body">
      <div className="field-preview-label">
        <span>{field.label || "Untitled Question"}</span>
        {field.required ? <em>Required</em> : null}
      </div>
      {field.helper ? <p className="field-preview-helper">{field.helper}</p> : null}
      {field.type === "shortText" && <div className="preview-input" />}
      {field.type === "richText" && <div className="preview-textarea" />}
      {field.type === "url" && <div className="preview-input with-icon">https://</div>}
      {field.type === "rating" && <div className="stars" style={{fontSize: 22}}>{"★★★★★"}</div>}
      {field.type === "dropdown" && <div className="preview-input">{field.options?.[0] ?? "Select"}</div>}
      {field.type === "checkboxes" && (
        <div className="chips">{field.options?.map((option) => <span key={option}>{option}</span>)}</div>
      )}
      {field.type === "image" && <div className="upload-drop"><Image size={18} /> Image upload</div>}
      {field.type === "video" && <div className="upload-drop"><FileVideo size={18} /> Video upload</div>}
    </div>
  );
}

function PublicFormPreview({ schema }: { schema: FormSchema }) {
  return (
    <div className="typeform-preview">
      <div className="typeform-preview-header">
        <h1>{schema.title || "Untitled Form"}</h1>
        {schema.description ? <p>{schema.description}</p> : null}
      </div>
      <div className="typeform-preview-body">
        {schema.fields.map((field, i) => (
           <TypeformField
             key={field.id}
             field={field}
             value={undefined}
             onValue={() => {}}
             onFile={() => {}}
             onClearFile={() => {}}
             index={i}
           />
        ))}
        <button className="typeform-ok submit">Submit</button>
      </div>
    </div>
  );
}

function PublicForm({ formId, navigate }: { formId: string; navigate: (path: string) => void }) {
  const [form, setForm] = useState<StoredForm | null>(() => getForm(formId));
  const [loadingForm, setLoadingForm] = useState(() => !getForm(formId));
  const [loadError, setLoadError] = useState("");
  const suiClient = useSuiClient();

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    const current = getForm(formId);
    setLoadingForm(true);

    async function loadForm() {
      try {
        if (current) {
          if (current.status !== "published" || !current.schemaBlob) {
            if (!cancelled) setForm(current);
            return;
          }
          try {
            const schema = await readJsonBlob<FormSchema>(current.schemaBlob);
            if (!cancelled) setForm({ ...current, schema });
          } catch {
            if (!cancelled) setForm(current);
          }
          return;
        }

        if (isLocalFormId(formId)) {
          throw new Error("This link uses a local form id. Copy the published public link again so it uses the Sui form object id.");
        }

        const remoteForm = await fetchPublishedFormFromSui(formId, suiClient);
        if (!cancelled) setForm(remoteForm);
      } catch (error) {
        if (!cancelled) {
          setForm(null);
          setLoadError(error instanceof Error ? error.message : "Unable to load this form from the network.");
        }
      } finally {
        if (!cancelled) setLoadingForm(false);
      }
    }

    loadForm();
    return () => {
      cancelled = true;
    };
  }, [formId, suiClient]);

  if (loadingForm) {
    return (
      <section className="public-form-state">
        <Loader2 size={28} className="spin" />
        <h1>Loading form</h1>
        <p className="muted">Fetching the Sui form object and Walrus schema.</p>
      </section>
    );
  }

  if (!form) {
    return (
      <section className="public-form-state">
        <h1>Form not found</h1>
        <p className="muted">{loadError || "No published TuskD form was found for this link."}</p>
        <button className="primary" onClick={() => navigate("/builder")}>Create a form</button>
      </section>
    );
  }

  if (form.status !== "published" || !form.schema || !form.schemaBlob) {
    return (
      <section className="public-form-state">
        <h1>This form is still a draft</h1>
        <p className="muted">Publish it before sharing a public response link.</p>
        <button className="primary" onClick={() => navigate(`/builder/${form.id}`)}>Open builder</button>
      </section>
    );
  }

  return <PublicFormLoaded key={formId} form={form} formId={formId} navigate={navigate} />;
}

function PublicFormLoaded({ form, formId, navigate }: { form: StoredForm; formId: string; navigate: (path: string) => void }) {
  const [values, setValues] = useState<Record<string, string | string[] | number>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const signAndExecute = useSignAndExecuteTransaction();
  const { ensureTestnetWallet } = useTestnetWalletGuard();

  useEffect(() => {
    setErrors({});
    setReceipt(null);
    setActiveStep(0);
    const draftKey = `tuskd:draft:${formId}`;
    const legacyDraftKey = `${"tusk"}table:draft:${formId}`;
    const saved = localStorage.getItem(draftKey) ?? localStorage.getItem(legacyDraftKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setValues(parsed.values || {});
      } catch {
        setValues({});
      }
    } else {
      setValues({});
    }
    setFiles({});
  }, [formId]);

  useEffect(() => {
    if (receipt) {
      localStorage.removeItem(`tuskd:draft:${formId}`);
      localStorage.removeItem(`${"tusk"}table:draft:${formId}`);
      return;
    }
    const timer = setTimeout(() => {
      localStorage.setItem(`tuskd:draft:${formId}`, JSON.stringify({ values }));
      localStorage.removeItem(`${"tusk"}table:draft:${formId}`);
    }, 500);
    return () => clearTimeout(timer);
  }, [values, receipt, formId]);

  const activeForm = form;
  const publishedSchema = activeForm.schema;
  const activeSchema = publishedSchema!;
  const isSlides = activeSchema.layout === "slides";
  const totalFields = activeSchema.fields.length;
  const totalSlides = isSlides ? totalFields + 1 : totalFields;
  const isIntroSlide = isSlides && activeStep === 0;
  const currentField = isSlides ? activeSchema.fields[activeStep - 1] : activeSchema.fields[activeStep];
  const requiredCount = activeSchema.fields.filter((f) => f.required).length;

  function validateField(field: Field, value: unknown, file?: File): string {
    const emptyArray = Array.isArray(value) && value.length === 0;
    if (field.required && !value && !file) return "This question is required";
    if (field.required && emptyArray) return "This question is required";
    if (field.type === "url" && value) {
      try {
        const url = new URL(String(value));
        if (url.protocol !== "http:" && url.protocol !== "https:") return "Please enter a valid http or https URL";
      } catch {
        return "Please enter a valid URL";
      }
    }
    return "";
  }

  function validateAll(): Record<string, string> {
    const nextErrors: Record<string, string> = {};
    for (const field of activeSchema.fields) {
      const err = validateField(field, values[field.id], files[field.id]);
      if (err) nextErrors[field.id] = err;
    }
    return nextErrors;
  }

  function handleNext() {
    if (isIntroSlide) {
      if (activeStep < totalSlides - 1) {
        setDirection(1);
        setActiveStep((s) => s + 1);
      }
      return;
    }
    if (!currentField) return;
    const err = validateField(currentField, values[currentField.id], files[currentField.id]);
    if (err) {
      setErrors((prev) => ({ ...prev, [currentField.id]: err }));
      return;
    }
    setErrors((prev) => ({ ...prev, [currentField.id]: "" }));
    if (activeStep < totalSlides - 1) {
      setDirection(1);
      setActiveStep((s) => s + 1);
    }
  }

  function handlePrev() {
    if (activeStep > 0) {
      setDirection(-1);
      setActiveStep((s) => s - 1);
    }
  }

  async function handleSubmit() {
    if (!account?.address) {
      toast.error("Connect your wallet to submit this form.");
      return;
    }
    if (!activeForm.suiObjectId) {
      toast.error("This form is missing its Sui object ID. Republish it after configuring the testnet package.");
      return;
    }
    const nextErrors = validateAll();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      if (isSlides) {
        const firstErrorIndex = activeSchema.fields.findIndex((f) => nextErrors[f.id]);
        if (firstErrorIndex >= 0) {
          const firstErrorStep = firstErrorIndex + 1;
          setDirection(firstErrorStep > activeStep ? 1 : -1);
          setActiveStep(firstErrorStep);
        }
      } else {
        const firstErrorField = activeSchema.fields.find((f) => nextErrors[f.id]);
        if (firstErrorField) {
          const el = document.getElementById(`q-${firstErrorField.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      toast.error("Please answer all required questions");
      return;
    }

    setBusy(true);
    try {
      const canUseWallet = await ensureTestnetWallet();
      if (!canUseWallet) return;
      contractTarget("submit");
      const media: Record<string, BlobReceipt> = {};
      for (const [fieldId, file] of Object.entries(files)) {
        media[fieldId] = await uploadFile(file);
      }
      const submitter = account.address;
      const payload = {
        formId: activeForm.id,
        values: { ...values },
        media,
        fieldSnapshot: activeSchema.fields,
        submitter,
        createdAt: new Date().toISOString(),
      };
      const submissionBlob = await uploadJson(payload, "submission.json");
      const tx = new Transaction();
      tx.moveCall({
        target: contractTarget("submit"),
        arguments: [
          tx.object(activeForm.suiObjectId),
          tx.pure.string(submissionBlob.id),
          tx.pure.vector("string", Object.values(media).map((receipt) => receipt.id)),
        ],
      });
      const txResult = await signAndExecute.mutateAsync({ transaction: tx, chain: SUI_TESTNET_CHAIN });
      const txDetails = await suiClient.waitForTransaction({
        digest: txResult.digest,
        options: { showEvents: true },
      });
      const chainSubmissionId = findSubmissionEventId(txDetails);
      if (!chainSubmissionId) throw new Error("Sui transaction succeeded, but the submission event was not found.");
      const submission: Submission = {
        id: id("sub"),
        formId: activeForm.id,
        network: "sui-testnet",
        values: { ...values, ...media },
        media,
        fieldSnapshot: activeSchema.fields,
        submissionBlob,
        txDigest: txResult.digest,
        chainSubmissionId,
        submitter,
        createdAt: new Date().toISOString(),
        status: "new",
        priority: "medium",
      };
      saveSubmission(submission);
      setReceipt(submission);
      toast.success("Submitted successfully!");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to submit this response.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isSlides) return;
      if (e.key === "Enter" && !e.shiftKey && e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (activeStep < totalSlides - 1) handleNext();
        else handleSubmit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeStep, values, files, activeSchema, isSlides, totalSlides]);

  // Focus first field on initial load
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        ".typeform-input, .typeform-input-area input, .typeform-input-area textarea"
      );
      if (el) el.focus({ preventScroll: true });
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isSlides) return;
    const frame = requestAnimationFrame(() => {
      const body = document.querySelector<HTMLElement>(".public-form-body");
      if (body) body.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [isSlides, activeSchema.id]);

  // Focus field on slide change
  useEffect(() => {
    if (!isSlides || isIntroSlide) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(".slides-question-wrapper .typeform-input, .slides-question-wrapper .typeform-input-area input, .slides-question-wrapper .typeform-input-area textarea");
      if (el) el.focus({ preventScroll: true });
    }, 350);
    return () => clearTimeout(timer);
  }, [activeStep, isSlides, isIntroSlide]);

  if (receipt) {
    return <PublicFormSuccess receipt={receipt} />;
  }

  return (
    <div className="public-form-page">
      {/* Step counter pill with nav */}
      <div className="public-form-meta">
        <span className="step-pill">
          {isSlides ? `${activeStep + 1} / ${totalSlides}` : `${activeSchema.fields.length} questions`}
        </span>
        {isSlides && totalSlides > 1 && (
          <span className="step-pills-nav">
            <button className="step-pill-nav-btn" onClick={handlePrev} disabled={activeStep === 0} aria-label="Previous">
              <Triangle size={10} fill="currentColor" />
            </button>
            <button className="step-pill-nav-btn" onClick={handleNext} disabled={activeStep === totalSlides - 1} aria-label="Next">
              <Triangle size={10} fill="currentColor" style={{ transform: "rotate(180deg)" }} />
            </button>
          </span>
        )}
      </div>

      <main className="public-form-body">
        {isSlides ? (
          <div className={`slides-container ${isIntroSlide ? "is-intro" : ""}`}>
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeStep}
                custom={direction}
                initial={{ y: direction > 0 ? 40 : -40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: direction > 0 ? -40 : 40, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="slides-question-wrapper"
              >
                {isIntroSlide ? (
                  <TypeformIntroSlide schema={activeSchema} requiredCount={requiredCount} totalFields={totalFields} />
                ) : currentField ? (
                  <TypeformField
                    field={currentField}
                    value={values[currentField.id]}
                    file={files[currentField.id]}
                    error={errors[currentField.id]}
                    onValue={(value) => {
                      setValues((current) => ({ ...current, [currentField.id]: value }));
                      setErrors((prev) => ({ ...prev, [currentField.id]: "" }));
                    }}
                    onFile={(file) => setFiles((current) => ({ ...current, [currentField.id]: file }))}
                    onClearFile={() =>
                      setFiles((current) => {
                        const next = { ...current };
                        delete next[currentField.id];
                        return next;
                      })
                    }
                    index={activeStep - 1}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>

            <div className="typeform-nav">
              {activeStep < totalSlides - 1 ? (
                <button className="typeform-ok" onClick={handleNext}>
                  {isIntroSlide ? "Start" : "OK"}
                </button>
              ) : (
                <button className="typeform-ok submit" onClick={handleSubmit} disabled={busy}>
                  {busy ? <Loader2 size={18} className="spin" /> : "Submit"}
                </button>
              )}
              {activeStep < totalSlides - 1 && (
                <span className="typeform-hint">
                  press <kbd>Enter</kbd> ↵
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="list-container">
            <div className="list-scroll-spacer list-scroll-spacer--top" aria-hidden="true" />
            {activeSchema.fields.map((field, index) => (
              <div key={field.id} id={`q-${field.id}`} className="typeform-question">
                <TypeformField
                  field={field}
                  value={values[field.id]}
                  file={files[field.id]}
                  error={errors[field.id]}
                  onValue={(value) => {
                    setValues((current) => ({ ...current, [field.id]: value }));
                    setErrors((prev) => ({ ...prev, [field.id]: "" }));
                  }}
                  onFile={(file) => setFiles((current) => ({ ...current, [field.id]: file }))}
                  onClearFile={() =>
                    setFiles((current) => {
                      const next = { ...current };
                      delete next[field.id];
                      return next;
                    })
                  }
                  index={index}
                />
              </div>
            ))}
            <div className="typeform-list-submit">
              <button className="typeform-ok submit" onClick={handleSubmit} disabled={busy}>
                {busy ? <Loader2 size={18} className="spin" /> : "Submit"}
              </button>
            </div>
            <div className="list-scroll-spacer list-scroll-spacer--bottom" aria-hidden="true" />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="public-form-footer">
        <a
          className="github-pill"
          href="https://github.com/ankushKun/tuskd"
          target="_blank"
          rel="noreferrer"
          aria-label="View TuskD on GitHub"
        >
          <Github size={12} strokeWidth={2.5} />
          <span>GitHub</span>
        </a>
        <button
          className="walrus-pill"
          onClick={() => navigate("/")}
        >
          <TuskDMark className="pill-brand-mark" />
          <span className="walrus-pill-label">Powered by TuskD</span>
        </button>
      </footer>
    </div>
  );
}

function TypeformIntroSlide({ schema, totalFields, requiredCount }: { schema: FormSchema; totalFields: number; requiredCount: number }) {
  const description = schema.description.trim();

  return (
    <section className="typeform-intro-slide" aria-labelledby="public-form-title">
      <h1 id="public-form-title">{schema.title || "Untitled form"}</h1>
      {description ? <p>{description}</p> : null}
      <div className="typeform-intro-meta">
        <span>{totalFields} question{totalFields === 1 ? "" : "s"}</span>
        {requiredCount > 0 && <span>{requiredCount} required</span>}
      </div>
    </section>
  );
}

function PublicFormSuccess({ receipt }: { receipt: Submission }) {
  return (
    <section className="public-success-page">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className="typeform-success"
      >
        <div className="typeform-success-icon">
          <Check size={40} strokeWidth={2.5} />
        </div>
        <h1>Thank you!</h1>
        <p>Your response has been recorded on Walrus.</p>
        <div className="typeform-success-actions">
          <button className="typeform-ok" onClick={() => window.location.reload()}>
            Submit another
          </button>
        </div>
        <div className="typeform-success-proof">
          <span>Blob: {receipt.submissionBlob.id.slice(0, 20)}...</span>
          {receipt.txDigest && <a href={testnetTxUrl(receipt.txDigest)} target="_blank" rel="noreferrer">View tx ↗</a>}
        </div>
      </motion.div>
    </section>
  );
}

function TypeformField({
  field,
  value,
  file,
  error,
  onValue,
  onFile,
  onClearFile,
  index,
}: {
  field: Field;
  value: string | string[] | number | undefined;
  file?: File;
  error?: string;
  onValue: (value: string | string[] | number) => void;
  onFile: (file: File) => void;
  onClearFile: () => void;
  index?: number;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const dropdownRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownPos = useDropdownPosition(dropdownRef, dropdownOpen);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = dropdownRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setDropdownOpen(false);
    }
    if (dropdownOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsFileDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }

  return (
    <div className={`typeform-field ${error ? "has-error" : ""}`}>
      <div className="typeform-question-header">
        <span className="typeform-number">{((index ?? 0) + 1).toString().padStart(2, "0")}</span>
        <h2 className="typeform-question-title">
          {field.label || "Untitled Question"}
          {field.required && <span className="typeform-required">*</span>}
        </h2>
      </div>
      {field.helper ? <p className="typeform-helper">{field.helper}</p> : null}

      <div className="typeform-input-area">
        {field.type === "shortText" && (
          <input className="typeform-input" type="text" value={String(value ?? "")} onChange={(e) => onValue(e.target.value)} placeholder="Type your answer here..." />
        )}

        {field.type === "richText" && (
          <AutoResizeTextarea value={String(value ?? "")} onChange={(v) => onValue(v)} placeholder="Type your answer here..." />
        )}

        {field.type === "url" && (
          <input className="typeform-input" type="url" value={String(value ?? "")} onChange={(e) => onValue(e.target.value)} placeholder="https://" />
        )}

        {field.type === "dropdown" && (
          <div className="typeform-dropdown">
            <button ref={dropdownRef} className={`typeform-dropdown-trigger ${!value ? "placeholder" : ""}`} onClick={() => setDropdownOpen(!dropdownOpen)}>
              {String(value || "Choose an option")}
              <ChevronDown size={18} style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", marginLeft: "auto" }} />
            </button>
            <AnimatePresence>
              {dropdownOpen && (
                <DropdownPortal>
                  <motion.div
                    ref={menuRef}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="typeform-dropdown-menu"
                    style={{ position: "absolute", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
                  >
                    {field.options?.map((option) => (
                      <button key={option} className={value === option ? "active" : ""} onClick={() => { onValue(option); setDropdownOpen(false); }}>
                        {option}
                      </button>
                    ))}
                  </motion.div>
                </DropdownPortal>
              )}
            </AnimatePresence>
          </div>
        )}

        {field.type === "checkboxes" && (
          <div className="typeform-checkboxes">
            {field.options?.map((option) => {
              const checked = Array.isArray(value) && value.includes(option);
              return (
                <label key={option} className={`typeform-checkbox ${checked ? "checked" : ""}`}>
                  <input type="checkbox" checked={checked} onChange={(e) => {
                    const current = Array.isArray(value) ? value : [];
                    onValue(e.target.checked ? [...current, option] : current.filter((item) => item !== option));
                  }} />
                  <span className="typeform-checkbox-box">{checked && <Check size={14} strokeWidth={3} />}</span>
                  <span className="typeform-checkbox-label">{option}</span>
                </label>
              );
            })}
          </div>
        )}

        {field.type === "rating" && (
          <div className="typeform-rating">
            {[1, 2, 3, 4, 5].map((star) => {
              const isActive = (hoverRating || Number(value || 0)) >= star;
              return (
                <button key={star} type="button" onClick={() => onValue(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} className={isActive ? "active" : ""} aria-label={`Rate ${star} out of 5`}>
                  <Star size={36} fill={isActive ? "currentColor" : "none"} strokeWidth={1.5} />
                </button>
              );
            })}
          </div>
        )}

        {(field.type === "image" || field.type === "video") && (
          <div className="typeform-file">
            {!file ? (
              <div className={`typeform-drop-zone ${isFileDragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setIsFileDragging(true); }} onDragLeave={() => setIsFileDragging(false)} onDrop={handleFileDrop} onClick={() => fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" accept={field.type === "image" ? "image/*" : "video/*"} style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                <Upload size={28} />
                <span>Drop {field.type === "image" ? "image" : "video"} here or click to browse</span>
              </div>
            ) : (
              <div className="typeform-file-pill">
                {field.type === "image" ? <Image size={16} /> : <FileVideo size={16} />}
                <span>{file.name}</span>
                <small>{formatFileSize(file.size)}</small>
                <button type="button" onClick={(e) => { e.preventDefault(); onClearFile(); }} aria-label="Clear selected file"><X size={14} /></button>
              </div>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }} className="typeform-error">
            <AlertCircle size={14} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AutoResizeTextarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, [value]);
  return (
    <textarea ref={ref} className="response-textarea" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={1} />
  );
}

function Dashboard({ formId, navigate }: { formId: string; navigate: (path: string) => void }) {
  const initialForm = getForm(formId);
  const [form, setForm] = useState<StoredForm | null>(() => initialForm);
  const [loadingForm, setLoadingForm] = useState(() => !initialForm && !isLocalFormId(formId));
  const [loadError, setLoadError] = useState("");
  const [submissions, setSubmissions] = useState(() => (initialForm ? getStoredSubmissionsForForm(initialForm) : getSubmissions(formId)));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [viewType, setViewType] = useState<"grid" | "table">("table");
  const [pendingReviewPatches, setPendingReviewPatches] = useState<Record<string, SubmissionReviewPatch>>({});
  const [savingReviewChanges, setSavingReviewChanges] = useState(false);
  const [syncingSubmissions, setSyncingSubmissions] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const statusRef = useRef<HTMLButtonElement>(null);
  const priorityRef = useRef<HTMLButtonElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const statusPos = useDropdownPosition(statusRef, statusOpen);
  const priorityPos = useDropdownPosition(priorityRef, priorityOpen);
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const signAndExecute = useSignAndExecuteTransaction();
  const { ensureTestnetWallet } = useTestnetWalletGuard();

  useEffect(() => {
    let cancelled = false;
    const current = getForm(formId);
    if (current) {
      setForm(current);
      setSubmissions(getStoredSubmissionsForForm(current));
      setLoadingForm(false);
      setLoadError("");
      return;
    }

    const currentByObjectId = getForms().find((item) => item.suiObjectId?.toLowerCase() === formId.toLowerCase());
    if (currentByObjectId) {
      setForm(currentByObjectId);
      setSubmissions(getStoredSubmissionsForForm(currentByObjectId));
      setLoadingForm(false);
      setLoadError("");
      return;
    }

    if (isLocalFormId(formId)) {
      setForm(null);
      setSubmissions([]);
      setLoadingForm(false);
      setLoadError("");
      return;
    }

    async function loadRemoteForm() {
      setLoadingForm(true);
      setLoadError("");
      try {
        const remoteForm = await fetchPublishedFormFromSui(formId, suiClient);
        if (cancelled) return;
        saveForm(remoteForm);
        setForm(remoteForm);
        setSubmissions(getStoredSubmissionsForForm(remoteForm));
      } catch (error) {
        if (!cancelled) {
          setForm(null);
          setSubmissions([]);
          setLoadError(error instanceof Error ? error.message : "Unable to load this form from Sui.");
        }
      } finally {
        if (!cancelled) setLoadingForm(false);
      }
    }

    loadRemoteForm();
    return () => {
      cancelled = true;
    };
  }, [formId, suiClient]);

  useEffect(() => {
    if (!form || form.status !== "published" || !formObjectId(form) || !canAdministerForm(form, account?.address)) return;
    const activeForm = form;
    let cancelled = false;

    async function syncSubmissions() {
      setSyncingSubmissions(true);
      try {
        const remoteSubmissions = await fetchSubmissionsForFormFromSui(activeForm, suiClient);
        if (cancelled) return;
        for (const submission of remoteSubmissions) {
          saveSubmission(submission);
        }
        setSubmissions(getStoredSubmissionsForForm(activeForm));
      } catch {
        if (!cancelled) toast.error("Unable to sync responses from Sui right now.");
      } finally {
        if (!cancelled) setSyncingSubmissions(false);
      }
    }

    syncSubmissions();
    return () => {
      cancelled = true;
    };
  }, [account?.address, form?.id, form?.suiObjectId, form?.status, suiClient]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (statusRef.current && !statusRef.current.contains(target) && statusMenuRef.current && !statusMenuRef.current.contains(target)) setStatusOpen(false);
      if (priorityRef.current && !priorityRef.current.contains(target) && priorityMenuRef.current && !priorityMenuRef.current.contains(target)) setPriorityOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const displaySubmissions = useMemo(
    () => submissions.map((submission) => ({ ...submission, ...(pendingReviewPatches[submission.id] ?? {}) })),
    [pendingReviewPatches, submissions],
  );

  const pendingReviewUpdates = useMemo<PendingSubmissionUpdate[]>(() => {
    return submissions.flatMap((submission) => {
      const patch = pendingReviewPatches[submission.id];
      if (!patch) return [];
      const next = { ...submission, ...patch };
      if (next.status === submission.status && next.priority === submission.priority) return [];
      return [{ original: submission, next }];
    });
  }, [pendingReviewPatches, submissions]);

  const filtered = useMemo(() => {
    return submissions.filter((submission) => {
      const haystack = JSON.stringify(submission.values).toLowerCase();
      return (
        (status === "all" || submission.status === status) &&
        (priority === "all" || submission.priority === priority) &&
        haystack.includes(query.toLowerCase())
      );
    }).map((submission) => ({ ...submission, ...(pendingReviewPatches[submission.id] ?? {}) }));
  }, [pendingReviewPatches, priority, query, status, submissions]);

  const activeFilterCount = Number(Boolean(query.trim())) + Number(status !== "all") + Number(priority !== "all");

  const stats = useMemo(() => {
    const total = displaySubmissions.length;
    const newCount = displaySubmissions.filter((s) => s.status === "new").length;
    const reviewed = displaySubmissions.filter((s) => s.status === "reviewed" || s.status === "prioritized").length;
    const withMedia = displaySubmissions.filter((s) => Object.keys(s.media).length > 0).length;
    return { total, newCount, reviewed, withMedia };
  }, [displaySubmissions]);

  if (loadingForm) {
    return (
      <section className="center-state">
        <Loader2 size={28} className="spin" />
        <h1>Loading responses</h1>
        <p className="muted">Fetching the form and response events from Sui.</p>
      </section>
    );
  }

  if (!form) {
    return (
      <section className="center-state">
        <h1>No form found</h1>
        {loadError && <p className="muted">{loadError}</p>}
        <button className="primary" onClick={() => navigate("/forms")}>Back to workspace</button>
      </section>
    );
  }

  const activeForm = form;
  const adminSchema = activeForm.schema ?? activeForm.draftSchema;
  const canReview = canAdministerForm(activeForm, account?.address);
  const canWriteReview = canReview && (TESTNET_CONFIG.onchainAdmins || activeForm.owner.toLowerCase() === account?.address?.toLowerCase());
  const hasArchivedAnswers = submissions.some((submission) => archivedAnswerFields(activeForm, adminSchema, submission).length > 0);

  if (!account?.address) {
    return (
      <section className="center-state">
        <Wallet size={28} />
        <h1>Connect admin wallet</h1>
        <p className="muted">Connect the owner or an assigned admin wallet to review this form.</p>
        <button className="primary" onClick={() => navigate("/forms")}>Back to workspace</button>
      </section>
    );
  }

  if (!canReview) {
    return (
      <section className="center-state">
        <Lock size={28} />
        <h1>No admin access</h1>
        <p className="muted">This wallet is not the owner or an assigned admin for this form.</p>
        <button className="primary" onClick={() => navigate("/forms")}>Back to workspace</button>
      </section>
    );
  }

  if (activeForm.status !== "published" || !activeForm.schema) {
    return (
      <section className="center-state">
        <h1>This form is still a draft</h1>
        <p className="muted">Publish it before reviewing responses.</p>
        <button className="primary" onClick={() => navigate(`/builder/${activeForm.id}`)}>Open builder</button>
      </section>
    );
  }

  function queueReviewPatch(submissionId: string, patch: SubmissionReviewPatch) {
    const original = submissions.find((submission) => submission.id === submissionId);
    if (!original) return;

    setPendingReviewPatches((current) => {
      const nextPatch = { ...(current[submissionId] ?? {}), ...patch };
      const normalized: SubmissionReviewPatch = {};
      if (nextPatch.status && nextPatch.status !== original.status) normalized.status = nextPatch.status;
      if (nextPatch.priority && nextPatch.priority !== original.priority) normalized.priority = nextPatch.priority;

      const next = { ...current };
      if (normalized.status || normalized.priority) {
        next[submissionId] = normalized;
      } else {
        delete next[submissionId];
      }
      return next;
    });
  }

  function cancelReviewChanges() {
    setPendingReviewPatches({});
  }

  async function saveReviewChanges() {
    if (!account?.address) {
      toast.error("Connect the form owner or an admin wallet to update response status.");
      return;
    }
    if (!canAdministerForm(activeForm, account.address)) {
      toast.error("This wallet is not listed as a form admin.");
      return;
    }
    if (!TESTNET_CONFIG.onchainAdmins && activeForm.owner.toLowerCase() !== account.address.toLowerCase()) {
      toast.error("Admin review updates need the upgraded on-chain admin package. This wallet can view responses, but only the owner can save status changes on the current package.");
      return;
    }
    if (!pendingReviewUpdates.length) return;
    if (!activeForm.suiObjectId) {
      toast.error("This form is missing its Sui object ID and cannot update responses on testnet.");
      return;
    }
    if (pendingReviewUpdates.some(({ original }) => !original.chainSubmissionId)) {
      toast.error("Some changed responses are missing Sui on-chain IDs and cannot be updated on testnet.");
      return;
    }
    setSavingReviewChanges(true);
    try {
      const canUseWallet = await ensureTestnetWallet();
      if (!canUseWallet) return;
      const tx = new Transaction();
      for (const { original, next } of pendingReviewUpdates) {
        tx.moveCall({
          target: contractTarget("set_submission_status"),
          arguments: [
            tx.object(activeForm.suiObjectId),
            tx.pure.u64(original.chainSubmissionId!),
            tx.pure.u8(statusCode[next.status]),
            tx.pure.u8(priorityCode[next.priority]),
          ],
        });
      }
      await signAndExecute.mutateAsync({ transaction: tx, chain: SUI_TESTNET_CHAIN });
      for (const { next } of pendingReviewUpdates) {
        updateSubmission(next);
      }
      setSubmissions(getStoredSubmissionsForForm(activeForm));
      setPendingReviewPatches({});
      toast.success(`${pendingReviewUpdates.length} response${pendingReviewUpdates.length === 1 ? "" : "s"} updated on Sui Testnet`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to save response updates on Sui Testnet.";
      toast.error(msg);
    } finally {
      setSavingReviewChanges(false);
    }
  }

  function exportCsv() {
    const fields = adminSchema.fields;
    const archivedFields = archivedFieldsForSubmissions(activeForm, adminSchema, filtered);
    const headers = [
      "submission_id", "created_at", "status", "priority", "submitter", "submission_blob", "tx_digest",
      ...fields.map((field) => field.label),
      ...archivedFields.map((field) => `[Archived] ${field.label}`),
    ];
    const rows = filtered.map((submission) =>
      [
        submission.id, submission.createdAt, submission.status, submission.priority,
        submission.submitter, submission.submissionBlob.id, submission.txDigest ?? "",
        ...fields.map((field) => formatValue(submission.values[field.id])),
        ...archivedFields.map((field) => formatValue(submission.values[field.id])),
      ].map(csvCell),
    );
    const csv = [headers.map(csvCell), ...rows].map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${adminSchema.title.replace(/\W+/g, "-").toLowerCase()}-submissions.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <button className="back-btn" onClick={() => navigate("/forms")} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="dashboard-title-group">
          <h1>{adminSchema.title}</h1>
          <p className="muted">
            {syncingSubmissions ? (
              "Syncing responses..."
            ) : (
              <>
                {submissions.length} submission{submissions.length === 1 ? "" : "s"} &middot; {adminSchema.fields.length} question{adminSchema.fields.length === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <button className="secondary" onClick={() => navigate(publicFormPath(activeForm))}>
            <ExternalLink size={15} /> Public form
          </button>
          <button className="primary" onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      <div className="dashboard-stats">
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon"><Inbox size={18} /></div>
          <div>
            <div className="dashboard-stat-value">{stats.total}</div>
            <div className="dashboard-stat-label">Total</div>
          </div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon new"><Sparkles size={18} /></div>
          <div>
            <div className="dashboard-stat-value">{stats.newCount}</div>
            <div className="dashboard-stat-label">New</div>
          </div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon reviewed"><Check size={18} /></div>
          <div>
            <div className="dashboard-stat-value">{stats.reviewed}</div>
            <div className="dashboard-stat-label">Reviewed</div>
          </div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon media"><Image size={18} /></div>
          <div>
            <div className="dashboard-stat-value">{stats.withMedia}</div>
            <div className="dashboard-stat-label">With media</div>
          </div>
        </div>
      </div>

      <div className="dashboard-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Search responses..." value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="search-clear" onClick={() => setQuery("")}><X size={14} /></button>}
        </div>

        <div className="dashboard-filters">
          <div className="filter-dropdown">
            <button ref={statusRef} className="filter-dropdown-trigger" onClick={() => setStatusOpen(!statusOpen)}>
              <Filter size={14} /> Status: <strong>{status === "all" ? "All" : status}</strong>
              <ChevronDown size={14} style={{ marginLeft: "auto", transform: statusOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
            </button>
            <AnimatePresence>
              {statusOpen && (
                <DropdownPortal>
                  <motion.div
                    ref={statusMenuRef}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="filter-dropdown-menu"
                    style={{ position: "absolute", top: statusPos.top, left: statusPos.left }}
                  >
                    {["all", "new", "reviewed", "prioritized", "archived"].map((s) => (
                      <button key={s} className={status === s ? "active" : ""} onClick={() => { setStatus(s); setStatusOpen(false); }}>
                        {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </motion.div>
                </DropdownPortal>
              )}
            </AnimatePresence>
          </div>

          <div className="filter-dropdown">
            <button ref={priorityRef} className="filter-dropdown-trigger" onClick={() => setPriorityOpen(!priorityOpen)}>
              <TrendingUp size={14} /> Priority: <strong>{priority === "all" ? "All" : priority}</strong>
              <ChevronDown size={14} style={{ marginLeft: "auto", transform: priorityOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
            </button>
            <AnimatePresence>
              {priorityOpen && (
                <DropdownPortal>
                  <motion.div
                    ref={priorityMenuRef}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="filter-dropdown-menu"
                    style={{ position: "absolute", top: priorityPos.top, left: priorityPos.left }}
                  >
                   {["all", "low", "medium", "high"].map((p) => (
                    <button key={p} className={priority === p ? "active" : ""} onClick={() => { setPriority(p); setPriorityOpen(false); }}>
                      {p === "all" ? "All priorities" : p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                  </motion.div>
                </DropdownPortal>
              )}
            </AnimatePresence>
          </div>

          {activeFilterCount > 0 && (
            <button className="filter-clear" onClick={() => { setQuery(""); setStatus("all"); setPriority("all"); }}>
              <X size={14} /> Clear
            </button>
          )}
        </div>

        <div className="view-toggle">
          <button className={viewType === "table" ? "active" : ""} onClick={() => setViewType("table")} aria-label="Table view">
            <Columns3 size={16} />
          </button>
          <button className={viewType === "grid" ? "active" : ""} onClick={() => setViewType("grid")} aria-label="Grid view">
            <LayoutList size={16} />
          </button>
        </div>
      </div>

      {pendingReviewUpdates.length > 0 && (
        <div className="dashboard-review-bar">
          <div>
            <strong>{pendingReviewUpdates.length} unsaved response update{pendingReviewUpdates.length === 1 ? "" : "s"}</strong>
            <span>Save to write all status and priority changes in one Sui transaction.</span>
          </div>
          <div className="dashboard-review-actions">
            <button className="secondary" onClick={cancelReviewChanges} disabled={savingReviewChanges}>
              Cancel
            </button>
            <button className="primary" onClick={saveReviewChanges} disabled={savingReviewChanges || !canWriteReview}>
              {savingReviewChanges ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              Save changes
            </button>
          </div>
        </div>
      )}

      {!submissions.length ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="empty-state">
          <div className="empty-state-icon"><MessageSquareText size={32} /></div>
          <h2>No submissions yet</h2>
          <p>Open the public form and send a test response.</p>
          <button className="primary" onClick={() => navigate(publicFormPath(activeForm))}>
            <ExternalLink size={16} /> Open public form
          </button>
        </motion.div>
      ) : submissions.length > 0 && !filtered.length ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="empty-state">
          <div className="empty-state-icon"><AlertCircle size={32} /></div>
          <h2>No matching submissions</h2>
          <p>Clear filters or adjust your search query.</p>
          <button className="secondary" onClick={() => { setQuery(""); setStatus("all"); setPriority("all"); }}>
            <X size={16} /> Clear filters
          </button>
        </motion.div>
      ) : viewType === "table" ? (
        <div className="submission-table-container">
          <table className="submission-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Priority</th>
                {adminSchema.fields.slice(0, 4).map((field) => (
                  <th key={field.id}>{field.label}</th>
                ))}
                {adminSchema.fields.length > 4 && <th>...</th>}
                {hasArchivedAnswers && <th>Archived</th>}
                <th>Media</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((submission) => {
                const archivedAnswers = archivedAnswerFields(activeForm, adminSchema, submission);
                return (
                  <tr key={submission.id}>
                    <td>
                      <div className="cell-date">{new Date(submission.createdAt).toLocaleDateString()}</div>
                      <div className="cell-time">{new Date(submission.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </td>
                    <td>
                      <StatusBadge value={submission.status} pending={Boolean(pendingReviewPatches[submission.id]?.status)} disabled={savingReviewChanges || !canWriteReview} onChange={(v) => queueReviewPatch(submission.id, { status: v as Submission["status"] })} />
                    </td>
                    <td>
                      <PriorityBadge value={submission.priority} pending={Boolean(pendingReviewPatches[submission.id]?.priority)} disabled={savingReviewChanges || !canWriteReview} onChange={(v) => queueReviewPatch(submission.id, { priority: v as Submission["priority"] })} />
                    </td>
                    {adminSchema.fields.slice(0, 4).map((field) => (
                      <td key={field.id}>
                        <span className="cell-value" title={formatValue(submission.values[field.id])}>
                          {formatValue(submission.values[field.id]) || "-"}
                        </span>
                      </td>
                    ))}
                    {adminSchema.fields.length > 4 && <td className="cell-muted">+{adminSchema.fields.length - 4}</td>}
                    {hasArchivedAnswers && (
                      <td>
                        {archivedAnswers.length > 0 ? (
                          <span className="archived-answer-count">{archivedAnswers.length} hidden</span>
                        ) : (
                          <span className="cell-muted">-</span>
                        )}
                      </td>
                    )}
                    <td>
                      {Object.values(submission.media).length > 0 ? (
                        <span className="media-badge">{Object.values(submission.media).length} file{Object.values(submission.media).length === 1 ? "" : "s"}</span>
                      ) : (
                        <span className="cell-muted">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="submission-grid">
          {filtered.map((submission) => {
            const archivedAnswers = archivedAnswerFields(activeForm, adminSchema, submission);
            return (
              <article className="submission-card" key={submission.id}>
                <div className="submission-card-header">
                  <div className="submission-card-date">
                    <Calendar size={14} />
                    {new Date(submission.createdAt).toLocaleString()}
                  </div>
                  <div className="submission-card-badges">
                    <StatusBadge value={submission.status} pending={Boolean(pendingReviewPatches[submission.id]?.status)} disabled={savingReviewChanges || !canWriteReview} onChange={(v) => queueReviewPatch(submission.id, { status: v as Submission["status"] })} />
                    <PriorityBadge value={submission.priority} pending={Boolean(pendingReviewPatches[submission.id]?.priority)} disabled={savingReviewChanges || !canWriteReview} onChange={(v) => queueReviewPatch(submission.id, { priority: v as Submission["priority"] })} />
                  </div>
                </div>
                <div className="submission-card-body">
                  {adminSchema.fields.map((field) => (
                    <div key={field.id} className="submission-answer">
                      <span className="submission-answer-label">{field.label}</span>
                      <span className="submission-answer-value">{formatValue(submission.values[field.id]) || "-"}</span>
                    </div>
                  ))}
                </div>
                {archivedAnswers.length > 0 && (
                  <div className="archived-answers">
                    <div className="archived-answers-title">Archived answers</div>
                    {archivedAnswers.map((field) => (
                      <div key={field.id} className="submission-answer archived">
                        <span className="submission-answer-label">{field.label}</span>
                        <span className="submission-answer-value">{formatValue(submission.values[field.id]) || "-"}</span>
                      </div>
                    ))}
                  </div>
                )}
                {Object.values(submission.media).length > 0 && (
                  <div className="submission-card-media">
                    {Object.values(submission.media).map((blob) => (
                      <a href={blob.url} target="_blank" rel="noreferrer" key={blob.id}>
                        {blob.contentType?.startsWith("image") ? <Image size={14} /> : <FileVideo size={14} />}
                        {blob.name || blob.id.slice(0, 10)}...
                      </a>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ value, pending = false, disabled = false, onChange }: { value: Submission["status"]; pending?: boolean; disabled?: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownPos = useDropdownPosition(triggerRef, open);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const config: Record<string, { label: string; class: string }> = {
    new: { label: "New", class: "status-new" },
    reviewed: { label: "Reviewed", class: "status-reviewed" },
    prioritized: { label: "Prioritized", class: "status-prioritized" },
    archived: { label: "Archived", class: "status-archived" },
  };
  const current = config[value] ?? config.new;
  return (
    <div className="badge-dropdown">
      <button ref={triggerRef} className={`badge ${current.class} ${pending ? "badge-pending" : ""}`} disabled={disabled} onClick={() => setOpen(!open)}>
        {current.label} <ChevronDown size={12} />
      </button>
      <AnimatePresence>
        {open && (
          <DropdownPortal>
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="badge-dropdown-menu"
              style={{ position: "absolute", top: dropdownPos.top, left: dropdownPos.left }}
            >
              {Object.entries(config).map(([key, cfg]) => (
                <button key={key} className={value === key ? "active" : ""} onClick={() => { onChange(key); setOpen(false); }}>
                  <span className={`dot ${cfg.class}`} /> {cfg.label}
                </button>
              ))}
            </motion.div>
          </DropdownPortal>
        )}
      </AnimatePresence>
    </div>
  );
}

function PriorityBadge({ value, pending = false, disabled = false, onChange }: { value: Submission["priority"]; pending?: boolean; disabled?: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownPos = useDropdownPosition(triggerRef, open);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const config: Record<string, { label: string; class: string }> = {
    low: { label: "Low", class: "priority-low" },
    medium: { label: "Medium", class: "priority-medium" },
    high: { label: "High", class: "priority-high" },
  };
  const current = config[value] ?? config.medium;
  return (
    <div className="badge-dropdown">
      <button ref={triggerRef} className={`badge ${current.class} ${pending ? "badge-pending" : ""}`} disabled={disabled} onClick={() => setOpen(!open)}>
        {current.label} <ChevronDown size={12} />
      </button>
      <AnimatePresence>
        {open && (
          <DropdownPortal>
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="badge-dropdown-menu"
              style={{ position: "absolute", top: dropdownPos.top, left: dropdownPos.left }}
            >
              {Object.entries(config).map(([key, cfg]) => (
                <button key={key} className={value === key ? "active" : ""} onClick={() => { onChange(key); setOpen(false); }}>
                  <span className={`dot ${cfg.class}`} /> {cfg.label}
                </button>
              ))}
            </motion.div>
          </DropdownPortal>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatValue(value: Submission["values"][string] | undefined) {
  if (!value) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object" && "id" in value) return value.id;
  return String(value);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function copy(value: string) {
  navigator.clipboard?.writeText(value);
}

export default App;
