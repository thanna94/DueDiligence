/**
 * County Configuration Module
 *
 * Defines all supported counties and their data sources.
 * To add a new county, add an entry to COUNTY_CONFIGS and call CountyRegistry.register().
 */

const COUNTY_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea',
  '#ea580c', '#0891b2', '#be185d', '#4f46e5'
];

const COUNTY_CONFIGS = {
  benton: {
    id: 'benton',
    name: 'Benton County',
    shortName: 'Benton',
    stateFips: '05',
    countyFips: '007',
    fipsCode: '05007',
    center: [36.34, -94.25],
    zoom: 11,
    color: COUNTY_COLORS[0],
    bounds: [[35.95, -94.62], [36.50, -93.87]],
    assessorUrl: 'https://www.bentoncountyar.gov/county-assessor',
    gisServices: {
      parcels: 'https://services1.arcgis.com/USodXIDgMaj0VC4u/arcgis/rest/services',
      parcelLayerName: 'Benton_County_Parcels',
    },
    parcelIdField: 'PARCEL_ID',
    ownerField: 'OWNER',
    addressField: 'SITUS_ADDR',
    acresField: 'ACRES',
  },
  washington: {
    id: 'washington',
    name: 'Washington County',
    shortName: 'Washington',
    stateFips: '05',
    countyFips: '143',
    fipsCode: '05143',
    center: [36.00, -94.22],
    zoom: 11,
    color: COUNTY_COLORS[1],
    bounds: [[35.72, -94.49], [36.14, -93.93]],
    assessorUrl: 'https://www.co.washington.ar.us/assessor',
    gisServices: {
      parcels: 'https://services1.arcgis.com/USodXIDgMaj0VC4u/arcgis/rest/services',
      parcelLayerName: 'Washington_County_Parcels',
    },
    parcelIdField: 'PARCEL_ID',
    ownerField: 'OWNER',
    addressField: 'SITUS_ADDR',
    acresField: 'ACRES',
  },
  crawford: {
    id: 'crawford',
    name: 'Crawford County',
    shortName: 'Crawford',
    stateFips: '05',
    countyFips: '033',
    fipsCode: '05033',
    center: [35.59, -94.24],
    zoom: 11,
    color: COUNTY_COLORS[2],
    bounds: [[35.35, -94.49], [35.77, -93.93]],
    assessorUrl: 'https://www.crawfordcountyar.com',
    gisServices: {
      parcels: 'https://services1.arcgis.com/USodXIDgMaj0VC4u/arcgis/rest/services',
      parcelLayerName: 'Crawford_County_Parcels',
    },
    parcelIdField: 'PARCEL_ID',
    ownerField: 'OWNER',
    addressField: 'SITUS_ADDR',
    acresField: 'ACRES',
  },
  sebastian: {
    id: 'sebastian',
    name: 'Sebastian County',
    shortName: 'Sebastian',
    stateFips: '05',
    countyFips: '131',
    fipsCode: '05131',
    center: [35.37, -94.34],
    zoom: 11,
    color: COUNTY_COLORS[3],
    bounds: [[35.12, -94.50], [35.57, -94.02]],
    assessorUrl: 'https://www.sebastiancountyar.gov',
    gisServices: {
      parcels: 'https://services1.arcgis.com/USodXIDgMaj0VC4u/arcgis/rest/services',
      parcelLayerName: 'Sebastian_County_Parcels',
    },
    parcelIdField: 'PARCEL_ID',
    ownerField: 'OWNER',
    addressField: 'SITUS_ADDR',
    acresField: 'ACRES',
  }
};

/**
 * NWA region default view encompassing all four counties
 */
const NWA_REGION = {
  center: [35.85, -94.25],
  zoom: 9,
  bounds: [[35.12, -94.62], [36.50, -93.87]]
};

/**
 * Arkansas statewide GIS services used as fallback / primary data source
 */
const ARKANSAS_GIS = {
  // Arkansas GIS Office - Statewide Parcel Viewer (ArcGIS REST)
  parcelService: 'https://gis.arkansas.gov/arcgis/rest/services/AGIO_Parcels/FeatureServer/0',
  // Backup: Arkansas Assessment Coordination Dept
  assessmentSearch: 'https://www.arcountydata.com',
  // FEMA flood zones
  floodService: 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer',
  // Census TIGER boundaries
  tigerService: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer',
};

/**
 * County Registry - manages all county configurations.
 * Supports dynamic addition of new counties at runtime.
 */
const CountyRegistry = {
  _counties: { ...COUNTY_CONFIGS },
  _listeners: [],

  getAll() {
    return Object.values(this._counties);
  },

  get(id) {
    return this._counties[id] || null;
  },

  getByFips(fipsCode) {
    return this.getAll().find(c => c.fipsCode === fipsCode) || null;
  },

  register(config) {
    const id = config.id || config.shortName.toLowerCase().replace(/\s+/g, '_');
    const colorIndex = Object.keys(this._counties).length % COUNTY_COLORS.length;
    const county = {
      id,
      color: COUNTY_COLORS[colorIndex],
      parcelIdField: 'PARCEL_ID',
      ownerField: 'OWNER',
      addressField: 'SITUS_ADDR',
      acresField: 'ACRES',
      gisServices: { parcels: ARKANSAS_GIS.parcelService },
      ...config,
      name: config.name || `${config.shortName} County`,
      fipsCode: config.fipsCode || (config.stateFips || '05') + (config.countyFips || '000'),
    };
    this._counties[id] = county;
    this._listeners.forEach(fn => fn(county, 'added'));
    this._saveCustomCounties();
    return county;
  },

  remove(id) {
    if (COUNTY_CONFIGS[id]) return false; // Can't remove built-in
    const county = this._counties[id];
    if (county) {
      delete this._counties[id];
      this._listeners.forEach(fn => fn(county, 'removed'));
      this._saveCustomCounties();
      return true;
    }
    return false;
  },

  onChange(fn) {
    this._listeners.push(fn);
  },

  _saveCustomCounties() {
    const custom = {};
    for (const [id, config] of Object.entries(this._counties)) {
      if (!COUNTY_CONFIGS[id]) custom[id] = config;
    }
    try {
      localStorage.setItem('nwa_dd_custom_counties', JSON.stringify(custom));
    } catch (e) { /* quota exceeded or private browsing */ }
  },

  loadCustomCounties() {
    try {
      const data = localStorage.getItem('nwa_dd_custom_counties');
      if (data) {
        const custom = JSON.parse(data);
        for (const [id, config] of Object.entries(custom)) {
          this._counties[id] = config;
        }
      }
    } catch (e) { /* ignore */ }
  }
};
