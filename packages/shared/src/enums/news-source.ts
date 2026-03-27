export const NewsSource = {
  POLYGON: 'POLYGON',
  RSS_CNBC: 'RSS_CNBC',
  RSS_YAHOO: 'RSS_YAHOO',
  RSS_BBC: 'RSS_BBC',
  RSS_GUARDIAN: 'RSS_GUARDIAN',
  RSS_NPR: 'RSS_NPR',
  RSS_REUTERS_PROXY: 'RSS_REUTERS_PROXY',
  X_INFLUENCER: 'X_INFLUENCER',
  RSS_SIGNALHUB: 'RSS_SIGNALHUB',
  CRYPTO_6551: 'CRYPTO_6551',
} as const;

export type NewsSource = (typeof NewsSource)[keyof typeof NewsSource];
