import { useForm } from 'react-hook-form';
import StandardInput from './StandardInput';

// データベースから来るひな形(Template)の型を定義
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

// コンポーネントが受け取る引数(Props)の型を定義
interface DynamicFormProps {
  template: Template;
  onSubmit: (data: any) => Promise<void>;
  isSettlementPhase?: boolean;
  disabled?: boolean;
}

export default function DynamicForm({ template, onSubmit, isSettlementPhase = false, disabled = false }: DynamicFormProps) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();

  const activeSchema = isSettlementPhase ? template.settlement_schema : template.schema_definition;

  const handleFormSubmit = async (data: any) => {
    await onSubmit({
      template_id: template.id,
      stage: isSettlementPhase ? 'SETTLEMENT' : 'RINGI',
      form_data: data
    });
  };

  if (!activeSchema || !activeSchema.fields) {
    return <div className="text-warmgray-600">Loading form template...</div>;
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="card max-w-2xl mx-auto">
      <div className="border-b border-ringo-200 pb-4 mb-6">
        <h2 className="text-2xl font-bold text-warmgray-800">{template.title_ja}</h2>
        <p className="text-sm text-warmgray-600 mt-1">
          {isSettlementPhase ? '精算書作成 (Settlement Phase)' : '稟議書作成 (Ringi Phase)'}
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {activeSchema.fields.map((field) => (
          <div key={field.name} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
            <StandardInput 
              field={field} 
              register={register} 
              error={errors[field.name]} 
            />
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6 border-t border-ringo-200 flex justify-end gap-4">
        <button type="button" className="btn-tertiary" disabled={isSubmitting}>
          下書き保存 (Save Draft)
        </button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || disabled}>
          {isSubmitting ? '送信中...' : '申請 (Submit)'}
        </button>
      </div>
    </form>
  );
}