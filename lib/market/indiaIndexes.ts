/**
 * Canonical NSE/Nifty index universe shared by the valuation response and the
 * monthly-history endpoint. Keeping one list prevents the two routes from
 * drifting apart when an index is added or renamed.
 */

export type IndexCategory = 'broad' | 'sector' | 'thematic';
export type ValuationSource = 'nse' | 'downstox' | 'nifty-indices';

export interface IndexConfig {
  key: string;
  name: string;
  /** Exact name in NSE's current file. Historical files are matched after normalization. */
  nseName: string;
  /** Nifty Indices trading name when it differs from the display/NSE name. */
  niftyName?: string;
  downstoxSlug: string | null;
  category: IndexCategory;
  featured: boolean;
}

/**
 * The 34 indices on Nifty Indices' official sectoral list, plus the broad
 * indices used by the headline card and the commonly followed thematic
 * indices that are treated as sectors in practice. Keeping the list explicit
 * avoids picking up bond, strategy and custom indices from the NSE file.
 */
export const INDEX_CONFIG: IndexConfig[] = [
  { key: 'nifty50', name: 'Nifty 50', nseName: 'Nifty 50', downstoxSlug: 'nifty-50', category: 'broad', featured: true },
  { key: 'niftyMidcap100', name: 'Nifty Midcap 100', nseName: 'NIFTY Midcap 100', downstoxSlug: 'nifty-midcap-100', category: 'broad', featured: true },
  { key: 'niftyBank', name: 'Nifty Bank', nseName: 'Nifty Bank', downstoxSlug: 'nifty-bank', category: 'sector', featured: true },
  { key: 'niftyIt', name: 'Nifty IT', nseName: 'Nifty IT', downstoxSlug: 'nifty-it', category: 'sector', featured: true },
  { key: 'niftyAuto', name: 'Nifty Auto', nseName: 'Nifty Auto', downstoxSlug: 'nifty-auto', category: 'sector', featured: false },
  { key: 'niftyCapitalGoods', name: 'Nifty Capital Goods', nseName: 'Nifty Capital Goods', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyCement', name: 'Nifty Cement', nseName: 'Nifty Cement', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyChemicals', name: 'Nifty Chemicals', nseName: 'Nifty Chemicals', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyCommercialTransport', name: 'Nifty Commercial & Transport Services', nseName: 'Nifty Commercial & Transport Services', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyConstruction', name: 'Nifty Construction', nseName: 'Nifty Construction', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyConsumerDurables', name: 'Nifty Consumer Durables', nseName: 'Nifty Consumer Durables', niftyName: 'NIFTY CONSR DURBL', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyConsumerServices', name: 'Nifty Consumer Services', nseName: 'Nifty Consumer Services', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyFinancialServices', name: 'Nifty Financial Services', nseName: 'Nifty Financial Services', niftyName: 'Nifty Fin Service', downstoxSlug: 'nifty-financial-services', category: 'sector', featured: false },
  { key: 'niftyFinancialServices2550', name: 'Nifty Financial Services 25/50', nseName: 'Nifty Financial Services 25/50', niftyName: 'NIFTY FINSRV25 50', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyFinancialServicesExBank', name: 'Nifty Financial Services Ex-Bank', nseName: 'Nifty Financial Services Ex-Bank', niftyName: 'Nifty FinSerExBnk', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyFmcg', name: 'Nifty FMCG', nseName: 'Nifty FMCG', downstoxSlug: 'nifty-fmcg', category: 'sector', featured: false },
  { key: 'niftyHealthcare', name: 'Nifty Healthcare', nseName: 'Nifty Healthcare Index', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyHospitals', name: 'Nifty Hospitals', nseName: 'Nifty Hospitals', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyHousingFinance', name: 'Nifty Housing Finance', nseName: 'Nifty Housing Finance', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyInsurance', name: 'Nifty Insurance', nseName: 'Nifty Insurance', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMedia', name: 'Nifty Media', nseName: 'Nifty Media', downstoxSlug: 'nifty-media', category: 'sector', featured: false },
  { key: 'niftyMetal', name: 'Nifty Metal', nseName: 'Nifty Metal', downstoxSlug: 'nifty-metal', category: 'sector', featured: false },
  { key: 'niftyNbfc', name: 'Nifty NBFC', nseName: 'Nifty NBFC', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyOilGas', name: 'Nifty Oil & Gas', nseName: 'Nifty Oil & Gas', niftyName: 'NIFTY OIL AND GAS', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyPharma', name: 'Nifty Pharma', nseName: 'Nifty Pharma', downstoxSlug: 'nifty-pharma', category: 'sector', featured: false },
  { key: 'niftyPower', name: 'Nifty Power', nseName: 'Nifty Power', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyPrivateBank', name: 'Nifty Private Bank', nseName: 'Nifty Private Bank', niftyName: 'Nifty Pvt Bank', downstoxSlug: 'nifty-private-bank', category: 'sector', featured: false },
  { key: 'niftyPsuBank', name: 'Nifty PSU Bank', nseName: 'Nifty PSU Bank', downstoxSlug: 'nifty-psu-bank', category: 'sector', featured: false },
  { key: 'niftyRealty', name: 'Nifty Realty', nseName: 'Nifty Realty', downstoxSlug: 'nifty-realty', category: 'sector', featured: false },
  { key: 'niftyReitsRealty', name: 'Nifty REITs & Realty', nseName: 'Nifty REITs & Realty', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyRetail', name: 'Nifty Retail', nseName: 'Nifty Retail', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyTelecom', name: 'Nifty Telecommunications', nseName: 'Nifty Telecommunications', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'nifty500Healthcare', name: 'Nifty500 Healthcare', nseName: 'Nifty500 Healthcare', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMidSmallFinancialServices', name: 'Nifty MidSmall Financial Services', nseName: 'Nifty MidSmall Financial Services', niftyName: 'Nifty MS Fin Serv', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMidSmallHealthcare', name: 'Nifty MidSmall Healthcare', nseName: 'Nifty MidSmall Healthcare', niftyName: 'NIFTY MIDSML HLTH', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMidSmallItTelecom', name: 'Nifty MidSmall IT & Telecom', nseName: 'Nifty MidSmall IT & Telecom', niftyName: 'Nifty MS IT Telcm', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyEnergy', name: 'Nifty Energy', nseName: 'Nifty Energy', downstoxSlug: 'nifty-energy', category: 'thematic', featured: false },
  { key: 'niftyInfrastructure', name: 'Nifty Infrastructure', nseName: 'Nifty Infrastructure', niftyName: 'Nifty Infra', downstoxSlug: 'nifty-infra', category: 'thematic', featured: false },
  { key: 'niftyConsumption', name: 'Nifty India Consumption', nseName: 'Nifty India Consumption', niftyName: 'Nifty Consumption', downstoxSlug: 'nifty-consumption', category: 'thematic', featured: false },
  { key: 'niftyCommodities', name: 'Nifty Commodities', nseName: 'Nifty Commodities', downstoxSlug: 'nifty-commodities', category: 'thematic', featured: false },
  { key: 'niftyPse', name: 'Nifty PSE', nseName: 'Nifty PSE', downstoxSlug: null, category: 'thematic', featured: false },
  { key: 'niftyCpse', name: 'Nifty CPSE', nseName: 'Nifty CPSE', downstoxSlug: 'nifty-cpse', category: 'thematic', featured: false },
  { key: 'niftyMnc', name: 'Nifty MNC', nseName: 'Nifty MNC', downstoxSlug: null, category: 'thematic', featured: false },
  { key: 'niftyServices', name: 'Nifty Services Sector', nseName: 'Nifty Services Sector', niftyName: 'Nifty Serv Sector', downstoxSlug: null, category: 'thematic', featured: false },
  { key: 'niftyDefence', name: 'Nifty India Defence', nseName: 'Nifty India Defence', niftyName: 'Nifty Ind Defence', downstoxSlug: null, category: 'thematic', featured: false },
];

/** Matches "Oil & Gas", "Oil and Gas" and "… Index" across NSE file vintages. */
export function normalizeIndexName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+index$/, '')
    .trim();
}

export function findIndexConfig(key: string): IndexConfig | undefined {
  return INDEX_CONFIG.find((config) => config.key === key);
}
