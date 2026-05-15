import type { AppStore, BlobReceipt, FormSchema, PublishedForm, StoredForm, Submission } from "./types";
import { TESTNET_CONFIG } from "./config";

const STORE_KEY = "tusktable:v1";
const LOCAL_BLOB_PREFIX = "tusk-local";

const publisher = TESTNET_CONFIG.walrusPublisher;
const aggregator = TESTNET_CONFIG.walrusAggregator;
const epochs = TESTNET_CONFIG.walrusEpochs;

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

export function digest() {
  const chars = "0123456789abcdef";
  return `0x${Array.from({ length: 64 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`;
}

export function demoAddress() {
  const saved = localStorage.getItem("tusktable:address");
  if (saved) return saved;
  const addr = `0x${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 32)}`.slice(0, 66);
  localStorage.setItem("tusktable:address", addr);
  return addr;
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
}

export function saveForm(form: StoredForm) {
  const store = readStore();
  writeStore({ ...store, forms: [form, ...store.forms.filter((item) => item.id !== form.id)] });
}

export function getForms() {
  return readStore().forms.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createDraftForm(schema = createDefaultSchema()) {
  const now = new Date().toISOString();
  const form: StoredForm = {
    id: id("form"),
    owner: demoAddress(),
    network: "sui-testnet",
    status: "draft",
    draftSchema: schema,
    createdAt: now,
    updatedAt: now,
  };
  saveForm(form);
  return form;
}

export function saveDraftForm(formId: string, schema: FormSchema) {
  const store = readStore();
  const existing = store.forms.find((form) => form.id === formId);
  const now = new Date().toISOString();
  const form: StoredForm = existing
    ? { ...existing, draftSchema: schema, updatedAt: now }
    : {
        id: formId,
        owner: demoAddress(),
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

export function publishStoredForm(formId: string, schema: FormSchema, schemaBlob: BlobReceipt, txDigest: string) {
  const store = readStore();
  const existing = store.forms.find((form) => form.id === formId);
  const now = new Date().toISOString();
  const form: StoredForm = {
    id: formId,
    owner: existing?.owner ?? demoAddress(),
    network: "sui-testnet",
    status: "published",
    draftSchema: schema,
    schema,
    schemaBlob,
    txDigest,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    publishedAt: now,
  };
  writeStore({ ...store, forms: [form, ...store.forms.filter((item) => item.id !== formId)] });
  return form;
}

export function saveSubmission(submission: Submission) {
  const store = readStore();
  writeStore({ ...store, submissions: [submission, ...store.submissions.filter((item) => item.id !== submission.id)] });
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

export function getSubmissions(formId: string) {
  return readStore().submissions.filter((submission) => submission.formId === formId);
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
    return {
      ...raw,
      network: "sui-testnet",
      status: raw.status ?? (raw.schemaBlob ? "published" : "draft"),
      updatedAt: raw.updatedAt ?? raw.publishedAt ?? raw.createdAt,
    } as StoredForm;
  }
  if (raw.schema && raw.schemaBlob && raw.txDigest) {
    return {
      id: raw.id,
      owner: raw.owner,
      network: "sui-testnet",
      status: "published",
      draftSchema: raw.schema,
      schema: raw.schema,
      schemaBlob: raw.schemaBlob,
      txDigest: raw.txDigest,
      createdAt: raw.createdAt,
      updatedAt: raw.createdAt,
      publishedAt: raw.createdAt,
    };
  }
  return null;
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
  } catch {
    return uploadLocal(blob, name, type);
  }
}

async function uploadLocal(blob: Blob, name: string, type: "json" | "file"): Promise<BlobReceipt> {
  const blobId = `${LOCAL_BLOB_PREFIX}_${crypto.randomUUID().replaceAll("-", "")}`;
  const data = await blobToDataUrl(blob);
  localStorage.setItem(`tusktable:blob:${blobId}`, data);
  return {
    id: blobId,
    storage: "local",
    network: "local-fallback",
    url: data,
    type,
    name,
    contentType: blob.type,
    size: blob.size,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function readJsonBlob<T>(receipt: BlobReceipt): Promise<T> {
  if (receipt.storage === "local") {
    const dataUrl = localStorage.getItem(`tusktable:blob:${receipt.id}`) || receipt.url;
    const response = await fetch(dataUrl);
    return response.json() as Promise<T>;
  }
  const response = await fetch(receipt.url);
  if (!response.ok) throw new Error(`Unable to read Walrus blob ${receipt.id}`);
  return response.json() as Promise<T>;
}

export function createDefaultSchema(): FormSchema {
  return {
    id: id("schema"),
    title: "Untitled Form",
    description: "Edit these starter questions, drag fields to reorder them, then publish a share link.",
    encrypted: false,
    layout: "standard",
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
