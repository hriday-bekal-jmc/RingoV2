import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch, type Control, type UseFormSetValue } from 'react-hook-form';
import StandardInput from './StandardInput';
import { useLang } from '../../context/LanguageContext';

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
  col_span?: 'half' | 'full';
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
}

export default function DynamicForm({
  template,
  onSubmit,
  onDraft,
  isSettlementPhase = false,
  disabled = false,
  defaultValues,
  submitLabel,
}: DynamicFormProps) {
  const { t } = useLang();
  const [isDrafting, setIsDrafting] = useState(false);

  const activeSchema = isSettlementPhase ? template.settlement_schema : template.schema_definition;
  const allFields: FormField[] = useMemo(() => activeSchema?.fields ?? [], [activeSchema]);

  const resolvedDefaults = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const schema: Record<string, unknown> = {};
    allFields.forEach((f) => {
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

  const conditionalSources = useMemo(
    () => Array.from(new Set(allFields.map((f) => f.conditional_on?.field).filter(Boolean))) as string[],
    [allFields],
  );
  const watchedConds = useWatch({ control, name: conditionalSources.length ? conditionalSources : ['__noop__'] });

  const activeFields: FormField[] = useMemo(() => {
    if (conditionalSources.length === 0) return allFields;
    const sourceMap: Record<string, unknown> = {};
    conditionalSources.forEach((name, i) => {
      sourceMap[name] = (watchedConds as unknown[])[i];
    });
    return allFields.filter((f) => {
      if (!f.conditional_on) return true;
      const got = sourceMap[f.conditional_on.field];
      if (got == null) return false;
      const eq = f.conditional_on.equals;
      const eqArr = Array.isArray(eq) ? eq.map(String) : [String(eq)];
      const gotArr = Array.isArray(got) ? got.map(String) : [String(got)];
      return gotArr.some((v) => eqArr.includes(v));
    });
  }, [allFields, watchedConds, conditionalSources]);

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
          if (child.type === 'number' && child.sum_target && computedTargets.has(child.sum_target)) {
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
    await onSubmit({
      template_id: template.id,
      stage: isSettlementPhase ? 'SETTLEMENT' : 'RINGI',
      form_data: data,
    });
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

  const isFullWidth = (field: FormField) => {
    if (field.type === 'header') return true;   // section headers always span full row
    if (field.col_span === 'full') return true;
    if (field.col_span === 'half') return false;
    // Auto: type-based defaults
    return field.type === 'textarea' || field.type === 'file' || field.type === 'repeat_group' || field.type === 'computed' || field.type === 'route_entry' || field.type === 'checkbox' || field.type === 'user_picker';
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="card space-y-6">
      <div className="border-b border-white/30 pb-5">
        <h2 className="text-xl font-bold text-warmgray-800">{template.title_ja}</h2>
        <p className="text-xs text-warmgray-400 mt-1 uppercase tracking-wide font-medium">
          {isSettlementPhase ? '精算フェーズ / Settlement' : '稟議フェーズ / Ringi'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        {activeFields.map((field) => (
          <div key={field.name} className={isFullWidth(field) ? 'md:col-span-2' : ''}>
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
        ))}
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
