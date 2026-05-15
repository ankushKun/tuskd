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
  ArrowDown,
  ArrowUp,
  Copy,
  FileCheck2,
  X,
  Search,
  Moon,
  Sun,
  LayoutTemplate,
  LayoutList,
  Columns3,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useEffect, useMemo, useState, createContext, useContext } from "react";
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
import type { BlobReceipt, Field, FieldType, FormSchema, StoredForm, Submission } from "./types";
import { TESTNET_CONFIG, testnetTxUrl } from "./config";
import {
  createDraftForm,
  createDefaultSchema,
  demoAddress,
  digest,
  deleteForm,
  getForm,
  getForms,
  getSubmissions,
  id,
  publishStoredForm,
  readJsonBlob,
  saveDraftForm,
  saveSubmission,
  updateSubmission,
  uploadFile,
  uploadJson,
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
    video: "Accepts short demo videos or screen recordings.",
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
    encrypted: schema.encrypted,
    fields: schema.fields.map(({ id: fieldId, ...field }) => ({ id: fieldId, ...field })),
  });
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

function responseCount(formId: string) {
  return getSubmissions(formId).length;
}

function lastSubmissionAt(formId: string) {
  const dates = getSubmissions(formId)
    .map((submission) => submission.createdAt)
    .sort();
  return dates[dates.length - 1];
}

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: "light", toggleTheme: () => {} });

function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("tusktable:theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    localStorage.setItem("tusktable:theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = () => setTheme(current => current === "light" ? "dark" : "light");

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
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

  return (
    <AppProvider>
      <main>
        <TopBar navigate={navigate} />
        {formMatch ? (
          <PublicForm formId={formMatch[1]} navigate={navigate} />
        ) : adminMatch ? (
          <Dashboard formId={adminMatch[1]} navigate={navigate} />
        ) : builderMatch ? (
          <Builder formId={builderMatch[1]} navigate={navigate} />
        ) : (
          <FormsHome navigate={navigate} />
        )}
      </main>
    </AppProvider>
  );
}

function TopBar({ navigate }: { navigate: (path: string) => void }) {
  const { theme, toggleTheme } = useContext(ThemeContext);

  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate("/forms")} aria-label="Open forms dashboard">
        <span className="brand-mark">T</span>
        <span>
          <strong>TuskTable</strong>
          <small>Sui Testnet + Walrus Testnet</small>
        </span>
      </button>
      <div className="topbar-actions">
        <div className="wallet-pill">
          <Wallet size={16} />
          Testnet
          {shortAddress(demoAddress())}
        </div>
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}

function FormsHome({ navigate }: { navigate: (path: string) => void }) {
  const [forms, setForms] = useState(() => getForms());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "draft" | "published">("all");
  const [copiedId, setCopiedId] = useState("");

  useEffect(() => {
    setForms(getForms());
  }, []);

  const filteredForms = useMemo(() => {
    return forms.filter((form) => {
      const status = formUiStatus(form);
      const matchesFilter = filter === "all" || (filter === "draft" ? status === "draft" || status === "dirty" : status === "published");
      const matchesQuery = `${form.draftSchema.title} ${form.draftSchema.description}`.toLowerCase().includes(query.toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [filter, forms, query]);

  function newForm() {
    const form = createDraftForm();
    navigate(`/builder/${form.id}`);
  }

  function copyFormLink(form: StoredForm) {
    if (form.status !== "published") return;
    copy(`${window.location.origin}/f/${form.id}`);
    setCopiedId(form.id);
    toast.success("Link copied to clipboard");
    window.setTimeout(() => setCopiedId(""), 1600);
  }

  return (
    <section className="forms-home">
      <div className="forms-hero">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Your forms</h1>
          <p className="muted">Create drafts, publish share links, and review responses from one simple dashboard.</p>
        </div>
        <button className="primary" onClick={newForm}>
          <Plus size={16} />
          New form
        </button>
      </div>

      <div className="forms-toolbar">
        <label className="search-box">
          <Search size={16} />
          <input placeholder="Search forms" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="tabs">
          {(["all", "draft", "published"] as const).map((item) => (
            <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>
              {item === "all" ? "All" : item === "draft" ? "Drafts" : "Published"}
            </button>
          ))}
        </div>
      </div>

      {forms.length === 0 ? (
        <div className="empty-card forms-empty">
          <MessageSquareText size={24} />
          <strong>No forms yet</strong>
          <span>Create a form, publish it, and collect responses on Walrus Testnet.</span>
          <button className="primary" onClick={newForm}>
            <Plus size={16} />
            New form
          </button>
        </div>
      ) : null}

      {forms.length > 0 && filteredForms.length === 0 ? (
        <div className="empty-card forms-empty">
          <AlertCircle size={24} />
          <strong>No matching forms</strong>
          <span>Clear search or switch filters.</span>
        </div>
      ) : null}

      <div className="forms-grid">
        {filteredForms.map((form) => {
          const status = formUiStatus(form);
          const count = responseCount(form.id);
          const lastAt = lastSubmissionAt(form.id);
          return (
            <article className="form-card" key={form.id}>
              <div className="form-card-top">
                <span className={`form-status ${status}`}>{formStatusLabel(form)}</span>
                <span>{count} response{count === 1 ? "" : "s"}</span>
              </div>
              <h2>{form.draftSchema.title || "Untitled form"}</h2>
              <p>{form.draftSchema.description || "No description"}</p>
              <div className="form-meta">
                <span>Updated {new Date(form.updatedAt).toLocaleDateString()}</span>
                {lastAt ? <span>Last response {new Date(lastAt).toLocaleDateString()}</span> : null}
                {form.schemaBlob ? <span>{form.schemaBlob.storage === "walrus" ? "Walrus Testnet" : "Local fallback"}</span> : null}
              </div>
              <div className="form-actions">
                <button onClick={() => navigate(`/builder/${form.id}`)}>
                  <Settings2 size={15} />
                  {form.status === "draft" ? "Continue editing" : "Edit"}
                </button>
                {form.status === "published" ? (
                  <>
                    <button onClick={() => navigate(`/f/${form.id}`)}>
                      <ExternalLink size={15} />
                      Open form
                    </button>
                    <button onClick={() => navigate(`/admin/${form.id}`)}>
                      <BarChart3 size={15} />
                      Responses
                    </button>
                    <button onClick={() => copyFormLink(form)}>
                      {copiedId === form.id ? <Check size={15} /> : <Clipboard size={15} />}
                      {copiedId === form.id ? "Copied" : "Copy link"}
                    </button>
                  </>
                ) : null}
                <button 
                  onClick={() => handleDelete(form.id)}
                  style={{ color: "var(--danger)", borderColor: "transparent", background: "transparent", marginLeft: "auto" }}
                  aria-label="Delete form"
                >
                  <Trash2 size={15} />
                </button>
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
  const [publishError, setPublishError] = useState("");
  const [copied, setCopied] = useState(false);

  const selected = schema.fields.find((field) => field.id === selectedId) ?? schema.fields[0];
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
  const canShare = Boolean(form?.status === "published" && form.schemaBlob && form.txDigest);

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
      const draft = createDraftForm();
      setForm(draft);
      setSchema(draft.draftSchema);
      setSelectedId(draft.draftSchema.fields[0]?.id ?? "");
      navigate(`/builder/${draft.id}`);
      return;
    }

    const existing = getForm(formId);
    if (existing) {
      setForm(existing);
      setSchema(existing.draftSchema);
      setSelectedId(existing.draftSchema.fields[0]?.id ?? "");
      return;
    }

    const draft = createDraftForm();
    setForm(draft);
    setSchema(draft.draftSchema);
    setSelectedId(draft.draftSchema.fields[0]?.id ?? "");
    navigate(`/builder/${draft.id}`);
  }, [formId]);

  useEffect(() => {
    if (!form) return;
    setForm(saveDraftForm(form.id, schema));
  }, [schema]);

  function addField(type: FieldType) {
    const field = createField(type);
    setSchema((current) => ({ ...current, fields: [...current.fields, field] }));
    setSelectedId(field.id);
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
      setSelectedId(fields[0]?.id ?? "");
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
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    setSchema((current) => {
      const from = current.fields.findIndex((field) => field.id === fieldId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.fields.length) return current;
      const fields = [...current.fields];
      const [moved] = fields.splice(from, 1);
      fields.splice(to, 0, moved);
      return { ...current, fields };
    });
    setSelectedId(fieldId);
  }

  async function publish() {
    setPublishError("");
    if (schemaIssues.length) {
      toast.error("Fix the highlighted field issues before publishing.");
      setPublishError("Fix the highlighted field issues before publishing.");
      return;
    }
    setBusy(true);
    try {
      const nextSchema = { ...schema, id: id("schema"), createdAt: new Date().toISOString() };
      const schemaBlob = await uploadJson(nextSchema, "form-schema.json");
      const current = form ?? createDraftForm(nextSchema);
      const publishedForm = publishStoredForm(current.id, nextSchema, schemaBlob, digest());
      setForm(publishedForm);
      setSchema(publishedForm.draftSchema);
      toast.success("Form published successfully to Walrus Testnet");
      if (!formId) navigate(`/builder/${publishedForm.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to publish this form.";
      setPublishError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function copyShareLink() {
    if (!canShare || !form) return;
    copy(`${window.location.origin}/f/${form.id}`);
    setCopied(true);
    toast.success("Link copied to clipboard");
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="builder-layout">
      <aside className="palette">
        <div>
          <p className="eyebrow">Create</p>
          <h1>Airtable-style forms, stored on Walrus.</h1>
          <p className="muted">Publish a real feedback form in minutes, then review submissions with Walrus blob proofs.</p>
        </div>
        <div className="network-card">
          <span>Sui {TESTNET_CONFIG.suiNetwork}</span>
          <code>{TESTNET_CONFIG.suiRpcUrl}</code>
          <span>Walrus testnet</span>
          <code>{TESTNET_CONFIG.walrusPublisher}</code>
        </div>
        <div className="template-card">
          <Sparkles size={18} />
          <div>
            <strong>Editable starter form</strong>
            <span>Three placeholder fields are ready. Drag them up or down to reorder.</span>
          </div>
        </div>
        <div className={`health-card ${schemaIssues.length ? "warn" : "ok"}`}>
          {schemaIssues.length ? <AlertCircle size={17} /> : <Check size={17} />}
          <span>{schemaIssues.length ? `${schemaIssues.length} issue${schemaIssues.length === 1 ? "" : "s"} before publish` : "Ready to publish"}</span>
        </div>
        <div className="field-palette">
          {fieldTypes.map((item) => (
            <button key={item.type} onClick={() => addField(item.type)}>
              <item.icon size={17} />
              {item.label}
              <Plus size={15} />
            </button>
          ))}
        </div>
      </aside>

      <section className="canvas">
        <div className="canvas-toolbar">
          <div>
            <input
              className="title-input"
              value={schema.title}
              onChange={(event) => setSchema({ ...schema, title: event.target.value })}
            />
            <textarea
              className="description-input"
              value={schema.description}
              onChange={(event) => setSchema({ ...schema, description: event.target.value })}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end" }}>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={schema.encrypted}
                onChange={(event) => setSchema({ ...schema, encrypted: event.target.checked })}
              />
              <span>
                <Lock size={15} />
                Seal private mode
              </span>
            </label>
            <div className="view-toggle">
              <button 
                className={schema.layout !== "slides" ? "active" : ""} 
                onClick={() => setSchema({ ...schema, layout: "standard" })}
                title="Standard Layout"
                aria-label="Standard Layout"
              >
                <LayoutList size={16} />
              </button>
              <button 
                className={schema.layout === "slides" ? "active" : ""} 
                onClick={() => setSchema({ ...schema, layout: "slides" })}
                title="Slides Layout"
                aria-label="Slides Layout"
              >
                <LayoutTemplate size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="form-preview">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={schema.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {schema.fields.map((field, index) => (
                <SortableField
                  key={field.id}
                  field={field}
                  index={index}
                  isSelected={field.id === selected?.id}
                  issue={issueByField.get(field.id)}
                  totalFields={schema.fields.length}
                  onSelect={() => setSelectedId(field.id)}
                  onMove={moveField}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </section>

      <aside className="inspector">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Publish</p>
            <h2>Submission rail</h2>
          </div>
          <button className="primary icon-left" onClick={publish} disabled={busy || schemaIssues.length > 0}>
            <Send size={16} />
            {busy ? "Publishing" : canShare ? "Republish" : "Publish"}
          </button>
        </div>

        {publishError ? (
          <div className="error-banner">
            <AlertCircle size={16} />
            {publishError}
          </div>
        ) : null}

        {schemaIssues.length ? (
          <div className="issue-list">
            <strong>Fix before publishing</strong>
            {schemaIssues.slice(0, 5).map((issue) => (
              <button key={`${issue.fieldId ?? "form"}-${issue.message}`} onClick={() => issue.fieldId && setSelectedId(issue.fieldId)}>
                <AlertCircle size={14} />
                {issue.message}
              </button>
            ))}
          </div>
        ) : null}

        {canShare && form?.schemaBlob && form.txDigest ? (
          <div className="receipt">
            <div className={`status-dot ${dirtySincePublish ? "warn" : ""}`}>{dirtySincePublish ? "Unsaved edits" : "Live"}</div>
            <p>Schema blob</p>
            <code>{form.schemaBlob.id}</code>
            {form.schemaBlob.storage === "local" ? (
              <div className="warning-note">
                <AlertCircle size={15} />
                Local fallback is not publicly shareable across browsers.
              </div>
            ) : null}
            <p>Sui testnet transaction</p>
            <a className="proof-link" href={testnetTxUrl(form.txDigest)} target="_blank" rel="noreferrer">
              {form.txDigest}
            </a>
            <div className="split-actions">
              <button onClick={copyShareLink}>
                {copied ? <Check size={15} /> : <Clipboard size={15} />}
                {copied ? "Copied" : "Copy form"}
              </button>
              <button onClick={() => navigate(`/admin/${form.id}`)}>
                <Table2 size={15} />
                Admin
              </button>
            </div>
            <button className="secondary full" onClick={() => navigate(`/f/${form.id}`)}>
              Open share link
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}

        {selected ? (
          <FieldEditor field={selected} updateField={updateField} removeField={removeField} duplicateField={duplicateField} issues={issueByField.get(selected.id) ?? []} />
        ) : (
          <p className="muted">Add a field to edit its settings.</p>
        )}
      </aside>
    </section>
  );
}

function SortableField({
  field,
  index,
  isSelected,
  issue,
  totalFields,
  onSelect,
  onMove,
}: {
  field: Field;
  index: number;
  isSelected: boolean;
  issue?: string[];
  totalFields: number;
  onSelect: () => void;
  onMove: (fieldId: string, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 10, opacity: 0.5 } : {}),
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`field-shell ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${issue?.length ? "has-issue" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      role="button"
      tabIndex={0}
    >
      <span className="drag-handle" aria-label="Drag to reorder" {...attributes} {...listeners}>
        <GripVertical size={17} />
      </span>
      <span className="field-number">{index + 1}</span>
      <FieldPreview field={field} issues={issue ?? []} />
      <div className="reorder-actions">
        <button
          aria-label="Move field up"
          disabled={index === 0}
          onClick={(event) => {
            event.stopPropagation();
            onMove(field.id, -1);
          }}
        >
          <ArrowUp size={15} />
        </button>
        <button
          aria-label="Move field down"
          disabled={index === totalFields - 1}
          onClick={(event) => {
            event.stopPropagation();
            onMove(field.id, 1);
          }}
        >
          <ArrowDown size={15} />
        </button>
      </div>
    </article>
  );
}

function FieldEditor({
  field,
  updateField,
  removeField,
  duplicateField,
  issues,
}: {
  field: Field;
  updateField: (fieldId: string, patch: Partial<Field>) => void;
  removeField: (fieldId: string) => void;
  duplicateField: (fieldId: string) => void;
  issues: string[];
}) {
  const options = field.options ?? [];
  const usesOptions = field.type === "dropdown" || field.type === "checkboxes";

  function changeType(nextType: FieldType) {
    updateField(field.id, {
      type: nextType,
      options: nextType === "dropdown" || nextType === "checkboxes" ? normalizeOptions(options).length ? normalizeOptions(options) : ["Option A", "Option B"] : undefined,
    });
  }

  function updateOption(index: number, value: string) {
    const nextOptions = options.length ? [...options] : [""];
    nextOptions[index] = value;
    updateField(field.id, { options: nextOptions });
  }

  function addOption() {
    updateField(field.id, { options: [...options, `Option ${options.length + 1}`] });
  }

  function removeOption(index: number) {
    updateField(field.id, { options: options.filter((_, optionIndex) => optionIndex !== index) });
  }

  function dedupeOptions() {
    const seen = new Set<string>();
    updateField(field.id, {
      options: normalizeOptions(options).filter((option) => {
        const key = option.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    });
  }

  return (
    <div className="editor">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Field</p>
          <h2>{fieldTypes.find((item) => item.type === field.type)?.label}</h2>
        </div>
        <button className="danger-icon" onClick={() => removeField(field.id)} aria-label="Remove field">
          <Trash2 size={16} />
        </button>
      </div>
      {issues.length ? (
        <div className="inline-issues">
          {issues.map((issue) => (
            <span key={issue}>
              <AlertCircle size={14} />
              {issue}
            </span>
          ))}
        </div>
      ) : null}
      <label>
        Type
        <select value={field.type} onChange={(event) => changeType(event.target.value as FieldType)}>
          {fieldTypes.map((item) => (
            <option key={item.type} value={item.type}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">{fieldHint(field.type)}</p>
      <label>
        Label
        <input value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} />
      </label>
      <label>
        Helper text
        <textarea value={field.helper ?? ""} onChange={(event) => updateField(field.id, { helper: event.target.value })} />
      </label>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(event) => updateField(field.id, { required: event.target.checked })}
        />
        Required
      </label>
      {usesOptions ? (
        <div className="option-editor">
          <div className="option-header">
            <strong>Options</strong>
            <button onClick={dedupeOptions} type="button">Dedupe</button>
          </div>
          {(options.length ? options : [""]).map((option, index) => (
            <div className="option-row" key={index}>
              <input value={option} onChange={(event) => updateOption(index, event.target.value)} placeholder={`Option ${index + 1}`} />
              <button type="button" onClick={() => removeOption(index)} aria-label="Remove option">
                <X size={15} />
              </button>
            </div>
          ))}
          <button className="secondary full" type="button" onClick={addOption}>
            <Plus size={15} />
            Add option
          </button>
        </div>
      ) : null}
      <button className="secondary full" type="button" onClick={() => duplicateField(field.id)}>
        <Copy size={15} />
        Duplicate field
      </button>
    </div>
  );
}

function FieldPreview({ field, issues }: { field: Field; issues: string[] }) {
  return (
    <div className="field-preview">
      <div className="label-row">
        <strong>{field.label || "Untitled field"}</strong>
        {field.required ? <span>Required</span> : null}
      </div>
      {field.helper ? <p>{field.helper}</p> : null}
      {field.type === "shortText" ? <div className="fake-input" /> : null}
      {field.type === "richText" ? <div className="fake-textarea" /> : null}
      {field.type === "url" ? <div className="fake-input with-icon">https://</div> : null}
      {field.type === "rating" ? <div className="stars">{"★★★★★"}</div> : null}
      {field.type === "dropdown" ? <div className="fake-input">{field.options?.[0] ?? "Select"}</div> : null}
      {field.type === "checkboxes" ? (
        <div className="chips">{field.options?.map((option) => <span key={option}>{option}</span>)}</div>
      ) : null}
      {field.type === "image" || field.type === "video" ? (
        <div className="upload-drop">{field.type === "image" ? <Image size={18} /> : <FileVideo size={18} />} Walrus upload</div>
      ) : null}
      {issues.length ? (
        <div className="field-issues">
          {issues.map((issue) => (
            <span key={issue}>
              <AlertCircle size={13} />
              {issue}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PublicForm({ formId, navigate }: { formId: string; navigate: (path: string) => void }) {
  const [form, setForm] = useState<StoredForm | null>(() => getForm(formId));
  const [values, setValues] = useState<Record<string, string | string[] | number>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    setValues({});
    setFiles({});
    setErrors({});
    setReceipt(null);
    setSubmitError("");
    const current = getForm(formId);
    if (!current) return;
    if (current.status !== "published" || !current.schemaBlob) {
      setForm(current);
      return;
    }
    readJsonBlob<FormSchema>(current.schemaBlob)
      .then((schema) => setForm({ ...current, schema }))
      .catch(() => setForm(current));
  }, [formId]);

  if (!form) {
    return (
      <section className="center-state">
        <h1>Form not found</h1>
        <p className="muted">This browser has no local record for that Sui form object yet.</p>
        <button className="primary" onClick={() => navigate("/builder")}>Create a form</button>
      </section>
    );
  }
  const activeForm = form;
  const publishedSchema = activeForm.schema;

  if (activeForm.status !== "published" || !publishedSchema || !activeForm.schemaBlob) {
    return (
      <section className="center-state">
        <h1>This form is still a draft</h1>
        <p className="muted">Publish it before sharing a public response link.</p>
        <button className="primary" onClick={() => navigate(`/builder/${activeForm.id}`)}>Open builder</button>
      </section>
    );
  }
  const activeSchema = publishedSchema;

  async function submit() {
    const nextErrors: Record<string, string> = {};
    const cleanedValues: Record<string, string | string[] | number> = { ...values };
    for (const field of activeSchema.fields) {
      const rawValue = values[field.id];
      const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      if (typeof rawValue === "string") cleanedValues[field.id] = value;
      const file = files[field.id];
      const emptyArray = Array.isArray(value) && value.length === 0;
      if (field.required && !value && !file) nextErrors[field.id] = "Required";
      if (field.required && emptyArray) nextErrors[field.id] = "Required";
      if (field.type === "url" && value) {
        try {
          const url = new URL(String(value));
          if (url.protocol !== "http:" && url.protocol !== "https:") nextErrors[field.id] = "Use an http or https URL";
        } catch {
          nextErrors[field.id] = "Use a full URL";
        }
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitError("");
    setBusy(true);
    try {
      const media: Record<string, BlobReceipt> = {};
      for (const [fieldId, file] of Object.entries(files)) {
        media[fieldId] = await uploadFile(file);
      }
      const payload = {
        formId: activeForm.id,
        values: cleanedValues,
        media,
        submitter: demoAddress(),
        encrypted: activeSchema.encrypted,
        createdAt: new Date().toISOString(),
      };
      const storedPayload = activeSchema.encrypted ? { seal: "demo-private-mode", ciphertext: btoa(JSON.stringify(payload)) } : payload;
      const submissionBlob = await uploadJson(storedPayload, "submission.json");
      const submission: Submission = {
        id: id("sub"),
        formId: activeForm.id,
        network: "sui-testnet",
        values: { ...cleanedValues, ...media },
        media,
        submissionBlob,
        txDigest: digest(),
        submitter: demoAddress(),
        createdAt: new Date().toISOString(),
        status: "new",
        priority: "medium",
      };
      saveSubmission(submission);
      setReceipt(submission);
      toast.success("Feedback submitted successfully!");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to submit this response.";
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function resetResponse() {
    setValues({});
    setFiles({});
    setErrors({});
    setReceipt(null);
    setSubmitError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (receipt) {
    return (
      <section className="receipt-page">
        <div className="receipt-card large">
          <div className="status-dot">Submitted</div>
          <h1>Feedback recorded on the Walrus rail.</h1>
          <p className="muted">Your answers were stored as a submission blob and prepared for Sui testnet indexing.</p>
          <dl>
            <dt>Submission blob</dt>
            <dd>{receipt.submissionBlob.id}</dd>
            <dt>Sui testnet transaction</dt>
            <dd>
              <a className="proof-link" href={testnetTxUrl(receipt.txDigest)} target="_blank" rel="noreferrer">
                {receipt.txDigest}
              </a>
            </dd>
            <dt>Storage</dt>
            <dd>{receipt.submissionBlob.storage === "walrus" ? "Walrus testnet" : "Local fallback because testnet upload was unavailable"}</dd>
          </dl>
          <div className="split-actions">
            <button onClick={() => navigate(`/admin/${activeForm.id}`)}>
              <BarChart3 size={16} />
              Review
            </button>
            <button onClick={resetResponse}>
              <Plus size={16} />
              Another response
            </button>
          </div>
        </div>
      </section>
    );
  }

  const isSlides = activeSchema.layout === "slides";
  const currentField = activeSchema.fields[activeStep];
  const progressPercentage = ((activeStep + 1) / activeSchema.fields.length) * 100;

  function nextStep() {
    if (activeStep < activeSchema.fields.length - 1) setActiveStep(s => s + 1);
  }

  function prevStep() {
    if (activeStep > 0) setActiveStep(s => s - 1);
  }

  return (
    <section className="public-wrap">
      <div className="public-header">
        <p className="eyebrow">Walrus feedback form</p>
        <h1>{activeSchema.title}</h1>
        <p>{activeSchema.description}</p>
        <div className="proof-strip">
          <span>{activeForm.schemaBlob.storage === "walrus" ? "Walrus testnet schema" : "Local fallback schema"}</span>
          <code>{activeForm.schemaBlob.id}</code>
          <span>Sui testnet</span>
          {activeSchema.encrypted ? <span><Lock size={14} /> Private mode</span> : null}
        </div>
      </div>

      <div className="public-form">
        {isSlides ? (
          <div className="slides-layout">
            <div className="slides-progress">
              <div className="slides-progress-bar" style={{ width: `${progressPercentage}%` }} />
            </div>
            
            {currentField ? (
              <ResponseField
                key={currentField.id}
                field={currentField}
                value={values[currentField.id]}
                file={files[currentField.id]}
                error={errors[currentField.id]}
                onValue={(value) => setValues((current) => ({ ...current, [currentField.id]: value }))}
                onFile={(file) => setFiles((current) => ({ ...current, [currentField.id]: file }))}
                onClearFile={() =>
                  setFiles((current) => {
                    const next = { ...current };
                    delete next[currentField.id];
                    return next;
                  })
                }
              />
            ) : null}

            <div className="slides-controls">
              <button 
                className="secondary" 
                onClick={prevStep} 
                disabled={activeStep === 0 || busy}
              >
                <ArrowLeft size={16} /> Previous
              </button>
              
              {activeStep === activeSchema.fields.length - 1 ? (
                <button className="submit-bar" style={{ width: "auto" }} onClick={submit} disabled={busy}>
                  <Send size={17} />
                  {busy ? "Uploading to Walrus" : "Submit feedback"}
                </button>
              ) : (
                <button className="primary" onClick={nextStep} disabled={busy}>
                  Next <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {activeSchema.fields.map((field) => (
              <ResponseField
                key={field.id}
                field={field}
                value={values[field.id]}
                file={files[field.id]}
                error={errors[field.id]}
                onValue={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                onFile={(file) => setFiles((current) => ({ ...current, [field.id]: file }))}
                onClearFile={() =>
                  setFiles((current) => {
                    const next = { ...current };
                    delete next[field.id];
                    return next;
                  })
                }
              />
            ))}
            <button className="submit-bar" onClick={submit} disabled={busy}>
              <Send size={17} />
              {busy ? "Uploading to Walrus" : "Submit feedback"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function ResponseField({
  field,
  value,
  file,
  error,
  onValue,
  onFile,
  onClearFile,
}: {
  field: Field;
  value: string | string[] | number | undefined;
  file?: File;
  error?: string;
  onValue: (value: string | string[] | number) => void;
  onFile: (file: File) => void;
  onClearFile: () => void;
}) {
  return (
    <div className={`response-field ${error ? "has-error" : ""}`}>
      <span className="question-label">
        {field.label}
        {field.required ? <em>Required</em> : null}
      </span>
      {field.helper ? <small>{field.helper}</small> : null}
      {field.type === "shortText" ? <input value={String(value ?? "")} onChange={(event) => onValue(event.target.value)} /> : null}
      {field.type === "richText" ? <textarea value={String(value ?? "")} onChange={(event) => onValue(event.target.value)} /> : null}
      {field.type === "url" ? <input type="url" value={String(value ?? "")} onChange={(event) => onValue(event.target.value)} /> : null}
      {field.type === "dropdown" ? (
        <select value={String(value ?? "")} onChange={(event) => onValue(event.target.value)}>
          <option value="">Select one</option>
          {field.options?.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : null}
      {field.type === "checkboxes" ? (
        <div className="check-grid">
          {field.options?.map((option) => {
            const checked = Array.isArray(value) && value.includes(option);
  function handleDelete(formId: string) {
    if (window.confirm("Are you sure you want to delete this form and all its responses?")) {
      deleteForm(formId);
      setForms(getForms());
      toast.success("Form deleted");
    }
  }

  return (
              <label key={option} className={checked ? "checked" : ""}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const current = Array.isArray(value) ? value : [];
                    onValue(event.target.checked ? [...current, option] : current.filter((item) => item !== option));
                  }}
                />
                {option}
              </label>
            );
          })}
        </div>
      ) : null}
      {field.type === "rating" ? (
        <div className="rating-input">
          {[1, 2, 3, 4, 5].map((star) => (
            <button type="button" key={star} onClick={() => onValue(star)} className={Number(value ?? 0) >= star ? "active" : ""}>
              <Star size={23} />
            </button>
          ))}
        </div>
      ) : null}
      {field.type === "image" || field.type === "video" ? (
        <span className="file-control">
          <input type="file" accept={field.type === "image" ? "image/*" : "video/*"} onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
          {file ? (
            <span className="file-pill">
              <FileCheck2 size={15} />
              <span>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  onClearFile();
                }}
                aria-label="Clear selected file"
              >
                <X size={14} />
              </button>
            </span>
          ) : null}
        </span>
      ) : null}
      {error ? <strong className="error">{error}</strong> : null}
    </div>
  );
}

function Dashboard({ formId, navigate }: { formId: string; navigate: (path: string) => void }) {
  const [form] = useState(() => getForm(formId));
  const [submissions, setSubmissions] = useState(() => getSubmissions(formId));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [viewType, setViewType] = useState<"grid" | "table">("table");

  const filtered = useMemo(() => {
    return submissions.filter((submission) => {
      const haystack = JSON.stringify(submission.values).toLowerCase();
      return (
        (status === "all" || submission.status === status) &&
        (priority === "all" || submission.priority === priority) &&
        haystack.includes(query.toLowerCase())
      );
    });
  }, [priority, query, status, submissions]);
  const activeFilterCount = Number(Boolean(query.trim())) + Number(status !== "all") + Number(priority !== "all");

  if (!form) {
    return (
      <section className="center-state">
        <h1>No form object found</h1>
        <button className="primary" onClick={() => navigate("/builder")}>Back to builder</button>
      </section>
    );
  }
  const activeForm = form;
  const adminSchema = activeForm.schema ?? activeForm.draftSchema;

  if (activeForm.status !== "published" || !activeForm.schema) {
    return (
      <section className="center-state">
        <h1>This form is still a draft</h1>
        <p className="muted">Publish it before reviewing responses.</p>
        <button className="primary" onClick={() => navigate(`/builder/${activeForm.id}`)}>Open builder</button>
      </section>
    );
  }

  function patchSubmission(submission: Submission, patch: Partial<Submission>) {
    const next = { ...submission, ...patch };
    updateSubmission(next);
    setSubmissions(getSubmissions(formId));
  }

  function exportCsv() {
    const fields = adminSchema.fields;
    const headers = [
      "submission_id",
      "created_at",
      "status",
      "priority",
      "submitter",
      "submission_blob",
      "tx_digest",
      ...fields.map((field) => field.label),
    ];
    const rows = filtered.map((submission) =>
      [
        submission.id,
        submission.createdAt,
        submission.status,
        submission.priority,
        submission.submitter,
        submission.submissionBlob.id,
        submission.txDigest,
        ...fields.map((field) => formatValue(submission.values[field.id])),
      ].map(csvCell),
    );
    const csv = [headers.map(csvCell), ...rows].map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${adminSchema.title.replace(/\W+/g, "-").toLowerCase()}-submissions.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <div>
          <p className="eyebrow">Admin dashboard</p>
          <h1>{adminSchema.title}</h1>
          <p className="muted">
            {submissions.length} submissions indexed for this form object.
            {activeFilterCount ? ` ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active.` : ""}
          </p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate(`/f/${activeForm.id}`)}>
            <ExternalLink size={16} />
            Public form
          </button>
          <button className="primary" onClick={exportCsv}>
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="filters">
        <input placeholder="Search responses" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="prioritized">Prioritized</option>
          <option value="archived">Archived</option>
        </select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="all">All priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        {activeFilterCount ? (
          <button
            className="secondary"
            onClick={() => {
              setQuery("");
              setStatus("all");
              setPriority("all");
            }}
          >
            <X size={15} />
            Clear filters
          </button>
        ) : null}
        
        <div className="view-toggle">
          <button 
            className={viewType === "table" ? "active" : ""} 
            onClick={() => setViewType("table")}
            aria-label="Table View"
          >
            <Columns3 size={16} />
          </button>
          <button 
            className={viewType === "grid" ? "active" : ""} 
            onClick={() => setViewType("grid")}
            aria-label="Grid View"
          >
            <LayoutList size={16} />
          </button>
        </div>
      </div>

      {!submissions.length ? (
        <div className="empty-card">
          <MessageSquareText size={22} />
          <strong>No submissions yet</strong>
          <span>Open the public form and send one real test response for the hackathon submission.</span>
          <button className="primary" onClick={() => navigate(`/f/${activeForm.id}`)}>
            <ExternalLink size={16} />
            Open public form
          </button>
        </div>
      ) : submissions.length > 0 && !filtered.length ? (
        <div className="empty-card">
          <AlertCircle size={22} />
          <strong>No matching submissions</strong>
          <span>Clear filters or adjust the search query.</span>
        </div>
      ) : viewType === "table" ? (
        <div className="submission-table-container">
          <table className="submission-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Priority</th>
                {adminSchema.fields.map((field) => (
                  <th key={field.id}>{field.label}</th>
                ))}
                <th>Media</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((submission) => (
                <tr key={submission.id}>
                  <td>
                    <div>{new Date(submission.createdAt).toLocaleDateString()}</div>
                    <code style={{ fontSize: 10 }}>{submission.submissionBlob.id.slice(0, 12)}...</code>
                  </td>
                  <td>
                    <select className="secondary" value={submission.status} onChange={(event) => patchSubmission(submission, { status: event.target.value as Submission["status"] })}>
                      <option value="new">New</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="prioritized">Prioritized</option>
                      <option value="archived">Archived</option>
                    </select>
                  </td>
                  <td>
                    <select className="secondary" value={submission.priority} onChange={(event) => patchSubmission(submission, { priority: event.target.value as Submission["priority"] })}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </td>
                  {adminSchema.fields.map((field) => (
                    <td key={field.id}>
                      {formatValue(submission.values[field.id]) || "-"}
                    </td>
                  ))}
                  <td>
                    {Object.values(submission.media).length ? (
                      <div className="media-row">
                        {Object.values(submission.media).map((blob) => (
                          <a href={blob.url} target="_blank" rel="noreferrer" key={blob.id}>
                            {blob.contentType?.startsWith("image") ? <Image size={14} /> : <FileVideo size={14} />}
                            {blob.name?.slice(0, 8) || blob.id.slice(0, 8)}...
                          </a>
                        ))}
                      </div>
                    ) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="submission-grid">
          {filtered.map((submission) => (
            <article className="submission-card" key={submission.id}>
              <div className="submission-top">
                <div>
                  <strong>{new Date(submission.createdAt).toLocaleString()}</strong>
                  <code>{submission.submissionBlob.id}</code>
                </div>
                <span className={`priority ${submission.priority}`}>{submission.priority}</span>
              </div>
              <div className="answer-list">
                {adminSchema.fields.map((field) => (
                  <div key={field.id}>
                    <span>{field.label}</span>
                    <strong>{formatValue(submission.values[field.id]) || "-"}</strong>
                  </div>
                ))}
              </div>
              {Object.values(submission.media).length ? (
                <div className="media-row">
                  {Object.values(submission.media).map((blob) => (
                    <a href={blob.url} target="_blank" rel="noreferrer" key={blob.id}>
                      {blob.contentType?.startsWith("image") ? <Image size={16} /> : <FileVideo size={16} />}
                      {blob.name || blob.id}
                    </a>
                  ))}
                </div>
              ) : null}
              <div className="review-actions">
                <select value={submission.status} onChange={(event) => patchSubmission(submission, { status: event.target.value as Submission["status"] })}>
                  <option value="new">New</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="prioritized">Prioritized</option>
                  <option value="archived">Archived</option>
                </select>
                <select value={submission.priority} onChange={(event) => patchSubmission(submission, { priority: event.target.value as Submission["priority"] })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
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
