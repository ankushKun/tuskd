import type { AppStore, BlobReceipt, Field, FormSchema, PublishedForm, StoredForm, Submission } from "./types";
import { TESTNET_CONFIG } from "./config";

const STORE_KEY = "tuskd:v2";
const LEGACY_STORE_KEY = `${"tusk"}table:v1`;

const publisher = TESTNET_CONFIG.walrusPublisher;
const aggregator = TESTNET_CONFIG.walrusAggregator;
const epochs = TESTNET_CONFIG.walrusEpochs;
export const WALRUS_SESSION_SAMPLE_ADMIN = "0xc4d6ee019649edba41d5a5ed1081fe3c86afc41fea413195dd6ecdd0f6090e54";

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

export function readStore(): AppStore {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return { forms: [], submissions: [] };
  try {
    return migrateStore(JSON.parse(raw));
  } catch {
    return { forms: [], submissions: [] };
  }
}

export function writeStore(store: AppStore) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  localStorage.removeItem(LEGACY_STORE_KEY);
}

export function saveForm(form: StoredForm) {
  const store = readStore();
  writeStore({ ...store, forms: [form, ...store.forms.filter((item) => item.id !== form.id)] });
}

export function getForms() {
  return readStore().forms.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createDraftForm(schema: FormSchema | undefined, owner: string) {
  const now = new Date().toISOString();
  const draftSchema = schema ?? createDefaultSchema();
  const form: StoredForm = {
    id: id("form"),
    owner,
    admins: normalizeAdminAddresses(draftSchema.admins),
    network: "sui-testnet",
    status: "draft",
    draftSchema,
    createdAt: now,
    updatedAt: now,
  };
  saveForm(form);
  return form;
}

export function saveDraftForm(formId: string, schema: FormSchema, owner: string) {
  const store = readStore();
  const existing = store.forms.find((form) => form.id === formId);
  const now = new Date().toISOString();
  const form: StoredForm = existing
    ? { ...existing, draftSchema: schema, updatedAt: now }
    : {
        id: formId,
        owner,
        admins: normalizeAdminAddresses(schema.admins),
        network: "sui-testnet",
        status: "draft",
        draftSchema: schema,
        createdAt: now,
        updatedAt: now,
      };
  writeStore({ ...store, forms: [form, ...store.forms.filter((item) => item.id !== formId)] });
  return form;
}

export function deleteForm(formId: string) {
  const store = readStore();
  writeStore({
    ...store,
    forms: store.forms.filter((form) => form.id !== formId),
    submissions: store.submissions.filter((sub) => sub.formId !== formId)
  });
}

export function publishStoredForm(formId: string, schema: FormSchema, schemaBlob: BlobReceipt, owner: string, txDigest: string, suiObjectId: string) {
  const store = readStore();
  const existing = store.forms.find((form) => form.id === formId);
  const now = new Date().toISOString();
  const archivedFields = mergeArchivedFields(existing, schema);
  const admins = normalizeAdminAddresses(schema.admins);
  const form: StoredForm = {
    id: formId,
    owner: existing?.owner ?? owner,
    admins,
    network: "sui-testnet",
    status: "published",
    draftSchema: schema,
    schema,
    ...(archivedFields.length ? { archivedFields } : {}),
    schemaBlob,
    txDigest,
    suiObjectId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    publishedAt: existing?.publishedAt ?? now,
  };
  writeStore({ ...store, forms: [form, ...store.forms.filter((item) => item.id !== formId)] });
  return form;
}

function mergeArchivedFields(existing: StoredForm | undefined, nextSchema: FormSchema): Field[] {
  const nextIds = new Set(nextSchema.fields.map((field) => field.id));
  const candidates = [
    ...(existing?.archivedFields ?? []),
    ...(existing?.schema?.fields ?? []),
    ...(existing?.draftSchema?.fields ?? []),
  ];
  const archived = new Map<string, Field>();
  for (const field of candidates) {
    if (!nextIds.has(field.id)) archived.set(field.id, field);
  }
  return [...archived.values()];
}

export function saveSubmission(submission: Submission) {
  const store = readStore();
  writeStore({
    ...store,
    submissions: [
      submission,
      ...store.submissions.filter((item) => !isSameSubmission(item, submission)),
    ],
  });
}

export function updateSubmission(next: Submission) {
  const store = readStore();
  writeStore({
    ...store,
    submissions: store.submissions.map((item) => (item.id === next.id ? next : item)),
  });
}

export function getForm(formId: string) {
  return readStore().forms.find((form) => form.id === formId) ?? null;
}

export function getSubmissions(formId: string, ...aliases: Array<string | undefined>) {
  const formIds = new Set([formId, ...aliases].filter(Boolean).map((value) => value!.toLowerCase()));
  return readStore().submissions.filter((submission) => formIds.has(submission.formId.toLowerCase()));
}

function isSameSubmission(a: Submission, b: Submission) {
  if (a.id === b.id) return true;
  if (a.txDigest && b.txDigest && a.txDigest === b.txDigest) return true;
  return Boolean(
    a.chainSubmissionId &&
      b.chainSubmissionId &&
      a.chainSubmissionId === b.chainSubmissionId &&
      a.formId.toLowerCase() === b.formId.toLowerCase(),
  );
}

function migrateStore(value: unknown): AppStore {
  const fallback: AppStore = { forms: [], submissions: [] };
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<AppStore>;
  const submissions = Array.isArray(raw.submissions) ? raw.submissions : [];
  const forms = Array.isArray(raw.forms) ? raw.forms.map(migrateForm).filter(Boolean) : [];
  return { forms: forms as StoredForm[], submissions };
}

function migrateForm(form: unknown): StoredForm | null {
  if (!form || typeof form !== "object") return null;
  const raw = form as Partial<StoredForm & PublishedForm>;
  if (!raw.id || !raw.owner || !raw.createdAt) return null;
  if (raw.draftSchema) {
    const admins = normalizeAdminAddresses(raw.admins ?? raw.schema?.admins ?? raw.draftSchema.admins);
    return {
      ...raw,
      admins,
      draftSchema: { ...raw.draftSchema, admins: normalizeAdminAddresses(raw.draftSchema.admins ?? admins) },
      schema: raw.schema ? { ...raw.schema, admins: normalizeAdminAddresses(raw.schema.admins ?? admins) } : undefined,
      network: "sui-testnet",
      status: raw.status ?? (raw.schemaBlob ? "published" : "draft"),
      archivedFields: Array.isArray(raw.archivedFields) ? raw.archivedFields : undefined,
      updatedAt: raw.updatedAt ?? raw.publishedAt ?? raw.createdAt,
    } as StoredForm;
  }
  if (raw.schema && raw.schemaBlob) {
    const admins = normalizeAdminAddresses(raw.admins ?? raw.schema.admins);
    return {
      id: raw.id,
      owner: raw.owner,
      admins,
      network: "sui-testnet",
      status: "published",
      draftSchema: { ...raw.schema, admins },
      schema: { ...raw.schema, admins },
      archivedFields: Array.isArray(raw.archivedFields) ? raw.archivedFields : undefined,
      schemaBlob: raw.schemaBlob,
      txDigest: raw.txDigest,
      suiObjectId: raw.suiObjectId,
      createdAt: raw.createdAt,
      updatedAt: raw.createdAt,
      publishedAt: raw.createdAt,
    };
  }
  return null;
}

export function normalizeAdminAddresses(admins: unknown): string[] {
  if (!Array.isArray(admins)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of admins) {
    if (typeof value !== "string") continue;
    const address = value.trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(address) || seen.has(address)) continue;
    seen.add(address);
    normalized.push(address);
  }
  return normalized;
}

export async function uploadJson(value: unknown, name = "payload.json"): Promise<BlobReceipt> {
  const json = JSON.stringify(value, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  return uploadBlob(blob, name, "json");
}

export async function uploadFile(file: File): Promise<BlobReceipt> {
  return uploadBlob(file, file.name, "file");
}

async function uploadBlob(blob: Blob, name: string, type: "json" | "file"): Promise<BlobReceipt> {
  try {
    const response = await fetch(`${publisher}/v1/blobs?epochs=${epochs}`, {
      method: "PUT",
      body: blob,
    });
    if (!response.ok) throw new Error(`Walrus upload failed: ${response.status}`);
    const payload = await response.json();
    const blobId =
      payload?.newlyCreated?.blobObject?.blobId ||
      payload?.newlyCreated?.blobObject?.blob_id ||
      payload?.alreadyCertified?.blobId ||
      payload?.alreadyCertified?.blob_id;
    if (!blobId) throw new Error("Walrus response did not include a blob id");
    return {
      id: blobId,
      storage: "walrus",
      network: "walrus-testnet",
      url: `${aggregator}/v1/blobs/${blobId}`,
      type,
      name,
      contentType: blob.type,
      size: blob.size,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Walrus upload failed";
    throw new Error(message);
  }
}

export async function readJsonBlob<T>(receipt: BlobReceipt): Promise<T> {
  const response = await fetch(receipt.url);
  if (!response.ok) throw new Error(`Unable to read Walrus blob ${receipt.id}`);
  return response.json() as Promise<T>;
}

export function walrusJsonReceipt(blobId: string, name = "form-schema.json"): BlobReceipt {
  return {
    id: blobId,
    storage: "walrus",
    network: "walrus-testnet",
    url: `${aggregator}/v1/blobs/${blobId}`,
    type: "json",
    name,
    contentType: "application/json",
  };
}

export function createDefaultSchema(): FormSchema {
  return {
    id: id("schema"),
    title: "Untitled Form",
    description: "Edit these starter questions, drag fields to reorder them, then publish a share link.",
    layout: "standard",
    admins: [],
    createdAt: new Date().toISOString(),
    fields: [
      {
        id: id("field"),
        type: "shortText",
        label: "Question title",
        helper: "Replace this with the first thing you want to ask.",
        required: true,
      },
      {
        id: id("field"),
        type: "dropdown",
        label: "Pick a category",
        helper: "Edit these options in the field settings panel.",
        required: false,
        options: ["Option A", "Option B", "Option C"],
      },
      {
        id: id("field"),
        type: "richText",
        label: "Add more detail",
        helper: "Use this for a longer answer, explanation, or notes.",
        required: true,
      },
    ],
  };
}

export function createWalrusSessionSampleSchema(): FormSchema {
  return {
    id: id("schema"),
    title: "Walrus Session 2 - Form tooling",
    description: "Fill out the Walrus Session 2 - Form tooling application.",
    layout: "standard",
    admins: [WALRUS_SESSION_SAMPLE_ADMIN],
    createdAt: new Date().toISOString(),
    fields: [
      field("fldNgQ4vgW7FtnLei", "shortText", "Project name", "", true),
      field("fldQ7HkGaGUg0eyn4", "dropdown", "Please select the session", "", true, ["Session 2: Form Tooling"]),
      field("fldQumQ0aaLc7v86I", "shortText", "Team Leader Name", "", true),
      field("fld8vx3QY2sUNaihf", "shortText", "Team Leader Email", "", true),
      field("fldLiM8WZskw0u9L7", "checkboxes", "Check this if you would be open to receiving our newsletter", "", false, ["Yes"]),
      field("fldPb8gCHfIfZMhtn", "shortText", "Team Leader Telegram Handle", "", false),
      field("fldFEtzHfEYcRNLFA", "shortText", "Discord handle", "Make sure to join our discord since it is required and it is a way for us to contact you.\nhttps://discord.gg/walrusprotocol", true),
      field("fldDEZGtdJbGov4NL", "shortText", "Country", "", true),
      field("fld3AMm0M0jMyx95e", "url", "DeepSurge project Link", "Needs to be on mainnet", true),
      field("fldBBJ9CVyTcGLJdl", "url", "Form Link", "", true),
      field("fld897Rgcf7bl9Mqd", "checkboxes", `I confirm that I have submitted at least one feedback entry through the form tool I built, which includes the same fields as this form. Please make ${WALRUS_SESSION_SAMPLE_ADMIN} an admin so it can review the application and add other admins.`, "", true, ["I confirm"]),
      field("fld9ITDS8n644COvQ", "richText", "Please describe the workflow and functionalities of your forms", "E.g.\nAdmin flow-create a form, update form, review replies\nUser flow: Submit a form", true),
      field("fldKFXg64aqJZmJ66", "image", "Share any visuals of your form", "You can upload screenshots, designs, workflow", true),
      field("fldkJyB5wZAHTPhKg", "video", "Demo video of the form (sub 3 minutes)", "", true),
      field("fldZcT09tMsk7sWmG", "richText", "Which features sets your solution a part from the rest?", "", true),
      field("fldVCj9RUsihWAgEN", "richText", "Feedback (about building on Walrus)", "This can include but not limited to:\n- What worked well\n- Any challenges you encountered (e.g. documentation, tooling, infrastructure)\n- Missing features or functionalities you would like to see\n- Issues with access (e.g. testnet tokens, setup, onboarding)\n- Suggestions for improving the developer experience", true),
      field("fldaybjenhnCbA5f3", "url", "X account", "By providing your account, you agree that we may tag you in the winner announcement.", false),
      field("fldOYpvy52Hw103cD", "url", "Share link to X tweet", "", true),
      field("fldce0TqgZEaH8jXt", "shortText", "SUI address", "", true),
      field("fldL4gISlbwdJb6A4", "richText", "GitHub", "Paste a link to your GitHub profiles and relevant repositories.", true),
      field("flddlfWzmS6u89jy7", "richText", "Session Feedback", "Share any thoughts on the sessions, what worked, what didn't, or what could be improved.\nThis feedback is only used to improve future sessions and has no impact on rewards or participation.", false),
      field("fldlwH5LI29V1UIam", "richText", "DeepSurge Feedback", "Share any thoughts on DeepSurge, what worked, what didn't, or what could be improved.\nThis feedback is only used to improve future DeepSurge and has no impact on rewards or participation.", false),
      field("fld66i1q8EW7f6uMY", "checkboxes", "I confirm that I have read, understood, and agree to the rules and regulations of the session.", "https://thewalrussessions.wal.app/", true, ["I agree"]),
    ],
  };
}

function field(idValue: string, type: Field["type"], label: string, helper: string, required: boolean, options?: string[]): Field {
  return {
    id: idValue,
    type,
    label,
    helper,
    required,
    ...(options ? { options } : {}),
  };
}
