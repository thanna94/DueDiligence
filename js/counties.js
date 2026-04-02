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
    assessorUrl: 'https://www.arcountydata.com/propsearch.asp?county=Benton',
    assessorPropertyUrl: 'https://www.arcountydata.com/parcel.asp?Ession=',
    gisViewerUrl: 'https://gis.bentoncountyar.gov/parcels/index.html',
    propertyInfoUrl: 'https://gis.bentoncountyar.gov/propertyinformation/index.php',
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
    assessorUrl: 'https://www.arcountydata.com/propsearch.asp?county=Washington',
    assessorPropertyUrl: 'https://www.arcountydata.com/parcel.asp?Ession=',
    gisViewerUrl: 'https://arcserv.co.washington.ar.us/portal/apps/webappviewer/index.html?id=02d08271ae3a4955829f17f1c5a15544',
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
    assessorUrl: 'https://www.arcountydata.com/propsearch.asp?county=Crawford',
    assessorPropertyUrl: 'https://www.arcountydata.com/parcel.asp?Ession=',
    gisViewerUrl: 'https://www.arcgis.com/apps/webappviewer/index.html?id=c42df3f49431484db224e11647e3394a',
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
    assessorUrl: 'https://www.arcountydata.com/propsearch.asp?county=Sebastian',
    assessorPropertyUrl: 'https://www.arcountydata.com/parcel.asp?Ession=',
    gisViewerUrl: 'https://www.arcgis.com/apps/webappviewer/index.html?id=32890cc78aee488c972aa4d058523bde',
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
 * Arkansas statewide GIS services — REAL verified endpoints
 *
 * Planning_Cadastre FeatureServer layers:
 *   0 = PARCEL_CENTROID_CAMP (points with CAMA attributes)
 *   6 = PARCEL_POLYGON_CAMP (polygon boundaries with CAMA attributes)
 *
 * Fields in these layers (lowercase):
 *   parcelid, parcellgl, ownername, adrnum, predir, pstrnam, pstrtype,
 *   psufdir, adrcity, adrzip5, adrlabel, parceltype, assessvalue,
 *   impvalue, landvalue, totalvalue, subdivision, nbhd, section,
 *   township, range, str, taxcode, taxarea, camakey, camaprov,
 *   county, dataprov, camadate, pubdate, countyfips, countyid,
 *   gis_acres, sourceref, sourcedate
 */
const ARKANSAS_GIS = {
  // Statewide parcel polygons (boundaries)
  parcelPolygonService: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6',
  // Statewide parcel centroids (points — faster for point queries)
  parcelCentroidService: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/0',
  // MapServer version (for tile/identify operations)
  parcelMapService: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/MapServer',
  // County assessor data portal (for detailed CAMA records)
  assessmentSearch: 'https://www.arcountydata.com',
  // FEMA National Flood Hazard Layer
  floodService: 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer',
  // Arkansas Utilities layer
  utilitiesService: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Utilities/FeatureServer',
  // Arkansas Boundaries layer
  boundariesService: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Boundaries/FeatureServer',
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

  getByCountyName(name) {
    if (!name) return null;
    const upper = name.toUpperCase();
    return this.getAll().find(c => c.shortName.toUpperCase() === upper) || null;
  },

  register(config) {
    const id = config.id || config.shortName.toLowerCase().replace(/\s+/g, '_');
    const colorIndex = Object.keys(this._counties).length % COUNTY_COLORS.length;
    const county = {
      id,
      color: COUNTY_COLORS[colorIndex],
      ...config,
      name: config.name || `${config.shortName} County`,
      fipsCode: config.fipsCode || (config.stateFips || '05') + (config.countyFips || '000'),
      assessorUrl: config.assessorUrl || `https://www.arcountydata.com/propsearch.asp?county=${encodeURIComponent(config.shortName)}`,
      assessorPropertyUrl: config.assessorPropertyUrl || 'https://www.arcountydata.com/parcel.asp?Ession=',
    };
    this._counties[id] = county;
    this._listeners.forEach(fn => fn(county, 'added'));
    this._saveCustomCounties();
    return county;
  },

  remove(id) {
    if (COUNTY_CONFIGS[id]) return false;
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
