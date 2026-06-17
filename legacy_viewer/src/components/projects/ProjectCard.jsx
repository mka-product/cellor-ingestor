const PROJECT_GRADIENTS = [
  ['#ff5b3c', '#ff9c45'],
  ['#36f0c2', '#168aac'],
  ['#b67dff', '#ff5fa2'],
  ['#f6f930', '#ffd23c'],
  ['#6c63ff', '#18baff'],
];

export function getProjectGradient(seed = '') {
  if (!seed) return PROJECT_GRADIENTS[0];
  const safeSeed = seed.toString();
  const hash = safeSeed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return PROJECT_GRADIENTS[hash % PROJECT_GRADIENTS.length];
}

export function ProjectCard({ project, active, onSelect }) {
  const datasetCountLabel =
    typeof project.datasets_count === 'number' ? `${project.datasets_count} datasets` : 'Datasets pending';
  const [gradientStart, gradientStop] = getProjectGradient(project.slug || project.id || project.name);
  const initials = (project.name || '?').slice(0, 2).toUpperCase();
  const createdLabel = project.created_at ? new Date(project.created_at).toLocaleDateString() : '—';

  return (
    <button
      type="button"
      className={`project-card ${active ? 'project-card--active' : ''}`}
      onClick={() => onSelect(project.id)}
    >
      <div className="project-card__frame">
        <div
          className="project-card__poster"
          style={{
            backgroundImage: `linear-gradient(135deg, ${gradientStart}, ${gradientStop})`,
          }}
          aria-hidden="true"
        >
          <span className="project-card__play">▶</span>
        </div>

        <div className="project-card__body">
          <p className="project-card__date">{createdLabel}</p>
          <h3 className="project-card__title">{project.name}</h3>
          <p className="project-card__description">{project.description || 'No description yet'}</p>
          <div className="project-card__meta-row">
            <span>{datasetCountLabel.toUpperCase()}</span>
            <span>{project.storage_path || 'Storage pending'}</span>
          </div>
          <div className="project-card__tags">
            <span className="project-card__tag">{(project.slug || initials).toUpperCase()}</span>
            <span className="project-card__tag">PROJECT</span>
          </div>
        </div>
      </div>
    </button>
  );
}

