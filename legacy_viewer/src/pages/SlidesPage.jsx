import { useOutletContext } from 'react-router-dom';
import { SlidesOverview } from '../components/slides/SlidesOverview.jsx';
import { apiClient } from '../api/client.js';

export function SlidesPage() {
  const { selectedProject, selectedDataset, slides, fetchSlides } = useOutletContext();

  const handleUploadComplete = async () => {
    if (selectedDataset?.id && fetchSlides) {
      await fetchSlides(selectedDataset.id);
    }
  };

  return (
    <SlidesOverview
      project={selectedProject}
      dataset={selectedDataset}
      slides={slides}
      onUploadComplete={handleUploadComplete}
    />
  );
}
