export type FieldType =
  | "shortText"
  | "richText"
  | "dropdown"
  | "checkboxes"
  | "rating"
  | "image"
  | "video"
  | "url";

export type Field = {
  id: string;
  type: FieldType;
  label: string;
  helper?: string;
  required: boolean;
  options?: string[];
};

export type FormSchema = {
  id: string;
  title: string;
  description: string;
  layout?: "standard" | "slides";
  createdAt: string;
  fields: Field[];
};

export type BlobReceipt = {
  id: string;
  storage: "walrus";
  network: "walrus-testnet";
  url: string;
  type: "json" | "file";
  name?: string;
  contentType?: string;
  size?: number;
};

export type PublishedForm = {
  id: string;
  owner: string;
  network: "sui-testnet";
  schemaBlob: BlobReceipt;
  schema: FormSchema;
  txDigest?: string;
  suiObjectId?: string;
  createdAt: string;
};

export type StoredForm = {
  id: string;
  owner: string;
  network: "sui-testnet";
  status: "draft" | "published";
  draftSchema: FormSchema;
  schema?: FormSchema;
  schemaBlob?: BlobReceipt;
  txDigest?: string;
  suiObjectId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type Submission = {
  id: string;
  formId: string;
  network: "sui-testnet";
  values: Record<string, string | string[] | number | BlobReceipt | null>;
  media: Record<string, BlobReceipt>;
  submissionBlob: BlobReceipt;
  txDigest?: string;
  chainSubmissionId?: string;
  submitter: string;
  createdAt: string;
  status: "new" | "reviewed" | "prioritized" | "archived";
  priority: "low" | "medium" | "high";
};

export type AppStore = {
  forms: StoredForm[];
  submissions: Submission[];
};
