export const LABEL_DICTIONARY = [
  // --- Non-Tissue ---
  { value: "non_tissue", label: "Non-Tissue", shortcut: "nt", category: "Non-Tissue", color: "#FFFFFF" },

  // --- Tumor ---
  { value: "tumor", label: "Tumor", shortcut: "t", category: "Tumor", color: "#FF0000" },
  { value: "tumor.invasive", label: "Invasive Tumor", shortcut: "ti", category: "Tumor", color: "#8B0000" },
  { value: "tumor.in_situ", label: "In Situ Carcinoma", shortcut: "ts", category: "Tumor", color: "#FF6347" },
  { value: "tumor.associated_stroma", label: "Tumor-Associated Stroma", shortcut: "ta", category: "Tumor", color: "#FF4500" },
  { value: "tumor.mucin", label: "Mucin", shortcut: "tm", category: "Tumor", color: "#ADD8E6" },

  // --- Tumor Features ---
  { value: "tumor.lymphovascular_invasion", label: "Lymphovascular Invasion", shortcut: "lvi", category: "Tumor Feature", color: "#FF1493" },
  { value: "tumor.perineural_invasion", label: "Perineural Invasion", shortcut: "pni", category: "Tumor Feature", color: "#FF00FF" },

  // --- Tissue ---
  { value: "tissue.benign", label: "Benign Tissue", shortcut: "b", category: "Tissue", color: "#00FF00" },
  { value: "tissue.stroma", label: "Stroma", shortcut: "s", category: "Tissue", color: "#FFA500" },
  { value: "tissue.necrosis", label: "Necrosis", shortcut: "n", category: "Tissue", color: "#333333" },
  { value: "tissue.adipose", label: "Adipose", shortcut: "ad", category: "Tissue", color: "#FFFF00" },
  { value: "tissue.epithelium", label: "Epithelium", shortcut: "e", category: "Tissue", color: "#FFC0CB" },

  // --- Structure ---
  { value: "structure.gland", label: "Gland", shortcut: "g", category: "Structure", color: "#008000" },
  { value: "structure.lumen", label: "Lumen", shortcut: "gl", category: "Structure", color: "#E0FFFF" },
  { value: "structure.basement_membrane", label: "Basement Membrane", shortcut: "bm", category: "Structure", color: "#8B4513" },

  // --- Immune ---
  { value: "immune.inflammation", label: "Inflammation", shortcut: "i", category: "Immune", color: "#0000FF" },
  { value: "immune.lymphocytes", label: "Lymphocytes", shortcut: "ly", category: "Immune", color: "#800080" },

  // --- Cell-level ---
  { value: "cell.tumor_nucleus", label: "Tumor Nucleus", shortcut: "tn", category: "Cell", color: "#B22222" },
  { value: "cell.stromal_nucleus", label: "Stromal Nucleus", shortcut: "sn", category: "Cell", color: "#DAA520" },
  { value: "cell.lymphocyte_nucleus", label: "Lymphocyte Nucleus", shortcut: "ln", category: "Cell", color: "#9370DB" },
  { value: "cell.macrophage", label: "Macrophage", shortcut: "mphi", category: "Cell", color: "#4682B4" },
  { value: "cell.endothelial", label: "Endothelial Cell", shortcut: "ec", category: "Cell", color: "#20B2AA" },

  // --- Artifacts ---
  { value: "artifact.tissue_fold", label: "Tissue Fold", shortcut: "tf", category: "Artifact", color: "#808080" },
  { value: "artifact.pen_ink", label: "Pen Ink", shortcut: "pi", category: "Artifact", color: "#000080" },
  { value: "artifact.out_of_focus", label: "Out of Focus", shortcut: "oof", category: "Artifact", color: "#A9A9A9" },
  { value: "artifact.dust", label: "Dust", shortcut: "d", category: "Artifact", color: "#D3D3D3" },
  { value: "artifact.air_bubble", label: "Air Bubble", shortcut: "ab", category: "Artifact", color: "#F5F5DC" },
  { value: "artifact.compression", label: "Compression Artifact", shortcut: "ca", category: "Artifact", color: "#708090" }
];

export const getLabelByShortcut = (shortcut) => {
  if (!shortcut) return undefined;
  return LABEL_DICTIONARY.find(item => item.shortcut.toLowerCase() === shortcut.toLowerCase());
};

export const getLabelByValue = (value) => {
  return LABEL_DICTIONARY.find(item => item.value === value);
};
