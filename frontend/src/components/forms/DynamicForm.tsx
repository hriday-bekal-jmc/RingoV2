import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, type Control, type UseFormSetValue } from 'react-hook-form';
import StandardInput from './StandardInput';
import { useLang } from '../../context/LanguageContext';
import { evalFormula, formulaDeps } from '../../utils/formulaEval';
import { fieldColSpanClass, flattenFieldGroups } from './fieldLayout';

interface FormField {
  name: string;
  label: string;
  label_en?: string;
  type: string;
  required?: boolean;
  multiple?: boolean;
  fields?: FormField[];
  min_rows?: number;
  max_rows?: number;
  add_label?: string;
  add_label_en?: string;
  sum_target?: string;
  sum_field?:  string;
  formula?:    string;
  computed?: boolean;
  placeholder?: string;
  helper_text?: string;
  default_value?: string | number | boolean | null;
  options?: Array<{ value: string; label_ja: string; label_en: string }>;
  validation?: {
    regex?: string;
    min?: number;
    max?: number;
    maxlength?: number;
  };
  conditional_on?: {
    field: string;
    equals: string | number | boolean | Array<string | number | boolean>;
  };
  col_span?: string;
  hidden?: boolean;
  show_date?: boolean;
  date_diff_from?: string;
  date_diff_to?: string;
}

interface Template {
  id: string;
  title_ja: string;
  schema_definition: { fields: FormField[] };
  settlement_schema: { fields: FormField[] };
}

interface SumSource {
  watchName: string;
  targetName: string;
  kind: 'field' | 'repeat_group';
  childName?: string;
}

interface SumWatcherProps {
  control: Control<Record<string, unknown>>;
  setValue: UseFormSetValue<Record<string, unknown>>;
  sources: SumSource[];
}

function SumWatcher({ control, setValue, sources }: SumWatcherProps): null {
  const watchedNames = useMemo(
    () => Array.from(new Set(sources.map((source) => source.watchName))),
    [sources],
  );
  const values = useWatch({ control, name: watchedNames });

  useEffect(() => {
    const valueMap = new Map<string, unknown>();
    watchedNames.forEach((name, index) => valueMap.set(name, (values as unknown[])[index]));

    const totals = new Map<string, number>();
    sources.forEach((source) => {
      const watchedValue = valueMap.get(source.watchName);
      let subtotal = 0;

      if (source.kind === 'repeat_group') {
        const rows = Array.isArray(watchedValue) ? watchedValue : [];
        subtotal = rows.reduce((sum, row) => {
          if (!row || typeof row !== 'object' || Array.isArray(row) || !source.childName) return sum;
          return sum + (Number((row as Record<string, unknown>)[source.childName]) || 0);
        }, 0);
      } else {
        subtotal = Number(watchedValue) || 0;
      }

      totals.set(source.targetName, (totals.get(source.targetName) ?? 0) + subtotal);
    });

    totals.forEach((total, targetName) => {
      setValue(targetName, total, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    });
  }, [values, watchedNames, sources, setValue]);

  return null;
}

interface DynamicFormProps {
  template: Template;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onDraft?: (data: Record<string, unknown>) => Promise<void>;
  isSettlementPhase?: boolean;
  disabled?: boolean;
  defaultValues?: Record<string, unknown>;
  submitLabel?: string;
  /** Values injected from outside (e.g. _daily_rate from applicant role) — always synced, even after mount */
  externalValues?: Record<string, unknown>;
}

export default function DynamicForm({
  template,
  onSubmit,
  onDraft,
  isSettlementPhase = false,
  disabled = false,
  defaultValues,
  submitLabel,
  externalValues,
}: DynamicFormProps) {
  const { t, lang } = useLang();
  const [isDrafting, setIsDrafting] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const submittingRef = useRef(false); // prevent double-submit on rapid click

  const activeSchema = isSettlementPhase ? template.settlement_schema : template.schema_definition;
  const allFields: FormField[] = useMemo(() => activeSchema?.fields ?? [], [activeSchema]);
  // field_group is visual-only; flatten to a leaf list for all logic (defaults,
  // conditional, sums, validation). The original allFields drives layout/render.
  const allLeaves: FormField[] = useMemo(() => flattenFieldGroups(allFields), [allFields]);

  const resolvedDefaults = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const schema: Record<string, unknown> = {};
    allLeaves.forEach((f) => {
      if (f.default_value === '__today__') schema[f.name] = today;
      else if (f.default_value != null) schema[f.name] = f.default_value;
    });
    return { ...schema, ...defaultValues };
  }, []); // intentionally static — only used as initial form values

  const {
    register, handleSubmit, getValues, setValue, watch, control,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, unknown>>({
    defaultValues: resolvedDefaults,
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
  });

  // Sync externalValues (e.g. _daily_rate from applicant's role) whenever they change,
  // then immediately recompute any formula fields whose deps include those injected keys.
  // This avoids waiting for ComputedNumberDisplay's own useEffect chain to cascade.
  useEffect(() => {
    if (!externalValues) return;

    // Step 1: inject the external values into form state
    Object.entries(externalValues).forEach(([key, val]) => {
      if (val != null) setValue(key as never, val as never, { shouldDirty: false });
    });

    // Step 2: immediately recompute formula fields that depend on any external key
    const externalKeys = new Set(Object.keys(externalValues));
    const currentValues = { ...getValues(), ...externalValues };
    allFields.forEach((f) => {
      if (!f.formula) return;
      const deps = formulaDeps(f.formula);
      if (!deps.some((d) => externalKeys.has(d))) return;
      const numVals: Record<string, number> = {};
      deps.forEach((d) => {
        const v = currentValues[d];
        numVals[d] = typeof v === 'number' ? v : parseFloat(String(v ?? '0')) || 0;
      });
      const result = evalFormula(f.formula, numVals as Record<string, unknown>);
      setValue(f.name as never, result as never, { shouldDirty: false });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(externalValues)]);

  const conditionalSources = useMemo(
    () => Array.from(new Set(allLeaves.map((f) => f.conditional_on?.field).filter(Boolean))) as string[],
    [allLeaves],
  );
  const watchedConds = useWatch({ control, name: conditionalSources.length ? conditionalSources : ['__noop__'] });

  const activeFields: FormField[] = useMemo(() => {
    if (conditionalSources.length === 0) return allLeaves;
    const sourceMap: Record<string, unknown> = {};
    conditionalSources.forEach((name, i) => {
      sourceMap[name] = (watchedConds as unknown[])[i];
    });
    return allLeaves.filter((f) => {
      if (!f.conditional_on) return true;
      const got = sourceMap[f.conditional_on.field];
      if (got == null) return false;
      const eq = f.conditional_on.equals;
      const eqArr = Array.isArray(eq) ? eq.map(String) : [String(eq)];
      const gotArr = Array.isArray(got) ? got.map(String) : [String(got)];
      return gotArr.some((v) => eqArr.includes(v));
    });
  }, [allLeaves, watchedConds, conditionalSources]);

  // Names of currently-visible leaf fields — drives both conditional rendering
  // and which group children show inside their box.
  const activeNameSet = useMemo(() => new Set(activeFields.map((f) => f.name)), [activeFields]);

  const sumSources = useMemo<SumSource[]>(() => {
    const computedTargets = new Set(
      activeFields.filter((f) => f.type === 'number' && f.computed).map((f) => f.name),
    );
    const sources: SumSource[] = [];

    activeFields.forEach((field) => {
      if (field.sum_target && computedTargets.has(field.sum_target)) {
        sources.push({ watchName: field.name, targetName: field.sum_target, kind: 'field' });
      }

      if (field.type === 'repeat_group') {
        (field.fields ?? []).forEach((child) => {
          if ((child.type === 'number' || child.type === 'allowance_days' || child.type === 'select') && child.sum_target && computedTargets.has(child.sum_target)) {
            sources.push({
              watchName: field.name,
              targetName: child.sum_target,
              kind: 'repeat_group',
              childName: child.name,
            });
          }
        });
      }

      // route_entry stores [{fare, ...}] — sum_target+sum_field on the computed field declares the link
      if (field.type === 'route_entry') {
        activeFields.forEach((cf) => {
          if (cf.computed && cf.sum_target === field.name && cf.sum_field) {
            sources.push({
              watchName: field.name,
              targetName: cf.name,
              kind: 'repeat_group',
              childName: cf.sum_field,
            });
          }
        });
      }
    });

    return sources;
  }, [activeFields]);

  const handleFormSubmit = async (data: Record<string, unknown>) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setValidationMsg(null);
    try {
      await onSubmit({
        template_id: template.id,
        stage: isSettlementPhase ? 'SETTLEMENT' : 'RINGI',
        form_data: data,
      });
    } finally {
      submittingRef.current = false;
    }
  };

  const handleInvalid = () => {
    setValidationMsg(lang === 'en'
      ? 'Please fix the highlighted fields before submitting.'
      : '入力内容に不備があります。赤いフィールドを確認してください。'
    );
    // Scroll to first error field
    setTimeout(() => {
      document.querySelector('[data-field-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const handleDraftClick = async () => {
    if (!onDraft) return;
    setIsDrafting(true);
    try {
      await onDraft({
        template_id: template.id,
        stage: isSettlementPhase ? 'SETTLEMENT' : 'RINGI',
        form_data: getValues() as Record<string, unknown>,
      });
    } finally {
      setIsDrafting(false);
    }
  };

  if (!activeSchema?.fields) {
    return (
      <div className="card text-center text-warmgray-400 py-12">
        Form template could not be loaded.
      </div>
    );
  }

  // Render a single leaf field (used at top level and inside group boxes).
  const renderLeaf = (field: FormField) => (
    <div key={field.name} className={fieldColSpanClass(field)}>
      {field.type === 'header' ? (
        <div className="flex items-center gap-3 py-1">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-bold text-warmgray-700 leading-tight">{field.label}</span>
            {field.helper_text && (
              <span className="text-xs text-warmgray-400">{field.helper_text}</span>
            )}
          </div>
          <div className="flex-1 h-px bg-warmgray-200/70" />
        </div>
      ) : (
        <StandardInput
          field={field as never}
          register={register}
          setValue={setValue}
          watch={watch}
          error={errors[field.name]}
          initialValue={
            field.type === 'file'
              ? (defaultValues?.[field.name] as string | undefined)
              : undefined
          }
        />
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit(handleFormSubmit, handleInvalid)} className="card space-y-6">
      <div className="border-b border-white/30 pb-5">
        <h2 className="text-xl font-bold text-warmgray-800">{template.title_ja}</h2>
        <p className="text-xs text-warmgray-400 mt-1 uppercase tracking-wide font-medium">
          {isSettlementPhase ? '精算フェーズ / Settlement' : '稟議フェーズ / Ringi'}
        </p>
      </div>

      {validationMsg && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-50/80 border border-red-200/70 text-red-700 text-sm animate-fade-up">
          <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
          <span>{validationMsg}</span>
          <button type="button" onClick={() => setValidationMsg(null)} className="ml-auto text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-5">
        {allFields.map((field) => {
          // Visual group box — renders its visible children in a nested grid.
          if (field.type === 'field_group') {
            const kids = (field.fields ?? []).filter((c) => !c.hidden && activeNameSet.has(c.name));
            if (kids.length === 0) return null;
            return (
              <fieldset key={field.name} className="col-span-1 md:col-span-12 rounded-2xl border border-warmgray-200/70 bg-white/40 px-4 pt-2 pb-4">
                {field.label && (
                  <legend className="px-2 text-xs font-bold uppercase tracking-widest text-warmgray-500">{field.label}</legend>
                )}
                {field.helper_text && <p className="text-[11px] text-warmgray-400 mb-2 px-2">{field.helper_text}</p>}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-5">
                  {kids.map(renderLeaf)}
                </div>
              </fieldset>
            );
          }
          if (field.hidden || !activeNameSet.has(field.name)) return null;
          return renderLeaf(field);
        })}
      </div>

      {sumSources.length > 0 && (
        <SumWatcher
          control={control}
          setValue={setValue}
          sources={sumSources}
        />
      )}

      <div className="pt-4 border-t border-white/30 flex items-center justify-between">
        {onDraft ? (
          <button
            type="button"
            className="btn-ghost text-sm flex items-center gap-1.5"
            disabled={isDrafting || isSubmitting || disabled}
            onClick={handleDraftClick}
          >
            {isDrafting ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 00-2 2v14l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2z" />
              </svg>
            )}
            {isDrafting ? `${t('btn_save')}...` : t('btn_draft')}
          </button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          <p className="text-[11px] text-warmgray-400 hidden sm:block">
            {onDraft && t('draft_hint')}
          </p>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting || disabled}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {t('loading')}
              </>
            ) : submitLabel ? (
              submitLabel
            ) : isSettlementPhase ? (
              t('btn_settle_submit')
            ) : (
              t('btn_submit')
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
