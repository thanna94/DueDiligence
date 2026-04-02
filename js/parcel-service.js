/**
 * Parcel Data Service — Walkingstick Feasibility Assistant
 *
 * Triple-fallback request strategy:
 *   1. Direct fetch (works if server sends CORS headers)
 *   2. JSONP (bypasses CORS via script tag — ArcGIS supports this)
 *   3. CORS proxy (corsproxy.io as last resort)
 *
 * Data sources:
 *   - Arkansas GIS CAMP layers (parcel boundaries, ownership, valuation)
 *   - FEMA NFHL (flood zones)
 *   - ATTOM API (beds/baths/sqft/yearbuilt/AVM/sales — requires API key)
 */

const ParcelService = (() => {
  const POLYGON_URL = ARKANSAS_GIS.parcelPolygonService;
  const CENTROID_URL = ARKANSAS_GIS.parcelCentroidService;
  const FEMA_FLOOD_URL = ARKANSAS_GIS.floodService;
  const CORS_PROXY = 'https://corsproxy.io/?';
  const REQUEST_TIMEOUT = 25000;

  const ALL_FIELDS = 'parcelid,parcellgl,ownername,adrnum,predir,pstrnam,pstrtype,psufdir,adrcity,adrzip5,adrlabel,parceltype,assessvalue,impvalue,landvalue,totalvalue,subdivision,nbhd,section,township,range,str,taxcode,taxarea,camakey,camaprov,county,dataprov,camadate,pubdate,countyfips,countyid,gis_acres,sourceref,sourcedate';
  const DISPLAY_FIELDS = 'parcelid,ownername,adrlabel,county,countyfips,gis_acres,assessvalue,totalvalue';

  // ---- Toast / Debug helpers ----

  function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.style.cssText = `padding:10px 18px;border-radius:8px;font-size:13px;max-width:90vw;text-align:center;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:fadeIn 0.3s;`;
    if (type === 'error') el.style.cssText += 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;';
    else if (type === 'success') el.style.cssText += 'background:#dcfce7;color:#166534;border:1px solid #86efac;';
    else el.style.cssText += 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 5000);
  }

  function dbg(msg) {
    console.log('[Walkingstick]', msg);
    const log = document.getElementById('debug-log');
    if (log) log.textContent += new Date().toLocaleTimeString() + ' ' + msg + '\n';
  }

  // ---- Request strategies ----

  /** Strategy 1: Direct fetch */
  async function directFetch(url, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      // Some servers return JSONP even without callback param; handle that
      try { return JSON.parse(text); } catch (e) {
        // Try stripping JSONP wrapper
        const match = text.match(/^[^(]+\(([\s\S]+)\);?$/);
        if (match) return JSON.parse(match[1]);
        throw new Error('Invalid JSON response');
      }
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  /** Strategy 2: JSONP */
  let jsonpId = 0;
  function jsonpFetch(url, timeout = REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const cb = '__wkstk_' + (++jsonpId) + '_' + Date.now();
      const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeout);
      function cleanup() {
        clearTimeout(timer);
        delete window[cb];
        const s = document.getElementById(cb);
        if (s) s.remove();
      }
      window[cb] = (data) => { cleanup(); resolve(data); };
      const sep = url.includes('?') ? '&' : '?';
      const script = document.createElement('script');
      script.id = cb;
      script.src = url + sep + 'callback=' + cb;
      script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
      document.head.appendChild(script);
    });
  }

  /** Strategy 3: CORS proxy */
  async function proxyFetch(url, timeout = REQUEST_TIMEOUT) {
    const proxyUrl = CORS_PROXY + encodeURIComponent(url);
    return await directFetch(proxyUrl, timeout);
  }

  /**
   * Try all three strategies in sequence
   */
  async function robustFetch(url, label = '') {
    // Strategy 1: Direct fetch
    try {
      dbg(`[${label}] Trying direct fetch...`);
      const data = await directFetch(url);
      dbg(`[${label}] Direct fetch succeeded`);
      return data;
    } catch (e) {
      dbg(`[${label}] Direct fetch failed: ${e.message}`);
    }

    // Strategy 2: JSONP
    try {
      dbg(`[${label}] Trying JSONP...`);
      const data = await jsonpFetch(url);
      dbg(`[${label}] JSONP succeeded`);
      return data;
    } catch (e) {
      dbg(`[${label}] JSONP failed: ${e.message}`);
    }

    // Strategy 3: CORS proxy
    try {
      dbg(`[${label}] Trying CORS proxy...`);
      const data = await proxyFetch(url);
      dbg(`[${label}] CORS proxy succeeded`);
      return data;
    } catch (e) {
      dbg(`[${label}] CORS proxy failed: ${e.message}`);
    }

    throw new Error(`All request strategies failed for ${label}`);
  }

  // ---- ArcGIS query builder ----

  function buildQueryUrl(serviceUrl, params) {
    const defaults = {
      f: 'json',
      outFields: ALL_FIELDS,
      returnGeometry: 'true',
      outSR: '4326',
    };
    const merged = { ...defaults, ...params };
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return `${serviceUrl}/query?${qs}`;
  }

  async function queryArcGIS(serviceUrl, params, label = 'query') {
    const url = buildQueryUrl(serviceUrl, params);
    dbg(`Query URL: ${url.substring(0, 120)}...`);
    const data = await robustFetch(url, label);
    if (data.error) {
      dbg(`ArcGIS error: ${JSON.stringify(data.error)}`);
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    dbg(`Got ${data.features ? data.features.length : 0} features`);
    return data;
  }

  // ---- Startup connection test ----

  async function testConnection() {
    dbg('Testing connection to Arkansas GIS...');
    toast('Connecting to Arkansas GIS...', 'info');
    try {
      const data = await queryArcGIS(CENTROID_URL, {
        where: '1=1',
        resultRecordCount: 1,
        outFields: 'parcelid,county',
        returnGeometry: 'false',
      }, 'connection-test');

      if (data.features && data.features.length > 0) {
        dbg('Connection test PASSED: ' + JSON.stringify(data.features[0].attributes));
        toast('Connected to Arkansas GIS successfully!', 'success');
        return true;
      } else {
        dbg('Connection test: no features returned');
        toast('Connected but no data returned', 'error');
        return false;
      }
    } catch (e) {
      dbg('Connection test FAILED: ' + e.message);
      toast('Cannot connect to Arkansas GIS: ' + e.message, 'error');
      return false;
    }
  }

  // ---- County filter helpers ----

  function countyWhere(county) {
    if (!county) return '';
    // Try both cases since we don't know how the data is stored
    return `(county = '${county.shortName}' OR county = '${county.shortName.toUpperCase()}' OR county = '${county.shortName.toLowerCase()}')`;
  }

  function combineWhere(...clauses) {
    return clauses.filter(Boolean).join(' AND ');
  }

  // ---- Parcel queries ----

  async function getParcelAtPoint(lat, lng, county = null) {
    toast('Searching for parcel...', 'info');

    // Approach 1: Polygon layer with point geometry (simplest format)
    try {
      dbg('Approach 1: Polygon layer, point geometry at ' + lat.toFixed(5) + ',' + lng.toFixed(5));
      const data = await queryArcGIS(POLYGON_URL, {
        geometry: lng + ',' + lat,
        geometryType: 'esriGeometryPoint',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
      }, 'point-poly-simple');
      if (data.features && data.features.length > 0) {
        toast('Parcel found!', 'success');
        return normalizeParcelData(data.features[0], county);
      }
      dbg('Approach 1: 0 features returned');
    } catch (e) {
      dbg('Approach 1 failed: ' + e.message);
    }

    // Approach 2: Polygon layer with envelope (small bounding box around click)
    try {
      const buf = 0.0005; // ~55m buffer
      dbg('Approach 2: Polygon layer, envelope geometry');
      const data = await queryArcGIS(POLYGON_URL, {
        geometry: `${lng - buf},${lat - buf},${lng + buf},${lat + buf}`,
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
      }, 'envelope-poly');
      if (data.features && data.features.length > 0) {
        toast('Parcel found!', 'success');
        return normalizeParcelData(data.features[0], county);
      }
      dbg('Approach 2: 0 features returned');
    } catch (e) {
      dbg('Approach 2 failed: ' + e.message);
    }

    // Approach 3: Centroid layer with JSON point geometry + distance buffer
    try {
      dbg('Approach 3: Centroid layer, JSON point + 200m buffer');
      const geom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
      const data = await queryArcGIS(CENTROID_URL, {
        geometry: geom,
        geometryType: 'esriGeometryPoint',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        distance: 200,
        units: 'esriSRUnit_Meter',
      }, 'point-centroid-buffer');
      if (data.features && data.features.length > 0) {
        toast('Parcel found (centroid)!', 'success');
        return normalizeParcelData(data.features[0], county);
      }
      dbg('Approach 3: 0 features returned');
    } catch (e) {
      dbg('Approach 3 failed: ' + e.message);
    }

    // Approach 4: Centroid layer with envelope
    try {
      const buf = 0.002; // ~220m
      dbg('Approach 4: Centroid layer, envelope');
      const data = await queryArcGIS(CENTROID_URL, {
        geometry: `${lng - buf},${lat - buf},${lng + buf},${lat + buf}`,
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        resultRecordCount: 5,
      }, 'envelope-centroid');
      if (data.features && data.features.length > 0) {
        toast('Parcel found (nearby)!', 'success');
        return normalizeParcelData(data.features[0], county);
      }
      dbg('Approach 4: 0 features returned');
    } catch (e) {
      dbg('Approach 4 failed: ' + e.message);
    }

    toast('No parcel found at this location. Open debug log (triple-tap title) for details.', 'error');
    return null;
  }

  async function searchByAddress(address, county = null) {
    const sanitized = address.toUpperCase().replace(/'/g, "''").trim();

    // Strategy 1: search adrlabel
    try {
      let where = `UPPER(adrlabel) LIKE '%${sanitized}%'`;
      const data = await queryArcGIS(CENTROID_URL, { where, resultRecordCount: 15 }, 'addr-search-label');
      if (data.features && data.features.length > 0) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      dbg('adrlabel search failed: ' + e.message);
    }

    // Strategy 2: search by street name parts
    try {
      const numMatch = address.match(/^(\d+)\s+/);
      const nameParts = sanitized.replace(/^\d+\s+/, '').split(/\s+/).filter(p => p.length > 1);
      if (nameParts.length > 0) {
        let where = nameParts.map(p => `UPPER(pstrnam) LIKE '%${p}%'`).join(' AND ');
        if (numMatch) where = `adrnum = ${numMatch[1]} AND ${where}`;
        const data = await queryArcGIS(CENTROID_URL, { where, resultRecordCount: 15 }, 'addr-search-parts');
        if (data.features && data.features.length > 0) {
          return data.features.map(f => normalizeParcelData(f, county));
        }
      }
    } catch (e) {
      dbg('Street parts search failed: ' + e.message);
    }

    // Strategy 3: search by owner name (user might have entered a name)
    try {
      let where = `UPPER(ownername) LIKE '%${sanitized}%'`;
      const data = await queryArcGIS(CENTROID_URL, { where, resultRecordCount: 10 }, 'addr-search-owner');
      if (data.features && data.features.length > 0) {
        return data.features.map(f => normalizeParcelData(f, county));
      }
    } catch (e) {
      dbg('Owner fallback search failed: ' + e.message);
    }

    return [];
  }

  async function searchByParcelId(parcelId, county = null) {
    const sanitized = parcelId.replace(/'/g, "''");
    try {
      const data = await queryArcGIS(CENTROID_URL, {
        where: `parcelid LIKE '%${sanitized}%'`,
        resultRecordCount: 15,
      }, 'parcel-id-search');
      if (data.features) return data.features.map(f => normalizeParcelData(f, county));
    } catch (e) {
      dbg('Parcel ID search failed: ' + e.message);
    }
    return [];
  }

  async function searchByOwner(ownerName, county = null) {
    const sanitized = ownerName.toUpperCase().replace(/'/g, "''");
    try {
      const data = await queryArcGIS(CENTROID_URL, {
        where: `UPPER(ownername) LIKE '%${sanitized}%'`,
        resultRecordCount: 15,
      }, 'owner-search');
      if (data.features) return data.features.map(f => normalizeParcelData(f, county));
    } catch (e) {
      dbg('Owner search failed: ' + e.message);
    }
    return [];
  }

  async function getParcelsInExtent(bounds, county = null) {
    const geom = JSON.stringify({
      xmin: bounds.getWest(), ymin: bounds.getSouth(),
      xmax: bounds.getEast(), ymax: bounds.getNorth(),
      spatialReference: { wkid: 4326 }
    });
    try {
      return await queryArcGIS(POLYGON_URL, {
        geometry: geom,
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        resultRecordCount: 500,
        outFields: DISPLAY_FIELDS,
      }, 'extent-query');
    } catch (e) {
      return { features: [] };
    }
  }

  // ---- FEMA Flood ----

  async function getFloodZone(lat, lng) {
    try {
      const params = new URLSearchParams({
        geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryPoint',
        layers: 'all:28',
        tolerance: 10,
        mapExtent: `${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}`,
        imageDisplay: '800,600,96',
        returnGeometry: 'false',
        f: 'json',
      });
      const url = `${FEMA_FLOOD_URL}/identify?${params}`;
      const data = await robustFetch(url, 'flood-zone');

      if (data.results && data.results.length > 0) {
        const a = data.results[0].attributes;
        return {
          zone: a.FLD_ZONE || a.ZONE_SUBTY || 'Unknown',
          floodway: a.FLOODWAY || 'N/A',
          panelNumber: a.FIRM_PAN || a.DFIRM_ID || 'N/A',
          effectiveDate: a.EFF_DATE || 'N/A',
          staticBFE: a.STATIC_BFE || 'N/A',
          description: floodDesc(a.FLD_ZONE),
        };
      }
      return { zone: 'X (Minimal Risk)', description: 'Area of minimal flood hazard.' };
    } catch (e) {
      dbg('Flood query failed: ' + e.message);
      return { zone: 'Data unavailable', description: '' };
    }
  }

  function floodDesc(z) {
    if (!z) return '';
    z = z.toUpperCase();
    if (z.startsWith('A')) return '1% annual flood risk (100-yr floodplain). Flood insurance required.';
    if (z.startsWith('V')) return 'Coastal flood zone with wave action.';
    if (z === 'X' || z === 'C') return 'Minimal flood hazard.';
    if (z.includes('SHADED') || z === 'B') return '0.2% annual flood risk (500-yr floodplain).';
    return '';
  }

  // ---- ATTOM API ----

  async function getAttomData(parcel) {
    const apiKey = localStorage.getItem('attom_api_key');
    if (!apiKey || !parcel.address) return null;

    const headers = { 'Accept': 'application/json', 'apikey': apiKey };
    const addr1 = parcel.address;
    const addr2 = [parcel.city, 'AR', parcel.zip].filter(Boolean).join(', ');
    const results = {};

    // Property Detail
    try {
      const params = new URLSearchParams({ address1: addr1, address2: addr2 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(`https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?${params}`, { headers, signal: controller.signal });
      clearTimeout(timer);
      const data = await resp.json();
      if (data.property && data.property.length > 0) {
        const p = data.property[0];
        results.detail = {
          bedrooms: p.building?.rooms?.beds,
          bathsFull: p.building?.rooms?.bathsFull,
          bathsHalf: p.building?.rooms?.bathsHalf,
          bathsTotal: p.building?.rooms?.bathsTotal,
          sqft: p.building?.size?.livingSize || p.building?.size?.bldgSize,
          yearBuilt: p.building?.summary?.yearBuilt,
          stories: p.building?.summary?.levels,
          bldgType: p.building?.summary?.bldgType,
          construction: p.building?.construction?.constructionType,
          roofType: p.building?.construction?.roofCover,
          heating: p.building?.utility?.heatingType,
          cooling: p.building?.utility?.coolingType,
          fireplace: p.building?.interior?.fplcCount,
          garage: p.building?.parking?.garageType,
          garageSpaces: p.building?.parking?.prkgSize,
          pool: p.building?.summary?.pool,
          lotSizeAcres: p.lot?.lotSize1,
          lotSizeSqFt: p.lot?.lotSize2,
          zoning: p.lot?.siteZoningIdent,
          propertyType: p.summary?.propType,
          propertySubType: p.summary?.propSubType,
        };
        dbg('ATTOM detail loaded');
      }
    } catch (e) { dbg('ATTOM detail error: ' + e.message); }

    // AVM
    try {
      const params = new URLSearchParams({ address1: addr1, address2: addr2 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(`https://api.gateway.attomdata.com/propertyapi/v1.0.0/attomavm/detail?${params}`, { headers, signal: controller.signal });
      clearTimeout(timer);
      const data = await resp.json();
      if (data.property && data.property.length > 0) {
        const avm = data.property[0].avm;
        results.avm = {
          estimatedValue: avm?.amount?.value,
          valueLow: avm?.amount?.low,
          valueHigh: avm?.amount?.high,
          confidence: avm?.amount?.scr,
          asOfDate: avm?.eventDate,
        };
        dbg('ATTOM AVM loaded');
      }
    } catch (e) { dbg('ATTOM AVM error: ' + e.message); }

    // Sales History
    try {
      const params = new URLSearchParams({ address1: addr1, address2: addr2 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(`https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/detail?${params}`, { headers, signal: controller.signal });
      clearTimeout(timer);
      const data = await resp.json();
      if (data.property && data.property.length > 0) {
        results.salesHistory = (data.property[0].saleHistory || []).map(s => ({
          date: s.amount?.saleRecDate || s.amount?.saleTransDate,
          price: s.amount?.saleAmt,
          type: s.amount?.saleTransType,
          buyer: s.buyer?.buyerName,
          seller: s.seller?.sellerName,
        }));
        dbg('ATTOM sales loaded: ' + results.salesHistory.length + ' records');
      }
    } catch (e) { dbg('ATTOM sales error: ' + e.message); }

    return Object.keys(results).length > 0 ? results : null;
  }

  // ---- Zillow link ----

  function getZillowUrl(parcel) {
    if (!parcel.address) return null;
    return `https://www.zillow.com/homes/${encodeURIComponent([parcel.address, parcel.city, 'AR', parcel.zip].filter(Boolean).join(', '))}_rb/`;
  }

  // ---- Normalize ----

  function normalizeParcelData(feature, county = null) {
    const a = feature.attributes || {};
    const geom = feature.geometry;
    const get = (field) => {
      let v = a[field];
      if (v === undefined) v = a[field.toUpperCase()];
      if (v === undefined) v = a[field.charAt(0).toUpperCase() + field.slice(1)]; // Title case
      if (v === null || v === undefined || v === '' || v === 'Null') return null;
      return v;
    };

    const addrParts = [get('adrnum'), get('predir'), get('pstrnam'), get('pstrtype'), get('psufdir')].filter(Boolean);
    const countyName = get('county');
    let resolvedCounty = county;
    if (!resolvedCounty && countyName) resolvedCounty = CountyRegistry.getByCountyName(countyName);

    let centroid = null;
    if (geom) {
      if (geom.rings && geom.rings.length > 0) {
        const ring = geom.rings[0];
        let cx = 0, cy = 0;
        ring.forEach(([x, y]) => { cx += x; cy += y; });
        centroid = { lat: cy / ring.length, lng: cx / ring.length };
      } else if (geom.x !== undefined) {
        centroid = { lat: geom.y, lng: geom.x };
      }
    }

    return {
      parcelId: get('parcelid'), camaKey: get('camakey'), countyId: get('countyid'),
      address: get('adrlabel') || (addrParts.length > 1 ? addrParts.join(' ') : null),
      city: get('adrcity'), zip: get('adrzip5') ? String(get('adrzip5')) : null,
      county: countyName, countyFips: get('countyfips'), countyConfig: resolvedCounty,
      owner: get('ownername'),
      acres: parseFloat(get('gis_acres')) || null,
      parcelType: get('parceltype'), subdivision: get('subdivision'), neighborhood: get('nbhd'),
      legalDescription: get('parcellgl'),
      section: get('section'), township: get('township'), range: get('range'), str: get('str'),
      assessedValue: parseFloat(get('assessvalue')) || null,
      improvementValue: parseFloat(get('impvalue')) || null,
      landValue: parseFloat(get('landvalue')) || null,
      totalValue: parseFloat(get('totalvalue')) || null,
      taxCode: get('taxcode'), taxArea: get('taxarea'),
      dataProvider: get('dataprov'), camaProvider: get('camaprov'),
      camaDate: get('camadate'), pubDate: get('pubdate'),
      geometry: geom, centroid, _raw: a,
    };
  }

  async function getFullPropertyDetail(parcel) {
    const enrichments = {};
    const promises = [];
    if (parcel.centroid) {
      promises.push(getFloodZone(parcel.centroid.lat, parcel.centroid.lng).then(fz => { enrichments.floodZone = fz; }).catch(() => {}));
    }
    promises.push(getAttomData(parcel).then(d => { if (d) enrichments.attom = d; }).catch(() => {}));
    await Promise.all(promises);
    return { ...parcel, ...enrichments };
  }

  function getAssessorUrl(parcel) {
    const c = parcel.countyConfig;
    if (c && c.assessorPropertyUrl && parcel.parcelId) return c.assessorPropertyUrl + encodeURIComponent(parcel.parcelId);
    if (c && c.assessorUrl) return c.assessorUrl;
    if (parcel.county) return `https://www.arcountydata.com/propsearch.asp?county=${encodeURIComponent(parcel.county)}`;
    return null;
  }

  function getGisViewerUrl(parcel) {
    return parcel.countyConfig ? parcel.countyConfig.gisViewerUrl : null;
  }

  return {
    getParcelAtPoint, searchByAddress, searchByParcelId, searchByOwner,
    getParcelsInExtent, getFloodZone, getAttomData, getFullPropertyDetail,
    getAssessorUrl, getGisViewerUrl, getZillowUrl, normalizeParcelData,
    queryArcGIS, testConnection, toast, dbg,
  };
})();
