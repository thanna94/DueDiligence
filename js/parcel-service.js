/**
 * Parcel Data Service
 *
 * Fetches parcel data from Arkansas GIS Office statewide CAMP layers.
 * Uses JSONP fallback for Safari/iOS CORS compatibility.
 * Optionally enriches with ATTOM API data (beds, baths, sqft, etc.)
 *
 * Arkansas CAMP field names:
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

  const ALL_FIELDS = [
    'parcelid', 'parcellgl', 'ownername', 'adrnum', 'predir', 'pstrnam',
    'pstrtype', 'psufdir', 'adrcity', 'adrzip5', 'adrlabel', 'parceltype',
    'assessvalue', 'impvalue', 'landvalue', 'totalvalue', 'subdivision',
    'nbhd', 'section', 'township', 'range', 'str', 'taxcode', 'taxarea',
    'camakey', 'camaprov', 'county', 'dataprov', 'camadate', 'pubdate',
    'countyfips', 'countyid', 'gis_acres', 'sourceref', 'sourcedate'
  ].join(',');

  const DISPLAY_FIELDS = 'parcelid,ownername,adrlabel,county,countyfips,gis_acres,assessvalue,totalvalue';

  // ---- JSONP support for CORS-restricted servers (Safari/iOS fix) ----

  let jsonpCounter = 0;

  /**
   * Execute a JSONP request (bypasses CORS entirely)
   */
  function jsonpRequest(url, timeout = REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const callbackName = '_arcgis_cb_' + (++jsonpCounter);
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP request timed out'));
      }, timeout);

      function cleanup() {
        clearTimeout(timer);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      const separator = url.includes('?') ? '&' : '?';
      const script = document.createElement('script');
      script.src = `${url}${separator}callback=${callbackName}`;
      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP script load failed'));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Query ArcGIS with fetch first, JSONP fallback for CORS issues
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

    // Try fetch first
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || 'ArcGIS error');
        return data;
      }
      throw new Error(`HTTP ${resp.status}`);
    } catch (fetchErr) {
      console.warn('[ParcelService] Fetch failed, trying JSONP:', fetchErr.message);
    }

    // Fallback: JSONP (works on Safari even without CORS headers)
    try {
      const data = await jsonpRequest(url);
      if (data.error) throw new Error(data.error.message || 'ArcGIS error');
      return data;
    } catch (jsonpErr) {
      console.error('[ParcelService] JSONP also failed:', jsonpErr.message);
      throw jsonpErr;
    }
  }

  /**
   * Fetch JSON with timeout (for non-ArcGIS APIs like FEMA, ATTOM)
   */
  async function fetchJSON(url, opts = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  // ---- County filter helpers ----

  function countyWhere(county) {
    if (!county) return '';
    return `county = '${county.shortName}'`;
  }

  function combineWhere(...clauses) {
    return clauses.filter(Boolean).join(' AND ');
  }

  // ---- Parcel queries ----

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
    const cw = countyWhere(county);
    if (cw) params.where = cw;

    // Try polygon layer first (gets boundary shape)
    try {
      const data = await queryArcGIS(POLYGON_URL, params);
      if (data.features && data.features.length > 0) {
        return normalizeParcelData(data.features[0], county);
      }
    } catch (e) {
      console.warn('[ParcelService] Polygon query failed:', e.message);
    }

    // Fallback: centroid layer with buffer
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

  async function searchByAddress(address, county = null) {
    const sanitized = address.toUpperCase().replace(/'/g, "''");
    let where = `UPPER(adrlabel) LIKE '%${sanitized}%'`;
    const cw = countyWhere(county);
    if (cw) where = combineWhere(where, cw);

    try {
      const data = await queryArcGIS(CENTROID_URL, {
        where,
        resultRecordCount: 15,
      });
      if (data.features && data.features.length > 0) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      console.warn('[ParcelService] Address search failed:', e.message);
    }

    // Fallback: search by street name parts
    try {
      const parts = sanitized.split(/\s+/).filter(p => p.length > 2);
      if (parts.length > 0) {
        let where2 = parts.map(p => `UPPER(pstrnam) LIKE '%${p}%'`).join(' AND ');
        const numMatch = address.match(/^\d+/);
        if (numMatch) where2 = `adrnum = ${numMatch[0]} AND ${where2}`;
        if (cw) where2 = combineWhere(where2, cw);

        const data = await queryArcGIS(CENTROID_URL, {
          where: where2,
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

  async function searchByParcelId(parcelId, county = null) {
    const sanitized = parcelId.replace(/'/g, "''");
    let where = `parcelid LIKE '%${sanitized}%'`;
    const cw = countyWhere(county);
    if (cw) where = combineWhere(where, cw);

    try {
      const data = await queryArcGIS(CENTROID_URL, { where, resultRecordCount: 15 });
      if (data.features) return data.features.map(f => normalizeParcelData(f, county));
    } catch (e) {
      console.warn('[ParcelService] Parcel ID search failed:', e.message);
    }
    return [];
  }

  async function searchByOwner(ownerName, county = null) {
    const sanitized = ownerName.toUpperCase().replace(/'/g, "''");
    let where = `UPPER(ownername) LIKE '%${sanitized}%'`;
    const cw = countyWhere(county);
    if (cw) where = combineWhere(where, cw);

    try {
      const data = await queryArcGIS(CENTROID_URL, { where, resultRecordCount: 15 });
      if (data.features) return data.features.map(f => normalizeParcelData(f, county));
    } catch (e) {
      console.warn('[ParcelService] Owner search failed:', e.message);
    }
    return [];
  }

  async function getParcelsInExtent(bounds, county = null) {
    const geom = JSON.stringify({
      xmin: bounds.getWest(), ymin: bounds.getSouth(),
      xmax: bounds.getEast(), ymax: bounds.getNorth(),
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
      return await queryArcGIS(POLYGON_URL, params);
    } catch (e) {
      console.warn('[ParcelService] Extent query failed:', e.message);
      return { features: [] };
    }
  }

  // ---- FEMA Flood Zone ----

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
        f: 'json',
      });
      const url = `${FEMA_FLOOD_URL}/identify?${params}`;

      let data;
      try {
        data = await fetchJSON(url, {}, 12000);
      } catch (e) {
        // JSONP fallback for FEMA too
        data = await jsonpRequest(url, 12000);
      }

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
      return {
        zone: 'X (Minimal Risk)',
        floodway: 'N/A',
        panelNumber: 'N/A',
        description: 'Area of minimal flood hazard. Outside the 0.2% annual chance floodplain.',
      };
    } catch (e) {
      console.warn('[ParcelService] Flood zone query failed:', e.message);
    }
    return { zone: 'Data unavailable', description: '' };
  }

  function getFloodZoneDescription(zone) {
    if (!zone) return '';
    const z = zone.toUpperCase();
    if (z.startsWith('A') && z !== 'AR') return 'Special Flood Hazard Area — 1% annual chance of flooding (100-year floodplain). Flood insurance required for federally backed mortgages.';
    if (z === 'AR') return 'Special Flood Hazard Area — Regulatory floodway area.';
    if (z.startsWith('V')) return 'Coastal high hazard area — 1% annual chance of flooding with wave action.';
    if (z === 'X' || z === 'C') return 'Area of minimal flood hazard. Outside the 0.2% annual chance floodplain.';
    if (z.includes('SHADED') || z === 'B') return 'Moderate flood hazard — 0.2% annual chance (500-year floodplain).';
    return '';
  }

  // ---- ATTOM API Integration ----

  /**
   * Fetch property details from ATTOM API.
   * Requires an API key stored in localStorage as 'attom_api_key'.
   * Returns enriched data: beds, baths, sqft, year built, AVM, sales history, etc.
   */
  async function getAttomData(parcel) {
    const apiKey = localStorage.getItem('attom_api_key');
    if (!apiKey) return null;

    const headers = {
      'Accept': 'application/json',
      'apikey': apiKey,
    };

    const results = {};

    // Build address query for ATTOM
    const addr1 = parcel.address;
    const addr2 = [parcel.city, 'AR', parcel.zip].filter(Boolean).join(', ');

    if (!addr1) return null;

    // 1) Property Detail (beds, baths, sqft, year built, lot size, etc.)
    try {
      const params = new URLSearchParams({
        address1: addr1,
        address2: addr2,
      });
      const data = await fetchJSON(
        `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?${params}`,
        { headers },
        15000
      );
      if (data.property && data.property.length > 0) {
        const prop = data.property[0];
        results.detail = {
          bedrooms: prop.building?.rooms?.beds,
          bathsFull: prop.building?.rooms?.bathsFull,
          bathsHalf: prop.building?.rooms?.bathsHalf,
          bathsTotal: prop.building?.rooms?.bathsTotal,
          sqft: prop.building?.size?.livingSize || prop.building?.size?.bldgSize,
          yearBuilt: prop.building?.summary?.yearBuilt,
          stories: prop.building?.summary?.levels,
          bldgType: prop.building?.summary?.bldgType,
          construction: prop.building?.construction?.constructionType,
          roofType: prop.building?.construction?.roofCover,
          heating: prop.building?.utility?.heatingType,
          cooling: prop.building?.utility?.coolingType,
          fireplace: prop.building?.interior?.fplcCount,
          garage: prop.building?.parking?.garageType,
          garageSpaces: prop.building?.parking?.prkgSize,
          pool: prop.building?.summary?.pool,
          lotSizeSqFt: prop.lot?.lotSize2,
          lotSizeAcres: prop.lot?.lotSize1,
          lotDescription: prop.lot?.poolType,
          zoning: prop.lot?.siteZoningIdent,
          propertyType: prop.summary?.propType,
          propertySubType: prop.summary?.propSubType,
          propertyClass: prop.summary?.propClass,
          legalDescription: prop.summary?.legal1,
        };
      }
    } catch (e) {
      console.warn('[ATTOM] Property detail failed:', e.message);
    }

    // 2) AVM (Automated Valuation Model)
    try {
      const params = new URLSearchParams({
        address1: addr1,
        address2: addr2,
      });
      const data = await fetchJSON(
        `https://api.gateway.attomdata.com/propertyapi/v1.0.0/attomavm/detail?${params}`,
        { headers },
        15000
      );
      if (data.property && data.property.length > 0) {
        const avm = data.property[0].avm;
        results.avm = {
          estimatedValue: avm?.amount?.value,
          valueLow: avm?.amount?.low,
          valueHigh: avm?.amount?.high,
          confidence: avm?.amount?.scr,
          asOfDate: avm?.eventDate,
        };
      }
    } catch (e) {
      console.warn('[ATTOM] AVM failed:', e.message);
    }

    // 3) Sales History
    try {
      const params = new URLSearchParams({
        address1: addr1,
        address2: addr2,
      });
      const data = await fetchJSON(
        `https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/detail?${params}`,
        { headers },
        15000
      );
      if (data.property && data.property.length > 0) {
        const sales = data.property[0].saleHistory || [];
        results.salesHistory = sales.map(s => ({
          date: s.amount?.saleRecDate || s.amount?.saleTransDate,
          price: s.amount?.saleAmt,
          type: s.amount?.saleTransType,
          deedType: s.calculation?.deedType,
          buyer: s.buyer?.buyerName,
          seller: s.seller?.sellerName,
        }));
      }
    } catch (e) {
      console.warn('[ATTOM] Sales history failed:', e.message);
    }

    return Object.keys(results).length > 0 ? results : null;
  }

  // ---- Zillow Deep Link ----

  function getZillowUrl(parcel) {
    if (!parcel.address) return null;
    // Zillow's search URL format
    const addr = encodeURIComponent(
      [parcel.address, parcel.city, 'AR', parcel.zip].filter(Boolean).join(', ')
    );
    return `https://www.zillow.com/homes/${addr}_rb/`;
  }

  // ---- Normalize parcel data ----

  function normalizeParcelData(feature, county = null) {
    const a = feature.attributes || {};
    const geom = feature.geometry;

    const get = (field) => {
      const v = a[field] !== undefined ? a[field] : a[field.toUpperCase()];
      if (v === null || v === undefined || v === '' || v === 'Null') return null;
      return v;
    };

    const addrParts = [get('adrnum'), get('predir'), get('pstrnam'), get('pstrtype'), get('psufdir')].filter(Boolean);
    const builtAddress = addrParts.length > 1 ? addrParts.join(' ') : null;

    const countyName = get('county');
    const countyFips = get('countyfips');
    let resolvedCounty = county;
    if (!resolvedCounty && countyName) resolvedCounty = CountyRegistry.getByCountyName(countyName);
    if (!resolvedCounty && countyFips) resolvedCounty = CountyRegistry.getByFips('05' + String(countyFips).padStart(3, '0'));

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

    return {
      parcelId: get('parcelid'),
      camaKey: get('camakey'),
      countyId: get('countyid'),
      address: get('adrlabel') || builtAddress,
      city: get('adrcity'),
      zip: get('adrzip5') ? String(get('adrzip5')) : null,
      county: countyName,
      countyFips,
      countyConfig: resolvedCounty,
      owner: get('ownername'),
      acres: parseFloat(get('gis_acres')) || null,
      parcelType: get('parceltype'),
      subdivision: get('subdivision'),
      neighborhood: get('nbhd'),
      legalDescription: get('parcellgl'),
      section: get('section'),
      township: get('township'),
      range: get('range'),
      str: get('str'),
      assessedValue: parseFloat(get('assessvalue')) || null,
      improvementValue: parseFloat(get('impvalue')) || null,
      landValue: parseFloat(get('landvalue')) || null,
      totalValue: parseFloat(get('totalvalue')) || null,
      taxCode: get('taxcode'),
      taxArea: get('taxarea'),
      dataProvider: get('dataprov'),
      camaProvider: get('camaprov'),
      camaDate: get('camadate'),
      pubDate: get('pubdate'),
      sourceRef: get('sourceref'),
      sourceDate: get('sourcedate'),
      geometry: geom,
      centroid,
      _raw: a,
    };
  }

  /**
   * Get full property detail with flood zone + ATTOM enrichment
   */
  async function getFullPropertyDetail(parcel) {
    const enrichments = {};

    // Run flood zone and ATTOM lookups in parallel
    const promises = [];

    if (parcel.centroid) {
      promises.push(
        getFloodZone(parcel.centroid.lat, parcel.centroid.lng)
          .then(fz => { enrichments.floodZone = fz; })
          .catch(() => { enrichments.floodZone = { zone: 'Unavailable', description: '' }; })
      );
    }

    promises.push(
      getAttomData(parcel)
        .then(data => { if (data) enrichments.attom = data; })
        .catch(() => {})
    );

    await Promise.all(promises);

    return { ...parcel, ...enrichments };
  }

  function getAssessorUrl(parcel) {
    const county = parcel.countyConfig;
    if (county && county.assessorPropertyUrl && parcel.parcelId) {
      return county.assessorPropertyUrl + encodeURIComponent(parcel.parcelId);
    }
    if (county && county.assessorUrl) return county.assessorUrl;
    if (parcel.county) return `https://www.arcountydata.com/propsearch.asp?county=${encodeURIComponent(parcel.county)}`;
    return null;
  }

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
    getAttomData,
    getFullPropertyDetail,
    getAssessorUrl,
    getGisViewerUrl,
    getZillowUrl,
    normalizeParcelData,
    queryArcGIS,
  };
})();
