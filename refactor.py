import sys

with open("src/App.tsx", "r") as f:
    content = f.read()

start_marker = "function Builder({ formId, navigate }: { formId?: string; navigate: (path: string) => void }) {"
end_marker = "function PublicForm({ formId, navigate }: { formId: string; navigate: (path: string) => void }) {"

if start_marker not in content or end_marker not in content:
    print("Markers not found!")
    sys.exit(1)

start_idx = content.index(start_marker)
end_idx = content.index(end_marker)

new_content = """function Builder({ formId, navigate }: { formId?: string; navigate: (path: string) => void }) {
  const [form, setForm] = useState<StoredForm | null>(() => (formId ? getForm(formId) : null));
  const [schema, setSchema] = useState<FormSchema>(() => getForm(formId ?? "")?.draftSchema ?? createDefaultSchema());
  const [selectedId, setSelectedId] = useState(schema.fields[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"build" | "settings" | "preview">("build");
  const [copied, setCopied] = useState(false);

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

  function insertField(type: FieldType, index: number) {
    const field = createField(type);
    setSchema((current) => {
      const fields = [...current.fields];
      fields.splice(index, 0, field);
      return { ...current, fields };
    });
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
      if (selectedId === fieldId) setSelectedId(fields[0]?.id ?? "");
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

      <main className="builder-main">
        {activeTab === "build" && (
           <div className="builder-canvas">
             <textarea className="builder-desc" value={schema.description} onChange={e => setSchema({...schema, description: e.target.value})} placeholder="Form description or instructions..." />
             <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
               <SortableContext items={schema.fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                 {schema.fields.map((field, index) => (
                   <React.Fragment key={field.id}>
                     <AddFieldButton onSelect={(type) => insertField(type, index)} />
                     <SortableField 
                       field={field} 
                       index={index} 
                       isSelected={selectedId === field.id}
                       onSelect={() => setSelectedId(field.id)}
                       onUpdate={(patch) => updateField(field.id, patch)}
                       onRemove={() => removeField(field.id)}
                       onDuplicate={() => duplicateField(field.id)}
                       issue={issueByField.get(field.id)}
                     />
                   </React.Fragment>
                 ))}
                 <AddFieldButton onSelect={(type) => insertField(type, schema.fields.length)} isBottom />
               </SortableContext>
             </DndContext>
           </div>
        )}
        {activeTab === "settings" && (
          <div className="builder-settings-panel">
            <div>
              <p className="eyebrow">Privacy</p>
              <h2>End-to-End Encryption</h2>
              <label className="switch-row" style={{marginTop: 12}}>
                <input
                  type="checkbox"
                  checked={schema.encrypted}
                  onChange={(event) => setSchema({ ...schema, encrypted: event.target.checked })}
                />
                <span><Lock size={15} /> Seal private mode (Payloads encrypted before Walrus upload)</span>
              </label>
            </div>
            
            <div style={{marginTop: 12}}>
              <p className="eyebrow">Presentation</p>
              <h2>Form Layout</h2>
              <div className="view-toggle" style={{width: 'fit-content', marginTop: 12}}>
                <button 
                  className={schema.layout !== "slides" ? "active" : ""} 
                  onClick={() => setSchema({ ...schema, layout: "standard" })}
                  title="Standard Layout"
                  style={{padding: '8px 16px', width: 'auto'}}
                >
                  <LayoutList size={16} style={{marginRight: 8}} /> Standard
                </button>
                <button 
                  className={schema.layout === "slides" ? "active" : ""} 
                  onClick={() => setSchema({ ...schema, layout: "slides" })}
                  title="Slides Layout"
                  style={{padding: '8px 16px', width: 'auto'}}
                >
                  <LayoutTemplate size={16} style={{marginRight: 8}} /> Slides
                </button>
              </div>
            </div>

            {schemaIssues.length > 0 && (
              <div style={{marginTop: 12}}>
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
              <div style={{marginTop: 12}}>
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
          </div>
        )}
        {activeTab === "preview" && (
           <div className="public-wrap" style={{width: '100%', margin: 0, border: '1px solid var(--border)'}}>
             <PublicFormPreview schema={schema} />
           </div>
        )}
      </main>
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
    ...(isDragging ? { zIndex: 10, opacity: 0.5 } : {}),
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div 
        className={`inline-field-shell ${isSelected ? "selected" : ""} ${issue?.length ? "has-issue" : ""}`}
        onClick={() => !isSelected && onSelect()}
      >
        <div className="field-actions-toolbar">
          <div className="drag-handle-inline" {...attributes} {...listeners}><GripVertical size={16}/></div>
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }}><Copy size={16}/></button>
          <button className="danger" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Trash2 size={16}/></button>
        </div>
        
        {isSelected ? (
          <motion.div initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: "auto"}} transition={{duration: 0.2}}>
            <div style={{display: 'flex', gap: 12, alignItems: 'center'}}>
               <span className="field-number">{index + 1}</span>
               <input 
                 className="title-input" 
                 style={{fontSize: 20, padding: 0, flex: 1}} 
                 value={field.label} 
                 onChange={e => onUpdate({label: e.target.value})} 
                 placeholder="Question..." 
                 autoFocus
               />
            </div>
            <div className="inline-field-editor-content">
               <textarea 
                 className="description-input" 
                 style={{minHeight: 32, marginTop: 0}} 
                 value={field.helper ?? ""} 
                 onChange={e => onUpdate({helper: e.target.value})} 
                 placeholder="Description or instructions (optional)..."
               />
               <FieldEditorInline field={field} updateField={onUpdate} />
               <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12}}>
                 <label className="switch-row" style={{display: 'flex', alignItems: 'center'}}>
                   <input type="checkbox" checked={field.required} onChange={e => onUpdate({required: e.target.checked})} style={{width: 'auto'}} />
                   <span style={{fontWeight: 600}}>Required</span>
                 </label>
                 {issue && issue.length > 0 && (
                   <span style={{color: 'var(--danger)', fontSize: 13, fontWeight: 600}}><AlertCircle size={14} style={{display: 'inline', verticalAlign: 'middle', marginRight: 4}}/>{issue[0]}</span>
                 )}
               </div>
            </div>
          </motion.div>
        ) : (
          <div style={{pointerEvents: 'none'}}>
            <div style={{display: 'flex', gap: 12, alignItems: 'flex-start'}}>
               <span className="field-number">{index + 1}</span>
               <FieldPreview field={field} issues={issue ?? []} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FieldEditorInline({ field, updateField }: { field: Field, updateField: (p: Partial<Field>) => void }) {
  const options = field.options ?? [];
  const usesOptions = field.type === "dropdown" || field.type === "checkboxes";

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
      <div>
        <label style={{fontSize: 12, fontWeight: 800, color: 'var(--fg-muted)', textTransform: 'uppercase'}}>Field Type</label>
        <select className="secondary" value={field.type} onChange={(e) => updateField({type: e.target.value as FieldType, options: (e.target.value === "dropdown" || e.target.value === "checkboxes") ? (options.length ? options : ["Option 1", "Option 2"]) : undefined})} style={{marginTop: 6, width: '100%', minHeight: 40}}>
           {fieldTypes.map(item => <option key={item.type} value={item.type}>{item.label}</option>)}
        </select>
      </div>
      {usesOptions && (
        <div>
           <label style={{fontSize: 12, fontWeight: 800, color: 'var(--fg-muted)', textTransform: 'uppercase'}}>Options</label>
           <div className="option-editor" style={{marginTop: 6}}>
             {options.map((opt, i) => (
                <div className="option-row" key={i}>
                  <input value={opt} onChange={e => { const no = [...options]; no[i] = e.target.value; updateField({options: no}) }} placeholder={`Option ${i+1}`} />
                  <button onClick={() => updateField({options: options.filter((_, idx) => idx !== i)})}><X size={14}/></button>
                </div>
             ))}
             <button className="secondary" onClick={() => updateField({options: [...options, `Option ${options.length + 1}`]})} style={{width: 'fit-content'}}><Plus size={14}/> Add Option</button>
           </div>
        </div>
      )}
    </div>
  )
}

function AddFieldButton({ onSelect, isBottom }: { onSelect: (type: FieldType) => void, isBottom?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`add-field-container ${isBottom ? 'bottom' : ''}`} onMouseLeave={() => setOpen(false)}>
      <button className="add-field-btn" onClick={() => setOpen(!open)}>
        <Plus size={16} /> {isBottom && "Add Question"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{opacity: 0, y: -10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -10}} className="field-type-popover">
            {fieldTypes.map(item => (
               <button key={item.type} onClick={() => { onSelect(item.type); setOpen(false); }}>
                 <item.icon size={20} />
                 <span>{item.label}</span>
               </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PublicFormPreview({ schema }: { schema: FormSchema }) {
  return (
    <div style={{padding: '0', pointerEvents: 'none'}}>
      <div className="public-header" style={{borderTopLeftRadius: 'var(--radius-md)', borderTopRightRadius: 'var(--radius-md)'}}>
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
  )
}
"""

with open("src/App.tsx", "w") as f:
    f.write(content[:start_idx] + new_content + "\n" + content[end_idx:])
