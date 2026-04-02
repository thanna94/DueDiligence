/**
 * Parcel Data Service
 *
 * Fetches parcel data from Arkansas GIS services and county assessor records.
 * Primary source: Arkansas GIS Office statewide parcel layer.
 * Supplemental: County-specific GIS endpoints and FEMA flood data.
 */

const ParcelService = (() => {
  const STATEWIDE_PARCEL_URL = ARKANSAS_GIS.parcelService;
  const FEMA_FLOOD_URL = ARKANSAS_GIS.floodService;
  const REQUEST_TIMEOUT = 15000;

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
      outFields: '*',
      returnGeometry: true,
      outSR: '4326',
    };
    const merged = { ...defaults, ...params };
    const qs = Object.entries(merged)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${serviceUrl}/query?${qs}`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) throw new Error(`ArcGIS request failed: ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || 'ArcGIS query error');
    return data;
  }

  /**
   * Find parcels at a geographic point (map click)
   */
  async function getParcelAtPoint(lat, lng, county = null) {
    const tolerance = 0.0001; // ~11m
    const geom = JSON.stringify({
      x: lng, y: lat,
      spatialReference: { wkid: 4326 }
    });

    const params = {
      geometry: geom,
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      distance: 50,
      units: 'esriSRUnit_Meter',
      inSR: '4326',
    };

    // Add county filter if specified
    if (county) {
      params.where = `CNTY_FIPS = '${county.countyFips}' OR COUNTY = '${county.shortName.toUpperCase()}'`;
    }

    try {
      const data = await queryArcGIS(STATEWIDE_PARCEL_URL, params);
      if (data.features && data.features.length > 0) {
        return normalizeParcelData(data.features[0], county);
      }
    } catch (e) {
      console.warn('Statewide parcel query failed, trying alternate:', e.message);
    }

    // Fallback: try direct county GIS if available
    if (county && county.gisServices && county.gisServices.parcels !== STATEWIDE_PARCEL_URL) {
      try {
        const altUrl = `${county.gisServices.parcels}/${county.gisServices.parcelLayerName}/FeatureServer/0`;
        const data = await queryArcGIS(altUrl, params);
        if (data.features && data.features.length > 0) {
          return normalizeParcelData(data.features[0], county);
        }
      } catch (e) {
        console.warn('County-specific parcel query failed:', e.message);
      }
    }

    return null;
  }

  /**
   * Search parcels by address
   */
  async function searchByAddress(address, county = null) {
    let where = `UPPER(SITUS_ADDR) LIKE '%${address.toUpperCase().replace(/'/g, "''")}%'`;
    if (county) {
      where += ` AND (CNTY_FIPS = '${county.countyFips}' OR COUNTY = '${county.shortName.toUpperCase()}')`;
    }

    try {
      const data = await queryArcGIS(STATEWIDE_PARCEL_URL, {
        where,
        resultRecordCount: 10,
      });
      if (data.features) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      console.warn('Address search failed:', e.message);
    }
    return [];
  }

  /**
   * Search parcels by parcel ID
   */
  async function searchByParcelId(parcelId, county = null) {
    let where = `PARCEL_ID LIKE '%${parcelId.replace(/'/g, "''")}%'`;
    if (county) {
      where += ` AND (CNTY_FIPS = '${county.countyFips}' OR COUNTY = '${county.shortName.toUpperCase()}')`;
    }

    try {
      const data = await queryArcGIS(STATEWIDE_PARCEL_URL, {
        where,
        resultRecordCount: 10,
      });
      if (data.features) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      console.warn('Parcel ID search failed:', e.message);
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
      resultRecordCount: 500,
      outFields: 'PARCEL_ID,OWNER,SITUS_ADDR,ACRES,CNTY_FIPS',
      returnGeometry: true,
    };

    if (county && county.id !== 'all') {
      params.where = `CNTY_FIPS = '${county.countyFips}' OR COUNTY = '${county.shortName.toUpperCase()}'`;
    }

    try {
      const data = await queryArcGIS(STATEWIDE_PARCEL_URL, params);
      return data;
    } catch (e) {
      console.warn('Extent query failed:', e.message);
      return { features: [] };
    }
  }

  /**
   * Get FEMA flood zone at a point
   */
  async function getFloodZone(lat, lng) {
    try {
      const geom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
      const params = new URLSearchParams({
        geometry: geom,
        geometryType: 'esriGeometryPoint',
        layers: 'all:28',  // Flood hazard zones layer
        tolerance: 5,
        mapExtent: `${lng-0.01},${lat-0.01},${lng+0.01},${lat+0.01}`,
        imageDisplay: '600,400,96',
        returnGeometry: false,
        f: 'json'
      });
      const url = `${FEMA_FLOOD_URL}/identify?${params}`;
      const resp = await fetchWithTimeout(url, {}, 10000);
      const data = await resp.json();
      if (data.results && data.results.length > 0) {
        const attrs = data.results[0].attributes;
        return {
          zone: attrs.FLD_ZONE || attrs.ZONE_SUBTY || 'Unknown',
          floodway: attrs.FLOODWAY || 'N/A',
          panelNumber: attrs.FIRM_PAN || attrs.DFIRM_ID || 'N/A',
          effectiveDate: attrs.EFF_DATE || 'N/A',
          staticBFE: attrs.STATIC_BFE || 'N/A',
        };
      }
    } catch (e) {
      console.warn('Flood zone query failed:', e.message);
    }
    return { zone: 'Data unavailable', floodway: 'N/A', panelNumber: 'N/A' };
  }

  /**
   * Normalize parcel attributes from various schemas into a common format
   */
  function normalizeParcelData(feature, county = null) {
    const a = feature.attributes || {};
    const geom = feature.geometry;

    // Try multiple possible field names
    const get = (...fields) => {
      for (const f of fields) {
        if (a[f] !== undefined && a[f] !== null && a[f] !== '') return a[f];
        // Try uppercase
        if (a[f.toUpperCase()] !== undefined && a[f.toUpperCase()] !== null && a[f.toUpperCase()] !== '') return a[f.toUpperCase()];
      }
      return null;
    };

    const parcelId = get('PARCEL_ID', 'PIN', 'APN', 'PARCELID', 'PARCEL_NUM', 'PARID');
    const owner = get('OWNER', 'OWNER_NAME', 'OWN_NAME', 'OWNERNME1', 'OWNER1');
    const ownerAddress = get('OWNER_ADDR', 'MAIL_ADDR', 'OWN_ADDR1', 'OWNADDR');
    const ownerCity = get('OWNER_CITY', 'MAIL_CITY', 'OWN_CITY');
    const ownerState = get('OWNER_STATE', 'MAIL_STATE', 'OWN_STATE');
    const ownerZip = get('OWNER_ZIP', 'MAIL_ZIP', 'OWN_ZIP');

    const situsAddr = get('SITUS_ADDR', 'SIT_ADDR', 'PROP_ADDR', 'ADDRESS', 'SITE_ADDR', 'PHYADDR1');
    const situsCity = get('SITUS_CITY', 'SIT_CITY', 'PROP_CITY', 'CITY', 'SITE_CITY');
    const situsZip = get('SITUS_ZIP', 'SIT_ZIP', 'PROP_ZIP', 'ZIP');

    const acres = parseFloat(get('ACRES', 'GIS_ACRES', 'ACREAGE', 'CALC_ACRES', 'SHAPE_Area')) || 0;
    const sqft = get('SQFT', 'SQ_FT', 'BLDG_SQFT', 'HEATED_SQF', 'TOT_SQFT', 'LVG_AREA');
    const yearBuilt = get('YEAR_BUILT', 'YR_BUILT', 'YRBUILT', 'BUILT_YR');
    const landUse = get('LAND_USE', 'USE_CODE', 'PROP_CLASS', 'CLASS_CODE', 'ZONING');
    const landUseDesc = get('LAND_USE_DESC', 'USE_DESC', 'PROP_DESC', 'CLASS_DESC');
    const zoning = get('ZONING', 'ZONE_CODE', 'ZONE_CLASS', 'ZONE');
    const zoningDesc = get('ZONING_DESC', 'ZONE_DESC');

    const assessedValue = parseFloat(get('ASSESSED', 'ASSSD_VAL', 'ASSESSED_V', 'ASSESS_VAL')) || null;
    const appraisedValue = parseFloat(get('APPRAISED', 'APPR_VAL', 'APPRAISED_', 'MARKET_VAL', 'TOT_VAL')) || null;
    const landValue = parseFloat(get('LAND_VAL', 'LAND_VALUE', 'LAND_MKTVA')) || null;
    const improvementValue = parseFloat(get('IMPR_VAL', 'IMPR_VALUE', 'BLDG_VAL', 'IMPROV_VAL')) || null;
    const taxAmount = parseFloat(get('TAX_AMOUNT', 'TAXES', 'TOT_TAX', 'TOTAL_TAX')) || null;

    const bedrooms = parseInt(get('BEDROOMS', 'BEDS', 'BED_RMS', 'BEDRMS')) || null;
    const bathrooms = parseFloat(get('BATHROOMS', 'BATHS', 'BATH_RMS', 'FULL_BATH')) || null;
    const halfBath = parseInt(get('HALF_BATH', 'HLF_BATH')) || null;
    const stories = parseFloat(get('STORIES', 'NUM_STORY', 'NO_STORIES')) || null;
    const units = parseInt(get('UNITS', 'NUM_UNITS', 'NO_UNITS')) || null;
    const bldgType = get('BLDG_TYPE', 'STYLE', 'STRUCT_TYP', 'IMPR_TYPE', 'RES_TYPE');
    const foundation = get('FOUNDATION', 'FOUND_TYPE');
    const roofType = get('ROOF_TYPE', 'ROOF');
    const heating = get('HEATING', 'HEAT_TYPE');
    const cooling = get('COOLING', 'COOL_TYPE');
    const garage = get('GARAGE', 'GARAGE_TYP', 'GARAGE_CAP');
    const pool = get('POOL', 'POOL_TYPE');

    const lastSaleDate = get('SALE_DATE', 'LAST_SALE', 'SL_DATE', 'DEED_DATE');
    const lastSalePrice = parseFloat(get('SALE_PRICE', 'LAST_PRICE', 'SL_PRICE', 'SALE_AMT')) || null;
    const deedBook = get('DEED_BOOK', 'BOOK', 'BK');
    const deedPage = get('DEED_PAGE', 'PAGE', 'PG');

    const countyName = get('COUNTY', 'CNTY_NAME', 'CO_NAME') || (county ? county.shortName : null);
    const countyFips = get('CNTY_FIPS', 'CO_FIPS', 'COUNTYFP');

    // Determine county from FIPS if not provided
    let resolvedCounty = county;
    if (!resolvedCounty && countyFips) {
      resolvedCounty = CountyRegistry.getByFips('05' + countyFips) || CountyRegistry.getByFips(countyFips);
    }

    // Calculate centroid from geometry for map centering
    let centroid = null;
    if (geom) {
      if (geom.rings) {
        // Polygon - compute centroid from first ring
        const ring = geom.rings[0];
        let cx = 0, cy = 0;
        ring.forEach(([x, y]) => { cx += x; cy += y; });
        centroid = { lat: cy / ring.length, lng: cx / ring.length };
      } else if (geom.x !== undefined) {
        centroid = { lat: geom.y, lng: geom.x };
      }
    }

    return {
      parcelId,
      // Location
      address: situsAddr,
      city: situsCity,
      zip: situsZip,
      county: countyName,
      countyFips,
      countyConfig: resolvedCounty,
      // Ownership
      owner,
      ownerAddress,
      ownerCity,
      ownerState,
      ownerZip,
      // Property
      acres,
      sqft: sqft ? parseInt(sqft) : null,
      yearBuilt: yearBuilt ? parseInt(yearBuilt) : null,
      landUse,
      landUseDesc,
      zoning,
      zoningDesc,
      // Values
      assessedValue,
      appraisedValue,
      landValue,
      improvementValue,
      taxAmount,
      // Improvements
      bedrooms,
      bathrooms,
      halfBath,
      stories,
      units,
      bldgType,
      foundation,
      roofType,
      heating,
      cooling,
      garage,
      pool,
      // Transaction
      lastSaleDate,
      lastSalePrice,
      deedBook,
      deedPage,
      // Geometry
      geometry: geom,
      centroid,
      // Raw attributes for anything we missed
      _raw: a,
    };
  }

  /**
   * Get full property detail by enriching basic parcel data
   * with flood zone and any additional lookups.
   */
  async function getFullPropertyDetail(parcel) {
    const enrichments = {};

    // Fetch flood zone data in parallel
    if (parcel.centroid) {
      try {
        enrichments.floodZone = await getFloodZone(parcel.centroid.lat, parcel.centroid.lng);
      } catch (e) {
        enrichments.floodZone = { zone: 'Unavailable' };
      }
    }

    return { ...parcel, ...enrichments };
  }

  /**
   * Build assessor lookup URL for a given parcel
   */
  function getAssessorUrl(parcel) {
    if (!parcel.countyConfig) return null;
    const county = parcel.countyConfig;

    // Arkansas county data portal
    if (parcel.parcelId) {
      return `https://www.arcountydata.com/parcel.asp?Ession=${encodeURIComponent(parcel.parcelId)}`;
    }
    return county.assessorUrl || null;
  }

  return {
    getParcelAtPoint,
    searchByAddress,
    searchByParcelId,
    getParcelsInExtent,
    getFloodZone,
    getFullPropertyDetail,
    getAssessorUrl,
    normalizeParcelData,
    queryArcGIS,
  };
})();
