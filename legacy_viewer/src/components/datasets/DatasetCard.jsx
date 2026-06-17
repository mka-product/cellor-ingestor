export function DatasetCard({ dataset, active, onSelect }) {
  return (
    <button
      type="button"
      className={`dataset-card ${active ? 'dataset-card--active' : ''}`}
      onClick={() => onSelect(dataset.id)}
    >
      <div className="dataset-card__title-line">
        <span className="dataset-card__name">{dataset.name}</span>
        <span className="dataset-card__pill">{dataset.slides_count ? `${dataset.slides_count} slides` : 'Slides TBD'}</span>
      </div>
      <p className="dataset-card__description">{dataset.description || 'No description yet'}</p>
      <div className="dataset-card__footer">
        <span>{dataset.storage_path || 'No storage path'}</span>
        <span>{dataset.created_at ? new Date(dataset.created_at).toLocaleDateString() : '—'}</span>
      </div>
    </button>
  );
}

