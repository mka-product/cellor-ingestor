const statusClassMap = {
  pending: 'slide-status--pending',
  processed: 'slide-status--processed',
  error: 'slide-status--error',
};

export function SlideList({ slides }) {
  if (!slides.length) {
    return <div className="section-empty">No slides registered</div>;
  }

  return (
    <div className="slide-list">
      {slides.map((slide) => {
        const statusKey = typeof slide.status === 'string' ? slide.status.toLowerCase() : '';
        return (
          <div key={slide.id} className="slide-item">
            <div>
              <div className="slide-item__title">{slide.name}</div>
              <div className="slide-item__meta">{slide.file_path || 'No file path recorded'}</div>
            </div>
            <div className="slide-item__status">
              <span className={`slide-status-badge ${statusClassMap[statusKey] || ''}`}>{slide.status}</span>
              <span className="slide-item__timestamp">
                {slide.created_at ? new Date(slide.created_at).toLocaleString() : '—'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

