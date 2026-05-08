import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import StandardInput from './StandardInput';
import { useLang } from '../../context/LanguageContext';

interface FormField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  multiple?: boolean;
  sum_target?: string;
  computed?: boolean;
}

interface Template {
  id: string;
  title_ja: string;
  schema_definition: { fields: FormField[] };
  settlement_schema: { fields: FormField[] };
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

  const { register, handleSubmit, getValues, setValue, watch, formState: { errors, isSubmitting } } = useForm({
    defaultValues,
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
  });

  const activeSchema = isSettlementPhase ? template.settlement_schema : template.schema_definition;
  const activeFields: FormField[] = useMemo(() => activeSchema?.fields ?? [], [activeSchema]);

  // Build sum-source field names once per schema change
  const sumSourceNames = useMemo(
    () => activeFields.filter((f) => f.sum_target).map((f) => f.name),
    [activeFields],
  );

  // Watch ONLY the sum-source fields (not the whole form)
  const watchedSources = watch(sumSourceNames);

  useEffect(() => {
    if (sumSourceNames.length === 0) return;

    // Group sources by their declared target
    const targetMap = new Map<string, number[]>();
    activeFields
      .filter((f) => f.sum_target)
      .forEach((f, i) => {
        const target = f.sum_target as string;
        if (!targetMap.has(target)) targetMap.set(target, []);
        targetMap.get(target)!.push(i);
      });

    targetMap.forEach((indices, targetName) => {
      const total = indices.reduce(
        (sum, i) => sum + (Number(watchedSources[i]) || 0),
        0,
      );
      setValue(targetName, total, { shouldDirty: false });
    });
  // watchedSources reference changes when values change; stable dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedSources]);

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
        フォームテンプレートを読み込めませんでした
      </div>
    );
  }

  const isFullWidth = (f: FormField) =>
    f.type === 'textarea' || f.type === 'file' || f.type === 'computed';

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="card space-y-6">
      {/* Header */}
      <div className="border-b border-white/30 pb-5">
        <h2 className="text-xl font-bold text-warmgray-800">{template.title_ja}</h2>
        <p className="text-xs text-warmgray-400 mt-1 uppercase tracking-wide font-medium">
          {isSettlementPhase ? '精算書 — Settlement Phase' : '稟議書 — Ringi Phase'}
        </p>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        {activeFields.map((field) => (
          <div key={field.name} className={isFullWidth(field) ? 'md:col-span-2' : ''}>
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
          </div>
        ))}
      </div>

      {/* Footer */}
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
