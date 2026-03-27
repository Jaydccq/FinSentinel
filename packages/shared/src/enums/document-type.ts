export const DocumentType = {
  REGULATION: 'REGULATION',
  RESEARCH_REPORT: 'RESEARCH_REPORT',
  NEWS: 'NEWS',
  SEC_FILING: 'SEC_FILING',
  OTHER: 'OTHER',
} as const;

export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];
