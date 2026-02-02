
// 텍스트 속성 (공통)
export interface TextProperties {
  font_size: string;
  text_color: string;
  background_color: string;
  opacity: string;
  emphasis: string;
}

// 셀/박스 단위 텍스트 정보
export interface TextCellElement {
  cell_id: string;
  cell_position?: string;
  original_chinese: string;
  cell_bounding_box: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  properties: TextProperties;
}

// 박스/표 구조 정보
export interface BoxStructure {
  box_id: string;
  box_type: 'info_box' | 'table' | 'other';
  box_bounding_box: [number, number, number, number];
  box_background_color: string;
  box_border_color: string;
  cells: TextCellElement[];
}

// 분석 단계 데이터 (Phase 3 Schema)
export interface AnalysisStage {
  chinese_text_count: number;
  boxes_and_tables_detected: number;
  boxes_and_tables: BoxStructure[];
  warning?: string;
}

// 렌더링 보존 확인
export interface RenderingPreservation {
  boxes_preserved: boolean;
  table_structure_preserved: boolean;
  cell_structure_preserved: boolean;
  font_sizes_maintained: boolean;
  colors_maintained: boolean;
  backgrounds_maintained: boolean;
  opacity_maintained: boolean;
  positions_maintained: boolean;
  borders_maintained: boolean;
}

// 검증 결과
export interface ValidationResult {
  boxes_and_tables_detected: boolean;
  all_box_texts_recognized: boolean;
  box_structure_safe: boolean;
  no_box_text_deleted: boolean;
  rendering_safe: boolean;
  coordinates_recorded: boolean;
  ready_for_image_gen: boolean;
}

// 생성용 텍스트 교체 정보 (단일 박스/셀 대상)
export interface TextReplacement {
  box_id: string;
  cell_id: string;
  original: string;
  replacement: string;
  bounding_box: [number, number, number, number];
  properties: TextProperties;
}

// 카피라이팅 옵션 (UI 표시용 + 생성 데이터 포함)
export interface CopywritingOption {
  index: number;
  tone: string;
  text: string; // UI 표시용 요약 텍스트 (여러 박스 내용을 합친 것)
  replacements: TextReplacement[]; // 실제 생성 시 사용할 개별 교체 데이터 리스트
}

// Main Work Item
export interface WorkItem {
  id: string;
  originalImage: string;
  generatedImage: string | null;
  status: 'idle' | 'analyzing' | 'selecting' | 'processing' | 'complete' | 'error';
  statusMessage?: string; // [NEW] Detailed status feedback (e.g., "Retrying 2/5...")
  error: string | null;
  
  copywritingOptions: CopywritingOption[];
  selectedOption: CopywritingOption | null;
  
  // Analysis Data
  extractedTexts?: string[]; 
  analysisData?: AnalysisStage;
  renderingPreserved?: RenderingPreservation;
  validation?: ValidationResult;
}

export interface ThumbnailData {
  originalImage: string | null;
  generatedImage: string | null;
  status: 'idle' | 'analyzing' | 'generating' | 'complete' | 'error';
  analysisReport: string | null;
  seoTip: string | null;
  generationPrompt: string | null;
}

export interface AppState {
  items: WorkItem[];
  referenceImage: string | null;
  isReferenceSkipped: boolean;
  marketName: string;
}

export type Category = 'etc';
