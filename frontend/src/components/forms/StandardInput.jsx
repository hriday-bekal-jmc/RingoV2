export default function StandardInput({ field, register, error }) {
  return (
    <div className="flex flex-col mb-4">
      <label className="label">
        {field.label}
        {field.required && <span className="text-ringo-500 ml-1">*</span>}
      </label>
      
      {field.type === 'text' && (
        <input 
          type="text" 
          {...register(field.name, { required: field.required })} 
          className="input" 
        />
      )}

      {field.type === 'number' && (
        <input 
          type="number" 
          {...register(field.name, { required: field.required, valueAsNumber: true })} 
          className="input" 
        />
      )}
      
      {field.type === 'date' && (
        <input 
          type="date" 
          {...register(field.name, { required: field.required })} 
          className="input" 
        />
      )}

      {field.type === 'textarea' && (
        <textarea 
          {...register(field.name, { required: field.required })} 
          className="input resize-y" 
          rows={3} 
        />
      )}

      {field.type === 'file' && (
        <input 
          type="file" 
          multiple={field.multiple}
          {...register(field.name, { required: field.required })} 
          className="block w-full text-sm text-warmgray-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-ringo-100 file:text-ringo-700 hover:file:bg-ringo-200" 
        />
      )}

      {error && <span className="text-ringo-500 text-xs mt-1">必須項目です (Required)</span>}
    </div>
  );
}