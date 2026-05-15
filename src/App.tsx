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
import React, { useEffect, useMemo, useState, createContext, useContext, useRef } from "react";
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
import { Sheet } from "./components/Sheet";
import { AddFieldModal } from "./components/AddFieldModal";
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

  function handleDelete(formId: string) {
    if (window.confirm("Are you sure you want to delete this form and all its responses?")) {
      deleteForm(formId);
      setForms(getForms());
      toast.success("Form deleted");
    }
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
  const [activeTab, setActiveTab] = useState<"build" | "settings" | "preview">("build");
  const [copied, setCopied] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalIndex, setAddModalIndex] = useState(0);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

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
  }

  async function publish() {
    if (schemaIssues.length) {
      toast.error("Fix the highlighted field issues before publishing.");
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
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function copyShareLink() {
    if (form?.status !== "published") return;
    copy(`${window.location.origin}/f/${form.id}`);
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
        <div className="builder-header-left">
          <button onClick={() => navigate("/forms")} className="back-btn"><ArrowLeft size={18}/></button>
          <div className="builder-title-group">
            <input className="builder-title" value={schema.title} onChange={e => setSchema({...schema, title: e.target.value})} placeholder="Form Title" />
            <span className={`save-status ${dirtySincePublish ? 'dirty' : ''}`}>{dirtySincePublish ? "Unsaved edits" : "Saved"}</span>
          </div>
        </div>
        <div className="builder-tabs">
          <button className={activeTab === "build" ? "active" : ""} onClick={() => setActiveTab("build")}>Build</button>
          <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>Settings</button>
          <button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>Preview</button>
        </div>
        <div className="builder-header-right">
          {form?.status === "published" && (
             <button className="secondary" onClick={copyShareLink}>
               {copied ? <Check size={15}/> : <LinkIcon size={15}/>} Share
             </button>
          )}
          <button className="primary" onClick={publish} disabled={busy || schemaIssues.length > 0}>
             {busy ? "Publishing..." : (form?.status === "published" && !dirtySincePublish ? "Published" : "Publish")}
          </button>
        </div>
      </header>

      <main className="builder-main" ref={canvasRef}>
        <AnimatePresence mode="wait">
          {activeTab === "build" && (
            <motion.div
              key="build"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="builder-canvas"
            >
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
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="builder-settings-panel"
            >
              <div className="settings-card">
                <p className="eyebrow">Privacy</p>
                <h2>End-to-End Encryption</h2>
                <label className="settings-toggle">
                  <input type="checkbox" checked={schema.encrypted} onChange={(e) => setSchema({ ...schema, encrypted: e.target.checked })} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span className="toggle-label"><Lock size={15} /> Seal private mode</span>
                </label>
                <p className="settings-hint">Payloads are encrypted client-side before uploading to Walrus decentralized storage.</p>
              </div>
              
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

              {schemaIssues.length > 0 && (
                <div className="settings-card">
                  <p className="eyebrow">Validation</p>
                  <h2>Fix before publishing</h2>
                  <div className="issue-list" style={{marginTop: 12}}>
                    {schemaIssues.map((issue) => (
                      <button key={`${issue.fieldId ?? "form"}-${issue.message}`} onClick={() => { setActiveTab("build"); if (issue.fieldId) setSelectedId(issue.fieldId); }}>
                        <AlertCircle size={14} />
                        {issue.message}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {form?.status === "published" && form.schemaBlob && form.txDigest && (
                <div className="settings-card">
                  <p className="eyebrow">Blockchain Proofs</p>
                  <h2>Receipts</h2>
                  <div className="receipt" style={{marginTop: 12}}>
                    <p>Schema blob</p>
                    <code>{form.schemaBlob.id}</code>
                    <p>Sui testnet transaction</p>
                    <a className="proof-link" href={testnetTxUrl(form.txDigest)} target="_blank" rel="noreferrer">
                      {form.txDigest}
                    </a>
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
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate
}: {
  field: Field;
  index: number;
  isSelected: boolean;
  issue?: string[];
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
    if (isSelected && contentRef.current) {
      contentRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isSelected]);

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
                  autoFocus
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
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) setSelectOpen(false);
    }
    if (selectOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectOpen]);

  return (
    <div className="field-inline-editor">
      <div className="field-inline-row" ref={selectRef}>
        <label>Field Type</label>
        <button className="field-custom-select" onClick={() => setSelectOpen(!selectOpen)}>
          {(() => {
            const item = fieldTypes.find(i => i.type === field.type);
            return item ? <><item.icon size={16} /> {item.label}</> : field.type;
          })()}
          <ChevronRight size={14} style={{ transform: selectOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s", marginLeft: "auto" }} />
        </button>
        <AnimatePresence>
          {selectOpen && (
            <motion.div 
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="field-custom-select-dropdown"
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
      {field.type === "shortText" && <div className="fake-input" />}
      {field.type === "richText" && <div className="fake-textarea" />}
      {field.type === "url" && <div className="fake-input with-icon">https://</div>}
      {field.type === "rating" && <div className="stars" style={{fontSize: 22}}>{"★★★★★"}</div>}
      {field.type === "dropdown" && <div className="fake-input">{field.options?.[0] ?? "Select"}</div>}
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
    <div>
      <div className="public-header">
        <p className="eyebrow">Preview</p>
        <h1>{schema.title || "Untitled Form"}</h1>
        <p>{schema.description}</p>
      </div>
      <div className="public-form">
        {schema.fields.map(field => (
           <ResponseField
             key={field.id}
             field={field}
             value={undefined}
             onValue={() => {}}
             onFile={() => {}}
             onClearFile={() => {}}
           />
        ))}
        <button className="submit-bar">Submit feedback</button>
      </div>
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
