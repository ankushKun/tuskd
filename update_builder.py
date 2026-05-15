import sys

with open("src/App.tsx", "r") as f:
    lines = f.readlines()

# Find the line indices (0-based)
start_line = None
end_line = None
for i, line in enumerate(lines):
    if line.startswith("function Builder({"):
        start_line = i
    if start_line is not None and line.startswith("function PublicForm({"):
        end_line = i
        break

if start_line is None or end_line is None:
    print("Could not find markers")
    sys.exit(1)

new_section = '''function Builder({ formId, navigate }: { formId?: string; navigate: (path: string) => void }) {
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
'''

# Replace lines from start_line to end_line-1 with new_section
new_lines = lines[:start_line] + [new_section + "\n"] + lines[end_line:]

with open("src/App.tsx", "w") as f:
    f.writelines(new_lines)

print(f"Replaced lines {start_line+1} to {end_line} with new builder section.")
