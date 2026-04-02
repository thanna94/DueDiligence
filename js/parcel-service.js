/**
 * Parcel Data Service
 *
 * Fetches parcel data from Arkansas GIS Office statewide CAMP layers.
 * Primary: Planning_Cadastre FeatureServer (layer 6 = polygons, layer 0 = centroids)
 * Supplemental: FEMA flood data, county assessor links.
 *
 * Real field names from PARCEL_POLYGON_CAMP / PARCEL_CENTROID_CAMP:
 *   parcelid, parcellgl, ownername, adrnum, predir, pstrnam, pstrtype,
 *   psufdir, adrcity, adrzip5, adrlabel, parceltype, assessvalue,
 *   impvalue, landvalue, totalvalue, subdivision, nbhd, section,
 *   township, range, str, taxcode, taxarea, camakey, camaprov,
 *   county, dataprov, camadate, pubdate, countyfips, countyid,
 *   gis_acres, sourceref, sourcedate
 */

const ParcelService = (() => {
  const POLYGON_URL = ARKANSAS_GIS.parcelPolygonService;
  const CENTROID_URL = ARKANSAS_GIS.parcelCentroidService;
  const FEMA_FLOOD_URL = ARKANSAS_GIS.floodService;
  const REQUEST_TIMEOUT = 20000;

  // All useful fields to request
  const ALL_FIELDS = [
    'parcelid', 'parcellgl', 'ownername', 'adrnum', 'predir', 'pstrnam',
    'pstrtype', 'psufdir', 'adrcity', 'adrzip5', 'adrlabel', 'parceltype',
    'assessvalue', 'impvalue', 'landvalue', 'totalvalue', 'subdivision',
    'nbhd', 'section', 'township', 'range', 'str', 'taxcode', 'taxarea',
    'camakey', 'camaprov', 'county', 'dataprov', 'camadate', 'pubdate',
    'countyfips', 'countyid', 'gis_acres', 'sourceref', 'sourcedate'
  ].join(',');

  // Minimal fields for map display
  const DISPLAY_FIELDS = 'parcelid,ownername,adrlabel,county,countyfips,gis_acres,assessvalue,totalvalue';

  /**
   * Fetch wrapper with timeout
   */
  async function fetchWithTimeout(url, opts = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  /**
   * Query ArcGIS Feature Service
   */
  async function queryArcGIS(serviceUrl, params) {
    const defaults = {
      f: 'json',
      outFields: ALL_FIELDS,
      returnGeometry: true,
      outSR: '4326',
    };
    const merged = { ...defaults, ...params };
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${serviceUrl}/query?${qs}`;

    console.log('[ParcelService] Query:', url);
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) throw new Error(`ArcGIS request failed: ${resp.status}`);
    const data = await resp.json();
    if (data.error) {
      console.error('[ParcelService] ArcGIS error:', data.error);
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data;
  }

  /**
   * Build county filter WHERE clause
   */
  function countyWhere(county) {
    if (!county) return '';
    // The statewide layer uses lowercase 'county' field with the county name
    return `county = '${county.shortName}'`;
  }

  /**
   * Combine WHERE clauses with AND
   */
  function combineWhere(...clauses) {
    return clauses.filter(Boolean).join(' AND ');
  }

  /**
   * Find parcel at a geographic point (map click)
   * Uses polygon layer with geometry intersection
   */
  async function getParcelAtPoint(lat, lng, county = null) {
    const geom = JSON.stringify({
      x: lng, y: lat,
      spatialReference: { wkid: 4326 }
    });

    const params = {
      geometry: geom,
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outFields: ALL_FIELDS,
      returnGeometry: true,
    };

    // If we have a county, add a filter to speed up the query
    const cw = countyWhere(county);
    if (cw) params.where = cw;

    try {
      // Try polygon layer first (gives us the boundary shape)
      const data = await queryArcGIS(POLYGON_URL, params);
      if (data.features && data.features.length > 0) {
        return normalizeParcelData(data.features[0], county);
      }
    } catch (e) {
      console.warn('[ParcelService] Polygon query failed:', e.message);
    }

    // Fallback: try centroid layer with a buffer
    try {
      const data = await queryArcGIS(CENTROID_URL, {
        ...params,
        distance: 100,
        units: 'esriSRUnit_Meter',
      });
      if (data.features && data.features.length > 0) {
        return normalizeParcelData(data.features[0], county);
      }
    } catch (e) {
      console.warn('[ParcelService] Centroid query failed:', e.message);
    }

    return null;
  }

  /**
   * Search parcels by address text
   */
  async function searchByAddress(address, county = null) {
    // Build WHERE using the adrlabel field which contains the full situs address
    const sanitized = address.toUpperCase().replace(/'/g, "''");
    let where = `UPPER(adrlabel) LIKE '%${sanitized}%'`;

    const cw = countyWhere(county);
    if (cw) where = combineWhere(where, cw);

    try {
      const data = await queryArcGIS(CENTROID_URL, {
        where,
        outFields: ALL_FIELDS,
        returnGeometry: true,
        resultRecordCount: 15,
      });
      if (data.features) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      console.warn('[ParcelService] Address search failed:', e.message);
    }

    // Fallback: try searching by street name parts
    try {
      const parts = sanitized.split(/\s+/).filter(p => p.length > 2);
      if (parts.length > 0) {
        let where2 = parts.map(p => `UPPER(pstrnam) LIKE '%${p}%'`).join(' AND ');
        // Also try matching the address number
        const numMatch = address.match(/^\d+/);
        if (numMatch) {
          where2 = `adrnum = ${numMatch[0]} AND ${where2}`;
        }
        const cw2 = countyWhere(county);
        if (cw2) where2 = combineWhere(where2, cw2);

        const data = await queryArcGIS(CENTROID_URL, {
          where: where2,
          outFields: ALL_FIELDS,
          returnGeometry: true,
          resultRecordCount: 15,
        });
        if (data.features && data.features.length > 0) {
          return data.features.map(f => normalizeParcelData(f, county));
        }
      }
    } catch (e) {
      console.warn('[ParcelService] Fallback address search failed:', e.message);
    }

    return [];
  }

  /**
   * Search parcels by parcel ID
   */
  async function searchByParcelId(parcelId, county = null) {
    const sanitized = parcelId.replace(/'/g, "''");
    let where = `parcelid LIKE '%${sanitized}%'`;
    const cw = countyWhere(county);
    if (cw) where = combineWhere(where, cw);

    try {
      const data = await queryArcGIS(CENTROID_URL, {
        where,
        outFields: ALL_FIELDS,
        returnGeometry: true,
        resultRecordCount: 15,
      });
      if (data.features) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      console.warn('[ParcelService] Parcel ID search failed:', e.message);
    }
    return [];
  }

  /**
   * Search parcels by owner name
   */
  async function searchByOwner(ownerName, county = null) {
    const sanitized = ownerName.toUpperCase().replace(/'/g, "''");
    let where = `UPPER(ownername) LIKE '%${sanitized}%'`;
    const cw = countyWhere(county);
    if (cw) where = combineWhere(where, cw);

    try {
      const data = await queryArcGIS(CENTROID_URL, {
        where,
        outFields: ALL_FIELDS,
        returnGeometry: true,
        resultRecordCount: 15,
      });
      if (data.features) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      console.warn('[ParcelService] Owner search failed:', e.message);
    }
    return [];
  }

  /**
   * Get parcels in a map extent for display
   */
  async function getParcelsInExtent(bounds, county = null) {
    const geom = JSON.stringify({
      xmin: bounds.getWest(),
      ymin: bounds.getSouth(),
      xmax: bounds.getEast(),
      ymax: bounds.getNorth(),
      spatialReference: { wkid: 4326 }
    });

    const params = {
      geometry: geom,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      resultRecordCount: 1000,
      outFields: DISPLAY_FIELDS,
      returnGeometry: true,
    };

    const cw = countyWhere(county);
    if (cw) params.where = cw;

    try {
      const data = await queryArcGIS(POLYGON_URL, params);
      return data;
    } catch (e) {
      console.warn('[ParcelService] Extent query failed:', e.message);
      return { features: [] };
    }
  }

  /**
   * Get FEMA flood zone at a point
   */
  async function getFloodZone(lat, lng) {
    try {
      const params = new URLSearchParams({
        geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryPoint',
        layers: 'all:28',
        tolerance: 10,
        mapExtent: `${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}`,
        imageDisplay: '800,600,96',
        returnGeometry: false,
        f: 'json'
      });
      const url = `${FEMA_FLOOD_URL}/identify?${params}`;
      console.log('[ParcelService] Flood query:', url);
      const resp = await fetchWithTimeout(url, {}, 12000);
      const data = await resp.json();
      if (data.results && data.results.length > 0) {
        const a = data.results[0].attributes;
        return {
          zone: a.FLD_ZONE || a.ZONE_SUBTY || 'Unknown',
          floodway: a.FLOODWAY || 'N/A',
          panelNumber: a.FIRM_PAN || a.DFIRM_ID || 'N/A',
          effectiveDate: a.EFF_DATE || 'N/A',
          staticBFE: a.STATIC_BFE || 'N/A',
          description: getFloodZoneDescription(a.FLD_ZONE),
        };
      }
      // No results means likely outside any mapped flood zone
      return {
        zone: 'X (Minimal Risk)',
        floodway: 'N/A',
        panelNumber: 'N/A',
        effectiveDate: 'N/A',
        staticBFE: 'N/A',
        description: 'Area of minimal flood hazard. Outside the 0.2% annual chance floodplain.',
      };
    } catch (e) {
      console.warn('[ParcelService] Flood zone query failed:', e.message);
    }
    return { zone: 'Data unavailable', floodway: 'N/A', panelNumber: 'N/A', description: '' };
  }

  function getFloodZoneDescription(zone) {
    if (!zone) return '';
    const z = zone.toUpperCase();
    if (z.startsWith('A') && z !== 'AR') return 'Special Flood Hazard Area — 1% annual chance of flooding (100-year floodplain). Flood insurance required for federally backed mortgages.';
    if (z === 'AR') return 'Special Flood Hazard Area — Regulatory floodway area.';
    if (z.startsWith('V')) return 'Coastal high hazard area — 1% annual chance of flooding with wave action.';
    if (z === 'X' || z === 'C') return 'Area of minimal flood hazard. Outside the 0.2% annual chance floodplain.';
    if (z.includes('SHADED') || z === 'B') return 'Moderate flood hazard area — 0.2% annual chance of flooding (500-year floodplain).';
    return '';
  }

  /**
   * Normalize parcel attributes from the Arkansas CAMP schema into a common format
   */
  function normalizeParcelData(feature, county = null) {
    const a = feature.attributes || {};
    const geom = feature.geometry;

    // Helper: get field value (try both cases since ArcGIS can return either)
    const get = (field) => {
      const v = a[field] !== undefined ? a[field] : a[field.toUpperCase()];
      if (v === null || v === undefined || v === '' || v === 'Null') return null;
      return v;
    };

    // Build full situs address from component parts
    const addrParts = [
      get('adrnum'),
      get('predir'),
      get('pstrnam'),
      get('pstrtype'),
      get('psufdir')
    ].filter(Boolean);
    const builtAddress = addrParts.length > 1 ? addrParts.join(' ') : null;

    const parcelId = get('parcelid');
    const address = get('adrlabel') || builtAddress;
    const city = get('adrcity');
    const zip = get('adrzip5') ? String(get('adrzip5')) : null;
    const countyName = get('county');
    const countyFips = get('countyfips');

    // Resolve county config
    let resolvedCounty = county;
    if (!resolvedCounty && countyName) {
      resolvedCounty = CountyRegistry.getByCountyName(countyName);
    }
    if (!resolvedCounty && countyFips) {
      resolvedCounty = CountyRegistry.getByFips('05' + String(countyFips).padStart(3, '0'));
    }

    // Calculate centroid from geometry
    let centroid = null;
    if (geom) {
      if (geom.rings && geom.rings.length > 0) {
        const ring = geom.rings[0];
        let cx = 0, cy = 0;
        ring.forEach(([x, y]) => { cx += x; cy += y; });
        centroid = { lat: cy / ring.length, lng: cx / ring.length };
      } else if (geom.x !== undefined && geom.y !== undefined) {
        centroid = { lat: geom.y, lng: geom.x };
      }
    }

    const acres = parseFloat(get('gis_acres')) || null;
    const assessedValue = parseFloat(get('assessvalue')) || null;
    const improvementValue = parseFloat(get('impvalue')) || null;
    const landValue = parseFloat(get('landvalue')) || null;
    const totalValue = parseFloat(get('totalvalue')) || null;

    return {
      // Identification
      parcelId,
      camaKey: get('camakey'),
      countyId: get('countyid'),

      // Location
      address,
      city,
      zip,
      county: countyName,
      countyFips,
      countyConfig: resolvedCounty,

      // Ownership
      owner: get('ownername'),

      // Property characteristics
      acres,
      parcelType: get('parceltype'),
      subdivision: get('subdivision'),
      neighborhood: get('nbhd'),

      // Legal description
      legalDescription: get('parcellgl'),
      section: get('section'),
      township: get('township'),
      range: get('range'),
      str: get('str'),

      // Valuation
      assessedValue,
      improvementValue,
      landValue,
      totalValue,

      // Tax
      taxCode: get('taxcode'),
      taxArea: get('taxarea'),

      // Source metadata
      dataProvider: get('dataprov'),
      camaProvider: get('camaprov'),
      camaDate: get('camadate'),
      pubDate: get('pubdate'),
      sourceRef: get('sourceref'),
      sourceDate: get('sourcedate'),

      // Geometry
      geometry: geom,
      centroid,

      // Raw attributes
      _raw: a,
    };
  }

  /**
   * Enrich parcel data with flood zone info
   */
  async function getFullPropertyDetail(parcel) {
    const enrichments = {};

    if (parcel.centroid) {
      try {
        enrichments.floodZone = await getFloodZone(parcel.centroid.lat, parcel.centroid.lng);
      } catch (e) {
        enrichments.floodZone = { zone: 'Unavailable', description: '' };
      }
    }

    return { ...parcel, ...enrichments };
  }

  /**
   * Build assessor lookup URL for detailed CAMA data (beds, baths, sqft, etc.)
   */
  function getAssessorUrl(parcel) {
    const county = parcel.countyConfig;
    if (county && county.assessorPropertyUrl && parcel.parcelId) {
      return county.assessorPropertyUrl + encodeURIComponent(parcel.parcelId);
    }
    if (county && county.assessorUrl) {
      return county.assessorUrl;
    }
    // Fallback to arcountydata.com search
    if (parcel.county) {
      return `https://www.arcountydata.com/propsearch.asp?county=${encodeURIComponent(parcel.county)}`;
    }
    return null;
  }

  /**
   * Build county GIS viewer URL
   */
  function getGisViewerUrl(parcel) {
    const county = parcel.countyConfig;
    return county ? county.gisViewerUrl : null;
  }

  return {
    getParcelAtPoint,
    searchByAddress,
    searchByParcelId,
    searchByOwner,
    getParcelsInExtent,
    getFloodZone,
    getFullPropertyDetail,
    getAssessorUrl,
    getGisViewerUrl,
    normalizeParcelData,
    queryArcGIS,
  };
})();
