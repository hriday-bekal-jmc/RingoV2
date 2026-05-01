import { useState } from 'react';
import { useForm } from 'react-hook-form';
import StandardInput from './StandardInput';

interface FormField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  multiple?: boolean;
}

interface Template {
  id: string;
  title_ja: string;
  schema_definition: { fields: FormField[] };
  settlement_schema: { fields: FormField[] };
}

interface DynamicFormProps {
  template: Template;
  onSubmit: (data: any) => Promise<void>;
  onDraft?: (data: any) => Promise<void>;
  isSettlementPhase?: boolean;
  disabled?: boolean;
  defaultValues?: Record<string, any>;
}

export default function DynamicForm({
  template,
  onSubmit,
  onDraft,
  isSettlementPhase = false,
  disabled = false,
  defaultValues,
}: DynamicFormProps) {
  const [isDrafting, setIsDrafting] = useState(false);
  const [isDraftMode, setIsDraftMode] = useState(false);

  const { register, handleSubmit, getValues, setValue, formState: { errors, isSubmitting } } = useForm({
    defaultValues,
    // Only validate on submit attempt, not on change
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
  });

  const activeSchema = isSettlementPhase ? template.settlement_schema : template.schema_definition;

  const handleFormSubmit = async (data: any) => {
    setIsDraftMode(false);
    await onSubmit({
      template_id: template.id,
      stage: isSettlementPhase ? 'SETTLEMENT' : 'RINGI',
      form_data: data,
    });
  };

  const handleDraftClick = async () => {
    if (!onDraft) return;
    setIsDrafting(true);
    setIsDraftMode(true);
    try {
      // getValues() bypasses validation entirely
      await onDraft({
        template_id: template.id,
        stage: isSettlementPhase ? 'SETTLEMENT' : 'RINGI',
        form_data: getValues(),
      });
    } finally {
      setIsDrafting(false);
      setIsDraftMode(false);
    }
  };

  if (!activeSchema?.fields) {
    return (
      <div className="card text-center text-warmgray-400 py-12">
        フォームテンプレートを読み込めませんでした
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="card space-y-6">
      {/* Form header */}
      <div className="border-b border-white/30 pb-5">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-warmgray-800">{template.title_ja}</h2>
            <p className="text-xs text-warmgray-400 mt-1 uppercase tracking-wide font-medium">
              {isSettlementPhase ? '精算書 — Settlement Phase' : '稟議書 — Ringi Phase'}
            </p>
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        {activeSchema.fields.map((field) => (
          <div key={field.name} className={field.type === 'textarea' || field.type === 'file' ? 'md:col-span-2' : ''}>
            <StandardInput
              field={field}
              register={register}
              setValue={setValue}
              error={errors[field.name]}
              isDraft={isDraftMode}
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
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                保存中...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 00-2 2v14l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2z" />
                </svg>
                下書き保存
              </>
            )}
          </button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          <p className="text-[11px] text-warmgray-400 hidden sm:block">
            {onDraft && '※ 下書きは後で編集・提出できます'}
          </p>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting || isDrafting || disabled}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                送信中...
              </>
            ) : (
              '申請する'
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
