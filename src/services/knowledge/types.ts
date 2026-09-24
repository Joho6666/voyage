export type TravelKnowledgeKind =
  | "city_rule"
  | "poi_knowledge"
  | "transport_rule"
  | "route_case";

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
}

export interface TravelKnowledgeMatch extends TravelKnowledgeRecord {
  relevance: number;
}
