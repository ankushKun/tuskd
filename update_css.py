import sys

with open("src/styles.css", "r") as f:
    content = f.read()

old_builder_css = """.builder-container {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 65px);
  background: var(--bg);
}

.builder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 65px;
  z-index: 20;
}

.builder-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.back-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--fg-muted);
}
.back-btn:hover {
  background: var(--bg-muted);
  color: var(--fg);
}

.builder-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.builder-title {
  border: none;
  background: transparent;
  font-size: 18px;
  font-weight: 700;
  color: var(--fg);
  padding: 4px 8px;
  margin-left: -8px;
  border-radius: var(--radius-sm);
}
.builder-title:hover, .builder-title:focus {
  background: var(--bg-muted);
  outline: none;
}

.save-status {
  font-size: 11px;
  padding-left: 4px;
  color: var(--fg-muted);
}
.save-status.dirty {
  color: #d97821;
}

.builder-tabs {
  display: flex;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 4px;
  gap: 4px;
}
.builder-tabs button {
  border: none;
  background: transparent;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-muted);
}
.builder-tabs button.active {
  background: var(--bg-panel);
  color: var(--fg);
  box-shadow: var(--shadow-color) 0px 2px 4px;
}

.builder-header-right {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex: 1;
}

.builder-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
}

.builder-canvas {
  width: 100%;
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.builder-desc {
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--fg-muted);
  resize: none;
  padding: 8px;
  margin-left: -8px;
  border-radius: var(--radius-sm);
  min-height: 48px;
  margin-bottom: 24px;
}
.builder-desc:hover, .builder-desc:focus {
  background: var(--bg-muted);
  outline: none;
}

/* Inline Add Field Button */
.add-field-container {
  display: flex;
  justify-content: center;
  position: relative;
  height: 24px;
  margin: 4px 0;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 5;
}
.add-field-container.bottom {
  opacity: 1;
  height: auto;
  margin: 32px 0;
}
.builder-canvas:hover .add-field-container, .add-field-container:focus-within {
  opacity: 1;
}
.add-field-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  padding: 4px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted);
  box-shadow: var(--shadow-float);
}
.add-field-container.bottom .add-field-btn {
  padding: 12px 24px;
  font-size: 15px;
}
.add-field-btn:hover {
  background: var(--primary);
  color: var(--primary-fg);
  border-color: var(--primary);
}

.field-type-popover {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 20px 40px var(--shadow-color);
  width: 320px;
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  z-index: 50;
  margin-top: 8px;
}
.add-field-container.bottom .field-type-popover {
  top: auto;
  bottom: 100%;
  margin-top: 0;
  margin-bottom: 8px;
}
.field-type-popover button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
}
.field-type-popover button:hover {
  background: var(--bg-accent);
  border-color: var(--primary);
  color: var(--primary);
}

/* Inline Field Editor Shell */
.inline-field-shell {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 24px;
  position: relative;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.inline-field-shell.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--bg-accent);
}
.inline-field-shell.has-issue {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-bg);
}

.field-actions-toolbar {
  position: absolute;
  top: -16px;
  right: 24px;
  display: flex;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  box-shadow: var(--shadow-float);
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
}
.inline-field-shell:hover .field-actions-toolbar,
.inline-field-shell:focus-within .field-actions-toolbar {
  opacity: 1;
}
.field-actions-toolbar button, .field-actions-toolbar .drag-handle-inline {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}
.field-actions-toolbar .drag-handle-inline {
  cursor: grab;
}
.field-actions-toolbar button:hover, .field-actions-toolbar .drag-handle-inline:hover {
  background: var(--bg-muted);
  color: var(--fg);
}
.field-actions-toolbar button.danger:hover {
  color: var(--danger);
  background: var(--danger-bg);
}

.inline-field-editor-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--border);
}

.builder-settings-panel {
  width: 100%;
  max-width: 600px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}"""

new_builder_css = """.builder-container {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 65px);
  background: var(--bg);
}

.builder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 65px;
  z-index: 20;
  gap: 16px;
}

.builder-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.back-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--fg-muted);
  flex-shrink: 0;
  transition: all 0.15s;
}
.back-btn:hover {
  background: var(--bg-muted);
  color: var(--fg);
}

.builder-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.builder-title {
  border: none;
  background: transparent;
  font-size: 17px;
  font-weight: 700;
  color: var(--fg);
  padding: 4px 8px;
  margin-left: -8px;
  border-radius: var(--radius-sm);
  width: 100%;
}
.builder-title:hover, .builder-title:focus {
  background: var(--bg-muted);
  outline: none;
}

.save-status {
  font-size: 11px;
  padding-left: 4px;
  color: var(--fg-muted);
  font-weight: 600;
}
.save-status.dirty {
  color: #d97821;
}

.builder-tabs {
  display: flex;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 4px;
  gap: 4px;
  flex-shrink: 0;
}
.builder-tabs button {
  border: none;
  background: transparent;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-muted);
  transition: all 0.15s;
  white-space: nowrap;
}
.builder-tabs button.active {
  background: var(--bg-panel);
  color: var(--fg);
  box-shadow: 0 1px 3px var(--shadow-color);
}
.builder-tabs button:hover:not(.active) {
  color: var(--fg);
}

.builder-header-right {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex: 1;
}

.builder-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px 80px;
}

.builder-canvas {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.builder-desc {
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--fg-muted);
  resize: none;
  padding: 10px 12px;
  margin-left: -12px;
  border-radius: var(--radius-sm);
  min-height: 48px;
  margin-bottom: 16px;
  width: calc(100% + 24px);
  line-height: 1.5;
}
.builder-desc:hover, .builder-desc:focus {
  background: var(--bg-muted);
  outline: none;
}

/* Add Field Divider */
.add-field-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: 28px;
  margin: 0;
  opacity: 0;
  transition: opacity 0.2s;
}
.add-field-divider.bottom {
  opacity: 1;
  margin-top: 16px;
}
.builder-canvas:hover .add-field-divider,
.add-field-divider:focus-within {
  opacity: 1;
}
.add-field-divider::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--border);
}
.add-field-divider-btn {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--fg-muted);
  cursor: pointer;
  box-shadow: 0 2px 8px var(--shadow-color);
  transition: all 0.15s;
}
.add-field-divider-btn:hover {
  background: var(--primary);
  color: var(--primary-fg);
  border-color: var(--primary);
  transform: scale(1.1);
}

/* Field Card */
.field-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 20px 24px 24px;
  position: relative;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.field-card:hover:not(.selected) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--shadow-color);
}
.field-card.selected {
  border-color: var(--primary);
}
.field-card.has-issue {
  border-color: var(--danger);
}

.field-card-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.field-card-toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.field-card-toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}
.field-card:hover .field-card-toolbar-right,
.field-card.selected .field-card-toolbar-right {
  opacity: 1;
}
.field-card-tool {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.field-card-tool:hover {
  background: var(--bg-muted);
  color: var(--fg);
}
.field-card-tool.danger:hover {
  color: var(--danger);
  background: var(--danger-bg);
}
.field-card-tool.drag {
  cursor: grab;
}
.field-card-tool.drag:active {
  cursor: grabbing;
}

.field-card-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.field-card-title-input {
  width: 100%;
  border: none;
  border-bottom: 2px solid var(--border);
  background: transparent;
  font-size: 20px;
  font-weight: 700;
  color: var(--fg);
  padding: 4px 0 8px;
  line-height: 1.3;
  transition: border-color 0.2s;
}
.field-card-title-input:focus {
  outline: none;
  border-color: var(--primary);
}
.field-card-title-input::placeholder {
  color: var(--fg-muted);
}
.field-card-desc-input {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--fg-muted);
  resize: none;
  padding: 4px 0;
  line-height: 1.5;
  min-height: 28px;
  overflow: hidden;
}
.field-card-desc-input:focus {
  outline: none;
}
.field-card-desc-input::placeholder {
  color: var(--fg-muted);
  opacity: 0.6;
}

.field-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.field-card-required {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
  cursor: pointer;
}
.field-card-required input {
  width: auto;
  accent-color: var(--primary);
}
.field-card-issue {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--danger);
  font-size: 13px;
  font-weight: 600;
}

/* Field Preview */
.field-preview-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.field-preview-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.field-preview-label span {
  font-size: 16px;
  font-weight: 700;
  color: var(--fg);
}
.field-preview-label em {
  color: var(--danger);
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
}
.field-preview-helper {
  margin: -4px 0 0;
  color: var(--fg-muted);
  font-size: 14px;
}

/* Inline Editor Components */
.field-inline-editor {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.field-inline-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
}
.field-inline-row > label:first-child {
  font-size: 11px;
  font-weight: 800;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field-custom-select {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  padding: 9px 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
  cursor: pointer;
  text-align: left;
}
.field-custom-select:hover {
  border-color: var(--primary);
}
.field-custom-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 40px var(--shadow-color);
  z-index: 30;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-custom-select-dropdown button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--fg);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.field-custom-select-dropdown button:hover,
.field-custom-select-dropdown button.active {
  background: var(--bg-accent);
  color: var(--primary);
}

.field-options-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-option-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.field-option-drag {
  display: grid;
  place-items: center;
  color: var(--fg-muted);
  cursor: grab;
}
.field-option-row input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  padding: 8px 10px;
  font-size: 14px;
  color: var(--fg);
}
.field-option-row input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--bg-accent);
}
.field-option-remove {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}
.field-option-remove:hover {
  color: var(--danger);
  background: var(--danger-bg);
}
.field-option-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 8px 12px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.field-option-add:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--bg-accent);
}

/* Builder Empty State */
.builder-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding: 60px 20px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
}
.builder-empty-icon {
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  border-radius: var(--radius-full);
  background: var(--bg-accent);
  color: var(--primary);
}
.builder-empty-state h2 {
  font-size: 22px;
  font-weight: 800;
  margin: 0;
}
.builder-empty-state p {
  color: var(--fg-muted);
  font-size: 15px;
  max-width: 360px;
  margin: 0;
}

/* Settings Panel */
.builder-settings-panel {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.settings-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.settings-card h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}
.settings-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.settings-toggle input {
  display: none;
}
.toggle-track {
  width: 44px;
  height: 24px;
  background: var(--bg-muted);
  border-radius: var(--radius-full);
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
.settings-toggle input:checked + .toggle-track {
  background: var(--primary);
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: white;
  border-radius: var(--radius-full);
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.settings-toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(20px);
}
.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.settings-hint {
  color: var(--fg-muted);
  font-size: 13px;
  margin: 0;
}
.layout-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.layout-options button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 18px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.layout-options button:hover {
  border-color: var(--primary);
  background: var(--bg-accent);
}
.layout-options button.active {
  border-color: var(--primary);
  background: var(--bg-accent);
  box-shadow: 0 0 0 2px var(--bg-accent);
}
.layout-options button strong {
  font-size: 15px;
}
.layout-options button span {
  font-size: 13px;
  color: var(--fg-muted);
}"""

if old_builder_css in content:
    content = content.replace(old_builder_css, new_builder_css)
    with open("src/styles.css", "w") as f:
        f.write(content)
    print("CSS updated successfully.")
else:
    print("Old builder CSS block not found exactly. Appending new CSS instead.")
    with open("src/styles.css", "a") as f:
        f.write("\n" + new_builder_css + "\n")
