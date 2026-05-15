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
  MoreHorizontal,
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

  const stats = useMemo(() => {
    const published = forms.filter((f) => formUiStatus(f) === "published").length;
    const drafts = forms.filter((f) => { const s = formUiStatus(f); return s === "draft" || s === "dirty"; }).length;
    const totalResponses = forms.reduce((sum, f) => sum + responseCount(f.id), 0);
    return { total: forms.length, published, drafts, totalResponses };
  }, [forms]);

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
      <div className="forms-home-header">
        <div>
          <h1>Your forms</h1>
          <p className="muted">Create, publish, and manage feedback forms on Walrus.</p>
        </div>
        <button className="primary" onClick={newForm}>
          <Plus size={16} />
          New form
        </button>
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
        <div className="empty-state">
          <div className="empty-state-icon">
            <FileText size={32} />
          </div>
          <h2>No forms yet</h2>
          <p>Create a form, publish it, and start collecting responses on Walrus.</p>
          <button className="primary" onClick={newForm}>
            <Plus size={16} /> Create your first form
          </button>
        </div>
      ) : filteredForms.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Search size={32} />
          </div>
          <h2>No matching forms</h2>
          <p>Clear your search or try a different filter.</p>
          <button className="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>
            <X size={16} /> Clear filters
          </button>
        </div>
      ) : null}

      <div className="forms-grid">
        {filteredForms.map((form) => {
          const status = formUiStatus(form);
          const count = responseCount(form.id);
          const lastAt = lastSubmissionAt(form.id);
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
                      <button onClick={() => navigate(`/f/${form.id}`)} title="Open form">
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
  const [activeStep, setActiveStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [showProofs, setShowProofs] = useState(false);

  useEffect(() => {
    setValues({});
    setFiles({});
    setErrors({});
    setReceipt(null);
    setActiveStep(0);
    setShowProofs(false);
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
        <p className="muted">This browser has no local record for that form yet.</p>
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
  const isSlides = activeSchema.layout === "slides";
  const currentField = activeSchema.fields[activeStep];
  const totalFields = activeSchema.fields.length;
  const requiredCount = activeSchema.fields.filter((f) => f.required).length;
  const requiredAnswered = activeSchema.fields.filter((f) => {
    if (!f.required) return true;
    const v = values[f.id];
    const hasFile = files[f.id];
    if (f.type === "checkboxes") return Array.isArray(v) && v.length > 0;
    if (f.type === "image" || f.type === "video") return hasFile;
    return v !== undefined && v !== "" && v !== 0;
  }).length;

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
    if (!currentField) return;
    const err = validateField(currentField, values[currentField.id], files[currentField.id]);
    if (err) {
      setErrors((prev) => ({ ...prev, [currentField.id]: err }));
      return;
    }
    setErrors((prev) => ({ ...prev, [currentField.id]: "" }));
    if (activeStep < totalFields - 1) {
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
    const nextErrors = validateAll();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      if (isSlides) {
        const firstErrorIndex = activeSchema.fields.findIndex((f) => nextErrors[f.id]);
        if (firstErrorIndex >= 0) {
          setDirection(firstErrorIndex > activeStep ? 1 : -1);
          setActiveStep(firstErrorIndex);
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
      const media: Record<string, BlobReceipt> = {};
      for (const [fieldId, file] of Object.entries(files)) {
        media[fieldId] = await uploadFile(file);
      }
      const payload = {
        formId: activeForm.id,
        values: { ...values },
        media,
        submitter: demoAddress(),
        encrypted: activeSchema.encrypted,
        createdAt: new Date().toISOString(),
      };
      const storedPayload = activeSchema.encrypted
        ? { seal: "demo-private-mode", ciphertext: btoa(JSON.stringify(payload)) }
        : payload;
      const submissionBlob = await uploadJson(storedPayload, "submission.json");
      const submission: Submission = {
        id: id("sub"),
        formId: activeForm.id,
        network: "sui-testnet",
        values: { ...values, ...media },
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
        if (activeStep < totalFields - 1) handleNext();
        else handleSubmit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeStep, values, files, activeSchema, isSlides, totalFields]);

  useEffect(() => {
    if (!isSlides) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(".slides-question-wrapper input, .slides-question-wrapper textarea, .slides-question-wrapper select");
      if (el) el.focus();
    }, 350);
    return () => clearTimeout(timer);
  }, [activeStep, isSlides]);

  if (receipt) {
    return <PublicFormSuccess receipt={receipt} formId={activeForm.id} navigate={navigate} />;
  }

  return (
    <div className="public-form-page">
      <div className="public-form-progress">
        <div className="public-form-progress-track">
          <motion.div
            className="public-form-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${requiredCount > 0 ? (requiredAnswered / requiredCount) * 100 : 0}%` }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          />
        </div>
      </div>

      <header className="public-form-header">
        <h1>{activeSchema.title}</h1>
        {activeSchema.description ? <p>{activeSchema.description}</p> : null}
      </header>

      <main className="public-form-body">
        {isSlides ? (
          <div className="slides-container">
            <div className="slides-meta">
              <span className="slides-counter">{activeStep + 1} <span>/ {totalFields}</span></span>
            </div>

            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeStep}
                custom={direction}
                initial={{ y: direction > 0 ? 60 : -60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: direction > 0 ? -60 : 60, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                className="slides-question-wrapper"
              >
                <ResponseField
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
                  index={activeStep}
                />
              </motion.div>
            </AnimatePresence>

            <div className="slides-nav">
              <button className="secondary" onClick={handlePrev} disabled={activeStep === 0 || busy}>
                <ArrowLeft size={16} /> Back
              </button>
              {activeStep === totalFields - 1 ? (
                <button className="primary" onClick={handleSubmit} disabled={busy}>
                  {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                  Submit
                </button>
              ) : (
                <button className="primary" onClick={handleNext}>
                  Next <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="list-container">
            {activeSchema.fields.map((field, index) => (
              <div key={field.id} id={`q-${field.id}`} className="question-card">
                <span className="question-number">{index + 1}</span>
                <ResponseField
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
                  index={index}
                />
              </div>
            ))}
            <button className="public-submit-btn" onClick={handleSubmit} disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
              {busy ? "Submitting..." : "Submit"}
            </button>
          </div>
        )}
      </main>

      <footer className="public-form-footer">
        <button className="proof-badge" onClick={() => setShowProofs(!showProofs)}>
          <Lock size={12} />
          Verified on Walrus
          <ChevronDown size={12} style={{ transform: showProofs ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
        </button>
        <AnimatePresence>
          {showProofs && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="proof-details"
            >
              <div className="proof-details-inner">
                <div className="proof-row"><span>Schema blob</span><code>{activeForm.schemaBlob.id}</code></div>
                {activeForm.txDigest && (
                  <div className="proof-row">
                    <span>Sui transaction</span>
                    <a className="proof-link" href={testnetTxUrl(activeForm.txDigest)} target="_blank" rel="noreferrer">{activeForm.txDigest}</a>
                  </div>
                )}
                <div className="proof-row"><span>Storage</span><span>{activeForm.schemaBlob.storage === "walrus" ? "Walrus Testnet" : "Local fallback"}</span></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </footer>
    </div>
  );
}

function PublicFormSuccess({ receipt, formId, navigate }: { receipt: Submission; formId: string; navigate: (path: string) => void }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <section className="public-success-page">
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 22, stiffness: 300 }}
        className="public-success-card"
      >
        <motion.div className="public-success-icon" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15, type: "spring", damping: 15, stiffness: 400 }}>
          <Check size={48} strokeWidth={3} />
        </motion.div>
        <h1>Thank you!</h1>
        <p>Your response has been recorded and verified on the Walrus network.</p>
        <div className="public-success-actions">
          <button className="primary" onClick={() => window.location.reload()}>
            <Plus size={16} /> Submit another response
          </button>
          <button className="secondary" onClick={() => navigate(`/admin/${formId}`)}>
            <BarChart3 size={16} /> View responses
          </button>
        </div>
        <button className="public-success-toggle" onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "Hide" : "Show"} verification details
          <ChevronDown size={14} style={{ transform: showDetails ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
        </button>
        <AnimatePresence>
          {showDetails && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="public-success-details">
              <dl>
                <dt>Submission blob</dt>
                <dd>{receipt.submissionBlob.id}</dd>
                <dt>Sui transaction</dt>
                <dd><a className="proof-link" href={testnetTxUrl(receipt.txDigest)} target="_blank" rel="noreferrer">{receipt.txDigest}</a></dd>
                <dt>Storage</dt>
                <dd>{receipt.submissionBlob.storage === "walrus" ? "Walrus Testnet" : "Local fallback"}</dd>
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
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
    <div className={`response-field ${error ? "has-error" : ""}`}>
      <div className="response-field-header">
        <label className="response-field-label">{field.label || "Untitled Question"}{field.required ? <span className="response-required">*</span> : null}</label>
        {field.required ? <span className="response-required-pill">Required</span> : null}
      </div>
      {field.helper ? <p className="response-field-helper">{field.helper}</p> : null}

      {field.type === "shortText" && (
        <input className="response-input" type="text" value={String(value ?? "")} onChange={(e) => onValue(e.target.value)} placeholder="Your answer" />
      )}

      {field.type === "richText" && (
        <AutoResizeTextarea value={String(value ?? "")} onChange={(v) => onValue(v)} placeholder="Your answer" />
      )}

      {field.type === "url" && (
        <input className="response-input" type="url" value={String(value ?? "")} onChange={(e) => onValue(e.target.value)} placeholder="https://" />
      )}

      {field.type === "dropdown" && (
        <div className="response-dropdown" ref={dropdownRef}>
          <button className={`response-dropdown-trigger ${!value ? "placeholder" : ""}`} onClick={() => setDropdownOpen(!dropdownOpen)}>
            {String(value || "Select an option")}
            <ChevronDown size={16} style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", marginLeft: "auto" }} />
          </button>
          <AnimatePresence>
            {dropdownOpen && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="response-dropdown-menu">
                {field.options?.map((option) => (
                  <button key={option} className={value === option ? "active" : ""} onClick={() => { onValue(option); setDropdownOpen(false); }}>
                    {option}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {field.type === "checkboxes" && (
        <div className="response-checkboxes">
          {field.options?.map((option) => {
            const checked = Array.isArray(value) && value.includes(option);
            return (
              <label key={option} className={`response-checkbox ${checked ? "checked" : ""}`}>
                <input type="checkbox" checked={checked} onChange={(e) => {
                  const current = Array.isArray(value) ? value : [];
                  onValue(e.target.checked ? [...current, option] : current.filter((item) => item !== option));
                }} />
                <span className="response-checkbox-box">{checked && <Check size={14} strokeWidth={3} />}</span>
                <span className="response-checkbox-label">{option}</span>
              </label>
            );
          })}
        </div>
      )}

      {field.type === "rating" && (
        <div className="response-rating">
          {[1, 2, 3, 4, 5].map((star) => {
            const isActive = (hoverRating || Number(value || 0)) >= star;
            return (
              <button key={star} type="button" onClick={() => onValue(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} className={isActive ? "active" : ""}>
                <Star size={32} fill={isActive ? "currentColor" : "none"} strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      )}

      {(field.type === "image" || field.type === "video") && (
        <div className="response-file">
          {!file ? (
            <div className={`file-drop-zone ${isFileDragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setIsFileDragging(true); }} onDragLeave={() => setIsFileDragging(false)} onDrop={handleFileDrop} onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept={field.type === "image" ? "image/*" : "video/*"} style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <Upload size={24} />
              <span>Click or drop {field.type === "image" ? "image" : "video"} here</span>
            </div>
          ) : (
            <div className="file-pill">
              {field.type === "image" ? <Image size={16} /> : <FileVideo size={16} />}
              <span>{file.name}</span>
              <small>{formatFileSize(file.size)}</small>
              <button type="button" onClick={(e) => { e.preventDefault(); onClearFile(); }} aria-label="Clear selected file"><X size={14} /></button>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, height: 0, y: -4 }} animate={{ opacity: 1, height: "auto", y: 0 }} exit={{ opacity: 0, height: 0, y: -4 }} transition={{ duration: 0.2 }} className="response-error">
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
  const [form] = useState(() => getForm(formId));
  const [submissions, setSubmissions] = useState(() => getSubmissions(formId));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [viewType, setViewType] = useState<"grid" | "table">("table");
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) setPriorityOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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

  const stats = useMemo(() => {
    const total = submissions.length;
    const newCount = submissions.filter((s) => s.status === "new").length;
    const reviewed = submissions.filter((s) => s.status === "reviewed" || s.status === "prioritized").length;
    const withMedia = submissions.filter((s) => Object.keys(s.media).length > 0).length;
    return { total, newCount, reviewed, withMedia };
  }, [submissions]);

  if (!form) {
    return (
      <section className="center-state">
        <h1>No form found</h1>
        <button className="primary" onClick={() => navigate("/")}>Back to workspace</button>
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
      "submission_id", "created_at", "status", "priority", "submitter", "submission_blob", "tx_digest",
      ...fields.map((field) => field.label),
    ];
    const rows = filtered.map((submission) =>
      [
        submission.id, submission.createdAt, submission.status, submission.priority,
        submission.submitter, submission.submissionBlob.id, submission.txDigest,
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
    toast.success("CSV exported");
  }

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <button className="back-btn" onClick={() => navigate("/")} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="dashboard-title-group">
          <h1>{adminSchema.title}</h1>
          <p className="muted">{submissions.length} submission{submissions.length === 1 ? "" : "s"} &middot; {adminSchema.fields.length} question{adminSchema.fields.length === 1 ? "" : "s"}</p>
        </div>
        <div className="dashboard-header-actions">
          <button className="secondary" onClick={() => navigate(`/f/${activeForm.id}`)}>
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
          <div className="filter-dropdown" ref={statusRef}>
            <button className="filter-dropdown-trigger" onClick={() => setStatusOpen(!statusOpen)}>
              <Filter size={14} /> Status: <strong>{status === "all" ? "All" : status}</strong>
              <ChevronDown size={14} style={{ marginLeft: "auto", transform: statusOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
            </button>
            <AnimatePresence>
              {statusOpen && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="filter-dropdown-menu">
                  {["all", "new", "reviewed", "prioritized", "archived"].map((s) => (
                    <button key={s} className={status === s ? "active" : ""} onClick={() => { setStatus(s); setStatusOpen(false); }}>
                      {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="filter-dropdown" ref={priorityRef}>
            <button className="filter-dropdown-trigger" onClick={() => setPriorityOpen(!priorityOpen)}>
              <TrendingUp size={14} /> Priority: <strong>{priority === "all" ? "All" : priority}</strong>
              <ChevronDown size={14} style={{ marginLeft: "auto", transform: priorityOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
            </button>
            <AnimatePresence>
              {priorityOpen && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="filter-dropdown-menu">
                  {["all", "low", "medium", "high"].map((p) => (
                    <button key={p} className={priority === p ? "active" : ""} onClick={() => { setPriority(p); setPriorityOpen(false); }}>
                      {p === "all" ? "All priorities" : p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </motion.div>
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

      {!submissions.length ? (
        <div className="empty-state">
          <div className="empty-state-icon"><MessageSquareText size={32} /></div>
          <h2>No submissions yet</h2>
          <p>Open the public form and send a test response.</p>
          <button className="primary" onClick={() => navigate(`/f/${activeForm.id}`)}>
            <ExternalLink size={16} /> Open public form
          </button>
        </div>
      ) : submissions.length > 0 && !filtered.length ? (
        <div className="empty-state">
          <div className="empty-state-icon"><AlertCircle size={32} /></div>
          <h2>No matching submissions</h2>
          <p>Clear filters or adjust your search query.</p>
          <button className="secondary" onClick={() => { setQuery(""); setStatus("all"); setPriority("all"); }}>
            <X size={16} /> Clear filters
          </button>
        </div>
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
                <th>Media</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((submission) => (
                <tr key={submission.id}>
                  <td>
                    <div className="cell-date">{new Date(submission.createdAt).toLocaleDateString()}</div>
                    <div className="cell-time">{new Date(submission.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </td>
                  <td>
                    <StatusBadge value={submission.status} onChange={(v) => patchSubmission(submission, { status: v as Submission["status"] })} />
                  </td>
                  <td>
                    <PriorityBadge value={submission.priority} onChange={(v) => patchSubmission(submission, { priority: v as Submission["priority"] })} />
                  </td>
                  {adminSchema.fields.slice(0, 4).map((field) => (
                    <td key={field.id}>
                      <span className="cell-value" title={formatValue(submission.values[field.id])}>
                        {formatValue(submission.values[field.id]) || "-"}
                      </span>
                    </td>
                  ))}
                  {adminSchema.fields.length > 4 && <td className="cell-muted">+{adminSchema.fields.length - 4}</td>}
                  <td>
                    {Object.values(submission.media).length > 0 ? (
                      <span className="media-badge">{Object.values(submission.media).length} file{Object.values(submission.media).length === 1 ? "" : "s"}</span>
                    ) : (
                      <span className="cell-muted">-</span>
                    )}
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
              <div className="submission-card-header">
                <div className="submission-card-date">
                  <Calendar size={14} />
                  {new Date(submission.createdAt).toLocaleString()}
                </div>
                <div className="submission-card-badges">
                  <StatusBadge value={submission.status} onChange={(v) => patchSubmission(submission, { status: v as Submission["status"] })} />
                  <PriorityBadge value={submission.priority} onChange={(v) => patchSubmission(submission, { priority: v as Submission["priority"] })} />
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
          ))}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ value, onChange }: { value: Submission["status"]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  const config: Record<string, { label: string; class: string }> = {
    new: { label: "New", class: "status-new" },
    reviewed: { label: "Reviewed", class: "status-reviewed" },
    prioritized: { label: "Prioritized", class: "status-prioritized" },
    archived: { label: "Archived", class: "status-archived" },
  };
  const current = config[value] ?? config.new;
  return (
    <div className="badge-dropdown" ref={ref}>
      <button className={`badge ${current.class}`} onClick={() => setOpen(!open)}>
        {current.label} <ChevronDown size={12} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="badge-dropdown-menu">
            {Object.entries(config).map(([key, cfg]) => (
              <button key={key} className={value === key ? "active" : ""} onClick={() => { onChange(key); setOpen(false); }}>
                <span className={`dot ${cfg.class}`} /> {cfg.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PriorityBadge({ value, onChange }: { value: Submission["priority"]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  const config: Record<string, { label: string; class: string }> = {
    low: { label: "Low", class: "priority-low" },
    medium: { label: "Medium", class: "priority-medium" },
    high: { label: "High", class: "priority-high" },
  };
  const current = config[value] ?? config.medium;
  return (
    <div className="badge-dropdown" ref={ref}>
      <button className={`badge ${current.class}`} onClick={() => setOpen(!open)}>
        {current.label} <ChevronDown size={12} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="badge-dropdown-menu">
            {Object.entries(config).map(([key, cfg]) => (
              <button key={key} className={value === key ? "active" : ""} onClick={() => { onChange(key); setOpen(false); }}>
                <span className={`dot ${cfg.class}`} /> {cfg.label}
              </button>
            ))}
          </motion.div>
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
