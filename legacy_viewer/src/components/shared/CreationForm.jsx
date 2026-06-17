export function CreationForm({ title, description, fields, onSubmit, submitLabel, disabled }) {
  return (
    <div className="celnight-form">
      {title && <h3 className="celnight-form__title">{title}</h3>}
      {description && <p className="celnight-form__description">{description}</p>}
      <div className="celnight-form__fields">
        {fields.map((field) => (
          <input
            key={field.name}
            type={field.type || 'text'}
            className="celnight-input"
            placeholder={field.placeholder}
            value={field.value}
            onChange={field.onChange}
          />
        ))}
      </div>
      <button className="celnight-button" type="button" onClick={onSubmit} disabled={disabled}>
        {submitLabel}
      </button>
    </div>
  );
}

