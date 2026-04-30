/** A single chunk of documentation ready for embedding and retrieval */
export interface DocChunk {
  id: string;
  tenant_id: string;
  source_file: string;
  doc_title: string;
  section_path: string;
  content: string;
  doc_type: "docs" | "handbook";
}
