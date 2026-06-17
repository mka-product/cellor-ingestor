import { useNavigate } from 'react-router-dom';
import { CreationForm } from '../shared/CreationForm.jsx';
import { SlideList } from './SlideList.jsx';

export function SlidesPanel({ projectName, dataset, slides, slideForm, onCreateSlide, explorerLink }) {
  const navigate = useNavigate();
  const projectId = dataset?.project_id;

  return (
    <section className="celnight-section">
      <div className="section-header">
        <div>
          <div className="celnight-breadcrumb">
            <button
              type="button"
              className="celnight-breadcrumb__link"
              onClick={() => navigate('/projects')}
            >
              Projects
            </button>
            <span> / </span>
            <button
              type="button"
              className="celnight-breadcrumb__link"
              onClick={() => projectId && navigate(`/projects/${projectId}`)}
              disabled={!projectId}
            >
              {projectName || '—'}
            </button>
            <span> / </span>
            <button
              type="button"
              className="celnight-breadcrumb__link"
              onClick={() => projectId && dataset && navigate(`/projects/${projectId}/datasets/${dataset.id}`)}
              disabled={!projectId || !dataset}
            >
              {dataset ? dataset.name : '—'}
            </button>
            <span> / Slides</span>
          </div>
          <h2 className="section-title">Slides</h2>
          <p className="section-subtitle">
            {dataset ? `Working in dataset ${dataset.name}` : 'Select a dataset to manage slides.'}
          </p>
        </div>
        <div className="section-actions">
          <button className="celnight-button celnight-button--ghost" type="button" onClick={() => window.open('https://localhost', '_blank')}>
            Open file explorer
          </button>
          {dataset && (
            <button
              className="celnight-button celnight-button--ghost"
              type="button"
              onClick={() => window.open(explorerLink, '_blank')}
            >
              Open dataset folder
            </button>
          )}
        </div>
      </div>

      {dataset ? <SlideList slides={slides} /> : <div className="section-empty">Select a dataset to manage slides.</div>}

      {dataset && (
        <CreationForm
          title="Register slide"
          description="Link a new slide file into this dataset."
          fields={[
            {
              name: 'slide-name',
              placeholder: 'Slide name',
              value: slideForm.fields.name,
              onChange: slideForm.handleChange('name'),
            },
            {
              name: 'slide-path',
              placeholder: 'Relative file path (optional)',
              value: slideForm.fields.file_path,
              onChange: slideForm.handleChange('file_path'),
            },
          ]}
          submitLabel="Register slide"
          onSubmit={onCreateSlide}
          disabled={!slideForm.fields.name.trim()}
        />
      )}
    </section>
  );
}
