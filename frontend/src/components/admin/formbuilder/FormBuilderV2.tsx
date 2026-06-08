// ─────────────────────────────────────────────────────────────────────────────
// Form Builder — three-panel canvas editor (palette │ canvas │ properties).
//
// The only form-template editor. Left palette adds fields; middle canvas drags
// to reorder and moves fields in/out of group/table containers; right panel
// (PropertiesPanel) edits the selected field via Basic/Logic/Display tabs.
// Save / version / mutation logic writes the same schema the DynamicForm renderer
// reads, so existing forms are never affected — only the editing UX.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, closestCenter, pointerWithin, rectIntersection,
  PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragStartEvent, type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import apiClient from '../../../services/apiClient';
import { useLang } from '../../../context/LanguageContext';
import { VersionHistory as LegacyVersionHistory } from '../FormsTab';
import FieldPalette from './FieldPalette';
import CanvasField from './CanvasField';
import PropertiesPanel from './PropertiesPanel';
import DynamicForm from '../../forms/DynamicForm';
import { catalogFor, fieldGlyph } from './fieldCatalog';
import {
  GRADIENT_OPTIONS, DEFAULT_REPEAT_MAX_ROWS, mirrorFields, genCode,
  type FormField, type TemplateDetail, type Department,
} from './types';

// Stable per-field UID used as the dnd-kit sortable id. Lives only in builder
// state — never written to the saved schema.
function genUid(): string {
  return (crypto?.randomUUID?.() ?? `uid_${Math.random().toString(16).slice(2)}`);
}

// New field factory — mirrors legacy addField defaults plus type-specific seeds.
function newFieldOfType(type: string, count: number): FormField {
  const base: FormField = {
    name: `field_${count + 1}`,
    label: type === 'header' ? '新しい見出し' : '新規項目',
    label_en: type === 'header' ? 'New section' : 'New field',
    type,
    required: false,
  };
  if (type === 'repeat_group') {
    base.fields = [];
    base.min_rows = 0;
    base.max_rows = DEFAULT_REPEAT_MAX_ROWS;
  }
  if (type === 'field_group') {
    base.label = 'グループ';
    base.label_en = 'Group';
    base.fields = [];
  }
  if (type === 'select' || type === 'checkbox') base.options = [];
  return base;
}

type MobileTab = 'add' | 'build' | 'edit';

// Container types cannot be nested inside another container.
const CONTAINER_TYPES = new Set(['field_group', 'repeat_group']);

// Droppable wrapper around a container's children — gives an empty box (and the
// area below its children) a valid drop target id `z:<uid>` for cross-zone drags.
function ContainerDropZone({ uid, active, children }: { uid: string; active: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `z:${uid}` });
  return (
    <div
      ref={setNodeRef}
      className={`ml-6 mt-1 pl-2 border-l-2 transition-colors ${
        isOver || active ? 'border-ringo-400' : 'border-ringo-200/70'
      }`}
    >
      {children}
    </div>
  );
}

// Bottom drop target for the root list — drop a field/group at the very end.
function RootDropZone({ label }: { label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'z:root' });
  return (
    <div
      ref={setNodeRef}
      className={`mt-1.5 rounded-lg border border-dashed text-[11px] text-center py-2 transition-colors ${
        isOver ? 'border-ringo-400 bg-ringo-50/60 text-ringo-600' : 'border-warmgray-200/70 text-warmgray-300'
      }`}
    >
      {label}
    </div>
  );
}

export default function FormBuilderV2({
  templateId, onClose, showToast,
}: {
  templateId: string | null;
  onClose:    () => void;
  showToast:  (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const isNew = templateId === null;

  const { data: detail } = useQuery<TemplateDetail>({
    queryKey: ['form-templates', templateId],
    queryFn:  async () => (await apiClient.get(`/admin/form-templates/${templateId}`)).data,
    enabled:  !isNew,
  });
  const activeVersion = detail?.versions.find((v) => v.is_active);

  // ── Editor state (mirrors legacy FormBuilder) ──
  const [code, setCode]                       = useState('');
  const [titleJa, setTitleJa]                 = useState('');
  const [titleEn, setTitleEn]                 = useState('');
  const [patternId, setPatternId]             = useState(1);
  const [icon, setIcon]                       = useState('📋');
  const [gradient, setGradient]               = useState('from-slate-400 to-slate-500');
  const [descJa, setDescJa]                   = useState('');
  const [descEn, setDescEn]                   = useState('');
  const [appNumberPrefix, setAppNumberPrefix] = useState('RNG');
  const [appNumberDigits, setAppNumberDigits] = useState(6);
  const [fields, setFields]                   = useState<FormField[]>([]);
  const [settleFields, setSettleFields]       = useState<FormField[]>([]);
  const [idsRingi, setIdsRingi]               = useState<string[]>([]);
  const [idsSettle, setIdsSettle]             = useState<string[]>([]);
  const [editingSettle, setEditingSettle]     = useState(false);
  const [notes]                               = useState('');
  const [showHistory, setShowHistory]         = useState(false);
  // New form: open on Settings first. Editing: open on fields.
  const [showSettings, setShowSettings]       = useState(isNew);
  const [allowedDepts, setAllowedDepts]       = useState<string[]>([]);
  const [selectedUid, setSelectedUid]         = useState<string | null>(null);
  // When editing a child of the selected group/repeat container, its index here.
  const [selectedChild, setSelectedChild]     = useState<number | null>(null);
  const [mobileTab, setMobileTab]             = useState<MobileTab>('build');
  const [canvasMode, setCanvasMode]           = useState<'build' | 'preview'>('build');
  const [activeDrag, setActiveDrag]           = useState<{ glyph: string; label: string } | null>(null);

  const { data: departments } = useQuery<Department[]>({
    queryKey: ['admin', 'departments-list'],
    queryFn:  async () => (await apiClient.get('/admin/departments')).data,
    staleTime: 5 * 60_000,
  });

  // Auto-assign code for new templates on first mount.
  if (isNew && code === '') setCode(genCode());

  // Hydrate from loaded data (once).
  const hydrated = useState(false);
  if (!hydrated[0] && detail && !isNew) {
    setCode(detail.template.code);
    setTitleJa(detail.template.title_ja);
    setTitleEn(detail.template.title);
    setPatternId(detail.template.pattern_id);
    setIcon(detail.template.icon ?? '📋');
    setGradient(detail.template.gradient ?? 'from-slate-400 to-slate-500');
    setDescJa(detail.template.description_ja ?? '');
    setDescEn(detail.template.description_en ?? '');
    setAppNumberPrefix(detail.template.app_number_prefix ?? 'RNG');
    setAppNumberDigits(detail.template.app_number_digits ?? 6);
    setAllowedDepts(detail.allowed_dept_ids ?? []);
    const rfields = activeVersion?.schema_definition?.fields ?? [];
    const sfields = activeVersion?.settlement_schema?.fields ?? [];
    setFields(rfields);
    setSettleFields(sfields);
    setIdsRingi(rfields.map(genUid));
    setIdsSettle(sfields.map(genUid));
    hydrated[1](true);
  }

  const hasSettlement   = patternId === 2 || patternId === 3;
  const hasRingi        = patternId === 1 || patternId === 3;
  const isCustomRenderer = !!(detail?.template?.component_type);

  // Force schema mode for single-schema patterns (same rules as legacy).
  if (patternId === 2 && !isCustomRenderer && !editingSettle) setEditingSettle(true);
  if (patternId === 1 && editingSettle) setEditingSettle(false);

  const currentFields    = editingSettle ? settleFields : fields;
  const setCurrentFields  = editingSettle ? setSettleFields : setFields;
  const currentIds       = editingSettle ? idsSettle : idsRingi;
  const setCurrentIds     = editingSettle ? setIdsSettle : setIdsRingi;
  const otherSchemaFields = editingSettle ? fields : settleFields;

  const isContainer = (f?: FormField | null) => !!f && (f.type === 'field_group' || f.type === 'repeat_group');

  const selTopIndex = selectedUid ? currentIds.indexOf(selectedUid) : -1;
  const selTopField = selTopIndex >= 0 ? currentFields[selTopIndex] : null;
  // While a group/repeat container is in context, the palette adds fields INTO it.
  const containerIndex = isContainer(selTopField) ? selTopIndex : -1;
  const containerField = containerIndex >= 0 ? currentFields[containerIndex] : null;

  const editingChild = selectedChild != null && !!selTopField?.fields && selectedChild < (selTopField.fields.length);
  const selectedField = editingChild ? selTopField!.fields![selectedChild!] : selTopField;
  const selectedIndex = editingChild ? selectedChild! : selTopIndex;
  // Siblings depend on whether we're editing a top-level field or a container child.
  const selSiblings = editingChild ? (selTopField!.fields ?? []) : currentFields;

  const computedFieldNames = currentFields.filter((x) => x.computed && x.type === 'number').map((x) => x.name);

  // Preview remounts only when the schema actually changes (and only while previewing).
  const previewKey = useMemo(
    () => (canvasMode === 'preview' ? JSON.stringify(currentFields) : 'build'),
    [canvasMode, currentFields],
  );

  // ── Top-level helpers ──
  const patchTop = (idx: number, patch: Partial<FormField>) =>
    setCurrentFields(currentFields.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const setChildren = (topIdx: number, children: FormField[]) => patchTop(topIdx, { fields: children });

  const removeTop = (idx: number) => {
    const uid = currentIds[idx];
    setCurrentFields(currentFields.filter((_, i) => i !== idx));
    setCurrentIds(currentIds.filter((_, i) => i !== idx));
    if (selectedUid === uid) { setSelectedUid(null); setSelectedChild(null); }
  };
  const duplicateTop = (idx: number) => {
    const src = currentFields[idx];
    const usedNames = new Set(currentFields.map((f) => f.name));
    let newName = `${src.name}_copy`;
    let n = 2;
    while (usedNames.has(newName)) { newName = `${src.name}_copy${n}`; n += 1; }
    const copy: FormField = JSON.parse(JSON.stringify(src));
    copy.name = newName;
    const uid = genUid();
    const nextFields = [...currentFields];
    const nextIds = [...currentIds];
    nextFields.splice(idx + 1, 0, copy);
    nextIds.splice(idx + 1, 0, uid);
    setCurrentFields(nextFields);
    setCurrentIds(nextIds);
    setSelectedUid(uid); setSelectedChild(null);
  };
  const moveTop = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= currentFields.length) return;
    setCurrentFields(arrayMove(currentFields, idx, target));
    setCurrentIds(arrayMove(currentIds, idx, target));
  };

  // ── Add field — into the active container, else at top level ──
  const addField = (type: string) => {
    if (containerIndex >= 0 && containerField) {
      const children = containerField.fields ?? [];
      setChildren(containerIndex, [...children, newFieldOfType(type, children.length)]);
      setSelectedChild(children.length);
      setMobileTab('edit');
      return;
    }
    const uid = genUid();
    setCurrentFields([...currentFields, newFieldOfType(type, currentFields.length)]);
    setCurrentIds([...currentIds, uid]);
    setSelectedUid(uid); setSelectedChild(null);
    setMobileTab('edit');
  };

  // ── Selection-aware ops (work on the selected field, child or top) ──
  const updateSelected = (patch: Partial<FormField>) => {
    if (selTopIndex < 0) return;
    if (editingChild) {
      setChildren(selTopIndex, (selTopField!.fields ?? []).map((c, j) => (j === selectedChild ? { ...c, ...patch } : c)));
    } else {
      patchTop(selTopIndex, patch);
    }
  };
  const removeSelected = () => {
    if (selTopIndex < 0) return;
    if (editingChild) {
      setChildren(selTopIndex, (selTopField!.fields ?? []).filter((_, j) => j !== selectedChild));
      setSelectedChild(null);
    } else {
      removeTop(selTopIndex);
    }
  };
  const moveSelected = (dir: -1 | 1) => {
    if (selTopIndex < 0) return;
    if (editingChild) {
      const children = selTopField!.fields ?? [];
      const t = selectedChild! + dir;
      if (t < 0 || t >= children.length) return;
      setChildren(selTopIndex, arrayMove(children, selectedChild!, t));
      setSelectedChild(t);
    } else {
      moveTop(selTopIndex, dir);
    }
  };
  const duplicateSelected = () => {
    if (selTopIndex < 0) return;
    if (editingChild) {
      const children = selTopField!.fields ?? [];
      const src = children[selectedChild!];
      const used = new Set(children.map((c) => c.name));
      let nm = `${src.name}_copy`; let n = 2;
      while (used.has(nm)) { nm = `${src.name}_copy${n}`; n += 1; }
      const copy: FormField = JSON.parse(JSON.stringify(src)); copy.name = nm;
      const next = [...children]; next.splice(selectedChild! + 1, 0, copy);
      setChildren(selTopIndex, next); setSelectedChild(selectedChild! + 1);
    } else {
      duplicateTop(selTopIndex);
    }
  };

  // ── Canvas selection + child ops ──
  const selectTop = (uid: string) => { setSelectedUid(uid); setSelectedChild(null); setMobileTab('edit'); };
  const selectChild = (uid: string, childIdx: number) => { setSelectedUid(uid); setSelectedChild(childIdx); setMobileTab('edit'); };
  const removeChildAt = (topIdx: number, childIdx: number) => {
    const children = (currentFields[topIdx]?.fields ?? []).filter((_, j) => j !== childIdx);
    setChildren(topIdx, children);
    if (selTopIndex === topIdx && selectedChild === childIdx) setSelectedChild(null);
  };

  // ── Drag reorder + move between zones ──
  // Sortable ids: top item = `t:<uid>`, child item = `c:<parentUid>:<idx>`,
  // empty/append drop targets = `z:root` and `z:<parentUid>`.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  type Loc = { zone: string; index: number; append: boolean };
  const parseLoc = (raw: string): Loc | null => {
    if (raw.startsWith('t:')) {
      const idx = currentIds.indexOf(raw.slice(2));
      return idx < 0 ? null : { zone: 'root', index: idx, append: false };
    }
    if (raw.startsWith('c:')) {
      const [, uid, j] = raw.split(':');
      return { zone: uid, index: Number(j), append: false };
    }
    if (raw.startsWith('z:')) {
      const zone = raw.slice(2);
      if (zone === 'root') return { zone: 'root', index: currentFields.length, append: true };
      const p = currentIds.indexOf(zone);
      return p < 0 ? null : { zone, index: (currentFields[p].fields?.length ?? 0), append: true };
    }
    return null;
  };
  const fieldAt = (loc: Loc): FormField | undefined =>
    loc.zone === 'root'
      ? currentFields[loc.index]
      : currentFields[currentIds.indexOf(loc.zone)]?.fields?.[loc.index];

  // Drop a NEW field (dragged from the palette) at a location.
  const insertNewField = (type: string, dst: Loc | null) => {
    if (dst && dst.zone !== 'root' && CONTAINER_TYPES.has(type)) {
      showToast(lang === 'en' ? 'A group/table cannot go inside another box' : 'グループ・表は他のボックスに入れられません', 'error');
      return;
    }
    if (!dst || dst.zone === 'root') {
      const at = !dst || dst.append ? currentFields.length : Math.min(dst.index, currentFields.length);
      const uid = genUid();
      const nf = [...currentFields]; nf.splice(at, 0, newFieldOfType(type, currentFields.length));
      const ni = [...currentIds]; ni.splice(at, 0, uid);
      setCurrentFields(nf); setCurrentIds(ni);
      setSelectedUid(uid); setSelectedChild(null);
    } else {
      const p = currentIds.indexOf(dst.zone);
      if (p < 0) return;
      const kids = currentFields[p].fields ?? [];
      const at = dst.append ? kids.length : Math.min(dst.index, kids.length);
      const next = [...kids]; next.splice(at, 0, newFieldOfType(type, kids.length));
      setChildren(p, next);
      setSelectedUid(currentIds[p]); setSelectedChild(at);
    }
    setMobileTab('edit');
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith('new:')) {
      const c = catalogFor(id.slice(4));
      setActiveDrag(c ? { glyph: c.icon, label: lang === 'en' ? c.label_en : c.label_ja } : null);
      return;
    }
    const loc = parseLoc(id);
    const f = loc ? fieldAt(loc) : null;
    setActiveDrag(f ? { glyph: fieldGlyph(f.type), label: f.label || f.type } : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveDrag(null);
    if (!over) return;

    // Palette-origin drag → insert a brand-new field.
    const rawActive = String(active.id);
    if (rawActive.startsWith('new:')) {
      insertNewField(rawActive.slice(4), parseLoc(String(over.id)));
      return;
    }

    const src = parseLoc(rawActive);
    const dst = parseLoc(String(over.id));
    if (!src || !dst) return;
    if (src.zone === dst.zone && src.index === dst.index && !dst.append) return;

    const moving = fieldAt(src);
    if (!moving) return;
    // No container-in-container: block dropping a group/repeat into another box.
    if (dst.zone !== 'root' && isContainer(moving)) {
      showToast(lang === 'en' ? 'A group/table cannot go inside another box' : 'グループ・表は他のボックスに入れられません', 'error');
      return;
    }

    // Reorder within the same list.
    if (src.zone === dst.zone) {
      const to = dst.append ? dst.index - 1 : dst.index;
      if (src.zone === 'root') {
        setCurrentFields(arrayMove(currentFields, src.index, to));
        setCurrentIds(arrayMove(currentIds, src.index, to));
      } else {
        const p = currentIds.indexOf(src.zone);
        setChildren(p, arrayMove(currentFields[p].fields ?? [], src.index, to));
      }
      setSelectedUid(null); setSelectedChild(null);
      return;
    }

    // Cross-zone move: remove from source list, insert into destination list.
    const next: FormField[] = currentFields.map((f) => ({ ...f, fields: f.fields ? [...f.fields] : f.fields }));
    const ids = [...currentIds];
    if (src.zone === 'root') { next.splice(src.index, 1); ids.splice(src.index, 1); }
    else { const p = ids.indexOf(src.zone); if (p >= 0) next[p].fields = (next[p].fields ?? []).filter((_, j) => j !== src.index); }

    if (dst.zone === 'root') {
      const di = dst.append ? next.length : Math.min(dst.index, next.length);
      next.splice(di, 0, moving); ids.splice(di, 0, genUid());
    } else {
      const p = ids.indexOf(dst.zone);
      if (p < 0) return;
      const arr = next[p].fields ?? [];
      const di = dst.append ? arr.length : Math.min(dst.index, arr.length);
      arr.splice(di, 0, moving); next[p].fields = arr;
    }
    setCurrentFields(next); setCurrentIds(ids);
    setSelectedUid(null); setSelectedChild(null);
  };

  const collisionDetection: CollisionDetection = (args) => {
    // A top-level drag only targets other top-level slots — its own children
    // would otherwise steal the collision and block downward moves.
    if (String(args.active.id).startsWith('t:')) {
      const filtered = args.droppableContainers.filter((c) => {
        const id = String(c.id);
        return id.startsWith('t:') || id === 'z:root';
      });
      return closestCenter({ ...args, droppableContainers: filtered });
    }
    // Child reorder + palette-new drags: restrict to droppables actually under
    // the pointer, then order those by closest center. This makes dropping INSIDE
    // a box land where the cursor is (closestCenter alone snapped to the box row).
    const hits = pointerWithin(args).length ? pointerWithin(args) : rectIntersection(args);
    if (hits.length) {
      const under = args.droppableContainers.filter((c) => hits.some((h) => h.id === c.id));
      return closestCenter({ ...args, droppableContainers: under });
    }
    return closestCenter(args);
  };

  // ── Uniqueness guard (replicates legacy checkUniqueNames) ──
  const checkUniqueNames = (flds: FormField[], schemaLabel: string): boolean => {
    // field_group children are flat (top-level) — expand them into this level so
    // a group child clashing with a top-level field is caught.
    const flat: FormField[] = [];
    const expand = (arr: FormField[]) => arr.forEach((f) =>
      (f.type === 'field_group' && f.fields?.length) ? expand(f.fields) : flat.push(f));
    expand(flds);

    const names = flat.map((f) => f.name.trim()).filter(Boolean);
    const dupes = names.filter((nm, i) => names.indexOf(nm) !== i);
    if (dupes.length) {
      showToast(`${schemaLabel}: ${lang === 'en' ? 'Duplicate field names' : '重複フィールド名'} – ${[...new Set(dupes)].join(', ')}`, 'error');
      return false;
    }
    // repeat_group children live in their OWN namespace — check them separately.
    for (const f of flat) {
      if (f.type === 'repeat_group' && f.fields?.length) {
        if (!checkUniqueNames(f.fields, `${schemaLabel}/${f.name}`)) return false;
      }
    }
    return true;
  };

  // ── Mutations (identical bodies to legacy FormBuilder) ──
  const create = useMutation({
    mutationFn: async () => (await apiClient.post('/admin/form-templates', {
      code: code.trim(),
      title:    titleEn || titleJa,
      title_ja: titleJa,
      pattern_id: patternId,
      icon, gradient,
      description_ja: descJa || null,
      description_en: descEn || null,
      app_number_prefix: appNumberPrefix.trim().toUpperCase() || 'RNG',
      app_number_digits: appNumberDigits,
      schema_definition: (hasRingi || isCustomRenderer) ? { fields: mirrorFields(fields) } : { fields: mirrorFields(settleFields) },
      settlement_schema: hasSettlement ? { fields: mirrorFields(settleFields) } : null,
      notes: notes || 'Initial version',
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
      showToast(lang === 'en' ? 'Form created' : 'フォームを作成しました');
      onClose();
    },
    onError: (e: any) => showToast(`${lang === 'en' ? 'Create failed' : '作成失敗'}: ${e.response?.data?.error ?? e.message}`, 'error'),
  });

  const saveVersion = useMutation({
    mutationFn: async () => (await apiClient.post(`/admin/form-templates/${templateId}/versions`, {
      schema_definition: (hasRingi || isCustomRenderer) ? { fields: mirrorFields(fields) } : { fields: mirrorFields(settleFields) },
      settlement_schema: hasSettlement ? { fields: mirrorFields(settleFields) } : null,
      notes,
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
      showToast(lang === 'en' ? 'New version saved' : '新バージョン保存しました');
      onClose();
    },
    onError: (e: any) => showToast(`${lang === 'en' ? 'Save failed' : '保存失敗'}: ${e.response?.data?.error ?? e.message}`, 'error'),
  });

  const saveMeta = useMutation({
    mutationFn: async () => (await apiClient.patch(`/admin/form-templates/${templateId}`, {
      title: titleEn || titleJa,
      title_ja: titleJa, pattern_id: patternId,
      icon, gradient,
      description_ja: descJa || null,
      description_en: descEn || null,
      app_number_prefix: appNumberPrefix.trim().toUpperCase() || 'RNG',
      app_number_digits: appNumberDigits,
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
    },
  });

  const saveDepts = useMutation({
    mutationFn: async () => (await apiClient.put(`/admin/form-templates/${templateId}/departments`, {
      department_ids: allowedDepts,
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
    },
  });

  const activate = useMutation({
    mutationFn: async (vid: string) => (await apiClient.post(`/admin/form-templates/${templateId}/versions/${vid}/activate`, {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      showToast(lang === 'en' ? 'Version activated' : 'バージョンを有効にしました');
    },
  });

  const deleteVersion = useMutation({
    mutationFn: async (vid: string) => (await apiClient.delete(`/admin/form-templates/${templateId}/versions/${vid}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      showToast(lang === 'en' ? 'Version deleted' : 'バージョンを削除しました');
    },
    onError: (e: any) => showToast(`${lang === 'en' ? 'Cannot delete' : '削除不可'}: ${e.response?.data?.error ?? e.message}`, 'error'),
  });

  const handleSave = async () => {
    if (hasRingi && !checkUniqueNames(fields, lang === 'en' ? 'Ringi schema' : '稟議スキーマ')) return;
    if (hasSettlement && !checkUniqueNames(settleFields, lang === 'en' ? 'Settlement schema' : '精算スキーマ')) return;

    if (isNew) {
      if (!titleJa.trim()) { showToast(lang === 'en' ? 'Japanese title required' : '日本語タイトルが必須です', 'error'); return; }
      try {
        const created = await create.mutateAsync();
        if (allowedDepts.length > 0 && created?.template?.id) {
          await apiClient.put(`/admin/form-templates/${created.template.id}/departments`, { department_ids: allowedDepts });
        }
      } catch { /* toasted by create.onError */ }
    } else {
      const metaChanged = titleJa !== detail?.template.title_ja
        || titleEn !== detail?.template.title
        || patternId !== detail?.template.pattern_id
        || icon !== (detail?.template.icon ?? '📋')
        || gradient !== (detail?.template.gradient ?? 'from-slate-400 to-slate-500')
        || descJa !== (detail?.template.description_ja ?? '')
        || descEn !== (detail?.template.description_en ?? '')
        || appNumberPrefix !== (detail?.template.app_number_prefix ?? 'RNG')
        || appNumberDigits !== (detail?.template.app_number_digits ?? 6);
      const deptsChanged = JSON.stringify([...allowedDepts].sort())
        !== JSON.stringify([...(detail?.allowed_dept_ids ?? [])].sort());
      if (metaChanged)  saveMeta.mutate();
      if (deptsChanged) saveDepts.mutate();
      saveVersion.mutate();
    }
  };

  const saving = create.isPending || saveVersion.isPending;
  const showSchemaToggle = (patternId === 3 || isCustomRenderer);

  // ── Render ──
  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center sm:p-4 bg-warmgray-900/60 backdrop-blur-sm animate-fade-up" onClick={onClose}>
      <div
        className="relative bg-surface-50 sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-w-6xl sm:max-h-[92vh] overflow-hidden flex flex-col border border-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-3.5 border-b border-white/40 bg-white/60 backdrop-blur-sm flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br ${gradient} text-lg border border-white/60 shrink-0`}>{icon}</span>
            <h2 className="text-sm sm:text-base font-bold text-warmgray-800 truncate min-w-0">
              {isNew ? (lang === 'en' ? 'New form' : '新規フォーム') : (titleJa || (lang === 'en' ? 'Edit form' : 'フォーム編集'))}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowSettings((s) => !s)} className={`btn-outline text-xs whitespace-nowrap ${showSettings ? '!bg-ringo-50 !border-ringo-300 !text-ringo-700' : ''}`}>
              ⚙ {lang === 'en' ? 'Settings' : '設定'}
            </button>
            {!isNew && (
              <button onClick={() => setShowHistory((s) => !s)} className="btn-outline text-xs whitespace-nowrap">
                {showHistory ? (lang === 'en' ? '← Back' : '← 戻る') : (lang === 'en' ? 'History' : '履歴')}
              </button>
            )}
            <button onClick={onClose} className="text-warmgray-400 hover:text-warmgray-600 transition-colors text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Schema toggle (pattern 3 / custom renderer) */}
        {showSchemaToggle && !showHistory && !showSettings && (
          <div className="px-4 sm:px-6 py-2 border-b border-white/40 bg-white/40 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mr-1">
              {lang === 'en' ? 'Editing' : '編集中'}
            </span>
            {[
              { settle: false, ja: isCustomRenderer ? 'ヘッダー' : '稟議フェーズ', en: isCustomRenderer ? 'Header' : 'Approval phase' },
              { settle: true,  ja: '精算フェーズ', en: 'Payment phase' },
            ].map(({ settle, ja, en }) => (
              <button
                key={String(settle)}
                onClick={() => { setEditingSettle(settle); setSelectedUid(null); }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                  editingSettle === settle
                    ? 'bg-ringo-500 text-white border-ringo-500'
                    : 'bg-white/60 text-warmgray-600 border-warmgray-200 hover:bg-warmgray-50'
                }`}
              >
                {lang === 'en' ? en : ja}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {showHistory && detail ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <LegacyVersionHistory
                versions={detail.versions}
                onActivate={(vid) => activate.mutate(vid)}
                onDelete={(vid) => deleteVersion.mutate(vid)}
                activatingId={activate.isPending ? (activate.variables as string) : undefined}
                deletingId={deleteVersion.isPending ? (deleteVersion.variables as string) : undefined}
              />
            </div>
          ) : showSettings ? (
            /* Settings full page — covers the whole builder body */
            <div className="flex-1 overflow-y-auto">
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/40 bg-white/40 sticky top-0 z-10 backdrop-blur-sm">
                <h3 className="text-sm font-bold text-warmgray-700">{lang === 'en' ? 'Form settings' : 'フォーム設定'}</h3>
                <button onClick={() => setShowSettings(false)} className="btn-primary text-xs bg-gradient-to-r from-ringo-500 to-ringo-400">
                  {isNew ? (lang === 'en' ? 'Next: add fields →' : '次へ：項目追加 →') : (lang === 'en' ? '← Back to fields' : '← 項目に戻る')}
                </button>
              </div>
              <FormSettingsPanel
                {...{ lang, isNew, patternId, setPatternId, titleJa, setTitleJa, icon, setIcon,
                  gradient, setGradient, descJa, setDescJa, appNumberPrefix, setAppNumberPrefix,
                  appNumberDigits, setAppNumberDigits, departments, allowedDepts, setAllowedDepts }}
              />
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="flex-1 grid md:grid-cols-[200px_1fr_minmax(280px,360px)] min-h-0 overflow-hidden">
              {/* Palette */}
              <div className={`${mobileTab === 'add' ? 'flex' : 'hidden'} md:flex flex-col min-h-0 overflow-y-auto border-r border-white/40 bg-white/30 p-3`}>
                {containerField && (
                  <div className="mb-3 rounded-xl border border-ringo-300/70 bg-ringo-50/70 px-2.5 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-ringo-600">
                      {lang === 'en' ? 'Adding into box' : 'ボックスに追加中'}
                    </p>
                    <p className="text-xs font-semibold text-warmgray-700 truncate">{containerField.label}</p>
                    <button onClick={() => { setSelectedUid(null); setSelectedChild(null); }}
                      className="mt-1 text-[10px] font-semibold text-ringo-500 hover:text-ringo-700">
                      ↑ {lang === 'en' ? 'Add to form instead' : 'フォーム直下に追加'}
                    </button>
                  </div>
                )}
                <FieldPalette onAdd={addField} disabledTypes={containerField ? CONTAINER_TYPES : undefined} />
              </div>

              {/* Canvas */}
              <div className={`${mobileTab === 'build' ? 'flex' : 'hidden'} md:flex flex-col min-h-0 bg-warmgray-50/30`}>
                {/* Build / Preview toggle */}
                <div className="flex items-center justify-center gap-1 px-4 py-2 border-b border-white/40 shrink-0">
                  <div className="flex rounded-lg border border-warmgray-200 overflow-hidden text-xs font-semibold bg-white/60">
                    {([
                      { m: 'build' as const,   ja: '構成',    en: 'Build',   icon: '📋' },
                      { m: 'preview' as const, ja: 'プレビュー', en: 'Preview', icon: '👁' },
                    ]).map(({ m, ja, en, icon: ic }, i) => (
                      <button key={m} onClick={() => setCanvasMode(m)}
                        className={`px-3 py-1.5 flex items-center gap-1 transition-colors ${i > 0 ? 'border-l border-warmgray-200' : ''} ${
                          canvasMode === m ? 'bg-ringo-500 text-white' : 'text-warmgray-600 hover:bg-warmgray-50'}`}>
                        <span>{ic}</span>{lang === 'en' ? en : ja}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {canvasMode === 'preview' ? (
                    currentFields.length === 0 ? (
                      <div className="text-center text-warmgray-400 text-sm py-16">{lang === 'en' ? 'Nothing to preview yet.' : 'プレビューする項目がありません。'}</div>
                    ) : (
                      <div className="pointer-events-auto">
                        <DynamicForm
                          key={previewKey}
                          template={{
                            id: 'preview',
                            title_ja: titleJa || (lang === 'en' ? 'Preview' : 'プレビュー'),
                            schema_definition: { fields: currentFields as never },
                            settlement_schema: { fields: [] },
                          }}
                          onSubmit={async () => {}}
                          submitLabel={lang === 'en' ? 'Preview only' : 'プレビュー（送信無効）'}
                          disabled
                        />
                        <p className="text-[10px] text-warmgray-400 text-center mt-2">
                          {lang === 'en' ? 'Live preview — submit is disabled. Conditional & calculated fields work.' : 'ライブプレビュー — 送信は無効。条件・自動計算は動作します。'}
                        </p>
                      </div>
                    )
                  ) : currentFields.length === 0 ? (
                    <>
                      <div className="flex flex-col items-center justify-center text-center text-warmgray-400 gap-2 py-12">
                        <span className="text-3xl">📋</span>
                        <p className="text-sm font-medium">{lang === 'en' ? 'No fields yet' : 'まだ項目がありません'}</p>
                        <p className="text-xs">{lang === 'en' ? 'Click or drag a field type from the left to start.' : '左から項目をクリックまたはドラッグして追加。'}</p>
                      </div>
                      <RootDropZone label={lang === 'en' ? 'Drop a field here' : 'ここに項目をドロップ'} />
                    </>
                  ) : (
                    <>
                      <SortableContext items={currentFields.map((_, i) => `t:${currentIds[i]}`)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1.5">
                          {currentFields.map((f, i) => (
                            <div key={currentIds[i]}>
                              <CanvasField
                                id={`t:${currentIds[i]}`}
                                field={f}
                                isSelected={selectedUid === currentIds[i] && selectedChild === null}
                                onSelect={() => selectTop(currentIds[i])}
                                onDuplicate={() => duplicateTop(i)}
                                onDelete={() => removeTop(i)}
                              />
                              {/* Container children — own sortable zone (reorder + drop in/out) */}
                              {isContainer(f) && (
                                <ContainerDropZone uid={currentIds[i]} active={containerIndex === i}>
                                  <SortableContext items={(f.fields ?? []).map((_, j) => `c:${currentIds[i]}:${j}`)} strategy={verticalListSortingStrategy}>
                                    <div className="space-y-1">
                                      {(f.fields ?? []).map((child, j) => (
                                        <CanvasField
                                          key={`${currentIds[i]}-${j}`}
                                          id={`c:${currentIds[i]}:${j}`}
                                          field={child}
                                          nested
                                          isSelected={selectedUid === currentIds[i] && selectedChild === j}
                                          onSelect={() => selectChild(currentIds[i], j)}
                                          onDelete={() => removeChildAt(i, j)}
                                        />
                                      ))}
                                    </div>
                                  </SortableContext>
                                  <button
                                    onClick={() => selectTop(currentIds[i])}
                                    className={`mt-1 w-full text-left text-[11px] font-semibold rounded-lg border border-dashed px-2.5 py-1.5 transition-colors ${
                                      containerIndex === i
                                        ? 'border-ringo-400 text-ringo-600 bg-ringo-50/60'
                                        : 'border-warmgray-300 text-warmgray-500 hover:bg-white/60'}`}>
                                    {containerIndex === i
                                      ? (lang === 'en' ? '↤ Pick a field type on the left' : '↤ 左で項目タイプを選択')
                                      : (lang === 'en' ? '+ Add fields to this box' : '+ このボックスに項目を追加')}
                                  </button>
                                </ContainerDropZone>
                              )}
                            </div>
                          ))}
                        </div>
                      </SortableContext>
                      <RootDropZone label={lang === 'en' ? 'Drop here to place at the bottom' : 'ここにドロップで最下部に配置'} />
                    </>
                  )}
                </div>
              </div>

              {/* Properties */}
              <div className={`${mobileTab === 'edit' ? 'flex' : 'hidden'} md:flex flex-col min-h-0 overflow-y-auto border-l border-white/40 bg-white/30 p-3`}>
                {selectedField && selectedIndex >= 0 ? (
                  <PropertiesPanel
                    key={`${selectedUid}-${selectedChild ?? 'top'}`}
                    field={selectedField}
                    index={selectedIndex}
                    total={selSiblings.length}
                    siblingNames={selSiblings.filter((_, j) => j !== selectedIndex).map((x) => x.name)}
                    siblingFields={selSiblings.filter((_, j) => j !== selectedIndex)}
                    computedFieldNames={computedFieldNames}
                    isCustomRenderer={isCustomRenderer}
                    isChild={editingChild}
                    onUpdate={updateSelected}
                    onRemove={removeSelected}
                    onMove={moveSelected}
                    onDuplicate={duplicateSelected}
                    otherSchemaFields={otherSchemaFields}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center text-warmgray-400 gap-2 py-16 px-4">
                    <span className="text-2xl">👈</span>
                    <p className="text-xs">{lang === 'en' ? 'Select a field to edit its settings.' : '項目を選択すると設定を編集できます。'}</p>
                  </div>
                )}
              </div>
            </div>
            <DragOverlay>
              {activeDrag ? (
                <div className="flex items-center gap-2 rounded-xl border border-ringo-300 bg-white px-2.5 py-2 shadow-lg text-xs font-semibold text-warmgray-700">
                  <span>{activeDrag.glyph}</span>{activeDrag.label}
                </div>
              ) : null}
            </DragOverlay>
            </DndContext>
          )}
        </div>

        {/* Mobile tab bar */}
        {!showHistory && (
          <div className="md:hidden flex border-t border-white/40 bg-white/70 shrink-0">
            {([
              { k: 'add' as MobileTab,   ja: '追加', en: 'Add',   icon: '➕' },
              { k: 'build' as MobileTab, ja: '構成', en: 'Build', icon: '📋' },
              { k: 'edit' as MobileTab,  ja: '設定', en: 'Edit',  icon: '⚙' },
            ]).map(({ k, ja, en, icon: ic }) => (
              <button
                key={k}
                onClick={() => setMobileTab(k)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors ${
                  mobileTab === k ? 'text-ringo-600 bg-ringo-50/60' : 'text-warmgray-500'
                }`}
              >
                <span className="text-sm">{ic}</span>
                {lang === 'en' ? en : ja}
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        {!showHistory && (
          <div className="px-4 py-3 sm:px-6 sm:py-3.5 border-t border-white/40 bg-white/60 backdrop-blur-sm flex items-center justify-between gap-2 shrink-0">
            <span className="text-[11px] text-warmgray-400 hidden sm:block">
              {currentFields.length} {lang === 'en' ? 'fields' : '項目'}
            </span>
            <div className="flex items-center gap-2 flex-1 sm:flex-none justify-end">
              <button onClick={onClose} className="btn-ghost text-sm">{lang === 'en' ? 'Cancel' : 'キャンセル'}</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
                {saving ? (lang === 'en' ? 'Saving...' : '保存中...')
                  : isNew ? (lang === 'en' ? 'Create form' : '作成する')
                  : (lang === 'en' ? 'Save as new version' : '新バージョン保存')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings drawer — form metadata (compact). Same fields as legacy metadata.
// ─────────────────────────────────────────────────────────────────────────────
function FormSettingsPanel(props: {
  lang: string; isNew: boolean;
  patternId: number; setPatternId: (n: number) => void;
  titleJa: string; setTitleJa: (s: string) => void;
  icon: string; setIcon: (s: string) => void;
  gradient: string; setGradient: (s: string) => void;
  descJa: string; setDescJa: (s: string) => void;
  appNumberPrefix: string; setAppNumberPrefix: (s: string) => void;
  appNumberDigits: number; setAppNumberDigits: (n: number) => void;
  departments?: Department[]; allowedDepts: string[]; setAllowedDepts: (a: string[]) => void;
}) {
  const {
    lang, isNew, patternId, setPatternId, titleJa, setTitleJa, icon, setIcon, gradient, setGradient,
    descJa, setDescJa, appNumberPrefix, setAppNumberPrefix, appNumberDigits, setAppNumberDigits,
    departments, allowedDepts, setAllowedDepts,
  } = props;

  // Inclusion model with "checked = visible". Empty allowedDepts means "all".
  // We render every dept as checked when the list is empty, so the visual matches
  // the meaning: a checked department can see the form. Unchecking switches to an
  // allow-list of the still-checked departments; re-checking all reverts to "all".
  const allDeptIds = (departments ?? []).map((d) => d.id);
  const isVisibleTo = (id: string) => allowedDepts.length === 0 || allowedDepts.includes(id);
  const toggleDept = (id: string) => {
    const current = allowedDepts.length === 0 ? [...allDeptIds] : [...allowedDepts];
    const next = current.includes(id) ? current.filter((d) => d !== id) : [...current, id];
    // All selected ⇒ store empty array (= visible to all). Else store the allow-list.
    setAllowedDepts(next.length === allDeptIds.length ? [] : next);
  };

  return (
    <div className="px-4 sm:px-6 py-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Flow type' : 'フロー種別'} *</label>
          <select value={patternId} onChange={(e) => setPatternId(Number(e.target.value))} className="input mt-1">
            <option value={1}>{lang === 'en' ? 'Approval only' : '稟議のみ（精算なし）'}</option>
            <option value={2}>{lang === 'en' ? 'Payment only' : '精算のみ（稟議なし）'}</option>
            <option value={3}>{lang === 'en' ? 'Approval + Payment' : '稟議＋精算（2フェーズ）'}</option>
          </select>
          {!isNew && (
            <p className="text-[10px] text-amber-600 mt-1">
              ⚠ {lang === 'en' ? 'Affects new submissions only — existing apps keep their flow' : 'パターン変更は新規申請のみ反映。既存申請のフローは不変'}
            </p>
          )}
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Title' : 'タイトル'} *</label>
          <input type="text" value={titleJa} onChange={(e) => setTitleJa(e.target.value)} className="input mt-1" placeholder="出張稟議書" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Icon' : 'アイコン'}</label>
          <input type="text" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} className="input mt-1 text-2xl text-center" placeholder="✈️" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Color' : 'カラー'}</label>
          <div className="grid grid-cols-5 gap-1.5 mt-1">
            {GRADIENT_OPTIONS.map((g) => (
              <button key={g.val} type="button" onClick={() => setGradient(g.val)} title={g.label}
                className={`w-full aspect-square rounded-lg bg-gradient-to-br ${g.val} transition-all ${
                  gradient === g.val ? 'ring-2 ring-warmgray-800 scale-110' : 'hover:scale-105'}`} />
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Description' : '説明'}</label>
        <input type="text" value={descJa} onChange={(e) => setDescJa(e.target.value)} className="input mt-1" placeholder={lang === 'en' ? 'Short description' : '説明'} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'App number prefix' : '申請番号プレフィックス'}</label>
          <div className="flex items-center gap-1.5 mt-1">
            <input type="text" value={appNumberPrefix}
              onChange={(e) => setAppNumberPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
              className="input w-24 font-mono uppercase" placeholder="RNG" maxLength={10} />
            <span className="text-xs text-warmgray-400">-{new Date().getFullYear()}-</span>
            <span className="text-xs font-mono text-warmgray-500">{'0'.repeat(Math.max(0, appNumberDigits - 1))}1</span>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Digits' : '桁数'}</label>
          <select value={appNumberDigits} onChange={(e) => setAppNumberDigits(Number(e.target.value))} className="input mt-1 w-20">
            {[4, 5, 6, 7, 8].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {departments && departments.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
              {lang === 'en' ? 'Visible to departments' : '表示する部署'}
              <span className="ml-1 normal-case font-normal text-warmgray-400">
                ({allowedDepts.length === 0 ? (lang === 'en' ? 'all' : '全部署') : `${allowedDepts.length}/${allDeptIds.length}`})
              </span>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAllowedDepts([])} className="text-[10px] font-semibold text-ringo-500 hover:text-ringo-700">
                {lang === 'en' ? 'All' : '全選択'}
              </button>
              <button type="button" onClick={() => setAllowedDepts(allDeptIds.length === 1 ? [] : [allDeptIds[0]])} className="text-[10px] font-semibold text-warmgray-400 hover:text-warmgray-600">
                {lang === 'en' ? 'Clear' : 'クリア'}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-warmgray-400 mt-1 mb-1.5">
            {lang === 'en' ? '✓ checked = this department can see the form.' : '✓ チェック＝その部署にフォームを表示。'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {departments.map((d) => {
              const on = isVisibleTo(d.id);
              return (
                <button key={d.id} type="button" onClick={() => toggleDept(d.id)}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    on
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-white/60 text-warmgray-400 border-warmgray-200 hover:bg-warmgray-50 line-through'}`}>
                  <span className={`flex items-center justify-center w-3.5 h-3.5 rounded border ${on ? 'bg-white/25 border-white/40' : 'border-warmgray-300'}`}>
                    {on ? '✓' : ''}
                  </span>
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
