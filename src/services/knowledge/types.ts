export type TravelKnowledgeKind =
  | "city_rule"
  | "poi_knowledge"
  | "transport_rule"
  | "route_case";

export type KnowledgeAuthorityLevel = "official" | "curated" | "community" | "user" | "derived";

export interface TravelKnowledgeRecord {
  id: string;
  kind: TravelKnowledgeKind;
  city: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  source: string;
  sourceUrl?: string;
  validFrom?: string;
  validTo?: string;
  updatedAt: string;
  authorityLevel?: KnowledgeAuthorityLevel;
  documentId?: string;
  chunkId?: string;
  metadata?: Record<string, unknown>;
}

export interface TravelKnowledgeScore {
  hybrid: number;
  semantic?: number;
  keyword?: number;
  freshness?: number;
  confidence?: number;
  city?: number;
  tag?: number;
}

export interface TravelKnowledgeMatch extends TravelKnowledgeRecord {
  relevance: number;
  score?: TravelKnowledgeScore;
  citation?: {
    title: string;
    source: string;
    sourceUrl?: string;
    updatedAt?: string;
  };
}

export interface KnowledgeSourceDocument {
  sourceKey: string;
  kind: TravelKnowledgeKind;
  city: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  source: string;
  sourceUrl?: string;
  authorityLevel: KnowledgeAuthorityLevel;
  validFrom?: string;
  validTo?: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeChunk {
  id?: string;
  documentId?: string;
  chunkIndex: number;
  title: string;
  content: string;
  tags: string[];
  city: string;
  kind: TravelKnowledgeKind;
  confidence: number;
  source: string;
  sourceUrl?: string;
  authorityLevel: KnowledgeAuthorityLevel;
  validFrom?: string;
  validTo?: string;
  metadata: Record<string, unknown>;
  contentHash: string;
  embedding?: number[];
}

export interface KnowledgeRetrievalResult {
  matches: TravelKnowledgeMatch[];
  strategy: "hybrid" | "semantic" | "keyword" | "curated-local";
  vectorUsed: boolean;
  databaseUsed: boolean;
  warnings: string[];
}
